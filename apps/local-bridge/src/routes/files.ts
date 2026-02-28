import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { audit } from '../audit.js';

const router = Router();

function getProjectRoot(): string {
  return process.env.PROJECT_ROOT || process.cwd();
}

/** Resolve path safely within PROJECT_ROOT — prevent traversal */
function safePath(relativePath: string): string | null {
  const root = path.resolve(getProjectRoot());
  const resolved = path.resolve(root, relativePath);
  // Normalize to forward slashes for consistent comparison on Windows
  const normalRoot = root.replace(/\\/g, '/').toLowerCase();
  const normalResolved = resolved.replace(/\\/g, '/').toLowerCase();
  if (!normalResolved.startsWith(normalRoot)) {
    return null;
  }
  return resolved;
}

/** POST /readFile — { path: string } */
router.post('/readFile', (req, res) => {
  const { path: filePath } = req.body as { path?: string };
  if (!filePath) {
    audit({ method: 'POST', path: '/readFile', params: { filePath }, result: 'error', detail: 'Missing path' });
    res.status(400).json({ error: 'Missing path parameter' });
    return;
  }

  const resolved = safePath(filePath);
  if (!resolved) {
    audit({ method: 'POST', path: '/readFile', params: { filePath }, result: 'denied', detail: 'Path traversal' });
    res.status(403).json({ error: 'Path outside project root' });
    return;
  }

  try {
    const content = fs.readFileSync(resolved, 'utf-8');
    audit({ method: 'POST', path: '/readFile', params: { filePath }, result: 'ok' });
    res.json({ path: filePath, content, size: content.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    audit({ method: 'POST', path: '/readFile', params: { filePath }, result: 'error', detail: msg });
    res.status(404).json({ error: `File not found: ${filePath}` });
  }
});

/** POST /search — { query: string, root?: string, glob?: string } */
router.post('/search', (req, res) => {
  const body = req.body as { query?: string; root?: string; glob?: string };
  const query = body.query;
  const root = body.root;
  const glob = body.glob;
  if (!query) {
    audit({ method: 'POST', path: '/search', params: { query }, result: 'error', detail: 'Missing query' });
    res.status(400).json({ error: 'Missing query parameter' });
    return;
  }
  const searchQuery: string = query;

  const searchRoot = root ? safePath(root) : path.resolve(getProjectRoot());
  if (!searchRoot) {
    audit({ method: 'POST', path: '/search', params: { query, root }, result: 'denied', detail: 'Path traversal' });
    res.status(403).json({ error: 'Search root outside project root' });
    return;
  }

  const results: Array<{ file: string; line: number; text: string }> = [];
  const pattern = glob || '**';

  function searchDir(dir: string, depth: number = 0) {
    if (depth > 10) return; // prevent deep recursion
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          searchDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          // Check glob pattern (simple extension filter)
          if (pattern !== '**') {
            const ext = path.extname(entry.name);
            if (!pattern.includes(ext) && !pattern.includes('*')) continue;
          }
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (line !== undefined && line.includes(searchQuery)) {
                const relPath = path.relative(getProjectRoot(), fullPath).replace(/\\/g, '/');
                results.push({ file: relPath, line: i + 1, text: line.trim() });
                if (results.length >= 100) return; // cap results
              }
            }
          } catch {
            // Skip binary / unreadable files
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  searchDir(searchRoot);
  audit({ method: 'POST', path: '/search', params: { query, root, glob }, result: 'ok', detail: `${results.length} results` });
  res.json({ query, results, total: results.length });
});

export default router;
