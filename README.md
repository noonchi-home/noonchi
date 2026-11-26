# Proactive Home Robot System with Procedural Assistance Memory-based RL

LG electronics · Software Engineering 26-2

![Node.js](https://img.shields.io/badge/Node.js-22-5FA04E?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![three.js](https://img.shields.io/badge/three.js-r187-000000?logo=threedotjs&logoColor=white)
![Matter](https://img.shields.io/badge/matter.js-0.17-1A1A1A)
![Redis](https://img.shields.io/badge/Redis-8.10-FF4438?logo=redis&logoColor=white)
![MCP](https://img.shields.io/badge/MCP_SDK-1.32-D97757)
![OpenAI](https://img.shields.io/badge/OpenAI_SDK-7-412991?logo=openai&logoColor=white)

## Overview

NOONCHI is a proactive home robot system: a prototype of the decision-making part (the brain) of CLOiD, LG's home robot. Without being told, it notices moments in daily life when the resident could use help, checks what it doesn't know yet, and then plans and carries out the action that fits the resident.

It learns two things. Procedural Assistance Memory (PAM) keeps the resident's routine as an FSM and learns **what** to help with. Reinforcement learning (RL) uses that FSM as its environment model and learns **when** to help.

**Keywords:** proactive home robot, Procedural Assistance Memory (PAM), reinforcement learning, person-state FSM, intervention timing, digital twin

---

## I. Background

### A. Why It Matters

A camera spotting a cup is no reason to clear it right away. There may be a drink left, or the resident may use it again. An induction cooktop being on while the resident is out of the kitchen is no reason to switch it off right away either. They may have stepped into the living room for a moment while cooking.

Even with the same objects and appliances, the right action depends on the resident's intent, activity, and schedule. Repeating the same action whenever fixed conditions hold, or waiting for commands, can't handle that difference. On the other hand, a system that asks about everything becomes a burden instead of a help.

### B. The Question

> **Without a command, can the system notice a moment in daily life when help is needed, check the information it lacks, and plan and carry out an action that fits the resident?**

- **Does it notice first?** It judges whether help is needed from the situation, not only from direct commands.
- **Does it plan for the situation?** It combines the actions it can take into a plan, even in situations it has not seen before.
- **Does it check what it doesn't know?** It confirms what the decision needs and cuts unnecessary questions and interventions.
- **Does it act as the resident wants?** It follows the resident's current intent and allowed range, and reuses information it already confirmed while it still holds.
- **Does it pick the right moment?** It learns from the resident's reactions whether to wait, look again, ask, or act.

### C. Goals

1. **Observation:** YOLO26 and a VLM analyze photos from the real phone camera.
2. **State:** World State merges objects, people, appliances, and the phone's position into one picture.
3. **Behavior prediction:** PAM identifies the person's current activity and the transition in the FSM. The server reads the task attached to that transition.
4. **Execution:** the phone shows one instruction at a time. Each step advances on its own evidence, such as a visual check, the phone's position, an appliance signal, or the resident's answer.
5. **Learning:** every night, the day's records teach habits (PAM reflection) and intervention timing (RL) that the next day's decisions use.

---

## II. Data

- **Real videos:** three landscape videos filmed in the living room and kitchen of Hanyang Mokryeon 180B (a glass mug, a white mug, a tall glass). Each is cut into five clips (leave → go to the table → pick up the cup → go to the sink → put it in the sink) for the video tests.
- **Synthetic records:** one person's week of daily-life records. Every line is marked as synthetic. They are used to test nightly reflection and the adoption test.
- **PAM routine experiment videos:** two routines (study and evening) filmed for two days each (박석준). They compare PAM's action choices with and without memory.

---

## III. How It Works

### A. Architecture

![NOONCHI System Architecture](docs/architecture/architecture.svg)

The November 25 architecture notes explain the two C4 diagrams of the target architecture and list where the current code still differs. [Architecture diagram notes](docs/architecture/architecture-notes.md)

The November 24 guides follow Android pairing, camera startup, and a checked instruction from the hub to the phone and back. [Android app architecture](docs/architecture/android-app-system.md) · [WebXR step round trip](docs/architecture/webxr-roundtrip.md)

```text
Real phone (Expo setup · Chrome WebXR camera · Web Speech API)
  │  Tailscale (HTTPS · WSS)
  ▼
Observation: YOLO26 (ONNX Runtime) · VLM (OpenAI API or Qwen3-VL on vLLM)
  ▼
World State: objects · people · appliances · phone position → observation text (Node.js / TypeScript)
  ▼
Behavior prediction: PAM + person-state FSM (OpenAI API or Qwen3.5-27B on vLLM)
  ▼
Goal · manager: plan prepared ahead, task order (Redis or in-memory messaging)
  ▼
Execution · checks: step commands to the real phone, appliances (Matter via matter.js · LG ThinQ API · USB infrared TV hub)
  │
  ├─▶ Record DB (SQLite) ─▶ nightly reflection · adoption test ─▶ next day's FSM
  │                      └▶ FSM as environment model ─▶ simulator · Q-learning ─▶ next day's timing policy
  └─▶ Dashboard (live vision · three.js twin · action conditions · Agent Trace)
```

| Component | What it does |
|---|---|
| Real phone (CLOiD's eyes) | The Android app pairs with the hub by QR and manages home setup. The WebXR session sends camera frames and its position, shows and reads server instructions, and accepts spoken or tapped answers. |
| noonchi server (CLOiD's brain) | Sees with YOLO and the VLM, merges the home state in World State, decides with PAM, and runs and checks the plan |
| Dashboard | Displays live vision, the digital twin, action conditions, and the automatically grouped public Agent Trace. |
| Person (CLOiD's hands and feet) | Moves as the phone commands |

The server's decision, goal, manager, and execution nodes exchange messages over Redis when `REDIS_URL` is set, or over an in-memory bus otherwise. The table lists the main domains in `src/`.

| Domain | Core function |
|---|---|
| `observe` | Reads objects and what the person is doing from photos |
| `world` | Merges the current home state into one |
| `brain` | Follows the person's state, learns habits and intervention timing |
| `goal` | Prepares tasks ahead of time |
| `manage` | Picks what to do first |
| `act` | Guides the person step by step on the phone and checks each step |
| `machines` | Reports robot, goal, manager, and safety state. Fall detection lives in `world`, and `act` tracks risky appliances until they are confirmed off |
| `agent` | Turns voice requests into plans |
| `phone` | Connects to the phone and aligns its position |
| `devices` | Operates appliances |
| `layout` | Knows the home's layout and paths |
| `bus` · `record` · `server` | Node links, records, server |

### B. Observation: YOLO26 and the VLM

By default, the phone sends a photo and its WebXR pose every 0.1 s. YOLO26s-seg supplies shapes for the minimap, and YOLO26n-pose estimates posture when a person is visible. The VLM normally samples a frame every 2 s and reads up to five together to identify objects, what is in hand, and what the person is doing. When looking for an object or inspecting a cup, the server can shorten the sampling interval to 1 s and crop the target for a closer look.

### C. World State

World State combines observations with the home layout, appliance signals, and the phone's position. For movable objects such as cups, the VLM determines what is present. In the full-scene view, two distinct frames can confirm a new object. Three later frames that show its spot without the object can mark it gone. The server estimates its position where a ray from the object's base meets a surface in the twin. It sends PAM timestamped text that distinguishes confirmed, guessed, and unknown facts.

### D. Behavior Prediction: Person-State FSM and PAM

Memory is a person-state FSM. A state is one thing the person is doing (drinking, watching TV, cooking, away), and a transition can carry a robot action. In periodic mode, the default decision interval is 1 s for nano models and 5 s for other models. PAM reads the observation text and the FSM and reports the current state and any transition it observed. The server looks up the action on that transition and checks the relevant objects before execution.

### E. Plans Prepared Ahead and Step Execution

Once CLOiD has learned to clear the cup, the goal node can request a plan while the person is still drinking. When the person leaves, PAM is prompted to decide again. If the decision calls for clearing the cup, the server rechecks the prepared plan against the current cup and its location before sending the first command. The manager gives priority to safety, then voice requests, goals, and idle work.

The phone guides the person to the table to show the inside of the cup. Once two clear overhead views confirm it is empty, the phone asks the person to pick up the cup, go to the sink, and put the cup in the sink, one instruction at a time. If a drink remains, CLOiD asks whether to discard it. If the contents stay unknown, it stops the plan. A suspected fall immediately puts the system in the emergency state. When a plan turns on a risky appliance, tracking continues until there is evidence it is off.

### F. Learning: Nightly Reflection, the Adoption Test, and Timing RL

Once a day, the day's records are grouped into activity chunks, and PAM reflection proposes a candidate FSM. Each candidate passes a code check (shape) and an LLM check (meaning), then the adoption test. If the person did that task within 300 s after the candidate's trigger at least 75% of the time, with a one-sided binomial test p < 0.01, the candidate is adopted into the next day's FSM. If it does not pass as is, the code looks for a weekday and/or a 3-hour time slot that makes it pass (none, then one, then two contexts, compared with the rate without the context), so a Saturday-only habit becomes a Saturday-only edge; by day, only the edges whose context matches right now are shown to PAM. Before the cup-clearing habit is learned, CLOiD asks whether to clear the cup. Learning that habit lets it clear a confirmed empty cup without asking. Risky appliance commands still require approval.

The server records execution and the person's response separately. It can distinguish verified help, a declined offer, a person doing the task themselves, and an unknown response. [Assistance outcome contract](src/contract/assistance-outcome.ts)

**PAM-based RL.** The habit FSM says what to help with. When to help is a reinforcement learning problem built on the same FSM.

- **Environment model:** the PAM FSM plus, for each transition, its probability, how long it takes, and how the person reacted to each robot action.
- **State:** time since the person left, whether and where the person is seen, what is in the cup, time of day, and how many checks were already made.
- **Actions:** wait, look at the table again, find the person, ask, act.
- **Reward:** the person's reaction. Accepted help scores up. A declined offer, clearing something the person comes back for, and help the person had to do themselves score down. Questions and extra checks carry a small cost.
- **Training:** every night, a simulator built from the environment model runs tabular Q-learning. The new policy replaces yesterday's only if it scores higher in the same simulated episodes without more wrong clears.
- **Use:** during the day the policy is fixed. While checking after the person leaves, the goal node picks the allowed action with the highest value.

Safety and permission stay rules that the policy cannot change: the 5-minute limit on checking, no clearing while the person holds or uses the object, turning the TV off within 5 s of everyone leaving, and approval for risky appliances. Direct requests use their own execution rules.

### G. Screens People See

- The **Android app** scans the dashboard's HTTPS `/mobile/` QR, verifies the hub, and opens native Home, House Management, and Settings. Register a supported home, confirm the prepared floor plan, and save or review its reference photos. Configure appliances, the starting pose, and observation stations on the phone. [Android guide](apps/android/README.md)
- The **camera** opens at the hub's configured HTTPS `/phone/` address in a Chrome Trusted Web Activity (TWA) after Digital Asset Links verification. Tap the camera control on the page to start WebXR. The hub's HTTPS `/mobile/` web portal can also start WebXR directly. With a supported browser and permissions, the phone reads new instructions in Korean and accepts spoken answers or requests. A reconnect restores the current instruction silently. Available answer buttons remain on the phone.
- On the **dashboard**, Vision and Digital Twin sit above Action Conditions and Agent Trace. The conditions distinguish confirmed evidence, the current check, and the next step in the active plan. The trace groups public records by activity and expands related tool calls automatically. [Server and phone reference](docs/reference.md#dashboard-and-agent-trace)

---

## IV. Results

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

**PAM-based RL.** The intervention-timing policy has no measured results yet. It will be compared with the fixed rule (find the person, confirm another activity, then clear) on over-intervention and misses.

**Current verification.** Local replay and automated tests cover QR pairing, setup, command delivery, speech deduplication, and trace grouping with test inputs. They are separate from the video results above. Verify camera and microphone permissions, Chrome's address-bar-free TWA, WebXR tracking and alignment, and audible speech on the actual Android phone, signed APK, and HTTPS origins used for a demonstration.

---

## V. Comparison with Prior Work

**PAM.** Lee et al.'s Procedural Assistance Memory keeps a person's routine as FSM memory and revises it with end-of-day reflection. We port the paper's prompts as they are, but feed World State observation text instead of photos, define states as what the person is doing, and use only habits that pass the adoption test. PAM learns which task follows which activity. It does not learn when to step in. We add reinforcement learning on top: the FSM memory becomes the environment model, and a Q-learning policy trained in it chooses the moment (model-based RL in the style of Dyna).

**Smart home routines.** Today's smart home routines run the same action when conditions the user set are met. NOONCHI uses the person's current activity and learned transitions to prepare a possible next task. It waits while the person is using the object and checks that the task still fits before acting.

For wiring, remote learning, and light sensor calibration, see the [infrared TV setup guide](hardware/ir-tv/README.md).

**Tools and libraries used.** onnxruntime, vLLM, SQLite, Docker, Tailscale, LG ThinQ.

---

## VI. Limitations and Next Steps

**Limitations.**

- It does not move a real robot. The phone stands in for the eyes and a person for the hands and feet, and travel time is not part of the decision.
- It handles one home and one person. Conflicting habits between several people are out of scope.
- The vision and language models are not trained; only the FSM memory and the timing policy change.
- The timing policy is a table over a small hand-chosen state, trained in a simulator built from one home's records.
- The installable app and camera flow target Android with a compatible Chrome and WebXR device. The native home setup uses supported hub floor plans and prepared twins. The phone can review captured reference photos. Live alignment uses the configured starting pose and the runtime alignment path.

**Future work.**

- Extend timing RL from cup clearing to water delivery and the weekend TV routine
- Extend to scenarios such as induction safety and coming home after being away
- Train a model separately on reviewed experience and compare it with the fixed model

---

## Team

| Name | Responsibilities |
|---|---|
| Jeong-O Heo | **Agent Runtime & Systems Integration** — Designed the node-and-topic message bus and World State, and built the NOONCHI server's goal, manager, and execution layers. Connected the Android app and AR camera, the 3D home twin, appliance control, and the live dashboard, and built the scenario replay tests. |
| Seokjun Park | **Decision Models & Habit Learning** — Developed PAM’s decision and reflection logic, designed the statistical test for adopting habits, ran experiments on daily routines, and documented the system architecture. |
| Junhyeong Kim | **Model Research & Evaluation** — Contributed to the PAM implementation and turned household video scenarios into timestamped model inputs for testing. |
| Jihun Shin | **Security Architecture & Privacy** — Designed controls for handling camera frames and built monitoring tools to detect images saved during inference. |

---

## Repository Layout

```text
.
├── README.md
├── src/          # server (Node.js 22, domains in the III-A table)
├── ui/           # dashboard · mobile portal · setup · WebXR phone pages (React)
├── apps/android/ # native Expo app and Chrome TWA bridge
├── twin/         # home assets and 3D twin
├── models/       # YOLO26 ONNX
├── scripts/      # checks, video tests, demo setup
├── tests/        # server tests (Vitest)
├── deploy/       # Dockerfile, compose
└── docs/         # contracts and reference docs
```

---

## Sources

- D. Lee, M. Park et al., *An Agentic Framework for Proactive Robots with Procedural Assistance Memory*, arXiv:2610.21211.
- C. J. C. H. Watkins and P. Dayan, *Q-learning*, Machine Learning 8, 1992.
- R. S. Sutton, *Dyna, an Integrated Architecture for Learning, Planning, and Reacting*, ACM SIGART Bulletin 2(4), 1991.
- Ultralytics, *YOLO26*.
- Qwen Team, *Qwen3-VL*, *Qwen3.5*.
- W3C, *WebXR Device API*, *WebXR Raw Camera Access*.
- Connectivity Standards Alliance, *Matter 1.4*.

---

## License

The code is licensed under AGPL-3.0 ([LICENSE](LICENSE)). The YOLO26 models in `models/` are AGPL-3.0 (Ultralytics). The seven PAM prompts in `src/brain/pam/prompts/paper/` are quoted from Lee et al., arXiv:2610.21211, under CC BY 4.0. Other notices are in [THIRD_PARTY.md](THIRD_PARTY.md).

---

## Getting Started

```bash
npm install
npm --prefix ui install
cp .env.example .env   # OPENAI_API_KEY
npm start              # http://127.0.0.1:8200
```

The local dashboard is available at `http://127.0.0.1:8200`. For a physical phone, expose the hub on an HTTPS origin the phone can reach. Scan the dashboard's connection QR inside the installed Android app or open the same `/mobile/` URL in the browser. Configure the AR origin and the APK's public signing certificate before trying TWA. [Android guide](apps/android/README.md) · [Server and phone reference](docs/reference.md)

GPU server deployment: `docker compose --env-file .env -f deploy/compose.yaml --profile gpu up -d --build` ([deployment guide](docs/deploy.md))
