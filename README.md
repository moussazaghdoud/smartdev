# SmartDev — Voice Dev Assistant

Talk to Claude from any device while it stays connected to your VS Code workspace.

## Architecture

```
[Phone / Browser]  ──HTTPS──▶  [Railway: Orchestrator + Voice Client]
                                        ▲
                                 WebSocket (outbound)
                                        │
                                [Your PC: Local Bridge]
                                        │
                                 [Your Repo on disk]
```

- **Orchestrator** (cloud/Railway) — Express + WebSocket server. Hosts voice client, routes messages between client ↔ Claude ↔ bridge. Handles confirmations.
- **Voice Client** (cloud, served by orchestrator) — Plain HTML/CSS/JS. Push-to-talk mic (Web Speech API), text input, confirmation buttons. Mobile-first.
- **Local Bridge** (your dev machine) — Connects *outbound* to the orchestrator via WebSocket. Reads files, searches code, git status/diff, runs allowlisted commands, prepares/applies patches. Audit-logged.

**You only run one thing locally: the bridge.** Everything else is in the cloud.

## Setup

### 1. Deploy Orchestrator on Railway

Set these environment variables on your Railway service:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
BRIDGE_TOKEN=some-random-secret
CLIENT_PASSCODE=dev123
PORT=7800
```

Railway will auto-detect the monorepo. Point it to the `apps/orchestrator` root path.

### 2. Run Bridge Locally

```bash
npm install
```

Create `apps/local-bridge/.env`:
```
ORCHESTRATOR_URL=wss://your-railway-app.up.railway.app
BRIDGE_TOKEN=same-secret-as-orchestrator
PROJECT_ROOT=C:\Users\you\your-project
```

Start the bridge:
```bash
cd apps/local-bridge
npm run dev
```

The bridge connects outbound to Railway — no ports to open, no tunnels needed.

### 3. Open from Any Device

Go to `https://your-railway-app.up.railway.app` on your phone or desktop.
Enter the passcode, tap the mic, and speak.

## Bridge Tools

The bridge exposes these tools to Claude (via WebSocket, not HTTP):

| Tool | Description |
|------|-------------|
| `read_file` | Read a file from the project |
| `search_code` | Search text across project files |
| `git_status` | Git branch + status |
| `git_diff` | Staged + unstaged diffs |
| `run_command` | Run allowlisted command (test/lint/build only) |
| `patch_prepare` | Stage a unified diff for review |
| `patch_apply` | Apply a prepared patch (requires confirmation) |

## Security

- Bridge makes outbound connections only — no open ports
- Shared `BRIDGE_TOKEN` authenticates the bridge ↔ orchestrator link
- Path traversal prevention on all file reads
- Command allowlist — only `test`, `lint`, `build`
- Audit log of all bridge calls in `dev-assistant/audit.log`

## Tests

```bash
npx tsx --test tests/*.test.ts
```

## Confirmation Flow

When Claude needs to do something destructive (like applying a patch), the orchestrator pauses and sends a confirmation to the voice client. Big tap-friendly buttons appear. You respond by tapping or speaking, and the operation proceeds or cancels.
