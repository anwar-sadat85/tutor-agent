export const PASSES_REQUIRED = 5;

export type NextAction =
  | { kind: 'complete'; passCount: number }
  | { kind: 'send_new_worksheet'; passCount: number };

/**
 * Decides what happens after a graded submission. Pure function — takes the
 * student's current pass count and whether they passed, returns the updated
 * count and what should happen next. Does not read or write any state itself;
 * the caller (the agent, via update_student_state) is responsible for
 * persisting the result.
 *
 * Flat difficulty model: no easier/harder variants. Every outcome leads to
 * either programme completion or a new worksheet with a new topic at the
 * same Year 6 level. A pass increments the count toward the 5 required to
 * complete; a fail does not.
 */
export function selectNextAssignment(
  currentPassCount: number,
  passed: boolean
): { action: NextAction; newPassCount: number; completed: boolean } {
  const newPassCount = passed ? currentPassCount + 1 : currentPassCount;
  const completed = newPassCount >= PASSES_REQUIRED;

  const action: NextAction = completed
    ? { kind: 'complete', passCount: newPassCount }
    : { kind: 'send_new_worksheet', passCount: newPassCount };

  return { action, newPassCount, completed };
}