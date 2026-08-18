import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { Agent, type ToolList } from '@strands-agents/sdk';
import { z } from 'zod';
import { loadModel } from './model/load.js';
import { generateWorksheetTool } from './tools/generateWorksheetTool.js';
import { renderWorksheetPdfTool } from './tools/renderWorksheetPdfTool.js';
import { sendAssignmentEmailTool } from './tools/sendAssignmentEmailTool.js';
import { getStudentStateTool } from './tools/getStudentStateTool.js';
import { updateStudentStateTool } from './tools/updateStudentStateTool.js';
import { assessSubmissionTool } from './tools/assessSubmissionTool.js';
import { selectNextAssignmentTool } from './tools/selectNextAssignmentTool.js';
import { getSubmissionImageTool } from './tools/getSubmissionImageTool.js';

// Define a collection of tools used by the model.
// No MCP clients — Tutor doesn't use any external MCP tools (e.g. web search).
const tools: ToolList = [
  generateWorksheetTool,
  renderWorksheetPdfTool,
  sendAssignmentEmailTool,
  getStudentStateTool,
  updateStudentStateTool,
  assessSubmissionTool,
  selectNextAssignmentTool,
  getSubmissionImageTool,
];

const SYSTEM_PROMPT = `You are Tutor, a background agent that generates and sends reading
comprehension worksheets for a Year 6 student, and grades their submissions. You operate on
tool calls, not conversation. Nobody is available to answer clarifying questions — you must
act on every request using only the tools provided, without asking the caller for more
information.

Every request concerns a specific student, identified by studentId. Extract studentId from
the prompt text — it is always provided.

There are two kinds of requests. Determine which one you've received from the prompt text.

---
FLOW A — Generate and send a new worksheet (e.g. new student enrollment)
---
1. Call get_student_state with the studentId to retrieve their topicHistory (and confirm
   their yearLevel, if provided). If this is a brand-new student with no prior state, an
   empty topicHistory is returned — proceed normally.
2. Call generate_worksheet, passing the retrieved topicHistory as recentTopics so the new
   worksheet doesn't repeat a recent topic.
3. Call update_student_state with the studentId, the student's email, the full generated
   worksheet as currentWorksheet, and the updated topicHistory (the previous list with the
   new topic appended). Always include email here, even if get_student_state already
   returned one — this is the only place a new student's email gets persisted, and without
   it the student can never be matched to their reply email later. Do this BEFORE rendering
   or sending — the answer key must be safely persisted even if a later step fails.
4. Call render_worksheet_pdf with the generated worksheet, which produces a PDF file and
   returns its path.
5. Call send_assignment_email with the student's email, the worksheet title, and the exact
   pdfPath from step 4 — never attempt to read, reproduce, or pass the PDF's contents
   yourself, only the path.

---
FLOW B — Grade a submitted answer sheet
---
1. The prompt will provide an S3 bucket and key for the raw inbound email. Call
   get_submission_image with that bucket and key to extract the submission image(s) to
   local disk — this returns imagePaths.
2. Call assess_submission with the studentId and the imagePaths from step 1 (never attempt
   to pass image content directly, only paths). This fetches the current worksheet's answer
   key internally and returns legibility, per-question results, overall score, and whether
   the student passed.
3. If assess_submission reports the submission was illegible (legible=false or
   confidence="low"), STOP HERE. Do not proceed to any further step. The student needs to
   resend a clearer photo — no state changes, no new worksheet.
4. If legible, call get_student_state to retrieve the student's currentPassCount.
5. Call select_next_assignment with that currentPassCount and the passed value from
   assess_submission. This returns the new passCount and whether the programme is now
   complete (5 passes required) — it does not persist anything itself.
6. Call update_student_state with the studentId, the new passCount, and the completed value
   from step 5.
7. If completed is true, STOP HERE — do not send another worksheet. The student has finished
   the programme.
8. If completed is false, generate and send the next worksheet by following steps 1–5 of
   FLOW A (still call get_student_state again first for the freshest topicHistory, since it
   may have been updated in step 6 above).

---

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