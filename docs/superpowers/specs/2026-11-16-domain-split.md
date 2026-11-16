# 소스 코드 도메인 나누기 설계안

- 기준: 구현명세서 SSOT 3.1 구성 요소·3.3 판단 흐름과 모듈 대응·6절 모듈 명세, 기획서 SSOT, `docs/reference.md`.
- 잰 코드: `feat/coach-cup` 0a392c5(2026-11-16). 코드는 아직 옮기지 않았다.
- 옮기기는 새 브랜치 `refactor/domain-split`(feat/coach-cup 끝에서 시작, 따로 worktree)에서 단계마다 한다. feat/coach-cup은 그대로 둔다.

## 0. 결론

- **도메인은 문서 구성 단위로 13개다(사용자 결정 2026-11-16).** 서버 9개는 실제 폰 `phone`, 관찰 흐름 `observe`, World State `world`, 판단·반성 `brain`(PAM 서비스 연결과 기록·반성), 판단·검사·실행 `act`, 에이전트 `agent`, 가상 가전·ThinQ `devices`, 배치 저장소 `layout`, API 서버 런타임 `server`다. 화면 4개는 대시보드, 트윈 화면, 실제 폰 화면, 설정 화면이다. 그 밖은 기반층이다: 계약, 공용 표, 공용 도우미 `shared`, 외부 API 게이트웨이 `infer`, 디자인 토큰.
- **지금은 한 덩어리다.** `src/` 20개 폴더 가운데 18개가 서로 물고 도는 고리 하나에 들어 있다. 서로 가져오는 폴더 짝이 18쌍이다.
- **새 방향에서 거꾸로 가는 import는 28개이고, 고침은 13가지(F1~F13)다.** 위 도메인으로 묶고 공용 표·기반층을 따로 세우면 도메인 사이 import 488개 가운데 28개만 남는다.
- **막는 장치는 `scripts/lint-domains.ts`와 `tests/domain-boundaries.test.ts`다.** 다른 도메인은 입구(`index.ts`)로만, 정한 방향으로만 가져온다. 실제 파일 그래프 전체에서 도메인을 넘는 고리를 찾고, 화면이 닿는 서버 파일에 node 모듈이 섞이면 실패한다. 옮기는 동안은 예외 목록이 줄어들기만 하게 한다.
- **옮기는 단계는 0~9단계다.** 단계마다 전체 시험 통과와 `scripts/check-moves.ts`(AST 비교)로 「import 경로만 달라짐」을 확인한다. 에이전트 시간으로 약 22시간 걸린다.
- **정한 것(5절, 사용자 2026-11-16):** 짧은 영어 폴더 이름, 서버 도메인 9개, 공용 표는 도메인에, 큰 파일은 `track.ts`·`home.ts`·`app.ts` 셋만 쪼갠다.

## 1. 지금 지도

### 1.1 서버 폴더(`src/`, 20개)

| 폴더 | 하는 일 | 파일 | 줄 | 문서 단위 |
|---|---|---|---|---|
| `act` | 행동 목록, 계획 전 검사, 실행 추적(`track.ts`), 보기 담당, 말풍선 한 문장 | 10 | 2,341 | 판단·검사·실행 6.3 |
| `agent` | 말 요청 에이전트, 계획 모드, 관찰 모드, 도구, 승인 정책·기억, 공급자 | 16 | 2,907 | 에이전트 6.6 |
| `brain` | YOLO 감지기·마스크 풀기 + PAM 연결·판단 입력 모양 | 5 | 1,092 | 관찰 흐름 6.1 + PAM 6.12 (둘이 섞임) |
| `contract` | 서버↔화면 계약 타입 | 9 | 767 | 18.1 계약 |
| `design` | 디자인 토큰·대비 검사 | 2 | 491 | 12 화면 디자인 |
| `history` | 기록 DB, 하루 요약, 반성, 사진 보관 | 7 | 651 | 기록·반성 6.13 |
| `hub` | 가전 허브 계약(`types.ts`), 메모리 허브, 신호 출처 | 3 | 481 | 가상 가전 |
| `infer` | 추론 모드, OpenAI 호환 호출, 비용 | 6 | 212 | 외부 API 게이트웨이 6.9 |
| `layout` | 배치 편집, 카탈로그, 배치 읽기, 초점 | 4 | 623 | 배치 저장소 9 |
| `matter` | matter.js 가상 가전 브리지·컨트롤러 | 7 | 1,487 | 가상 가전 |
| `mcp` | MCP stdio 서버와 REST 백엔드 | 2 | 105 | 문서에 없음 |
| `model` | 가전 종류 등록부, Matter 매핑, 기기 목록, 장면·도면 설비, 집 목록 | 7 | 1,363 | 가상 가전 + 배치 저장소 (둘이 섞임) |
| `observe` | 엔진 프레임 고리, YOLO·VLM 흐름, 가까이 보기 자르기 | 5 | 927 | 관찰 흐름 6.1 |
| `phone` | 폰 서버·세션·패킷, 눈 영상, 평면도 읽기, AR 자세 | 9 | 1,627 | 실제 폰 3.1 |
| `plan` | 계획 보관·방송, 계획 모양, 경로, 평면도, 이름, 서버 글 | 7 | 594 | 판단·검사·실행 6.3 + 배치 9 |
| `server` | HTTP·WS 앱, 집 실행 묶음, 시작, 잠금, 껍데기 서버, 네트워크 도우미 | 11 | 2,419 | API 서버 런타임 6.11 |
| `setup` | 설정 저장(운영 모드·돕는 방식·ThinQ) | 1 | 249 | API 서버 런타임 6.11 |
| `sync` | 폰 위치 맞추기(시작 위치·물건 기준점·벽 모양) | 6 | 1,345 | 실제 폰 9.6 |
| `thinq` | ThinQ 클라이언트·연결·어댑터 | 3 | 484 | LG ThinQ 3.1 |
| `world` | World State, 낱말 표, 조건, 관찰 텍스트, 호출 시점, PAM 판단 호출 | 13 | 2,705 | World State 6.2 |

### 1.2 화면 폴더(`ui/src/`, 10개)

| 폴더 | 하는 일 | 파일 | 줄 | 문서 단위 |
|---|---|---|---|---|
| `dashboard` | 대시보드 화면·말풍선 카드·생각 말풍선·미니맵 | 32 | 2,764 | 대시보드 12 |
| `bubbles` | 트윈 위 확인한 기기 말풍선 | 3 | 264 | 대시보드 12 |
| `checks` | 확인 목록 리듀서 | 2 | 166 | 대시보드 12 |
| `panels` | 클로이드의 눈 영상 풀기, 폰 주소 | 3 | 305 | 대시보드 12 |
| `twin3d` | three.js 트윈 3D | 17 | 1,858 | 트윈 화면 10 |
| `twin` | 트윈 칸·투영·기준점·뷰어 | 7 | 249 | 트윈 화면 10 |
| `phone` | 실제 폰 화면·AR·말하기 | 37 | 3,923 | 실제 폰 12 |
| `setup` | 설정 화면 4단계 | 9 | 1,100 | 설정 화면 12 |
| `components` | 21st.dev 부품 | 24 | 2,445 | 공용 부품 |
| `lib` | API·이벤트 훅·토큰 | 7 | 130 | 공용 |

### 1.3 폴더 사이 import(실제로 셈)

`src`·`ui/src`의 `import`·`export … from`·`import()` 상대 경로를 따라 폴더끼리 셌다. 시험·스크립트는 뺐다.

- **고리:** `src` 20개 가운데 `design`·`mcp`를 뺀 18개가 고리 하나다. 어느 폴더를 고쳐도 거의 모든 폴더에 닿을 수 있다.
- **서로 가져오는 짝(18쌍, 주요):**

  | 짝 | 가져오는 수 | 까닭 |
  |---|---|---|
  | `act` ↔ `agent` | 7 / 6 | 실행 추적이 계획 검사·도구를, 에이전트가 행동 목록·답 낱말을 씀 |
  | `phone` ↔ `sync` | 8 / 6 | 맞추기가 폰의 AR 자세·평면도 도우미를 씀 |
  | `contract` ↔ `world` | 2 / 9 | 계약이 낱말 표 타입을 씀 |
  | `hub` ↔ `model` | 5 / 4 | 허브 계약이 등록부 타입을 다시 내보냄 |
  | `observe` ↔ `world` | 4 / 2 | World State가 관찰 흐름 타입을 씀 |
  | `act` ↔ `world` | 8 / 1 | World State의 판단 호출이 행동 목록을 씀 |
  | `agent` ↔ `layout` | 2 / 4 | 배치가 에이전트의 글 도우미를 씀 |
  | `phone` ↔ `server` | 2 / 7 | 폰 서버가 서버의 네트워크·파일 도우미를 씀 |

- **아래 단위가 위 단위 안쪽을 가져옴:**
  - `brain`·`infer`·`mcp`·`phone`·`thinq` → `server/net.ts`(재시도 도우미).
  - `contract` → `hub/types.ts`·`brain/seg.ts`·`world/vocab.ts`. 계약이 도메인에 기댄다.
  - `world/decide.ts` → `act/tasks.ts`.
  - `layout` → `agent/search.ts`.
  - `plan/labels.ts` → `agent/phrases.ts`.
- **많이 쓰이는 파일(다른 폴더 수):** `contract/events.ts` 15, `hub/types.ts` 12, `contract/plan.ts`·`world/labels.ts`·`world/vocab.ts` 8, `model/kinds.ts`·`contract/setup.ts` 6.
- **시험·스크립트:** 시험이 서버·화면 안쪽 파일을 936곳에서 바로 가져온다. 15개 파일은 `src/…` 경로를 글로 적어 읽는다(구조 검사 등).

### 1.4 너무 큰 파일

| 파일 | 줄 | 맡은 일 |
|---|---|---|
| `src/act/track.ts` | 1,566 | 판단 받기·계획 시작, 단계 진행, 승인 질문, 켠 위험 가전·끄기 안내, 폰 답·말, 코치 보조(다시 알리기·떠남·조용한 단계·수업 기록). 메서드 87개 |
| `src/world/state.ts` | 1,071 | 감지 합치기, 사람·관절, VLM 사실, 가까이 보기, 카메라로 본 가전 |
| `src/server/app.ts` | 721 | REST 경로 33개(관찰·기록·배치·폰·계획·가전·에이전트)와 WS |
| `src/server/home.ts` | 616 | `startHome` 한 함수 440줄. 모든 도메인을 한곳에서 잇는다 |
| `src/agent/planTools.ts` | 616 | 계획 도구 모양, 계획 검사, 단계 규칙(`needsPhone`·`riskyHand`·`selfStopWait`) |
| `src/server/start.ts` | 477 | 껍데기 서버, 집 바꾸기, 운영 모드 |

### 1.5 문서와 코드가 어긋나는 곳

| 곳 | 문서 | 코드 |
|---|---|---|
| `brain/` | 18.1: YOLO 감지기 + PAM 연결을 한 폴더로 적음 | 6.1 관찰 흐름과 6.12 PAM이 한 폴더에 섞임 |
| PAM 판단 호출 | 3.3: ④ 부를지 정하기는 World State, ⑤ 판단은 PAM | `world/decide.ts`가 PAM을 부르고 판단을 기록함 |
| 계획 검사 | 6.3: 판단·검사·실행이 맡음 | `agent/planTools.ts`(에이전트 폴더)에 있음 |
| 평면도 읽기 | 9.1 트윈 공간 | `phone/home-plan.ts`, `plan/floor.ts`로 두 곳에 나뉨 |
| 계약 자리 | 18.1: 계약은 `src/contract/` | `hub/types.ts`도 공용 계약이라고 적힘(reference.md 구조) |
| 가전 종류 등록부 | 9.2 가구 카탈로그 아래 | `src/model/kinds.ts`(가전 쪽) |
| MCP | 3·6절에 없음 | `src/mcp/`, `npm run mcp` |
| 트윈 iframe | 10.5: 다른 집은 iframe 뷰어 | 저장소 규칙 표는 iframe 금지(막는 장치 없음), `ui/src/twin/embed.ts`·`viewer.ts`가 남음 |
| `docs/reference.md` 「구조」 | 허브·Matter·모델·에이전트·서버·MCP만 적음 | 폴더 20개 |

## 2. 도메인 나누기 안

### 2.1 도메인 목록

폴더 이름은 짧은 영어로 두고, 문서 이름은 각 `index.ts` 첫 줄과 이 표에 적는다(5절 정한 것 1).

**서버**

| 도메인(문서 이름) | 문서 | 폴더 | 들어갈 지금 코드 | 줄(대략) |
|---|---|---|---|---|
| 실제 폰(클로이드의 눈) | 3.1, 9.6, 12 | `src/phone/` | `phone/*`(`home-plan.ts`·`align.ts` 빼고), `sync/*` → `phone/sync/` | 2,500 |
| 관찰 흐름 | 6.1 | `src/observe/` | `observe/*`, `brain/detector.ts`·`detector-thread.ts` | 1,500 |
| World State와 PAM 관찰 텍스트 | 6.2 | `src/world/` | `world/*`(`decide.ts` 빼고) | 2,550 |
| PAM 서비스 연결·기록·반성 | 6.12, 6.13, 3.3 ⑤⑧ | `src/brain/` | `brain/pam.ts`·`decision.ts`(그대로), `world/decide.ts`, `history/*` → `brain/history/`. 감지기 파일은 관찰 흐름으로 나간다. Python 서비스는 `services/pam/` 그대로 | 1,200 |
| 판단·검사·실행 | 6.3 | `src/act/` | `act/*`, `plan/hub.ts`·`labels.ts` | 2,700 |
| 에이전트(LLM) | 6.6 | `src/agent/` | `agent/*`(`phrases.ts` 빼고), `plan/planner.ts`, `mcp/*` → `agent/mcp/` | 3,000 |
| 가상 가전·ThinQ | 3.1, 4, 9.2 | `src/devices/` | `hub/*` → `devices/hub/`, `matter/*`, `thinq/*`, `model/kinds.ts`·`kinds-check.ts`·`mapping.ts`·`devices.ts` | 3,600 |
| 배치 저장소(트윈 공간) | 3.1, 9 | `src/layout/` | `layout/*`, `model/scene.ts`·`drawn.ts`·`homes.ts`, `plan/floor.ts`·`route.ts`·`names.ts`, `phone/home-plan.ts` | 1,400 |
| API 서버 런타임 | 6.11 | `src/server/` | `server/*`(`net.ts`·`static.ts` 빼고), `setup/store.ts` | 2,500 |

**화면**

| 도메인(문서 이름) | 문서 | 폴더 | 들어갈 지금 코드 |
|---|---|---|---|
| 대시보드 | 12 | `ui/src/dashboard/` | `dashboard/`, `bubbles/`, `panels/`, `checks/` |
| 트윈 화면(3D) | 10 | `ui/src/twin/` | `twin3d/`, `twin/` (대시보드와 설정 화면이 같이 씀) |
| 실제 폰 화면 | 12 「실제 폰」 | `ui/src/phone/` | 그대로 |
| 설정 화면 | 12 「설정 화면」 | `ui/src/setup/` | 그대로 |

**기반층(도메인이 아님, 누구나 가져옴, 입구 없이 파일로 가져옴)**

| 이름 | 자리 | 무엇 |
|---|---|---|
| 계약 | `src/contract/` | 순수 타입만. 값 import는 하지 않는다. 계약 밖은 공용 표의 타입만 `import type`으로 가져온다(2.3 타입 전용 의존). 지금 도메인에 흩어진 공용 타입을 여기로 모은다(2.5) |
| 공용 표 | 각 도메인 안 정한 파일 | 문서가 「하나뿐인 표」로 적은 것: 낱말 표 `world/vocab.ts`·`world/labels.ts`, 가전 종류 등록부 `devices/kinds.ts`·`devices/types.ts`, 행동 목록 `act/tasks.ts`·`act/prompts.ts`, 서버 글 `act/labels.ts`, 위치 맞추기 기준점 종류 `phone/sync/classes.ts`(낱말 표에서만 만든다. 감지 Worker가 phone 입구 없이 읽는다). 어느 도메인·화면이든 가져오고, 표 파일은 계약·공용 도우미·다른 표만 가져온다(5절 정한 것 2) |
| 공용 도우미 | `src/shared/` | 도메인 지식이 없는 순수 도우미(2.2). 계약·다른 shared 파일·node 기본 모듈만 가져온다. 도메인·공용 표를 가져오거나 다시 내보내지 않는다 |
| 외부 API 게이트웨이 | `src/infer/` 그대로 | 구현명세서 6.9. 관찰 흐름(VLM)·에이전트(관찰 모드)·서버(준비 상태)가 쓰는 통로다. 규칙은 `shared`와 같다: 계약·`shared`·node 기본 모듈만 가져온다. 지금 가져오는 밖은 `server/net.ts`(`fetchRetry`) 하나이고 2단계에서 `shared/net.ts`가 되어 규칙을 지킨다. `src/shared/infer/`로 옮기지 않는 까닭: 옮길 파일 0개, 시험 import 13곳이 그대로이고, 저장소 규칙 표와 `tests/same-structure.test.ts`가 `src/infer/endpoints.ts` 경로를 이름으로 적는다 |
| 브라우저 입구 | `src/layout/browser.ts` | 화면이 쓰는 경로 찾기만 낸다(`route`·`approach`·`floorPlanFrom`·`roomAt`). 따라 들어가는 import 어디에도 node 모듈이 없다. 장면 읽기·배치 편집기(node:fs)는 `layout/index.ts`에만 있다 |

### 2.2 어느 단위에도 안 맞는 코드

| 코드 | 지금 자리 | 안 |
|---|---|---|
| 시험 대역 | `tests/helpers/` | 그대로(규칙: 대역은 여기에만). 시험은 도메인 안쪽을 바로 가져와도 된다 |
| 개발 도구 | `scripts/`(시연 준비·영상 판정·lint·자산 복사·합성 이력) | 그대로. 처음에는 검사 밖, 마지막 단계에서 입구로만 가져오게 바꾼다 |
| 네트워크·파일 도우미 | `server/net.ts`(`fetchRetry`·`listenRetry`), `server/static.ts` | `src/shared/net.ts`·`static.ts` |
| 한국어 글 도우미 | `agent/phrases.ts`(`josa`), `agent/search.ts`의 `compact`·`stripParticle`, `plan/copy.ts`(화면 글 규칙) | `src/shared/korean.ts`·`copy.ts` |
| 평면 계산 | `phone/align.ts`(AR 자세 → 트윈 평면, 순수 함수) | `src/shared/geometry.ts` |
| 마스크 풀기 | `brain/seg.ts`(순수 함수, World State·대시보드·감지기가 씀) | `src/shared/mask.ts` |
| 파일 자리 기준 자원 경로 | `MODELS_DIR`·`DEFAULT_TWIN_DIR`·`DEFAULT_UI_DIR`·`DEFAULT_WEB_DIR`·`SHARED_VIDEO_DIR`·`DEFAULT_RUNTIME_DIR`(각 파일의 `new URL("../../…", import.meta.url)`) | `src/shared/paths.ts`의 `repoPath()` 하나(0단계). 직접 실행 검사는 같은 파일의 `isEntry()` |
| 디자인 토큰 | `src/design/` | 그대로(규칙 표가 이 경로를 원본으로 적음) |
| 화면 공용 | `ui/src/components/ui/`(21st.dev 부품), `ui/src/lib/` | 그대로. 부품은 파일마다 가져온다(lint-ui-parts가 이미 봄) |
| 옛 화면 조각 | `web/` | 그대로 |
| 폰 화면 사진 페이지 | `ui/src/phone/shots.tsx`·`fixtures.ts` | 그대로(서버 글은 공용 표로 가져옴) |

### 2.3 의존 방향

위에서 아래로만 가져온다. 같은 줄끼리는 아래 표에 적은 것만 된다.

```text
                 [API 서버 런타임 server]  ← 모든 도메인을 잇는 조립 자리
                           │
                 [판단·검사·실행 act]
                           │
      ┌────────────────────┼─────────────────────┐
[에이전트 agent]   [판단·반성 brain]    [관찰 흐름 observe]
      │                    │                     │
      │                    │              [실제 폰 phone]
      │                    │                     │
      └────────────────────┼─────────────────────┘
                  [World State world]
                           │
                 [배치 저장소 layout]
                           │
                 [가상 가전·ThinQ devices]

  ── 기반층: 계약 contract · 공용 표 · shared · 게이트웨이 infer · design ──
```

| 도메인 | 가져와도 되는 도메인(기반층은 늘 됨) |
|---|---|
| `devices` | 없음 |
| `layout` | `devices` |
| `world` | `devices`, `layout` |
| `phone` | `world`, `layout` |
| `observe` | `phone`, `world`, `devices` |
| `brain` | `world`, `devices` |
| `agent` | `world`, `devices`, `layout` |
| `act` | `agent`, `brain`, `observe`, `phone`, `world`, `devices`, `layout` |
| `server` | 모두 |
| 화면 `ui/src/twin` | 화면 공용, `src/layout/browser.ts`(경로 찾기 브라우저 입구)만 |
| 화면 `dashboard`·`setup` | `ui/src/twin`, 화면 공용 |
| 화면 `phone` | 화면 공용 |
| 화면 → `src` | 계약, 공용 표, `shared`, `design`, `layout/browser.ts`만. 화면이 닿는 `src` 파일은 따라 들어간 import까지 node 모듈(`node:*`·`fs`·`path`·`url`·`worker_threads` 등)을 쓰지 않는다 |

이 표에는 고리가 없다(차례: `devices` → `layout` → `world` → `phone` → `observe`·`brain`·`agent` → `act` → `server`). 도메인을 하나 더하거나 줄을 고칠 때는 이 표 하나만 고친다. 막는 장치는 이 표의 고리와, 실제 파일 그래프 전체에서 도메인을 넘는 고리(`shared`·`infer`·계약·표를 거쳐 도는 것 포함)를 모두 찾는다.

**타입 전용 의존(`DeviceKind`, 정한 것 2):** 계약 타입 `DeviceSpec`·`Command`는 가전 종류 등록부에서 파생한 `DeviceKind`를 쓴다. 표는 도메인에 두기로 했으므로 계약은 공용 표 파일에서 `import type`만 할 수 있다(실행 때 지워진다, 값 import 금지). 계약 ↔ 공용 표 사이 타입 전용 고리는 기반층(계약·공용 표) 안에서만 허용한다. 그 밖의 고리는 타입 전용이어도 실패한다.

### 2.4 입구 하나

- 도메인마다 `index.ts` 하나가 밖에 내놓는 것을 모두 내보낸다(`export … from`만, 로직 없음). 첫 줄에 문서 이름과 절을 적는다. 예: `// 판단·검사·실행(구현명세서 6.3)`.
- 다른 도메인은 `index.ts`나 공용 표 파일로만 가져온다. 도메인 안에서는 지금처럼 파일끼리 가져온다.
- 지금 다른 폴더가 가져오는 파일 수로 본 입구 크기: `act` 11 → 7(경로·이름·계획 모양이 빠진 뒤), `phone` 11, `devices` 9, `agent` 9, `brain` 8, `layout` 7, `observe` 6, `world` 6. 기반층(`contract`·`shared`·`infer`·`design`·공용 표)은 입구 없이 파일로 가져온다.
- 화면 공용 부품(`ui/src/components/ui/`)은 입구 없이 파일마다 가져온다.

### 2.5 거꾸로 가는 import 고치기(28개, 고침 13가지)

| # | 지금 | 고침 |
|---|---|---|
| F1 | `world/state.ts`·`pose.ts` → 감지기·`observe/ring.ts`·`observe/scene.ts` 타입(5), `world/place.ts`·`sight.ts`·`state.ts` → `phone/session.ts`(`CameraView`, 3), `history/retention.ts` → `observe/ring.ts`(`EngineFrame`, 1) | World State 입력 모양(`Detection`·`Pose`·`Keypoint`·`EngineFrame`·`SceneObservation`·`CameraView`)을 `contract/observe.ts`로 옮김 |
| F2 | `agent/planTools.ts` → `plan/floor`·`names`·`planner`, `act/lessons`(4) | `floor`·`route`·`names`는 배치 저장소로, `planner`(계획 모양 만들기)는 에이전트로, `Lesson` 타입은 `contract/plan.ts`로 |
| F3 | `agent/planTools.ts` → `world/decide.ts`(`DecisionRecord`, 옮긴 뒤 `brain`) | 타입을 계약으로 |
| F4 | `layout/catalog.ts`·`editor.ts` → `agent/search.ts`, `layout/focus.ts` → `agent/agent.ts` | 글 도우미는 `shared/korean.ts`로, `AgentAction`은 이미 계약에 있는 것을 씀 |
| F5 | `layout/focus.ts` → `phone/server.ts`(`FocusTarget`) | 타입을 `contract/phone.ts`로 |
| F6 | `phone/home-plan.ts`·`world/place.ts` → `phone/align.ts`(2) | `align.ts`를 `shared/geometry.ts`로 |
| F7 | `contract/events.ts` → `brain/seg.ts`(`Mask`) | `Mask` 타입은 계약으로, 풀기 함수는 `shared/mask.ts`로 |
| F8 | `model/devices.ts` → `model/homes.ts`·`scene.ts` | `loadTwin()`을 둘로 나눈다. 파일 읽기(합친 장면 scene.json, 그것이 없거나 못 읽으면 floorplan·placement·catalog로 대신하는 길, `source: "scene" \| "catalog"`, `opts.source` 고르기, 경고 글)는 배치 저장소 `layout/twin-files.ts`가 맡아 날 물건 목록(방·문·물건)을 낸다. 가전 만들기(`buildTwin`: DeviceSpec·초기 상태)는 `devices`가 그 목록을 받아 한다. `loadTwin()`은 이름·인자·동작 그대로 `layout` 입구에 둔다(배치 → 가전 방향만). 가전은 배치를 가져오지 않는다 |
| F9 | `model/kinds.ts` → `thinq/appliance.ts`(`ThinqAdapter` 타입) | 타입을 `devices/types.ts`로(표 파일은 표·계약만) |
| F10 | `hub/types.ts` ↔ `model/kinds.ts`(`DeviceKind` 다시 내보내기) | `DeviceSpec`·`Command` 같은 계약 타입은 `contract/devices.ts`로 옮기고, 등록부와 `DeviceKind`는 공용 표 「가전 종류 등록부」 한 입구에서 낸다. 계약 → 등록부는 2.3 타입 전용 의존 |
| F11 | `phone/server.ts` → `plan/labels.ts`, `server/net.ts`·`static.ts` | 서버 글은 공용 표, 도우미는 `shared` |
| F12 | `ui/src/setup/*` → `dashboard/hub.ts`·`mascot-image.ts`, `panels/phone-url.ts`(4) | `ui/src/lib/`로 |
| F13 | `ui/src/dashboard/masks.ts` → `brain/seg.ts`, `ui/src/twin3d/walk.ts` → `plan/route.ts` | `shared/mask.ts`, `layout/browser.ts` |

`world/decide.ts`·`history` → `act/tasks.ts`, `plan/labels.ts` → `agent/phrases.ts`, `infer` → `server/net.ts`는 공용 표·`shared`로 풀린다.

### 2.6 큰 파일 쪼개기

공개 이름·인자·동작은 그대로 둔다. 시험 파일은 import 줄만 바뀐다.

- **`act/track.ts`(1,566줄) → `act/track/`**
  - `tracker.ts`: 겉 클래스 `ExecutionTracker`, 공개 메서드, `tick`, 상태(약 300줄)
  - `start.ts`: 판단 받기·계획 시작(`onDecision`, `tryStart`, `begin`, `closerNewer`, `phoneOk`)
  - `steps.ts`: 단계 진행(`advance`, `activate`, `show`, `runDevice`, `timeout`, `stall`, `finish`)
  - `approval.ts`: 승인 질문(`ask`, `approvedPlan`, `approvedDevice`, `approvedHand`)
  - `safety.ts`: 켠 위험 가전·끄기 안내(`cycleEnded`, `releaseIfOff`, `rearmIfOn`, `handOver`, `nextReminder`, `queueOff`, `askToShow`). 추적 상태(`hot`·`reminder`·`offQueue`·`cycles`·`released`)는 `SafetyTracker`의 `#` 비공개 칸으로 둬 다른 파일이 지울 수 없게 한다(`hot`은 `Run`에서 이 클래스로 옮김)
  - `answers.ts`: 폰 명령·답·말(`openCommand`, `onAnswer`, `onHeard`, `send`)
  - `coach.ts`: 다시 알리기·떠남·조용한 단계·수업 기록(`tell`, `stray`, `askCloser`, `quietStep`)
  - 나누는 방법: 상태와 `emit`·`toPhone`을 든 안쪽 객체(`TrackCore`)를 두고, 부분마다 그 객체를 받는 작은 클래스로 만든다.
  - 구조 검사(`tests/act-track-release.test.ts`)는 `act/track/` 폴더 파일 전체와 `TrackCore`를 본다. 지우는 패턴은 받는 쪽 이름과 상관없이 찾는다(`this.reminder = null`만이 아니라 `.reminder = null`, `.hot.delete(`). 79ff269 과거 실수를 `steps.ts`·`answers.ts`·`tracker.ts`에 하나씩 넣은 자료에서도 실패해야 한다.
- **`server/home.ts`(616줄) → `server/home/`:** 도메인별 잇기(`devices.ts`, `observe.ts`, `act.ts`, `phone.ts`, `say.ts`)와 조립(`index.ts`). 파일 자리 기준 경로(`SHARED_VIDEO_DIR`)는 0단계에서 뿌리 기준으로 바꾼 뒤 옮긴다.
- **`server/app.ts`(721줄) → `server/routes/`:** 경로를 도메인별로 나눈다(`observe.ts`(brain·world 상태), `brain.ts`(기록·반성·기억·판단), `layout.ts`, `phone.ts`, `plan.ts`, `devices.ts`, `agent.ts`). `app.ts`는 HTTP·WS 껍데기만 남는다.
- **다음에(정한 것 3, 이번에 하지 않음):**
  - `world/state.ts`(1,071줄) → `world/state/`: `objects.ts`(감지 합치기), `people.ts`(사람·관절), `facts.ts`(VLM 사실), `closer.ts`(가까이 보기), `devices.ts`(카메라로 본 가전)
  - `agent/planTools.ts`(616줄): 단계 규칙(`needsPhone`·`riskyHand`·`selfStopWait`·`HUMAN_KINDS`)을 `agent/plan-rules.ts`로

## 3. 막는 장치

### 3.1 무엇

- **`scripts/lint-domains.ts`(`npm run lint`에 더함)와 `tests/domain-boundaries.test.ts`(같은 검사, `npm test`·CI)로 막는다.** 지금 `lint-ui-parts`와 같은 짝이다.
- **검사 범위:** `src/**`·`ui/src/**`의 import를 읽어, 파일 → 도메인 표(2.1)와 의존 표(2.3)로 본다. `ui/tests/**`는 node 모듈 길만 본다.
- **실패시키는 것과 오류 글**

| 검사 | 오류 글 |
|---|---|
| 다른 도메인 안쪽 파일을 가져옴 | 「`<파일>`이 `<도메인>` 안쪽 `<대상>`을 가져와요. `<도메인>/index.ts`로 가져오세요」 |
| 의존 표에 없는 방향 | 「`<a>`는 `<b>`를 쓸 수 없어요(쓸 수 있는 것: …). 공용 타입이면 contract로, 공용 도우미면 shared로 옮기세요」 |
| 공용 표 파일이 표·계약·shared 밖을 가져옴 | 오류 |
| `shared`·`infer` 파일이 계약·`shared`·같은 폴더·node 기본 모듈 밖을 가져오거나 다시 내보냄 | 「기반층은 도메인을 몰라야 해요. `<대상>`을 가져오지 마세요」 |
| `contract`가 값 import를 하거나, 계약·공용 표(`import type`만) 밖을 가져옴 | 오류 |
| 화면이 `src`에서 허용 밖을 가져옴 | 오류 |
| 화면이 닿는 `src` 파일(따라 들어간 import 전체)에 node 모듈이 있음 | 「브라우저 입구에 node 모듈 `<모듈>`이 섞여요(`<길>`)」 |
| 화면 시험(`ui/tests`, jsdom)이 바로 가져온 `src` 파일을 거쳐 따라 들어간 `src` 파일에 node 모듈이 있음(바로 가져온 파일은 시험이 고른 것이라 된다, 2.2) | 「화면 시험(jsdom)이 따라 들어간 src 파일에 node 모듈 `<모듈>`이 섞여요(`<길>`). 시험이 바로 가져온 src 파일만 node 모듈을 써도 돼요」 |
| 의존 표에 고리가 생김 | 오류 |
| 실제 파일 그래프에 도메인을 넘는 고리(`shared`·계약·표를 거치는 것 포함, 계약·공용 표 사이 타입 전용 고리만 허용). 공용 표는 파일마다 따로 본다(표끼리 값 import 고리도 실패) | 「`<a>` → … → `<a>` 고리예요」 |
| 글자 그대로가 아닌 `import(식)`·`require(식)`(경로를 변수에 담으면 위 검사가 따라가지 못함). 꼭 필요한 파일은 `DYNAMIC_OK`에 까닭과 함께 적는다(지금은 감지 Worker 입구 `detector-worker.mjs` 하나) | 오류 |
| `import.meta.url`을 허용한 세 꼴 밖에서 씀: `shared/paths.ts` 안, `new Worker(new URL("./…", import.meta.url))`, 직접 실행 검사 `isEntry(import.meta.url)`. 또는 Worker 대상 파일이 없음 | 오류 |
| 도메인에 `index.ts`가 없음 | 오류 |

### 3.2 옮기는 동안(줄어들기만 하는 예외 목록)

- 1단계에서 지금 위반을 모두 `scripts/domain-exceptions.json`에 적는다. 줄 하나는 위반 하나이고 열쇠는 `<검사> <파일> -> <대상>`이다(고리는 고리 안에서 단위를 넘는 import마다 한 줄).
- 아직 옮기지 않은 파일은 `scripts/lint-domains.ts`의 `LEGACY` 표(2.1 「들어갈 지금 코드」)로 도메인을 정한다. shared로 갈 파일(`server/net`·`static`, `agent/phrases`, `plan/copy`, `phone/align`, `brain/seg`)은 2단계에서 옮기기 전까지 지금 폴더의 도메인이다. 옮길 때마다 표를 줄이고 9단계에 비운다.
- `tsx scripts/lint-domains.ts --strict`는 예외 목록 없이 돌고, `--json`은 위반 열쇠를 JSON으로 낸다.
- 목록에 없는 새 위반은 실패한다.
- 목록에 있는데 이제 안 생기는 줄도 실패한다(지운 만큼 목록에서 빼게 함).
- **목록은 줄기만 한다(`chainFailures`).** 새 위반을 목록에 같이 넣거나, 앞 단계에서 없앤 줄을 다시 넣으면 실패한다.
  - 처음 목록: `scripts/lint-domains.ts`의 `EXCEPTIONS_BASE` 커밋(1단계 `55cef6d`)의 목록.
  - 그 커밋 뒤 첫 부모 커밋마다(`git rev-list --first-parent`, merge 커밋 포함)와 지금 트리에서, 목록의 줄은 바로 앞 커밋의 목록에 있어야 한다. 지금 트리의 목록은 처음 목록에도 있어야 한다.
  - 시험(`tests/domain-boundaries.test.ts`)·CI·로컬(`npm run lint`) 모두 같은 방법으로 `git`에서 읽는다. CI는 `actions/checkout`에 `fetch-depth: 0`을 준다. 기준 커밋을 못 읽으면 실패한다. `--base <커밋>`은 손으로 다른 처음 목록을 볼 때만 쓴다.
  - 옮긴 파일: 두 목록 사이에 새로 생긴 대응표(`moves/*.json`, 단계 차례)의 `files`로 앞 줄의 경로를 바꿔 견준다.
  - 입구로 바꾼 import: 앞 줄 `<검사> <파일> -> <대상>`이 지금 목록에서 없어졌을 때만, 같은 검사·같은 파일로 그 대상 도메인의 입구(`…/index.ts`)를 가리키는 줄 하나를 같은 줄로 본다(옛 줄 하나에 새 줄 하나). 옛 줄이 남아 있으면 새 줄이다.
  - 새 줄(feat/coach-cup merge로 들어온 새 위반 등)은 먼저 고친다. 못 고치면 그 커밋에 새로 생긴 대응표의 `exceptions`에 `{ "why": 까닭, "until": 기한 단계 }`로 적는다(단계마다 검토). 까닭이 비었거나, 기한이 그 대응표 단계보다 앞이거나, 지금 가장 늦은 단계가 기한을 지났는데 줄이 남아 있으면 실패한다.
- 단계마다 목록이 줄고, 9단계에서 비어 파일을 지운다.

### 3.3 실패하는지 확인하는 법

- **가짜 트리:** 시험이 임시 폴더에 작은 가짜 트리를 만든다. 안쪽 import, 거꾸로 import, 고리, 표 파일의 도메인 import, `contract`의 밖 import, `world` → `shared/x.ts` → `act/index.ts`(shared를 거쳐 도는 길), 화면 → `layout/browser.ts` → `node:fs`를 쓰는 파일, Worker 대상 없음을 하나씩 넣는다. 그때마다 위 오류 글로 실패해야 한다.
- **실제 과거 실수:** 0a392c5에서 가져온 실제 줄을 고정 자료로 둔다(`tests/fixtures/domains/`). 그 줄이 실패해야 한다.
  - `contract/events.ts` → `brain/seg.ts`: 계약이 밖을 가져옴
  - `layout/editor.ts` → `agent/search.ts`: 배치 → 에이전트, 표에 없는 방향
  - `world/state.ts` → `observe/ring.ts`: World State → 관찰 흐름, 거꾸로
  - `agent/planTools.ts` → `act/lessons.ts`: 에이전트 → 판단·검사·실행, 거꾸로(공용 표 아님)
  - `phone/server.ts` → `server/net.ts`: 실제 폰 → API 서버 런타임
  - `server/home.ts` → `act/track.ts`: 입구가 아닌 안쪽 파일
- **예외 목록 확인:** 1단계에서 엄격 모드(예외 목록 없이)로 지금 트리를 돌린다. 실패 줄 수가 예외 목록 줄 수와 같아야 한다.
- **마지막 확인:** 9단계에서 `src/world/state.ts`에 `import … from "../act/index.js"` 한 줄을 넣는다. `npm run lint`가 실패하는지 본 뒤 되돌린다.

### 3.4 저장소 규칙 표에 넣을 줄

```text
| 서버(`src/`)와 화면(`ui/src/`) 코드는 구현명세서 구성 단위로 나눈 도메인 폴더에 둔다. 다른 도메인은 그 입구(`index.ts`)나 공용 표로만 가져오고, 정한 방향(`scripts/lint-domains.ts` 의존 표)으로만 가져온다. 공용 타입은 `src/contract/`, 공용 도우미는 `src/shared/`, 외부 API 통로는 `src/infer/`(기반층, 도메인을 가져오지 않음)에 둔다. | `npm run lint`(scripts/lint-domains.ts, CI도 돌린다)와 `tests/domain-boundaries.test.ts`가 안쪽 import·거꾸로 import·고리·입구 없음을 잡는다(가짜 트리와 0a392c5 실제 줄로 실패를 확인). |
```

## 4. 옮기는 차례

### 4.1 모든 단계 공통

- **시작:** 구현 에이전트의 지금 일(영상 판정·일주일 반성·시험 안정화)이 끝난 뒤 feat/coach-cup 끝에서 `refactor/domain-split`을 만든다. worktree는 따로 둔다.
- **커밋:** 단계마다 커밋 하나다. 파일은 `git mv`로 옮겨 이름 바뀜이 남게 한다.
- **결과가 같다는 확인(단계마다)**
  1. `npm run typecheck`, `npm --prefix ui run build`(화면 타입 검사·빌드)
  2. `npm run heavy -- npm test`(서버·화면 시험 전체). 0단계에서 잰 통과 수와 같아야 한다.
  3. `npm run lint`(화면 글·색·부품·글 크기 + 도메인 검사)
  4. **옮김 단계: import 경로만 달라짐을 AST로 증명.** `npx tsx scripts/check-moves.ts <앞 커밋> <뒤 커밋>`(1단계에서 만듦)이 통과해야 한다.
     - 파서: TypeScript 7.0.2에는 JS 컴파일러 API가 없다. 그래서 `rolldown/parseAst`(oxc 파서, vite·vitest가 이미 깐 것)를 쓰고 `rolldown`을 개발 의존성에 직접 적는다.
     - 이동 대응표: git의 이름 바뀜 찾기를 쓰지 않는다(import 경로를 고친 파일은 100% 같지 않아 지움·더함으로 잡힌다). 단계마다 대응표 파일을 그 커밋에 함께 둔다: `docs/superpowers/specs/2026-11-16-domain-split/moves/<단계>.json`.
       ```json
       { "files": { "src/sync/aligner.ts": "src/phone/sync/aligner.ts" },
         "decls": { "src/world/decide.ts#DecisionRecord": "src/contract/events.ts#DecisionRecord" },
         "new": ["src/phone/index.ts"],
         "text": ["tests/act-track-release.test.ts"],
         "allow": { "<실패 첫 줄>": "<까닭>" },
         "exceptions": { "<도메인 검사 열쇠>": { "why": "<까닭>", "until": "<단계>" } } }
       ```
       `files`는 파일째 옮김, `decls`는 파일 일부(선언 하나)를 옮김(옛 파일#이름 → 새 파일#이름, F 단계), `new`는 새로 만든 파일이다. 지운 파일·새 파일이 대응표에 없으면 실패한다. `text`는 경로를 조각으로 적은 시험·스크립트(`join(ROOT, "src", "act", "track.ts")`)다. AST 모양(인자 수 포함)이 같아야 하고, 이어진 글자열 조각은 그대로 같거나 앞에서부터 붙인 경로가 조각마다 옮긴 경로(파일, 파일을 모두 같은 꼴로 옮긴 폴더)로만 바뀌어야 한다(`"sync"` → `"phone/sync"`는 되고, 조각을 나누거나 합치거나 빈 조각·`/`로 시작하거나 끝나는 조각·`//`는 실패). 그 밖의 글자열 변화(상태 글·기대값·글자열 맞바꿈·템플릿)도 실패한다. 바뀐 글자열은 출력해 따로 확인한다.
     - **검사는 엄격하게 둔다.** 엄격한 규칙이 그 단계의 정상 이동을 막으면(조각 수가 바뀌는 경로 글, 입구로 바꾸며 생기는 고리 안 import, 4단계 import 정리로 바뀌는 부수 효과 import 차례 등) 그 단계 대응표 `allow`에 실패 첫 줄 그대로와 까닭을 적어 허용한다. `allow`는 단계마다 Codex가 본다. `allow` 한 줄은 실패 첫 줄 하나에 꼭 하나만 맞아야 한다. 까닭이 비었거나, 적었는데 생기지 않았거나, 실패 여러 개에 맞는 `allow`는 실패한다.
     - 대응표를 주지 않으면 두 커밋 사이에 새로 생기거나 바뀐 대응표 하나를 쓴다(`--moves <경로>`로 줄 수 있다). 1단계 대응표 `1.json`은 비어 있다(도구를 만드는 단계라 견주지 않는다).
     - 견주는 곳: `src/`·`ui/src/`·`tests/`·`ui/tests/`·`scripts/`·`ui/scripts/`의 코드 파일. 검사 도구(`scripts/lint-domains.ts`·`check-moves.ts`·`domain-ast.ts`)는 단계마다 표가 바뀌어 견주지 않는다. `--only <경로 앞부분>`으로 좁힌다(7단계는 `tests/`).
     - 파일마다 옛 파일과 새 파일을 파싱해 셋을 본다.
       (1) import·`export … from`이 아닌 문장을 정규화한 AST로 견준다. 옛 문장과 새 문장을 최장 공통 차례로 맞춘 뒤 맞지 않은 자리(바뀐 문장 `N번째`, 더한 문장 `N번째`, 지운 문장 `앞 N번째`)마다 따로 실패한다. 첫 불일치에서 멈추지 않는다(`import …; 실행문()`처럼 붙인 동작도 여기서 잡힌다). 옮긴 파일의 경로 글(`"src/sync/aligner.ts"`, 확장자 없음·`.js` 포함)과 상대 모듈 글(`vi.mock("../src/…")`·`import("…")`·`new URL("./…", import.meta.url)`)은 대응표로 바꾼 뒤 견준다.
       (2) import마다 (가져온 이름, `type` 여부, 그 이름을 정의한 자리 `파일#이름`)을 구해 견준다. 정의한 자리는 모듈 경로를 풀고 `index.ts`의 `export … from`을 따라가 찾는다. 옛 쪽 자리는 `decls`를 먼저, 그다음 `files`로 새 자리로 바꾼다. 모음이 다르면 실패한다. 그래서 시험이 `DecisionRecord`를 옛 파일 대신 계약에서 가져오게 바뀐 것은 통과한다.
       (3) `new`의 파일은 `export … from` 문장만 있어야 한다(입구). 그 밖의 새 파일(`shared/paths.ts` 등)은 옮김 단계가 아닌 0·2단계에서만 생긴다.
       (4) 실제로 평가되는 부수 효과 모듈의 차례가 같아야 한다. 파일마다 ESM이 평가하는 차례를 처음부터 계산한다: 그 파일 자신의 줄부터 정적 `import`(이름 있음·없음)와 `export … from`을 소스 차례대로 따라가는 깊이 우선 뒤차례이고, 한 번 읽은 모듈은 건너뛴다. 타입 전용 import·re-export와, TS 파일에서 값으로 쓰지 않아 실행 때 지워지는 import는 뺀다(JS 파일의 import는 쓰지 않아도 남는다). 바깥 패키지(`node:*`·npm)는 속을 따라가지 않고, 이름 없는 import든 값으로 쓰는 import든 그 자리에 부수 효과가 있을 수 있는 점 하나(`pkg:<모듈 글>`)로 둔다. 그 차례에서 모듈을 읽을 때 무엇이든 실행하는 모듈(이름 없는 맨 위 실행문, 또는 맨 위 식의 함수 호출·`new`·`await`·태그 템플릿·대입: `const X = register()`, `static x = boot()` 등)과 바깥 패키지 점만 뽑은 열이 옮기기 앞뒤에 같아야 한다(옛 쪽은 대응표로 옮긴 경로). 그래서 `import "dotenv/config"`와 내부 초기화 import를 맞바꾸면 실패한다. 그래서 입구가 다른 초기화를 더 읽거나, 다시 내보낸 모듈이 `import "./register.js"`로 더하는 초기화가 생기거나, 입구의 re-export 줄을 맞바꿔 평가 차례가 바뀌면 실패한다.
       (5) 실행 때 남는 값 import 그래프(입구 포함)의 고리 안에 앞에 없던 import가 생기면 하나마다 실패한다(`--moved`가 아니어도). 새 자기 import(`import { x as bx } from "./a.js"`를 a.ts에서)도 실패한다. 전부터 있던 고리 안에 입구가 끼는 것도 실패이고, 필요하면 `allow`에 적는다.
     - 내용이 그대로인 파일도 (1)(2)를 본다: 옮긴 파일 때문에 import·상대 모듈 글(`vi.mock`·`import()`)이 뒤 커밋에서 풀리지 않거나 다른 정의를 가리키면 실패한다. 그 파일의 글자열은 바꾸지 않고 견준다(자료로 적은 옛 경로는 그대로 둠). 읽기 차례((4))는 바뀐 파일에서만 본다(안 바뀐 파일의 차례 변화는 그 아래 바뀐 파일에서 이미 잡힘).
     - 경로를 글로 적은 시험·문서 줄은 따로 확인한다.
  5. **고리 끊기(F) 단계:** `check-moves.ts --moved`가 대응표(`decls`)로 옮긴 선언마다 넷을 본다. 시험 파일은 (1)(2) 검사를 통과해야 한다(기대값을 하나도 고치지 않는다).
     - **글:** 옛 선언과 새 선언의 정규화한 AST가 같다.
     - **빠짐·더함:** 바뀐 파일 전체의 맨 위 선언(import 빼고) 모음이 옮기기 앞과 뒤에 같다. 대응표에 없는 선언이 생기거나 사라지면 실패한다.
     - **import 차이:** (2)에서 옮긴 선언 때문에 생기는 차이만 된다. 뒤에 더한 import는 옮겨 나간 선언(이제 가져와 씀)이나 옮겨 온 선언이 쓰는 이름이고, 앞에만 있던 import는 옮겨 나간 선언만 쓰던 이름(남은 문장이 쓰지 않음)이나 옮겨 온 선언이다. 옮긴 선언과 import만 있는 새 파일(`contract/observe.ts` 등)과, 선언을 모두 `decls`로 옮긴 지운 파일은 대응표에 있는 것으로 본다. 지운 파일의 이름 없는 맨 위 실행문(`init();` 등)은 하나하나 그 파일의 선언을 받은 파일에 같은 AST로 있어야 하고, 초기화 차례도 옛 차례를 따른다. 지운 파일의 부수 효과 import(`import "./init.js"` 등, (4)와 같은 기준)도 받은 파일에 같은 차례로 있어야 한다.
     - **초기화 차례:** 모듈마다 맨 위 실행 문장(타입·인터페이스·`declare`·import를 뺀 것: 변수·함수·클래스 선언, 식 문장, `export default`)을 차례대로 적는다.
       - 새 파일의 각 문장을 옛 자리(옛 파일, 옛 차례 번호)로 바꾼 뒤, 같은 옛 파일에서 온 문장끼리는 번호가 커지는 차례여야 한다.
       - 옮긴 문장이 모듈을 읽을 때 쓰는 이름(함수 몸통 밖 초기화 식에서 쓰는 이름)은 넷 가운데 하나여야 한다.
         - 같은 파일 앞쪽 선언
         - 같은 파일의 `function` 선언(뒤쪽이어도 끌어올려진다)
         - import
         - 옮기기 전과 후에 똑같이 전역을 가리키는 이름(예: `KIND_ORDER = Object.keys(KINDS)`의 `Object`)
       - 같은 파일 뒤쪽의 `const`·`let`·`class`(초기화 전에 읽으면 오류)는 실패한다.
       - 옮긴 파일끼리 실행 때 남는 값 의존 그래프에 고리가 새로 생기면 실패한다(읽는 차례가 바뀌어 아직 정해지지 않은 값을 읽을 수 있음).
         - 값 의존 그래프에서는 `import type`과, 가져온 이름을 타입 자리에서만 쓰는 import를 뺀다.
         - 타입 전용 고리는 2.3 「타입 전용 의존」 규칙을 그대로 쓴다. 기반층(계약·공용 표) 안에서만 허용하고, 그 밖은 3.1 파일 그래프 고리 검사가 잡는다.
     - **이름이 가리키는 정의:** 옮긴 선언 안의 자유 이름(그 선언 안에서 묶이지 않은 이름)마다 옛 자리와 새 자리에서 가리키는 정의를 구한다. 정의는 `파일#이름`, import면 정의한 자리까지 따라감, 없으면 「전역」이다. 옛 쪽을 대응표로 바꾼 값이 새 쪽과 같아야 한다. 바뀐 파일의 옮기지 않은 문장도 같은 검사를 한다(옮겨 온 선언용 import가 남아 있던 문장의 전역 `fetch`를 가리는 것 등).
       - 묶임은 스크립트 안의 작은 범위 계산으로 센다. ESTree를 걸으며 함수 인자, `let`·`const`·`var`·`class`·`function`, `catch` 인자, 구조 분해를 범위마다 모은다.
       - 스크립트 시험으로 잡는 경우: 같은 이름이 새 파일에서 다른 선언을 가리키는 것, 지역 이름이 옮긴 뒤 모듈 이름을 가림, 전역(`Math`)이 새 파일의 같은 이름 선언에 잡힘.
  6. **쪼개기 단계:** 코드 모양이 바뀌어 AST로 같음을 증명하지 못한다. 시험 파일이 (1)(2) 검사를 통과하고(import 줄만 바뀜), 아래 흐름 시험이 통과하는 것으로 본다.
- **경로를 글로 적은 곳(단계마다 함께 고침)**
  - 시험·스크립트 15개(`tests/act-track-release.test.ts`, `kinds-registry`, `world-vocab`, `mcp`, `scripts/lint-ui-type.ts` 등)
  - 파일 자리 기준 자원 경로와 Worker 대상(0단계 목록)
  - `ui/tsconfig.json` include, `vitest.config.ts`
  - 저장소 `CLAUDE.md` 규칙 표의 경로
  - `docs/reference.md`

### 4.2 단계

| 단계 | 할 일 | 남는 예외 | 대략 시간 |
|---|---|---|---|
| 0 | 새 브랜치·worktree, 기준 시험 통과 수·시간 재기. 파일 자리 기준 자원 경로를 뿌리 기준으로 바꾼다: `src/shared/paths.ts`의 `repoPath()` 하나만 `import.meta.url`을 쓰고, `MODELS_DIR`(`brain/detector.ts:101`)·`DEFAULT_TWIN_DIR`(`model/devices.ts:63`)·`DEFAULT_UI_DIR`(`phone/server.ts:37`)·`DEFAULT_WEB_DIR`(`server/app.ts:113`)·`SHARED_VIDEO_DIR`(`server/home.ts:83`)·`DEFAULT_RUNTIME_DIR`(`server/start.ts:43`)를 그것으로 바꾼다. Worker 줄(`brain/detector.ts:511·512` → `detector-worker.mjs`·`detector-thread.ts`, `ui/src/panels/eye-video.ts:252` → `eye-video-worker.ts`, `ui/src/phone/core/capture.js:107` → `encoder-worker.js`)은 대상 파일과 늘 같이 옮긴다. `src/mcp/server.ts:53`의 직접 실행 검사(`fileURLToPath(import.meta.url)`을 `process.argv[1]`과 견줌)는 `shared/paths.ts`의 `isEntry(metaUrl)`로 옮기고, 그 자리는 `isEntry(import.meta.url)` 한 꼴만 남긴다(3.1 허용 꼴). 확인: 서버 시험의 기본 폴더 시험(「기본 화면 폴더는 ui/dist」)이 그대로 통과 | — | 1.5시간 |
| 1 | 막는 장치(2.1·2.3 표, 예외 목록 방식) + 가짜 트리·과거 실수 시험. 엄격 모드 실패 수 = 목록 수 확인. `scripts/check-moves.ts`와 그 시험(import 뒤 실행문 덧붙임·이름 바꿈·다른 파일로 가져옴·대응표에 없는 지움·초기화 차례 바뀜·이름이 다른 정의를 가리킴을 잡는지). 단계마다 대응표 파일 `moves/<단계>.json`을 함께 커밋 | 전부 | 3시간 |
| 2 | 기반 만들기: `src/shared/`(net·static·korean·copy·geometry·mask), 계약에 공용 타입 옮김(F1·F3·F5·F7·F9) | 줄어듦 | 2시간 |
| 3 | 폴더 옮기기(파일 이동만, 도메인마다 커밋 하나): 3a `sync` → `phone/sync`, 3b `brain`의 감지기 파일(`detector.ts`·`detector-thread.ts`·`detector-worker.mjs`, Worker 줄과 같이) → `observe`, 그다음 같은 커밋에서 `world/decide.ts` → `brain`, `history/*` → `brain/history/`(이 뒤로 `src/brain/`은 판단·반성 자리), 3c `hub`·`matter`·`thinq`·`model` 가전 쪽 → `devices`, 3d `model` 배치 쪽·`plan/floor·route·names`·`phone/home-plan` → `layout`, 3e `plan/planner`·`mcp` → `agent`, `plan` 나머지 → `act`, 3f `setup` → `server` | 줄어듦 | 4시간 |
| 4 | 도메인마다 `index.ts`를 만들고 다른 도메인 import를 입구로 바꿈 | 거꾸로 가는 것만 남음 | 2시간 |
| 5 | 남은 고리 끊기(F2·F4·F6·F8·F10·F11) | 화면 쪽만 남음 | 2시간 |
| 6 | 화면: `twin3d`+`twin` → `ui/src/twin`, `bubbles`·`panels`·`checks` → `dashboard`, F12·F13, 화면 입구 | 0에 가까움 | 1.5시간 |
| 7 | 큰 파일 쪼개기: 7a `track.ts`(구조 검사를 `act/track/` 폴더 전체로, 79ff269 과거 실수를 각 파일에 넣은 자료가 실패하는지 확인), 7b `home.ts`·`app.ts`. `world/state.ts`·`planTools.ts`는 다음에(정한 것 3) | 0 | 3.5~4시간 |
| 8 | 흐름 확인: `tests/demo-e2e.test.ts`(네 장면 가짜 서버 흐름: 컵, 에어컨, 전자레인지 승인·꺼짐 확인, 라면)와 `coach-e2e`·`noonchi-e2e`를 따로 한 번 더 돌린다(단계마다 전체 시험에도 들어 있다). `video-check --fake`는 컵 감지·컵 PAM 판단·`CUP_SCRIPTS`로 고정이라(`scripts/video-check.ts:384`) 쓰지 않는다. `docs/reference.md` 「구조」, 저장소 `CLAUDE.md` 경로, 규칙 표 줄(3.4) | 0 | 1.5시간 |
| 9 | 예외 목록 파일 지움, 엄격 모드, 3.3 마지막 확인. 구현명세서 SSOT 18.1 폴더 구조와 본문 경로(`src/world/vocab.ts` 등)를 docs 저장소에서 고침 | 없음 | 1시간 |

합계 약 22시간(에이전트 시간, 시험 시간 포함)이다. `infer`는 옮기지 않는다.

### 4.3 위험

| 위험 | 막는 법 |
|---|---|
| feat/coach-cup이 계속 바뀌어 옮긴 파일과 충돌 | 큰 이동(3단계)은 feat/coach-cup이 조용할 때 몰아서 한다. `git mv`로 이름 바뀜을 남긴다. 단계마다 feat/coach-cup을 받아 들인다 |
| 경로를 글로 적은 구조 검사가 엉뚱한 파일을 봄(통과하는데 아무것도 안 봄) | 그 검사의 과거 실수 자료가 여전히 실패하는지 단계마다 본다(`act-track-release`, `kinds-registry`) |
| 화면이 `src`를 상대 경로로 가져와 ui 빌드·Docker ui 단계가 깨짐 | `npm --prefix ui run build`, `tests/docker-ui-stage.test.ts`를 단계마다 돌림 |
| 파일 자리 기준 경로가 옮긴 뒤 다른 곳을 읽음(예: `home.ts`의 `../../runtime/videos/`를 `server/home/`으로 옮기면 `src/runtime/videos/`를 읽음) | 0단계에서 뿌리 기준 `repoPath()`로 바꾸고, `import.meta.url` 검사(3.1)로 새로 생기지 않게 함 |
| `track.ts` 쪼개기에서 동작이 바뀜 | 시험 기대값을 안 고침. 끄기 안내·승인·말 시험(`act-track*`, `coach-e2e`, `noonchi-e2e`, `demo-e2e`)으로 봄 |
| 문서(SSOT·reference·CLAUDE.md)의 경로가 낡음 | 8·9단계에 경로 찾기(`src/<옛 폴더>/`)로 하나도 안 남게 함 |

## 5. 정한 것 (사용자, 2026-11-16)

1. **폴더 이름:** 짧은 영어 폴더. 문서 이름은 각 입구 첫 줄과 2.1 표에 둔다. 도메인 수를 더 줄여 서버 9개로 한다.
   - `brain`은 PAM 서비스 연결과 기록·반성을 합친다. 입구 첫 줄은 「PAM 서비스 연결·기록·반성(구현명세서 6.12·6.13)」이다.
   - 외부 API 게이트웨이 `infer`는 도메인이 아니라 기반층이다. 자리는 `src/infer/` 그대로다(2.1 기반층 표의 까닭).
2. **공용 표:** 지금 도메인에 두고 「표 입구」로 모든 도메인이 읽는다. 계약은 공용 표 타입만 `import type`으로 가져오고, 계약 ↔ 공용 표 타입 전용 고리만 허용한다(2.3).
3. **큰 파일 쪼개기:** `track.ts`·`home.ts`·`app.ts`(7a·7b). `world/state.ts`·`planTools.ts`는 다음에 한다.

## 6. 지적 기록

- Codex 설계 리뷰 지적 9개(2026-11-16): 계약 ↔ 등록부 `DeviceKind` 타입 전용 의존 규칙(물을 것 2에 따라), 화면용 `layout/browser.ts`와 node 모듈 섞임 검사, `loadTwin` 파일 읽기·catalog 대신 길은 배치 저장소·가전 만들기는 가전으로, `shared`의 도메인 import·다시 내보내기 금지와 실제 파일 그래프 고리 검사, 실패 예제를 새 규칙 위반 줄로 바꿈, 끄기 추적 구조 검사를 `act/track/` 전체·각 파일 과거 실수로, 파일 자리 기준 자원 경로를 0단계에서 뿌리 기준으로, 「import 경로만」을 `scripts/check-moves.ts` AST 비교로, 흐름 확인을 `tests/demo-e2e.test.ts`로.
- Codex 설계 재리뷰 지적 4개(2026-11-16): git 이름 바뀜 대신 단계마다 이동 대응표 파일(`moves/<단계>.json`), 대응표를 선언 단위(`파일#이름`)까지, `--moved`에 초기화 차례와 이름이 가리키는 정의 검사와 세는 법, MCP 직접 실행 검사는 `shared/paths.ts` `isEntry()`로 옮기고 `isEntry(import.meta.url)`를 허용 꼴로.
- Codex 설계 재리뷰 지적 2개(2026-11-16): `--moved` 초기화 차례에서 옮기기 앞뒤 같은 전역과 끌어올려지는 `function` 선언은 허용, 옮긴 파일끼리 고리 검사는 실행 때 남는 값 의존 그래프로만(타입 전용 고리는 2.3 규칙).
- 사용자 결정(2026-11-16): 짧은 영어 이름, 서버 도메인 9개(brain=PAM+반성, infer는 기반), 표는 도메인에, 큰 파일 3개.
