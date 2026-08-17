import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const HISTORY_PATH = new URL('../topic-history.json', import.meta.url);

export async function loadRecentTopics(): Promise<string[]> {
  if (!existsSync(HISTORY_PATH)) return [];
  const raw = await readFile(HISTORY_PATH, 'utf-8');
  return JSON.parse(raw) as string[];
}

export async function addTopic(topic: string, maxHistory = 10): Promise<void> {
  const existing = await loadRecentTopics();
  const updated = [...existing, topic].slice(-maxHistory); // keep only the last N
  await writeFile(HISTORY_PATH, JSON.stringify(updated, null, 2));
}
