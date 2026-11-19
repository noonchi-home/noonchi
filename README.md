# A Proactive Agentic Home for CLOiD Combining Active Observation and Behavior Prediction

**Group: Blitz** · Software Engineering 26-2

![Node.js](https://img.shields.io/badge/Node.js-22-5FA04E?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![three.js](https://img.shields.io/badge/three.js-r187-000000?logo=threedotjs&logoColor=white)
![Matter](https://img.shields.io/badge/matter.js-0.17-1A1A1A)
![Redis](https://img.shields.io/badge/Redis-8.10-FF4438?logo=redis&logoColor=white)
![MCP](https://img.shields.io/badge/MCP_SDK-1.32-D97757)
![OpenAI](https://img.shields.io/badge/OpenAI_SDK-7-412991?logo=openai&logoColor=white)

## Abstract

NOONCHI is a prototype of the decision-making part (the brain) of CLOiD, LG's home robot. Without being told, it notices moments in daily life when the resident could use help, checks what it doesn't know yet, and then plans and carries out the action that fits the resident.

**Keywords:** active observation, behavior prediction, person-state FSM, digital twin, proactive agent

---

## I. Introduction

### A. Motivation

A camera spotting a cup is no reason to clear it right away. There may be a drink left, or the resident may use it again. An induction cooktop being on while the resident is out of the kitchen is no reason to switch it off right away either. They may have stepped into the living room for a moment while cooking.

Even with the same objects and appliances, the right action depends on the resident's intent, activity, and schedule. Repeating the same action whenever fixed conditions hold, or waiting for commands, can't handle that difference. On the other hand, a system that asks about everything becomes a burden instead of a help.

### B. Problem Statement

> **Without a command, can the system notice a moment in daily life when help is needed, check the information it lacks, and plan and carry out an action that fits the resident?**

- **Does it notice first?** It judges whether help is needed from the situation, not only from direct commands.
- **Does it plan for the situation?** It combines the actions it can take into a plan, even in situations it has not seen before.
- **Does it check what it doesn't know?** It confirms what the decision needs and cuts unnecessary questions and interventions.
- **Does it act as the resident wants?** It follows the resident's current intent and allowed range, and reuses information it already confirmed while it still holds.

### C. What We Want to See at the End

1. **Observation:** YOLO26 and a VLM analyze photos from the real phone camera.
2. **State:** World State merges objects, people, appliances, and the phone's position into one picture.
3. **Behavior prediction:** PAM uses the person-state FSM to predict the person's next activity and picks the task.
4. **Execution:** the real phone gets one command per step, and vision and phone position confirm each step.
5. **Learning:** every night, the day's records teach habits that the next day's decisions use.

---

## II. Datasets

- **Real videos:** three landscape videos filmed in the living room and kitchen of Hanyang Mokryeon 180B (a glass mug, a white mug, a tall glass). Each is cut into five clips (leave → go to the table → pick up the cup → go to the sink → put it in the sink) for the video tests.
- **Synthetic records:** one person's week of daily-life records. Every line is marked as synthetic. They are used to test nightly reflection and the adoption test.
- **PAM routine experiment videos:** two routines (study and evening) filmed for two days each (박석준). They compare PAM's action choices with and without memory.

---

## III. Methodology

### A. System Architecture

```text
Real phone (camera photos · position · voice)
  │  Tailscale (HTTPS · WSS)
  ▼
Observation: YOLO26 · VLM
  ▼
World State: objects · people · appliances · phone position → observation text
  ▼
Behavior prediction: PAM + person-state FSM
  ▼
Goal · manager: plan prepared ahead, task order
  ▼
Execution · checks: step commands to the real phone, appliances (Matter · ThinQ)
  │
  ├─▶ Record DB ─▶ nightly reflection · adoption test ─▶ next day's FSM
  └─▶ Dashboard (3D twin)
```

| Component | What it does |
|---|---|
| Real phone (CLOiD's eyes) | Sends camera photos and its position, and shows and reads out the step commands from the server to the person |
| noonchi server (CLOiD's brain) | Sees with YOLO and the VLM, merges the home state in World State, decides with PAM, and runs and checks the plan |
| Dashboard | Shows how CLOiD sees and decides, on top of the 3D twin |
| Person (CLOiD's hands and feet) | Moves as the phone commands |

The noonchi server (`src/`) is split into these domains.

| Domain | Core function |
|---|---|
| `observe` | Reads objects and what the person is doing from photos |
| `world` | Merges the current home state into one |
| `brain` | Follows the person's state and learns habits |
| `goal` | Prepares tasks ahead of time |
| `manage` | Picks what to do first |
| `act` | Guides the person step by step on the phone and checks each step |
| `safety` | Watches for falls and risky appliances |
| `agent` | Turns voice requests into plans |
| `phone` | Connects to the phone and aligns its position |
| `devices` | Operates appliances |
| `layout` | Knows the home's layout and paths |
| `bus` · `record` · `server` | Node links, records, server |

### B. Observation: YOLO26 and the VLM

The phone sends a photo and its WebXR pose at that moment every 0.1 s. YOLO26s-seg finds the shapes of people, objects, and fixtures in every photo, and YOLO26n-pose reads posture when a person is visible. Every 2 s, the VLM looks at the latest five photos together and answers only visible facts, such as where objects are, what is in hand, and what the person is doing. The person's intent is judged by PAM, not the VLM. When a small or transparent object isn't found, the server crops that spot and looks again up close.

### C. World State

World State merges the YOLO and VLM results, the home scene, appliance states, and the phone position. Each object is placed where a ray cast from its bottom point in the photo meets a surface of the twin (table, sink, floor). Every fact is marked confirmed, guessed, or unknown, and it becomes confirmed only after the same value repeats. World State turns this into timestamped observation text for PAM. PAM never receives photos.

### D. Behavior Prediction: Person-State FSM and PAM

Memory is a person-state FSM. A state is one thing the person is doing (drinking, watching TV, cooking, away), a transition is that activity changing into another, and actions sit only on transitions. Every 5 s, PAM reads the observation text and the FSM and answers the person's current state and the transition that happened. The server takes that transition's action as the task. Object conditions (whether a cup is there, what is in it) are not in the FSM; the pre-run check handles them.

### E. Plans Prepared Ahead and Step Execution

The goal machine reads the action on the transition leaving the current state and prepares the plan ahead of time. For example, it builds the cup-clearing plan while the person is drinking and starts it as soon as the person leaves and the state changes. The manager picks work in the order safety > voice request > goal > idle. The robot execution machine sends the real phone one command per step ("Go to the table" → "Pick up the cup" → "Go to the sink" → "Put the cup in the sink"), and sends the next command only after World State and the phone position show the step is done. On a suspected fall, the safety machine goes to the person and asks; with no spoken answer, it raises an emergency.

### F. Habit Learning: Nightly Reflection and the Adoption Test

Once a day, the day's records are grouped into activity chunks, and PAM reflection proposes a candidate FSM. Each candidate passes a code check (shape) and an LLM check (meaning), then the adoption test. If the person did that task within 300 s after the candidate's trigger at least 75% of the time, with a one-sided binomial test p < 0.001, the candidate is adopted into the next day's FSM. Before a habit is learned, CLOiD asks first; after adoption, it acts without asking.

### G. Screens People See

- **Real phone:** the mascot and the current command at the top; the vision status line and a "Done" button at the bottom. Commands are read aloud, and questions can be answered by voice.
- **Dashboard:** the 3D twin fills the screen, with the vision minimap, the message box, and the person and robot timeline on top. A plan shows as a numbered route on the twin, and a goal as a red ring on the object and a faded route drawn ahead. There is no input box.

---

## IV. Evaluation & Analysis

**Video tests.** Each real video is played to the end in video mode and sent to the server the same way as the real phone; the command order and the plan's end are judged.

| Video | Verdict | First command after the person leaves |
|---|---|---|
| Glass mug | Pass | 3.5 s |
| Tall glass | Pass | 3.2 s |
| White mug | Pass | 1.9 s |

**PAM routine experiment.** Action-choice F1 (1 is perfect) on the same videos.

| Day | With memory (FSM) | Without memory |
|---|---|---|
| Study, day 2 | 0.41 | 0.04 |
| Evening, day 1 (routine changed) | 0.27 | 0.00 |
| Evening, day 2 | 0.25 | 0.08 |

**Metrics.** Over-intervention (actions or questions that should not happen), misses, overconfidence (confirmed but wrong facts), correct unknowns (answering unknown when not visible), observation latency (photo → decision), and decision latency.

---

## V. Related Work

**PAM.** Lee et al.'s Procedural Assistance Memory keeps a person's routine as FSM memory and revises it with end-of-day reflection. We port the paper's prompts as they are, but feed World State observation text instead of photos, define states as what the person is doing, and use only habits that pass the adoption test.

**Smart home routines.** Today's smart home routines run the same action when conditions the user set are met. NOONCHI predicts the person's next activity to plan ahead, checks what it doesn't know, and waits while the person is still using something.

**Tools and libraries used.** onnxruntime, vLLM, SQLite, Docker, Tailscale, LG ThinQ.

---

## VI. Conclusion: Discussion

**Limitations.**

- It does not move a real robot. The phone stands in for the eyes and a person for the hands and feet, and travel time is not part of the decision.
- It handles one home and one person. Conflicting habits between several people are out of scope.
- The models are not trained; only the memory changes.

**Future work.**

- Predict and compare the results of acting and waiting with a twin simulator
- Extend to scenarios such as induction safety and coming home after being away
- Train a model separately on reviewed experience and compare it with the fixed model

---

## Team Roles

| Name | Responsibilities |
|---|---|
| 허정오 | Scrum master; noonchi server, real-phone AR, 3D twin, dashboard |
| 박석준 | PAM decisions and reflection, adoption test, routine experiment |
| 김준형 | PAM code, model research |
| 신지훈 | Security architecture |

---

## Repository Structure

```text
.
├── README.md
├── src/          # server (Node.js 22, domains in the III-A table)
├── ui/           # dashboard · setup · phone pages (React)
├── twin/         # home assets and 3D twin
├── models/       # YOLO26 ONNX
├── scripts/      # checks, video tests, demo setup
├── tests/        # server tests (Vitest)
├── deploy/       # Dockerfile, compose
└── docs/         # contracts and reference docs
```

---

## References

- D. Lee, M. Park et al., *An Agentic Framework for Proactive Robots with Procedural Assistance Memory*, arXiv:2610.21211.
- Ultralytics, *YOLO26*.
- Qwen Team, *Qwen3-VL*, *Qwen3.5*.
- W3C, *WebXR Device API*, *WebXR Raw Camera Access*.
- Connectivity Standards Alliance, *Matter 1.4*.

---

## Getting Started

```bash
npm install
npm --prefix ui install
cp .env.example .env   # OPENAI_API_KEY
npm start              # http://127.0.0.1:8200
```

GPU server deployment: `docker compose --env-file .env -f deploy/compose.yaml --profile gpu up -d --build` ([deployment guide](docs/deploy.md))
