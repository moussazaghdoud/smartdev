import fs from 'node:fs';
import path from 'node:path';

const DEV_ASSISTANT_DIR = () => path.resolve(process.env.PROJECT_ROOT || process.cwd(), 'dev-assistant');

export interface TranscriptEntry {
  timestamp: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const transcript: TranscriptEntry[] = [];

export function addTranscript(role: TranscriptEntry['role'], content: string): void {
  transcript.push({ timestamp: new Date().toISOString(), role, content });
}

export function getTranscript(): TranscriptEntry[] {
  return [...transcript];
}

export function saveSessionNotes(): void {
  const notesPath = path.join(DEV_ASSISTANT_DIR(), 'session-notes.md');
  const date = new Date().toISOString().split('T')[0];
  const header = `\n## Session ${date}\n\n`;
  const lines = transcript.map(e => `**${e.role}** (${e.timestamp.split('T')[1].split('.')[0]}): ${e.content.substring(0, 200)}`);

  try {
    fs.appendFileSync(notesPath, header + lines.join('\n') + '\n');
  } catch {
    console.error('[session] Failed to save session notes');
  }
}

export function updateContext(updates: Record<string, unknown>): void {
  const contextPath = path.join(DEV_ASSISTANT_DIR(), 'context.json');
  try {
    const existing = JSON.parse(fs.readFileSync(contextPath, 'utf-8'));
    const merged = { ...existing, ...updates };
    fs.writeFileSync(contextPath, JSON.stringify(merged, null, 2));
  } catch {
    console.error('[session] Failed to update context');
  }
}
