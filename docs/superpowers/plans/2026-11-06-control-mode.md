# 운영 모드(시험 · 실제) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설정 화면에서 시험 모드(트윈만, 기본)와 실제 모드(ThinQ로 실제 가전)를 고르고, 실제 모드에서는 짝지은 에어컨·냉장고를 ThinQ로 읽고 다루며 그 결과를 트윈에 비춘다.

**Architecture:** 기기마다 신호 출처(`SignalHub`)에 `{ kind: "thinq", deviceId }`를 더한다. 실제 모드일 때만 `ThinqLink`(ThinQ 클라이언트 + 짝 목록)를 만들어 `SignalHub`에 붙인다. 짝지은 기기의 명령은 정책 → `ThinqLink`(지금 상태 읽기 → 보내기 → 다시 읽기)로 가고, 읽은 값은 안쪽 허브(트윈)에 그대로 비춘다. 모드·짝은 설정 저장소에 두고, 모드는 `/api/health`에 내보낸다. 설정 화면은 React(`ui/src/setup/`)로 옮기며 「운영 모드」 단계를 더한다.

**Tech Stack:** Node 22 + TypeScript(tsx), 내장 `fetch`, vitest, React 19 + Vite + Tailwind 4, Testing Library(jsdom).

**Spec:**
- 위키 Submission B: THQ-01~04, FRG-01·03(냉장고 문), 「Air-Conditioner Control」·「Refrigerator Closure」 절, 「Twin State and Agent Execution」(기기마다 한 번에 한 단계, 검증한 결과로 트윈 갱신).
- 사용자 요청(2026-11-06): 두 모드, 설정에서 고름, 시험 모드가 기본, 실제 모드 전환은 화면 안에서 한 번 더 확인, 모드는 저장소와 `/api/health`, 설정 화면은 React로(React 계획 Task 8).
- ThinQ Connect 문서:
  - LG 공식 SDK(Apache-2.0): https://github.com/thinq-connect/pythinqconnect — `thinqconnect/thinq_api.py`(주소·머리글·경로), `thinqconnect/devices/air_conditioner.py`, `thinqconnect/devices/refrigerator.py`
  - PAT 발급: https://connect-pat.lgthinq.com , 안내: https://thinq.developer.lge.com/en/cloud/docs/thinq-connect/PAT-en
  - 에어컨 기기 프로필: https://thinq.developer.lge.com/en/cloud/docs/thinq-connect/device-profile/air-conditioner
  - 개발자 사이트: https://smartsolution.developer.lge.com/en/apiManage/thinq_connect

## Global Constraints

- 시험 모드가 기본이다. 시험 모드는 지금 동작 그대로이고, ThinQ 클라이언트를 만들지 않는다(ThinQ 요청 0번).
- 개발·시험 중 실제 ThinQ를 부르지 않는다(GET 포함). 시험은 시험 안에서 띄운 가짜 ThinQ 서버로만 한다. 루트 시험은 `*.lgthinq.com` 요청을 막는다.
- 토큰은 환경변수 `THINQ_TOKEN`으로만 읽는다. 코드·로그·오류 글·응답에 넣지 않는다. `C:\Users\ABC\Desktop\thinq_api.txt`는 읽지 않는다.
- 실제 모드로 바꾸려면 토큰이 있어야 하고, 요청 본문에 `confirm: true`가 있어야 한다(화면 안 확인 뒤에만 보냄).
- 명령 순서: 정책(허락) → ThinQ에서 지금 상태 읽기 → 이미 목표와 같으면 보내지 않음 → 보냄 → 다시 읽어 같으면 완료. 받았지만 다시 읽은 값이 다르면 「확인 안 됨」, 거부하면 실패, 지금 상태를 못 읽으면 보내지 않음.
- 기기마다 한 번에 한 단계만 보낸다. 앞 명령이 끝나기 전 같은 기기 명령은 거절한다.
- 짝짓기는 에어컨·냉장고만. 냉장고는 문 상태 읽기만 한다(ThinQ에 문 닫기 명령이 없다).
- 화면은 React(`ui/`)로만 만든다. 브라우저 대화상자(alert·confirm)를 쓰지 않는다. 화면 글은 할 일과 지금 상태만(`CLAUDE.md` 규칙 표).
- 옛 `web/setup/`은 지우지 않는다(React 계획 Task 10).
- 직접 띄울 때는 `PORT=8250 PHONE_PORT=8260`. 시험은 `PORT=0`. 실제 모드로 서버를 띄우지 않는다.
- `git add`는 경로를 하나씩. 커밋 메시지는 영어, 끝줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 푸시하지 않는다.

## 파일 지도

| 파일 | 책임 |
|---|---|
| `src/thinq/client.ts` (새) | `thinqConfig(env)`, `ThinqClient`(기기 목록·상태·명령), `ThinqError`. 토큰을 오류 글에서 지운다 |
| `src/thinq/appliance.ts` (새) | ThinQ 상태 ↔ 트윈: `readAppliance`, `thinqSteps`, `mirrorPlan`, `PAIRABLE_KINDS`, `fitsKind` |
| `src/thinq/link.ts` (새) | `ThinqLink`: 짝지은 기기 읽기(처음·주기), 명령(읽기·보내기·다시 읽기), 기기별 한 단계, 트윈에 비추기 |
| `src/contract/setup.ts` (새) | `ControlMode`, `SetupView`, `ThinqDeviceView`(화면과 서버가 같이 씀) |
| `src/contract/events.ts` | `HealthView.mode` |
| `src/hub/types.ts` | `DeviceState.readback`, `CommandResult.outcome`·`execution` |
| `src/hub/signals.ts` | `SignalSource`에 thinq, `setLink`, thinq 기기 보기·명령·구독 |
| `src/setup/store.ts` | 모드(`setup.json`), 짝(`homes/<id>/thinq.json`), `parsePairs`, `effectiveSources` |
| `src/server/home.ts` | `HomeContext.mode`, `HomeRuntime.setLink`(닫을 때 멈춤) |
| `src/server/start.ts` | 모드 바꾸기·짝 저장·ThinQ 기기 목록, 시작 때 저장한 모드 적용 |
| `src/server/shell.ts` | `POST /api/setup/mode`, `GET /api/setup/thinq`, `POST /api/setup/pairs` |
| `src/server/app.ts` | `/api/health`의 `mode`, 「확인 안 됨」은 202 |
| `src/agent/tools.ts`·`agent.ts`·`providers/mock.ts`·`prompts.ts` | 「확인 안 됨」을 완료로 말하지 않음 |
| `ui/src/setup/*` | 설정 화면 React: 집 · 가전 · 운영 모드 · 위치 동기화 |
| `tests/helpers/thinq.ts` (새) | 가짜 ThinQ 서버(요청 기록, 적용·무시·거부) |
| `tests/setup/no-real-thinq.ts` (새) | 루트 시험에서 `*.lgthinq.com` fetch를 막음 |
| `docs/plan.md`·`docs/reference.md`·`.env.example` | 계약·API·환경변수 이름 |

## 계약

```ts
// src/contract/setup.ts
export type ControlMode = "test" | "live";
export interface ThinqDeviceView { id: string; type: string; name: string; model: string; kind: DeviceKind | null } // kind: 맞는 트윈 종류(에어컨·냉장고)
export interface SetupDeviceView { id: string; label: string; room: string; roomLabel: string; kind: DeviceKind; kindLabel: string; source: { kind: "virtual" | "none" }; pairable: boolean }
export interface SetupView {
  ok: true; persist: boolean; done: boolean; switching: boolean; error: string | null;
  home: { id: string; name: string } | null; homes: { id: string; name: string }[]; rooms: RoomSpec[];
  devices: SetupDeviceView[]; devices_saved: boolean;
  position: { touch: boolean; layout: boolean; phone_urls: string[] };
  mode: ControlMode; thinq: { ready: boolean }; pairs: Record<string, string>;
}

// src/hub/signals.ts
export type SignalSource = { kind: "virtual" } | { kind: "none" } | { kind: "thinq"; deviceId: string };

// src/hub/types.ts
interface DeviceState { …; readback?: { source: "thinq"; deviceId: string; at: string } }
interface CommandResult { …; outcome?: "done" | "unverified" | "failed" | "not_sent"; execution?: { id: string; route: "thinq"; target: string } }
```

- thinq 기기의 보기: 처음 읽기 전에는 「모름」(`signal: "none"`). 읽은 뒤에는 안쪽 허브 상태 + `readback`.
- thinq 기기의 `setSensor`는 거절(「실제 가전 값이라 바꿀 수 없어요.」).
- 실제 출처 = 모드가 live이고 짝이 있으면 `{ kind: "thinq", deviceId }`, 아니면 저장한 출처(virtual·none).

설정 API(쓰기는 같은 PC 출처만):

| 요청 | 본문 | 동작 |
|---|---|---|
| `GET /api/setup` | – | 지금 값 + `mode`, `thinq.ready`(토큰 있음), `pairs`, 기기마다 `pairable` |
| `POST /api/setup/mode` | `{ mode, confirm? }` | live는 `confirm: true`와 토큰이 있어야 함(아니면 400). 바로 적용·저장 |
| `GET /api/setup/thinq` | – | 실제 모드에서만 ThinQ 기기 목록, 항목마다 맞는 트윈 종류(`kind`). 시험 모드 409(ThinQ를 부르지 않음), ThinQ 실패 502 |
| `POST /api/setup/pairs` | `{ home, pairs: { <트윈 id>: <ThinQ id> \| null } }` | 에어컨·냉장고만. 바로 적용·저장. 다른 집이면 409 |

저장: `RUNTIME_DIR/setup.json`에 `mode`, `RUNTIME_DIR/homes/<id>/thinq.json` = `{ version: 1, home, pairs: { <트윈 id>: <ThinQ id> }, updated_at }`.

## ThinQ 형식(공식 SDK 기준)

- 주소: `https://api-<region>.lgthinq.com/`(KR → `kic`). `THINQ_REGION`(kic·aic·eic, 기본 kic), 시험은 `THINQ_BASE_URL`로 가짜 서버.
- 머리글: `Authorization: Bearer <THINQ_TOKEN>`, `x-country`(`THINQ_COUNTRY`, 기본 KR), `x-message-id`(uuid4를 base64url로, 22자), `x-client-id`(`THINQ_CLIENT_ID`, 없으면 시작마다 uuid), `x-api-key`(SDK 공개 값, `THINQ_API_KEY`로 바꿈), `x-service-phase: OP`. 명령에만 `x-conditional-control: true`.
- 경로: `GET devices`, `GET devices/{id}/state`, `POST devices/{id}/control`.
- 응답: 성공 `{ messageId, timestamp, response }`, 실패 `{ messageId, timestamp, error: { code, message } }`.
- 기기 목록 한 줄: `{ deviceId, deviceInfo: { deviceType, modelName, alias } }`. 에어컨 `DEVICE_AIR_CONDITIONER`, 냉장고 `DEVICE_REFRIGERATOR`.
- 에어컨 상태: `operation.airConOperationMode`(POWER_ON·POWER_OFF), `airConJobMode.currentJobMode`(COOL·HEAT·AUTO·AIR_DRY·FAN), `temperatureInUnits[]`(unit C의 `targetTemperature`·`currentTemperature`, 없으면 `temperature`), `airFlow.windStrength`(LOW·MID·HIGH·AUTO).
- 에어컨 명령: 전원 `{ operation: { airConOperationMode } }`, 모드 `{ airConJobMode: { currentJobMode } }`, 온도 `{ temperatureInUnits: { targetTemperature, unit: "C" } }`, 바람 `{ airFlow: { windStrength } }`. 꺼진 에어컨에 냉난방 설정을 보내면 먼저 켠다.
- 냉장고 상태: `doorStatus[]`의 `locationName: "MAIN"` 항목 `doorState`(OPEN·CLOSE). 명령 없음.

---

### Task 1: ThinQ 클라이언트와 가짜 서버

**Files:** Create `src/thinq/client.ts`, `tests/helpers/thinq.ts`, `tests/setup/no-real-thinq.ts`, `tests/thinq-client.test.ts`. Modify `vitest.config.ts`(setupFiles).

**Interfaces:**
- Produces:
  - `thinqConfig(env): { ok: true; config: ThinqConfig } | { ok: false; error: string }` — 토큰 없으면 `{ ok: false, error: "ThinQ 토큰이 없어요." }`.
  - `ThinqConfig = { baseUrl; token; country; clientId; apiKey; timeoutMs }`
  - `class ThinqClient { devices(): Promise<ThinqDeviceView[]>; state(id): Promise<Record<string, unknown>>; control(id, body): Promise<unknown> }`
  - `class ThinqError extends Error { status: number; code: string }`(글에 토큰 없음)
  - `startFakeThinq(opts?): Promise<FakeThinq>` — `url`, `requests[]`(method·path·headers·body), `devices`, `states`, `behavior[id]: "apply" | "ignore" | "reject" | "fail-read"`, `close()`

- [ ] 실패하는 시험: 머리글 7개(`Authorization` Bearer, `x-country` KR, `x-message-id` 22자 base64url, `x-client-id`, `x-api-key`, `x-service-phase` OP, 명령에만 `x-conditional-control`), 경로 3개, `response` 풀기, 실패면 `ThinqError(code)`이고 글에 토큰이 없음(가짜 서버가 토큰을 담아 돌려줘도), 토큰이 없으면 설정 오류, 루트 시험에서 `https://api-kic.lgthinq.com/devices` fetch가 막힘.
- [ ] 구현 → `npx vitest run tests/thinq-client.test.ts` 통과 → 커밋 `feat(thinq): add a ThinQ Connect client and a fake server for tests`.

### Task 2: ThinQ 상태 ↔ 트윈 바꾸기

**Files:** Create `src/thinq/appliance.ts`, `tests/thinq-appliance.test.ts`.

**Interfaces:**
- Produces:
  - `PAIRABLE_KINDS: DeviceKind[] = ["aircon", "fridge"]`, `fitsKind(kind, thinqType): boolean`
  - `readAppliance(kind, raw): Reading` — `Reading = { power?: "on" | "off"; mode?: ClimateMode; setpointC?: number; fan?: FanSpeed; currentC?: number; door?: "open" | "closed" }`
  - `thinqSteps(kind, cmd): ThinqStep[] | null` — `ThinqStep = { name: string; body: Record<string, unknown>; done(r: Reading): boolean }`. 지원 안 하면 null.
  - `mirrorPlan(spec, reading, world: DeviceState): { commands: Command[]; sensors: [string, unknown][] }`

- [ ] 실패하는 시험: 에어컨 읽기(`temperatureInUnits` 배열·객체, `temperature` 대체), 냉장고 문(OPEN·CLOSE), 단계(켜기, 끄기, 온도, 모드, 바람, 냉난방 설정은 켜기를 먼저), 냉장고·모르는 명령 null, 비추기(달라진 값만, 꺼진 에어컨 읽기면 climate 뒤 off).
- [ ] 구현 → 통과 → 커밋 `feat(thinq): translate ThinQ air conditioner and fridge state to the twin`.

### Task 3: ThinqLink(읽기 · 명령 · 다시 읽기)

**Files:** Create `src/thinq/link.ts`, `tests/thinq-link.test.ts`.

**Interfaces:**
- Consumes: Task 1·2.
- Produces: `new ThinqLink({ client, world, pairs, log, pollMs?, readbackMs?, now? })`, `start(): Promise<void>`(처음 한 번 읽고 주기 읽기), `stop()`, `readback(id)`, `refresh(id): Promise<boolean>`, `command(id, cmd): Promise<CommandResult>`, `handles(id)`.

- [ ] 실패하는 시험(가짜 ThinQ + MemoryHub):
  - 처음 읽기로 트윈이 실제 값이 되고 `readback`에 출처·ThinQ id·시각.
  - 온도 26: 읽기 → 보냄 → 다시 읽기 26 → `outcome: "done"`, 트윈 26.
  - 가짜가 받기만 하고 안 바꿈 → `outcome: "unverified"`, `ok: true`, 트윈은 다시 읽은 값.
  - 거부 → `ok: false, outcome: "failed"`.
  - 지금 상태를 못 읽음 → 보내지 않음(`not_sent`, POST 0).
  - 이미 26 → POST 0, done.
  - 같은 기기에 두 명령을 겹쳐 보내면 두 번째는 거절, POST는 한 번에 하나.
  - 꺼진 에어컨에 온도 → 켜기 POST가 먼저, 켜짐 확인 뒤 온도.
  - 로그에 토큰이 없다.
- [ ] 구현 → 통과 → 커밋 `feat(thinq): send one step at a time and complete only after readback`.

### Task 4: SignalHub의 thinq 출처

**Files:** Modify `src/hub/signals.ts`, `src/hub/types.ts`, `tests/signals.test.ts`, `docs/plan.md`(신호 출처·계약).

**Interfaces:**
- Consumes: `ThinqLink`의 `handles`·`readback`·`command`.
- Produces: `SignalHub.setLink(link: ThinqLinkLike | null)`, `ThinqLinkLike = Pick<ThinqLink, "readback" | "command">`.

- [ ] 실패하는 시험: thinq 출처인데 읽기 전이면 「모름」, 읽은 뒤면 트윈 값 + `readback`. 명령은 연결로 가고 안쪽 허브로 바로 가지 않는다. 연결이 없으면 거절. `setSensor` 거절. 비춘 변화는 구독자에게 간다. virtual·none 동작은 그대로.
- [ ] 구현 → 통과 → 커밋 `feat(hub): route paired devices through ThinQ in the signal hub`.

### Task 5: 모드 · 짝 저장과 설정 API, `/api/health` 모드

**Files:** Create `src/contract/setup.ts`, `tests/control-mode.test.ts`. Modify `src/setup/store.ts`, `src/server/home.ts`, `src/server/start.ts`, `src/server/shell.ts`, `src/server/app.ts`, `src/contract/events.ts`, `tests/setup-store.test.ts`, `ui/tests/status-pill.test.tsx`·`ui/tests/eye-window.test.tsx`(HealthView에 mode), `docs/reference.md`, `.env.example`.

**Interfaces:**
- Consumes: Task 1~4.
- Produces: 위 「설정 API」, `SetupStore.mode()`·`setMode()`·`pairs()`·`savePairs()`, `parsePairs(raw, devices)`, `effectiveSources(stored, pairs, mode)`, `HealthView.mode`.

- [ ] 실패하는 시험(`startServer`, HUB=memory, 가짜 ThinQ):
  - 기본은 시험 모드(`/api/health.mode`, `/api/setup.mode`). 짝을 저장해 둬도 시험 모드 명령은 트윈에서 실행되고 가짜 ThinQ 요청 0. 시험 모드 `GET /api/setup/thinq`는 409이고 요청 0.
  - live: `confirm` 없으면 400, 토큰 없으면 400(모드 그대로).
  - live로 바꾸면 health가 live, ThinQ 기기 목록, 짝 저장 → 에어컨 온도 명령이 완료(200, done)·트윈 반영, 무시하면 202 unverified, 거부하면 400 failed.
  - 짝은 에어컨·냉장고만(다른 기기 400), 없는 기기 400.
  - 냉장고 문 OPEN을 읽으면 트윈 냉장고 door가 open.
  - 시험 모드로 돌아가면 그 뒤 명령은 ThinQ 요청 0.
  - persistSetup: 모드·짝이 다시 켜도 그대로. 저장 모드가 live인데 토큰이 없으면 시험 모드로 뜬다.
- [ ] 구현 → 통과 → 문서 → 커밋 `feat: store the control mode and ThinQ pairs, expose the mode in health`.

### Task 6: 에이전트가 「확인 안 됨」을 완료로 말하지 않기

**Files:** Modify `src/agent/tools.ts`, `src/agent/agent.ts`, `src/agent/providers/mock.ts`, `src/agent/prompts.ts`, `tests/control-mode.test.ts`.

- [ ] 실패하는 시험: 실제 모드에서 mock 에이전트 「에어컨 26도로 맞춰줘」 → 가짜가 무시하면 답에 「확인하지 못했어요」, 거부하면 실패 글, 적용하면 완료 글.
- [ ] 구현 → 통과 → 커밋 `feat(agent): report unverified ThinQ results as unverified`.

### Task 7: 설정 화면을 React로(React 계획 Task 8)

**Files:** Create `ui/src/setup/device-search.ts`, `ui/src/setup/setup-api.ts`, `ui/src/setup/HomeStep.tsx`, `ui/src/setup/DeviceStep.tsx`, `ui/src/setup/PositionStep.tsx`, `ui/tests/device-search.test.ts`, `ui/tests/setup-app.test.tsx`. Modify `ui/src/setup/SetupApp.tsx`. Delete `tests/setup-device-search.test.ts`.

**Interfaces:**
- Consumes: `/api/setup*`, `/api/phone/touch-points*`, `/api/layout*`, `SetupView`.
- Produces: `searchDevices<T extends SearchDevice>(devices: T[], query: string): T[]`, `<SetupApp />`(단계 표시, 1 집 고르기, 2 가전 선택, 3 운영 모드 자리, 4 위치 동기화).

- [ ] 시험 옮기기: `tests/setup-device-search.test.ts` → `ui/tests/device-search.test.ts`(import `../src/setup/device-search`) → FAIL → TS로 옮김 → PASS.
- [ ] 실패하는 화면 시험: 집 목록과 「다음」, 가전 검색 「거실」 결과와 Enter로 첫 결과 추가, 「ㄴㅈㄱ」 → 냉장고, × 로 빼기, 저장 본문 `{ home, sources }`, 위치 단계의 「건너뛰고 대시보드로」.
- [ ] 구현(`web/setup/setup.js` 상태를 `useState`로, 글은 지금 화면 글 그대로) → 통과 → 커밋 `feat(ui): port the setup flow to React`.

### Task 8: 운영 모드 단계(모드 고르기 · 화면 안 확인 · 짝짓기)

**Files:** Create `ui/src/setup/ModeStep.tsx`, `ui/tests/mode-step.test.tsx`. Modify `ui/src/setup/SetupApp.tsx`, `ui/src/setup/setup-api.ts`.

**Interfaces:**
- Consumes: `POST /api/setup/mode`, `GET /api/setup/thinq`, `POST /api/setup/pairs`.
- Produces: `<ModeStep view onView notice />`.

- [ ] 실패하는 화면 시험:
  - 시험 모드가 골라져 있고 ThinQ 목록을 부르지 않는다.
  - 「실제 모드」를 누르면 화면 안 확인(`role="alertdialog"`)이 뜨고, 그 전에는 POST가 없다. 「취소」면 그대로.
  - 「실제 모드로 바꾸기」 → `POST /api/setup/mode { mode: "live", confirm: true }` → ThinQ 기기 목록 → 에어컨·냉장고마다 고르기 → `POST /api/setup/pairs`.
  - 토큰이 없으면(`thinq.ready: false`) 실제 모드 버튼을 막고 「ThinQ 토큰이 없어요.」.
  - `window.confirm`·`window.alert`를 부르지 않는다.
- [ ] 구현 → 통과 → 화면 글 점검(규칙 표) → 커밋 `feat(ui): choose the control mode and pair ThinQ devices in setup`.
- [ ] `ui/tests/class-names.test.ts`: 화면 코드에 `text-lg`를 쓰지 않는다(`--color-lg` 토큰과 겹쳐 글자가 LG 빨강이 된다. 큰 글자는 `text-[18px]`).

### Task 9: 전체 확인

- [ ] `npm test`, `npx tsc --noEmit`, `npm --prefix ui test`, `npm --prefix ui run typecheck`, `npm run lint`, `npm run ui:build`.
- [ ] 헤드리스 크롬 한 번(`PORT=8250 PHONE_PORT=8260`, 시험 모드, `vite preview`로 `ui/dist`): 설정 화면 4단계, 실제 모드 확인 창이 뜨고 취소하면 시험 모드 그대로, 토큰 없이 바꾸려 하면 막힘, 콘솔 오류 0.

## 합친 뒤 할 일(`feat/glass-ui`와 합친 뒤)

- 대시보드 상태 알약에 `/api/health.mode`를 보인다(시험 모드 · 실제 모드). 실제 모드면 눈에 띄는 색.
- 합친 쪽에서 새로 만든 `HealthView` 시험 값에 `mode`를 넣는다(`ui/tests/*`).
- React 계획 Task 10(서버가 `ui/dist`를 내줌) 전까지 `/setup/`은 옛 화면이다. 운영 모드 단계는 `npm run ui:dev`(5173) 또는 Task 10 뒤에 보인다.

## 실제 연결 때 확인할 것

- 토큰: `.env`에 `THINQ_TOKEN=<PAT>`(권한: 기기 보기·상태 보기·제어). 필요하면 `THINQ_COUNTRY`, `THINQ_REGION`, `THINQ_CLIENT_ID`.
- 처음 켜는 순서: 서버를 시험 모드로 켬 → 설정 3단계에서 실제 모드로 바꿈(확인) → ThinQ 기기 목록이 나오는지 → 에어컨·냉장고 짝 → 저장 → 대시보드에서 에어컨 온도 한 번 → 실제 가전과 트윈이 같은지.
- 문서와 다를 수 있는 것: 기기 종류 글(`DEVICE_AIR_CONDITIONER`·`DEVICE_REFRIGERATOR`), 온도 자원(`temperatureInUnits` 배열·`temperature`), 모드·바람 값(AIR_DRY·MID 등), 문 값(OPEN·CLOSE), 명령 응답 모양, 명령 뒤 상태가 바뀌기까지 걸리는 시간(기본 다시 읽기 1·2·4초), 호출 횟수 제한(기본 15초마다 읽기).
