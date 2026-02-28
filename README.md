# SmartDev — Voice Dev Assistant

Talk to Claude from any device while it stays connected to your VS Code workspace.

## Architecture

```
[Browser / Phone]  ──WebSocket──▶  [Orchestrator :7800]
       │                                │          │
  Web Speech API                  Claude API   HTTP calls
  (STT in browser)                                │
                                         [Local Bridge :7700]
                                               │
                                         [Your Repo]
```

**3 components:**
- **Local Bridge** — Secure Node.js service on `127.0.0.1:7700`. Reads files, searches code, runs git commands, executes allowlisted commands (test/lint/build), prepares and applies patches. Audit-logged.
- **Orchestrator** — Express + WebSocket server on port `7800`. Routes messages between client and Claude, manages tool calls to the bridge, handles confirmations.
- **Voice Client** — Plain HTML/CSS/JS served by the orchestrator. Push-to-talk mic (Web Speech API), text input, confirmation buttons. Works on mobile.

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
BRIDGE_TOKEN=some-random-secret
BRIDGE_PORT=7700
ORCHESTRATOR_PORT=7800
PROJECT_ROOT=/path/to/your/repo
CLIENT_PASSCODE=dev123
```

### 3. Run (2 terminals)

**Terminal 1 — Bridge:**
```bash
cd apps/local-bridge
cp ../../.env .env
npm run dev
```

**Terminal 2 — Orchestrator:**
```bash
cd apps/orchestrator
npm run dev
```

### 4. Open

Go to `http://localhost:7800` in any browser (phone or desktop).
Enter the passcode, tap the mic, and speak.

## Bridge API

All endpoints (except `/health`) require `Authorization: Bearer <BRIDGE_TOKEN>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/readFile` | Read a file `{ path }` |
| POST | `/search` | Search code `{ query, root?, glob? }` |
| GET | `/git/status` | Git status |
| GET | `/git/diff` | Git diff (staged + unstaged) |
| POST | `/run` | Run allowlisted command `{ commandName }` |
| POST | `/patch/prepare` | Stage a patch `{ diff }` → returns `patchId` |
| POST | `/patch/apply` | Apply a patch `{ patchId }` (needs confirmation) |

## Security

- Bridge binds to `127.0.0.1` only — not accessible from the network
- Shared token auth on all bridge endpoints
- Path traversal prevention on file reads
- Command allowlist — only `test`, `lint`, `build`
- Audit log of all bridge calls in `dev-assistant/audit.log`

## Tests

```bash
npx tsx --test tests/*.test.ts
```

## Confirmation Flow

When Claude needs to do something destructive (like applying a patch), the orchestrator pauses and sends a confirmation to the client. The client shows big tap-friendly buttons. You respond by tapping or speaking, and the operation proceeds or cancels.
