import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { renderWorksheetPdf } from '../renderWorksheetPdf.js';
import { WorksheetSchema } from '../generateWorksheet.js';

export const renderWorksheetPdfTool = tool({
  name: 'render_worksheet_pdf',
  description:
    'Renders a generated worksheet (from generate_worksheet) into a PDF file on disk. ' +
    'Returns only the file path — pass this path (not the PDF content) to ' +
    'send_assignment_email, which reads the file directly.',
  inputSchema: z.object({
    worksheet: WorksheetSchema,
  }),
  callback: async ({ worksheet }) => {
    const outputPath = `/tmp/worksheet-${Date.now()}.pdf`;
    await renderWorksheetPdf(worksheet, outputPath);
    return { pdfPath: outputPath };
  },
});