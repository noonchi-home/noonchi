# 눈치코치 코치 모드 (라면 끓이기 가이드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코치 모드에서 사람이 「라면 끓이는 법 알려 줘」라고 말하면 클로이드가 실제 폰으로 단계마다 할 일을 알려 주고, 단계가 됐는지 비전·폰 위치·「완료」로 확인하고, 다른 행동을 하면 한 줄로 바로잡고, 혼잣말(「뭐 해야 되지?」)에 답하고, 같은 일을 다시 할 때 잘한 단계는 말을 줄인다.

**Architecture:** 지금 구조를 그대로 쓴다. 들은 말이 World State 관찰 텍스트에 한 줄로 들어가고, PAM이 같은 FSM 기억으로 코치 행동(「라면 끓이기 알려 주기」)을 고른다. 단계 목록은 에이전트 계획 모드가 만든다. 실행 추적이 단계마다 지시·확인·넘기기를 하고, 관찰 모드에 계기 둘(다른 행동을 봄, 계획과 상관있는 말을 들음)과 도구 둘(`tell_person`, `pass_on`)을 더한다. 눈치/코치는 「돕는 방식」으로 `setup.json`에 따로 두고, PAM에 보내는 행동 목록을 그 방식으로 거른다.

**Tech Stack:** Node 22 TypeScript 서버, zod, Vitest, React(`ui/`), 가짜 OpenAI 호환 서버, 시험용 PAM 자리, 크롬 내장 음성 인식(실제 폰 늘 듣기), 영상 판정(`scripts/video-check.ts`).

**Spec:** 2026-11-12 회의록 「정한 것」 1·3번(코치 모드는 라면 끓이기 전 과정 가이드, 가르쳐서 돕는 일이 줄어드는 것이 목표), 2026-11-09 회의록 「가이드 모드」(단계마다 지시, 크게 틀어질 때만 바로잡음), 김준형(「혼잣말을 캐치하고 도와줄 수 있게」), 허정오(「냄비를 꺼내 볼까요? 해서 냄비 꺼내면 그다음 단계 알려 주고… 지금 그거 하면 안 돼요, 이거 해야 돼요」, 「기존 FSM 그대로 쓸 생각」). 구현 뒤 `docs` 저장소 `01_Product/구현명세서 SSOT.md`에 코치 모드 절을 더한다.

**먼저 할 것:** 같은 브랜치의 `2026-11-13-cup-branches.md` Task 1~7(행동 목록 틀, 사람 단계 `do`, seed 판본 올리기). 이 계획은 그 위에 얹는다.

## 조사한 사실 (2026-11-13, `feat/dash-wide` d83283b)

- 실제 폰은 늘 듣는다(`ui/src/phone/core/talk.js`, 크롬 음성 인식 ko-KR, 끝난 말만). 폰이 명령을 읽는 동안은 듣기를 멈춘다. 들은 말은 `say` 메시지로 폰 서버에 온다(`src/phone/server.ts` `talk`).
- 들은 말의 길은 둘이다: 지금 명령의 답이면 실행 추적(`ExecutionTracker.onHeard`: 「완료」·「다 했어」·「그만」·질문 답), 아니면 말 요청 에이전트(`agent.chat(…, { heard: true })`, LLM을 부른다). 관찰 텍스트(PAM 입력)에는 말이 들어가지 않는다.
- 운영 모드(`setup.json` `mode`: `test`·`live`)는 실제 가전을 부르는지만 정한다(`src/contract/setup.ts` `ControlMode`, 설정 3단계 `ui/src/setup/ModeStep.tsx`). 눈치/코치와 서로 상관없는 값이다.
- 계획은 8단계까지다(`PLAN_LIMITS.maxSteps`). 라면 끓이기는 11단계쯤이다.
- 관찰 모드(`src/agent/observer.ts`)는 멈춘 집기·놓기 단계(A)와 판단 전 보기(B)에만 불리고 도구는 `look_closer`·`ask_person`·`wait`다. 사람 부탁은 지금 단계 명령 글을 바꿔 다시 읽는다(`ExecutionTracker.askCloser`).
- 위험 목록은 현관 잠금 해제·인덕션 켜기·전자레인지 시작이다(`src/agent/policy.ts` `CONFIRM_RULES`). 에이전트가 가전을 조작하는 단계(`device`)에만 걸린다. 사람이 손으로 켜는 단계에는 규칙이 없다.
- 한양목련 트윈 주방: 인덕션(`induction_counter_5641ccf0`, 가전 종류 `cooktop`), 냉장고(`fridge_bbc363a3`), 싱크대(`sink_counter_kitchen`, 싱크볼 있음, 가전 종류 `valve`), 조리대(`counter_kitchen_w`·`counter_kitchen_e`), 주방 수납장(`kitchen_cabinet`), 식탁(`dining_table_978b20c7`).
- 김준형 집 인덕션(ThinQ 「1구 전기레인지」)은 상태 확인·조작이 안 된다(회의록). 카메라로 인덕션 켜짐을 맞추는 규칙도 없다(`src/world/vocab.ts` `SIGHT`에 인덕션 없음).
- YOLO(COCO 80종)에 냄비·라면·인덕션이 없다.

## 라면 단계와 확인 방법

| 단계 | 사람에게 하는 말 | 지금 비전·폰으로 확인 | 넘기는 방법 |
|---|---|---|---|
| 수납장으로 가기 | 수납장으로 가 주세요 | 됨: 폰 위치(`phone_near`, 1.2m) | 자동 |
| 냄비 꺼내기 | 냄비를 꺼내 주세요 | 반쯤: 「무언가 들고 있음」(`person_holding`)까지. 냄비인지는 못 봄 | 자동(든 것 종류는 모름) 또는 「완료」 |
| 싱크대로 가기 | 싱크대로 가 주세요 | 됨: 폰 위치 | 자동 |
| 물 받기 | 냄비에 물을 받아 주세요 | 반쯤: 싱크대 물 흐름(VLM `water_running`). 물 양은 못 봄 | 물이 흐른 뒤 「완료」·「다 했어」 |
| 인덕션으로 가기 | 인덕션으로 가 주세요 | 됨: 폰 위치 | 자동 |
| 냄비 올리기 | 냄비를 인덕션에 올려 주세요 | 안 됨 | 「완료」·「다 했어」 |
| 불 켜기 | 인덕션을 켜 주세요 | 안 됨(가전 신호·카메라 규칙 없음). 트윈 가상 가전을 손으로 켜면 됨 | 켜기 전 폰으로 한 번 묻고, 「완료」 |
| 물 끓기 기다리기 | (말 없음, 알림 한 줄) | 안 됨 | 시간(`elapsed_s`) |
| 면·스프 넣기 | 면과 스프를 넣어 주세요 | 안 됨(「요리하는 중」은 VLM이 보지만 넣었는지는 모름) | 「완료」·「다 했어」 |
| 익기 기다리기 | (말 없음) | 안 됨 | 시간 |
| 불 끄기 | 인덕션을 꺼 주세요 | 안 됨(위와 같음) | 「완료」·「다 했어」 |

자동으로 넘어가는 것은 이동 4단계와 냄비 꺼내기(무언가 듦)다. 나머지는 사람의 「완료」·말이나 시간으로 넘긴다.

## 최소(이 계획)와 그 뒤

- **최소:** 돕는 방식 고르기, 말로 시작, 단계 지시·확인·넘기기, 다른 행동 한 줄 바로잡기(다른 자리로 감·인덕션을 먼저 켬), 혼잣말 돕기(진행 중일 때), 불 안전 규칙, 잘한 단계 말 줄이기, 흐름 시험, 영상·실제 폰 시연.
- **그 뒤:** 초기 FSM과 견줘 「안 하는 것·부족한 것」을 PAM이 스스로 찾기, 냄비·라면을 보는 감지(열린 낱말 감지기), 인덕션 켜짐을 카메라로 보기, ThinQ 사용설명서로 가전 쓰는 법 알려 주기, 좋아함·거절 반응을 반성에 넣기, 노인 대상.

## Global Constraints

- 브랜치 `feat/coach-cup`(worktree `C:\Users\ABC\Desktop\소웨공\twin-home-coach`). 다른 worktree는 건드리지 않는다.
- 저장소 `CLAUDE.md` 규칙 표 전부. 특히:
  - 단계 목록은 에이전트 계획 모드가 만든다. 라면 단계를 코드에 적지 않는다(`cupPlan`·`askPlan`·`planFor` 같은 이름과 그런 코드 금지). 코드는 행동 설명·쓸 수 있는 단계·검사만 둔다. 라면 단계 글은 `tests/helpers/`의 가짜 모델 대본에만 있다.
  - mock과 live는 같은 구조. PAM에 사진을 넘기지 않는다(들은 말은 글이다).
  - 사람에게 하는 말은 「주세요」로 끝난다. 클로이드가 스스로 하는 말로 쓰지 않는다. 화면 글은 상태만(60자 아래, 화살표·괄호 없음).
  - 대시보드에 입력창을 두지 않는다. 승인은 대시보드에 보이지 않는다. 화면 부품은 21st.dev 부품, 색은 토큰.
  - 위험 목록은 늘 묻고 기억하지 않는다.
- 코치 모드는 가전을 대신 조작하지 않는다(코치 행동의 쓸 수 있는 단계에 `device`가 없다).
- 시험·빌드·크롬은 `npm run heavy -- <cmd>`로만, 한 번에 하나. 크롬·dev3d는 PC에 하나.
- 이 PC 메모리는 13.8GB다. 녹화할 때는 `BRAIN_YOLO_PROVIDER=cpu`.
- 실제 모델 비용: 컵 판정 한 번이 약 $0.03~0.05다. 라면 한 판은 영상이 5분쯤이라 약 $0.08~0.12로 잡는다(VLM 2초에 한 번 약 150장, 계획 1번, 관찰 모드 5번 안쪽. 진행 중에는 PAM을 부르지 않는다). 이 계획 한도 $1.00(8판). 첫 판 뒤 실제 값을 적고 한도를 다시 본다.
- 커밋 메시지는 영어, attribution 줄 없음. `.gitignore`·`.ignore`·`ui/public/fonts/OFL-noto-sans-kr.txt`·`.trail/`은 커밋하지 않는다. 푸시는 사용자가 말할 때만.
- 영상은 `runtime/videos/`에 두고 커밋하지 않는다. `runtime/homes/<집>/lessons.json`도 커밋하지 않는다.

## File Structure

| 파일 | 일 |
|---|---|
| `src/contract/setup.ts`, `src/setup/store.ts`, `src/server/start.ts`, `src/server/shell.ts` | 돕는 방식(`assist`) 저장·API |
| `ui/src/setup/ModeStep.tsx` | 설정 3단계에 눈치 모드·코치 모드 고르기 |
| `src/act/tasks.ts`, `services/pam/scenarios/noonchi/tasks.json` | 코치 행동, 방식마다 행동 목록 |
| `src/world/state.ts`, `src/contract/world.ts`, `src/world/labels.ts` | 들은 말을 변화 줄로 |
| `src/agent/tools.ts`, `src/agent/agent.ts`, `src/agent/prompts.ts` | 말 요청 에이전트가 요청 아닌 말에 답하지 않기(`leave_it`) |
| `src/brain/decision.ts` | FSM 기억에 요리 상태 |
| `src/agent/planTools.ts`, `src/agent/planInput.ts` | 14단계, 손으로 켜고 끄는 가전(`hand_device`)·안전 문구(`caution`), 코치 지시문, 지난 수업 |
| `src/act/track.ts`, `src/plan/labels.ts` | 켜기 전 묻기, 끄기 안내, 다른 행동·들은 말 알림, 조용한 단계 |
| `src/agent/observer.ts`, `src/act/look.ts`, `src/contract/events.ts` | 계기 `off_track`·`heard`, 도구 `tell_person`·`pass_on` |
| `src/act/lessons.ts`(새로) | 잘한 단계 기록 |
| `src/act/say.ts`, `src/server/home.ts`, `src/world/decide.ts` | 말풍선 카드 글, 연결, 진행 중 PAM 쉬기 |
| `tests/helpers/planner.ts`, `tests/helpers/observer.ts`, `tests/coach-e2e.test.ts`(새로) | 가짜 모델 대본, 흐름 시험 |
| `scripts/video-check.ts` | 정한 시각에 말 넣기(`--say`) |

---

### Task 1: 돕는 방식 저장과 API

**Files:**
- Modify: `src/contract/setup.ts`, `src/setup/store.ts`, `src/server/start.ts`(`setAssist`, `assist` getter), `src/server/shell.ts`(`POST /api/setup/assist`)
- Test: `tests/setup-store.test.ts`, `tests/setup-server.test.ts`

**Interfaces:**
- Produces:

```ts
/** 돕는 방식. noonchi: 눈치 모드(먼저 알아채 돕는다, 기본). coach: 코치 모드(사람이 하는 일을 단계마다 알려 준다). 운영 모드(test·live)와 따로다. */
export type AssistMode = "noonchi" | "coach";
export interface SetupView { /* … */ assist: AssistMode }
// SetupStore
assist(): AssistMode;            // setup.json assist, 없거나 틀리면 "noonchi"
setAssist(a: AssistMode): void;  // setup.json에 { …, assist } 저장
// POST /api/setup/assist { assist: "noonchi" | "coach" } → SetupView. 다른 값이면 400.
// ServerContext: assist?: () => AssistMode (home.ts가 읽는다)
```

- [ ] **Step 1: 실패하는 시험.** 「`assist`가 없는 옛 `setup.json`은 noonchi로 읽는다」, 「`setAssist("coach")` 뒤 파일에 `assist: "coach"`가 있고 `mode`는 그대로다」, 「`POST /api/setup/assist`가 값을 바꾸고 `GET /api/setup`에 보인다. 틀린 값은 400」, 「운영 모드를 바꿔도 돕는 방식은 그대로다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/setup-store.test.ts tests/setup-server.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현. 돕는 방식은 집을 다시 띄우지 않고 바로 바뀐다(판단 호출이 그때그때 읽는다).
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(setup): store the assist mode (noonchi or coach) next to the control mode`.

### Task 2: 설정 3단계에서 고르기

**Files:**
- Modify: `ui/src/setup/ModeStep.tsx`, `ui/src/setup/setup-api.ts`
- Test: `ui/tests/mode-step.test.tsx`

**Interfaces:**
- 운영 모드 고르기 아래에 같은 부품(`RadioGroup`·`RadioCard`)으로 한 묶음을 더한다. 글: 제목 `돕는 방식`, `눈치 모드` · `먼저 알아채 도와요`, `코치 모드` · `하는 법을 단계마다 알려 줘요`. 고르면 바로 `POST /api/setup/assist`. 확인 창은 없다.

- [ ] **Step 1: 실패하는 시험.** 「돕는 방식 두 칸이 보이고 지금 값이 골라져 있다」, 「코치 모드를 고르면 `/api/setup/assist`에 `coach`를 보낸다」, 「저장에 실패하면 알림 글 `돕는 방식을 저장하지 못했어요.`」.
- [ ] **Step 2:** `npm run heavy -- npm test --prefix ui -- mode-step` → 실패 확인.
- [ ] **Step 3:** 구현(새 부품 없음, 배치만).
- [ ] **Step 4:** 통과 확인, `npm run lint`.
- [ ] **Step 5:** 커밋 `feat(setup): pick noonchi or coach mode in the mode step`.

### Task 3: 코치 행동과 방식마다 다른 행동 목록

**Files:**
- Modify: `src/act/tasks.ts`, `services/pam/scenarios/noonchi/tasks.json`, `src/server/home.ts`(`tasks: () => tasksFor(assist())`, 검사에 넘기는 목록)
- Test: `tests/act-tasks.test.ts`, `tests/agent-planner.test.ts`

**Interfaces:**
- Produces:

```ts
export interface TaskSpec { /* … */
  /** 코치 모드에서만 PAM에 보내는 행동. */
  coach?: true;
  /** 이 행동 계획의 단계 수 상한(없으면 8). */
  maxSteps?: number;
}
"라면 끓이기 알려 주기": {
  name: "라면 끓이기 알려 주기", coach: true, maxSteps: 14,
  description: "사람이 라면을 끓이려 하거나 방법을 물으면 냄비 꺼내기부터 불 끄기까지 사람이 할 일을 단계마다 알려 준다. 클로이드는 가전을 조작하지 않는다.",
  allow: { kinds: ["go", "pick", "place", "do", "wait", "say"], need: ["do"] },
},
/** PAM에 보내는 행동 목록(순서가 task_index). noonchi: coach가 아닌 행동, coach: 코치 행동과 「사용자에게 물어보기」. */
export function tasksFor(assist: AssistMode): string[];
/** 모든 행동 이름(검사·tasks.json 견주기). */
export const TASK_NAMES: readonly string[];
```

- [ ] **Step 1: 실패하는 시험.** 「`tasksFor("noonchi")`에 코치 행동이 없고 `tasksFor("coach")`는 `["사용자에게 물어보기", "라면 끓이기 알려 주기"]`다」, 「`tasks.json`이 `TASK_NAMES` 전부와 같다」, 「코치 행동에는 device 단계를 쓸 수 없고 do가 꼭 있어야 한다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/act-tasks.test.ts tests/agent-planner.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현. `home.ts`의 판단 호출은 `tasksFor(ctx.assist?.() ?? "noonchi")`, 계획 전·실행 전 검사는 그 판단에 보낸 목록을 쓴다.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(act): add the ramen coaching action and per-mode task lists`.

### Task 4: 들은 말을 관찰 텍스트에 넣기

**Files:**
- Modify: `src/contract/world.ts`(`WorldChangeKind`에 `"heard"`), `src/world/state.ts`(`heard`), `src/world/labels.ts`(`CHANGE_TEXT.heard`), `src/server/home.ts`(폰 서버 `onAnswer`가 답이 아닌 말을 넘김)
- Test: `tests/world-state.test.ts`, `tests/world-text.test.ts`(없으면 `tests/world-decide.test.ts`), `tests/pam-text-only.test.ts`

**Interfaces:**
- Produces:

```ts
// WorldState
/** 실제 폰이 들은 말 한 마디를 변화 줄로 남긴다(판단 계기). 200자에서 자르고 줄바꿈·「」를 뺀다. */
heard(text: string, atMs: number): WorldChange[];   // [{ kind: "heard", subject: "person", text: CHANGE_TEXT.heard(말), meaningful: true, at_ms }]
// CHANGE_TEXT.heard = (said: string) => `사람이 말함: 「${said}」`
```
- 지금 명령의 답으로 받은 말(「완료」·「그만」·질문 답)은 넣지 않는다. 그 밖의 말만 넣는다. 눈치 모드에서도 넣는다.

- [ ] **Step 1: 실패하는 시험.** 「`heard("라면 끓이는 법 알려 줘", t)` 뒤 60초 안의 관찰 텍스트에 `HH:MM:SS 사람이 말함: 「라면 끓이는 법 알려 줘」` 줄이 있고 60초 뒤에는 없다」, 「200자 넘는 말은 잘린다」, 「event 계기 모드에서 들은 말이 판단을 부른다」, 「PAM 요청 본문에는 여전히 사진 칸이 없다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/world-state.test.ts tests/pam-text-only.test.ts` → `heard is not a function`으로 실패 확인.
- [ ] **Step 3:** 구현. `home.ts`: `onAnswer`에서 `tracker.onHeard`가 null이면 `world.heard(text, now())`의 변화를 `decide.onChanges`와 기록(`world` 종류)에 넘긴 뒤 `{ handled: false }`를 돌려준다(Task 5·10에서 이 길을 더 다듬는다).
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(world): add heard speech to the observation text`.

### Task 5: 말 요청 에이전트가 요청 아닌 말에 답하지 않기

지금은 가전 요청이 아닌 말에도 에이전트 답이 폰에서 읽힌다. 「라면 끓이는 법 알려 줘」에 에이전트가 글로 답해 버리면 PAM 길과 겹친다.

**Files:**
- Modify: `src/agent/tools.ts`(`LEAVE_IT` 도구), `src/agent/agent.ts`(`runModel`), `src/agent/prompts.ts`
- Test: `tests/agent.test.ts`, `tests/phone-talk.test.ts`

**Interfaces:**
- Produces:

```ts
export const LEAVE_IT = "leave_it";
// 도구: { name: "leave_it", title: "넘기기", readOnly: true, schema: z.object({}),
//   description: "가전 제어·배치 요청이 아닌 말(혼잣말, 하는 법을 묻는 말, 주변 대화)이면 이 도구 하나만 부릅니다. 그런 말은 판단 모델이 듣고 돕습니다. 답 글은 쓰지 않습니다." }
// Agent.chat: 이번 차례에 부른 도구가 leave_it뿐이면 reply는 ""(실제 폰은 빈 글을 보이지도 읽지도 않는다).
```
- 시스템 프롬프트 규칙 한 줄: `- 가전 제어·배치 요청이 아닌 말(혼잣말, 하는 법을 묻는 말, 주변 대화)에는 leave_it만 부르고 답 글을 쓰지 않는다.`
- `leave_it`은 서버 안 에이전트 전용이다(MCP 목록에 내지 않는다).

- [ ] **Step 1: 실패하는 시험.** 「가짜 모델이 `leave_it`만 부르면 `chat` 답이 빈 글이고 폰 서버 답 `text`도 빈 글이다」, 「`leave_it`과 가전 도구를 같이 부르면 가전 결과를 말한다」, 「시스템 프롬프트에 그 규칙 줄이 있다」, 「MCP 도구 목록에 `leave_it`이 없다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/agent.test.ts tests/phone-talk.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인, `tests/mcp.test.ts`도 같이.
- [ ] **Step 5:** 커밋 `feat(agent): stay silent on speech that is not a device request`.

### Task 6: FSM 기억에 요리 상태

**Files:**
- Modify: `src/brain/decision.ts`(`CUP_FSM_MEMORY`에 상태 하나와 가는 길), `src/world/labels.ts`(`FSM_STATE_TEXT.cooking = "요리를 시작함"`)
- Test: `tests/brain-decision.test.ts`

**Interfaces:**
- 더하는 상태:

```ts
{ id: "cooking", description: "사용자가 주방에서 음식을 만들려 한다. 방법을 묻거나 무엇을 할지 몰라 멈춰 있으면 단계마다 알려 준다.",
  rules: [{ trigger: "사용자가 라면 끓이는 법을 알려 달라고 말했거나, 주방에서 라면을 끓이려다 무엇을 해야 할지 모르겠다고 말한다.", action: "라면 끓이기 알려 주기" }],
  next: [{ to: "drinking", on: "사용자가 음식을 들고 식탁에 앉는다." }] }
// drinking·watching_tv·left_cup의 next에 { to: "cooking", on: "사용자가 주방으로 가서 요리를 시작하려 한다." }를 더한다.
```
- 코치 모드에서는 행동 목록에 컵 행동이 없어 PAM이 컵 규칙을 고를 수 없다. 눈치 모드에서는 코치 행동이 목록에 없다.

- [ ] **Step 1: 실패하는 시험.** 「기억이 계약 검사를 통과하고 `fsmRuleOf(…, "라면 끓이기 알려 주기")`가 `cooking`을 준다」, 「상태 id마다 이름표가 있다」, 「모든 규칙 행동이 `TASK_NAMES` 안이다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/brain-decision.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현(컵 갈래 계획 Task 6의 seed 판본 올리기가 새 seed를 넣는다).
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(brain): add a cooking state that fires the ramen coaching action`.

### Task 7: 계획 검사 — 14단계, 손으로 켜고 끄는 가전, 안전 문구

**Files:**
- Modify: `src/agent/planTools.ts`(`STEP_ARGS`, `AgentStep`, `PLAN_LIMITS`, `SUBMIT_ARGS`, `PlanDraft.check`·`finish`·`submit`), `src/agent/planner.ts`(`PLANNER_DEFAULTS.maxOutputTokens` 4000 → 6000)
- Test: `tests/agent-planner.test.ts`

**Interfaces:**
- Produces:

```ts
// PLAN_LIMITS.maxSteps = 8(기본), PLAN_LIMITS.hardMaxSteps = 14. 계획마다 한도는 task.maxSteps ?? 8.
// STEP_ARGS에 더하는 칸(do 단계에만)
hand_device: z.object({ id: z.string().min(1), to: z.enum(["on", "off"]) }).optional()
  .describe("do: 사람이 손으로 켜거나 끄는 가전(id는 [가전]의 id)"),
caution: z.string().min(1).max(30).optional()
  .describe("do: 위험한 단계 앞에 폰이 읽을 안전 한 줄(예: 냄비가 뜨거워져요.)"),
// AgentStep에 더하는 칸
hand: { deviceId: string; to: "on" | "off" } | null;
caution: string | null;
/** 손으로 켜는 가전이 위험 목록(CONFIRM_RULES: 종류와 명령 on)인가. */
export function riskyHand(step: Pick<AgentStep, "hand">, devices: readonly DeviceView[]): boolean;
```
- 검사:
  - `hand_device`·`caution`은 do에만 쓴다. `hand_device.id`는 이 집 가전이어야 한다.
  - 위험 목록 가전을 켜는 do에는 `caution`이 꼭 있다. `caution`은 지금 상태를 알리는 말이라 「주세요」·「게요」로 끝나지 않고 화면 글 규칙을 지킨다.
  - 위험 목록 가전을 켠 계획은 그 뒤에 같은 가전을 끄는 do(`to: "off"`)가 있어야 끝낸다(「켠 가전은 계획 안에서 끕니다」).
  - `hand_device`가 있는 do의 until은 없거나 그 가전 상태 하나다(`{"device": id, "state": …}`, `TOOL_STATES.turn_on`·`turn_off`의 값).

- [ ] **Step 1: 실패하는 시험.** 「코치 행동은 14단계까지 받고 15단계는 버린다. 컵 치우기는 지금처럼 9단계를 버린다」, 「인덕션을 켜는 do에 caution이 없으면 버린다」, 「caution이 `조심해 주세요`면 버린다」, 「켜기만 있고 끄기가 없으면 끝내지 않는다」, 「go에 hand_device를 쓰면 버린다」, 「위험 목록이 아닌 가전(에어컨)을 손으로 켜는 do는 caution 없이 통과한다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/agent-planner.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현. `SUBMIT_ARGS`의 배열 한도는 `hardMaxSteps`로 두고 `submit`이 행동마다 한도를 본다.
- [ ] **Step 4:** 통과 확인, `npx tsc --noEmit -p .`.
- [ ] **Step 5:** 커밋 `feat(agent): check hand-operated risky appliances and allow longer coaching plans`.

### Task 8: 코치 지시문과 가짜 모델의 라면 계획

**Files:**
- Modify: `src/agent/planInput.ts`(`PLANNER_PROMPT`에 「코치」 절), `tests/helpers/planner.ts`(`ramenSteps`, `RAMEN_SCRIPTS`)
- Test: `tests/agent-planner.test.ts`

**Interfaces:**
- 지시문에 더하는 절(라면 단계 자체는 적지 않는다):

```
코치(쓸 수 있는 단계에 device가 없는 할 일)
- 사람이 스스로 하는 일을 처음부터 끝까지 단계마다 알려 준다. 한 단계에 할 일 하나. 클로이드는 가전을 조작하지 않는다.
- 자리를 옮겨야 하면 go를 먼저 둔다. 물건을 꺼내면 pick, 올려놓으면 place, 그 자리에서 하는 일(받기·넣기·켜기·끄기)은 do.
- 비전이 볼 수 있는 것만 until로 쓴다: 폰 위치(phone_near), 무언가 들고 있음(person_holding), 싱크대 물 흐름({"fixture": "sink", "facts": {"use": "water_running"}}), 가전 상태(device). 볼 수 없는 일은 until 없이 둔다(사람이 「완료」나 말로 넘긴다).
- 손으로 가전을 켜거나 끄는 do에는 hand_device를 쓴다. 불·열이 나는 가전을 켜는 do에는 caution(안전 한 줄)을 쓰고, 계획 안에서 그 가전을 끄는 do를 꼭 둔다.
- 시간이 걸리는 일(물 끓기, 익기)은 say로 한 줄 알린 뒤 wait {"elapsed_s": 초}.
- [지난 수업]이 있으면 그 단계 이름(label)과 순서를 그대로 쓴다.
```
- `ramenSteps(ids: { cabinet: string; sink: string; cooktop: string; cooktopDevice: string }): Record<string, unknown>[]`: 시험 대본 13단계(수납장으로 가기 · 냄비 꺼내기 · 싱크대로 가기 · 물 받기 · 인덕션으로 가기 · 냄비 올리기 · 인덕션 켜기(hand_device on, caution `냄비가 뜨거워져요.`) · say `물이 끓을 때까지 기다려요.` · wait 240초 · 면과 스프 넣기 · wait 240초 · 인덕션 끄기(hand_device off) · say `라면이 다 됐어요.`). 시험에서는 wait를 2초로 줄인 판도 둔다(`waitS` 인자, 기본 240).

- [ ] **Step 1: 실패하는 시험.** 「지시문에 코치 절이 있고 라면·냄비라는 낱말이 지시문에 없다」, 「가짜 모델의 도구 호출로 만든 라면 계획은 13단계이고 사람 명령이 모두 「주세요」로 끝나며 화면 단계 종류가 맞다」, 「계획 입력의 `[할 일]` 줄에 쓸 수 있는 단계가 `go, pick, place, do, wait, say`로 나온다」.
- [ ] **Step 2:** 실패 확인. **Step 3:** 구현. **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(agent): add coaching guidance to the plan mode prompt`.

### Task 9: 실행 추적 — 켜기 전 묻기와 끄기 안내, 진행 중 PAM 쉬기

**Files:**
- Modify: `src/act/track.ts`(`activate`, `finish`, `coaching`), `src/plan/labels.ts`(`CAUTION_TEXT`), `src/server/home.ts`(`hold`)
- Test: `tests/act-track.test.ts`

**Interfaces:**
- Produces:

```ts
export const CAUTION_TEXT = {
  ask: (caution: string, label: string) => `${caution} ${josa(label, "을/를")} 켤까요?`,   // 예: 냄비가 뜨거워져요. 인덕션을 켤까요?
  off: (label: string) => `${josa(label, "을/를")} 꺼 주세요`,
};
// Asking에 { why: "hand" } 더함. Run에 hot: Set<string>(손으로 켠 위험 가전 id).
/** 코치 행동 계획이 열려 있는가(판단 호출을 쉬게 한다). */
coaching(): boolean;
```
- 위험 목록 가전을 켜는 do 단계가 되면 명령보다 먼저 `CAUTION_TEXT.ask`를 답 둘(승인·거절)과 함께 묻는다. 승인이면 명령(「인덕션을 켜 주세요」)을 보내고, 거절이면 `APPROVAL_TEXT.refused`로 계획을 취소한다. 답은 기억하지 않는다. 기다린 시간은 단계 시간 한도에 넣지 않는다.
- 켜는 do가 끝나면 `hot`에 넣고 끄는 do가 끝나면 뺀다. 계획이 `hot`이 남은 채 닫히면(그만·시간 초과·실패·새 계획) 닫은 뒤 실제 폰에 `CAUTION_TEXT.off` 명령을 「완료」와 함께 한 번 보낸다(단계 id `<계획 id>:off`, 소리로 읽음). 「완료」나 말 답, 그 가전 꺼짐, 120초 중 먼저 오는 것으로 지운다.
- `home.ts` 판단 호출: `hold: () => tracker.waiting() || tracker.coaching()`.

- [ ] **Step 1: 실패하는 시험.** 「인덕션 켜기 단계는 먼저 `냄비가 뜨거워져요. 인덕션을 켤까요?`와 승인·거절을 보내고, 승인 뒤에만 `인덕션을 켜 주세요`를 보낸다. 다음 판에도 또 묻는다」, 「거절이면 켜라는 명령 없이 취소로 닫는다」, 「켠 뒤 「그만」이면 계획을 닫고 `인덕션을 꺼 주세요`와 「완료」를 보낸다. 「완료」면 지운다」, 「끄는 단계까지 끝낸 계획은 끄기 안내를 보내지 않는다」, 「코치 계획이 열려 있으면 `coaching()`이 참이고 판단 호출이 PAM을 부르지 않는다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/act-track.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인. `ui/tests/phone-screen.test.tsx`의 승인 칸 시험(답 둘)이 이 질문에도 맞는지 본다.
- [ ] **Step 5:** 커밋 `feat(act): ask before hand-operated risky steps and remind to switch off`.

### Task 10: 다른 행동 바로잡기와 혼잣말 돕기 (관찰 모드)

**Files:**
- Modify: `src/contract/events.ts`(`LookTool`, `LookTrigger`), `src/agent/observer.ts`(프롬프트·도구·입력·검사), `src/act/look.ts`(`strayed`, `heard`), `src/act/track.ts`(`Stray`, `tell`, `strayed`·`heardHelp` 연결), `src/plan/labels.ts`(`LOOK_TEXT.told`·`passed`), `src/server/home.ts`, `tests/helpers/observer.ts`
- Test: `tests/agent-observer.test.ts`, `tests/act-look.test.ts`, `tests/act-track.test.ts`

**Interfaces:**
- Produces:

```ts
export type LookTool = "look_closer" | "ask_person" | "wait" | "tell_person" | "pass_on";
export type LookTrigger = "stalled" | "unknown_fact" | "off_track" | "heard";
// 관찰 모드 도구
// tell_person { text, reason }: 사람에게 지금 할 일을 한 줄로 다시 알린다. text는 「주세요」로 끝나고 60자 아래(예: 먼저 냄비에 물을 받아 주세요).
// pass_on { reason }: 들은 말이 지금 하는 일과 상관없다. 말 요청 에이전트로 넘긴다(계기 heard에만).
export interface ObserveSituation { /* … */
  /** 코치 계획의 단계 목록(이름·상태)과 지금 단계 번호. off_track·heard에만. */
  plan?: { steps: { label: string; status: StepStatus }[]; at: number };
  /** 방금 본 변화 줄(최근 30초, 오래된 것부터). off_track에만. */
  changes?: string[];
  /** 들은 말. heard에만. */
  said?: string;
}
// 실행 추적 → 보기 담당
export interface Stray { planId: string; stepId: string; label: string; command: string; steps: { label: string; status: StepStatus }[]; at: number;
  changes: string[]; signal: AbortSignal }
// TrackerOptions.strayed?: (s: Stray) => boolean
/** 지금 사람 단계의 명령 글을 text로 바꿔 소리로 읽고 8초 뒤 원래 명령으로 되돌린다(되돌릴 때는 읽지 않는다). 보냈으면 true. */
tell(planId: string, stepId: string, text: string): boolean;
// Looker
strayed(s: Stray): boolean;                       // 도구 tell_person·wait
heard(planId: string, stepId: string, said: string, s: Omit<Stray, "changes">): Promise<"told" | "passed" | "waited">;  // 도구 tell_person·pass_on·wait
// TRACK_DEFAULTS.strayGapMs = 6000, strayMax = 2, tellHoldMs = 8000
```
- 계기(결정론): 코치 계획의 사람 단계가 진행 중이고, World State에 의미 있는 변화(사람 방 바뀜·가전 상태 바뀜·가전 설비 상태 바뀜)가 왔는데 지금 단계의 끝 조건이 참이 아닐 때. 단계마다 2번, 6초에 한 번까지. 폰이 다른 자리 근처가 됐을 때(`phone_near`가 지금 단계 target이 아닌 평면도 자리에서 참)도 계기다. 무엇이 틀렸는지와 할 말은 관찰 모드(LLM)가 정한다.
- 들은 말: 코치 계획이 열려 있고 그 말이 지금 명령의 답이 아니면 `Looker.heard`를 부른다. `told`·`waited`면 말 요청 에이전트를 부르지 않고, `passed`면 지금처럼 `agent.chat`으로 넘긴다. 관찰 모드가 실패하면 `passed`로 본다.
- 관찰 모드 프롬프트에 더하는 줄: `- [계획]이 있으면 사람이 지금 단계와 다른 일을 하는지 본다. 다른 자리로 갔거나 순서를 건너뛰었거나 위험하면(물을 받기 전에 불을 켬) tell_person으로 지금 할 일을 한 줄로 알린다. 지금 단계를 하는 중으로 보이면 wait.`, `- [들은 말]이 있으면: 무엇을 할지 모르겠다는 말이면 tell_person으로 지금 할 일을 알리고, 이 일과 상관없는 말이면 pass_on, 답이 필요 없는 말이면 wait.`

- [ ] **Step 1: 실패하는 시험.**
  - 관찰 모드: 「off_track 요청의 입력 글에 `[계획]` 단계 목록·지금 단계·`[방금 본 변화]`가 있고 도구는 tell_person·wait뿐이다」, 「heard 요청에는 `[들은 말]`이 있고 도구는 tell_person·pass_on·wait다」, 「tell_person 글이 「주세요」로 안 끝나면 까닭을 주고 다시 받는다」, 「off_track에서 pass_on을 부르면 거절한다」.
  - 실행 추적: 「물 받기 단계에 사람 방이 거실로 바뀌면 `strayed`를 한 번 부르고 6초 안에는 다시 부르지 않으며 단계마다 2번까지다」, 「지금 단계의 끝 조건을 참으로 만든 변화에는 부르지 않는다」, 「컵 치우기(코치 아님)에는 부르지 않는다」, 「`tell`은 같은 계획·단계 id로 글만 바꿔 읽고 8초 뒤 원래 명령을 `speak: false`로 다시 보낸다. 단계가 넘어가면 되돌리지 않는다」.
  - 보기 담당: 「tell_person을 고르면 `tell`을 부르고 look 기록(계기 off_track, 글 `다시 알림 · …`)을 남긴다」, 「heard에서 pass_on이면 `passed`」, 「한 시간 상한을 넘으면 부르지 않는다」.
  - 연결: 「코치 계획 중 `어 뭐 해야 되지`를 들으면 관찰 모드가 한 번 불리고 말 요청 에이전트는 불리지 않는다. `거실 불 켜 줘`는 pass_on 뒤 말 요청 에이전트가 켠다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/agent-observer.test.ts tests/act-look.test.ts tests/act-track.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현. 멈춘 단계(A)가 도는 중이면 `strayed`는 받지 않는다(false). `heard`는 A·B를 끊지 않고 끝나길 기다리지 않는다: 보기 담당이 바쁘면 `passed`.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(agent): correct off-track actions and answer self-talk during coaching`.

### Task 11: 잘한 단계는 말을 줄이기 (독립 기록)

**Files:**
- Create: `src/act/lessons.ts`, `tests/act-lessons.test.ts`
- Modify: `src/act/track.ts`(단계 결과 모으기, 조용한 단계), `src/agent/planTools.ts`(`PlanContext.lesson`), `src/agent/planInput.ts`(`[지난 수업]`), `src/server/home.ts`
- Test: `tests/act-lessons.test.ts`, `tests/act-track.test.ts`, `tests/agent-planner.test.ts`

**Interfaces:**
- Produces:

```ts
// src/act/lessons.ts
/** alone: 이 단계를 도움 없이 이어서 해낸 횟수(도움을 받으면 0). */
export interface LessonStep { label: string; alone: number }
export interface Lesson { task: string; runs: number; steps: LessonStep[]; updatedAt: string }
export interface StepOutcome { label: string; alone: boolean }
export interface LessonBook { get(task: string): Lesson | null; record(task: string, outcomes: StepOutcome[], at: string): void }
/** 이어서 이만큼 혼자 해낸 단계는 다음부터 소리로 읽지 않는다. */
export const QUIET_AFTER = 2;
/** 조용한 단계가 이만큼(ms) 안 끝나면 한 번 읽는다. */
export const QUIET_HINT_MS = 20_000;
export const quietLabels = (l: Lesson | null): Set<string>;
export const lessonsPath = (runtimeDir: string, homeId: string) => join(runtimeDir, "homes", homeId, "lessons.json");
export class LessonStore implements LessonBook { constructor(path: string) }
export function memoryLessons(): LessonBook;
// TrackerOptions.lessons?: LessonBook
```
- 「혼자 해냄」: 사람 단계(go·pick·place·do)가 끝났고 그 단계에서 다시 읽기(`repeatMs`)·`tell`·멈춘 단계 부탁(`askCloser`)·조용한 단계 힌트·시간 초과 질문이 없었다. 비전으로 끝났든 「완료」로 끝났든 같다.
- 계획이 `done`으로 끝날 때만 기록한다(취소·실패는 기록하지 않는다). 단계는 이름(label)으로 맞춘다. 이름이 지난번에 없던 단계는 `alone` 0에서 시작한다.
- 조용한 단계: 코치 계획의 사람 단계 이름이 `quietLabels` 안이면 명령을 `speak: false`로 보낸다(글은 그대로 뜬다). `QUIET_HINT_MS` 안에 안 끝나면 한 번 읽고 그 단계는 혼자 해낸 것으로 세지 않는다. 위험 가전을 켜는 단계는 늘 묻고 읽는다.
- 계획 입력에 `[지난 수업] N번 함`과 단계 줄(`- 냄비 꺼내기 · 혼자 2번`)을 넣는다(코치 행동이고 기록이 있을 때).

- [ ] **Step 1: 실패하는 시험.** 「두 판을 도움 없이 끝낸 단계는 `quietLabels`에 있고, 셋째 판에 도움을 받으면 빠진다」, 「파일이 없거나 깨졌으면 빈 기록으로 시작하고, 임시 파일에 쓴 뒤 이름을 바꾼다」, 「취소한 판은 기록하지 않는다」, 「조용한 단계 명령은 `speak: false`이고 20초 뒤 한 번 `speak: true`」, 「인덕션 켜기는 조용한 단계여도 묻는다」, 「계획 입력에 `[지난 수업]` 줄이 있다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/act-lessons.test.ts tests/act-track.test.ts tests/agent-planner.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현(`ApprovalStore`와 같은 파일 쓰기 방식).
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(act): speak less on coaching steps the person already does alone`.

### Task 12: 대시보드에 보이는 것

**Files:**
- Modify: `src/plan/labels.ts`(`SAY_TEXT`), `src/act/say.ts`(`sayLine`), `src/server/home.ts`(`speak`), `ui/tests/dashboard/fixtures.ts`
- Test: `tests/act-say.test.ts`, `ui/tests/dashboard/data.test.ts`, `ui/tests/dashboard/steps.test.tsx`, `ui/tests/dashboard/say-card.test.tsx`

**Interfaces:**
- 생각 말풍선: PAM 판단 그대로다. 생각 한 문장, 「상태 · 요리를 시작함」, 「판단 · 라면 끓이기 알려 주기」. 진행 중에는 PAM을 쉬므로 이 말풍선이 끝까지 남는다.
- 말풍선 카드(`sayLine`):
  - 사람 단계: 지금처럼 `SAY_TEXT.toldStep(단계 이름)`(예: `냄비 꺼내기를 부탁했어요.`).
  - 바로잡은 뒤 8초: `SAY_TEXT.retold = "다시 알려 줬어요."`
  - 조용한 단계: `SAY_TEXT.quiet = (label) => `${josa(label, "을/를")} 지켜보고 있어요.``
  - 끄기 안내가 떠 있는 동안: `SAY_TEXT.offAsked = "불을 꺼 달라고 했어요."`
  - 켜기 전 질문은 승인이라 대시보드에 보이지 않는다(단계 id `:hand`로 끝나는 명령은 `:approve`처럼 없는 것으로 본다).
- 진행 칩(단계 막대): 13칸이 지금 칸 너비 안에 들어간다(칸은 `flex-1`). 칸·캔버스 크기는 바꾸지 않는다.

- [ ] **Step 1: 실패하는 시험.** 위 네 글의 `sayLine` 시험, 「켜기 전 질문 명령은 말풍선 카드에 보이지 않는다」, 「13단계 계획의 단계 막대가 13칸이고 칸 class·style이 4단계 때와 같다」, 「코치 판단의 생각 말풍선 칩 둘」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/act-say.test.ts`, ui 시험 → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인, `npm run lint`.
- [ ] **Step 5:** 커밋 `feat(dashboard): show coaching corrections and quiet steps on the say card`.

### Task 13: 가짜 서버로 도는 코치 흐름 시험

**Files:**
- Create: `tests/coach-e2e.test.ts`
- Modify: `tests/helpers/pam.ts`(`coachPredict`), `tests/helpers/observer.ts`(계기마다 답 대본)

**Interfaces:**
- `coachPredict(body)`: 시험용 PAM 답. 관찰 텍스트에 `사람이 말함: 「…라면…」`이 있으면 요청 `tasks`에서 「라면 끓이기 알려 주기」 번호, 아니면 -1.

- [ ] **Step 1: 실패하는 시험.** `tests/noonchi-e2e.test.ts`와 같은 틀, 한양목련 집, `setup.json` `assist: "coach"`, 승인은 미리 둠, wait는 2초 대본:
  1. 폰이 `say` 「라면 끓이는 법 알려 줘」를 보낸다 → 폰 답 글은 빈 글 → PAM 요청의 `tasks`가 코치 목록이고 관찰 텍스트에 그 말이 있다 → 첫 명령 `수납장으로 가 주세요`.
  2. 「완료」·말 「다 했어」·VLM 답(사람 `holding_object`)으로 단계를 넘겨 인덕션 켜기에 닿으면 질문과 답 둘이 오고, 승인 뒤 `인덕션을 켜 주세요`.
  3. 물 받기 단계에서 사람 방을 거실로 바꾸면(대본 감지기) 관찰 모드가 `tell_person`을 내고 폰 명령 글이 그 글로 바뀌었다가 8초 뒤 원래 글로 돌아온다.
  4. 면 넣기 단계에서 `say` 「어 뭐 해야 되지」 → 관찰 모드 heard → 명령 글이 다시 읽힌다. 말 요청 에이전트 요청은 0번.
  5. 끝까지 가면 계획 `done`, `lessons.json`에 13단계 중 사람 단계 기록, 진행 중 PAM `/predict` 호출이 늘지 않음.
  6. 다른 판: 인덕션을 켠 뒤 「그만」 → 계획 취소 뒤 `인덕션을 꺼 주세요` 명령.
  7. 눈치 모드에서는 같은 말에 PAM 요청 `tasks`에 코치 행동이 없다.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/coach-e2e.test.ts` → 실패 확인.
- [ ] **Step 3:** 빠진 연결을 `src/server/home.ts`에서 고친다.
- [ ] **Step 4:** 통과 확인(이 파일은 시험 시간 한도 60초).
- [ ] **Step 5:** 커밋 `test(e2e): coach mode guides ramen cooking from a spoken request`.

### Task 14: 영상 판정에 말 넣기와 전체 확인

**Files:**
- Modify: `scripts/video-check.ts`(`--say <초>:<글>` 여러 번, 그 영상 시각에 폰 페이지 소켓으로 `say`를 보냄), `tests/video-check.test.ts`

- [ ] **Step 1: 실패하는 시험.** 「`--say 5:라면 끓이는 법 알려 줘`를 받고 시각표에 `말` 줄로 남는다. 글이 비거나 초가 숫자가 아니면 쓰는 법 글」. 실패 확인 뒤 구현, 통과, 커밋 `feat(video): inject spoken lines at given clip times`.
- [ ] **Step 2:** `npx tsc --noEmit -p .`, `npm run lint`, `npm run heavy -- npx vitest run`, ui 시험, `npm run heavy -- npm run build --prefix ui`.
- [ ] **Step 3: 가짜 판정.** `--fake`로 라면 영상과 단계 영상이 차례로 바뀌는지 본다(비용 0).
- [ ] **Step 4: 실제 판정 1판(약 $0.08~0.12, 끝난 뒤 실제 값을 적는다).** 서버를 코치 모드·한양목련 집으로 띄우고 `--clip kitchen-start.mp4 --say 5:라면 끓이는 법 알려 줘 --step …`(아래 표)으로 돌린다. **기준:** 말 뒤 30초 안에 첫 명령, 이동 4단계와 냄비 꺼내기는 누른 단추 0번, 켜기 전 질문 1번, 계획 `done`, 관찰 모드 호출 10번 아래. 둘째 판은 `wrong-fridge.mp4`를 물 받기 단계 영상으로 넣어 바로잡는 글이 나오는지 본다(글이 「주세요」로 끝나고 지금 할 일을 말하는지 사람이 읽어 본다).
- [ ] **Step 5: 실제 폰 시연(사람이 함께).** 아래 「실제 폰 시연 순서」대로 한 번. 같은 일을 세 번 해 셋째 판에 조용한 단계가 생기는지 본다.
- [ ] **Step 6: 문서.** `docs` 저장소 `01_Product/구현명세서 SSOT.md`(돕는 방식, 코치 행동, 들은 말 줄, 관찰 모드 계기·도구, 손으로 켜는 위험 가전 규칙, 수업 기록 파일, 환경 변수 없음), `변경이력.md`. noonchi `CLAUDE.md` 규칙 표에 두 줄: 「코치 행동은 가전을 조작하지 않는다 | `tests/act-tasks.test.ts`」, 「손으로 켜는 위험 가전 단계는 늘 묻고, 켠 채 닫히면 끄라고 알린다 | `tests/act-track.test.ts`·`tests/agent-planner.test.ts`」.
- [ ] **Step 7:** Codex reviewer(herdr `w2:p5`)에게 브랜치 전체를 리뷰받고 지적을 고친다. `trail note`로 버린 길을 남긴다.

## 찍을 영상 (사용자, 가로 1280×720, 폰을 가로로)

주방에서 폰을 가슴 높이로 들고 1인칭으로 찍는다. 손과 대상이 화면 가운데에 오게 한다.

| 영상 | 길이 | 보여야 하는 것 |
|---|---|---|
| `kitchen-start.mp4` | 20초 | 주방 전체가 보이게 서 있음(싱크대·인덕션·냉장고 중 둘 이상). 말은 판정 도구가 넣는다 |
| 단계 `go-cabinet.mp4` | 10초 | 수납장 앞까지 걸어가 멈춤 |
| 단계 `pick-pot.mp4` | 10초 | 수납장을 열고 냄비를 꺼내 든 손이 5초 보임 |
| 단계 `go-sink.mp4` | 10초 | 싱크대 앞까지 |
| 단계 `fill-water.mp4` | 20초 | 수전에서 물이 흐르는 것이 보이고 냄비에 받음, 물을 잠금 |
| 단계 `go-induction.mp4` | 10초 | 인덕션 앞까지 |
| 단계 `place-pot.mp4` | 10초 | 냄비를 인덕션에 올리고 손을 뗌 |
| 단계 `turn-on.mp4` | 10초 | 손이 인덕션 단추를 누름, 표시등이 보이면 좋음 |
| 단계 `add-noodles.mp4` | 15초 | 끓는 물에 면과 스프를 넣음 |
| 단계 `turn-off.mp4` | 10초 | 손이 인덕션을 끔 |
| `wrong-fridge.mp4` | 15초 | 물 받기 단계인데 냉장고로 가서 문을 엶 |
| `wrong-on-first.mp4` | 10초 | 빈 냄비를 올리고 바로 인덕션을 켬 |

## 실제 폰 시연 순서

1. 설정 3단계에서 코치 모드를 고른다. 운영 모드는 시험 모드.
2. 폰에서 AR을 시작하고 주방에서 기준점을 맞춘다(폰 위치로 이동 단계가 넘어간다).
3. 「라면 끓이는 법 알려 줘」라고 말한다. 처음이면 「라면 끓이기 알려 주기를 할까요?」에 승인.
4. 단계마다 폰이 읽는 대로 한다. 못 보는 단계는 「다 했어」라고 말한다.
5. 물 받기 단계에서 일부러 냉장고로 간다 → 바로잡는 말을 듣는다.
6. 면 넣기 단계에서 「어 뭐 해야 되지」라고 말한다 → 지금 할 일을 다시 듣는다.
7. 인덕션 켜기 전 질문에 승인, 끝에 끄기까지.
8. 같은 일을 두 번 더 한다 → 셋째 판에 조용한 단계가 생긴다.

실제 불을 쓰는 시연은 사람이 곁에서 지켜본다. 시스템은 인덕션이 켜졌는지 보지 못한다.

## 정해야 할 것 (사용자)

1. **코치 일의 시작을 누가 정하나.** 가: 들은 말을 관찰 텍스트에 넣고 PAM·FSM이 고른다(추천. 「기존 FSM 그대로」에 맞고 생각 말풍선이 그대로 나온다. 말한 뒤 첫 명령까지 10~30초). 나: 말 요청 에이전트가 도구로 바로 시작한다(5초쯤으로 빠르지만 PAM·FSM을 거치지 않는다).
2. **모드를 어디서 바꾸나.** 가: 설정 3단계에서만(추천, 최소). 나: 말(「코치 모드로 바꿔 줘」)로도 바꾼다(말 요청 에이전트 도구 하나 더).
3. **인덕션 켜기 전 묻기.** 가: 늘 한 번 묻고 승인해야 켜라고 한다(추천. 위험 목록 규칙과 같다). 나: 안전 문구만 읽고 묻지 않는다.
4. **말 줄이기 기준.** 이어서 2번 혼자 해내면 그 단계는 읽지 않고 글만 띄운다. 20초 안 되면 한 번 읽는다. 숫자를 바꿀지, 글도 숨길지.
5. **코치 모드에서 컵 행동.** 가: 코치 모드에서는 PAM에 코치 행동만 보낸다(추천. 시연이 분명하다). 나: 둘 다 보낸다.
6. **들은 말을 기록 DB에 남기기.** 관찰 텍스트에 넣으면 하루 관찰 기록과 반성 입력에도 남는다. 남겨도 되는지.
7. **대상 말투.** 발달장애인 대상이면 명령 글을 더 짧게(15자 아래) 쓰도록 지시문에 넣을지.

## Self-Review

- 시작(말·모드 고르기): Task 1·2·3·4·6·13.
- 단계 목록은 에이전트 계획 모드: Task 7·8. 라면 단계 글은 시험 대본에만 있고 지시문 시험이 「라면·냄비 낱말 없음」을 본다.
- 단계마다 지시·확인·넘기기: 지금 실행 추적 + 컵 갈래 계획의 `do`. 확인 표는 위 「라면 단계와 확인 방법」.
- 틀린 행동 바로잡기: Task 10(계기는 결정론, 판단과 글은 관찰 모드).
- 혼잣말: Task 4(시작 전), Task 5(에이전트가 대신 답하지 않음), Task 10(진행 중).
- 독립 목표: Task 11.
- 비전으로 확인 못 하는 단계: until 없이 「완료」·말, 기다리기는 시간(Task 8 지시문).
- 화면 글 규칙: Task 7(caution 검사), Task 10(tell_person 검사), Task 12.
- 안전·승인: Task 7(끄기 없는 계획 버림), Task 9(켜기 전 묻기, 끄기 안내), 코치 행동에 device 없음(Task 3).
- 가짜 서버 흐름: Task 13. 영상·실제 폰: Task 14.
- 위험: 관찰 모드가 「다른 행동」을 얼마나 맞히는지는 실제 모델로만 알 수 있다(Task 14 Step 4 둘째 판). 틀리게 끼어들면 `strayMax`를 1로 줄인다.
- 위험: 크롬 음성 인식이 주방 소음(물·환풍기)에서 혼잣말을 얼마나 받아 적는지 재지 않았다. Task 14 Step 5에서 본다.
- 위험: 계획 모드가 14단계 계획을 3차례 안에 맞게 내는지, 출력 6000토큰으로 되는지 실제 모델로 확인하지 않았다(Task 14 Step 4).
- 위험: 진행 중 PAM을 쉬어서 그동안의 다른 판단(컵 등)은 나오지 않는다.
