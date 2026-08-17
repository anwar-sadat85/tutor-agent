import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { Agent, type ToolList } from '@strands-agents/sdk';
import { z } from 'zod';
import { loadModel } from './model/load.js';
import { generateWorksheetTool } from './tools/generateWorksheetTool.js';
import { renderWorksheetPdfTool } from './tools/renderWorksheetPdfTool.js';
import { sendAssignmentEmailTool } from './tools/sendAssignmentEmailTool.js';

// Define a collection of tools used by the model.
// No MCP clients — Tutor doesn't use any external MCP tools (e.g. web search).
const tools: ToolList = [generateWorksheetTool, renderWorksheetPdfTool, sendAssignmentEmailTool];

const SYSTEM_PROMPT = `You are Tutor, a background agent that generates and sends reading
comprehension worksheets for a Year 6 student, and grades their submissions. You operate on
tool calls, not conversation. Nobody is available to answer clarifying questions — you must
act on every request using only the tools provided, without asking the caller for more
information.

When asked to generate and send a new worksheet for a student:
1. Call generate_worksheet to produce the worksheet and answer key. If you don't know the
   recent topics to avoid, pass an empty array — do not ask what topics to avoid.
2. Call render_worksheet_pdf with the generated worksheet, which produces a PDF file and
   returns its path.
3. Call send_assignment_email with the student's email, the worksheet title, and the exact
   pdfPath from step 2 — never attempt to read, reproduce, or pass the PDF's contents
   yourself, only the path.

Do NOT add commentary, markdown formatting, emojis, curriculum branding, or any narration
around tool output — the caller needs the raw structured data or a plain confirmation, not a
human-readable chat response or a request for clarification.

You have no other tools and no need to search the web or use anything not explicitly
provided to you.`;

const requestSchema = z.object({
  prompt: z.string().default(''),
});

const AGENT_CACHE_LIMIT = 128;

// Reuses one Agent per sessionId so each session keeps its own in-process
// conversation history (best-effort; resets on cold start). A Map preserves
// insertion order, so it doubles as an LRU bounded to 128 sessions — a local
// dev process serving many sessions cannot leak history between them or grow
// without bound. On AgentCore Runtime each microVM serves a single session, so
// this holds one entry. For durable history, attach memory.
const agentCache = new Map<string, Agent>();

async function getOrCreateAgent(sessionId: string): Promise<Agent> {
  const existing = agentCache.get(sessionId);
  if (existing) {
    agentCache.delete(sessionId);
    agentCache.set(sessionId, existing);
    return existing;
  }
  if (agentCache.size >= AGENT_CACHE_LIMIT) {
    const oldest = agentCache.keys().next().value;
    if (oldest !== undefined) agentCache.delete(oldest);
  }
  const model = await loadModel();
  const agent = new Agent({
    model,
    systemPrompt: SYSTEM_PROMPT,
    tools,
  });
  agentCache.set(sessionId, agent);
  return agent;
}

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema,
    async *process(payload, context) {
      const sessionId = context?.sessionId ?? 'default-session';
      const agent = await getOrCreateAgent(sessionId);

      // Snapshot history before streaming so a failed turn can be rolled back.
      // Agent.stream() appends the user message before invoking the model; on a
      // mid-stream error that user turn would otherwise linger in the cached
      // agent, and the next turn for this session would send consecutive user
      // messages (rejected by providers that require strict role alternation,
      // e.g. Anthropic). Restoring on error keeps the session reusable.
      const snapshot = agent.takeSnapshot({ include: ['messages'] });
      try {
        for await (const event of agent.stream(payload.prompt)) {
          if (
            event.type === 'modelStreamUpdateEvent' &&
            event.event?.type === 'modelContentBlockDeltaEvent' &&
            event.event.delta?.type === 'textDelta'
          ) {
            yield { data: event.event.delta.text };
          }
        }
      } catch (error) {
        agent.loadSnapshot(snapshot);
        throw error;
      }
    },
  },
});

app.run({ port: parseInt(process.env.PORT ?? '8080') });