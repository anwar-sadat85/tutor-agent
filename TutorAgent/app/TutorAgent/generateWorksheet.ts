import { Agent, BedrockModel } from '@strands-agents/sdk';
import { z } from 'zod';
import { SAMPLE_WORKSHEET, STYLE_NOTES } from './samples.js';

// Bedrock requires a cross-region inference profile ID (not the bare model ID)
// for on-demand invocation of most current models. The prefix depends on the
// region you're calling from — confirmed via `aws bedrock list-inference-profiles`.
// ap-southeast-2 uses "au", not "apac" as originally guessed.
function inferenceProfilePrefix(region: string): string {
  if (region === 'ap-southeast-2') return 'au';
  if (region.startsWith('us-')) return 'us';
  if (region.startsWith('eu-')) return 'eu';
  throw new Error(
    `No confirmed inference profile prefix for region "${region}" — run ` +
      `"aws bedrock list-inference-profiles --region ${region}" and add it here.`
  );
}

// ---- Structured output schema -------------------------------------------
// The agent must return content matching this shape exactly. Zod validates
// the response and Strands will auto-retry on a validation failure.

const QuestionSchema = z.object({
  number: z.number().describe('Question number, 1-8'),
  type: z
    .enum(['literal', 'inferential', 'vocabulary', 'opinion', 'summary'])
    .describe('Question type, matching the style notes distribution'),
  text: z.string().describe('The question text shown to the student'),
});

const AnswerKeyEntrySchema = z.object({
  number: z.number(),
  expectedAnswer: z
    .string()
    .describe('The expected answer or acceptable range of answers'),
  gradingNotes: z
    .string()
    .describe(
      'Notes for the grader: acceptable paraphrasing, whether this is open-ended, ' +
        'spelling leniency for proper nouns, etc.'
    ),
});

export const WorksheetSchema = z.object({
  title: z.string(),
  yearLevel: z.number(),
  passage: z.string().describe('The full reading passage, 300-350 words'),
  topic: z
    .string()
    .describe('Short topic label used to avoid repeating topics across assignments'),
  questions: z.array(QuestionSchema).length(8),
  answerKey: z.array(AnswerKeyEntrySchema).length(8),
});

export type GeneratedWorksheet = z.infer<typeof WorksheetSchema>;

// ---- generate_worksheet ---------------------------------------------------

export async function generateWorksheet(options: {
  yearLevel: number;
  recentTopics: string[];
  region: string;
  modelId?: string;
}): Promise<GeneratedWorksheet> {
  const { yearLevel, recentTopics, region, modelId } = options;

  const model = new BedrockModel({
    region,
    modelId: modelId ?? `${inferenceProfilePrefix(region)}.anthropic.claude-sonnet-4-6`,
    maxTokens: 4096,
    temperature: 0.8, // some creativity for topic variety, but not wild
  });

  const agent = new Agent({
    model,
    systemPrompt: `You generate reading comprehension worksheets for a Year ${yearLevel}
student, following the exact style, length, and difficulty of the sample worksheet
provided. You must also generate a matching answer key with grading notes.

${STYLE_NOTES}

Sample worksheet for style/difficulty reference (do not reuse its topic or passage):
${SAMPLE_WORKSHEET}

Topics already used recently — do not reuse these or anything very similar:
${recentTopics.length > 0 ? recentTopics.join(', ') : '(none yet)'}

Return only the structured worksheet and answer key. Do not include any commentary
outside the structured fields.`,
    structuredOutputSchema: WorksheetSchema,
  });

  const result = await agent.invoke(
    `Generate a new Year ${yearLevel} reading comprehension worksheet now.`
  );

  // Confirmed via debug run: the validated object is under result.structuredOutput,
  // not on result directly.
  return result.structuredOutput as GeneratedWorksheet;
}