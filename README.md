# NOONCHI (twin-home)

A server for the home robot CLOiD. It watches the home through a phone camera, learns the resident's habits, plans the next task ahead of time, and guides the person through it step by step on the phone.

noonchi-home · Software Engineering 2026-2 · home models from [twin-studio](https://github.com/noonchi-home/twin-studio)

## How it works

1. **See:** the phone is CLOiD's eye. A VLM reads objects and what the person is doing. YOLO draws object masks, helps place the phone, and tracks pose for falls.
2. **Know:** World State merges vision, the home scene and device states into one observation text.
3. **Decide:** PAM reads only that text and follows a person-state FSM (drinking, watching TV, cooking, away). Actions live on its transitions. Habits are learned every night and kept only if they pass an adoption test (75% and p < 0.001).
4. **Act:** one robot machine sends the phone one command per step and checks each step with vision and phone position. A safety machine handles falls and risky devices.

Example: the person drinks, then leaves the cup. Within a few seconds the phone says "Go to the table" → "Pick up the cup" → "Go to the sink" → "Put the cup in the sink".

## Quick start

```bash
npm install
npm --prefix ui install
cp .env.example .env   # set OPENAI_API_KEY
npm start              # http://127.0.0.1:8200
```

With the phone and the full pipeline: `BRAIN=1 PHONE_PORT=8210 npm start`, then scan the QR code in settings with Android Chrome (WebXR AR).

## Deploy

```bash
docker compose --env-file .env -f deploy/compose.yaml up -d --build
docker compose --env-file .env -f deploy/compose.yaml --profile gpu up -d --build
```

The first runs the server with Redis. The second also starts the two vLLM servers (VLM and PAM). See [docs/deploy.md](docs/deploy.md).

## Commands

| Command | What it does |
|---|---|
| `npm start` | Build the UI and run the server (port 8200) |
| `npm test` | Server and UI tests |
| `npm run lint` | UI rules and domain boundaries |
| `npm run typecheck` | Server type check (the UI is checked by `npm run ui:build`) |
| `npm run heavy -- <command>` | Run one heavy job at a time (3D, tests, builds) |

## Repository

| Folder | Contents |
|---|---|
| `src/` | Server (Node.js 22), one folder per domain: `observe`, `world`, `brain`, `goal`, `safety`, `manage`, `act`, `phone`, `devices`, `layout`, `agent`, `bus`, `record`, `server` |
| `ui/` | Dashboard, setup and phone pages (React) |
| `twin/` | Home assets and 3D twin |
| `models/` | YOLO models (ONNX) |
| `scripts/` | Checks, video tests, demo setup |
| `tests/` | Server tests (Vitest) |
| `deploy/` | Dockerfile and compose files |
| `docs/` | Contracts and reference |
| `web/` | Video encoding worker |

Built with Node.js, TypeScript, React, three.js, matter.js, Redis and MCP, using Claude Code. Reference: [docs/reference.md](docs/reference.md).
