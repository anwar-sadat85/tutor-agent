import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { getStudentState } from '../studentState.js';

export const getStudentStateTool = tool({
  name: 'get_student_state',
  description:
    'Retrieves a student\'s current state: pass count, completion status, the currently ' +
    'assigned worksheet (including its answer key), and recent topic history. Call this ' +
    'before grading a submission (you need the answer key) or before generating a new ' +
    'worksheet (you need the topic history to avoid repeats).',
  inputSchema: z.object({
    studentId: z.string(),
  }),
  callback: async ({ studentId }) => getStudentState(studentId),
});