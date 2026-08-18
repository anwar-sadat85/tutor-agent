import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { selectNextAssignment } from '../selectNextAssignment.js';

export const selectNextAssignmentTool = tool({
  name: 'select_next_assignment',
  description:
    'Given a student\'s current pass count and whether they just passed a submission, ' +
    'returns the updated pass count and whether the programme is now complete (5 passes ' +
    'required). Call this after assess_submission and before deciding what to do next. ' +
    'Does not persist anything itself — you must call update_student_state afterward with ' +
    'the returned passCount and completed values.',
  inputSchema: z.object({
    currentPassCount: z.number(),
    passed: z.boolean(),
  }),
  callback: async ({ currentPassCount, passed }) => {
    const { action, newPassCount, completed } = selectNextAssignment(currentPassCount, passed);
    return { action: action.kind, passCount: newPassCount, completed };
  },
});