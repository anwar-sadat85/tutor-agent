import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { generateWorksheet } from '../generateWorksheet.js';

export const generateWorksheetTool = tool({
  name: 'generate_worksheet',
  description: 'Generates a new Year 6 reading comprehension worksheet with an answer key',
  inputSchema: z.object({
    recentTopics: z.array(z.string()).default([]),
  }),
  callback: async ({ recentTopics }) =>
    generateWorksheet({ yearLevel: 6, recentTopics, region: 'us-west-2' }),
});