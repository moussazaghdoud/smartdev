/** External confirmation system — lets Claude Code send confirmations to the voice client */

import type { WebSocket } from 'ws';

interface PendingExternalConfirm {
  id: string;
  question: string;
  options: string[];
  resolve: (choice: number) => void;
  timer: ReturnType<typeof setTimeout>;
}

// Connected authenticated voice clients
const connectedClients = new Set<WebSocket>();
// Pending external confirmations
const pendingConfirms = new Map<string, PendingExternalConfirm>();

let confirmCounter = 0;

export function registerClient(ws: WebSocket): void {
  connectedClients.add(ws);
  ws.on('close', () => connectedClients.delete(ws));
}

export function getClientCount(): number {
  return connectedClients.size;
}

/** Send a confirmation request to all connected voice clients and wait for a response */
export function requestExternalConfirm(
  question: string,
  options: string[],
  timeoutMs = 120_000
): Promise<{ choice: number; option: string }> {
  return new Promise((resolve, reject) => {
    if (connectedClients.size === 0) {
      reject(new Error('No voice client connected. Open the app on your phone first.'));
      return;
    }

    const id = `ext-${++confirmCounter}-${Date.now()}`;

    const timer = setTimeout(() => {
      pendingConfirms.delete(id);
      reject(new Error('Confirmation timed out (2 minutes). No response from voice client.'));
    }, timeoutMs);

    pendingConfirms.set(id, { id, question, options, resolve: (choice: number) => {
      clearTimeout(timer);
      pendingConfirms.delete(id);
      const option = options[choice - 1] || `Choice ${choice}`;
      resolve({ choice, option });
    }, timer });

    // Send to all connected clients
    const msg = JSON.stringify({
      type: 'confirm',
      content: `[Claude Code] ${question}`,
      confirmData: {
        externalId: id,
        question,
        options,
        source: 'claude-code',
      },
    });

    for (const ws of connectedClients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg);
      }
    }
  });
}

/** Handle a confirmation response from the voice client */
export function handleExternalConfirmResponse(externalId: string, choice: number): boolean {
  const pending = pendingConfirms.get(externalId);
  if (!pending) return false;
  pending.resolve(choice);
  return true;
}
