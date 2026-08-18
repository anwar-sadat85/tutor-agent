import { readFile } from 'fs/promises';
import { Agent, BedrockModel, TextBlock, ImageBlock } from '@strands-agents/sdk';
import { z } from 'zod';
import { getStudentState } from './studentState.js';

function inferenceProfilePrefix(region: string): string {
  if (region === 'ap-southeast-2') return 'au';
  if (region.startsWith('us-')) return 'us';
  if (region.startsWith('eu-')) return 'eu';
  throw new Error(
    `No confirmed inference profile prefix for region "${region}" — run ` +
      `"aws bedrock list-inference-profiles --region ${region}" and add it here.`
  );
}

const PASS_THRESHOLD = 0.7; // 70% of questions correct — adjust as needed

// ---- Structured output schema ---------------------------------------------

const PerQuestionResultSchema = z.object({
  number: z.number(),
  answerRead: z
    .string()
    .nullable()
    .describe('The answer as read from the handwriting, or null if the question number was skipped entirely'),
  status: z.enum(['answered', 'missing']),
  correct: z.boolean().describe('True if correct. A missing answer is always false.'),
});

export const AssessmentSchema = z.object({
  legible: z
    .boolean()
    .describe('False if the submission as a whole is too unclear to grade reliably'),
  confidence: z.enum(['high', 'medium', 'low']),
  perQuestion: z.array(PerQuestionResultSchema),
  overallScore: z.number().describe('Score out of the total number of questions'),
  feedback: z
    .string()
    .describe(
      'Content-only feedback for the student. Must NEVER comment on handwriting ' +
        'neatness, letter formation, or presentation — only on the correctness ' +
        'and quality of the answers themselves.'
    ),
});

export type Assessment = z.infer<typeof AssessmentSchema>;

export interface AssessSubmissionResult extends Assessment {
  passed: boolean;
  totalQuestions: number;
}

const SYSTEM_PROMPT = `You are grading a Year 6 student's handwritten answers to a reading
comprehension worksheet. The student photographed or scanned a separate answer sheet where
they wrote the question number followed by their answer for each question.

Your job, in order:

1. LEGIBILITY GATE — First assess whether the submission as a whole is clear enough to grade
   reliably. Set legible=false if ANY of the following apply to a meaningful portion of the
   submission: handwriting is too unclear/blurry/dark to confidently read; the photo is
   cropped or cut off such that question numbers, line starts, or line ends are missing;
   part of the page is out of frame. Do NOT set legible=true and then grade with guesses,
   fragments, or reconstructed partial text — if you find yourself inferring words from
   context because the image itself doesn't show them clearly, that means legible=false,
   not "answer anyway with low confidence." When in doubt, prefer legible=false and request
   a clearer photo rather than producing an unreliable grade.

2. If legible, grade each question against the provided answer key. For each question number
   in the answer key:
   - If the student wrote an answer for that number, read it, compare it to the expected
     answer using the grading notes provided (accept reasonable paraphrasing where noted,
     require exact match where noted, treat open-ended questions per their notes).
   - If the student did NOT write anything for that question number, mark status="missing",
     answerRead=null, and correct=false. This is treated as an intentional skip, not
     something to flag back to the student — do not treat it as a reason to request a
     clearer photo.

3. Content-only grading. Do NOT comment on, score, or mention handwriting neatness, letter
   formation, or presentation in any way, in the feedback or anywhere else. Only assess
   whether the content of each answer is correct.

4. Ambiguous words: if a word's spelling is imperfect but the intended answer is clearly
   readable and correct in meaning, mark it correct — do not penalise minor spelling errors
   in a reading comprehension context unless the grading notes say otherwise.

5. Feedback should be brief, encouraging, and content-focused — never anything evaluative
   about handwriting itself.

Return only the structured assessment.`;

export async function assessSubmission(options: {
  studentId: string;
  imagePaths: string[];
  region: string;
  modelId?: string;
}): Promise<AssessSubmissionResult> {
  const { studentId, imagePaths, region, modelId } = options;

  const state = await getStudentState(studentId);
  const worksheet = state.currentWorksheet;
  if (!worksheet) {
    throw new Error(
      `No currentWorksheet found for studentId=${studentId} — cannot grade without a ` +
        `worksheet on record. This student may not have been sent a worksheet yet.`
    );
  }

  const imageBlocks = await Promise.all(
    imagePaths.map(async (imagePath) => {
      const imageBytes = await readFile(imagePath);
      const format = imagePath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
      return new ImageBlock({
        format,
        source: { bytes: new Uint8Array(imageBytes) },
      });
    })
  );

  const model = new BedrockModel({
    region,
    modelId: modelId ?? `${inferenceProfilePrefix(region)}.anthropic.claude-sonnet-4-6`,
    maxTokens: 4096,
    temperature: 0.2, // grading should be consistent, not creative
  });

  const agent = new Agent({
    model,
    systemPrompt: SYSTEM_PROMPT,
  });

  const answerKeyText = worksheet.answerKey
    .map(
      (a) =>
        `Q${a.number}: Expected answer — ${a.expectedAnswer}\n  Grading notes: ${a.gradingNotes}`
    )
    .join('\n\n');

  const result = await agent.invoke(
    [
      new TextBlock(
        `Worksheet title: ${worksheet.title}\n\n` +
          `Answer key:\n${answerKeyText}\n\n` +
          `The attached image(s) are page(s) of the student's photographed numbered answer ` +
          `sheet — there are ${imagePaths.length} page(s) in total, covering all questions ` +
          `between them. Read across all pages before grading. Grade per your instructions.`
      ),
      ...imageBlocks,
    ],
    { structuredOutputSchema: AssessmentSchema }
  );

  const assessment = result.structuredOutput as Assessment;
  const totalQuestions = worksheet.questions.length;
  const passed =
    assessment.legible &&
    assessment.confidence !== 'low' &&
    assessment.overallScore / totalQuestions >= PASS_THRESHOLD;

  return { ...assessment, passed, totalQuestions };
}