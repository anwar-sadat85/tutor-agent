import { PASSES_REQUIRED, type StudentState } from './studentState.js';

export type NextAction =
  | { kind: 'complete'; passCount: number }
  | { kind: 'send_new_worksheet'; passCount: number };

/**
 * Decides what happens after a graded submission.
 *
 * Flat difficulty model: there are no easier/harder variants. Every outcome
 * (pass or fail) leads to either programme completion or a new worksheet
 * with a new topic at the same Year 6 level. A pass increments the count
 * toward the 5 required to complete; a fail does not.
 */
export function selectNextAssignment(
  currentState: StudentState,
  passed: boolean
): { action: NextAction; updatedState: StudentState } {
  const passCount = passed ? currentState.passCount + 1 : currentState.passCount;
  const completed = passCount >= PASSES_REQUIRED;

  const updatedState: StudentState = { passCount, completed };

  const action: NextAction = completed
    ? { kind: 'complete', passCount }
    : { kind: 'send_new_worksheet', passCount };

  return { action, updatedState };
}
