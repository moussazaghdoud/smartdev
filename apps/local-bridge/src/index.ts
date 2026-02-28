import express from 'express';
import { tokenAuth } from './auth.js';
import healthRoutes from './routes/health.js';
import filesRoutes from './routes/files.js';
import gitRoutes from './routes/git.js';
import runRoutes from './routes/run.js';
import patchRoutes from './routes/patch.js';

const app = express();
const PORT = parseInt(process.env.BRIDGE_PORT || '7700', 10);

app.use(express.json({ limit: '5mb' }));

// Health endpoint does NOT require auth (for connectivity checks)
app.use(healthRoutes);

// All other routes require bearer token
app.use(tokenAuth);
app.use(filesRoutes);
app.use(gitRoutes);
app.use(runRoutes);
app.use(patchRoutes);

// Catch-all: deny unknown routes
app.use((_req, res) => {
  res.status(404).json({ error: 'Unknown endpoint' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[bridge] Local bridge listening on http://127.0.0.1:${PORT}`);
  console.log(`[bridge] PROJECT_ROOT: ${process.env.PROJECT_ROOT || process.cwd()}`);
});
