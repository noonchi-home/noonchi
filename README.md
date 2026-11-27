# Agentic FSM for Proactive Home Robot

**NOONCHI** · LG Electronics · Software Engineering 26-2

![Node.js](https://img.shields.io/badge/Node.js-22-5FA04E?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![three.js](https://img.shields.io/badge/three.js-r187-000000?logo=threedotjs&logoColor=white)
![Matter](https://img.shields.io/badge/matter.js-0.17-1A1A1A)
![Redis](https://img.shields.io/badge/Redis-8.10-FF4438?logo=redis&logoColor=white)
![MCP](https://img.shields.io/badge/MCP_SDK-1.32-D97757)
![OpenAI](https://img.shields.io/badge/OpenAI_SDK-7-412991?logo=openai&logoColor=white)

## Overview

A resident sits at the dining table. They could be eating, studying, or taking a break. When the camera also sees them holding a cup and bringing it to their mouth, the system has evidence that they are drinking. If they later stand up and carry that same cup to the sink, the robot can record both **what they were doing** and **what they did afterward**.

NOONCHI is a prototype of the decision-making system for LG’s home robot CLOiD. It represents each resident’s activities in a finite-state machine (FSM). A **state** describes an activity such as drinking at the table or watching TV on the sofa. A **transition** describes a change in activity supported by observable events. When a resident repeatedly performs a task around that change, the task becomes a candidate for the robot to take over.

| Level | What it represents | Cup example |
|---|---|---|
| Observation | Facts obtained from the camera or an appliance | Seated at the table, holding a cup, bringing it to the mouth |
| Activity state | The activity inferred from a combination of facts | Drinking at the table |
| Routine | An action the resident repeatedly performs around an activity transition | Carrying the used cup to the sink after a drink |
| Proactive assistance | A learned task that the current scene shows is still pending | Starting cleanup when the resident leaves the same empty cup behind |

In our **Agentic FSM** design, the agent consults and revises this memory. During the day, it compares observations with the FSM to decide whether to act, wait, or look again. At night, it reviews the day’s record and proposes changes to the transition rules.

## I. Background

### A. Why It Matters

A cup sits on the table beside an empty chair. The resident may have finished their drink and gone to watch TV, or they may have stepped away to fetch more water. Clearing the cup would help in the first case and interrupt the resident in the second.

The robot needs three pieces of context: what the resident was doing just before they stood up, what they usually do after that activity, and whether the task still needs doing. Even after the robot prepares a plan, the resident returning with a water bottle can change the decision.

### B. The Question

> **Can a home robot learn a task by watching a resident do it, then recognize a later occasion when it can take over?**

1. Which visible cues distinguish one activity from another?
2. What evidence supports learning a personal routine from a sequence of activities?
3. When a familiar situation recurs, how can the robot tell whether the task is still pending?
4. What new observation should lead the robot to revise or cancel its plan?

### C. Goals

- **Structure the observations.** Use a consistent vocabulary for posture, location, objects, and interactions. Keep each observation linked to the person or object it describes.
- **Track the resident’s activity.** Combine cues within a scene and compare them with the previous state to identify when an activity continues or changes.
- **Learn routines from daily life.** Identify tasks the resident repeatedly performs themselves, evaluate candidate routines, and incorporate supported ones into the FSM.
- **Act on current evidence.** Prepare a plan and check its conditions before execution. Look again or ask when evidence is missing, and stop when the situation changes.

## II. Data

| Dataset | Contents | What it tests |
|---|---|---|
| Home videos of cup clearing | Three videos, filmed with a glass mug, a tall glass, and a white mug. Each has five clips from leaving the table through placing the cup in the sink. | Whether the server issues commands in order and completes the clearing plan. |
| Synthetic household records | One resident’s week of daily-life records. Each entry is marked as synthetic. | Whether nightly reflection proposes candidate routines and the adoption test evaluates them. |
| PAM routine videos | A study routine and an evening routine, each filmed across two days. | How FSM memory affects action selection on the same videos. |

The planned end-to-end evaluation separates **learning occasions from assistance occasions**. The learning recordings show the resident clearing their own cup. The evaluation recordings start with the resident leaving it behind. One ending shows the resident continuing another activity. In the other, they return with a water bottle and reuse the cup.

## III. How It Works

### A. Architecture

The phone serves as CLOiD’s eyes. The server relates camera observations and appliance signals to the home’s digital twin. The decision agent compares this evidence with the resident’s FSM to select a task. In the prototype, a person follows instructions on the phone for movement and manipulation. Supported appliances receive device commands directly.

| Process | Input | Output |
|---|---|---|
| Daytime observation | Camera frames, phone pose, appliance signals | Posture, objects in hand, object locations, appliance states, and changes |
| Activity inference | Observed facts, the last activity, the resident’s FSM | Current activity state and the observed transition |
| Planning and execution | Task associated with the transition, current state of the resident and objects | Wait, look again, ask, execute, or cancel |
| Nightly reflection | Activity history, tasks the resident performed, robot execution records | Proposed FSM revisions and the rules adopted for the next day |

Observation, decision, planning, and execution modules communicate over an in-memory bus by default. SQLite stores activity records and memory versions. The dashboard brings together the live camera view, the digital twin, and the decision trace. [Architecture notes](docs/architecture/architecture-notes.md) · [Android architecture](docs/architecture/android-app-system.md) · [WebXR step round trip](docs/architecture/webxr-roundtrip.md)

### B. Observation: YOLO26 and the VLM

YOLO26 detects people and objects and estimates the resident’s posture. By default, the VLM reads up to five recent frames sampled two seconds apart to interpret what the resident is holding and how they are interacting with it.

Observation keywords represent individual facts. A scene might yield `posture = seated`, `location = dining table`, and `holding = cup`. Seeing the cup move to the resident’s mouth in subsequent frames provides evidence for the activity of drinking.

**Within a scene, combine the cues. Across scenes, preserve their order.** Taking a cup from the table to the mouth and carrying it from the table to the sink both involve holding the same object, but they tell the robot different things about the activity.

### C. World State

World State groups evidence by person, object, and appliance. It records what was observed, where, and when it was last confirmed. The digital twin supplies a common spatial reference when the camera turns away and later returns to the same table or sink.

For cup clearing, the system must identify **the cup the resident used**, verify **whether it is still on the table**, and distinguish **an empty cup from one whose contents are out of view**.

The current implementation maintains these facts in a shared vocabulary and turns them into timestamped observation text for PAM. The proposed interface passes the same structured fields to daytime decisions and nightly reflection. This would make it possible to trace a transition back to the posture, object, and interaction that supported it. [World State vocabulary](src/world/vocab.ts) · [Current observation format](src/world/text.ts)

### D. Behavior Prediction: Person-State FSM and PAM

Procedural Assistance Memory (PAM) interprets the observation record and the FSM to identify the resident’s activity and its transition. The server looks up the task associated with that transition.

**The initial person-state FSM does not assign cup clearing to the end of a drink.** Picking up a cup and moving it to the sink is already an available task. What the system learns is when that task belongs in a particular resident’s routine. [Initial FSM and validation rules](src/brain/decision.ts)

| Decision | Evidence |
|---|---|
| What has the system learned? | The resident repeatedly carried their used cup to the sink after drinking at the table. |
| Why might help be useful today? | The resident has left the table and that cup is still there. |
| Can execution begin? | The same cup is confirmed empty and nobody is using it. |
| What would change the decision? | The resident returns, picks up the cup, or starts refilling it. |

In the demonstration, seeing the resident sit on the sofa and watch TV provides evidence that they have moved on to another activity. A different subsequent activity can supply that evidence on another occasion.

### E. Plans Prepared Ahead and Step Execution

Once the routine has been learned, the robot can prepare the clearing plan while the resident is still drinking. It identifies the cup, the table, and the destination in advance. Before issuing the first command, it checks the scene again after the resident leaves.

The prototype uses the phone to guide a person through the physical steps. After two clear overhead views confirm the cup is empty, the phone gives one instruction at a time: pick up the cup, walk to the sink, and put it down. If a drink remains, the system asks whether to discard it. If the contents remain unknown, the plan stops.

In the first demonstration ending, the resident continues another activity and the cup stays on the table, so clearing can proceed. In the second, the resident returns with a water bottle before pickup. Although the same FSM supported preparation of the same plan, the new evidence of cup reuse calls for cancellation.

### F. Learning: Nightly Reflection and FSM Updates

At the end of the day, PAM groups observations into activity episodes and identifies **tasks the resident performed that the robot could have taken over**. It examines which activities preceded those tasks and proposes a new association or a revision to an existing transition condition.

**Current implementation.** Reflection generates candidates. The server checks their structure and meaning, then counts how many observable trigger occurrences were followed by the task within five minutes. Adoption requires a follow-through rate of at least 75%. Periods that were out of view are handled separately. A task performed by the robot is not counted again as a demonstration by the resident. [Adoption test](src/brain/pam/adopt.ts) · [Assistance outcomes](src/contract/assistance-outcome.ts)

**Planned reinforcement learning.** The learning decision is which FSM edit to make during nightly reflection: retain a rule, refine its conditions, or associate a task with another transition. Later activity records can reveal the value of the revision. For example, a revised rule should earn a higher reward if it still identifies cups left behind and reduces clearing proposals when the resident is fetching more water. The reward design and the evaluation of this learning process are future work.

**How long does learning take?** In the original PAM experiment, the first night’s reflection produced an empty-bowl storage rule that was available for decisions on day 2. After day 3, the rule also recognized putting down the spoon as a cue, in addition to opening the laptop. NOONCHI applies its own adoption test. The number of observations and nightly reflections needed to adopt the cup-clearing rule is an evaluation target. [Original PAM day-by-day FSM records](https://github.com/DAVIAN-Robotics/PAM/blob/main/docs/static/data/pam-fsm.json)

### G. Screens People See

| View | What it shows |
|---|---|
| Android app | Hub pairing, reference photos, appliance registration, and observation positions |
| Phone camera and instructions | WebXR video and pose, step-by-step voice or screen instructions, and resident responses |
| Vision | The person, objects, and interactions visible to the robot |
| Digital Twin | Appliance states, the planned route, and the object the current task targets |
| Agent Trace | The sequence of observations, decisions, and execution steps |

The cup demonstration is designed to expose the point where the two runs diverge. In the first, confirmation that the empty cup remains on the table supports execution. In the second, seeing the resident refill the cup explains why the plan should be cancelled. [Dashboard reference](docs/reference.md#dashboard-and-agent-trace)

## IV. Results

**Cup-clearing video replays.** The server received each video through the phone input path. The evaluation checked command order and plan completion.

| Video | Verdict | First command after the resident left |
|---|---|---:|
| Glass mug | Pass | 3.5 s |
| Tall glass | Pass | 3.2 s |
| White mug | Pass | 1.9 s |

**PAM routine experiment.** The team measured action-choice F1 on the same videos with and without FSM memory.

| Routine | With FSM memory | Without memory |
|---|---:|---:|
| Study, day 2 | 0.41 | 0.04 |
| Evening, day 1 (routine changed) | 0.27 | 0.00 |
| Evening, day 2 | 0.25 | 0.08 |

In the evening routine, the system missed an opportunity to hand over a cup during the meal on day 1. After that night’s reflection, it predicted the handover on time on day 2. The team ran each condition once. In these videos the resident carried the cup away, so the experiment did not establish how many days it takes to learn to clear a cup that is left behind. [Team experiment record](https://github.com/noonchi-home/docs/blob/main/03_Sprints/Sprint-01/Tickets/S01-PSJ-02_4%EC%9D%BC-%EC%9D%BC%EA%B3%BC-%EC%98%81%EC%83%81-PAM-%EC%9E%AC%ED%98%84-%EC%8B%A4%ED%97%98.md)

The next evaluation will measure how many observations and reflections precede adoption, how often the robot correctly clears a cup left behind, how often it attempts to clear a cup the resident reuses, and how much time elapses between obtaining sufficient evidence and issuing the first command.

## V. Comparison with Prior Work

| Prior work | What it does | What NOONCHI does differently |
|---|---|---|
| Philipose et al., *Inferring Activities from Interactions with Objects* | An RFID glove reads which tagged household object the hand touches. Each activity is written as step-by-step English instructions in recipe or how-to form; each step becomes a stage holding the objects it names, and each object’s probability comes from Google page counts (pages naming the activity and the object ÷ pages naming the activity). A dynamic Bayesian network outputs the most likely activity for the sequence of touched objects, and the system takes no action. The experiment keeps the models fixed (no learning, a 20-second mean stage duration); the paper notes only that the probabilities could change through learning or be tuned to one elder. | NOONCHI uses camera frames without tags or a glove, and World State attaches facts to each object, such as the digital-twin location of `cup_1`, whether it is in a hand, and its contents. Activity states start from an initial FSM the team wrote (`away`, `drinking`, `watching_tv`, `cooking`), not from written instructions and web page counts. Nightly reflection can use the home’s records to add states, up to 12 in total, and to attach learned tasks from the fixed task list, but it keeps every initial state with its id and activities. The output is a decision about a particular object: before the first command, deterministic checks verify that the same cup is still in place, its contents are known, and nobody is holding it. |
| Tapia et al., *Activity Recognition in the Home Using Simple and Ubiquitous Sensors* | Reed and piezoelectric switches on doors, cupboards, drawers, and appliances (77 in one home, 84 in the other) record when each one changes state. A naive Bayes classifier, trained on activity labels from the residents’ PDA self-reports and on labels the researcher later assigned to the sensor record with each resident, maps which switches fired, and in what order, within an activity-length window to the most likely activity, and detection is most accurate at the end of an activity. | The camera observes the resident directly, including posture, the object in hand, and location. World State marks a VLM fact as confirmed when two answers in a row give the same value, a posture from joints when the same value holds for 2 seconds, and a cup’s contents after 3 photos spanning at least 4 seconds or 2 overhead photos at least 1.5 seconds apart; until then it marks the value as a guess. Instead of a classifier trained on activity labels, PAM reads the timestamped changes from the last 60 seconds and the facts that still hold, with how long each has held, together with the home’s FSM, and reports the transition from the previous state. By default, PAM is called every second with nano or mini models and every 5 seconds otherwise while frames arrive, and a transition that carries a task starts that task’s plan; once cup clearing has been learned, its plan is prepared while the resident is still drinking. |
| Zeng et al., *Socratic Models* | Pretrained models are connected through prompt templates without further training: for each key moment of an egocentric video, CLIP ranks place and object categories and re-ranks activities proposed by a language model, producing a timestamped event log for that video. The language model answers questions from the log and forecasts later events, and without personal context those forecasts lean toward common schedules. | The VLM reports facts about each person and object only as World State vocabulary values, plus a one- or two-sentence summary of what visibly happens across the photos, which also enters PAM’s observation text as a timestamped line. The server validates the answer against a JSON Schema and attaches each fact to the person or object it describes. The home’s FSM (one resident in this prototype) persists across days as versioned memory in SQLite, and each revision applies from the next day. A learned routine (cup clearing or turning on the AC) enters it only after passing the adoption test on the home’s records. The robot decides when to help without an instruction from the resident, while the Socratic Models robot plans a simulated arm’s moves only from a person’s instruction. |
| Lee et al., *Procedural Assistance Memory* | Once per second, a VLM reads five recent frames taken two seconds apart along with the memory text and selects one robot task or no action without committing to a single current state. Its prompt says to pick a task only if it can be executed immediately and never to act on an object the person is holding or touching; a VLA policy then executes the chosen task with no other check, and asking the user lies outside the framework. The memory is an FSM whose states are activity phases holding (trigger, task) rules, with transitions marking visible events between phases; a reflector VLM revises it from each day’s video, and the revision is used the next day without a separate test. | NOONCHI’s PAM receives observation text built from World State, not images, and each robot task is attached to an FSM transition, an observable event that leaves a state (including one that returns to the same activity), rather than to a rule inside a state. PAM answers the current state and transition; the server accepts only a transition that leaves the previous state and takes the task from it. Before the first command, deterministic code checks the target object, such as the cup, and the server can look again, ask, or cancel. Nightly reflection reads the day’s records grouped into activity episodes as text, not video, and code checks each candidate’s structure and an LLM checks its meaning before the adoption test. A candidate is adopted only if the task followed the trigger within five minutes in at least 75% of observable occurrences; choosing FSM edits with reinforcement learning is planned. |

## VI. Limitations and Next Steps

The prototype covers one resident in one home. Actions outside the camera’s view and objects with obscured contents leave gaps in the record. A phone and a person stand in for a robot’s view, movement, and manipulation. Navigation accuracy and grasp success on a physical robot require separate evaluation.

1. **Unify the observation format.** Pass the same posture, location, object, and interaction fields to daytime inference and nightly reflection.
2. **Measure routine acquisition.** Record both occasions when the resident clears the cup and occasions when they come back to use it. Track the evidence available when the clearing rule is first adopted.
3. **Evaluate on a different day.** Test assistance and cancellation using recordings held out from learning.
4. **Apply reinforcement learning to FSM revision.** Define a reward for edits and compare the resulting FSM with the existing reflection-and-adoption approach.
5. **Extend to another household routine.** Test whether the same method can learn assistance involving different objects or appliances.

## Team

| Name | Responsibilities |
|---|---|
| Jeong-O Heo | **Agent Runtime & Systems Integration** — Designed the node-and-topic message bus and World State, and built the NOONCHI server's goal, manager, and execution layers. Connected the Android app and AR camera, the 3D home twin, appliance control, and the live dashboard, and built the scenario replay tests. |
| Seokjun Park | **Decision Models & Habit Learning** — Developed PAM’s decision and reflection logic, designed the statistical test for adopting habits, ran experiments on daily routines, and documented the system architecture. |
| Junhyeong Kim | **Model Research & Evaluation** — Contributed to the PAM implementation and turned household video scenarios into timestamped model inputs for testing. |
| Jihun Shin | **Security Architecture & Privacy** — Designed controls for handling camera frames and built monitoring tools to detect images saved during inference. |

## Repository Layout

| Path | Contents |
|---|---|
| `src/` | Node.js and TypeScript server for observation, World State, decisions, planning, and execution |
| `ui/` | Dashboard, mobile portal, setup, and WebXR pages |
| `apps/android/` | Native Android app and Chrome TWA bridge |
| `twin/` | Home layouts and the 3D digital twin |
| `models/` | YOLO26 ONNX models |
| `scripts/` · `tests/` | Video replays, demonstration setup, and server and runtime tests |
| `deploy/` · `docs/` | Deployment configuration, architecture, and interface references |

## Sources

- M. Philipose et al., *Inferring Activities from Interactions with Objects*, 2004. [Paper](https://ics.uci.edu/~djpatter/classes/2012_09_INF241/papers/JR-001.pdf)
- E. M. Tapia, S. S. Intille, and K. Larson, *Activity Recognition in the Home Using Simple and Ubiquitous Sensors*, 2004. [Paper](https://www.khoury.northeastern.edu/home/intille/papers-files/TapiaIntilleLarson04.pdf)
- A. Zeng et al., *Socratic Models: Composing Zero-Shot Multimodal Reasoning with Language*, ICLR 2023. [Project and paper](https://socraticmodels.github.io/)
- D. Lee, M. Park et al., *An Agentic Framework for Proactive Robots with Procedural Assistance Memory*, 2026. [Project and paper](https://davian-robotics.github.io/PAM/)
- Ultralytics, *YOLO26*. Qwen Team, *Qwen3-VL* and *Qwen3.5*.
- W3C, *WebXR Device API* and *WebXR Raw Camera Access*. Connectivity Standards Alliance, *Matter 1.4*.

## License

The code is licensed under AGPL-3.0. The YOLO26 models in `models/` are distributed under AGPL-3.0 by Ultralytics. The seven PAM prompts in `src/brain/pam/prompts/paper/` are quoted from Lee et al., arXiv:2610.21211, under CC BY 4.0. [License](LICENSE) · [Third-party notices](THIRD_PARTY.md)

## Getting Started

```bash
npm install
npm --prefix ui install
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`, then start the server.

```bash
npm start
```

Open the local dashboard at `http://127.0.0.1:8200`. To connect a physical phone, expose the hub on an HTTPS origin that the phone can reach. Scan the dashboard’s QR code inside the installed Android app, or open the same `/mobile/` URL in the browser. Configure the AR origin and the APK’s public signing certificate before using TWA. [Android guide](apps/android/README.md) · [Server and phone reference](docs/reference.md)

For GPU server deployment, run the following command. [Deployment guide](docs/deploy.md)

```bash
docker compose --env-file .env -f deploy/compose.yaml --profile gpu up -d --build
```
