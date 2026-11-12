# 컵 시나리오 갈래 (치우기 · 그대로 두기 · 채워 주기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 컵 장면에서 PAM이 사실에 따라 「컵 치우기 / 컵 그대로 두기 / 사용자에게 물어보기 / 컵에 물 채워 주기 / 컵에 콜라 따라 주기」로 갈라지고, 갈래마다 대시보드 생각 말풍선과 실제 폰 명령이 다르게 나온다.

**Architecture:** 갈래는 PAM이 FSM 기억(상태·트리거·행동)과 World State 관찰 텍스트(컵 내용물, 사람 있음·떠남, 먹는 중·TV 보는 중)로 고른다. 코드는 행동 목록에 행동 셋을 더하고, 계획 모드에 사람 단계 `do`(그 자리에서 하는 일: 따르기)를 더한다. 「컵 그대로 두기」는 계획을 만들지 않는 행동이라 판단 기록과 생각 말풍선에만 보인다. 계획 단계는 지금처럼 에이전트 계획 모드가 만든다.

**Tech Stack:** Node 22 TypeScript 서버, zod, Vitest, React(`ui/`), 가짜 OpenAI 호환 서버(`scripts/fake-openai.ts`), 시험용 PAM 자리(`tests/helpers/pam.ts`), 영상 판정(`scripts/video-check.ts`).

**Spec:** 2026-11-12 회의록 「정한 것」 2번(같은 컵 상황에서 치우기·그대로 두기·채워 주기), 김준형 발언(「어떨 땐 치우고, 어떨 때는 물을 더 채워 주고, 어떨 때는 콜라를 따라 주고」), 허정오 발언(「내용물과 습관을 보고 치울지·물어볼지·더 볼지를 스스로 고르는 것」). 구현 뒤 `docs` 저장소 `01_Product/구현명세서 SSOT.md`의 행동 목록·FSM 기억·계획 단계 절을 같이 고친다.

## 조사한 사실 (2026-11-13, `feat/dash-wide` d83283b)

- PAM 계약 `pam-predict/2`는 `tasks: string[]`와 `memory`(FSM)를 요청마다 받는다(`src/contract/pam.ts`). 행동을 더하고 FSM 기억을 바꾸는 데 **계약은 바꾸지 않는다.** 바꾸는 것은 행동 목록 글, 기억 내용, PAM 지시문의 집 설명 한 줄(`services/pam/scenarios/noonchi/scenario.json`)이다.
- 관찰 텍스트(`src/world/text.ts`)에 이미 들어가는 사실: 컵 내용물(`비어 있음`·`내용물 있음`·`안이 안 보임`), 사람 보임·안 보임과 그 시간, 사람이 하는 일(`먹는 중`·`마시는 중`·`TV 보는 중`), 든 물건, 컵 자리.
- 대기(`task_index -1`)이면 생각 말풍선을 숨긴다(`ui/src/dashboard/data.ts` `thoughtOf`). 「안 치움」을 화면에 보이려면 행동 하나로 둬야 한다.
- 계획 단계 종류는 go·pick·place·device·ask·say·wait다(`src/agent/planTools.ts`). 「따르기」처럼 그 자리에서 하는 사람 일은 없다.
- 계획 검사는 집는 물건이 행동의 대상 종류(`TaskSpec.target`)여야 한다고 본다(`planTools.ts` `check` pick·place). 채워 주기는 대상이 컵이고 집는 것은 병이라 지금은 통과하지 못한다.
- 실행 전 검사는 계획의 첫 act 단계 물건을 대상으로 본다(`src/act/tasks.ts` `planTargetId`). 채워 주기의 첫 act 단계는 병 집기라 「대상 없음」으로 실패한다.
- 기억 seed(`CUP_FSM_MEMORY`)는 기록 DB에 판본이 하나도 없을 때만 저장된다(`src/history/reflect.ts` `memoryForDay`). 이미 돌린 집에는 새 FSM이 들어가지 않는다.
- YOLO는 병(`bottle`)을 본다. 물병과 콜라병은 가르지 못한다. 한양목련 트윈에 냉장고(`fridge_bbc363a3`)·식탁(`dining_table_978b20c7`)·싱크대(`sink_counter_kitchen`)가 있다.

## 갈래 표 (사실 → 판단)

| 장면 | 관찰 텍스트의 사실 | FSM 상태 · 규칙 | PAM 판단 | 그 뒤 |
|---|---|---|---|---|
| 1 | 사람 안 보임 N초째 · 컵 식탁 위 · 비어 있음 | `left_cup` · 빈 컵 | 컵 치우기 | 계획 네 단계(지금과 같음) |
| 2 | 사람 안 보임 · 컵 내용물 있음 | `left_cup` · 음료 남음 | 컵 그대로 두기 | 계획 없음. 생각 말풍선에 생각 한 문장과 「판단 · 컵 그대로 두기」 |
| 3 | 사람 안 보임 · 컵 안이 안 보임 | `left_cup` · 모름 | 사용자에게 물어보기 | 관찰 모드 B가 먼저 가까이 보고, 그래도 모르면 폰으로 묻기 |
| 4 | 사람 보임 · 먹는 중 · 컵 비어 있음 · 든 물건 없음 | `drinking` · 식사 중 빈 컵 | 컵에 물 채워 주기 | 계획: 냉장고로 가기 → 물병 꺼내기 → 식탁으로 가기 → 따르기 |
| 5 | 사람 보임 · TV 보는 중 · 컵 비어 있음 · 든 물건 없음 | `watching_tv` · 빈 컵 | 컵에 콜라 따라 주기 | 계획: 냉장고로 가기 → 콜라 꺼내기 → 탁자로 가기 → 따르기 |
| 6 | 사람 보임 · 컵을 들고 있거나 내용물 있음 | 맞는 규칙 없음 | 대기(-1) | 말풍선 숨김(지금과 같음) |
| 7 | 2번 뒤 사람이 돌아와 다 마시고 다시 떠남 | `left_cup` · 빈 컵 | 컵 치우기 | 「더 보다가 치움」을 한 영상으로 보임 |

## Global Constraints

- 브랜치 `feat/coach-cup`(worktree `C:\Users\ABC\Desktop\소웨공\twin-home-coach`, `feat/dash-wide` 기준). 다른 worktree는 건드리지 않는다. 구현 전에 `npm ci`를 한 번 돌린다.
- 저장소 `CLAUDE.md` 규칙 표 전부. 특히:
  - 규칙으로 계획을 만드는 코드 금지(`cupPlan`·`askPlan`·`planFor` 이름 금지, `tests/same-structure.test.ts`). 채워 주기 단계는 에이전트 계획 모드가 만든다. 코드는 행동 설명·쓸 수 있는 단계·검사만 둔다.
  - mock과 live는 같은 구조. 가짜 PAM·가짜 모델·대본 감지기는 `tests/helpers/`에만 둔다.
  - PAM에 사진을 넘기지 않는다. 요청 칸을 더하지 않는다.
  - 사람 명령은 「주세요」로 끝난다. 화면 글은 상태만(60자 아래, 화살표·괄호 없음). 색·글꼴은 토큰, 화면 부품은 21st.dev 부품.
- 시험·빌드·크롬은 `npm run heavy -- <cmd>`로만, 한 번에 하나. 크롬·dev3d는 PC에 하나만 띄운다.
- 이 PC 메모리는 13.8GB다. 녹화(`--record`)할 때는 `BRAIN_YOLO_PROVIDER=cpu`로 띄운다.
- 실제 모델 비용: 판정 한 번 약 $0.03~0.05. 이 계획 한도 $0.60(장면 6개 × 1판 + 다시 돌리기 6판). 넘기 전에 멈추고 보고한다.
- 커밋 메시지는 영어, attribution 줄 없음. `.gitignore`·`.ignore`·`ui/public/fonts/OFL-noto-sans-kr.txt`·`.trail/`은 커밋하지 않는다. 푸시는 사용자가 말할 때만.
- 단계 영상·촬영 영상은 `runtime/videos/`에 두고 커밋하지 않는다.

## File Structure

| 파일 | 일 |
|---|---|
| `src/act/tasks.ts` | 행동 셋 더하기, `TaskSpec.plan`·`carry`·`carryUnseen`, `planObjectOf` |
| `services/pam/scenarios/noonchi/tasks.json`, `scenario.json` | 행동 목록 맞추기, 집 설명에 냉장고 음료 한 줄 |
| `src/agent/planTools.ts`, `src/agent/planInput.ts` | 단계 종류 `do`, 집는 물건 종류 검사, 지시문·예 |
| `src/contract/phone.ts`, `src/act/track.ts` | `PhoneStepKind`에 `do`, `do` 실행, 계획 없는 행동 기록 |
| `src/act/check.ts` | 대상 종류 물건으로 실행 전 검사 |
| `src/brain/decision.ts`, `src/history/reflect.ts`, `src/history/db.ts` | FSM 기억 상태·규칙, seed 판본 올리기 |
| `src/world/labels.ts`, `src/plan/labels.ts`, `src/act/say.ts`, `src/server/home.ts` | 상태 이름표, 말풍선 카드 글 |
| `tests/helpers/planner.ts`, `tests/helpers/pam.ts`, `tests/cup-branches-e2e.test.ts`(새로) | 가짜 모델 대본, 갈래 흐름 시험 |
| `scripts/video-check.ts`, `ui/src/phone/core/video-ar.js` | 단계 영상 종류에 `do` |

---

### Task 1: 행동 목록에 행동 셋 더하기

**Files:**
- Modify: `src/act/tasks.ts`, `services/pam/scenarios/noonchi/tasks.json`
- Test: `tests/act-tasks.test.ts`, `tests/agent-planner.test.ts`(「계획 모드에 쓰는 행동 목록에는 설명과 쓸 수 있는 단계가 있다」)

**Interfaces:**
- Produces:

```ts
type Kind = "go" | "pick" | "place" | "do" | "device" | "ask" | "say" | "wait";
export interface TaskSpec {
  name: string; description: string; allow: TaskAllow; target?: ObjClass; look?: readonly Facet[];
  /** false면 계획을 만들지 않는 행동이다. 판단 기록과 생각 말풍선에만 보인다. */
  plan?: false;
  /** 집는 물건 종류. 없으면 target이다. */
  carry?: ObjClass;
  /** true면 집는 물건이 안 보여도(냉장고 안) 평면도 자리에서 집는 단계를 받는다. */
  carryUnseen?: true;
}
// TASKS에 더하는 셋(끝에 더해 앞 넷의 task_index를 지킨다)
"컵 그대로 두기": { name: "컵 그대로 두기", description: "사람이 자리를 비웠지만 컵에 음료가 남아 있어 치우지 않고 그대로 둔다.", target: "cup", look: ["contents"], plan: false, allow: { kinds: [], need: [] } },
"컵에 물 채워 주기": { name: "컵에 물 채워 주기", description: "사람이 식사 중인데 컵이 비어 있으면 사람이 냉장고에서 물병을 꺼내 와 컵에 물을 따르게 한다.", target: "cup", look: ["contents"], carry: "bottle", carryUnseen: true, allow: { kinds: ["go", "pick", "do", "place"], need: ["go", "pick", "do"] } },
"컵에 콜라 따라 주기": { name: "컵에 콜라 따라 주기", description: "사람이 TV를 보는 중인데 컵이 비어 있으면 사람이 냉장고에서 콜라를 꺼내 와 컵에 따르게 한다.", target: "cup", look: ["contents"], carry: "bottle", carryUnseen: true, allow: { kinds: ["go", "pick", "do", "place"], need: ["go", "pick", "do"] } },
```

- [ ] **Step 1: 실패하는 시험.** `tests/act-tasks.test.ts`에 「행동 목록은 일곱이고 앞 넷의 순서는 그대로다」, 「컵 그대로 두기는 계획을 만들지 않는 행동이다(`plan === false`)」, 「채워 주기 둘은 대상이 컵이고 집는 것은 병이며 do 단계가 꼭 있어야 한다」, 「`tasks.json`이 `TASK_NAMES`와 같다」(같은 시험이 `agent-planner.test.ts`에 이미 있으면 그 시험이 실패하는 것으로 본다)를 넣는다.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/act-tasks.test.ts tests/agent-planner.test.ts` → 목록 길이 4로 실패 확인.
- [ ] **Step 3: 구현.** 위 셋을 `TASKS`에 더하고 `Kind`에 `"do"`를 더한다. `tasks.json`을 `["컵 치우기", "사용자에게 물어보기", "세탁물 건조기로 옮기기", "에어컨 켜기", "컵 그대로 두기", "컵에 물 채워 주기", "컵에 콜라 따라 주기"]`로 바꾼다.
- [ ] **Step 4:** 같은 명령으로 통과 확인. `npx tsc --noEmit -p .`는 `AgentStepKind`에 `do`가 없어 실패한다. Task 2에서 푼다.
- [ ] **Step 5:** 커밋 `feat(act): add leave-cup and fill-cup actions to the task list`(Task 2와 한 PR 안에서 이어 간다).

### Task 2: 계획 검사가 `do` 단계와 집는 물건 종류를 받기

**Files:**
- Modify: `src/agent/planTools.ts`(`AgentStepKind`, `HUMAN_KINDS`, `VIEW_KIND`, `PLAN_LIMITS.timeoutS`, `STEP_ARGS.kind`, `PlanDraft.check`·`viewTarget`)
- Test: `tests/agent-planner.test.ts`

**Interfaces:**
- Produces:

```ts
export type AgentStepKind = "go" | "pick" | "place" | "do" | "device" | "ask" | "say" | "wait";
export const HUMAN_KINDS: readonly AgentStepKind[] = ["go", "pick", "place", "do"];
// VIEW_KIND.do = "act", PLAN_LIMITS.timeoutS.do = [10, 1800]
// do: 사람이 그 자리에서 하는 일(따르기·붓기). target은 보이는 World State 물건 id 또는 평면도 id. command는 「주세요」로 끝남.
//     object는 쓰지 않음. until은 없어도 됨(없으면 「완료」로 넘김).
```

- [ ] **Step 1: 실패하는 시험.**
  - 「물 채워 주기 계획(go 냉장고 · pick 냉장고 · go 식탁 · do 컵)은 통과하고 화면 단계 종류는 move·act·move·act다」. do의 until은 `{"object": "cup_1", "follow": true, "facts": {"contents": "has_contents"}}`.
  - 「do에는 target과 command가 있어야 하고 object를 쓰면 버린다」, 「do target이 World State 물건이면 그 행동의 대상 종류(컵)여야 한다」.
  - 「채워 주기의 pick은 병이 안 보이면 평면도 id(냉장고)만으로 통과하고, 병이 보이면 그 병 id를 받으며, 컵을 집으면 버린다(이 할 일은 bottle 물건을 집습니다)」.
  - 「컵 치우기의 pick은 지금처럼 컵만 받는다(컵이 안 보이는 평면도 id 집기는 버린다)」.
  - 「채워 주기에 do가 빠지면 끝내지 않는다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/agent-planner.test.ts` → `kind` enum 오류로 실패 확인.
- [ ] **Step 3: 구현.** `check`의 pick·place 종류 검사를 이렇게 바꾸고 do 갈래를 더한다.

```ts
const carry = this.ctx.task.carry ?? this.ctx.task.target;
// pick
if (carry && object && worldObject(world, object)?.cls !== carry) errors.push(`이 할 일은 ${carry} 물건을 집습니다`);
if (carry && !object && !this.ctx.task.carryUnseen) errors.push(`이 할 일은 ${carry} 물건을 집습니다`);
// place
if (object && carry && worldObject(world, object)?.cls !== carry) errors.push(`이 할 일은 ${carry} 물건을 내려놓습니다`);
// do
case "do":
  need("target", !!target);
  if (target && !live(target) && !floor.objects.has(target)) errors.push(`do target은 보이는 World State 물건 id나 평면도 id여야 합니다: ${target}`);
  if (target && live(target) && this.ctx.task.target && live(target)!.cls !== this.ctx.task.target) errors.push(`이 할 일은 ${this.ctx.task.target} 물건에 합니다`);
  putAway(target);
  break;
```
  `none("object")`를 do에도 건다. `viewTarget`은 do를 pick과 같이 `{ objectId: target, position? }`로 낸다. `finish()`의 「내려놓기 물건 = 앞 집기 물건」 검사는 그대로다.
- [ ] **Step 4:** 통과 확인, `npx tsc --noEmit -p .`.
- [ ] **Step 5:** 커밋 `feat(agent): accept do steps and a separate carried class in plan checks`.

### Task 3: 실행 추적이 `do` 단계를 돌리기

**Files:**
- Modify: `src/contract/phone.ts`(`PhoneStepKind`), `src/act/track.ts`(`Stall.kind`, `stall`, `vision`, `spots`), `src/plan/labels.ts`(`VISION_TEXT`)
- Test: `tests/act-track.test.ts`, `ui/tests/phone-screen.test.tsx`

**Interfaces:**
- Produces: `export type PhoneStepKind = "go" | "pick" | "place" | "do"`, `Stall.kind: "pick" | "place" | "do"`.
- do 단계의 비전 상태 줄: 대상이 World State 물건이면 「컵 · 비어 있음」처럼 이름과 until에 쓴 면의 지금 값(`STATE_TEXT`), 값이 없으면 자리 글. 대상이 평면도 자리면 `VISION_TEXT.distance`.

- [ ] **Step 1: 실패하는 시험.** 「물 채워 주기는 네 명령(냉장고로 가 주세요 · 물병을 꺼내 주세요 · 식탁으로 가 주세요 · 컵에 물을 따라 주세요)을 차례로 보내고 `kind`는 go·pick·go·do다. 병 집기는 사람이 물건을 들고 있음(`person_holding: "bottle"`)일 때, 따르기는 컵이 내용물 있음일 때만 넘어간다. 단계 시작 전에 본 내용물 있음으로는 넘기지 않는다. 답 단추는 「완료」 하나다」, 「do 단계가 8초 넘게 안 끝나면 stalled를 kind do로 부른다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/act-track.test.ts` → 실패 확인.
- [ ] **Step 3: 구현.** `stall`의 종류 조건을 pick·place·do로 넓힌다. `vision`에 do 갈래를 더한다. `advance`는 do에서 `carried`·`placed`를 바꾸지 않는다.
- [ ] **Step 4:** 통과 확인. `ui/tests/phone-screen.test.tsx`에 `kind: "do"` 명령이 지금 명령 자리에 그대로 뜨는 시험을 더해 같이 돌린다.
- [ ] **Step 5:** 커밋 `feat(act): run do steps with vision conditions and stall checks`.

### Task 4: 실행 전 검사를 대상 종류 물건으로 보기

**Files:**
- Modify: `src/act/tasks.ts`(`planObjectOf` 새로), `src/act/check.ts`(`checkPlan`)
- Test: `tests/act-check.test.ts`

**Interfaces:**
- Produces:

```ts
/** 계획 단계 대상(objectId) 가운데 World State에서 그 종류인 첫 물건 id. 없으면 null. */
export function planObjectOf(plan: PlanView, world: WorldView, cls: ObjClass): string | null;
```

- [ ] **Step 1: 실패하는 시험.** 「물 채워 주기 계획(첫 act 단계는 냉장고에서 집기, 넷째 단계 대상이 cup_1)은 컵을 판단 뒤에 다시 봤으면 통과한다」, 「컵을 사람이 들고 있으면 `in_hand`로 막는다」, 「컵이 사라졌으면 `no_target`」, 「컵 치우기 결과는 지금과 같다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/act-check.test.ts` → 채워 주기가 `no_target`으로 실패 확인.
- [ ] **Step 3:** `checkPlan`의 `planTargetId(i.plan)`을 `planObjectOf(i.plan, i.world, spec.target)`로 바꾼다. `planTargetId`는 말풍선 카드(`src/act/say.ts`)가 쓰니 그대로 둔다.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `fix(act): check the plan target by the task's target class`.

### Task 5: 계획 없는 행동(컵 그대로 두기) 기록

**Files:**
- Modify: `src/act/track.ts`(`onDecision`, `leftAt`), `src/plan/labels.ts`(`EXEC_TEXT.left`, `SAY_TEXT.left`), `src/act/say.ts`(`sayLine`), `src/server/home.ts`(`speak`)
- Test: `tests/act-track.test.ts`, `tests/act-say.test.ts`

**Interfaces:**
- Produces: `EXEC_TEXT.left = "그대로 둠"`, `SAY_TEXT.left = "컵을 그대로 두기로 했어요."`, `TRACK_DEFAULTS.leftGapMs = 60_000`(`TrackerOptions.leftGapMs?: number`),
  `sayLine({ ..., left?: { atMs: number } | null })`: 열린 계획이 없고 `left`가 `SAY_DONE_MS`(20초) 안이면 `SAY_TEXT.left`.
- `ExecutionTracker.leftAt(): number | null`(마지막으로 「그대로 둠」을 기록한 시각, `Date.now` 시계).

- [ ] **Step 1: 실패하는 시험.**
  - 「컵 그대로 두기 판단이 오면 계획 모드를 부르지 않고 실제 폰에 아무것도 보내지 않으며 execution 기록 「그대로 둠」을 한 번 남긴다. 같은 판단이 5초마다 와도 60초 안에는 다시 남기지 않는다」.
  - 「컵 치우기를 진행 중일 때 그대로 두기 판단이 오면 진행 중 계획을 바꾸지 않는다」.
  - 「계획 전 검사는 그대로 두기에도 돈다: 컵이 안 보이면 `no_target`」.
  - `sayLine`: 「그대로 둔 지 20초 안이면 `컵을 그대로 두기로 했어요.`, 그 뒤에는 지켜보는 글」.
- [ ] **Step 2:** 실패 확인(`planner`가 불려 실패).
- [ ] **Step 3: 구현.** `onDecision`에서 `precheck` 통과 뒤, `planGapMs` 검사 앞에 둔다.

```ts
if (taskOf(d.action)?.plan === false) {
  if (now - this.leftNoteAt < this.cfg.leftGapMs) return;
  this.leftNoteAt = now;
  this.emit(planIdOf(d.id), "decided");
  return this.emit(planIdOf(d.id), "done", EXEC_TEXT.left);
}
```
  열린 계획이 있어도 이 갈래는 `planned()`를 타지 않아 그 계획을 닫지 않는다. `home.ts`의 `speak`가 `tracker.leftAt()`을 `sayLine`에 넘긴다.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(act): record leave-as-is decisions without planning`.

### Task 6: FSM 기억에 상태·규칙 더하기와 seed 판본 올리기

**Files:**
- Modify: `src/brain/decision.ts`(`CUP_FSM_MEMORY`), `src/world/labels.ts`(`FSM_STATE_TEXT`), `src/history/reflect.ts`(`memoryForDay`), `src/history/db.ts`(판본 조회가 `source`를 돌려주지 않으면 더함), `services/pam/scenarios/noonchi/scenario.json`
- Test: `tests/brain-decision.test.ts`, `tests/history-reflect.test.ts`, `services/pam/tests/test_prompts.py`

**Interfaces:**
- Produces:

```ts
export const CUP_FSM_MEMORY: FsmMemory = {
  initial_state: "drinking",
  states: [
    { id: "drinking", description: "사용자가 식탁에 앉아 먹거나 마시는 중이다. 들고 있는 컵은 사용 중이라 건드리지 않는다.",
      rules: [{ trigger: "사용자가 식탁에서 먹는 중이고 식탁 위 컵이 비어 있으며 컵을 들거나 만지지 않는다.", action: "컵에 물 채워 주기" }],
      next: [{ to: "watching_tv", on: "사용자가 TV를 보기 시작한다." }, { to: "left_cup", on: "사용자가 컵을 두고 자리를 떠나 보이지 않는다." }] },
    { id: "watching_tv", description: "사용자가 TV를 보며 컵으로 음료를 마신다.",
      rules: [{ trigger: "사용자가 TV를 보는 중이고 곁의 컵이 비어 있으며 컵을 들거나 만지지 않는다.", action: "컵에 콜라 따라 주기" }],
      next: [{ to: "drinking", on: "사용자가 식탁에 앉아 먹기 시작한다." }, { to: "left_cup", on: "사용자가 컵을 두고 자리를 떠나 보이지 않는다." }] },
    { id: "left_cup", description: "사용자가 컵을 두고 자리를 비웠다. 화면에 안 보이는 것만으로 떠났다고 보지 않는다.",
      rules: [
        { trigger: "사용자가 자리를 비웠고 컵이 비어 있으며 아무도 컵을 들거나 만지지 않는다.", action: "컵 치우기" },
        { trigger: "사용자가 자리를 비웠지만 컵에 음료가 남아 있다.", action: "컵 그대로 두기" },
        { trigger: "사용자가 자리를 비웠고 컵 안을 확인할 수 없다.", action: "사용자에게 물어보기" },
      ],
      next: [{ to: "drinking", on: "사용자가 돌아와 컵을 다시 든다." }] },
  ],
};
// FSM_STATE_TEXT: drinking "먹거나 마시는 중", watching_tv "TV 보는 중", left_cup "컵을 두고 자리를 뜸"
```
- `memoryForDay`: 그날 쓸 가장 새 판본의 `source`가 `"seed"`이고 내용이 지금 `CUP_FSM_MEMORY`와 다르면(JSON 글 비교) 새 seed 판본을 저장하고 그날에 다시 고정한다. 가장 새 판본이 반성 판본이면 건드리지 않는다.
- `scenario.json` 보관 자리 줄의 `new`: `"- The designated storage area: the kitchen sink, where used cups, bottles and bowls are put. Drinks such as water and cola are kept in the fridge."`

- [ ] **Step 1: 실패하는 시험.**
  - `validateMemory(CUP_FSM_MEMORY, "fsm")` 통과, 모든 규칙의 action이 `TASK_NAMES` 안, `fsmRuleOf`가 다섯 행동마다 상태 하나를 돌려준다(그대로 두기 → `left_cup`, 물 → `drinking`, 콜라 → `watching_tv`).
  - 상태 id마다 `FSM_STATE_TEXT`가 있다.
  - 「옛 seed만 있는 DB는 새 seed 판본을 받고, 반성 판본이 있는 DB는 그대로다」.
  - `test_prompts.py`: 바뀐 보관 자리 줄이 판단 지시문에 들어간다.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/brain-decision.test.ts tests/history-reflect.test.ts` → 실패 확인. PAM 쪽은 `services/pam`에서 `python -m pytest tests/test_prompts.py`.
- [ ] **Step 3:** 구현. 기존 시험이 `drinking`·`left_cup` 설명 글을 그대로 견주면 새 글로 고친다.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(brain): add fill and leave rules to the cup FSM seed and bump stale seeds`.

### Task 7: 계획 지시문과 가짜 모델의 채워 주기 계획

**Files:**
- Modify: `src/agent/planInput.ts`(`PLANNER_PROMPT`), `tests/helpers/planner.ts`(`fillSteps`, `FILL_SCRIPTS`)
- Test: `tests/agent-planner.test.ts`

**Interfaces:**
- 지시문 「단계」 절에 더하는 줄:
  - `- do: 그 자리에서 사람이 하는 일(따르기·붓기). target은 그 일을 받는 World State 물건 id(없으면 평면도 id). command는 「주세요」로 끝난다. 비전으로 볼 수 있으면 until을 쓴다(컵에 따르기: {"object": id, "follow": true, "facts": {"contents": "has_contents"}}). 못 보면 until 없이 두면 사람이 「완료」로 넘긴다.`
  - `- 안 보이는 물건 집기(냉장고 안 병): pick target은 그 자리(평면도 id), until은 {"person_holding": 종류}.`
- 지시문 예 하나:

```
예(컵에 물 채워 주기, 냉장고 fridge_1, 식탁 table_1 위 빈 컵 cup_1)
1. go fridge_1 「냉장고로 가 주세요」 until {"phone_near": "fridge_1"}
2. pick fridge_1 「물병을 꺼내 주세요」 until {"person_holding": "bottle"}
3. go table_1 「식탁으로 가 주세요」 until {"phone_near": "table_1"}
4. do cup_1 「컵에 물을 따라 주세요」 until {"object": "cup_1", "follow": true, "facts": {"contents": "has_contents"}}
```
- `tests/helpers/planner.ts`: `fillSteps(ids: { fridge: string; table: string; cup: string; drink: "물" | "콜라" }): Record<string, unknown>[]`, `FILL_SCRIPTS`(입력 글의 `[할 일]` 줄로 물·콜라를 고르는 `PlanScript` 표).

- [ ] **Step 1: 실패하는 시험.** 「지시문에 do 줄과 안 보이는 물건 집기 줄, 채워 주기 예가 있다」, 「가짜 모델의 도구 호출로 만든 물 채워 주기 계획은 네 명령·조건 그대로다」, 「콜라 따라 주기 계획의 둘째·넷째 명령은 `콜라를 꺼내 주세요`·`컵에 콜라를 따라 주세요`다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/agent-planner.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인(`tests/agent-planner.test.ts` 전체).
- [ ] **Step 5:** 커밋 `feat(agent): teach plan mode the do step with a fill-cup example`.

### Task 8: 대시보드 생각 말풍선에 갈래가 보이는지

**Files:**
- Modify: `ui/tests/dashboard/data.test.ts`, `ui/tests/dashboard/fixtures.ts`(판단 고정 자료), 필요하면 `ui/src/dashboard/data.ts`
- Test: `ui/tests/dashboard/data.test.ts`, `ui/tests/dashboard/say-card.test.tsx`

- [ ] **Step 1: 실패하는 시험.** 「그대로 두기 판단이면 생각 말풍선은 생각 한 문장, 「상태 · 컵을 두고 자리를 뜸」, 「판단 · 컵 그대로 두기」다」, 「물 채워 주기 판단이면 「상태 · 먹거나 마시는 중」, 「판단 · 컵에 물 채워 주기」다」, 「그 뒤 대기 판단이 오면 말풍선을 숨긴다」, 말풍선 카드가 `컵을 그대로 두기로 했어요.`를 받으면 한 줄로 보인다.
- [ ] **Step 2:** `npm run heavy -- npm test --prefix ui -- dashboard/data dashboard/say-card` → Task 6 전 커밋에서는 상태 이름표가 없어 실패한다. Task 6 뒤라 처음부터 통과하면 `thoughtOf`의 이름표 줄을 잠깐 지워 실패하는 것을 확인하고 되돌린다.
- [ ] **Step 3:** 칩 글이 길어 잘리면(`truncate`) 그대로 둔다. 칸 크기는 바꾸지 않는다(CLAUDE.md: 단계가 바뀔 때 transform·opacity만).
- [ ] **Step 4:** `npm run lint`(화면 글·부품·색 검사) 통과 확인.
- [ ] **Step 5:** 커밋 `test(dashboard): cover the thought bubble for leave and fill decisions`.

### Task 9: 가짜 서버로 도는 갈래 흐름 시험

**Files:**
- Create: `tests/cup-branches-e2e.test.ts`
- Modify: `tests/helpers/pam.ts`(`cupBranchPredict`)

**Interfaces:**
- `export function cupBranchPredict(body: Record<string, unknown>): Pred`: 시험용 PAM 자리의 답. 요청의 `tasks`에서 이름으로 번호를 찾고 관찰 텍스트로 고른다(사람 안 보임 + 비어 있음 → 컵 치우기, 사람 안 보임 + 내용물 있음 → 컵 그대로 두기, 사람 안 보임 + 안이 안 보임 → 사용자에게 물어보기, 먹는 중 + 비어 있음 → 컵에 물 채워 주기, TV 보는 중 + 비어 있음 → 컵에 콜라 따라 주기, 그 밖 → -1). 시험 대역이라 `tests/helpers/`에만 둔다.

- [ ] **Step 1: 실패하는 시험.** `tests/noonchi-e2e.test.ts`와 같은 틀(`startServer`, `ScriptedDetector`, 가짜 OpenAI 서버의 VLM 답·계획 답, `startFakePam`)로 시험 넷:
  1. 빈 컵 + 사람 없음 → 실제 폰 첫 명령 `식탁으로 가 주세요`.
  2. 내용물 있는 컵 + 사람 없음 → 8초 동안 실제 폰 명령 없음, `/api/history?kinds=decision,execution`에 행동 `컵 그대로 두기`와 `그대로 둠`, 대시보드 `say` 메시지 `컵을 그대로 두기로 했어요.`. 이어서 VLM 답을 비어 있음으로 바꾸면 컵 치우기 첫 명령이 온다(더 보다가 치움).
  3. 사람 보임·먹는 중 + 빈 컵 → 승인을 미리 둔 채 네 명령이 차례로 오고, 둘째는 VLM이 사람 `holding_object`를 내면, 넷째는 컵을 `has_contents`로 내면 「완료」 없이 넘어가 계획이 `done`.
  4. 3번의 PAM 요청 본문에 사진 칸·`data:image`가 없고 `contract`가 `pam-predict/2`, 칸 이름이 지금 여섯 개 그대로다.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/cup-branches-e2e.test.ts` → 실패 확인(Task 1 전 커밋에서 한 번 돌려 실패 글을 본다).
- [ ] **Step 3:** 빠진 연결이 있으면 `src/server/home.ts`에서 고친다.
- [ ] **Step 4:** 통과 확인. 가짜 서버 `EFAULT`면 그 시험만 다시 돌린다.
- [ ] **Step 5:** 커밋 `test(e2e): cup scene branches into clear, leave, ask and fill`.

### Task 10: 영상 판정에 `do` 단계 영상

**Files:**
- Modify: `scripts/video-check.ts`(`STEP_ARG` 종류에 `do`), `ui/src/phone/core/video-ar.js`(단계 영상 종류)
- Test: `tests/video-check.test.ts`, `ui/tests/phone-video.test.ts`

- [ ] **Step 1: 실패하는 시험.** 「`--step do:cup:pour-water.mp4`를 받는다」, 「`kind: "do"` 명령이 오고 대상 id에 `cup`이 들어 있으면 1.5초 뒤 그 영상으로 바꿔 틀고 자세는 대상을 본다(걷지 않는다)」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/video-check.test.ts`와 ui 시험 → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(video): play step clips for do steps`.

### Task 11: 실제 영상 판정과 전체 확인

- [ ] **Step 1:** `npx tsc --noEmit -p .`, `npm run lint`, `npm run heavy -- npx vitest run`, ui 시험, `npm run heavy -- npm run build --prefix ui`.
- [ ] **Step 2: 가짜 판정.** `npm run heavy -- npx tsx scripts/video-check.ts --clip <장면>.mp4 --fake`로 장면 여섯 개의 시각표가 나오는지, 가로 영상이 잘리지 않는지 본다(비용 0).
- [ ] **Step 3: 실제 판정(장면마다 1판, 약 $0.03~0.05).** PAM과 서버를 새로 띄우고(`BRAIN_YOLO_PROVIDER=cpu`는 녹화할 때만) 아래 「찍을 영상」 장면마다 돌린다. **기준:** `cup-empty-leave` 컵 치우기 첫 명령, `cup-full-leave` 명령 없음 + 판단 `컵 그대로 두기`, `cup-full-return` 치우기 명령이 사람이 다시 떠난 뒤에만, `cup-unknown-leave` 묻기, `meal-empty-cup` 물 네 단계 4/4·누른 단추 0번, `tv-empty-cup` 콜라 네 단계. 갈래가 틀리면 그 판의 PAM 요청 관찰 텍스트와 답을 보고 FSM 트리거 글을 고친다(코드 규칙을 더하지 않는다).
- [ ] **Step 4:** `cup-full-leave`·`meal-empty-cup`을 `--record`로 녹화해 생각 말풍선·말풍선 카드·진행 칩이 맞는지 프레임 4장을 뽑아 본다.
- [ ] **Step 5: 문서.** `docs` 저장소 `01_Product/구현명세서 SSOT.md`(행동 목록 일곱, FSM 기억 상태 셋, 계획 단계 종류 `do`, 계획 없는 행동, 실행 전 검사 대상), `변경이력.md`. noonchi `docs/world-vocabulary.md`는 낱말이 바뀌지 않아 그대로다. `CLAUDE.md` 규칙 표는 바꾸지 않는다.
- [ ] **Step 6:** Codex reviewer(herdr `w2:p5`)에게 브랜치 전체를 리뷰받고 지적을 고친다. `trail note`로 버린 길을 남긴다.

## 찍을 영상 (사용자, 가로 1280×720, 폰을 가로로 고정)

모든 장면: 식탁(TV 장면은 소파 앞 탁자)이 화면 가운데, 컵 안이 보이게 위에서 30~45도로. 컵은 투명 유리컵(`cup-unknown-leave`만 불투명 머그). 사람이 나갈 때는 화면 밖으로 완전히 나간다.

| 영상 | 길이 | 보여야 하는 것 |
|---|---|---|
| `cup-empty-leave.mp4` | 40초 | 0~15초 앉아서 마심, 15~20초 빈 컵을 내려놓고 나감, 20~40초 빈 컵만 |
| `cup-full-leave.mp4` | 40초 | 같은 흐름인데 색 있는 음료가 절반 남음, 20~40초 컵만 |
| `cup-full-return.mp4` | 70초 | 0~35초 위와 같음, 35~45초 돌아와 다 마심, 45~50초 나감, 50~70초 빈 컵만 |
| `cup-unknown-leave.mp4` | 40초 | 불투명 머그를 옆에서 찍어 안이 안 보임, 20~40초 머그만 |
| `meal-empty-cup.mp4` | 40초 | 사람이 그릇·숟가락으로 먹는 중, 옆의 빈 유리컵을 만지지 않음 |
| `tv-empty-cup.mp4` | 40초 | TV 화면이 켜져 보이고 사람이 소파에서 봄, 탁자 위 빈 유리컵 |
| 단계 `go-fridge.mp4` | 10초 | 1인칭으로 냉장고 앞까지 걸어가 멈춤 |
| 단계 `pick-water.mp4`, `pick-cola.mp4` | 10초씩 | 냉장고 문을 열고 병을 꺼내 손에 든 채 5초 |
| 단계 `go-table.mp4`, `go-coffee-table.mp4` | 10초씩 | 1인칭으로 식탁·탁자 앞까지 |
| 단계 `pour-water.mp4`, `pour-cola.mp4` | 15초씩 | 0~8초 빈 컵에 따름, 8~15초 병을 치우고 찬 컵만 |
| 단계(치우기) `pick-cup.mp4`, `go-sink.mp4`, `place-sink.mp4` | 10초씩 | 지금 세로 영상을 가로로 다시 |

## 그 뒤 (이 계획에 넣지 않음)

- 물을 정수기에서 받는 계획(트윈에 정수기 없음).
- 병을 냉장고에 다시 넣었는지 비전으로 확인.
- 2인 가구에서 사람마다 다른 음료.
- 반성기가 물 규칙을 콜라로 바꾸는 과정 보이기(박석준 FSM 마무리 뒤).

## 정해야 할 것 (사용자)

1. **「안 치움」을 어떻게 둘지.** 가: 행동 「컵 그대로 두기」를 목록에 둔다(추천. 말풍선에 까닭과 판단이 보이고 반성 기록에도 남는다). 나: 대기(-1)로 두고 말풍선만 대기 때도 띄운다(사람 없는 빈 방에서도 5초마다 말풍선이 뜬다).
2. **물·콜라를 가르는 사실.** 가: 물은 「먹는 중」, 콜라는 「TV 보는 중」(추천. 둘 다 지금 VLM 낱말에 있다). 나: 하루 때(점심·저녁)로 가른다(영상 모드는 지금 시각을 써서 시연이 시각에 묶인다). 다: 박석준·김준형의 최종 FSM 글을 받아 그대로 넣는다(11-14 뒤).
3. **물이 있는 곳.** 가: 물도 냉장고의 물병(추천. 계획이 콜라와 같은 모양이라 영상 수가 적다). 나: 싱크대에서 받기(싱크대 물 흐름은 VLM이 본다).
4. **채워 주기 승인.** 지금 규칙대로 처음 한 번 「컵에 물 채워 주기를 할까요?」를 묻고 기억한다. 시연 전에 미리 승인해 둘지.
5. **이미 돌린 집의 기억.** 반성 판본이 있는 집에는 새 seed가 들어가지 않는다. 시연 집의 기록 DB를 새로 시작할지.

## Self-Review

- 치우기·그대로 두기·채워 주기 갈래: Task 1(행동), Task 6(FSM), Task 9(흐름), Task 11(실제 영상).
- 갈래가 FSM 기억과 World State 사실에서 나옴: 갈래 표, Task 6. Task 9의 `cupBranchPredict`는 시험 대역이다.
- 규칙으로 계획 만들기 없음: Task 2·7은 검사와 지시문만 바꾼다. `tests/same-structure.test.ts`가 계속 돈다.
- 채워 주기 사람 단계와 끝 조건: Task 3·7.
- 「그대로 두기」 화면: Task 5·8.
- PAM 계약 그대로, 사진 없음: Task 9 넷째 시험.
- 위험: VLM이 「먹는 중」·「TV 보는 중」·컵 내용물을 실제 영상에서 얼마나 맞히는지 재지 않았다. Task 11 Step 3에서 틀리면 영상 각도와 FSM 트리거 글로 맞춘다.
- 위험: `person_holding: "bottle"`은 든 것을 모를 때도 참이라 다른 물건을 들어도 병 집기가 넘어간다.
- 위험: 영상 모드가 가로 영상을 그대로 받는지 이 계획에서 확인하지 않았다(`tests/landscape-frame.test.ts`가 있음). Task 11 Step 2에서 먼저 본다.
