import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const STATE_PATH = new URL('../student-state.json', import.meta.url);

export const PASSES_REQUIRED = 5;

export interface StudentState {
  passCount: number;
  completed: boolean;
}

const DEFAULT_STATE: StudentState = { passCount: 0, completed: false };

export async function loadStudentState(): Promise<StudentState> {
  if (!existsSync(STATE_PATH)) return { ...DEFAULT_STATE };
  const raw = await readFile(STATE_PATH, 'utf-8');
  return JSON.parse(raw) as StudentState;
}

export async function saveStudentState(state: StudentState): Promise<void> {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}
