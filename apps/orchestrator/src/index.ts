import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { handleConnection } from './ws-handler.js';
import { registerBridge, isBridgeConnected } from './bridge-client.js';
import { saveSessionNotes } from './session.js';

const PORT = parseInt(process.env.PORT || process.env.ORCHESTRATOR_PORT || '7800', 10);
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';

const app = express();
const server = createServer(app);

// Serve voice client static files (bundled in public/)
const clientDir = path.resolve(import.meta.dirname, '..', 'public');
app.use(express.static(clientDir));

// Health endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'orchestrator',
    bridgeConnected: isBridgeConnected(),
    bridgeTokenLength: BRIDGE_TOKEN.length,
    bridgeTokenPrefix: BRIDGE_TOKEN.substring(0, 4) || '(empty)',
    timestamp: new Date().toISOString(),
  });
});

// WebSocket server for voice clients
const clientWss = new WebSocketServer({ noServer: true });
clientWss.on('connection', (ws) => {
  console.log('[orchestrator] Voice client connected');
  handleConnection(ws);
});

// WebSocket server for bridge connection
const bridgeWss = new WebSocketServer({ noServer: true });
bridgeWss.on('connection', (ws) => {
  console.log('[orchestrator] Bridge connected');

  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'bridge_hello') {
        registerBridge(ws, msg.projectRoot || '');
      }
    } catch { /* handled in bridge-client */ }
  });
});

// Route upgrade requests to the correct WSS
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url || '/', `http://${request.headers.host}`);

  if (pathname.startsWith('/bridge-ws')) {
    // Authenticate bridge connection (support header or query string token)
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    const auth = request.headers.authorization;
    const queryToken = url.searchParams.get('token');
    const isAuthed = !BRIDGE_TOKEN
      || auth === `Bearer ${BRIDGE_TOKEN}`
      || queryToken === BRIDGE_TOKEN;
    if (!isAuthed) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    bridgeWss.handleUpgrade(request, socket, head, (ws) => {
      bridgeWss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws') {
    clientWss.handleUpgrade(request, socket, head, (ws) => {
      clientWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
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
  console.log(`[orchestrator] Client WS: ws://localhost:${PORT}/ws`);
  console.log(`[orchestrator] Bridge WS: ws://localhost:${PORT}/bridge-ws`);
  console.log(`[orchestrator] Waiting for bridge to connect...`);
});
