import { Router } from 'express';
import { execFile } from 'node:child_process';
import { audit } from '../audit.js';

const router = Router();

function getProjectRoot(): string {
  return process.env.PROJECT_ROOT || process.cwd();
}

function runGit(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: getProjectRoot(), maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

/** GET /git/status */
router.get('/git/status', async (_req, res) => {
  try {
    const output = await runGit(['status', '--porcelain']);
    const branch = await runGit(['branch', '--show-current']);
    audit({ method: 'GET', path: '/git/status', result: 'ok' });
    res.json({ branch: branch.trim(), status: output, clean: output.trim() === '' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    audit({ method: 'GET', path: '/git/status', result: 'error', detail: msg });
    res.status(500).json({ error: msg });
  }
});

/** GET /git/diff */
router.get('/git/diff', async (_req, res) => {
  try {
    const staged = await runGit(['diff', '--cached']);
    const unstaged = await runGit(['diff']);
    audit({ method: 'GET', path: '/git/diff', result: 'ok' });
    res.json({ staged, unstaged });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    audit({ method: 'GET', path: '/git/diff', result: 'error', detail: msg });
    res.status(500).json({ error: msg });
  }
});

export default router;
