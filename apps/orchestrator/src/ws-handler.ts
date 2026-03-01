import type { WebSocket } from 'ws';
import { processMessage, resumeWithToolResult, type ConversationTurn } from './claude.js';
import { createConfirmationState, type ConfirmationState } from './confirmation.js';
import { registerClient, handleExternalConfirmResponse } from './external-confirm.js';
import { addTranscript } from './session.js';

interface ClientMessage {
  type: 'auth' | 'text' | 'confirm';
  content?: string;
  choice?: number;
  passcode?: string;
  externalId?: string;
}

interface ServerMessage {
  type: 'auth_ok' | 'auth_fail' | 'response' | 'confirm' | 'status' | 'error';
  content?: string;
  confirmData?: {
    toolName: string;
    toolInput: unknown;
    toolUseId: string;
    question: string;
    options: string[];
  };
}

export function handleConnection(ws: WebSocket): void {
  let authenticated = false;
  const confirmState: ConfirmationState = createConfirmationState();
  const passcode = process.env.CLIENT_PASSCODE || '';

  function send(msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  ws.on('message', async (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send({ type: 'error', content: 'Invalid JSON' });
      return;
    }

    // Auth check
    if (msg.type === 'auth') {
      if (!passcode || msg.passcode === passcode) {
        authenticated = true;
        registerClient(ws);
        send({ type: 'auth_ok', content: 'Authenticated' });
        addTranscript('system', 'Client connected and authenticated');
      } else {
        send({ type: 'auth_fail', content: 'Invalid passcode' });
      }
      return;
    }

    if (!authenticated) {
      send({ type: 'auth_fail', content: 'Not authenticated. Send auth message first.' });
      return;
    }

    // Handle confirmation response
    if (msg.type === 'confirm' && msg.externalId) {
      // External confirmation from Claude Code
      const handled = handleExternalConfirmResponse(msg.externalId, msg.choice ?? 0);
      if (handled) {
        send({ type: 'status', content: 'Response sent to Claude Code.' });
      } else {
        send({ type: 'error', content: 'Confirmation expired or not found.' });
      }
      return;
    }

    if (msg.type === 'confirm' && confirmState.pending) {
      const choice = msg.choice ?? 0;
      const approved = choice === 1;
      const pending = confirmState.pending;
      confirmState.pending = null;

      send({ type: 'status', content: approved ? 'Confirmed. Executing...' : 'Cancelled.' });

      try {
        const gen = resumeWithToolResult(
          pending.toolUseId,
          pending.toolName,
          pending.toolInput,
          approved
        );

        for await (const turn of gen) {
          handleTurn(turn);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        send({ type: 'error', content: `Error: ${errMsg}` });
      }
      return;
    }

    // Handle text message — process through Claude
    if (msg.type === 'text' && msg.content) {
      send({ type: 'status', content: 'Thinking...' });

      try {
        const gen = processMessage(msg.content);

        for await (const turn of gen) {
          handleTurn(turn);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        send({ type: 'error', content: `Error: ${errMsg}` });
      }
      return;
    }

    send({ type: 'error', content: 'Unknown message type' });
  });

  function handleTurn(turn: ConversationTurn): void {
    if (turn.type === 'text') {
      send({ type: 'response', content: turn.content });
    } else if (turn.type === 'confirm' && turn.confirmData) {
      // Store pending confirmation
      confirmState.pending = {
        id: Date.now().toString(36),
        question: turn.confirmData.question,
        options: turn.confirmData.options,
        toolName: turn.confirmData.toolName,
        toolInput: turn.confirmData.toolInput,
        toolUseId: turn.confirmData.toolUseId,
      };
      send({ type: 'confirm', content: turn.content, confirmData: turn.confirmData });
    }
  }

  ws.on('close', () => {
    addTranscript('system', 'Client disconnected');
  });
}
