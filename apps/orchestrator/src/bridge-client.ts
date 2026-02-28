/** Bridge client — communicates with local bridge via its WebSocket connection */

import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

// The bridge WebSocket connection (set when bridge connects)
let bridgeSocket: WebSocket | null = null;
let bridgeProjectRoot: string = '';

// Pending tool call responses
const pendingCalls = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

export function isBridgeConnected(): boolean {
  return bridgeSocket !== null && bridgeSocket.readyState === bridgeSocket.OPEN;
}

export function getBridgeProjectRoot(): string {
  return bridgeProjectRoot;
}

export function registerBridge(ws: WebSocket, projectRoot: string): void {
  bridgeSocket = ws;
  bridgeProjectRoot = projectRoot;
  console.log(`[bridge-client] Bridge registered (project: ${projectRoot})`);

  ws.on('message', (raw: Buffer) => {
    let msg: { id?: string; type?: string; result?: unknown; error?: string };
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.id && msg.type === 'tool_result' && pendingCalls.has(msg.id)) {
      const pending = pendingCalls.get(msg.id)!;
      clearTimeout(pending.timer);
      pendingCalls.delete(msg.id);
      pending.resolve(msg.result);
    }

    if (msg.id && msg.type === 'tool_error' && pendingCalls.has(msg.id)) {
      const pending = pendingCalls.get(msg.id)!;
      clearTimeout(pending.timer);
      pendingCalls.delete(msg.id);
      pending.reject(new Error(msg.error || 'Bridge tool error'));
    }
  });

  ws.on('close', () => {
    console.log('[bridge-client] Bridge disconnected');
    bridgeSocket = null;
    bridgeProjectRoot = '';
    // Reject all pending calls
    for (const [id, pending] of pendingCalls) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Bridge disconnected'));
      pendingCalls.delete(id);
    }
  });
}

/** Send a tool call to the bridge and wait for the response */
function callBridge(tool: string, input: Record<string, string> = {}): Promise<unknown> {
  if (!isBridgeConnected()) {
    return Promise.reject(new Error('Local bridge is not connected. Make sure the bridge is running on your dev machine.'));
  }

  const id = randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(id);
      reject(new Error(`Bridge tool call "${tool}" timed out after 60s`));
    }, 60_000);

    pendingCalls.set(id, { resolve, reject, timer });
    bridgeSocket!.send(JSON.stringify({ id, tool, input }));
  });
}

// Public API — same interface as before
export function bridgeReadFile(filePath: string) { return callBridge('read_file', { path: filePath }); }
export function bridgeSearch(query: string, root?: string) { return callBridge('search_code', { query, ...(root ? { root } : {}) }); }
export function bridgeGitStatus() { return callBridge('git_status'); }
export function bridgeGitDiff() { return callBridge('git_diff'); }
export function bridgeRun(commandName: string) { return callBridge('run_command', { commandName }); }
export function bridgePatchPrepare(diff: string) { return callBridge('patch_prepare', { diff }); }
export function bridgePatchApply(patchId: string) { return callBridge('patch_apply', { patchId }); }
