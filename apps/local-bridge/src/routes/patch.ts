import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { execFile } from 'node:child_process';
import { audit } from '../audit.js';

const router = Router();

// In-memory store for prepared patches
const pendingPatches = new Map<string, { diff: string; filePath: string; createdAt: string }>();

function getProjectRoot(): string {
  return process.env.PROJECT_ROOT || process.cwd();
}

/** POST /patch/prepare — { diff: string } */
router.post('/patch/prepare', (req, res) => {
  const { diff } = req.body as { diff?: string };
  if (!diff) {
    audit({ method: 'POST', path: '/patch/prepare', result: 'error', detail: 'Missing diff' });
    res.status(400).json({ error: 'Missing diff parameter' });
    return;
  }

  const patchId = uuidv4();
  const patchDir = path.join(getProjectRoot(), 'dev-assistant', '.patches');
  fs.mkdirSync(patchDir, { recursive: true });

  const patchFile = path.join(patchDir, `${patchId}.patch`);
  fs.writeFileSync(patchFile, diff);

  pendingPatches.set(patchId, { diff, filePath: patchFile, createdAt: new Date().toISOString() });

  // Build a short summary
  const lines = diff.split('\n');
  const filesChanged = lines.filter(l => l.startsWith('---') || l.startsWith('+++')).length / 2;
  const additions = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
  const deletions = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;

  audit({ method: 'POST', path: '/patch/prepare', params: { patchId }, result: 'ok' });
  res.json({
    patchId,
    summary: `${filesChanged} file(s) changed, +${additions} -${deletions}`,
    preview: diff.substring(0, 500),
    requiresConfirmation: true,
  });
});

/** POST /patch/apply — { patchId: string } */
router.post('/patch/apply', (req, res) => {
  const { patchId } = req.body as { patchId?: string };
  if (!patchId) {
    audit({ method: 'POST', path: '/patch/apply', result: 'error', detail: 'Missing patchId' });
    res.status(400).json({ error: 'Missing patchId parameter' });
    return;
  }

  const patch = pendingPatches.get(patchId);
  if (!patch) {
    audit({ method: 'POST', path: '/patch/apply', params: { patchId }, result: 'error', detail: 'Patch not found' });
    res.status(404).json({ error: `Patch ${patchId} not found or already applied` });
    return;
  }

  execFile('git', ['apply', '--check', patch.filePath], { cwd: getProjectRoot() }, (checkErr) => {
    if (checkErr) {
      audit({ method: 'POST', path: '/patch/apply', params: { patchId }, result: 'error', detail: 'Patch does not apply cleanly' });
      res.status(409).json({ error: 'Patch does not apply cleanly', detail: checkErr.message });
      return;
    }

    execFile('git', ['apply', patch.filePath], { cwd: getProjectRoot() }, (applyErr) => {
      if (applyErr) {
        audit({ method: 'POST', path: '/patch/apply', params: { patchId }, result: 'error', detail: applyErr.message });
        res.status(500).json({ error: 'Failed to apply patch', detail: applyErr.message });
        return;
      }

      pendingPatches.delete(patchId);
      audit({ method: 'POST', path: '/patch/apply', params: { patchId }, result: 'ok' });
      res.json({ patchId, applied: true });
    });
  });
});

export default router;
