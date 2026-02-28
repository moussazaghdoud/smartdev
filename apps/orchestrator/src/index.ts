import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { handleConnection } from './ws-handler.js';
import { saveSessionNotes } from './session.js';

const PORT = parseInt(process.env.ORCHESTRATOR_PORT || '7800', 10);

const app = express();
const server = createServer(app);

// Serve voice client static files
const clientDir = path.resolve(import.meta.dirname, '..', '..', 'voice-client');
app.use(express.static(clientDir));

// Health endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'orchestrator', timestamp: new Date().toISOString() });
});

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('[orchestrator] Client connected');
  handleConnection(ws);
});

// Save session notes on shutdown
function shutdown() {
  console.log('[orchestrator] Saving session notes...');
  saveSessionNotes();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[orchestrator] Listening on http://0.0.0.0:${PORT}`);
  console.log(`[orchestrator] Voice client: http://localhost:${PORT}`);
  console.log(`[orchestrator] WebSocket: ws://localhost:${PORT}/ws`);
});
