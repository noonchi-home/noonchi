# NOONCHI Architecture Diagram Notes

Author Seokjun Park · 2026-11-25 · Target architecture. The code will be changed to match it. Code compared against `noonchi main` at `d5aeab53` (2026-11-24).

The two diagrams follow the C4 model. Each shows a different level of detail.

| Diagram | C4 level | What it shows |
|---|---|---|
| `architecture.svg` | Level 2 (containers) | Where the separately running programs are deployed and how they connect. |
| `noonchi-server-inside.svg` | Level 3 (components) | The parts inside the noonchi server and the data passed between them. |

Splitting the diagrams keeps the connections readable. Level 3 expands the noonchi server, which the team built. YOLO26 and the two vLLM services appear as whole containers.

The EC2 server stands in for the robot's onboard computer. Everything the robot needs runs on that one machine: the models, the history, and the photos. Only appliance control through LG ThinQ leaves it.

---

## 1. System Deployment (Level 2)

![NOONCHI System Architecture](architecture.svg)

### What the boundaries show

- **Home** contains the phone app, which serves as CLOiD's eyes, and the household appliances.
- **LG ThinQ Cloud** is an external service operated by LG.
- **AWS Cloud → EC2 (g6e.2xlarge · Ubuntu)** represents one rented server, used as the robot's onboard computer.
- **Docker Compose** runs four containers on that server (`noonchi`, `yolo`, `vllm-vlm`, and `vllm-pam`).
- **Matter and SQLite** run inside the noonchi container. Both are libraries in the same Node.js process. The SQLite file and saved photos live on the `noonchi-data` volume on the same server.

### How to read the arrows

- Double-headed arrows are requests with replies. The caller is noonchi.
- Labels follow the short format `Data [Protocol]`.

### Steps ①–⑦ for clearing a cup

The numbers follow one cup-clearing pass from the stored rules to the stored result.

| Step | Connection | What happens when clearing a cup |
|---|---|---|
| ① | noonchi ↔ SQLite · History [Read/Write] | noonchi reads the current habit rules (an FSM) and recent history. |
| ② | Phone App → noonchi · Frames + Pose [WSS] | The phone sends a frame and its pose every 0.1 seconds over the private Tailscale network. |
| ③ | noonchi ↔ YOLO26 · Object Detection | YOLO26 finds people and objects in every frame and returns their positions, shapes, and poses. |
| ④ | noonchi ↔ Qwen3-VL-4B · Scene Query [HTTP] | Every 2 seconds, noonchi sends five frames with the YOLO detections and receives a scene description such as “An empty cup is on the table. The person has left.” |
| ⑤ | noonchi ↔ EXAONE 4.5 33B · Decision & Reflection [HTTP] | Every 5 seconds, noonchi sends observation text and the habit rules and receives a task such as “Clear the cup,” then the steps for it. The same model handles nightly reflection. |
| ⑥ | noonchi → Phone App · Step Commands [WSS] | noonchi sends instructions such as “Please go to the table” and “Please pick up the cup” over the same connection as step ②. |
| ⑦ | noonchi ↔ SQLite · History [Read/Write] | noonchi writes what happened. |

### Unnumbered connections

| Connection | What it does |
|---|---|
| noonchi → LG ThinQ Cloud · State & Control [ThinQ API] | Reads appliance state, such as an open refrigerator door, and sends commands, such as turning on the air conditioner. |
| LG ThinQ Cloud → Home Appliances · State & Control | LG's service exchanges state and commands with LG appliances in the home. |
| noonchi → Home Appliances · State & Control [matter] | Reads and controls a physical TV using the Matter standard. |

---

## 2. Inside the noonchi Server (Level 3)

![NOONCHI Server — Inside](noonchi-server-inside.svg)

### Memory Bus

The parts inside noonchi do not call each other. Each part publishes messages to the **Memory Bus** and reads the messages it needs from it. The bus only delivers messages. It keeps them, hands them to subscribers, and retries failed deliveries. It decides nothing. It runs inside the same Node.js process, so no separate message server is needed.

Calls to the models, the appliances, and SQLite do not go through the bus. The part that needs them calls them directly.

### Agent

**Goal**, **Brain**, and **Act** form the Agent.

- **Goal** keeps plan-ahead goals, habit visits, and TV rules.
- **Brain** asks EXAONE what to do next, plans the steps for the chosen task, and runs the nightly reflection.
- **Act** turns the plan into step commands for the phone and follows them until they finish.

### Reading the double-headed arrows

Each label sits next to the arrowhead it arrives at. On the Brain ↔ EXAONE lines, the label near EXAONE is what Brain sends. The label near Brain is what comes back.

| Line | Sent to the model | Returned |
|---|---|---|
| Brain ↔ EXAONE 1 | Chosen Task | Step Plan |
| Brain ↔ EXAONE 2 | Observation + FSM, every 5 s | Next Task |
| Brain ↔ EXAONE 3 (purple dotted, nightly) | Day's History at 23:30 | Next-day FSM |
| Brain ↔ EXAONE 3 (finish the day, `FINISH_DAY=1`) | Today's History when the dashboard finishes the day | Next-day FSM, system day +1 |
| Perception ↔ YOLO26 | Frame | Objects |
| Perception ↔ Qwen3-VL-4B | 5 Frames + Objects, every 2 s | Scene Text |

### Cup-clearing flow

1. **Perception** receives a frame and pose from the phone every 0.1 seconds and sends each frame to **YOLO26**.
2. Every 2 seconds, **Perception** sends five frames and the YOLO detections to **Qwen3-VL-4B** and combines the scene description with the detections.
3. **World State** keeps the current picture of the home, built from Perception and Devices.
4. Every 5 seconds, **Brain** sends observation text and the habit rules to **EXAONE 4.5 33B**. EXAONE returns a task such as “Clear the cup.” Brain sends the chosen task back and receives the step plan.
5. **Act** sends the steps to the phone, such as “Please go to the table” and “Please pick up the cup.”
6. **Devices** reads and controls appliances. The Matter link goes to Home Appliances and the ThinQ link goes to LG appliances.
7. **Recorder** subscribes to all changes on the bus and writes them to SQLite.
8. **Nightly reflection at 23:30 (purple dotted line)** sends the day's history to EXAONE and receives the habit rules for the next day. With `FINISH_DAY=1`, the dashboard settings dialog can finish the day early: the same reflection runs now and the system day moves forward by one.

The `__ ms` fields mark timings that are still unmeasured.

---

## 3. What the Diagrams Simplify

- **Phone input and output** appear as arrows. The code has a separate `phone` node.
- **Localize** (`localize` node) finds the robot's position from a reference photo map stored on the same server. It is not drawn.
- **Dashboard** is outside the scope of these two diagrams.
- **Local development** can use OpenAI models in place of the vLLM services on a PC without a suitable GPU. The diagrams show the demonstration server.

## 4. Where the Code Still Differs

The diagrams show the target. At `d5aeab53`, the code differs in these places.

| Diagram | Code at `d5aeab53` | Change needed |
|---|---|---|
| YOLO26 runs in its own `yolo` container. | YOLO runs inside noonchi on a worker thread (`onnxruntime-node`, models in `models/`). | Move YOLO into its own container and call it from Perception. |
| EXAONE 4.5 33B makes decisions and reflects. | `vllm-pam` defaults to `Qwen/Qwen3.5-27B-GPTQ-Int4`. | Set `PAM_LIVE_MODEL` to EXAONE 4.5 33B. |
| EXAONE plans the steps (Step Plan). | `src/agent/planner.ts` uses the agent provider, which defaults to OpenAI `gpt-5.5`. | Point the planner at the EXAONE server. |
| Matter controls a physical TV. | `MATTER_TRANSPORT=local` simulates Matter devices inside noonchi. | Switch to a network Matter transport. |
| Photos and the map stay on the server. | Localization can read a local map (`LOCALIZE_MAP`) or an S3 bucket (`LOCALIZE_BUCKET`). | Use `LOCALIZE_MAP` only. |

## 5. Other Planned Work

- **Reviewing decisions after the fact** is in design. The proposed nightly review would compare the robot's decisions with the user's actions and classify them as correct decisions, missed opportunities to help, or excessive interventions. The results would update the long-term user memory, including daily notes and the user profile.

## Sources for the Figures

| Value | Source |
|---|---|
| A frame every 0.1 seconds | [Observation](../../README.md#b-observation-yolo26-and-the-vlm) |
| Qwen3-VL every 2 seconds with up to five frames | [Observation](../../README.md#b-observation-yolo26-and-the-vlm) |
| PAM every 5 seconds (1 second for nano models) | [Behavior Prediction](../../README.md#d-behavior-prediction-person-state-fsm-and-pam) |
| Nightly reflection at 23:30 | [`REFLECT_AT` default](../reference.md#runtime-settings) |
| Finish the day early from the dashboard | [`FINISH_DAY`](../reference.md#runtime-settings) |
| EC2 g6e.2xlarge | [Deployment guide](../deploy.md) |

## November 24 Guides

The November 24 guides cover QR pairing, native Android home setup, and the Chrome TWA camera. They follow the WebXR socket, the dashboard feed, and the round trip for a checked instruction. The phone gateway hands engine images directly to the observation pipeline. [Android app architecture](android-app-system.md) · [WebXR step round trip](webxr-roundtrip.md)
