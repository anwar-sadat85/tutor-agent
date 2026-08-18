import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { assessSubmission } from '../assessSubmission.js';

export const assessSubmissionTool = tool({
  name: 'assess_submission',
  description:
    'Grades a student\'s photographed handwritten answer sheet against their currently ' +
    'assigned worksheet (fetched internally — you do not need to provide the worksheet or ' +
    'answer key yourself). Pass the image file path(s) of the submission — never attempt ' +
    'to pass image content directly. Returns legibility status, per-question results, ' +
    'overall score, whether the student passed, and content-only feedback.',
  inputSchema: z.object({
    studentId: z.string(),
    imagePaths: z
      .array(z.string())
      .describe('File path(s) to the photographed answer sheet, in question order'),
  }),
  callback: async ({ studentId, imagePaths }) =>
    assessSubmission({ studentId, imagePaths, region: 'us-west-2' }),
});