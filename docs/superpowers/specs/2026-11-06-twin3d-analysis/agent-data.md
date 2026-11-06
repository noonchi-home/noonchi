# agent-data: 에이전트 자동 집중에 쓸 데이터와 View State Adapter 설계

기준: twin-home-glass `feat/glass-ui`(HEAD e50edf8, `src/contract/events.ts`는 HEAD와 같음), twin-home-mode `feat/control-mode`(2bfe990, 계획 문서만 더함), twin-studio `homes/mokryeon_180b/scene.json`. 8200 서버는 지금 마곡 집(`apartment`, mock 에이전트, `brain:false`)으로 떠 있어 목련 실제 이벤트는 없다.

## 0. 결론

- 스펙 8.1의 9개 항목 중 **바로 쓸 수 있는 것 2개**(CLOiD 위치, 결과), **화면에서 만들 수 있는 것 4개**(관찰 공간, 관찰 대상, 상호작용 대상, 재판단), **계약이 없어 서버를 고쳐야 하는 것 3개**(현재 목표, 계획 대상 공간, 실행 중 행동)다.
- 공간·물건이 이벤트에 직접 실려 오는 경우는 `agent` 행동의 `deviceId` 하나뿐이다. brain(컵 두뇌) 이벤트에는 방·물건 id가 하나도 없다. 서버는 비춘 식탁 id(`Presence.tableId`)를 계산하지만 대시보드로 보내지 않는다.
- 목련 데이터에는 **로봇 몸체(`robot`)·충전대·`plan.robot.reachable_rooms`·싱크대가 없다.** 그래서 `2026-11-06-agent-on-twin.md`의 `cupPlan`은 목련에서 `null`이고, 로봇 시작점은 `[0,0]`이 되어 경로를 못 찾는다. CLOiD 위치는 폰 눈 자세(`eye`)뿐이다(2026-10-24 결정: 폰 = CLOiD의 몸).
- 폰 눈의 맞추기 전 추정 위치는 목련에서 전면 발코니 `[12.183, 13.477]`, yaw 191.8°로 고정된다. 실제 위치가 아니므로 자동 집중·경로 시작점에 쓰지 않는다.
- 눈 이벤트에 **화각(FOV)이 없다.** 지금 뷰어 원뿔(반각 약 19.6°)은 그림일 뿐이다. 폰은 `xrView.projectionMatrix`를 이미 갖고 있어 보낼 수 있다.
- 설계: 이벤트 → `reduceAgentView`(순수 리듀서) → `FocusIntent` → `stepFocus`(순수 상태 기계) → 카메라 명령(번호 붙음). 둘 다 React 밖 저장소에서 돌고, 그리기 루프는 명령 번호만 읽는다.
- 실제·Mock 구분: 메시지 바깥에 `origin: "live" | "mock"`(없으면 live). Mock은 화면 안에서만 재생하고(서버·폰으로 안 감) 리듀서 인스턴스를 따로 쓴다. 「모의 행동」(`dryRun`), 「시험 모드」(기기 명령이 트윈으로만 감, control-mode)와는 다른 축이다.

## 1. 지금 `/events`로 오는 것

| 메시지 | 필드 | 시각 | 빈도·조건 | 출처 코드 |
|---|---|---|---|---|
| `hello` | devices, provider, hub, home | 없음 | 붙을 때 1번 | `src/server/app.ts:457` |
| `state` | DeviceState | 없음 | 붙을 때 전부, 바뀔 때마다 | app.ts:463 |
| `agent` `action` | sessionId, action{tool, args, ok, message, error, deviceId, deviceLabel, needsConfirmation, reason, observation, at} | `at` ISO(도구 **실행 뒤**) | 도구 호출마다. 시작 알림 없음 | `src/agent/agent.ts:222` |
| `agent` `reply` | sessionId, message(사용자 말), reply, actions[], pendingConfirmations[] | 없음 | 요청 끝날 때 | agent.ts:190 |
| `agent` `pending` | sessionId, pending{token, deviceId, deviceLabel, command, reason, expiresAt} | expiresAt만 | 승인이 필요할 때 | agent.ts:239 |
| `agent` `confirmed` / `cancelled` | token, ok, reply, deviceId | 없음 | 폰에서 승인·취소할 때(몇 분 뒤일 수 있음) | agent.ts:151, 163 |
| `brain` `brain` | stage, state, text, at_ms, evidence_age_ms, generation | `at_ms` 서버 Date.now | BRAIN=1일 때, 같은 글은 한 번(noteOnce) | `src/brain/machine.ts:148` |
| `brain` `request` | id, text, active | at_ms | 사진 요청 열고 닫을 때 | machine.ts:419, 161 |
| `brain` `action` | id, task, plan(ActionPlan: kind, would, dashboard, prompt, check), active | at_ms | 행동 시작(active true)·끝(false) | machine.ts:444, 452 |
| `brain` `result` | id, task, outcome, text | at_ms | 행동 끝 | machine.ts:453 |
| `brain` `perception` | summary, frames, cost_usd, evidence_age_ms, answer, error | at_ms | VLM 판정마다(약 1초 간격) | `src/brain/brain.ts:157` |
| `brain` `presence` | person, cup, table(yes/no/unknown), scores, summary | at_ms | YOLO 판정이 바뀔 때만. **tableId 없음** | brain.ts:101 |
| `eye` | position[x,y], height_m, yaw_deg, pitch_deg, tracking, at, estimated? | `at` ISO | 폰 AR 켜져 있을 때 **10Hz**(`web/phone/phone.js` SEND_MS=100). **FOV 없음** | `src/phone/session.ts:216,232` |
| `photo` | id, at, url, width, height, measured_pose(EyeEvent·null) | at ISO | 사진 찍기 | `src/phone/feed.ts:88` |
| `focus` | targets[{id,label,position(three [x,h,y])}], at, ttl_ms(8000) | at ISO | **기본 꺼짐**(사용자 요청, `FOCUS=1`일 때만) | `src/server/home.ts:193-205` |
| `layout` | 배치 보정 | – | 배치가 바뀔 때 | layout editor |

- 다시 붙으면 `hello`·`state`·`layout`만 온다. brain 상태·눈·계획은 다시 오지 않는다. brain은 `GET /api/brain`(LiveStatus.state)로 다시 읽을 수 있다.
- 전역 순번(seq)이 없다. 한 연결 안에서는 순서가 지켜지지만, 끊긴 사이에 빠진 것을 알 수 없다.
- `AgentAction.reason`은 계약 주석대로 「모델의 설명, 판단 근거 아님」이다. brain `text`는 상태 기계가 만든 글이라 스펙 9.2의 「시스템이 주는 요약」으로 쓸 수 있다.
- 기기 id = scene 물건 id, 기기 room = scene `plan.rooms` id(`src/model/devices.ts:140`). 목련 scene 물건 29개의 room 필드는 방 다각형 판정과 모두 맞는다(어긋남 0).

## 2. 스펙 8.1 대응표

| 항목 | 상태 | 지금 근거 | 모자란 것 | 만드는 법 |
|---|---|---|---|---|
| CLOiD 위치 | **있음(조건부)** | `eye` position·height·yaw·pitch·tracking, `estimated` | 방 id, FOV. 폰 AR이 꺼지면 없음. 목련에 로봇 몸체 없음 | 방: 화면에서 `roomAt(position)`. FOV: 폰이 `fov_deg`(세로·가로)를 함께 보냄(phone.js + session schema + EyeEvent 선택 필드). estimated면 「추정」 표시, 집중·경로에 안 씀 |
| 관찰 공간 | **만들 수 있음** | 눈 위치(맞춘 뒤), agent `list_devices` args.room, 읽기 도구 deviceId의 방 | 이벤트에 방 없음 | 리듀서가 deviceId→방, 눈 위치→방으로 계산 |
| 주요 관찰 대상 | **만들 수 있음(일부)** | agent 읽기 도구(`get_state` 등)의 deviceId. brain은 서버만 아는 `Presence.tableId`·`Acting.tableId` | brain이 어느 식탁을 보는지 화면이 모름. 목련 윗면은 dining_table·coffee_table·desk_small 3개 | 서버: `PresenceLog`에 `table_id?` 추가(`src/brain/brain.ts:101`, 1줄 + 계약 1줄). 없으면 화면에서 dining_table이 하나뿐일 때만 그것으로 두고 `inferred` 표시 |
| 현재 목표 | **없음(만들 수 있음)** | brain `action.task`(「컵 치우기」·「사용자에게 물어보기」). agent는 요청 글이 `reply.message`로 **끝날 때만** 옴 | agent 요청 시작 알림·목표 글 | 서버: `agent.ts handle()` 시작에 `{event:"turn", sessionId, message, at}` 한 번 내기. 계획 계약 `PlanView.goal` |
| 계획 대상 공간 | **없음** | ActionPlan에 대상 없음(`would` 글뿐) | 방·물건 id | `PlanView.steps[].target{room, objectId, deviceId}`(agent-on-twin Task 1·3) |
| 계획된 상호작용 대상 | **만들 수 있음(일부)** | agent `pending.deviceId`, `action.needsConfirmation`. 기기 행동은 실행 뒤에야 옴 | 실행 전 계획 | 승인 대기 = 상호작용 예정으로 본다. 그 밖은 PlanView |
| 실행 중 행동 | **없음(일부)** | brain `state: acting` + `action active:true`. agent 도구는 끝난 뒤 이벤트 | 시작·진행 상태 | `PlanView.steps[].status: active`. agent는 「방금 한 일」로만 보임 |
| 결과 | **있음** | agent `action.ok/error`, `confirmed.ok`, `cancelled`, brain `result.outcome` | – | 그대로 |
| 계획 수정·재판단 | **만들 수 있음(일부)** | brain `generation` 증가, stage `cancel`, `decide`의 「다시 판단」(contentsFlip), `result: withdrawn` | 이전·새 목표·경로 구조 | 리듀서가 진행 중 흐름에서 generation이 오르면 재판단으로 기록. 계획 계약에 `revision`, `supersedes` 추가 |

## 3. 기존 계획 `2026-11-06-agent-on-twin.md`와 합치기

상태: 문서만 있고 코드 없음(`src/plan/` 없음, ServerMessage에 `plan` 없음). 계획은 옛 iframe 뷰어(`aptViewer.THREE`, `useAnchors`, `projectPoint`) 기준이다.

그대로 쓴다:
- Task 1 `PlanView` 계약(`src/contract/plan.ts`), `{type:"plan", plan|null}`, `POST /api/plan`(task planner 입구). 평면 좌표 `[x, z]` = scene plan `[x, y]` = three `(x, ·, z)`.
- Task 2 `floorPlanFrom`·`roomAt`·`route`·`approach`. `roomAt`은 화면 리듀서도 같은 것을 쓴다.
- Task 3 `PlanHub`(서버에서 brain·agent 이벤트 → 계획), `labels.ts`(lint 대상).
- Task 4·5의 순수 함수 `ribbonPositions`·`pointAlong`·`currentStep`·`pinsByTarget`.

바꾼다:
1. `PlanView`에 선택 필드 3개: `revision: number`(같은 id 갱신마다 +1, 역순 거르기), `supersedes?: string`(재계획 때 이전 계획 id, 스펙 9.5), `origin?: "live" | "mock"`.
2. 로봇 시작점: `onEye`는 **맞춘 눈(estimated 아님)만** 받는다. 맞춘 눈이 없으면 `robot.position: null`, `path: []`. 목련은 `robot`·`dock`·`reachable_rooms`가 없어 지금 계획대로면 `[0,0]`에서 시작한다(계약 `robot.position`을 `XZ | null`로).
3. `cupPlan`: 싱크대가 없으면 `null` 대신 **경로 없는 계획**(식탁 `act` 단계만, `path: []`)을 낸다. 「목표만 있으면 경로처럼 그리지 않는다」(스펙 9.3). 싱크대를 넣을지는 twin-studio 데이터 문제(확인 필요).
4. `reachable_rooms`가 없으면 지금은 모든 방(욕실·발코니 포함)이 갈 수 있는 방이 된다. 목련 발코니·현관 바닥은 `floor_z -0.1`(단차). 로봇이 갈 수 있는 방은 확인 필요.
5. Task 4·5의 그리기(`PathLayer`, `RobotBubble`, `StepPins`)는 새 렌더러의 Agent Visualization 층으로 옮긴다. 말풍선은 규칙 표대로 「판단하면서 확인한 것만」(react-ui Task 5b `checksReducer`와 같은 목록).
6. 서버 `home.ts`·`app.ts`를 고치므로 glass-ui·control-mode 브랜치가 합쳐진 뒤 새 브랜치에서 한다(사용자 결정과 같음).

View State Adapter와의 관계: `plan` 메시지가 생기면 「계획 대상 공간」·「실행 중 행동」·「재계획」은 PlanView가 1순위 근거가 되고, 리듀서의 brain·agent 추론은 PlanView가 없을 때만 쓴다.

## 4. 좌표·id 규칙(리듀서가 지킨다)

- 평면 `[x, y]` 미터 ↔ three `(x, 높이, y)`. 목련 scene: units m, up +Y, front +Z. 물건 `position[0]=plan[0]`, `position[2]=plan[1]`.
- yaw 0 = +x, 90 = +y(three +z). pitch 아래가 음수(`src/phone/align.ts`, viewer `eye.mjs`).
- `FocusTarget.position`은 three `[x, h, y]`, `EyePose.position`·`PlanView` XZ는 평면 `[x, y]`. 섞지 않는다.
- 위치→방: 방 다각형 판정(`roomAt`). 다각형 밖이면 `null`(집 밖).
- CLOiD 위치(눈)와 대상 공간은 다른 필드다. 눈이 발코니에 있어도 대상이 식탁이면 집중은 거실이다.
- 목련 주의: `dining_table_978b20c7`의 방은 `kitchen`(주방·식당)이 아니라 `living`(거실·복도)이다. 데이터대로 따른다.
- 목련 기기(attrs 있는 물건): stand_ac(거실), wall_ac(침실 1), fridge(주방, door), induction_counter(주방), washer·dryer(후면 발코니). 기기로 매핑되는지는 확인 필요.

## 5. 화면 상태 모델

```ts
// ui/src/agent-view/types.ts
import type { DeviceView, Plan2, ServerMessage } from "../../../src/contract/events.ts";
import type { PlanView } from "../../../src/contract/plan.ts";

export type Origin = "live" | "mock";
export type Source = "agent" | "brain" | "eye" | "plan" | "focus";

/** scene.json + /api/devices로 한 번 만든다. 배치가 바뀌면 다시. */
export interface HomeIndex {
  rooms: { id: string; label: string; polygon: Plan2[] }[];
  objects: Map<string, { id: string; type: string; label: string; room: string | null; plan: Plan2 }>;
  /** 기기 id → 물건 id·방(지금은 같은 id). */
  devices: Map<string, { objectId: string; room: string }>;
  roomAt(p: Plan2): string | null;
}

export interface CloidView {
  position: Plan2; heightM: number; yawDeg: number; pitchDeg: number;
  fovDeg: { h: number; v: number } | null; // 폰이 보내기 전에는 null
  room: string | null;
  estimated: boolean; tracking: "ok" | "limited";
  at: number; origin: Origin;
}

export type FocusReason = "interact" | "plan_target" | "observe" | "cloid";
/** 에이전트가 지금 가장 중요하게 보는 곳. id가 같으면 같은 대상(병합 키). */
export interface FocusIntent {
  id: string;                 // `${level}:${roomId}:${objectId ?? ""}`
  level: "room" | "object";
  roomId: string;
  objectId?: string;
  priority: 1 | 2 | 3 | 4;    // 4 상호작용, 3 계획 대상, 2 관찰, 1 CLOiD 위치
  reason: FocusReason;
  flow: string;               // `agent:${sessionId}` | `brain:${generation}` | `plan:${planId}`
  inferred: boolean;          // 이벤트에 id가 없어 화면이 고른 대상
  at: number;                 // 서버 시각(없으면 받은 시각)
  origin: Origin;
}

export interface Flow {
  key: string; source: "agent" | "brain" | "plan";
  status: "active" | "waiting" | "ended";   // waiting = 승인·사진 답 기다림
  endedBy?: "reply" | "result" | "cancel" | "plan_end" | "timeout";
  goal: string | null; startedAt: number; lastAt: number;
}

export interface ExecutionItem {
  key: string; label: string; deviceId?: string; objectId?: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  dryRun: boolean; at: number; origin: Origin;
}

export interface AgentViewState {
  origin: Origin;
  connected: boolean;
  serverNow: number;                         // 받은 서버 시각 중 가장 늦은 것
  last: Record<string, number>;              // 출처·흐름별 마지막 시각(역순 거르기)
  cloid: CloidView | null;
  observing: { roomId: string | null; objectIds: string[]; at: number } | null;
  goal: { text: string; flow: string } | null;
  plan: PlanView | null;
  previousPlan: PlanView | null;
  interaction: { objectId: string; roomId: string; status: ExecutionItem["status"]; flow: string } | null;
  execution: ExecutionItem[];                // 최근 20개
  result: { text: string; ok: boolean; at: number; flow: string } | null;
  replan: { at: number; flow: string; reason: string | null; fromGoal: string | null; toGoal: string | null } | null;
  flows: Record<string, Flow>;
  intent: FocusIntent | null;
  unmatched: string[];                       // HomeIndex에 없는 id(데이터 연결 점검용, 최근 20개)
}

export type AdapterInput =
  | { kind: "message"; message: ServerMessage; receivedAt: number; origin?: Origin }
  | { kind: "connection"; open: boolean; now: number }
  | { kind: "tick"; now: number };

export interface AdapterConfig {
  staleMs: number;          // 10_000: serverNow보다 이만큼 오래된 이벤트는 기록만, 집중 안 함
  agentFlowTimeoutMs: number; // 60_000: reply 없이 이만큼 지나면 흐름 끝(timeout)
  brainFlowTimeoutMs: number; // 130_000: actionTimeoutMs 120초 + 여유
  cloidDwellMs: number;     // 1_500: 눈이 새 방에 이만큼 머물러야 방 바뀜으로 봄
  brainIdleStates: BrainState[]; // ["watching", "in_use", "done"]: 집중 의도를 만들지 않는 상태
}

export function initialAgentView(origin: Origin): AgentViewState;
export function reduceAgentView(s: AgentViewState, input: AdapterInput, home: HomeIndex, cfg?: AdapterConfig): AgentViewState;
export function activeFlows(s: AgentViewState): Flow[];
```

### 5.1 리듀서 규칙

공통:
- `input.origin`(없으면 메시지의 `origin`, 그것도 없으면 live)이 `s.origin`과 다르면 **버린다**(live 화면에 Mock이 섞이지 않음).
- 서버 시각: agent `action.at`, brain `at_ms`, eye `at`, photo `at`, focus `at`, plan `updatedAt`. 없으면(`reply`·`pending`·`confirmed`·`cancelled`) 받은 시각으로 쓰고 `serverNow` 기준으로 맞춘다.
- 역순: 같은 열쇠(`agent:<session>`, `brain`, `eye`, `plan:<id>`)에서 시각이 마지막보다 이르면 상태는 바꾸지 않는다. brain은 `generation`이 흐름의 것보다 작으면 버린다. plan은 `revision`이 작거나 같으면 버린다.
- 오래됨: `serverNow - at > staleMs`이면 기록(execution·result)만 하고 `intent`는 안 바꾼다.
- HomeIndex에 없는 기기·물건·방 id는 `unmatched`에 넣고 의도를 만들지 않는다.

agent:
- `action`: 흐름 `agent:<session>`을 active로(없으면 만듦). deviceId가 있으면 방을 찾는다.
  - 읽기 도구(`list_rooms`, `list_devices`, `find_devices`, `get_state`, `find_objects`, `find_object_types`; `ui/src/chat/labels.ts` READ_TOOLS): `observing`에 더하고 의도 = room·우선순위 2·observe(물건은 강조만).
  - `list_devices` args.room: 그 방을 관찰 공간으로(우선순위 2).
  - 바꾸는 도구 성공·실패: execution done/failed, 의도 = object·우선순위 4·interact.
  - `needsConfirmation`: execution pending, `interaction` pending, 의도 = object·4, 흐름 waiting.
- `turn`(서버에 더할 때): 흐름 시작, `goal` = 요청 글.
- `reply`: 흐름 ended(reply). 승인 대기가 남으면 waiting으로 둔다. `goal`이 없으면 `message`를 목표로 남긴다(지난 일 기록).
- `pending`: interaction pending(토큰별).
- `confirmed`: 그 토큰 execution done/failed, 의도 = object·4(새 시각), 흐름 ended.
- `cancelled`: execution cancelled, interaction 지움, 흐름 ended(cancel).

brain:
- `brain`: 흐름 `brain`(generation 기록). `state`가 `away_check | requesting | deciding | confirming | acting`이면 active, 대상 = 식탁(`table_id` 있으면 그것, 없으면 dining_table이 하나뿐일 때 그것·inferred). 의도 = room·2·observe. `brainIdleStates`이면 의도를 만들지 않고 흐름 ended.
  - 진행 중인데 generation이 오르면 `replan` 기록(reason = `text`). stage `cancel`이면 흐름 ended(cancel) + replan.
- `request` active: 흐름 waiting(사진 답 기다림). 끝나면 active.
- `action` active:true: `goal = task`, execution running(dryRun true), interaction = 식탁, 의도 = object·4. active:false: execution 끝.
- `result`: result 기록(cleared·answered = ok), 흐름 ended(result), interaction 지움.
- `presence`·`perception`: `observing` 요약만 갱신. 의도 없음. `table: yes` + `table_id` 있으면 관찰 대상 갱신.

eye:
- `cloid` 갱신(10Hz). React 상태로 올리지 않고 저장소 값만 바꾼다.
- 방: `roomAt`. 맞춘 눈이 새 방에 `cloidDwellMs` 동안 머물면 방을 바꾼다(문턱 오가기 흔들림 방지).
- 의도: 진행 중 흐름이 있는데 그 흐름에 대상 공간이 없을 때만 room·1·cloid. estimated면 의도 없음.

plan(계약 생긴 뒤):
- 저장. `supersedes`가 있으면 이전 것을 `previousPlan`으로, `replan` 기록.
- 지금 단계(`active`, 없으면 첫 `pending`)의 target으로 의도: move → room·3·plan_target, act·device → object·4·interact. 방이 없으면 objectId·deviceId의 방.
- status `done | cancelled | failed`: 흐름 ended(plan_end).

focus(FOCUS=1일 때만 옴): 같은 흐름에서 이미 본 기기면 무시, 아니면 agent 행동과 같게(observe).

connection: 끊기면 `connected false`. 다시 붙으면 흐름은 그대로 두되 `GET /api/brain`·`GET /api/plan`으로 다시 채운다(사용 쪽 훅에서).

tick: 흐름 시간 초과 처리(agent 60초, brain 130초 → ended(timeout)). 시간 초과는 「응답 없음」으로 기록하고 완료로 보지 않는다.

`intent` 고르기: 진행 중(active·waiting) 흐름의 의도 중 우선순위가 가장 높은 것, 같으면 가장 늦은 것. 흐름이 모두 끝나면 `intent`는 남기되(최근 기록) 컨트롤러가 흐름 상태를 함께 본다.

## 6. Agent Focus Controller

```ts
// ui/src/agent-view/focus-controller.ts
export type CameraTarget =
  | { level: "overview" }
  | { level: "room"; roomId: string; highlight: string[] }
  | { level: "object"; roomId: string; objectId: string; include: Plan2[] }; // include: 같은 방의 CLOiD 위치(맞춘 눈만)

export interface FocusControllerState {
  mode: "auto" | "manual";
  current: { target: CameraTarget; intentId: string | null; priority: number; since: number };
  pending: { intent: FocusIntent; firstAt: number } | null;
  settleSince: number | null;   // 흐름이 모두 끝난 시각
  revision: number;             // 카메라 명령 번호(명령을 낼 때만 +1)
}

export type ControllerInput =
  | { kind: "agent"; intent: FocusIntent | null; flowsActive: boolean; cloid: CloidView | null; now: number }
  | { kind: "user"; action: "drag" | "wheel" | "touch" | "pick_room" | "pick_object" | "overview"; target?: CameraTarget; now: number }
  | { kind: "follow"; on: boolean; now: number }   // 자동 추적 켜기·끄기. 「클로이드 따라가기」 버튼 = on
  | { kind: "reset"; now: number }                 // 출처 바꿈(live ↔ mock)
  | { kind: "tick"; now: number };

export interface CameraCommand { revision: number; target: CameraTarget; cause: "agent" | "user" | "settle" | "follow" }
export interface ControllerOutput { state: FocusControllerState; command: CameraCommand | null }

export const DEFAULT_FOCUS = { minHoldMs: 2500, mergeMs: 400, settleMs: 4000 } as const;
export function initialFocus(now: number): FocusControllerState;   // auto, overview
export function stepFocus(s: FocusControllerState, input: ControllerInput, cfg = DEFAULT_FOCUS): ControllerOutput;
```

규칙(우선순위 순서대로 검사):
1. **수동 우선**: `user` drag·wheel·touch(누르기 시작 순간) → `mode: manual`, 명령 없음(사용자가 카메라를 움직임). pick_room·pick_object·overview → manual + 그 대상 명령(cause user). manual에서는 `agent`·`tick`이 명령을 내지 않고 `pending`에 마지막 의도만 둔다.
2. **따라가기 재개**: `follow on` → auto. 흐름이 진행 중이면 마지막 의도로 바로 명령(유지 시간 무시), 없으면 overview. `follow off` → manual, 명령 없음.
3. **같은 대상 병합**: 의도 id가 지금 대상과 같으면 아무것도 안 함(반복 이벤트에 안 흔들림). 같은 방 안 room ↔ object 전환은 level만 바꾼다.
4. **우선순위 선점**: 새 의도 우선순위가 지금보다 높으면 유지 시간·병합 시간 없이 바로 명령.
5. **최소 유지**: 그 밖의 새 대상은 `current.since + minHoldMs`가 지나야 바뀐다. 그 전에는 `pending`에 마지막 것만 둔다.
6. **짧은 시간 병합**: 유지 시간이 지났어도 첫 pending 뒤 `mergeMs` 동안 모아 마지막 것 하나만 명령(한 라운드의 연속 도구 호출을 하나로).
7. **자동 복귀**: `flowsActive`가 false가 되면 `settleSince = now`. `settleMs` 동안 새 의도가 없으면 overview(cause settle). 그 사이 새 의도가 오면 settle 취소. 흐름이 진행 중이면 이벤트가 끊겨도 overview로 가지 않는다(시간 초과는 리듀서가 흐름 끝으로 바꿔야만 settle 시작).
8. **극단 확대 금지**: object 명령의 `include`에 같은 방 CLOiD 위치(맞춘 눈)를 넣는다. 최소 화면 크기(예: 2.5m)는 카메라 컨트롤러가 잡는다.
9. `reset`: auto·overview·pending 비움.

이벤트 처리와 그리기 분리: 리듀서·컨트롤러는 `useSyncExternalStore`용 저장소(React 밖)에서 메시지·250ms tick마다 돈다. 그리기 루프는 `command.revision`이 바뀔 때만 새 목표로 보간을 다시 시작한다(전환 중 목표 변경은 카메라 컨트롤러가 지금 자세에서 새 목표로). HUD는 바뀐 필드만 구독한다. 눈 10Hz는 마커 위치만 바꾼다.

수치 근거: minHoldMs 2.5초 = 전환 약 0.8초 + 읽을 시간. mergeMs 0.4초 = 한 LLM 라운드의 도구 호출은 수 ms 간격, 라운드 사이는 수 초. settleMs 4초 = VLM 간격 1초·판정 지연 1.5~2.6초보다 길게. staleMs 10초 = brain staleMs 3초의 3배 이상. 모두 시험으로 조정(확인 필요).

## 7. 시험 시나리오

픽스처: 목련 방 `living`·`kitchen`·`bed_sw`·`balcony_front` 다각형과 물건 `dining_table_978b20c7`(living), `stand_ac_dc22b8f3`(living), `wall_ac_703d00ba`(bed_sw), `fridge_bbc363a3`(kitchen). scene.json에서 잘라 `ui/tests/fixtures/mokryeon-index.json`으로 둔다.

리듀서(`ui/tests/agent-view.test.ts`):

| # | 주어진 것 | 넣는 것 | 기대 |
|---|---|---|---|
| A1 | 빈 상태 | 맞춘 eye [9.9, 4.5] | cloid.room `living`, estimated false, intent null |
| A2 | 빈 상태 | estimated eye | cloid.estimated true, intent null |
| A3 | 빈 상태 | action get_state fridge ok | observing {kitchen, [fridge]}, intent room kitchen·2·observe |
| A4 | A3 뒤 | action turn_on stand_ac ok | execution done, intent object stand_ac·4·interact(living) |
| A5 | 빈 상태 | action turn_on wall_ac needsConfirmation → cancelled | interaction pending → 지움, 흐름 ended(cancel) |
| A6 | A4 뒤 | reply | 흐름 ended(reply), `activeFlows` 0 |
| A7 | 빈 상태 | brain stage away, state away_check (table_id 없음) | intent room living·2, objectId dining_table, inferred true |
| A8 | A7 뒤 | brain action active:true task 컵 치우기 | goal 「컵 치우기」, execution running dryRun, intent object dining_table·4 |
| A9 | A8 뒤 | brain result cleared | result ok, 흐름 ended(result), interaction null |
| A10 | brain deciding gen 3 | brain stage cancel gen 4 | replan 기록, 흐름 ended(cancel) |
| A11 | brain confirming gen 3 | brain decide 「다시 판단」 gen 4 | replan 기록, 흐름 active 유지 |
| A12 | action at T2 처리됨 | 같은 세션 action at T1(< T2) | 상태 그대로 |
| A13 | serverNow = T | brain at_ms T−11000 | intent 그대로, 기록만 |
| A14 | 빈 상태 | action deviceId `sink_1`(목련에 없음) | intent null, unmatched [`sink_1`] |
| A15 | live 상태 | origin mock 메시지 | 상태 그대로 |
| A16 | (plan 계약 뒤) plan rev 1 | 같은 id rev 1 다시 | 무시 |
| A17 | plan p1 running | plan p2 supersedes p1 | previousPlan p1, replan 기록 |
| A18 | agent 흐름 active, 마지막 이벤트 0초 | tick 59초 / 61초 | active / ended(timeout) |
| A19 | 맞춘 눈 living | kitchen에 0.8초 머물고 living으로 | cloid.room 계속 living |

컨트롤러(`ui/tests/focus-controller.test.ts`, cfg 기본):

| # | 주어진 것 | 넣는 것 | 기대 |
|---|---|---|---|
| C1 | auto·overview | t0 room living·2 | 명령 room living, rev 1 |
| C2 | C1 뒤 | 같은 의도 20번(2초 동안) | 명령 없음, rev 1 |
| C3 | living since t0 | t1000 room kitchen·2 | 명령 없음. tick t2500 → room kitchen |
| C4 | hold 지남 | t3000 A, t3200 B, t3300 C(모두 2) | t3400에 C 하나만 |
| C5 | room living·2 since t0 | t500 object stand_ac·4 | 바로 object 명령 |
| C6 | object·4 since t0 | t800 room kitchen·2 | pending. t2500 → room kitchen |
| C7 | auto | t100 user drag, t200 의도 kitchen | manual, 명령 없음, pending kitchen |
| C8 | C7 뒤 | t5000 follow on | room kitchen 명령(cause follow) |
| C9 | 흐름 active | t10000 흐름 끝 | t13999 명령 없음, t14000 overview(settle) |
| C10 | 흐름 active | t10000~t40000 이벤트 없음 | 명령 없음 |
| C11 | t10000 흐름 끝 | t12000 새 의도 | settle 취소, 새 대상 |
| C12 | auto | user pick_object fridge | manual + object 명령(cause user) |
| C13 | 맞춘 눈 living | object stand_ac | include에 눈 위치 있음. 눈이 kitchen이거나 estimated면 없음 |
| C14 | mock 재생 중 | reset | auto·overview·pending 없음 |

Mock 생성기(`ui/tests/mock-scenarios.test.ts`):
- M1 목련 인덱스로 모든 시나리오를 만들면 쓰인 id가 전부 인덱스에 있다. 없는 종류(예: `sink_counter`)를 찾으면 던진다.
- M2 같은 seed → 같은 결과.
- M3 모든 메시지 `origin: "mock"`, 출처별 시각이 커지는 순서.
- M4 `jitter`를 리듀서+컨트롤러에 돌리면 카메라 명령 1개.
- M5 `two_rooms`(0.3초 간격 kitchen 관찰 → bed_sw 상호작용) → 명령 2개(kitchen, 곧바로 bed_sw 선점).
- M6 `cup_clear` 끝 → 마지막 명령 overview(settle), 마지막 결과 4초 뒤.
- M7 `silence` → 30초 공백 동안 overview 명령 없음.

## 8. 실제 이벤트와 Mock 구분

세 축을 따로 둔다.

| 축 | 뜻 | 어디서 | 화면 표시 |
|---|---|---|---|
| 이벤트 출처 `origin` | 이벤트를 실제 서버 흐름이 냈나, 생성기가 만들었나 | 새 필드 `origin?: "live" \| "mock"`(메시지 바깥, PlanView 안) | mock이면 화면 위 고정 표시 하나 + 그 흐름의 모든 표시에 같은 표시 |
| 행동 `dryRun` | 로봇이 없어 행동이 모의인가 | brain ActionPlan `dry_run: true`, PlanView `dryRun` | 이미 쓰는 「모의」 |
| 운영 모드 `mode` | 기기 명령이 트윈으로만 가나, ThinQ로 가나 | `HealthView.mode`(control-mode 계획) | 상태 알약 |

- 「시험 모드」(운영 모드)와 「모의」(dryRun)가 이미 쓰이고 있어 Mock 표시 글은 다른 낱말로 정한다. 후보: 「시나리오 재생 중」(확인 필요, 화면 글 규칙 표 적용).
- Mock은 화면 안에서만 재생한다(`?scenario=<이름>`, 개발 화면). 서버·폰·로그로 보내지 않는다. 재생 중에는 Mock용 리듀서·컨트롤러를 따로 만들고 live 것은 뒤에서 계속 받는다. 재생을 멈추면 live 상태로 돌아간다(섞이지 않음).
- task planner(팀) 시험으로 `POST /api/plan`을 보낼 때는 본문 `plan.origin: "mock"`을 넣는다. PlanHub는 그대로 방송한다.
- 서버에 더하면 좋은 것(선택): 모든 방송에 `seq`(서버 켤 때부터 1씩)와 `hello.boot`(켤 때마다 새 id). 끊긴 사이 빠진 이벤트를 알 수 있다. `src/server/app.ts` broadcast 몇 줄.

## 9. Mock 시나리오 생성기

```ts
// ui/src/agent-view/mock-scenarios.ts
export type ScenarioName =
  | "cup_clear" | "device_on" | "approval" | "two_rooms" | "replan"
  | "cancel_return" | "jitter" | "out_of_order" | "silence" | "eye_walk" | "estimated_eye";

export interface TimedMessage { t: number; message: ServerMessage & { origin: "mock" } } // t: 시작 뒤 ms

export interface ScenarioOptions { seed?: number; startMs?: number; sessionId?: string }

/** 순수. 대상은 종류·방으로 HomeIndex에서 고른다(id를 지어내지 않음). 못 찾으면 던진다. */
export function mockScenario(name: ScenarioName, home: HomeIndex, opts?: ScenarioOptions): TimedMessage[];

/** 시계를 받아 차례로 내보낸다. speed 2면 두 배 빠르게. 멈춤 함수를 돌려준다. */
export function playScenario(msgs: TimedMessage[], clock: { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void },
  dispatch: (m: TimedMessage["message"], receivedAt: number) => void, speed?: number): () => void;
```

- 대상 고르기: `pick(home, { type: "dining_table" })`, `pick(home, { kind: "aircon", room: "bed_sw" })`처럼 데이터에서 찾는다. 눈 위치는 방 다각형 무게중심(계산값)으로 두고 `origin: mock`이라 실제 자세로 보이지 않는다.
- brain 메시지는 machine.ts가 실제로 내는 stage·state·글 순서를 따른다(글은 machine.ts 상수·형식 그대로, 새 판단 글을 지어내지 않음).

| 시나리오 | 내용(목련) | 검증하는 규칙 |
|---|---|---|
| cup_clear | away_check → request → answer → decide → confirming → action(식탁, 거실) → result cleared | 관찰→상호작용 선점, 결과 뒤 settle |
| device_on | get_state stand_ac → turn_on stand_ac → reply | 같은 방 room→object |
| approval | turn_on wall_ac(needsConfirmation) → pending → 5초 → confirmed | waiting 흐름 유지, 승인 뒤 다시 집중 |
| two_rooms | get_state fridge(주방) → 0.3초 → turn_on wall_ac(침실 1) | 선점 |
| replan | deciding gen 3 → 「다시 판단」 gen 4 → action | replan 기록, 흔들림 없음 |
| cancel_return | away_check → cancel(사람이 돌아옴) | 흐름 끝 → settle |
| jitter | get_state fridge 20번 / 2초 | 병합(명령 1개) |
| out_of_order | 시각이 앞선 action을 뒤에 | 역순 무시 |
| silence | acting 뒤 30초 공백 → result | 공백을 완료로 안 봄 |
| eye_walk | 맞춘 눈 10Hz, 거실 → 주방 0.8초 → 거실 | 방 머무름 시간 |
| estimated_eye | estimated 눈만 | 추정 눈은 집중 안 함 |

## 10. 파일 자리(구현 때)

```
ui/src/agent-view/types.ts            위 타입
ui/src/agent-view/home-index.ts       homeIndexFrom(scene, devices), roomAt
ui/src/agent-view/adapter.ts          initialAgentView, reduceAgentView, activeFlows
ui/src/agent-view/focus-controller.ts initialFocus, stepFocus, DEFAULT_FOCUS
ui/src/agent-view/store.ts            메시지·tick → 리듀서 → 컨트롤러, useSyncExternalStore 구독
ui/src/agent-view/mock-scenarios.ts   mockScenario, playScenario
ui/tests/agent-view.test.ts, focus-controller.test.ts, mock-scenarios.test.ts, fixtures/mokryeon-index.json
서버(선택): src/contract/events.ts(PresenceLog.table_id?, EyeEvent.fov_deg?, AgentEvent turn, origin?, seq?), src/brain/brain.ts, src/agent/agent.ts, web/phone/phone.js, src/phone/session.ts
```

`ui/src/lib/messages.ts`의 KNOWN에 새 type(`plan`)을 더해야 화면이 받는다.

## 11. 확인 필요 · 사용자 결정

1. CLOiD 위치를 폰 눈으로만 쓸지, 목련에 로봇 몸체·충전대(`robot`, `robot_dock`, `plan.robot.reachable_rooms`)를 넣을지. 넣으면 위치는 사용자·팀이 정해야 한다(임의 배치 금지).
2. 목련 싱크대 데이터가 없다. 컵 치우기 계획의 두 번째 목적지를 넣을지.
3. 로봇이 갈 수 있는 방(욕실·발코니·현관 단차 `floor_z -0.1`).
4. 서버 보강 5개 중 어디까지 할지: `table_id`(권장), agent `turn`(권장), 눈 `fov_deg`(권장), `seq`·`boot`, `origin`.
5. Mock 표시 글(「시험」·「모의」와 겹치지 않는 낱말).
6. 수동 탐색 뒤 일정 시간 지나면 자동 추적으로 돌아갈지(스펙은 버튼 복귀만 말함. 기본은 안 돌아감).
7. 전체 보기 단추를 누르는 것도 수동 전환으로 볼지(설계는 수동).
8. 수치(minHold 2.5초, merge 0.4초, settle 4초, stale 10초, 눈 머무름 1.5초)는 Mock 재생과 실제 폰 시험으로 맞춘다.
9. 목련 기기 6개가 twin-home 기기로 매핑되는지(`describeDevice`), FOCUS 기본 꺼짐은 그대로 두는지(새 자동 집중은 `focus` 메시지 없이 동작).
