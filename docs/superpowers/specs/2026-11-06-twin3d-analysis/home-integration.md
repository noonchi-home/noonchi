# home-integration 분석 (twin-home 연동 지점 · 진행 중 브랜치)

기준: twin-home-glass `feat/glass-ui` e50edf8(+커밋 안 된 Task 7), twin-home-mode `feat/control-mode` 2bfe990, twin-studio `feat/viewer-wall-touch` 41f9589, 8200 서버(지금 집 `apartment`, 기기 65, provider mock, eye 켜짐, brain 꺼짐).

## 1. 결론

- 새 렌더러는 **twin-home `ui/src/twin3d/`(새 폴더)** 에 두고, 지금 `ui/src/twin/`(iframe + `aptViewer`)을 갈아 끼운다. 서버는 거의 그대로 쓴다.
- 남길 계약: `/twin/*` 경로 배치, scene.json 모양·좌표, 물건 id = 기기 id, `/events` 메시지, `/api/devices`·`/api/health`·`/api/layout`·기준점 API, 상태 효과 어휘.
- 서버에 필요한 변경은 작다: `layout` 메시지를 계약 타입에 넣기, 정적 파일 캐시(ETag), `plan` 메시지(이미 계획됨), 접속 때 에이전트 집중 상태 스냅숏.
- 두 브랜치 모두 아직 초반이다. glass는 Task 7 진행 중(커밋 안 됨), mode는 계획 문서만 있다. **겹치는 곳은 `Dashboard.tsx`, `BubbleLayer.tsx`, `src/contract/events.ts`, `ui/src/lib/messages.ts`, `ui/package.json`, 설정 화면 React 이전(두 계획에 중복)**.
- 합치는 순서: glass(Task 7 → 5b → 9) → mode를 그 위로(설정 React 포함) → React 계획 Task 10(서버가 `ui/dist`를 내줌, 옛 `web/` 삭제) → 그 위에서 새 브랜치. twin-studio `feat/viewer-wall-touch`도 먼저 main에 들어가야 한다(목련 집·벽 고르기가 거기 있음).

## 2. 서버 연동 지점

### 2.1 `/twin/*` 정적 제공 (`src/server/app.ts` 409~423, `static.ts`)

| 경로 | 실제 폴더 |
|---|---|
| `/twin` | 301 → `/twin/` |
| `/twin/viewer/*` | homes.json `viewer`(모든 집 공용, 지금 `apartment/viewer`) |
| `/twin/lib/*` | homes.json `library`(모든 종류 GLB, 18MB) |
| `/twin/*` 나머지 | 고른 집 `out`(목련: `homes/mokryeon_180b` → `scene.json`, `assets/` 55개 GLB 12MB, `apartment_complete.glb` 7.6MB, `plan.png`, `rooms/`) |

- 집을 바꾸면 앱 묶음을 새로 만들어 `/twin/`이 새 집 폴더를 가리킨다. 바꾸는 동안 `/twin/*`은 503, `/events` 업그레이드는 끊긴다(`shell.ts`).
- `serveFile`: 요청마다 `readFileSync`로 파일 전체를 읽고 `cache-control: no-cache`, **ETag·Last-Modified 없음** → 새로 고칠 때마다 GLB·텍스처·HDR을 전부 다시 받는다. 고품질 에셋(수십 MB)을 쓰면 반드시 고친다.
- MIME: `.glb .gltf .bin .wasm .hdr .ktx2 .png .jpg .webp`는 있음. `.exr`는 없음(octet-stream으로 나감).
- `/api/health.twin` = 집 `out` 폴더가 있는가. 없으면 상태 알약에 「3D 트윈 없음」.

### 2.2 집 고르기·전환 (`home.ts`, `start.ts`, `shell.ts`, `src/setup/store.ts`)

- 시작 집: 저장한 집 → `HOME_ID` → homes.json `default`(지금 `apartment`). 목련은 설정에서 고르거나 `HOME_ID=mokryeon_180b`.
- `POST /api/setup/home {home}` → 지금 묶음(허브·정책·에이전트·배치 편집기·기준점·폰 서버·두뇌·앱)을 닫고 새로 만든다. 실패하면 이전 집으로 되돌린다.
- 전환 뒤 새 소켓의 `hello.home`이 바뀌면 대시보드는 `location.reload()`(Dashboard.tsx). 새 렌더러도 이 방식을 그대로 쓰면 된다(장면 해제 코드를 줄일 수 있음).
- 쓰기 API는 본문 `home`이 지금 집과 다르면 409(다른 탭에서 바꿈).

### 2.3 `/events` 메시지 (`src/contract/events.ts` `ServerMessage` + `layout`)

| type | 내용 | 보내는 때 | 새 렌더러 쓰임 |
|---|---|---|---|
| `hello` | `devices, provider, hub, home` | 접속 때 | 집 바뀜 → 새로 고침 |
| `state` | `DeviceState {id, online, twin{attr:값}, matter, updatedAt, signal?:"none"}` | 접속 때 전체 + 바뀔 때 | 상태 효과 적용, `signal:"none"`은 「모름」(화면 값 유지) |
| `layout` | `op: move{id, room, plan, position[x,h,y], rotation}` · `add{object}` · `remove{id}` | 접속 때 원본과 다른 것 전부 + 편집마다 | 물건 옮기기·더하기·빼기. **계약 타입·`KNOWN`에 없음 → 지금 React는 버린다**(iframe 뷰어만 반영) |
| `focus` | `targets[{id,label,position[x,h,y]}], at, ttl_ms 8000` | **`FOCUS=1`일 때만**(기본 꺼짐, 사용자 요청) | 자동 집중 입력으로 쓰지 않는다 |
| `eye` | `position[x,y], height_m, yaw_deg, pitch_deg, tracking, at, estimated?` | 폰 자세마다(약 10Hz). 맞추기 전엔 `estimated:true`(창가 고정 위치 + 폰 방향) | CLOiD 눈 위치·방향 |
| `agent` | `action{sessionId, action{tool, args, ok, deviceId?, needsConfirmation?, reason?, observation?, at}}` · `reply{message, reply, actions, pendingConfirmations}` · `pending` · `confirmed` · `cancelled` | 실시간 | 상호작용 대상·실행·결과 |
| `brain` | `brain{stage, state, text, at_ms, evidence_age_ms, generation}` · `request` · `action{plan: ActionPlan(dry_run:true)}` · `result{outcome}` · `perception` · `presence{person,cup,table}` | BRAIN=1일 때 | 컵 시나리오 단계·결과 |
| `photo` | `PhotoRecord` | 폰 사진 | 판단 기록용 |
| `plan`(계획만, 미구현) | `PlanView \| null` | `2026-11-06-agent-on-twin.md` Task 1~3 | 경로·단계·로봇 위치 |

- 지금 대시보드는 소켓이 **2개**다(React `useEvents` + iframe 뷰어 `live.mjs`). 새 렌더러는 React 쪽 하나만 쓴다.
- 접속 때 스냅숏은 `hello`·`state`·`layout`뿐이다. 에이전트·두뇌 상태 스냅숏이 없어 **새로 고치면 지금 집중 대상·진행 단계를 모른다**.
- 순서 번호가 없다. 한 소켓 안 순서는 지켜지지만 「오래된·역순 이벤트 무시」는 `action.at`(ISO), `brain.at_ms`·`generation`, `eye.at`으로만 판단할 수 있다.

### 2.4 `/api` 경로 (새 렌더러·설정이 쓰는 것)

| 경로 | 쓰임 |
|---|---|
| `GET /api/health` | `twin`, `home`, `eye`, `brain`(mode 브랜치가 `mode: test\|live` 추가) |
| `GET /api/devices` | `DeviceView`: `id`(= scene 물건 id), `room`, `roomLabel`, `twinType`, `kind`, `twinAttrs`, `state` |
| `GET /api/rooms` | 방 id·이름 |
| `GET /api/layout` | 보정 상태(`edits, dirty, savedAt, items`) |
| `POST /api/devices/:id/twin` `{attr, value, confirmToken?}` | 옛 뷰어 가전 패널이 쓰던 조작(409 = 승인 필요). 대시보드 입력 금지 규칙과 함께 둘지 **확인 필요** |
| `GET/POST /api/phone/touch-points`, `/clear` | 설정 3단계 벽 A·B 기준점 |
| `POST /api/layout/save`, `/reset` | 설정 3단계 |
| `GET /api/eye/*` | 눈 창(렌더러와 무관) |
| `/api/setup*` | 껍데기 서버가 직접 처리 |

### 2.5 배치 편집기와 scene.json (`src/layout/editor.ts`, `load.ts`)

- 서버는 집 `scene.json`(원본)을 읽어 메모리에 `current`를 두고, `runtime/homes/<id>/edits.json`이 있으면 다시 적용한다. twin-studio 파일은 고치지 않는다(확정은 `python -m studio apply-edits` → 빌드 → 재시작).
- 화면은 원본 `/twin/scene.json`을 받고, 접속 때 오는 `layout` 메시지로 지금 상태를 맞춘다. **scene.json을 다 읽기 전에 layout 메시지가 먼저 올 수 있어 새 렌더러는 쌓아 두었다가 적용**해야 한다.
- 더한 물건의 `asset`: 집 `assets/…` → `lib/assets/…` → `null`(회색 상자). 경로는 `/twin/` 기준 상대.
- 좌표(편집기·뷰어·폰 공통): 평면 x = 동(오른쪽), y = 남(아래), 미터. three.js = `(x, 높이, y)`, `rotation.y = -(facing_deg - 90)°`. 눈은 `yaw 0 = +x, 90 = +y(three +z)`, pitch 아래가 음수.
- `editor.center(id)`: 초점 높이 = 바닥 + 키/2(천장 물건은 반대). 집중 대상 위치 계산에 같은 규칙을 쓰면 서버와 맞는다.
- 지금 집 전체(원본+보정)를 한 번에 주는 REST는 없다(필요하면 `GET /api/layout/scene` 추가).

### 2.6 목련 scene.json에서 연동에 걸리는 사실

- 방 15개(다각형), 벽 43, 문 15, 창 10, `open_edges` 2(현관–거실, 주방–거실), 물건 57(구조 2·가전 8·가구 22·설비 25), 조작 가능 30, 모두 asset 있음.
- `stage.camera`: 정사영, 고도 50°, 방향 (0.45, 0.77, 0.45). `wall_cut_height` 1.05.
- **로봇·충전대 물건이 없고 `plan.robot`이 null**. agent-on-twin 계획의 경로 시작점(`robot` → `dock`)이 목련에선 없다 → 지금 [0,0](집 밖)이 된다. 로봇 위치를 지어내지 말고 twin-studio 데이터로 넣을지 **확인 필요**.
- `plan.source.note`: 「수동 트레이싱, 치수 근사, 시공·실측 도면 아님」. `ar_anchors` 두 곳은 「미보정 후보」.
- 상태 효과 어휘: `part, emissive, visible, rotate, light, intensity, spin, translate`(GLB `userData.part`·`userData.light`). 순수 함수는 twin-studio `states.mjs`.

## 3. 화면(ui/src) 구조와 뷰어 의존

### 3.1 파일과 역할

| 파일 | 하는 일 | 새 렌더러에서 |
|---|---|---|
| `twin/TwinStage.tsx` | iframe `/twin/viewer/?live=auto&embed=1`, 로드 뒤 `hideViewerBar`, `setBadges(false)`, `setWallMode("low")`, 덮개 층(빈 곳 마우스는 3D로) | 캔버스로 대체. 덮개 층 방식은 유지 |
| `twin/embed.ts` | iframe 안 `.bar` 숨김 + resize | 삭제 |
| `twin/viewer.ts` | `AptViewer` 타입, `waitForViewer`(100ms 폴링, 15초) | 삭제 |
| `twin/anchors.ts` | 노드 Box3 위 가운데 + 0.08m | 새 장면에서 같은 규칙으로 |
| `twin/use-anchors.ts` | rAF마다 투영 → 바뀌면 `setState` | **카메라가 움직이는 동안 React가 매 프레임 다시 그림** → ref로 DOM 직접 옮기기로 바꿈 |
| `twin/project.ts` | 순수 투영 | 그대로 써도 됨 |
| `twin/visibility.ts` | 방 초점(isolate) 때 다른 방 말풍선 숨김 | 새 벽·방 숨김 규칙으로 |
| `bubbles/BubbleLayer.tsx`, `summary.ts` | 모든 기기 말풍선(Task 5b에서 「확인한 것만」으로 바뀜). 「모름」에 `border-dashed`가 남아 있음(규칙 위반, 5b·7에서 정리) | 좌표 공급원만 바뀜 |
| `dashboard/Dashboard.tsx` | 기기·health·이벤트를 모아 TwinStage + 패널 | 새 렌더러를 꽂는 곳(충돌 1순위) |
| `lib/messages.ts` | `KNOWN`에 없는 type 버림(`layout`·`plan` 없음) | `layout`·`plan` 추가 |
| `lib/use-events.ts` | 소켓 1개, 2초 뒤 재접속 | 그대로, 렌더러는 이 흐름을 구독 |
| `panels/*`, `chat/*` | 상태 알약·눈 창·판단 기록 | 렌더러와 무관(위치만 피함) |

- `ui/`에는 `three` 패키지가 없다(`@types/three` 0.187.0만). 뷰어는 CDN `three@0.186.1`. React 계획 Global Constraints의 「3D 객체는 `aptViewer.THREE`로만」은 새 브랜치에서 없앤다.
- 바뀔 시험: `viewer.test.tsx`, `use-anchors.test.tsx`, `visibility.test.ts`, `smoke.test.tsx`(3D 자리), `bubble-layer.test.tsx`(좌표 입력).

### 3.2 화면이 쓰는 `aptViewer` 기능 전체

- 대시보드: `THREE, scene, camera(정사영), cctvCamera, renderer, ready, loading, results, view{cctv, focus, isolate, showCeiling, wallMode}, objects(), node(id), hidden(id), setBadges, setWallMode, setFocus, renderNow`.
- 설정 3단계(`web/setup/setup.js`): `startPick(cb)` → `{position:[x,y], wall, height_m}`(벽의 방 쪽 면 위 점), `cancelPick`, `setTouchPoints([{id,label,position}])`(눈높이 1.5m 핀과 이름표).
- 뷰어가 iframe 안에서 스스로 하던 일(`live.mjs`): `state → setState`(상태 효과), `eye → setEye`(원뿔), `layout → applyLayout`, `focus → setFocus`(고리), 가전 패널 조작 → `POST /api/devices/:id/twin`(409면 승인 알림).
- 옛 대시보드 `web/app.js`·`web/index.html`도 같은 iframe을 쓰지만 React 계획 Task 10에서 지운다.

### 3.3 설정 화면의 3D

- 옛 `web/setup/`: 위치 동기화 단계에서만 iframe(`…&home=<id>`)을 띄워 벽 A·B를 고르고 핀을 보인다. `HEAD /twin/viewer/`로 뷰어 있는지 본다. `layout`·에이전트 답이 오면 보정 목록을 다시 읽는다.
- mode 브랜치 Task 7이 이를 `ui/src/setup/PositionStep.tsx`로 옮긴다. 그때는 **iframe을 그대로 쓰게 두고**, 새 렌더러가 벽 고르기·핀 API를 갖춘 뒤 바꾼다.

## 4. 에이전트 상태 데이터 (스펙 8.1과 비교)

| 스펙 항목 | 지금 있는 것 | 없는 것 / 어댑터가 할 일 |
|---|---|---|
| CLOiD 위치 | `eye`(폰 자세, 10Hz, 맞추기 전 `estimated`) | 로봇 몸 위치 없음(목련에 로봇 물건 없음). `PlanView.robot`은 계획만 |
| 관찰 공간 | 없음 | `eye` 위치 → 방 다각형 판정은 「물리 위치」일 뿐, 집중 공간으로 쓰면 안 됨 |
| 주요 관찰 대상 | `brain presence{person,cup,table}`(물건 id 없음) | 컵 두뇌는 식탁 종류(`dining_table`)로 이어 붙임(Task 5b 규칙) |
| 현재 목표 | `agent reply.message`(답이 온 뒤), `brain action.plan.task` | 답 전 진행 중 목표 없음. `PlanView.goal` 필요 |
| 계획 대상 공간·상호작용 대상 | `agent action.deviceId` → `DeviceView.room`, `pending.deviceId` | 두뇌 쪽 대상 id 없음. `PlanView.steps[].target` 필요 |
| 실행 중 행동 | `agent action{tool, ok, needsConfirmation}`, `brain stage/state` | |
| 결과 | `action ok/error/observation`, `confirmed/cancelled`, `brain result.outcome` | |
| 계획 수정·재판단 | `brain generation` | 명시 필드 없음. `PlanView` 같은 id 갱신으로 받기 |
| 시험·실제 구분 | `ActionPlan.dry_run:true`, provider `mock`, (mode 브랜치) `health.mode` | 이벤트마다 표시는 없음 |
| 시야(FOV) | 없음(`eye`에 FOV 없음) | 원뿔은 「대략」으로만 |

- `focus` 메시지는 사용자 요청으로 기본 꺼져 있다. 자동 집중은 `agent`·`brain`·`plan`에서 만든다.
- 트윈 위 표시는 「에이전트가 확인한 기기·물건만, 점선 금지」(CLAUDE.md 규칙 표). 강조·라벨도 이 규칙을 따른다.

## 5. 진행 중 브랜치

### 5.1 상태

| | twin-home-glass `feat/glass-ui` | twin-home-mode `feat/control-mode` |
|---|---|---|
| 6fbb7cb 뒤 커밋 | `e50edf8` 계획 문서(Task 7)·CLAUDE.md만 | `2bfe990` 계획 문서(`2026-11-06-control-mode.md`)만 |
| 커밋 안 된 변경 | Task 7 진행 중: `ui/src/chat/turns.ts`, `ui/src/components/ui/chat-panel.tsx`, `ui/tests/turns.test.ts`, 새 `ui/tests/decision-log.test.tsx`·`no-input.test.tsx`, `ui/package.json`(+motion, radix collapsible·tabs, tw-animate-css)·lock | `.gitignore`만(구현 시작 전) |
| 남은 일 | Task 7(판단 기록, `?look=parts\|glass`, StatusPill·EyeWindow·BubbleLayer·Dashboard·styles.css), 5b(확인한 것만 말풍선), 8(설정 React), 9(TSX 글 검사), 10(`ui/dist` 제공, 옛 `web/` 삭제) | Task 1~6 서버(ThinQ·SignalHub·설정 API·`HealthView.mode`·에이전트 글), 7~8 설정 React + 운영 모드 단계, 9 전체 확인 |

- 두 브랜치 모두 `main`(0972b74)보다 25커밋 앞(eye-h264·setup-flow·brain 포함). main에는 아무것도 안 들어갔다.
- twin-studio `feat/viewer-wall-touch`(main보다 6커밋 앞): 목련 집, 벽 고르기(`startPick`), 「모름」 표시. twin-home 지금 동작이 이 브랜치에 기대고 있다.
- `agent-on-twin` 계획(경로·로봇 말풍선)은 아직 시작 전이다. 서버 Task 1~3은 렌더러와 무관, 화면 Task 4~5는 `aptViewer.THREE` 기준이라 새 렌더러로 다시 짜야 한다.

### 5.2 겹치는 파일

| 파일 | glass | mode | agent-on-twin | 새 렌더러 |
|---|---|---|---|---|
| `ui/src/dashboard/Dashboard.tsx` | Task 7·5b | - | Task 4·5 | 캔버스·컨트롤러 꽂기 |
| `ui/src/bubbles/BubbleLayer.tsx` | Task 7·5b | - | - | 좌표 공급원 |
| `ui/src/twin/*` | 5b가 `useAnchors` 사용 | - | Task 4·5 사용 | 통째로 대체 |
| `src/contract/events.ts` | - | `HealthView.mode` | `plan` 메시지 | `layout` 메시지 |
| `ui/src/lib/messages.ts` (`KNOWN`) | - | - | `plan` | `layout` |
| `ui/package.json`·lock | Task 7 패키지 | - | - | `three` 등 |
| `ui/src/panels/StatusPill.tsx` | Task 7 모양 | 합친 뒤 모드 표시 | - | 품질·추적 단추 자리 |
| `ui/src/setup/*` | Task 8 | Task 7·8(같은 일) | - | 벽 고르기 나중에 |
| `src/server/app.ts`·`static.ts`·`shell.ts` | Task 10(`DEFAULT_WEB_DIR`) | health·설정 API | `/api/plan` | 캐시·MIME |
| `scripts/lint-ui-copy.ts` | Task 9 | - | `src/plan/labels.ts` | 새 글도 검사 대상 |

- **설정 화면 React 이전이 두 계획에 중복**(React 계획 Task 8 = control-mode Task 7). 한쪽만 해야 한다. mode 쪽이 운영 모드 단계까지 넣으므로 mode가 맡는 것이 맞다(**사용자 확인 필요**).

### 5.3 합치는 순서

1. glass: Task 7 → 5b → 9를 끝낸다. Task 8은 건너뛰고, Task 10은 미룬다(설정 React 전에 `web/setup`을 지우면 `/setup/`이 깨진다).
2. mode를 glass 위로 다시 얹는다(rebase). 충돌 예상: `ui/package.json`·lock, `HealthView` 시험 값(`status-pill`·`eye-window` 시험), StatusPill 모드 표시.
3. 합친 브랜치에서 React 계획 Task 10(서버가 `ui/dist`를 내줌, 옛 `web/` 삭제). 이 전에는 8200 `/`가 옛 화면이라 새 렌더러는 5173(vite 프록시)에서만 보인다.
4. twin-studio `feat/viewer-wall-touch` → main.
5. 그 위에서 twin-home 새 브랜치(예: `feat/twin3d`)와 twin-studio 데이터 브랜치(재질·모델·HDRI·로봇 위치)를 판다.
6. agent-on-twin 서버 Task 1~3(계약·바닥 경로·planner)은 렌더러와 따로 먼저 해도 된다. 화면 Task 4~5는 새 렌더러에서 다시 짠다.
- main에 합칠지, 통합 브랜치로 둘지 **확인 필요**.

### 5.4 가를 곳

- **폴더**: 새 코드는 `ui/src/twin3d/` 아래(장면·카메라·Semantic Zoom·에이전트 집중·에이전트 표시·렌더 파이프라인·미니맵을 파일로 나눔). glass·mode가 건드리는 `chat/`, `look/`, `setup/`, `panels/`와 겹치지 않는다.
- **포트 인터페이스**: 말풍선·확인 목록·계획 화면이 `aptViewer`가 아니라 작은 인터페이스(물건 목록, 경계 상자, 방, 화면 좌표, 숨김 여부, 프레임 구독, 벽 고르기, 핀)에 기대게 한다. iframe 어댑터와 새 렌더러가 같은 인터페이스를 구현하면 `?twin=iframe|three`로 바꿔 가며 비교할 수 있고, 새 렌더러가 다 될 때까지 iframe을 대체 경로로 남길 수 있다.
- **데이터 흐름**: 소켓은 `useEvents` 하나. 렌더러 컨트롤러는 React 상태가 아니라 바깥 저장소를 구독하고, 매 프레임 일은 React 밖(rAF)에서 한다.
- **계약 파일**: 새 타입은 `src/contract/`의 순수 타입 파일에만(`layout.ts`, `scene.ts`, `plan.ts`). `editor.ts`는 거기서 다시 내보낸다.

## 6. 새 렌더러가 대체할 것 / 남길 계약

**대체**
- `ui/src/twin/TwinStage.tsx`(iframe), `embed.ts`, `viewer.ts`, `anchors.ts`, `use-anchors.ts`, `visibility.ts`와 그 시험.
- iframe 뷰어 `live.mjs`가 하던 일(상태 효과, 눈 원뿔, 배치 보정 반영, 초점 고리) → React 쪽 한 소켓에서.
- 뷰어 전용 보기: `wallMode`(full·auto·low), `isolate`·`focusRoom`, `showCeiling`, CCTV 원근 카메라, 배지. CCTV 보기를 남길지 **확인 필요**.
- 나중 단계: 설정 3단계 벽 고르기(`startPick`·`cancelPick`·`setTouchPoints`).

**남길 계약**
- `/twin/scene.json`·`/twin/assets/*`·`/twin/lib/*` 경로와 homes.json(집마다 `out`, 공용 `library`).
- scene.json 모양: `plan`(rooms·walls·doors·windows·open_edges·solids·ceiling_height·wall_cut_height·ar_anchors), `stage`(camera·sun·background), `objects`(id·type·room·mount·category·plan·position·rotation·scale·attrs·states·interactive·asset).
- 좌표: 평면 (x 동, y 남, m) ↔ three (x, 높이, y), `rotation.y = -(facing_deg - 90)°`, 눈 yaw·pitch 규칙.
- id: scene 물건 id = `DeviceView.id` = 에이전트 `deviceId`, 방 id = `plan.rooms[].id` = `DeviceView.room`.
- `/events`: `hello`(집 바뀌면 새로 고침), `state`(`signal:"none"` = 모름), `layout`(접속 때 동기화 포함), `eye`, `agent`, `brain`, `photo`, (계획) `plan`.
- 상태 효과 어휘(`part, emissive, visible, rotate, light, intensity, spin, translate`)와 GLB `userData.part`·`userData.light`.
- 대시보드 규칙: 입력 없음(`no-input` 시험이 `input, textarea, select, form, [contenteditable], role=textbox|searchbox|combobox`를 막음 → **품질 프리셋·자동 추적은 단추로**, `<select>` 금지), 확인한 것만 표시·점선 금지, 화면 글 검사(Task 9 뒤 TSX 포함).
- 로컬 출처만(`LOCAL_ORIGIN`), 127.0.0.1.

## 7. 새 브랜치에서 서버에 할 일

1. `LayoutMessage`·scene.json 타입을 `src/contract/`로 옮기고 `ServerMessage`·`KNOWN`에 `layout` 추가.
2. 정적 파일: ETag/Last-Modified + 304(또는 해시 이름 + `immutable`), 큰 파일은 스트림. `.exr`를 쓰면 MIME 추가. Draco·KTX2 디코더는 `ui/public` → `ui/dist`(Task 10 뒤 `/`에서 나감).
3. `plan` 메시지와 `GET /api/plan`(agent-on-twin Task 1~3). 접속 때 지금 계획을 보낸다.
4. 접속 때 에이전트 집중 상태(마지막 대상·단계) 스냅숏, 필요하면 방송 순번.
5. 고품질 에셋 위치: 모델·텍스처·HDRI는 twin-studio `library/`(→ `/twin/lib/`)에 두는 안. 출처 표기(CC-BY) 목록도 같이 둔다.

## 8. 위험 · 확인 필요

- 설정 React 이전 중복(glass Task 8 vs mode Task 7) — 누가 맡을지 확인 필요.
- 목련에 로봇·충전대 없음 → 로봇 위치·경로 시작점 데이터 확인 필요. 그 전에는 `eye`만 「CLOiD 눈」으로 보인다.
- `POST /api/devices/:id/twin`(3D에서 기기 조작)을 새 대시보드에 둘지 확인 필요(입력 금지 규칙).
- 접속 스냅숏이 없어 새로 고침 뒤 자동 집중이 빈 상태로 시작한다.
- 지금 서버는 `apartment` 집이다. 목련 확인은 설정에서 집을 바꾸거나 `HOME_ID=mokryeon_180b`로 띄워야 한다.
- 헤드리스 크롬은 SwiftShader라 FPS·GTAO 성능은 이 PC 실제 크롬(Radeon 내장)에서만 의미가 있다. 3D 크롬은 한 번에 하나.
