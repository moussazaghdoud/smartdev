import fs from 'node:fs';
import path from 'node:path';

const AUDIT_LOG_PATH = path.resolve(process.cwd(), 'dev-assistant', 'audit.log');

export interface AuditEntry {
  timestamp: string;
  method: string;
  path: string;
  params?: Record<string, unknown>;
  result: 'ok' | 'denied' | 'error';
  detail?: string;
}

export function audit(entry: Omit<AuditEntry, 'timestamp'>): void {
  const full: AuditEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  // Redact anything that looks like a secret
  const line = JSON.stringify(full, (_key, value) => {
    if (typeof value === 'string' && /^(sk-|token|secret|password)/i.test(value)) {
      return '[REDACTED]';
    }
    return value;
  });

  try {
    fs.appendFileSync(AUDIT_LOG_PATH, line + '\n');
  } catch {
    // If we can't write audit log, log to stderr but don't crash
    console.error('[audit] Failed to write audit log entry');
  }
}
