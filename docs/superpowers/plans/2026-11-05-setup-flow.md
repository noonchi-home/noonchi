# 설정 흐름(집 → 가전 → 위치 동기화 → 대시보드) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지금 대시보드에 섞여 있는 설정(집 고르기·폰 기준점·배치 저장)을 단계가 있는 설정 화면으로 빼고, 대시보드는 관찰만 하게 만든다. 가전마다 「신호 출처」(가상 / 신호 없음)를 고른다.

**Architecture:** 서버 프로세스는 그대로 두고, 집 하나에 딸린 것(허브·정책·에이전트·배치 편집기·기준점·폰 서버·두뇌·앱)을 「집 실행 묶음」(HomeRuntime)으로 묶어 집을 바꿀 때 통째로 닫고 새로 만든다. 바깥 「껍데기 서버」(shell)가 포트를 계속 잡고 `/api/setup*`만 직접 처리하며, 나머지 요청과 WebSocket 업그레이드는 지금 묶음의 앱 서버로 넘긴다(앱의 `server.emit("request"|"upgrade")`). 엔진·대시보드가 보는 허브는 `SignalHub`로 감싸 「신호 없음」 기기의 상태를 「모름」으로 가린다. 실제 상태(숨은 세계)는 안쪽 허브가 계속 시뮬레이션한다.

**Tech Stack:** Node 22 + TypeScript(tsx), ws, zod, vitest, 빌드 없는 ES 모듈 웹 화면, 헤드리스 Chrome(CDP) 확인.

**Spec:** docs 저장소 `01_Product/구현명세서 SSOT.md` 1.3(실제 가전 제어는 범위 밖), 2.3(공간 기준은 배치 JSON 하나), 2.19(환경은 숨은 세계, 엔진은 공개된 믿음), 6.3 4단계(정보 확보 수단: 촬영·질문·가전 신호), 7.1 `read_appliance`, 9.6(폰 AR 맞추기), 12(대시보드는 판단하지 않는다, 트윈은 엔진의 믿음만 그린다, 배치 보정).

## Global Constraints

- 가전 목록은 고른 집의 배치·scene(`TwinData.devices`)에서만 온다. 설정 파일에는 기기별 출처만 적는다(따로 목록을 만들지 않는다).
- 출처 종류: `virtual`(트윈 시뮬레이터, 지금 동작) · `none`(신호 없음). 나중에 `{ kind: "thinq", deviceId }`를 더할 자리만 남긴다. ThinQ는 부르지 않는다.
- 「신호 없음」 기기: 에이전트 도구·REST·WS가 상태를 「모름」으로 보인다. 명령(가상 실행)은 그대로 되고, 결과 상태도 가린다. 실행 가능 여부 검사는 숨은 세계(안쪽 허브)가 그대로 한다.
- 선택은 `runtime/`(git에 안 올라감)에 저장: `runtime/setup.json`(고른 집·끝냄), `runtime/homes/<id>/signals.json`(그 집 기기 출처, `virtual`이 아닌 것만).
- 저장된 선택을 읽고 쓰는 것은 `npm start`(main.ts가 `persistSetup: true`)만 한다. 테스트·데모의 `startServer`는 저장 파일을 읽지 않고 지금처럼 `HOME_ID`(없으면 기본 집)로 뜨며 설정은 「끝냄」으로 시작한다. `npm start`에서도 저장된 것이 없으면 `HOME_ID`가 기본 집이다.
- 포트는 바뀌지 않는다: 본 서버 `PORT`, 폰 서버는 처음 잡은 포트를 집을 바꿔도 다시 쓴다(Tailscale serve가 8210을 가리킴).
- 대시보드: 3D 트윈 · 클로이드의 눈 · 추론 과정 · 기기 카드만. 폰 기준점 A·B와 배치 저장/되돌리기는 설정 3단계로 옮긴다. 헤더에 「설정 다시 하기」.
- 위치 동기화는 건너뛸 수 있다. 건너뛰면 폰은 맞추기 전 상태(`pose_note: not_aligned`)로 남는다.
- 커밋하지 않는다. twin-studio는 바꾸지 않는다. 테스트는 mock 에이전트, `HUB=memory`.
- 글(주석·문서·화면 문구)은 쉬운 한국어, 결론만.

---

## 파일 지도

| 파일 | 책임 |
|---|---|
| `src/hub/signals.ts` (새) | `SignalSource` 형, `SignalHub`(가린 읽기·명령 통과), `isUnknown` |
| `src/hub/types.ts` | `DeviceState.signal?: "none"`(가린 상태 표시) |
| `src/agent/policy.ts` | 상태가 「모름」이면 상태에 기대는 사전 검사를 건너뜀(실제 검사는 허브가 함) |
| `src/agent/tools.ts` | `brief`: 「모름」이면 `state: "모름"`, `signal: "none"` |
| `src/agent/prompts.ts` | 「모름」 기기는 추측하지 말고 사진·질문으로 확인한다는 한 줄 |
| `src/setup/store.ts` (새) | `SetupStore`: 저장/메모리 두 방식, 출처 검사(`SetupError`) |
| `src/server/home.ts` (새) | `startHome()`: 집 실행 묶음 만들기·닫기(지금 start.ts 본문을 옮김) |
| `src/server/shell.ts` (새) | 껍데기 서버: `/api/setup*`, 요청·업그레이드 넘기기, 바꾸는 중 503 |
| `src/server/start.ts` | 껍데기 + 묶음 조립, `switchHome`, `RunningServer` getter |
| `src/server/app.ts` | `hello`에 `home` id, 쓰기 출처 검사·본문 읽기 도우미 export |
| `src/server/main.ts` | `persistSetup: true`, 시작 안내에 설정 주소 |
| `web/setup/index.html`·`setup.js`·`setup.css` (새) | 설정 3단계 화면 |
| `web/index.html`·`web/app.js`·`web/style.css` | 기준점·배치 버튼 빼기, 설정 안 끝났으면 `/setup/`로, 「설정 다시 하기」, 「모름」 카드 |
| `tests/signals.test.ts`·`tests/setup-store.test.ts`·`tests/setup-server.test.ts` (새) | 아래 과제의 시험 |
| `docs/plan.md`·`docs/reference.md` | 인터페이스(`signal`)·설정 API·파일 |

## 계약

```ts
// src/hub/signals.ts
export type SignalSource = { kind: "virtual" } | { kind: "none" }; // 다음: { kind: "thinq"; deviceId: string }
export class SignalHub implements DeviceHub {
  constructor(world: DeviceHub, sources?: Record<string, SignalSource>);
  readonly world: DeviceHub;                 // 숨은 세계(실제 시뮬레이터)
  source(id: string): SignalSource;          // 없으면 virtual
  sources(): Record<string, SignalSource>;   // virtual 아닌 것만
  setSources(map: Record<string, SignalSource>): void; // 바뀐 기기만 구독자에게 새 보기 상태를 보낸다
  // get/states/subscribe: none이면 { id, online: true, twin: {}, matter: {}, updatedAt, signal: "none" }
  // command/setSensor: world로 넘기고 결과 state를 같은 규칙으로 가린다. none 기기의 상태 변화는 구독자에게 보내지 않는다.
  // info·openCommissioningWindow: world(MatterHub)에 있으면 그대로 넘긴다(/api/matter).
}
```

설정 API(본 서버, 쓰기는 같은 PC 출처만):

| 요청 | 본문 | 응답·동작 |
|---|---|---|
| `GET /api/setup` | – | `{ ok, persist, done, switching, error, home:{id,name}\|null, homes, devices:[{id,label,room,roomLabel,kind,source}], position:{ touch, layout, phone_urls } }` |
| `POST /api/setup/home` | `{ home }` | 다른 집이면 묶음을 닫고 새로 만든다(그동안 다른 API는 503). 실패하면 이전 집으로 되돌리고 400. 저장 시 `done:false` |
| `POST /api/setup/devices` | `{ sources: { <id>: "virtual"\|"none" } }` | 모르는 id·값은 400. 바로 적용하고 저장 |
| `POST /api/setup/done` | – | `done:true` 저장 |

`runtime/setup.json`: `{ "version": 1, "home": "mokryeon_180b", "done": true, "updated_at": "…" }`
`runtime/homes/<id>/signals.json`: `{ "version": 1, "home": "<id>", "sources": { "<기기 id>": { "kind": "none" } }, "updated_at": "…" }` — 지금 집에 없는 기기 id는 읽을 때 버리고 경고한다.

---

### Task 1: SignalHub와 「모름」 읽기

**Files:** Create `src/hub/signals.ts`, `tests/signals.test.ts`. Modify `src/hub/types.ts`, `src/agent/policy.ts`, `src/agent/tools.ts`, `src/agent/prompts.ts`, `docs/plan.md`(인터페이스).

- [ ] 실패하는 시험 작성(`tests/signals.test.ts`, MemoryHub 위에):
  - 기본은 그대로 통과(get/states/command 결과가 world와 같음).
  - `none` 기기: `get`·`states`가 `twin:{}`, `matter:{}`, `signal:"none"`. world 상태는 그대로.
  - `none` 기기에 명령: world 상태는 바뀌고, 돌아온 `state`는 가려짐. 구독자에게 그 기기 상태가 가지 않음.
  - `setSources`로 virtual→none·none→virtual: 바뀐 기기만 구독자에게 한 번씩(가린 상태 / 실제 상태).
  - `deviceViews`·`get_state` 도구: `state: "모름"`, `signal: "none"`.
  - 정책: 「모름」 상태의 동작 가전 `pause`가 「동작 중이 아니라」로 막히지 않고 world 판단을 따른다.
- [ ] 실패 확인 → 구현 → `npx vitest run tests/signals.test.ts` 통과.

### Task 2: SetupStore

**Files:** Create `src/setup/store.ts`, `tests/setup-store.test.ts`.

- [ ] 실패하는 시험: 메모리 방식(파일을 안 만듦, `done` 기본 true) / 저장 방식(파일 없으면 `home:null, done:false`, 쓰고 다시 열면 같음) / `parseSources`가 모르는 id·잘못된 값에서 `SetupError`(한국어 메시지) / signals.json의 사라진 기기 id는 버리고 경고 / 깨진 JSON은 경고 후 빈 값.
- [ ] 구현 → 통과.

### Task 3: 집 실행 묶음 + 껍데기 서버

**Files:** Create `src/server/home.ts`, `src/server/shell.ts`, `tests/setup-server.test.ts`. Modify `src/server/start.ts`, `src/server/app.ts`, `src/server/main.ts`.

- [ ] 실패하는 시험(`startServer`, `HUB=memory`, mock, 임시 `RUNTIME_DIR`, twin-studio 실제 데이터 `oneroom`·`apartment`):
  - 기존처럼 뜬다: `GET /api/setup` → `persist:false, done:true, home.id`=HOME_ID.
  - `POST /api/setup/home {home:"apartment"}` → `/api/health.home.id`·기기 수가 바뀌고, `srv.hub`·`srv.twin`도 새 집. `/events` 다시 붙으면 `hello.home`이 새 집.
  - 폰 서버(`PHONE_PORT=0`)는 집을 바꿔도 같은 포트.
  - 없는 집 → 400, 이전 집 그대로.
  - `POST /api/setup/devices` → `/api/devices`의 그 기기 `state.signal:"none"`, WS로 가린 상태 한 번. 모르는 id → 400.
  - `persistSetup:true`: 저장한 집·출처·`done`이 다시 켜도 그대로. 저장 없으면 HOME_ID 집, `done:false`.
  - 바꾸는 중 들어온 `/api/devices` → 503.
  - 다른 출처의 `POST /api/setup/*` → 403.
- [ ] 구현: start.ts 본문을 `startHome(homeId, ctx)`로 옮기고(폰 포트·로그·env 공유), `createShell`이 지금 묶음의 `app.server`로 요청·업그레이드를 넘긴다. 집 바꾸기는 한 번에 하나(겹치면 409).
- [ ] 기존 시험 전부 통과 확인(`npx vitest run`).

### Task 4: 설정 화면과 관찰 전용 대시보드

**Files:** Create `web/setup/index.html`, `web/setup/setup.js`, `web/setup/setup.css`. Modify `web/index.html`, `web/app.js`, `web/style.css`.

- [ ] 설정 화면: 위에 단계 표시(1 집 · 2 가전 · 3 위치 동기화). 
  - 1단계: 집 목록(지금 집 선택됨) → 「다음」(바꾸면 「집을 바꾸는 중…」).
  - 2단계: 방별 기기 목록, 기기마다 「가상 / 신호 없음」, 「모두 가상」·「모두 신호 없음」, 「이전」·「다음」(저장).
  - 3단계: 3D 트윈 iframe + 폰 기준점 A·B 패널(app.js에서 옮김) + 배치 보정 상태와 저장/되돌리기 + 폰 주소. 「건너뛰기」·「완료」 → `POST /api/setup/done` → `/`.
- [ ] 대시보드: 기준점 패널·배치 배지·버튼 삭제, 헤더에 「설정 다시 하기」(`/setup/`), 시작할 때 `GET /api/setup`이 `done:false`면 `/setup/`로, `hello.home`이 바뀌면 새로 고침, `signal:"none"` 카드는 「모름 · 신호 없음」 칩.
- [ ] 헤드리스 Chrome 확인(스크래치 스크립트, 저장소에 안 넣음): 설정 3단계 끝까지 → 대시보드, 집 바꾸기, 신호 없음 카드, 기준점 고르기·저장, 콘솔 오류 0.

### Task 5: 문서

**Files:** Modify `docs/plan.md`(새 절 「설정 흐름(5단계)」), `docs/reference.md`(설정 API·파일·`npm start` 동작).

- [ ] 반영 → tsc · 전체 vitest · 헤드리스 확인 → 아래 「결과」 작성.

## 결과

**된 것** (커밋 안 함, 브랜치 `feat/setup-flow`)
- Task 1~5 모두. 설정 화면 `/setup/`(집 → 가전 → 위치 동기화) → 대시보드. 대시보드는 관찰만(기준점 패널·배치 버튼 뺌, 「설정 다시 하기」).
- 집 바꾸기는 서버를 끄지 않고 실행 묶음을 다시 만든다. HUB=memory 즉시, HUB=matter local 전송 약 1.7초(처음 시작 15초).
- 신호 없음: REST·WS·에이전트 도구·mock 답·승인 답이 「모름」. 숨은 세계가 거절해도 「보냄」으로만 알림.
- 리뷰 반영(codex): 계획 1회(P2 6개), 코드 3회(P2 5개 → P2 1개 → 「없음」).
  - 늦게 도착한 명령·배치 도구·기준점 쓰기는 집을 바꾼 뒤 거절(SignalHub.stop, LayoutEditor.close, 앱 closed 검사).
  - 묶음 닫기는 단계별로 실패해도 끝까지, 서버 close는 진행 중인 집 바꾸기를 기다림.
  - 설정 쓰기는 `home`이 지금 집과 다르면 409.
  - 3D 뷰어 `signal: "none"` 처리(twin-studio `apartment/viewer/live.mjs` + 시험).

**검증 (2026-11-05)**
- `npx tsc --noEmit` 통과.
- `npx vitest run`: 73파일, 998 통과, 1 건너뜀.
  - 앞선 두 번의 전체 실행에서는 매번 다른 시험 하나가 부하 때문에 실패했다(`phone-server.test.ts`, 11-01 실험 `phone-lab-ingress.test.ts`). 둘 다 따로 3번씩 돌리면 통과한다.
- 뷰어 `node --test apartment/viewer/test/*.test.mjs`: 108 통과.
- 헤드리스 Chrome(스크래치 `setup_e2e.mjs`, HUB=memory·mock·`npm start` 경로):
  - 처음 켬: 23/23. `/` → `/setup/`, 집 바꿈(apartment 65기기), 거실 TV 신호 없음, 3D 벽 A·B를 진짜 마우스로 골라 저장(touch 모드 5.15m), 대시보드 카드 「모름 · 신호 없음」, 콘솔 오류 0.
  - 다시 켬: 4/4. 바로 대시보드, 저장한 집과 신호 없음 그대로.

**남은 것**
1. 실제 폰으로 3단계(기준점 기록)와 집 바꾼 뒤 폰 재연결(같은 포트)을 시험한다.
2. HUB=matter network 전송(npm start 기본)에서 집 바꾸기를 확인한다. local 전송만 확인했다.
3. 3D 뷰어가 신호 없음 기기를 「모름」으로 보이게 한다. 지금은 마지막으로 받은 값을 그대로 둔다(조작은 서버로 감). twin-studio `main.mjs` 표시 작업이 필요하다.
4. 신호 출처에 ThinQ(읽기 전용, `{ kind: "thinq", deviceId }`)를 더한다.
5. 사용자 확인 뒤 커밋: twin-home `feat/setup-flow`, twin-studio `apartment/viewer/live.mjs`·`test/live.test.mjs`.
