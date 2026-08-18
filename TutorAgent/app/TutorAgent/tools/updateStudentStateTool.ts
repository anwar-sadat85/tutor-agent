import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { updateStudentState } from '../studentState.js';
import { WorksheetSchema } from '../generateWorksheet.js';

export const updateStudentStateTool = tool({
  name: 'update_student_state',
  description:
    'Persists changes to a student\'s state. Only include the fields you want to change — ' +
    'this merges into the existing record rather than overwriting it. Always call this ' +
    'immediately after generate_worksheet, saving the currentWorksheet and updated ' +
    'topicHistory, BEFORE rendering or sending — so the answer key is safely stored even ' +
    'if a later step fails. Also call this after grading, to update passCount/completed.',
  inputSchema: z.object({
    studentId: z.string(),
    email: z.string().email().optional(),
    yearLevel: z.number().optional(),
    currentWorksheet: WorksheetSchema.optional(),
    topicHistory: z.array(z.string()).optional(),
    passCount: z.number().optional(),
    completed: z.boolean().optional(),
  }),
  callback: async ({ studentId, ...updates }) => {
    await updateStudentState(studentId, updates);
    return { updated: true };
  },
});