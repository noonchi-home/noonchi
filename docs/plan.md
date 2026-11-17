# twin-home 계획: Matter 기반 가상 가전 + 에이전트 제어

> 여러 에이전트가 함께 쓰는 약속(계약) 문서다. 인터페이스·형식을 바꾸려면 이 문서를 먼저 고친다.

**Goal:** twin-studio가 만든 아파트 트윈의 가전을 **가상 Matter 기기**로 띄우고, 에이전트(LLM)에게 자연어로 요청해 켜고 끌 수 있게 한다. 바뀐 상태는 3D 트윈 화면에 실시간으로 반영된다.

**왜 Matter인가:** 실제 스마트홈 표준(CSA Matter 1.4)의 기기 종류·클러스터·명령을 그대로 쓴다. 그래서 나중에 실제 컨트롤러(Home Assistant, SmartThings, Google Home)나 실제 기기로 바꿔 끼울 수 있다.

**SSOT와의 관계:** SSOT는 "실제 로봇·가전 제어"를 1차 범위 밖으로 둔다. 여기서 다루는 것은 트윈 속 가상 기기라 그 제외 항목에 걸리지 않는다. SSOT에는 아직 Matter가 없으므로, 채택하면 docs 레포에 반영해야 한다(팀 결정).

## 구조

```
twin-studio (Blender)                twin-home (Node 22 + TypeScript)
 apartment/scene.json  ──────────▶  devices: scene.json의 상태 있는 객체 → DeviceSpec
 apartment/assets/*.glb               │
 apartment/viewer/  ◀── WebSocket ──  server: REST + WS(상태 스트림) + 웹 화면(기기 패널 | 3D 트윈 | 채팅)
   (live.mjs, ?live=) ── POST /twin ─▶
                                      │
                                      hub: DeviceHub 인터페이스
                                      ├─ MemoryHub      (테스트, Matter 없이)
                                      └─ MatterHub      matter.js 컨트롤러 ⇄ (로컬 네트워크) ⇄ matter.js 브리지(가상 가전 엔드포인트들)
                                      │
                                      agent: LLM 도구 호출 루프 + 승인 정책     mcp: MCP stdio 서버(같은 도구, HTTP로 server 호출)
```

- **브리지**: matter.js `ServerNode` 하나에 Aggregator 엔드포인트를 두고, 가전마다 Bridged 엔드포인트를 둔다. `BridgedDeviceBasicInformation.nodeLabel`은 한국어 이름(예: "거실 TV")이다. 페어링 코드를 출력하므로 같은 LAN의 실제 컨트롤러도 붙일 수 있다.
- **컨트롤러**: matter.js 컨트롤러가 브리지를 커미셔닝한다(저장 폴더 `.matter/`). 이후 속성 읽기/쓰기, 명령 호출, 구독을 한다. 네트워크 커미셔닝이 막히는 환경을 위해 `transport: "local"` 모드도 둔다. 이 모드는 같은 프로세스의 브리지 엔드포인트를 matter.js 동작(behavior) API로 직접 다룬다. Matter 데이터 모델은 그대로 쓰고 네트워크만 건너뛴다.
- **진실의 원천**: 기기 상태의 원천은 Matter 속성이다. 트윈 상태(`power: on` 등)는 매핑 표로 거기서 계산한다.

## 기기 매핑 (twin-studio 카탈로그 `attrs` ↔ Matter)

| twin 종류 | twin attrs | Matter 기기 종류 | 클러스터 | 매핑 / 제어 |
|---|---|---|---|---|
| ceiling_light, ceiling_panel, pendant_lamp, floor_lamp, bedside_lamp, desk_lamp | power | Dimmable Light | OnOff, LevelControl | power ↔ OnOff.onOff, 밝기 |
| downlight | power | On/Off Light | OnOff | power ↔ onOff |
| tv | power | Basic Video Player (없으면 On/Off Plug-in Unit) | OnOff | power ↔ onOff |
| speaker | power | Speaker | OnOff, LevelControl | power ↔ onOff, 음량 |
| monitor, kettle, rice_cooker | power | On/Off Plug-in Unit | OnOff | power ↔ onOff |
| stand_ac, wall_ac | power | Room Air Conditioner | OnOff, Thermostat, FanControl | power ↔ onOff, 설정 온도·모드·바람 |
| air_purifier | power | Air Purifier | FanControl | power on ↔ fanMode ≠ Off |
| humidifier, vent_fan | power | Fan | FanControl | power on ↔ fanMode ≠ Off |
| range_hood | power | Extractor Hood | FanControl | power on ↔ fanMode ≠ Off |
| induction_counter | power | Cooktop | OnOff (+ Cook Surface 자식은 선택) | power ↔ onOff, **켜기는 승인 필요** |
| microwave | power | Microwave Oven | OperationalState | power on ↔ Running, start/stop, **시작은 승인 필요** |
| dishwasher | running, door | Dishwasher | OperationalState (+ 문 센서) | running ↔ Running, start/stop. door는 센서 |
| washer | running, door | Laundry Washer | OperationalState | running ↔ Running. door는 센서 |
| dryer | running | Laundry Dryer | OperationalState | running ↔ Running |
| fridge | door | Refrigerator | (문 = 센서) | door는 센서(RefrigeratorAlarm 또는 BooleanState) |
| robot_vacuum | running | Robotic Vacuum Cleaner | RvcRunMode, RvcOperationalState | running ↔ 청소 모드 |
| curtain_290, curtain_250, blind_175 | curtain / blind | Window Covering | WindowCovering | open ↔ 열림 100%, closed ↔ 0% |
| door_main | lock, door | Door Lock (+ Contact Sensor) | DoorLock, BooleanState | lock ↔ lockState, **잠금 해제는 승인 필요**. door는 센서 |
| door_room_*, door_bath_*, door_glass_*, door_fire_*, sliding_door_* | door | Contact Sensor | BooleanState | 센서(에이전트가 못 바꿈) |
| sink_counter, utility_sink (faucet), shower_booth (water) | faucet / water | Water Valve | ValveConfigurationAndControl | on ↔ 열림 |
| boiler | heating | Thermostat | Thermostat | heating on ↔ systemMode Heat |
| robot_dock, vacuum_dock, stick_vacuum | charging | (기기 아님, 상태 표시만) | — | 센서 |
| wall_pad, robot | screen / mode | (Matter 기기 아님) | — | twin 전용 |

- matter.js 0.17에 없는 기기 종류는 가장 가까운 종류로 대체한다(예: On/Off Plug-in Unit). 대체한 것은 README에 적는다.
- **센서**(문 열림, 충전 중)는 에이전트가 바꿀 수 없다. 세계 시뮬레이션 API(`POST /api/sensors/:id`)나 트윈 화면에서 사람이 바꾼다.

## 인터페이스 (src/contract/devices.ts)

```ts
type DeviceKind = "light" | "plug" | "tv" | "speaker" | "aircon" | "purifier" | "fan" | "hood" | "cooktop"
  | "microwave" | "dishwasher" | "washer" | "dryer" | "fridge" | "vacuum" | "covering" | "lock"
  | "contact" | "valve" | "thermostat" | "status";
interface DeviceSpec { id: string; label: string; room: string; roomLabel: string; twinType: string;
  kind: DeviceKind; matterDeviceType: string; capabilities: Capability[]; sensors: string[];   // twin attr 이름
  twinAttrs: Record<string, unknown[]>; }
type Capability = "onoff" | "level" | "climate" | "fan" | "covering" | "lock" | "operation" | "valve";
interface DeviceState { id: string; online: boolean;
  twin: Record<string, unknown>;              // twin-studio state 값 (scene.json states와 같은 키/값)
  matter: Record<string, unknown>;            // 보기 좋은 Matter 속성 요약 (onOff, level, lockState, fanMode, operationalState, setpoint...)
  updatedAt: string;
  signal?: "none";                            // 신호 없는 기기: 상태를 모름(twin·matter 비움, 아래 「설정 흐름」)
  readback?: { source: "thinq"; deviceId: string; at: string };   // 실제 가전(ThinQ)에서 읽은 값(아래 「운영 모드」)
  vision?: { twin: Record<string, unknown>; at: string; applied: boolean }; } // 카메라로 본 값(applied: 실제 출처가 없어 이 값이 상태, docs/world-vocabulary.md)
type Command =
  | { type: "on" } | { type: "off" } | { type: "level"; percent: number }
  | { type: "climate"; mode?: "cool" | "heat" | "auto" | "dry" | "fan"; setpointC?: number; fan?: "low" | "medium" | "high" | "auto" }
  | { type: "covering"; openPercent: number } | { type: "lock" } | { type: "unlock" }
  | { type: "start" } | { type: "stop" } | { type: "pause" } | { type: "valve"; open: boolean };
interface CommandResult { ok: boolean; state?: DeviceState; error?: string;
  needsConfirmation?: { token: string; reason: string };
  outcome?: "done" | "unverified" | "failed" | "not_sent";        // ThinQ 명령 결과(아래 「운영 모드」)
  execution?: { id: string; route: "thinq"; target: string } }
interface DeviceHub {
  start(): Promise<void>; stop(): Promise<void>;
  list(): DeviceSpec[]; get(id: string): DeviceState | undefined; states(): DeviceState[];
  command(id: string, cmd: Command): Promise<CommandResult>;      // 정책 검사는 상위(policy)에서
  setSensor(id: string, attr: string, value: unknown): Promise<CommandResult>;
  subscribe(cb: (s: DeviceState) => void): () => void;
}
```

## 서버 (src/server)

- `GET /api/rooms`, `GET /api/devices`(spec + state), `GET /api/devices/:id`
- `POST /api/devices/:id/command` `{command, confirmToken?}`: 정책을 거친다. 승인이 필요하면 `409 {needsConfirmation}`을 돌려준다.
- `POST /api/sensors/:id` `{attr, value}`
- `POST /api/devices/:id/twin` `{attr, value, confirmToken?}`: 3D 트윈에서 바꾼 twin 상태. 센서 attr은 센서, 제어 attr은 명령(`twinChange`: lock/unlock, covering 100/0, 나머지 on/off)으로 바꿔 **정책을 거친다**. 200 `{ok, state, via, command?}` / 400 / 404 / 409 `{needsConfirmation, command}`.
- `POST /api/agent/chat` `{message, sessionId}` → `{reply, actions:[...], pendingConfirmations:[...]}`
- `POST /api/agent/confirm` `{token}`
- `GET /api/matter`: 전송·커미셔닝 상태·페어링 코드(Matter 허브일 때만). `POST /api/matter/commissioning-window` `{timeoutSeconds?}`: 같은 LAN의 다른 Matter 컨트롤러(Home Assistant 등)용 페어링 창을 연다(multi-admin, network 전송일 때만).
- `GET /events`(WebSocket): `{type:"state", state}`, `{type:"agent", ...}`
- 정적 파일: `web/`(기기 패널 + 3D 트윈 iframe + 채팅). twin-studio의 `apartment/`를 `/twin/`에 붙인다(뷰어는 `/twin/viewer/?live=auto`).
- 기본 포트 8200.
- 허브 기본값은 `HUB=matter`, `MATTER_TRANSPORT=network`다. network 커미셔닝이 제한 시간(`MATTER_COMMISSION_TIMEOUT_MS`, 기본 30초) 안에 안 되면 경고 한 줄을 찍고 local 전송으로, local도 실패하면 MemoryHub로 대신 뜬다.

## 에이전트 (src/agent)

- 도구(MCP와 같은 이름·스키마):
  - `list_rooms`, `list_devices{room?,kind?}`, `find_devices{query}`(한국어 이름 부분 일치·방 이름), `get_state{device_id}`
  - `turn_on`, `turn_off`, `set_level{percent}`, `set_climate{...}`, `set_covering{open_percent}`
  - `lock`, `unlock`, `start`, `stop`, `set_valve{open}`
- 승인 정책(`src/agent/policy.ts`): 현관 잠금 해제, 인덕션 켜기, 전자레인지 시작은 **사용자 승인 후 실행**한다. 도구가 `needsConfirmation`을 돌려주면 에이전트는 실행하지 말고 사용자에게 확인을 묻는다. 화면의 승인 버튼이나 다음 메시지의 "응"으로 확정한다.
- LLM 공급자:
  - `AGENT_PROVIDER=openai|anthropic`. 자동 선택은 ANTHROPIC_API_KEY가 있으면 anthropic(claude-opus-5-5), 없으면 openai(OPENAI_MODEL, 기본 gpt-5.5)다.
  - 키가 없어도 다른 공급자로 바꾸지 않는다. 에이전트는 준비 안 됨(`/api/health` `ready.agent`)이고 대화가 실패한다.
  - 테스트는 같은 OpenAI 공급자를 가짜 OpenAI 호환 서버(`OPENAI_BASE_URL`)에 붙인다. 가짜 서버가 사용자 말마다 정한 도구 호출을 낸다.
- 시스템 프롬프트: 한국어. 방·기기 목록 요약, 승인 규칙, 실행 후 결과를 짧게 보고하라는 지시.
- `.env`에서 키를 읽는다. 키를 로그에 출력하지 않는다.

## MCP 서버 (src/agent/mcp/server.ts)

- stdio. 위 도구를 그대로 노출하고, 실행 중인 twin-home 서버의 REST(`TWIN_HOME_URL`, 기본 http://127.0.0.1:8200)를 부른다.
- 그래서 Claude Code나 Claude Desktop이 그대로 에이전트가 된다.
- README에 `claude mcp add twin-home -- npx tsx src/agent/mcp/server.ts` 예시를 적는다.

## 기기 목록 만들기 (파일 읽기 src/layout/twin-files.ts, 가전 만들기 src/devices/devices.ts)

- 집: twin-studio `homes.json`에서 `HOME_ID`(없으면 `default`)로 고른다(`src/layout/homes.ts`, 아래 "집 고르기").
- 1순위: 그 집 `<out>/scene.json`의 objects 중 `attrs`가 있는 것.
- 없으면 그 집 `<data>`의 `placement.json` + `floorplan.json`(문) + 카탈로그를 읽는다.
- 카탈로그: `<data>/catalog` → 공용 `data/catalog` → (옛 체크아웃) `data/apartment/catalog` 순서로 찾는다.
- 경로는 `TWIN_STUDIO_DIR`(기본 저장소 `twin/`)이다. `twin/`은 twin-studio 결과물을 `scripts/twin-assets.ts`로 복사한 폴더다.
- twin 상태 초기값은 `state` 또는 catalog `states.*.default`다.

## 3D 트윈 연결 (2단계, 완료 2026-10-11)

- twin-studio 뷰어(`apartment/viewer/live.mjs`, `main.mjs`의 훅 몇 줄)에 `?live=auto`(같은 호스트 `/events`) 또는 `?live=ws://127.0.0.1:8200/events`를 주면 스냅숏과 state 이벤트를 받아, 그 객체가 가진 twin attr만 `aptViewer.setState`로 반영한다. 모르는 id·attr·값은 무시하고 센다(상태 칩). 끊기면 1~15초 간격으로 다시 붙는다.
- 뷰어 가전 패널에서 바꾼 값은 연결된 동안 로컬에서 바꾸지 않고 `POST /api/devices/:id/twin`으로 보낸다(원격 반영 중에는 보내지 않음 → 되울림 없음). 409면 스위치를 되돌리고 승인 알림(승인 → `POST /api/agent/confirm`)을 띄운다.
- twin-home 웹 화면은 뷰어를 iframe(`/twin/viewer/?live=auto&embed=1`)으로 넣는다. 넓은 화면 `카드 | 3D | 대화`, 폰은 탭. `/twin/`이 없으면 숨기고 이유를 보인다.
- 3D에는 twin attr만 있다(밝기·온도·바람·커튼 %는 없음).

## 폰 AR 눈 (3단계)

- `PHONE_PORT`(예: 8210)를 주면 폰 전용 서버가 `PHONE_HOST`(기본 0.0.0.0)에 뜬다. 주는 것은 `/phone/`(페이지)과 `/phone/events`(WebSocket)뿐이다. 기기 API는 본 서버(127.0.0.1)에만 있다.
- 폰 → 서버: `{type:"pose", position:[x,y,z], orientation:[x,y,z,w], tracking:"ok"|"limited", hit:[x,y,z]|null, hit_estimated}`(WebXR local 공간, 초당 10번, hit_estimated는 조준점이 어림 바닥 점일 때 true) · `{type:"start"}`(시작 자리에서 「여기서 시작」) · `{type:"surface", points}`(실제 hit 점) · `{type:"reset"}`. 서버 → 폰: `{type:"status", aligned, sync, error?}`.
- 위치 맞추기는 `src/phone/sync/`가 한다: 설정에서 저장한 시작 자리·방향(어림), 걸으며 보이는 큰 가구(YOLO26s), 벽 모양(hit-test 벽 점 ICP). 결과는 수평 회전·이동·바닥 높이(`src/shared/geometry.ts` `Alignment`)다. 자세한 규칙은 [reference.md](reference.md) "위치 맞추기".
- 맞춘 뒤 자세는 본 서버 `/events`로 `{type:"eye", eye:{position:[x,y], height_m, yaw_deg, pitch_deg, tracking, at}}`가 된다. 뷰어는 `aptViewer.setEye`로 눈 마커만 움직인다. 판단에는 쓰지 않는다.
- WebSocket은 페이지를 준 호스트와 같은 출처만 받는다.
- 카메라(WebXR `camera-access`): 폰은 `/phone/events`에 바이너리 패킷 `[헤더 길이 4바이트 BE][JSON 헤더][JPEG]`(`src/phone/packet.ts`, 최대 4MB)을 보낸다. 헤더 `{kind:"frame"|"photo", width, height, position?, orientation?, tracking?}`. `frame`은 기본 초당 12장·가로 480px·품질 0.55(폰 주소 `?fps=`·`?w=`로 바꾼다, 인코딩 중이거나 와이파이에 쌓이면 건너뜀), `photo`는 카메라 원본 크기.
- 본 서버(127.0.0.1)의 `GET /api/eye/stream`(MJPEG, 연결에 못 보낸 데이터가 남아 있으면 프레임을 줄 세우지 않고 가장 새 한 장만 들고 있다가 비면 보낸다), `/api/eye/frame.jpg`(최신), `/api/eye/photos/<id>.jpg`, `/api/eye/stats`(최근 2초 받은 fps·장당 KB·마지막 크기, 대시보드 눈 캡션에 fps). 실시간 화면은 표시 전용이며 엔진 입력이 아니다.
- `photo`는 `PHONE_PHOTO_DIR`(기본 `runtime/photos/`)에 JPEG·JSON으로 저장하고 `/events`로 `{type:"photo", photo:{id, at, url, width, height, measured_pose, pose_note?}}`를 보낸다. 맞추기 전이면 `measured_pose: null`, `pose_note: "not_aligned"`. 폰에는 `{type:"photo_saved", id, aligned}`.

## 집 고르기·배치 보정·음성·초점 (4단계)

상세 계획: [2026-10-24-home-packages-live-edit.md](superpowers/plans/2026-10-24-home-packages-live-edit.md).

**A. 집 고르기** (twin-studio `homes.json`)
- `{ version, default, viewer, library, homes: [{ id, name, data, out }] }`. 경로는 twin-studio 루트 기준. 없으면 아파트 한 집(`data/apartment`, `apartment`).
- twin-home은 `HOME_ID`로 집 하나를 불러온다. 정적 경로: `/twin/viewer/*` → `viewer`(모든 집 공용 뷰어), `/twin/lib/*` → `library`(모든 종류 GLB), `/twin/*` → 그 집 `out`. 대시보드 뷰어 주소는 그대로 `/twin/viewer/?live=auto&embed=1`.
- 폰 시작 자리는 집마다 `RUNTIME_DIR/homes/<id>/phone-start.json`이다.

**B. 보정 수정본** `RUNTIME_DIR/homes/<id>/edits.json`(기본 `runtime/`, 커밋하지 않음)
- `{ version: 1, home, saved_at, edits: [...] }`. edits: `{op:"move", id, position:[x,y], facing_deg, room}` · `{op:"add", id, type, label, room, position, facing_deg, elevation?}`(벽걸이는 elevation) · `{op:"remove", id}`.
- id마다 최종 결과 하나: 더한 뒤 지움 → 없음, 더한 뒤 옮김 → add(최종 자리), 원래 자리로 돌아오면 없음.
- twin-home은 twin-studio 파일을 고치지 않는다. 반영은 twin-studio `python -m studio apply-edits --home <id> <edits.json>` → 빌드 → twin-home 재시작. 다시 시작하면 저장해 둔 수정본을 다시 적용한다(이미 원본에 반영된 것은 건너뛴다).
- 추가한 가전은 반영·빌드·재시작 뒤에야 Matter 기기가 된다(실행 중 Matter 기기 추가는 하지 않는다).

**C. `/events` 추가 메시지**
- `{type:"layout", op:"move", id, room, plan:{position, facing_deg, elevation}, position:[x,h,y], rotation:[0,ry,0]}` (`ry = -(facing_deg - 90)°`)
- `{type:"layout", op:"add", object:<scene.json 객체 모양 + footprint·height>}`: `asset`은 집 `assets/…` → `lib/assets/…` → `null`(뷰어가 회색 상자).
- `{type:"layout", op:"remove", id}`. 받침을 옮기거나 빼면 위에 놓인 물건도 같이 움직이거나 빠진다.
- 붙을 때 지금 보정 상태를 위 메시지로 다시 보낸다. 되돌리기는 반대 메시지들이다.
- `{type:"focus", focus:{targets:[{id, label, position:[x,h,y]}], at, ttl_ms}}`: 클로이드가 방금 다룬 물건(에이전트 도구가 성공했거나 승인을 기다리는 대상). 높이는 물건 가운데(천장 물건은 아래로). 표시 전용.

**D. 폰 `/phone/events` 추가 메시지**
- 폰 → 서버: `pose`에 `hit:[x,y,z]|null`(조준점이 닿은 바닥 점) · `{type:"say", text}`(음성 인식 결과·글, 500자까지) · `{type:"confirm"|"cancel", token}`.
- 서버 → 폰: `{type:"reply", text, pending:[{token, deviceLabel, reason}]}` · `{type:"focus", targets:[{id, label, ar:[x,y,z]}], ttl_ms}`(맞춘 뒤에만).
- '여기' = 맞춘 뒤 마지막 자세의 조준점(평면도). 15초 넘게 자세가 없거나 조준점이 바닥에 닿지 않았으면 이유를 돌려준다.
- 폰 말은 에이전트 세션 `phone` 하나로 이어진다. 대시보드 로그에도 `🎙 폰:`으로 보인다.

**E. 배치 도구** (서버 안 에이전트 전용, MCP에는 없음) `find_objects`, `move_object(object_id, to?:"here", x?, y?, dx?, dy?, facing_deg?, turn_deg?)`, `add_object(type, label?, to?, x?, y?, facing_deg?)`, `remove_object`, `find_object_types`, `save_layout`. 평면도 좌표 +x 오른쪽, +y 아래쪽. 벽걸이는 가장 가까운 벽에 붙고, 바닥 물건을 '여기'로 옮기면 폰 쪽을 보게 놓는다.
- REST: `GET /api/layout`, `POST /api/layout/save`, `POST /api/layout/reset`, `GET /api/homes`.

## 설정 흐름 (5단계: 집 → 가전 → 위치 동기화 → 대시보드)

상세 계획: [2026-11-05-setup-flow.md](superpowers/plans/2026-11-05-setup-flow.md). 대시보드는 관찰만 하고, 설정은 `/setup/`에서 한다.

**A. 집 실행 묶음** (`src/server/home/`): 집 하나에 딸린 허브·정책·에이전트·배치 편집기·시작 자리·폰 서버·두뇌·앱. 집을 바꾸면 통째로 닫고 새로 만든다. 본 서버 포트는 껍데기 서버(`src/server/shell.ts`)가 계속 잡고 `/api/setup*`만 직접 처리하며, 나머지 요청과 `/events`는 지금 묶음의 앱으로 넘긴다. 폰 서버는 처음 잡은 포트를 다시 쓴다. 바꾸는 동안 다른 API는 503, 설정 화면 파일은 그대로 나온다. 실패하면 이전 집으로 되돌린다.

**B. 신호 출처** (`src/devices/hub/signals.ts`, 구현명세서 6.3 정보 확보 수단·7.1 `read_appliance`): 기기마다 `virtual`(트윈 시뮬레이터), `none`(신호 없음), `{ kind: "thinq", deviceId }`(실제 모드에서 ThinQ와 짝지은 기기, 아래 「운영 모드」).
- 엔진·대시보드는 `SignalHub`로 읽는다. `none` 기기는 상태가 `{ twin: {}, matter: {}, signal: "none" }`(모름)이고, 바뀌어도 `/events`에 보내지 않는다. 출처를 바꾸면 그 기기 상태를 한 번 보낸다.
- 명령(가상 실행)은 숨은 세계(안쪽 허브)에서 그대로 실행된다. `none` 기기는 결과도 모르므로, 숨은 세계가 상태 때문에 거절해도 `{ ok: true, state: 모름 }`으로 돌려준다(거절 이유가 숨은 상태를 드러냄). 정책의 사전 검사는 모르는 상태로 하지 않는다.
- 에이전트 도구는 `state: "모름"`, `signal: "none"`을 보고, 명령·승인 답은 「보냈지만 결과는 확인하지 못했어요」다.
- 3D 뷰어(twin-studio `live.mjs`)는 `signal: "none"` 상태를 받으면 화면 값을 그대로 두고, 그 기기 조작은 계속 twin-home으로 보낸다.

**C. 저장** (`src/server/setup/store.ts`, `npm start`만 파일에 쓴다)
- `RUNTIME_DIR/setup.json`: `{ version: 1, home, done, updated_at }`. 다른 집을 고르면 `done: false`.
- `RUNTIME_DIR/homes/<id>/signals.json`: `{ version: 1, home, sources: { <기기 id>: { kind } }, updated_at }`(virtual이 아닌 것만). 배치에서 빠진 기기 id는 읽을 때 버린다.
- 시작 집: 저장한 집 → (없거나 못 띄우면) `HOME_ID` → 기본 집. `startServer`(테스트·데모)는 파일을 읽지 않고 「끝냄」으로 시작한다.

**D. 설정 API** (쓰기는 같은 PC 출처만)
- `GET /api/setup` → `{ ok, persist, done, switching, error, home, homes, rooms, devices: [{ id, label, room, roomLabel, kind, kindLabel, source }], position: { start, layout, phone_urls } }`
- `POST /api/setup/home { home }`: 다른 집이면 묶음을 다시 만든다. 없는 집 400, 바꾸는 중 409.
- `POST /api/setup/devices { home, sources: { <id>: "virtual"|"none" } }`, `POST /api/setup/done { home }`: `home`이 지금 집과 다르면 409(다른 탭에서 바꿈).
- 설정 4단계의 `POST /api/phone/start-pose*`·`/api/layout/save|reset`도 `home`을 같이 보낸다(다르면 409).
- `/events`의 `hello`에 `home`(집 id)이 붙는다. 대시보드는 집이 바뀌면 새로 고친다.

## 테스트

- vitest, `npm test`.
  - 매핑 단위 테스트
  - MemoryHub
  - 정책(승인 토큰)
  - REST/WS(실제 서버를 임의 포트로)
  - 3D 트윈 → `POST /api/devices/:id/twin`(매핑, 센서, 정책 409 + confirm, 400)
  - MCP(클라이언트로 도구 목록·호출)
  - 에이전트(가짜 OpenAI 호환 서버의 도구 호출로 "거실 TV 켜줘" → turn_on(tv_living) → 상태 on, "현관문 열어줘" → 승인 요청 → 확정 후 unlocked)
  - 집 고르기(homes.json), 배치 편집기(옮기기·받침·벽 붙이기·더하기·빼기·되돌리기·수정본·다시 적용), 배치 도구와 가짜 서버의 배치 말, 폰 '여기'·말·승인·초점, 초점 투영, `HOME_ID` 통합(폰 "냉장고 위치 여기로 맞춰줘" → layout·focus), 추론 과정(reason·관찰)
- Matter 통합 테스트:
  - 브리지 + 컨트롤러를 띄워 실제로 커미셔닝한다(포트·저장 폴더는 임시).
  - 조명을 켜면 컨트롤러 구독으로 상태가 돌아온다.
  - 네트워크 모드가 이 PC에서 안 되면 원인을 기록하고 local 모드로 같은 테스트를 통과시킨다.
- `npm run demo`: 서버를 띄우고 셸의 키로 실제 LLM 에이전트에 시나리오 5개를 돌려 결과를 출력한다.

## 수용 기준

- `npm test`와 `npm run typecheck`가 모두 통과한다.
- `npm start`로 서버를 띄운다.
  - 웹 화면 채팅에 "거실 불 켜고 TV 꺼줘"를 입력하면 두 기기 상태가 바뀌고, 기기 패널과 WS 이벤트에 반영된다.
  - "현관문 열어줘"는 승인을 물은 뒤에만 열린다.
- MCP: `@modelcontextprotocol/sdk` 클라이언트로 `list_devices`, `turn_on`을 호출해 상태가 바뀐다.
- Matter: 브리지의 페어링 코드가 출력되고, 컨트롤러 경로(네트워크 또는 local)로 실제 Matter 속성이 바뀐다.
- `HOME_ID=oneroom PHONE_PORT=8210 npm start`: 폰이 조준한 바닥에서 "냉장고 위치 여기로 맞춰줘"라고 하면 3D 트윈의 냉장고가 그 자리로 옮겨지고 초점 고리가 보인다. "배치 저장해"면 `runtime/homes/oneroom/edits.json`이 생기고 twin-studio `apply-edits`가 읽는다.
