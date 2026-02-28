# SmartDev — Voice Dev Assistant

## Project Overview
Voice-controlled dev assistant: talk to Claude from any device while connected to a local workspace. Three components in an npm workspace monorepo.

## Tech Stack
- Node.js + TypeScript (bridge, orchestrator)
- Plain HTML/CSS/JS (voice client, no build step)
- Express + ws (WebSocket)
- @anthropic-ai/sdk (Claude integration)
- Web Speech API (browser STT)
- npm workspaces monorepo

## Getting Started
```bash
npm install

# Terminal 1 — bridge
cd apps/local-bridge && cp ../../.env .env && npm run dev

# Terminal 2 — orchestrator
cd apps/orchestrator && npm run dev

# Open http://localhost:7800
```

## Project Structure
- `apps/local-bridge/` — Secure bridge on 127.0.0.1:7700 (file read, search, git, run, patch)
- `apps/orchestrator/` — WebSocket server on :7800 + Claude API + serves voice client
- `apps/voice-client/` — Static HTML/JS app with push-to-talk mic + confirmation buttons
- `dev-assistant/` — Persistence (audit.log, context.json, session-notes.md)
- `tests/` — Confirmation parser + allowlist tests

## FORMAL CONFIRMATION POLICY (MUST IMPLEMENT)
You proceed autonomously EXCEPT you MUST STOP and request confirmation before:
1) Production deploy / release actions
2) Changing environment variables or secrets
3) Database migrations/schema changes
4) Destructive actions (delete/rename many files, irreversible steps)
5) Changes that alter user-visible behavior (routes/nav/auth/pricing/content structure)
6) Enabling paid services or anything with cost impact
7) Security-sensitive logic changes (auth/session/ACL/CSP)
8) Any action hard to rollback

## Conventions
- Follow existing code style and patterns
- Write clear, concise commit messages
- Keep changes focused and minimal
- Bridge: all new endpoints need audit logging
- Client: no build step — plain JS only
