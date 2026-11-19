<div align="center">

<h1>NOONCHI (twin-home)</h1>

**A server that lets the home robot CLOiD watch the home, 
learn people's habits, plan tasks ahead, and guide people through them**

noonchi-home | Software Engineering 26-2

![Node.js](https://img.shields.io/badge/Node.js-22-5FA04E?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![three.js](https://img.shields.io/badge/three.js-r187-000000?logo=threedotjs&logoColor=white)
![Matter](https://img.shields.io/badge/matter.js-0.17-1A1A1A)
![Redis](https://img.shields.io/badge/Redis-8.10-FF4438?logo=redis&logoColor=white)
![MCP](https://img.shields.io/badge/MCP_SDK-1.32-D97757)
![OpenAI](https://img.shields.io/badge/OpenAI_SDK-7-412991?logo=openai&logoColor=white)

</div>

---

### Introduction

[twin-studio](https://github.com/noonchi-home/twin-studio) builds the 3D model and scene of each home. This repository loads one home and runs CLOiD's brain: it follows what the person does with a person-state FSM, plans the next task ahead, and guides the person step by step on the real phone.

| Stage | What it does | Where it shows |
|---|---|---|
| **See** | The real phone is CLOiD's eye. A VLM reads the last 5 photos for objects, what is in hand, and what the person is doing. YOLO draws object shapes, helps place the phone, and tracks pose and falls. | Vision minimap |
| **Know** | World State merges vision, the home scene and device states into one observation text. The person-state FSM holds one activity (eating or drinking, watching TV, cooking, away). | Person label, timeline person lane |
| **Decide** | Every 5 s PAM reads only the text and answers the person state, the transition, and its action. Habits are learned every night. The goal machine plans ahead, and the manager picks work in the order safety > voice request > goal > idle. | Message box, mode bubble, ring and faded route on the twin |
| **Act** | Only the robot machine sends phone commands, one per step, and checks each step with vision and phone position. The safety machine handles falls and risky devices. | Real phone, numbered route, timeline robot lane |

Example: the person drinks, then leaves the cup. The prepared plan starts and the phone shows "Go to the table" → "Pick up the cup" → "Go to the sink" → "Put the cup in the sink", then "Go to the charging spot".

Clearing the cup is a learned habit: before learning, CLOiD asks first; after the adoption test passes, it clears without asking (from day 3 in the synthetic week).

---

### 1. Features

#### 01. Dashboard

- The 3D twin fills the screen, with the vision minimap, mascot, message box and timeline card on top. No input box.
- A plan shows as a numbered route (①②③④) on the twin. A goal shows as a small red ring on the object and a faded prepared route.
- The message box speaks in CLOiD's own words, built only from facts. The timeline card shows person and robot lanes and the time from the person leaving to the first command.
- `?view=minimap` shows only the vision minimap.

#### 02. Real phone: CLOiD's eyes and hands

- Android Chrome with WebXR AR. Press "Start here" once at the start spot; the server then aligns the phone with walls and large furniture.
- Top: mascot and the current command. Bottom: vision status and a "Done" button.
- Commands are read aloud and questions can be answered by voice. A suspected fall asks "Are you okay?" twice; no voice answer means emergency.
- Approval is asked only for risky actions (unlocking the front door, changing the induction or microwave).

#### 03. Nightly reflection and adoption test: learning habits

- Every night (`REFLECT_AT`, default 23:30): records → reflection (candidate FSM) → code and LLM checks → adoption test → robot FSM.
- Adoption test (`src/brain/pam/adopt.ts`): followed within 300 s at 75% or more, and one-sided binomial p < 0.001.
- Learned habits: clearing the cup, and turning on the AC when the TV starts silently. Fixed habits always stay.

#### 04. Voice requests

- Tasks not in memory can be asked by voice; plan mode builds the plan and the robot machine runs it (e.g. a ramen coach plan).
- Device commands ("Turn on the living room light") run right away.

#### 05. Video tests

- `/phone/?clip=<file>` plays a video from `runtime/videos/` instead of the camera; everything else is the same as the real phone.
- `scripts/video-check.ts` plays it to the end in headless Chrome and writes a timeline and verdict. `--record-view minimap` records the minimap at 1280×720.

#### 06. Setup (`/setup/`)

<img src="docs/screenshot-setup.webp" alt="Setup screen: the mascot at the bottom left asks which home to use, with home cards in the thought bubble" />

- Four steps: home, devices, run mode, position sync. In position sync, tap the twin floor to choose the start spot and its direction.

#### 07. Virtual Matter devices and homes

- Home devices run as one matter.js bridge. In real mode, paired devices move real devices through ThinQ.
- Pick the home with `HOME_ID` or in setup (Hanyang Mokryeon 180B, Magok Botanic, one-room example).
- An MCP server exposes device tools to Claude Code or Claude Desktop.

---

### 2. Repository structure

| Folder | Contents |
|---|---|
| `src/` | Server (Node.js 22), split by domain |
| `ui/` | Dashboard, setup and phone pages (React) |
| `twin/` | Home assets and 3D twin |
| `models/` | YOLO models (ONNX) |
| `scripts/` | Checks, video tests, demo setup |
| `tests/` | Server tests (Vitest) |
| `deploy/` | Dockerfile and compose files |
| `docs/` | Contracts and reference |
| `web/` | Video encoding worker |

#### Server domains (`src/`)

Domains import each other only through their entry (`index.ts`) and only in the allowed direction (`npm run lint`).

| Domain | What it does |
|---|---|
| `bus` | Topics and QoS, memory or Redis bus |
| `devices` | Virtual Matter devices, ThinQ, device registry |
| `layout` | Home scene, floor plan, paths, charging spot |
| `world` | World State and observation text |
| `phone` | Phone server, position sync |
| `observe` | YOLO, VLM, close-up looks |
| `brain` | PAM, person-state FSM, memory, nightly reflection |
| `agent` | LLM agent, plan mode, approval, MCP |
| `safety` · `goal` · `manage` | Safety machine, goal machine, manager |
| `act` | Robot machine and phone commands |
| `record` · `server` | Records, HTTP and WebSocket |

Shared layers: `src/contract/` (types), `src/shared/` (helpers), `src/infer/` (model APIs), `src/design/` (design tokens).

#### Four machines and the manager

| Machine | Where | States |
|---|---|---|
| Person-state FSM | `src/brain/person.ts` | The person's activity |
| Goal machine | `src/goal/` | armed → planning → ready → started → done / dropped |
| Robot machine | `src/act/robot/` | idle, observe, move, run, return, recover |
| Safety machine | `src/safety/` | normal → suspect → emergency |
| Manager | `src/manage/` | safety, request, goal, idle; mode noonchi or coach |

#### Flow between nodes

`phone` → `perception` → `world` → `brain` → `goal` · `safety` → `manager` → `act` → `phone` → real phone. All topics are in `src/bus/topics.ts`.

#### UI (`ui/src`)

| Folder | Page |
|---|---|
| `dashboard` | Dashboard (`/`) |
| `twin` | three.js 3D twin |
| `setup` | Setup (`/setup/`) |
| `phone` | Phone page (`/phone/`) |
| `components/ui` | 21st.dev components |

---

### 3. Development tools

- Claude Code (Claude Opus 5.5)

### 4. Platform

- Node.js server and web pages, Android Chrome phone page (iPhone Safari has no WebXR AR)
- Windows 11, Docker Compose (server, GPU server, Redis)

---

<details>
<summary><b>Run locally</b></summary>

Node.js 22.15 is required.

```bash
npm install
npm --prefix ui install
cp .env.example .env   # OPENAI_API_KEY
npm start              # http://127.0.0.1:8200
```

- Full pipeline with the phone: `BRAIN=1 PHONE_PORT=8210 npm start`, then open the phone page from the QR in settings.
- Inference mode `INFERENCE_MODE`: `openai` (development) or `vllm` (GPU server). Both run the same code.
- Redis bus (optional): `docker compose -f deploy/compose.dev.yaml up -d redis`, then `REDIS_URL=redis://127.0.0.1:6379`.
- Server: `docker compose --env-file .env -f deploy/compose.yaml up -d --build`. GPU server: add `--profile gpu` ([deploy](docs/deploy.md)).

| Command | What it does |
|---|---|
| `npm start` | Build the UI and run the server (8200) |
| `npm test` | Server and UI tests |
| `npm run lint` | UI rules and domain boundaries |
| `npm run typecheck` | Server type check |
| `npm run heavy -- <command>` | Run one heavy job at a time |

</details>

<details>
<summary><b>Docs</b></summary>

- [Contract](docs/plan.md), [Reference](docs/reference.md), [Deploy](docs/deploy.md)
- [PAM interface](docs/pam-interface.md), [Plan contract](docs/plan-contract.md), [World State vocabulary](docs/world-vocabulary.md)
- [3D twin](docs/twin3d.md), [View switch](docs/view-switch.md)

</details>
