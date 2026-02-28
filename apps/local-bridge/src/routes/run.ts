import { Router } from 'express';
import { spawn } from 'node:child_process';
import { isAllowed, getCommand } from '../allowlist.js';
import { audit } from '../audit.js';

const router = Router();

function getProjectRoot(): string {
  return process.env.PROJECT_ROOT || process.cwd();
}

/** POST /run — { commandName: string } */
router.post('/run', (req, res) => {
  const { commandName } = req.body as { commandName?: string };
  if (!commandName) {
    audit({ method: 'POST', path: '/run', params: { commandName }, result: 'error', detail: 'Missing commandName' });
    res.status(400).json({ error: 'Missing commandName parameter' });
    return;
  }

  if (!isAllowed(commandName)) {
    audit({ method: 'POST', path: '/run', params: { commandName }, result: 'denied', detail: 'Not in allowlist' });
    res.status(403).json({ error: `Command "${commandName}" is not allowed. Allowed: test, lint, build` });
    return;
  }

  const command = getCommand(commandName)!;
  audit({ method: 'POST', path: '/run', params: { commandName }, result: 'ok', detail: `Running ${command.cmd} ${command.args.join(' ')}` });

  let stdout = '';
  let stderr = '';

  // Use shell: true on Windows for npm/npx (.cmd scripts)
  const child = spawn(command.cmd, command.args, {
    cwd: getProjectRoot(),
    shell: true,
    timeout: 60_000,
  });

  child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
  child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

  child.on('close', (code) => {
    res.json({ commandName, exitCode: code, stdout, stderr });
  });

  child.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });
});

export default router;
