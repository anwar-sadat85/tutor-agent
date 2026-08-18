import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { getSubmissionImage } from '../getSubmissionImage.js';

export const getSubmissionImageTool = tool({
  name: 'get_submission_image',
  description:
    'Fetches the raw email stored in S3 (by the inbound SES receipt rule), parses it, and ' +
    'extracts the photographed answer sheet image attachment(s), writing them to local disk. ' +
    'Call this first when grading a submission, before assess_submission — the bucket and ' +
    'key are provided in the prompt text. Returns local file paths (imagePaths) to pass ' +
    'directly to assess_submission.',
  inputSchema: z.object({
    bucket: z.string(),
    key: z.string(),
  }),
  callback: async ({ bucket, key }) =>
    getSubmissionImage({ bucket, key, region: 'us-west-2' }),
});