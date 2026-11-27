# NOONCHI server and phone reference

Start with [Getting Started](../README.md#getting-started). Open the dashboard locally at `http://127.0.0.1:8200`. For a physical phone, use the dashboard's reachable HTTPS address. Scan the `/mobile/` QR inside the [NOONCHI Android app](../apps/android/README.md) to pair with the hub, including before a home is registered. Opening the same URL in a compatible phone browser opens the web portal.

For the demonstration, search for Hanyang Mokryeon in Gunpo, confirm the 180B floor plan, and open the twin prepared in Twin Studio. During the scan, match each reference view, capture a photo, and confirm it. Saved views can be resumed, reviewed, or retaken on the phone. In the native app use **집 관리** and **설정**. The web equivalents are `/mobile/` and `/mobile/settings/`. Settings cover the home, devices and supported ThinQ pairings, test or live appliance mode, starting pose, and stations. Android lists layout corrections and can save or reset them. The web settings also provide the layout editor. See the [deployment guide](deploy.md) for the HTTPS setup.

## Components and state

The phone provides camera frames, pose and voice input. The server projects observations into a home layout, combines them with appliance signals, and supplies timestamped text to PAM. Execution validates a task against the current home before sending step instructions. See the [World State vocabulary](world-vocabulary.md), [PAM interface](pam-interface.md), [plan contract](plan-contract.md), [device and layout interfaces](plan.md) and [3D twin guide](twin3d.md).

### Dashboard and Agent Trace

The default view has three panels: Vision (16:9) on top of the left column, Digital Twin below it, and Agent Trace on the right at full height. The left column takes 55% of the width; below 720 px the panels stack in that order. The screen has no settings button: Ctrl+1 opens settings. Rows drawn on the twin carry a dot of the same color in Agent Trace. The live preview can align detection masks with display frames by capture time. The twin shows only the home, the CLOiD cone, lit rooms, device states, and the latest Agent Trace activity drawn where it happens: the leg of each move row (the running leg strong with a "name · output" tag at its end, finished legs as passed route), the goal ring and prepared route for goal and departure rows, a dot and a "name · output" tag at the target for pick, place, work, look, object, and guard rows, a line from the CLOiD cone while a close look runs, and the result in the device bubble for device rows. Step numbers, person tags, relation labels, and brain bubbles are not drawn. Objects without a known place (held, or with no surface) are not drawn, and tags are never cut off.

The Agent Trace lists activities oldest first, so the newest activity is at the bottom. While the reader is at the bottom, the panel follows new activities. Scrolling up keeps the position, and a **N new** pill counts the activities that arrived below; pressing it returns to the bottom. The feed groups rows by `activity_id` and applies revisions to the existing row ID. A running activity shows the current row's `NAME · INPUT`, and an ended one shows its result and reason. Expanding an activity lists its rows as `NAME · INPUT → OUTPUT` with the time taken. Related model calls nest under their active tool when the same activity has a recorded `cause_id`. An activity folds about two seconds after an explicit end or stop; earlier updates cannot reopen it, and the reader can still expand it. Observation rows without references (VLM 장면 해석, 사용자 상태 변화, 안전 상태) collect in one folded **지켜보기** activity. Public rows use fixed labels and scoped evidence references. See the [Trace contract](../src/contract/trace.ts).

`TWIN_STUDIO_DIR` selects a local twin asset tree (default `twin/`). `HOME_ID` overrides the default home in `homes.json`. `RUNTIME_DIR` contains the SQLite history database and per-home settings. One server or setup operation may hold its exclusive lock at a time. Stop the process using a runtime directory before resetting that directory. Back up the runtime volume before replacing it.

## Runtime settings

| Setting | Default | Purpose |
|---|---|---|
| `HOST`, `PORT` | `127.0.0.1`, `8200` | Dashboard HTTP server. Outside a container, only loopback addresses are accepted. |
| `PHONE_HOST`, `PHONE_PORT` | `127.0.0.1`, disabled unless configured | Phone HTTP and WebSocket server. Outside a container, only loopback addresses are accepted. Phones connect through `tailscale serve` HTTPS. `PHONE_URL` sets that URL. |
| `ALLOWED_ORIGINS` | Unset | Additional permitted origins. |
| `REDIS_URL` | Unset | Connect stage nodes through Redis, or use the in-process bus when unset. |
| `BRAIN` | Enabled in the example configuration | Enables observation and decision-making. |
| `ENGINE_FRAME_MS` | `100` | Interval between phone engine frames. |
| `VLM_FRAME_MS` | `2000` | Normal scene sampling interval. Search and inspection can request faster sampling. |
| `VLM_WINDOW_FRAMES` | `5` | Maximum number of images in a scene request. |
| `BRAIN_YOLO_PATH`, `BRAIN_POSE_PATH` | Segmentation and pose ONNX files under `models/` | Local perception models. `BRAIN_POSE_EVERY` controls pose sampling. |
| `PAM_TRIGGER` | `periodic` | Select periodic or event-driven decisions. `PAM_PERIOD_MS` overrides the periodic interval. |
| `HISTORY_TZ_MINUTES`, `REFLECT_AT` | `540`, `23:30` | Local day boundary and scheduled reflection time. |
| `FINISH_DAY` | Off | `1` adds a finish-day button to the dashboard settings dialog. It reflects on today and moves the system day forward by one; the clock time stays (`day_skips`). Blocked in live mode. No undo: start a new demo folder. |
| `KEEP_HEARD_TEXT` | Off | Controls retention of speech text. |
| `PHONE_VIDEO_DIR` | Repository `runtime/videos` | Source directory for phone video mode. Compose sets it to `/data/videos`. |
| `HUB`, `MATTER_TRANSPORT` | `matter`, `network` | Device hub and Matter transport. Compose uses local transport. |
| `THINQ_TOKEN` | Unset | Credentials for live appliances. Additional ThinQ settings control region, polling and readback. |
| `TV_RELAY_URL`, `TV_RELAY_TOKEN`, `TV_RELAY_DEVICE` | Unset | In live mode, the TV with ID `TV_RELAY_DEVICE` is controlled and read through the TV relay. The URL must use `https`, or `http` with a loopback or Tailscale IP (`100.64.0.0/10`). A partial setting, another `http` address, or a learned TV power key in `remotes.json` for the same TV stops startup. `TV_RELAY_TARGET`, `TV_RELAY_POLL_MS` (2000), `TV_RELAY_TIMEOUT_MS` (3000) and `TV_RELAY_COMMAND_TIMEOUT_MS` (60000) are optional. [TV relay](../hardware/ir-bridge/README.md#without-a-light-sensor-use-the-tv-relay) |
| `IR_FAKE` | Unset | `1` adds a simulated IR board (`FAKE`) to the IR port list, so the app registration flow works without the kit. [IR board](../hardware/ir-bridge/README.md) |
| `CALL_SERVICE_URL` | Unset | Optional external service for approved contact requests. |

Set `INFERENCE_MODE` to `openai` for hosted inference or `vllm` for local model endpoints. Use `VLM_BASE_URL` and `PAM_LLM_BASE_URL` to override them independently. The voice and planning agent uses the configured OpenAI or Anthropic provider. See the [deployment settings](deploy.md) and the [example configuration](../.env.example) for provider, GPU, Matter and retention settings.

## HTTP and event interfaces

Routes are implemented under [src/server/routes](../src/server/routes) and [src/server/setup](../src/server/setup). Replace `:id` with the identifier returned by the corresponding list endpoint.

| Endpoints | Purpose |
|---|---|
| `GET /api/health` | Server status, selected home, phone URLs and component readiness. |
| `GET /api/homes`, `GET /api/scene`, `GET /api/layout` | Available homes, active scene and layout edits. Save or reset edits with `POST /api/layout/save` or `POST /api/layout/reset`. |
| `GET /api/setup`, `POST /api/setup/home`, `POST /api/setup/devices`, `POST /api/setup/done` | Read setup progress and `mobile_urls`, choose a home and its devices, then finish setup. `android_twa` reports the selected camera origin when available. `POST /api/setup/mode` selects device operation mode. |
| `GET /api/setup/thinq`, `POST /api/setup/pairs` | List available ThinQ appliances and save their pairings. |
| `POST /api/mobile/client-error` | The Android app reports a screen it could not draw. The hub writes an `[앱 오류]` line with the stack to its log. Accepts only `message`, `stack`, `component_stack`, `app_version` and `at_ms`, up to 16KB and 10 reports a minute. |
| `GET /api/rooms`, `GET /api/devices`, `GET /api/devices/:id` | Inspect room and device IDs, capabilities and current state. Filter the list by `room` or `kind`. |
| `POST /api/devices/:id/command`, `POST /api/devices/:id/twin`, `POST /api/sensors/:id` | Request a device action, submit a twin attribute or update a sensor. Controllable attributes go through command policy. |
| `POST /api/agent/chat`, `GET /api/agent/pending`, `POST /api/agent/confirm`, `POST /api/agent/cancel` | Start or continue a conversation and resolve its pending approvals. |
| `GET /api/matter`, `POST /api/matter/commissioning-window` | Inspect the bridge and open a commissioning window. |
| `GET /api/brain`, `GET /api/world`, `GET /api/decisions` | Read perception and inference status, the current World State and recent decisions. |
| `GET /api/history`, `GET /api/history/day/:day`, `GET /api/memory/day/:day` | Read events, one day's records or its active memory. Use `YYYY-MM-DD` for dates. |
| `POST /api/reflection/run` | Request reflection on recorded experience. |
| `GET /api/phone/start-pose`, `POST /api/phone/start-pose` | Read or set the phone's starting pose. Other controls are `POST /api/phone/start-pose/preview`, `POST /api/phone/start-pose/clear` and `GET /api/phone/sync`. |
| `GET /api/plan`, `POST /api/plan`, `POST /api/plan/:id/steps/:stepId` | Read, publish and advance a plan. See the [plan contract](plan-contract.md) for write authorization and revisions. |
| `/events` (WebSocket) | Sends an initial home snapshot and then changes to devices, plans, observations, approvals, goals, robot activity, and dashboard messages. `hello.trace_epoch` scopes the public `trace` snapshot and subsequent revisions. See [event types](../src/contract/events.ts). |

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

On the HTTPS web phone home, tap **클로이드 켜기** to start WebXR in the page. In the installed Android app, the same button opens `/phone/` through Chrome TWA. On `/phone/`, tap **카메라 켜기** and grant the required permissions. At the saved starting position, face the saved direction and tap **여기서 시작**. Camera poses and capture timestamps tie observations to the digital twin. Keep the intended appliance in view when a step asks for visual confirmation. A suspected fall or a risky appliance can take priority over an ordinary instruction.

The phone uses the browser's speech recognition and synthesis when available. Spoken replies are scoped to the question or step visible when the person starts speaking. Explicit new instructions and reminders can speak in Korean. A duplicate delivery or a restored command on reconnect keeps the text without speaking it again. The phone pauses listening while it speaks and keeps the relevant answer buttons available.

For prerecorded input, open `/phone/?clip=<file>`. The phone server serves supported clips from `PHONE_VIDEO_DIR`. Configure the home's starting pose before playback. Optional `fov`, `pitch` and `h` describe the camera. Step clips are repeatable (kinds: go, pick, place, do). Matching clips are consumed in the order listed. When a step clip ends, its last frame is held. When the initial clip ends, its last frame is also held. This keeps camera input available for pending checks. Video mode uses the same plan and completion rules as the physical phone.

The video checker reads page telemetry, including `window.__noonchiVideo = { t0, ended, hold, commands: [{ video_ms, id, step, text }], clips: [{ video_ms, clip, duration_ms }], sync: [[server_ms, video_ms]], at }`. Capture timestamps synchronize the video timeline with server events. Use `npx tsx scripts/video-check.ts --help` for the supported options.

## Appliances and approvals

During setup, pair live devices with supported ThinQ adapters. The [device registry](../src/devices/kinds.ts) defines names, profiles, camera evidence, and confirmation rules. Twin commands and voice requests both pass through policy checks. An approval applies to the displayed request. A plan that turns on a risky appliance continues tracking it until valid off evidence arrives. The current plan response lists open switch-off reminders.

### Connect an MCP client

Start the NOONCHI server, then configure the client to launch `npx tsx src/agent/mcp/server.ts` from the repository root using stdio. Set `TWIN_HOME_URL` if the REST server is hosted elsewhere. Call `find_devices` or `list_devices` to resolve a label to a device ID before requesting a change. A tool result containing `needsConfirmation` identifies a pending action. Show the proposed action to the user and pass the token to `confirm_action` only after approval. See the [MCP server](../src/agent/mcp/server.ts).

### Connect a Matter controller

For a physical controller on the local network, run the Matter bridge with network transport. The default Compose setup uses local transport. Read `GET /api/matter` for bridge information and use `POST /api/matter/commissioning-window` when the controller needs a fresh pairing window. Enter the pairing code in the controller. Preserve the bridge's Matter storage between restarts to retain existing pairings.

## Troubleshooting

- **Phone cannot start AR.** Open the hub HTTPS URL in Android Chrome on a device that supports WebXR AR. Check the browser's camera permission for the hub and close any AR session in another tab. If the camera opens but the phone cannot connect, check the WebSocket upgrade for `/mobile/phone-events` and use the same tailnet as the dashboard. The AR settings show microphone guidance when voice input is off or blocked.
- **Android camera launch is blocked.** Check the `android_twa` URLs and package in `GET /api/setup`. Fetch `assetlinks_url` on the exact `/phone/` origin and port and verify the installed APK's public certificate fingerprint. The TWA uses `/phone/events` on the camera origin. Confirm the address bar is absent and WebXR starts on the physical phone. [TWA deployment](deploy.md#android-camera-twa)
- **The Android app shows 「화면을 열지 못했어요」.** Read the `[앱 오류]` lines in the hub log for the error, stack and screen components, then press 「다시 시도」 in the app. The app reports only while it is connected to a hub.
- **A model is unavailable.** Check `/api/health`, endpoint URLs and credentials. In GPU mode check the model IDs returned by each endpoint.
- **Device state does not change.** Check the selected home, device ID, supported commands and pending approvals. For a paired appliance, inspect ThinQ readback before retrying.
- **Runtime is locked.** Stop the server or setup process holding the same runtime directory before restarting or running a fresh demo.
