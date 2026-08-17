import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { sendAssignmentEmail } from '../sendAssignmentEmail.js';

export const sendAssignmentEmailTool = tool({
  name: 'send_assignment_email',
  description:
    'Sends a rendered worksheet PDF to the student via email. Call this after ' +
    'render_worksheet_pdf, passing the pdfPath it returned — do not attempt to ' +
    'pass the PDF content itself as an argument.',
  inputSchema: z.object({
    studentEmail: z.string().email(),
    worksheetTitle: z.string(),
    pdfPath: z.string().describe('File path returned by render_worksheet_pdf'),
  }),
  callback: async ({ studentEmail, worksheetTitle, pdfPath }) => {
    await sendAssignmentEmail({
      studentEmail,
      worksheetTitle,
      pdfPath,
    });
    return { sent: true };
  },
});