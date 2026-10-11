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
 apartment/viewer/  ◀── WebSocket ──  server: REST + WS(상태 스트림) + 웹 화면(채팅·기기 패널, 나중에 3D 트윈)
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

## 인터페이스 (src/hub/types.ts)

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
  updatedAt: string; }
type Command =
  | { type: "on" } | { type: "off" } | { type: "level"; percent: number }
  | { type: "climate"; mode?: "cool" | "heat" | "auto" | "dry" | "fan"; setpointC?: number; fan?: "low" | "medium" | "high" | "auto" }
  | { type: "covering"; openPercent: number } | { type: "lock" } | { type: "unlock" }
  | { type: "start" } | { type: "stop" } | { type: "pause" } | { type: "valve"; open: boolean };
interface CommandResult { ok: boolean; state?: DeviceState; error?: string;
  needsConfirmation?: { token: string; reason: string } }
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
- `POST /api/agent/chat` `{message, sessionId}` → `{reply, actions:[...], pendingConfirmations:[...]}`
- `POST /api/agent/confirm` `{token}`
- `GET /api/matter`: 전송·커미셔닝 상태·페어링 코드(Matter 허브일 때만). `POST /api/matter/commissioning-window` `{timeoutSeconds?}`: 같은 LAN의 다른 Matter 컨트롤러(Home Assistant 등)용 페어링 창을 연다(multi-admin, network 전송일 때만).
- `GET /events`(WebSocket): `{type:"state", state}`, `{type:"agent", ...}`
- 정적 파일: `web/`(채팅 + 기기 패널). 설정으로 twin-studio의 `apartment/`를 `/twin/`에 붙인다(3D 트윈, 2단계).
- 기본 포트 8200.
- 허브 기본값은 `HUB=matter`, `MATTER_TRANSPORT=network`다. network 커미셔닝이 제한 시간(`MATTER_COMMISSION_TIMEOUT_MS`, 기본 30초) 안에 안 되면 경고 한 줄을 찍고 local 전송으로, local도 실패하면 MemoryHub로 대신 뜬다.

## 에이전트 (src/agent)

- 도구(MCP와 같은 이름·스키마):
  - `list_rooms`, `list_devices{room?,kind?}`, `find_devices{query}`(한국어 이름 부분 일치·방 이름), `get_state{device_id}`
  - `turn_on`, `turn_off`, `set_level{percent}`, `set_climate{...}`, `set_covering{open_percent}`
  - `lock`, `unlock`, `start`, `stop`, `set_valve{open}`
- 승인 정책(`src/agent/policy.ts`): 현관 잠금 해제, 인덕션 켜기, 전자레인지 시작은 **사용자 승인 후 실행**한다. 도구가 `needsConfirmation`을 돌려주면 에이전트는 실행하지 말고 사용자에게 확인을 묻는다. 화면의 승인 버튼이나 다음 메시지의 "응"으로 확정한다.
- LLM 공급자:
  - `AGENT_PROVIDER=openai|anthropic|mock`. 자동 선택은 ANTHROPIC_API_KEY가 있으면 anthropic(claude-opus-5-5), 없으면 openai(OPENAI_MODEL, 기본 gpt-5.5)다.
  - 테스트는 `mock`(규칙 기반 가짜 LLM)을 쓴다.
- 시스템 프롬프트: 한국어. 방·기기 목록 요약, 승인 규칙, 실행 후 결과를 짧게 보고하라는 지시.
- `.env`에서 키를 읽는다. 키를 로그에 출력하지 않는다.

## MCP 서버 (src/mcp/server.ts)

- stdio. 위 도구를 그대로 노출하고, 실행 중인 twin-home 서버의 REST(`TWIN_HOME_URL`, 기본 http://127.0.0.1:8200)를 부른다.
- 그래서 Claude Code나 Claude Desktop이 그대로 에이전트가 된다.
- README에 `claude mcp add twin-home -- npx tsx src/mcp/server.ts` 예시를 적는다.

## 기기 목록 만들기 (src/model/devices.ts)

- 1순위: twin-studio `apartment/scene.json`의 objects 중 `attrs`가 있는 것.
- 없으면 `data/apartment/catalog/*.json` + `placement.json` + `floorplan.json`(문)을 읽는다.
- 경로는 `TWIN_STUDIO_DIR`(기본 `../twin-studio`)이다.
- twin 상태 초기값은 `state` 또는 catalog `states.*.default`다.

## 3D 트윈 연결 (2단계, twin-studio 뷰어가 끝난 뒤)

twin-studio 뷰어에 `?live=ws://127.0.0.1:8200/events`를 주면 상태 이벤트를 받아 `aptViewer.setState`로 반영한다. 화면에서 바꾼 상태는 `POST /api/devices/:id/command`(제어 가능한 것) 또는 `/api/sensors/:id`(센서)로 보낸다.

## 테스트

- vitest, `npm test`.
  - 매핑 단위 테스트
  - MemoryHub
  - 정책(승인 토큰)
  - REST/WS(실제 서버를 임의 포트로)
  - MCP(클라이언트로 도구 목록·호출)
  - 에이전트(mock 공급자로 "거실 TV 켜줘" → turn_on(tv_living) → 상태 on, "현관문 열어줘" → 승인 요청 → 확정 후 unlocked)
- Matter 통합 테스트:
  - 브리지 + 컨트롤러를 띄워 실제로 커미셔닝한다(포트·저장 폴더는 임시).
  - 조명을 켜면 컨트롤러 구독으로 상태가 돌아온다.
  - 네트워크 모드가 이 PC에서 안 되면 원인을 기록하고 local 모드로 같은 테스트를 통과시킨다.
- `npm run demo`: 서버를 띄우고 mock 에이전트로 시나리오 5개를 돌려 결과를 출력한다.

## 수용 기준

- `npm test`와 `npm run typecheck`가 모두 통과한다.
- `npm start`로 서버를 띄운다.
  - 웹 화면 채팅에 "거실 불 켜고 TV 꺼줘"를 입력하면 두 기기 상태가 바뀌고, 기기 패널과 WS 이벤트에 반영된다.
  - "현관문 열어줘"는 승인을 물은 뒤에만 열린다.
- MCP: `@modelcontextprotocol/sdk` 클라이언트로 `list_devices`, `turn_on`을 호출해 상태가 바뀐다.
- Matter: 브리지의 페어링 코드가 출력되고, 컨트롤러 경로(네트워크 또는 local)로 실제 Matter 속성이 바뀐다.
