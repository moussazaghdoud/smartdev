import 'dotenv/config';
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import { audit } from './audit.js';
import { isAllowed, getCommand } from './allowlist.js';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'ws://localhost:7800';
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';
const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();

// Pending patches store
const pendingPatches = new Map<string, { diff: string; filePath: string; createdAt: string }>();

/** Resolve path safely within PROJECT_ROOT */
function safePath(relativePath: string): string | null {
  const root = path.resolve(PROJECT_ROOT);
  const resolved = path.resolve(root, relativePath);
  const normalRoot = root.replace(/\\/g, '/').toLowerCase();
  const normalResolved = resolved.replace(/\\/g, '/').toLowerCase();
  if (!normalResolved.startsWith(normalRoot)) return null;
  return resolved;
}

/** Handle a tool request from the orchestrator */
async function handleToolRequest(tool: string, input: Record<string, string>): Promise<unknown> {
  switch (tool) {
    case 'read_file': {
      const filePath = input.path;
      if (!filePath) throw new Error('Missing path');
      const resolved = safePath(filePath);
      if (!resolved) { audit({ method: 'POST', path: '/readFile', params: { filePath }, result: 'denied', detail: 'Path traversal' }); throw new Error('Path outside project root'); }
      const content = fs.readFileSync(resolved, 'utf-8');
      audit({ method: 'POST', path: '/readFile', params: { filePath }, result: 'ok' });
      return { path: filePath, content, size: content.length };
    }

    case 'search_code': {
      const query = input.query;
      if (!query) throw new Error('Missing query');
      const searchRoot = input.root ? safePath(input.root) : path.resolve(PROJECT_ROOT);
      if (!searchRoot) throw new Error('Search root outside project root');
      const results: Array<{ file: string; line: number; text: string }> = [];
      function searchDir(dir: string, depth = 0) {
        if (depth > 10 || results.length >= 100) return;
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) { searchDir(fullPath, depth + 1); }
            else if (entry.isFile()) {
              try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i];
                  if (line !== undefined && line.includes(query)) {
                    results.push({ file: path.relative(PROJECT_ROOT, fullPath).replace(/\\/g, '/'), line: i + 1, text: line.trim() });
                    if (results.length >= 100) return;
                  }
                }
              } catch { /* skip binary */ }
            }
          }
        } catch { /* skip inaccessible */ }
      }
      searchDir(searchRoot);
      audit({ method: 'POST', path: '/search', params: { query }, result: 'ok', detail: `${results.length} results` });
      return { query, results, total: results.length };
    }

    case 'git_status': {
      const [status, branch] = await Promise.all([
        runGit(['status', '--porcelain']),
        runGit(['branch', '--show-current']),
      ]);
      audit({ method: 'GET', path: '/git/status', result: 'ok' });
      return { branch: branch.trim(), status, clean: status.trim() === '' };
    }

    case 'git_diff': {
      const [staged, unstaged] = await Promise.all([
        runGit(['diff', '--cached']),
        runGit(['diff']),
      ]);
      audit({ method: 'GET', path: '/git/diff', result: 'ok' });
      return { staged, unstaged };
    }

    case 'run_command': {
      const commandName = input.commandName;
      if (!commandName || !isAllowed(commandName)) {
        audit({ method: 'POST', path: '/run', params: { commandName }, result: 'denied' });
        throw new Error(`Command "${commandName}" not allowed. Allowed: test, lint, build`);
      }
      const command = getCommand(commandName)!;
      audit({ method: 'POST', path: '/run', params: { commandName }, result: 'ok' });
      return new Promise((resolve, reject) => {
        let stdout = '', stderr = '';
        const child = spawn(command.cmd, command.args, { cwd: PROJECT_ROOT, shell: true, timeout: 60_000 });
        child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        child.on('close', (code) => resolve({ commandName, exitCode: code, stdout, stderr }));
        child.on('error', (err) => reject(err));
      });
    }

    case 'patch_prepare': {
      const diff = input.diff;
      if (!diff) throw new Error('Missing diff');
      const patchId = uuidv4();
      const patchDir = path.join(PROJECT_ROOT, 'dev-assistant', '.patches');
      fs.mkdirSync(patchDir, { recursive: true });
      const patchFile = path.join(patchDir, `${patchId}.patch`);
      fs.writeFileSync(patchFile, diff);
      pendingPatches.set(patchId, { diff, filePath: patchFile, createdAt: new Date().toISOString() });
      const lines = diff.split('\n');
      const additions = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
      const deletions = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;
      audit({ method: 'POST', path: '/patch/prepare', params: { patchId }, result: 'ok' });
      return { patchId, summary: `+${additions} -${deletions}`, preview: diff.substring(0, 500), requiresConfirmation: true };
    }

    case 'patch_apply': {
      const patchId = input.patchId;
      if (!patchId) throw new Error('Missing patchId');
      const patch = pendingPatches.get(patchId);
      if (!patch) throw new Error(`Patch ${patchId} not found`);
      await new Promise<void>((resolve, reject) => {
        execFile('git', ['apply', '--check', patch.filePath], { cwd: PROJECT_ROOT }, (err) => {
          if (err) { reject(new Error('Patch does not apply cleanly: ' + err.message)); return; }
          execFile('git', ['apply', patch.filePath], { cwd: PROJECT_ROOT }, (err2) => {
            if (err2) { reject(err2); return; }
            pendingPatches.delete(patchId);
            resolve();
          });
        });
      });
      audit({ method: 'POST', path: '/patch/apply', params: { patchId }, result: 'ok' });
      return { patchId, applied: true };
    }

    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

function runGit(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: PROJECT_ROOT, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

/** Connect to orchestrator via WebSocket */
function connect() {
  const wsUrl = `${ORCHESTRATOR_URL}/bridge-ws?token=${encodeURIComponent(BRIDGE_TOKEN)}`;
  console.log(`[bridge] Connecting to ${ORCHESTRATOR_URL}/bridge-ws...`);

  const ws = new WebSocket(wsUrl, {
    headers: { 'Authorization': `Bearer ${BRIDGE_TOKEN}` },
  });

  ws.on('open', () => {
    console.log('[bridge] Connected to orchestrator');
    // Send registration message
    ws.send(JSON.stringify({ type: 'bridge_hello', projectRoot: PROJECT_ROOT }));
  });

  ws.on('message', async (raw: Buffer) => {
    let msg: { id: string; tool: string; input: Record<string, string> };
    try {
      msg = JSON.parse(raw.toString());
    } catch { return; }

    // Handle tool requests from orchestrator
    if (msg.tool && msg.id) {
      try {
        const result = await handleToolRequest(msg.tool, msg.input || {});
        ws.send(JSON.stringify({ id: msg.id, type: 'tool_result', result }));
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        ws.send(JSON.stringify({ id: msg.id, type: 'tool_error', error: errMsg }));
      }
    }
  });

  ws.on('close', () => {
    console.log('[bridge] Disconnected. Reconnecting in 3s...');
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    console.error('[bridge] Connection error:', err.message);
  });
}

console.log(`[bridge] PROJECT_ROOT: ${PROJECT_ROOT}`);
connect();
