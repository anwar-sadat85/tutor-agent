import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { sendCompletionEmail } from '../sendCompletionEmail.js';

export const sendCompletionEmailTool = tool({
  name: 'send_completion_email',
  description:
    'Sends a congratulatory email to a student once they have completed the programme ' +
    '(reached the required number of passes). Call this instead of generating a new ' +
    'worksheet when completed=true.',
  inputSchema: z.object({
    studentEmail: z.string().email(),
    passCount: z.number(),
  }),
  callback: async ({ studentEmail, passCount }) => {
    await sendCompletionEmail({ studentEmail, passCount });
    return { sent: true };
  },
});