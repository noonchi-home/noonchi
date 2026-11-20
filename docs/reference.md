# NOONCHI server and phone reference

Start with [Getting Started](../README.md#getting-started). Open the dashboard at `http://127.0.0.1:8200`. On the first run, complete `/setup/` to select a home, configure its devices and set the phone's starting pose. The phone requires a secure context for WebXR. For the GPU and Tailscale setup, see the [deployment guide](deploy.md).

## Components and state

The phone provides camera frames, pose and voice input. The server projects observations into a home layout, combines them with appliance signals, and supplies timestamped text to PAM. Execution validates a task against the current home before sending step instructions. The dashboard displays the plan and its progress. See the [World State vocabulary](world-vocabulary.md), [PAM interface](pam-interface.md), [plan contract](plan-contract.md), [device and layout interfaces](plan.md) and [3D twin guide](twin3d.md).

`TWIN_STUDIO_DIR` selects a local twin asset tree (default `twin/`). `HOME_ID` overrides the default home in `homes.json`. `RUNTIME_DIR` contains the SQLite history database and per-home settings. One server or setup operation may hold its exclusive lock at a time. Stop the process using a runtime directory before resetting that directory. Back up the runtime volume before replacing it.

## Runtime settings

| Setting | Default | Purpose |
|---|---|---|
| `HOST`, `PORT` | `127.0.0.1`, `8200` | Dashboard HTTP server. |
| `PHONE_HOST`, `PHONE_PORT` | `0.0.0.0`, disabled unless configured | Phone HTTP and WebSocket server. `PHONE_URL` sets the externally reachable URL. |
| `ALLOWED_ORIGINS` | Unset | Additional permitted origins. |
| `REDIS_URL` | Unset | Connect stage nodes through Redis, or use the in-process bus when unset. |
| `BRAIN` | Enabled in the example configuration | Enables observation and decision-making. |
| `ENGINE_FRAME_MS` | `100` | Interval between phone engine frames. |
| `VLM_FRAME_MS` | `2000` | Normal scene sampling interval. Search and inspection can request faster sampling. |
| `VLM_WINDOW_FRAMES` | `5` | Maximum number of images in a scene request. |
| `BRAIN_YOLO_PATH`, `BRAIN_POSE_PATH` | Segmentation and pose ONNX files under `models/` | Local perception models. `BRAIN_POSE_EVERY` controls pose sampling. |
| `PAM_TRIGGER` | `periodic` | Select periodic or event-driven decisions. `PAM_PERIOD_MS` overrides the periodic interval. |
| `HISTORY_TZ_MINUTES`, `REFLECT_AT` | `540`, `23:30` | Local day boundary and scheduled reflection time. |
| `KEEP_HEARD_TEXT` | Off | Controls retention of speech text. |
| `PHONE_VIDEO_DIR` | Repository `runtime/videos` | Source directory for phone video mode. Compose sets it to `/data/videos`. |
| `HUB`, `MATTER_TRANSPORT` | `matter`, `network` | Device hub and Matter transport. Compose uses local transport. |
| `THINQ_TOKEN` | Unset | Credentials for live appliances. Additional ThinQ settings control region, polling and readback. |
| `CALL_SERVICE_URL` | Unset | Optional external service for approved contact requests. |

Set `INFERENCE_MODE` to `openai` for hosted inference or `vllm` for local model endpoints. Use `VLM_BASE_URL` and `PAM_LLM_BASE_URL` to override them independently. The voice and planning agent uses the configured OpenAI or Anthropic provider. See the [deployment settings](deploy.md) and the [example configuration](../.env.example) for provider, GPU, Matter and retention settings.

## HTTP and event interfaces

Routes are implemented under [src/server/routes](../src/server/routes) and [src/server/setup](../src/server/setup). Replace `:id` with the identifier returned by the corresponding list endpoint.

| Endpoints | Purpose |
|---|---|
| `GET /api/health` | Server status, selected home, phone URLs and component readiness. |
| `GET /api/homes`, `GET /api/scene`, `GET /api/layout` | Available homes, active scene and layout edits. Save or reset edits with `POST /api/layout/save` or `POST /api/layout/reset`. |
| `GET /api/setup`, `POST /api/setup/home`, `POST /api/setup/devices`, `POST /api/setup/done` | Read setup progress, choose a home and its devices, then finish setup. `POST /api/setup/mode` selects device operation mode. |
| `GET /api/setup/thinq`, `POST /api/setup/pairs` | List available ThinQ appliances and save their pairings. |
| `GET /api/rooms`, `GET /api/devices`, `GET /api/devices/:id` | Inspect room and device IDs, capabilities and current state. Filter the list by `room` or `kind`. |
| `POST /api/devices/:id/command`, `POST /api/devices/:id/twin`, `POST /api/sensors/:id` | Request a device action, submit a twin attribute or update a sensor. Controllable attributes go through command policy. |
| `POST /api/agent/chat`, `GET /api/agent/pending`, `POST /api/agent/confirm`, `POST /api/agent/cancel` | Start or continue a conversation and resolve its pending approvals. |
| `GET /api/matter`, `POST /api/matter/commissioning-window` | Inspect the bridge and open a commissioning window. |
| `GET /api/brain`, `GET /api/world`, `GET /api/decisions` | Read perception and inference status, the current World State and recent decisions. |
| `GET /api/history`, `GET /api/history/day/:day`, `GET /api/memory/day/:day` | Read events, one day's records or its active memory. Use `YYYY-MM-DD` for dates. |
| `POST /api/reflection/run` | Request reflection on recorded experience. |
| `GET /api/phone/start-pose`, `POST /api/phone/start-pose` | Read or set the phone's starting pose. Other controls are `POST /api/phone/start-pose/preview`, `POST /api/phone/start-pose/clear` and `GET /api/phone/sync`. |
| `GET /api/plan`, `POST /api/plan`, `POST /api/plan/:id/steps/:stepId` | Read, publish and advance a plan. See the [plan contract](plan-contract.md) for write authorization and revisions. |
| `/events` (WebSocket) | Sends an initial home snapshot, then changes to devices, plans, observations, approvals, goals, robot activity and dashboard messages. See [event types](../src/contract/events.ts). |

### External contact service

A voice request can ask `call_service` to contact an appliance service center or a guardian. Recipients come only from `RUNTIME_DIR/homes/<home>/contacts.json`. Missing or invalid contacts block the request. The phone displays the recipient and outgoing details and asks for approval each time. When configured, `CALL_SERVICE_URL` receives a JSON POST with a ten-second timeout. An uncertain delivery can reuse its persisted request ID on a later approval for the same contact and incident. Service implementations should deduplicate on `id`.

Example contacts file and two request bodies (fictional contacts):

```json
{"as_center":{"name":"Appliance Service","phone":"555-0100"},"guardian":{"name":"Home Contact","phone":"555-0101"}}
```

```json
{"version":1,"id":"6f1c2a9e-3b7d-4c1e-9a52-0d8e4f7b21c3","kind":"as_center","to":{"name":"Appliance Service","phone":"555-0100"},"home":{"id":"example","name":"Example Home"},"device":{"id":"washer_1","label":"Washer","kind":"washer"},"problem":"Stops during the spin cycle","error_code":"UE","person":null,"approved_at":"2026-11-17T10:00:00Z"}
```

```json
{"version":1,"id":"0b9e7d41-58a2-4f36-8c1d-2e6a9f3b7c50","kind":"guardian","to":{"name":"Home Contact","phone":"555-0101"},"home":{"id":"example","name":"Example Home"},"device":null,"problem":null,"error_code":null,"person":"Resident requested assistance","approved_at":"2026-11-17T10:00:00Z"}
```

## Phone alignment and video mode

Use an HTTPS phone URL, start AR, and align the camera with the saved home position. Camera poses and capture timestamps tie observations to the digital twin. Keep the intended appliance in view when a step asks for visual confirmation. A suspected fall or a risky appliance can take priority over an ordinary instruction.

For prerecorded input, open `/phone/?clip=<file>`. The phone server serves supported clips from `PHONE_VIDEO_DIR`. Configure the home's starting pose before playback. Optional `fov`, `pitch` and `h` describe the camera. Step clips are repeatable (kinds: go, pick, place, do). Matching clips are consumed in the order listed. When a step clip ends, its last frame is held. When the initial clip ends, its last frame is also held. This keeps camera input available for pending checks. Video mode uses the same plan and completion rules as the physical phone.

The video checker reads page telemetry, including `window.__noonchiVideo = { t0, ended, hold, commands: [{ video_ms, id, step, text }], clips: [{ video_ms, clip, duration_ms }], sync: [[server_ms, video_ms]], at }`. Capture timestamps synchronize the video timeline with server events. Use `npx tsx scripts/video-check.ts --help` for the supported options.

## Appliances and approvals

During setup, pair live devices with supported ThinQ adapters. The [device registry](../src/devices/kinds.ts) defines names, profiles, camera evidence, and confirmation rules. Twin commands and voice requests both pass through policy checks. An approval applies to the displayed request. A plan that turns on a risky appliance continues tracking it until valid off evidence arrives. The current plan response lists open switch-off reminders.

### Connect an MCP client

Start the NOONCHI server, then configure the client to launch `npx tsx src/agent/mcp/server.ts` from the repository root using stdio. Set `TWIN_HOME_URL` if the REST server is hosted elsewhere. Call `find_devices` or `list_devices` to resolve a label to a device ID before requesting a change. A tool result containing `needsConfirmation` identifies a pending action. Show the proposed action to the user and pass the token to `confirm_action` only after approval. See the [MCP server](../src/agent/mcp/server.ts).

### Connect a Matter controller

For a physical controller on the local network, run the Matter bridge with network transport. The default Compose setup uses local transport. Read `GET /api/matter` for bridge information and use `POST /api/matter/commissioning-window` when the controller needs a fresh pairing window. Enter the pairing code in the controller. Preserve the bridge's Matter storage between restarts to retain existing pairings.

## Troubleshooting

- **Phone cannot start AR.** Check the HTTPS certificate, the selected phone URL and browser camera permissions. Use the same tailnet as the dashboard.
- **A model is unavailable.** Check `/api/health`, endpoint URLs and credentials. In GPU mode check the model IDs returned by each endpoint.
- **Device state does not change.** Check the selected home, device ID, supported commands and pending approvals. For a paired appliance, inspect ThinQ readback before retrying.
- **Runtime is locked.** Stop the server or setup process holding the same runtime directory before restarting or running a fresh demo.
