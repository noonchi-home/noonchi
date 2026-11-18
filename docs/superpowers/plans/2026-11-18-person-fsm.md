# 사람 상태 FSM: 상태는 사람이 하는 일, 행동은 화살표에 Implementation Plan

> **쉬운 요약**
> 1. 습관 FSM의 상태(원)를 사람이 하는 일로만 둬요: 먹거나 마시는 중·TV 보는 중·요리하려 함·자리에 없음. 「컵을 두고 자리를 뜸」 같은 사람+물건 상태는 없애요.
> 2. 로봇 행동은 화살표(전이)에 붙여요: 「마시는 중 → (어디로든) / 컵이 남아 있고 아무도 안 만지면 → 컵 치우기」. 물건 조건은 상태가 아니라 화살표 조건이에요.
> 3. PAM 판단 답이 「지금 사람 상태, 일어난 화살표, 그 화살표의 행동」을 함께 내요. 서버·화면은 그대로 써요. 행동에서 규칙을 거꾸로 찾던 일(`fsmNow`)은 없애서 「규칙 여럿」「상태 모름」이 사라져요.
> 4. 「(상태, 트리거) → 행동」은 하나로 정해져요. 같은 상태에서 같은 트리거의 화살표가 둘이면 기억 검사가 거절해요. 「대기」「그대로 두기」는 행동이 아니라 「화살표 없음」이에요.
> 5. 목표 미리 세우기는 지금 상태에서 나가는 화살표의 행동이에요(마시는 중이면 바로 「컵 치우기」). 상태를 World State 「하는 일」과 이어서 목표가 지금처럼 4초쯤에 서요.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 습관 FSM을 「사람 상태 + 조건/행동이 붙은 화살표」(Mealy 꼴)로 바꾸고, PAM 판단이 상태·화살표·행동을 함께 내게 해 서버·화면·목표가 그대로 쓴다.

**Architecture:** 기억 모양과 검사는 `src/brain/decision.ts` 하나에 둔다(상태 `activity` 칸으로 World State 하는 일과 잇는다). PAM 판단 계약을 `pam-predict/3`으로 올려 요청에 직전 상태(`last_state`), 답에 `state`·`from`·`next_index`를 싣고, 행동(`task_index`)은 서버가 화살표에서 만든다. 옛 기억(상태 안 규칙)은 읽을 때 새 모양으로 바꾸고(`upgradeMemory`), seed가 바뀌어 새 판본이 올라간다. 반성은 프롬프트 바꿈(`scenario.json`)으로 하루 흐름에서 상태·화살표·행동을 배운다.

**Tech Stack:** Node 22 TypeScript, zod 4.6.5, Vitest, 가짜 PAM LLM(`tests/helpers/pam.ts`), PAM 골든(`tests/pam-golden.test.ts`), React 대시보드(`ui/`).

**Spec:** 사용자 말(2026-11-18, 조정자 전달) 「FSM을 사람의 상태로만 하면 더 자연스러우려나 예를들어 마시는중에서 다른 상태로 넘어가면(티비보기/방에서 공부하기) 이전에 것을 해결하는 느낌이지」, 영상에서 「트리거 · 규칙 여럿」·「상태 · 모름」·「액션 · 그대로 두기」를 보고 한 말 「트리거에 대해 행동을 하는 게 FSM 아니야?」. 바탕: main 10ef2ec, FSM 카드 계획 `docs/superpowers/plans/2026-11-18-fsm-card.md`(`feat/fsm-card`, 만드는 중).

## 정한 것 (2026-11-18, 사용자·조정자)

1. 상태(원)는 사람이 하는 일만이다. 사람+물건 상태(`left_cup`)는 없앤다.
2. 화살표는 사람이 다른 일로 넘어가는 것이고 「조건 / 로봇 행동」이 붙는다(Mealy). 같은 일을 계속하는 동안의 도움(물 채우기·에어컨)은 자기 자신으로 가는 화살표다.
3. 물건 조건(컵 남음·내용물)은 화살표 조건(`when`)이다.
4. PAM 판단 답이 지금 사람 상태, 일어난 화살표(어느 상태에서 몇 번째), 그 화살표의 행동(없으면 없음)을 낸다. 서버·화면은 그대로 쓰고 거꾸로 찾기(`fsmRuleOf`·`fsmNow`)는 없앤다.
5. 「(상태, 트리거) → 행동」은 하나다: 같은 상태·같은 트리거(`on`) 화살표가 둘이면 기억 검사가 거절한다.
6. 대기·「그대로 두기」 같은 안 하기는 행동이 아니라 「화살표 없음」이다(화살표를 켜지 않음). 화살표 행동에 안 하기 행동(`TaskSpec.plan === false`)은 넣을 수 없다.
7. 목표 미리 세우기: 지금 상태에서 나가는 화살표의 행동이 목표다(마시는 중이면 바로 「컵 치우기」).
8. FSM 카드는 원=사람 상태, 화살표 위=행동을 그대로 그린다. 판단이 낸 화살표만 켠다.

## 새 기억 모양 (`kind: "fsm"`, 2026-11-18 판)

```json
{
  "initial_state": "away",
  "states": [
    {
      "id": "drinking",
      "description": "사용자가 식탁에서 먹거나 마시는 중이다. 들고 있는 컵은 사용 중이라 건드리지 않는다.",
      "activity": ["drinking", "eating"],
      "next": [
        { "to": "*", "on": "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", "when": "컵이 식탁 등에 남아 있고 아무도 컵을 들거나 만지지 않는다.", "action": "컵 치우기" },
        { "to": "drinking", "on": "사용자가 식탁에서 계속 먹는다.", "when": "식탁 위 컵이 비어 있고 사용자가 컵을 들거나 만지지 않는다.", "action": "컵에 물 채워 주기" },
        { "to": "watching_tv", "on": "사용자가 TV를 보기 시작한다." },
        { "to": "cooking", "on": "사용자가 주방으로 가서 요리를 시작하려 한다." }
      ]
    }
  ]
}
```

- 상태: `id`(snake_case), `description`(한 문장), `activity`(World State 사람 하는 일 값 목록, `src/world/vocab.ts` facet `activity`, `other`·`unknown` 빼고. 한 값은 한 상태에만), `next`(화살표).
- 화살표: `to`(상태 id, 또는 `"*"` = 다른 어느 상태로든), `on`(사람이 하는 일이 바뀌거나 이어지는 일, 한 문장), `when`(물건·집 조건, 없어도 된다), `action`(행동 이름, 없으면 상태만 넘어감). `"*"`는 행동이 있을 때만 쓴다.
- 「자리에 없음」은 상태 id `away`(`activity` 빈 목록): 카메라에 사람이 안 보일 때다.

## PAM 판단 답 (`pam-predict/3`, fsm 기억)

```json
{ "observation": "…", "reasoning": "…", "state": "away", "from": "drinking", "next_index": 0 }
```

- `state`: 지금 사람 상태 id. `from`: 이번에 일어난 화살표가 나간 상태 id(화살표 없음이면 `null`). `next_index`: `from` 상태 `next`의 번호(없음 `-1`).
- 서버가 행동을 만든다: 그 화살표 `action`이 지금 행동 목록에 있으면 그 번호, 아니면 `-1`. 판단 기록·계획·화면은 지금처럼 `task_index`를 본다.
- 요청에 `last_state`(직전 판단의 `state`, 처음이면 `null`)를 싣는다.

## Global Constraints

- TDD: 새 시험이 먼저 실패하는 것을 본다. 무거운 일은 `npm run heavy -- <cmd>`로 하나씩.
- 계약(`src/contract/`)을 바꾸면 `npm --prefix ui run build`와 ui 시험도 돌린다(저장소 `CLAUDE.md` 규칙 표).
- 논문 프롬프트 파일(`src/brain/pam/prompts/paper/*.txt`)은 고치지 않는다. 바꿈은 `src/brain/pam/scenarios/noonchi/scenario.json` `prompt_replacements`로만. 바꾸면 `npx vitest run tests/pam-golden.test.ts -u`로 정답을 다시 쓰고 diff를 본다.
- 화면 글은 할 일과 지금 상태만(`npm run lint`), 메시지 상자 줄은 사실로만.
- 규칙으로 행동을 고르지 않는다: 행동은 PAM 답이 고른 화살표에서만 나온다. 서버는 화살표를 실행하거나 상태를 넘기지 않는다(답을 검사하고 그대로 쓴다).
- 구현명세서 SSOT(docs 저장소 `01_Product/구현명세서 SSOT.md`)는 코드와 같이 고친다. 바뀐 내력은 `변경이력.md`에만.
- 커밋은 작업마다 로컬로만. push 하지 않는다.

## 파일 지도

| 파일 | 맡는 일 | 작업 |
|---|---|---|
| `src/brain/decision.ts` | 기억 모양·검사·seed·옛 기억 바꾸기·판단 답 검사 | 1, 2, 3 |
| `src/contract/pam.ts` | `FsmStep`(판단 때 상태·화살표), `Prediction` 칸, 계약 이름 | 3, 4 |
| `src/brain/pam/request.ts`·`client.ts`·`answer.ts`·`prompt.ts` | `pam-predict/3` 요청·답, `last_state` 줄 | 3 |
| `src/brain/pam/scenarios/noonchi/scenario.json` | 판단·반성 프롬프트의 기억 설명·출력 모양 바꿈 | 3, 6 |
| `src/brain/decide.ts` | 답의 상태·화살표를 판단 기록에, 직전 상태 넘기기 | 4 |
| `src/brain/person.ts` (새) | `stateOfWorld`: World State 하는 일 → 상태 | 4 |
| `src/brain/thought.ts`, `src/world/labels.ts` | 허락 문장(화살표에서), 상태 이름 | 4 |
| `src/brain/goal.ts`, `src/act/track/goal.ts` | 목표 = 지금 상태에서 나가는 화살표 행동 | 5 |
| `src/brain/history/habits.ts`·`reflect.ts` | 반성 뒤 검사·배운 화살표 | 2, 6 |
| `scripts/seed-history.ts`·`demo-setup.ts`·`twin3d/fake-run.ts` | 시연 기억·합성 기록 | 7 |
| `src/brain/habit.ts`(FSM 카드 갈래) | 카드 그림 자료를 화살표로 | 8 |
| `docs/reference.md`, `docs/pam-interface.md`, `src/brain/pam/README.md`, SSOT | 문서 | 9 |

---

### Task 1: 새 기억 모양·검사·seed

**Files:**
- Modify: `src/brain/decision.ts` (타입 `FsmMemory`·`validateMemory`·`CUP_FSM_MEMORY`)
- Modify: `src/brain/pam/budget.ts:23` (빈 기억 모양)
- Test: `tests/brain-decision.test.ts`

**Interfaces:**
- Produces:
  - `export const ANY_STATE = "*"; export const AWAY_STATE = "away";`
  - `export interface FsmEdge { to: string; on: string; when?: string; action?: string }`
  - `export interface FsmState { id: string; description: string; activity: string[]; next: FsmEdge[] }`
  - `export interface FsmMemory { initial_state: string; states: FsmState[] }`
  - `validateMemory(value, "fsm"): FsmMemory`(새 모양만), `PERSON_ACTIVITIES: readonly string[]`
  - `CUP_FSM_MEMORY: FsmMemory`(아래 seed)

- [ ] **Step 1: 실패하는 시험 쓰기** (`tests/brain-decision.test.ts` 끝에)

```ts
describe("사람 상태 FSM 기억 검사", () => {
  const base = () => structuredClone(CUP_FSM_MEMORY) as FsmMemory;
  it("seed는 사람 상태만 있고 행동은 화살표에 있다", () => {
    expect(validateMemory(CUP_FSM_MEMORY, "fsm")).toBe(CUP_FSM_MEMORY);
    expect(CUP_FSM_MEMORY.states.map((s) => s.id)).toEqual(["drinking", "watching_tv", "cooking", "away"]);
    expect(CUP_FSM_MEMORY.states.some((s) => "rules" in s)).toBe(false);
    const drink = CUP_FSM_MEMORY.states.find((s) => s.id === "drinking")!;
    expect(drink.next[0]).toMatchObject({ to: "*", action: "컵 치우기" });
  });
  it("같은 상태·같은 트리거(on) 화살표가 둘이면 거절한다(행동이 달라도 같아도)", () => {
    const m = base();
    m.states[0]!.next.push({ ...m.states[0]!.next[0]!, action: "사용자에게 물어보기" });
    expect(() => validateMemory(m, "fsm")).toThrow(/duplicate transition trigger/);
  });
  it("안 하기 행동(그대로 두기)은 화살표 행동이 될 수 없다", () => {
    const m = base();
    m.states[0]!.next[0]!.action = "컵 그대로 두기";
    expect(() => validateMemory(m, "fsm")).toThrow(/not an action/);
  });
  it("행동 없는 \"*\" 화살표, 없는 상태로 가는 화살표, 모르는 하는 일 값, 두 상태가 같은 하는 일 값을 거절한다", () => {
    const any = base(); any.states[0]!.next.push({ to: "*", on: "사용자가 일어난다." });
    expect(() => validateMemory(any, "fsm")).toThrow(/needs an action/);
    const to = base(); to.states[0]!.next.push({ to: "nap", on: "사용자가 잔다." });
    expect(() => validateMemory(to, "fsm")).toThrow(/unknown state identifier 'nap'/);
    const act = base(); act.states[0]!.activity.push("flying");
    expect(() => validateMemory(act, "fsm")).toThrow(/unknown activity 'flying'/);
    const two = base(); two.states[1]!.activity.push("drinking");
    expect(() => validateMemory(two, "fsm")).toThrow(/activity 'drinking' is in two states/);
  });
  it("옛 모양(상태 안 rules)은 새 모양 검사로는 거절한다(읽을 때는 upgradeMemory)", () => {
    const old = { initial_state: "s", states: [{ id: "s", description: "d", rules: [], next: [] }] };
    expect(() => validateMemory(old, "fsm")).toThrow(/incorrect fields/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/brain-decision.test.ts`
Expected: FAIL (`activity`·`to: "*"`가 없고 옛 모양이 통과)

- [ ] **Step 3: 구현** (`src/brain/decision.ts`의 `FsmMemory`·`validateMemory`·`CUP_FSM_MEMORY`를 바꾼다)

```ts
import { STATES } from "../world/vocab.js";
import { TASKS } from "../act/tasks.js";

export const ANY_STATE = "*";
export const AWAY_STATE = "away";
/** 상태 activity에 쓸 수 있는 World State 사람 하는 일 값(모름·다른 일 빼고). */
export const PERSON_ACTIVITIES: readonly string[] = Object.entries(STATES)
  .filter(([k, s]) => s.facet === "activity" && k !== "other" && k !== "unknown").map(([k]) => k);

export interface FsmEdge { to: string; on: string; when?: string; action?: string }
export interface FsmState { id: string; description: string; activity: string[]; next: FsmEdge[] }
export interface FsmMemory { initial_state: string; states: FsmState[] }

/** 칸이 정확히 required(+ optional 가운데 몇)인 객체. */
function objectWith(value: Json, required: string[], optional: string[], path: string): Record<string, Json> {
  const proto = value && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value) || (proto !== Object.prototype && proto !== null)) throw new ContractError(`${path}: expected an object`);
  const actual = Object.keys(value);
  const missing = required.filter((f) => !actual.includes(f)).sort(byCodePoint);
  const extra = actual.filter((k) => !required.includes(k) && !optional.includes(k)).map(pyRepr).sort(byCodePoint);
  if (missing.length || extra.length) throw new ContractError(`${path}: incorrect fields (missing=${pyList(missing)}, extra=${pyList(extra)})`);
  return value as Record<string, Json>;
}

function validateFsm(value: Json): FsmMemory {
  const m = object(value, ["initial_state", "states"], "memory");
  const initial = text(m.initial_state, "memory.initial_state");
  const states = array(m.states, "memory.states");
  if (!states.length) throw new ContractError("memory.states: at least one state is required");
  const ids = new Set<string>();
  const owner = new Map<string, string>();
  const destinations: [string, string][] = [];
  states.forEach((state, i) => {
    const p = `memory.states[${i}]`;
    const s = object(state, ["id", "description", "activity", "next"], p);
    const id = text(s.id, `${p}.id`);
    if (id === ANY_STATE) throw new ContractError(`${p}.id: '*' is reserved`);
    if (ids.has(id)) throw new ContractError(`${p}.id: duplicate state identifier ${pyRepr(id)}`);
    ids.add(id);
    text(s.description, `${p}.description`);
    array(s.activity, `${p}.activity`).forEach((a, j) => {
      const v = text(a, `${p}.activity[${j}]`);
      if (!PERSON_ACTIVITIES.includes(v)) throw new ContractError(`${p}.activity[${j}]: unknown activity ${pyRepr(v)}`);
      if (owner.has(v)) throw new ContractError(`${p}.activity[${j}]: activity ${pyRepr(v)} is in two states`);
      owner.set(v, id);
    });
    const ons = new Set<string>();
    array(s.next, `${p}.next`).forEach((e, j) => {
      const ep = `${p}.next[${j}]`;
      const edge = objectWith(e, ["to", "on"], ["when", "action"], ep);
      const to = text(edge.to, `${ep}.to`);
      const on = text(edge.on, `${ep}.on`);
      if (ons.has(on)) throw new ContractError(`${ep}.on: duplicate transition trigger ${pyRepr(on)} in state ${pyRepr(id)}`);
      ons.add(on);
      if ("when" in edge) text(edge.when, `${ep}.when`);
      const action = "action" in edge ? text(edge.action, `${ep}.action`) : null;
      if (action !== null && TASKS[action]?.plan === false) throw new ContractError(`${ep}.action: ${pyRepr(action)} is not an action (use no transition)`);
      if (to === ANY_STATE && action === null) throw new ContractError(`${ep}.to: '*' needs an action`);
      if (to !== ANY_STATE) destinations.push([`${ep}.to`, to]);
    });
  });
  if (!ids.has(initial)) throw new ContractError("memory.initial_state: must name an existing state");
  for (const [path, to] of destinations) if (!ids.has(to)) throw new ContractError(`${path}: unknown state identifier ${pyRepr(to)}`);
  return m as unknown as FsmMemory;
}
```

`validateMemory(value, kind)`의 fsm 갈래는 `return validateFsm(value)`로 바꾼다. 행동 이름이 행동 목록에 있는지는 보지 않는다(코치·눈치 목록이 판단마다 달라 판단 답 검사가 본다, Task 3).

seed(`CUP_FSM_MEMORY`)는 「새 기억 모양」 절의 `drinking`에 아래 셋을 더한 것이다(행동·조건 글은 지금 seed 규칙 글을 그대로 옮긴다):

```ts
{ id: "watching_tv", description: "사용자가 TV를 보며 컵으로 음료를 마신다.", activity: ["watching_tv"], next: [
  { to: "watching_tv", on: "사용자가 TV를 계속 본다.", when: "곁의 컵이 비어 있고 사용자가 컵을 들거나 만지지 않는다.", action: "컵에 콜라 따라 주기" },
  // 의도 파악(2026-11-13): 바라는 것을 돌려 말한 혼잣말(「아 덥다」)이나 부채질
  { to: "watching_tv", on: "사용자가 덥다고 말하거나 더워서 부채질을 한다.", action: "에어컨 켜기" },
  { to: "*", on: "사용자가 TV 보기를 끝내고 다른 일로 넘어간다.", when: "컵이 거실 테이블 등에 남아 있고 아무도 컵을 들거나 만지지 않는다.", action: "컵 치우기" },
  { to: "drinking", on: "사용자가 식탁에 앉아 먹기 시작한다." },
  { to: "cooking", on: "사용자가 주방으로 가서 요리를 시작하려 한다." },
] },
// 코치(2026-11-13): 코치 모드에서만 이 화살표의 행동이 행동 목록에 있다(src/act/tasks.ts tasksFor)
{ id: "cooking", description: "사용자가 주방에서 음식을 만들거나 데우려 한다. 방법을 묻거나 무엇을 할지 몰라 멈춰 있으면 단계마다 알려 준다.", activity: ["cooking"], next: [
  { to: "cooking", on: "사용자가 라면 끓이는 법을 알려 달라고 말했거나, 주방에서 라면을 끓이려다 무엇을 해야 할지 모르겠다고 말한다.", action: "라면 끓이기 알려 주기" },
  { to: "cooking", on: "사용자가 전자레인지 앞에서 쓰는 법을 묻거나 이거 어떻게 하냐고 말한다.", action: "전자레인지로 데우기 알려 주기" },
  { to: "drinking", on: "사용자가 음식을 들고 식탁에 앉는다." },
] },
{ id: "away", description: "사용자가 카메라에 보이지 않는다.", activity: [], next: [
  { to: "drinking", on: "사용자가 돌아와 식탁에 앉아 먹거나 마신다." },
  { to: "watching_tv", on: "사용자가 돌아와 TV를 본다." },
  { to: "cooking", on: "사용자가 주방으로 간다." },
] },
```

`initial_state`는 `"away"`. `budget.ts:23`의 빈 기억은 `{ initial_state: "s", states: [{ id: "s", description: "d", activity: [], next: [] }] }`.

- [ ] **Step 4: 통과 확인**

Run: `npm run heavy -- npx vitest run tests/brain-decision.test.ts`
Expected: PASS(옛 seed를 쓰던 다른 시험은 Task 2~7에서 고친다. 이 작업 커밋 전에 `npx tsc --noEmit -p .`의 오류 목록을 작업 노트에 남긴다)

- [ ] **Step 5: 커밋**

```bash
git add src/brain/decision.ts src/brain/pam/budget.ts tests/brain-decision.test.ts
git commit -m "feat(brain): person-state FSM memory with Mealy transitions and its check"
```

---

### Task 2: 옛 기억 읽기와 seed 판본 바꿈

**Files:**
- Modify: `src/brain/decision.ts` (`upgradeMemory`, `readMemory`, `SEED_PATCHES`·`patchMemory` 지움)
- Modify: `src/brain/history/reflect.ts` (`readDayMemory`·`dayMemory`·`memoryForDay`가 `readMemory`로 읽는다)
- Modify: `src/brain/pam/answer.ts` (`parseMemory`는 새 모양만)
- Create: `scripts/old-fsm-seed.ts` (main 10ef2ec `CUP_FSM_MEMORY` 글 그대로, `OLD_CUP_FSM_MEMORY: OldFsmMemory`. 시험과 합성 기록이 같이 쓴다)
- Test: `tests/brain-decision.test.ts`, `tests/history-reflect.test.ts`

**Interfaces:**
- Consumes: Task 1의 `FsmMemory`·`validateMemory`·`CUP_FSM_MEMORY`.
- Produces:
  - `export const OBJECT_STATES: Readonly<Record<string, string>> = { left_cup: "away" }` — 없애는 사람+물건 상태와 대신 갈 사람 상태.
  - `upgradeMemory(old: OldFsmMemory): FsmMemory`
  - `readMemory(value: unknown, kind: "list" | "fsm"): PamMemory` — 옛 fsm 모양이면 바꾸고 새 모양으로 검사한다.

옛 모양 바꾸기(기계적, 배운 습관을 잃지 않는다):
1. `OBJECT_STATES`에 있는 상태(S)는 없앤다. S로 가던 화살표(P → S, `on`)마다 S의 규칙 하나씩 P → 대신 상태 화살표를 만든다(`on` 그대로, `when` = 규칙 트리거, `action` = 규칙 행동). 규칙이 없으면 화살표만 대신 상태로 돌린다.
2. 남는 상태의 규칙은 자기 자신으로 가는 화살표가 된다(`on` = 규칙 트리거, `action` = 규칙 행동, `when` 없음).
3. 없앤 상태(S)에서 나가던 화살표는 대신 상태에서 나가는 화살표가 된다(도착이 대신 상태 자신이면 버린다, 도착이 없앤 상태면 그 대신 상태로).
4. `activity`는 seed에 같은 id 상태가 있으면 그 값, 없으면 빈 목록. 대신 상태(`away`)가 없으면 seed의 `away`를 더한다.
5. 같은 상태 안 `on`이 겹치면 뒤의 것을 버린다(트리거 하나에 행동 하나). 안 하기 행동(`컵 그대로 두기`) 규칙은 버린다.

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
// tests/brain-decision.test.ts
describe("옛 기억 읽기", () => {
  const OLD = {
    initial_state: "drinking",
    states: [
      { id: "drinking", description: "먹는 중", rules: [{ trigger: "컵이 빈다.", action: "컵에 물 채워 주기" }], next: [{ to: "left_cup", on: "컵을 두고 떠난다." }] },
      { id: "left_cup", description: "컵을 두고 떠남", rules: [{ trigger: "컵을 두고 자리를 비웠다.", action: "컵 치우기" }, { trigger: "컵에 음료가 남았다.", action: "컵 그대로 두기" }], next: [{ to: "drinking", on: "돌아온다." }] },
      { id: "morning_coffee", description: "아침 커피", rules: [], next: [{ to: "left_cup", on: "컵을 두고 일어난다." }] },
    ],
  };
  it("사람+물건 상태의 규칙은 그 상태로 가던 화살표에 붙고, 남는 상태의 규칙은 자기 화살표가 된다", () => {
    const m = upgradeMemory(OLD);
    expect(validateMemory(m, "fsm")).toBe(m);
    expect(m.states.map((s) => s.id)).toEqual(["drinking", "morning_coffee", "away"]);
    const drink = m.states.find((s) => s.id === "drinking")!;
    expect(drink.activity).toEqual(["drinking", "eating"]);
    expect(drink.next).toEqual([
      { to: "drinking", on: "컵이 빈다.", action: "컵에 물 채워 주기" },
      { to: "away", on: "컵을 두고 떠난다.", when: "컵을 두고 자리를 비웠다.", action: "컵 치우기" },
    ]);
    expect(m.states.find((s) => s.id === "morning_coffee")!.next).toEqual([{ to: "away", on: "컵을 두고 일어난다.", when: "컵을 두고 자리를 비웠다.", action: "컵 치우기" }]);
  });
  it("readMemory는 옛 fsm은 바꾸고 새 fsm·list는 그대로 검사한다", () => {
    expect(readMemory(OLD, "fsm")).toEqual(upgradeMemory(OLD));
    expect(readMemory(CUP_FSM_MEMORY, "fsm")).toBe(CUP_FSM_MEMORY);
    expect(readMemory(CUP_MEMORY, "list")).toBe(CUP_MEMORY);
  });
});
```

```ts
// tests/history-reflect.test.ts
it("옛 모양 seed 판본이 있는 DB는 새 seed 판본을 올리고, 옛 반성 판본은 읽을 때 새 모양으로 바꿔 쓴다", () => {
  const db = HistoryDb.open(":memory:");
  const oldSeed = db.saveMemory({ kind: "fsm", memory: OLD_SEED, day: null, appliesDay: null, source: "seed" });
  const m = memoryForDay(db, "2026-11-19");
  expect(m.version).toBeGreaterThan(oldSeed);
  expect(m.memory).toEqual(CUP_FSM_MEMORY);
  const learned = db.saveMemory({ kind: "fsm", memory: OLD_LEARNED, day: "2026-11-19", appliesDay: "2026-11-20", source: "reflection" });
  const next = memoryForDay(db, "2026-11-20");
  expect(next.version).toBe(learned);
  expect(next.memory).toEqual(upgradeMemory(OLD_LEARNED));
});
```

`OLD_SEED`는 main 10ef2ec의 `CUP_FSM_MEMORY`를 그대로 붙인 시험 자료(`scripts/old-fsm-seed.ts`의 `OLD_CUP_FSM_MEMORY`)이고, `OLD_LEARNED`는 그 seed의 `left_cup`에 규칙 하나를 더한 것이다.

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/brain-decision.test.ts tests/history-reflect.test.ts`
Expected: FAIL (`upgradeMemory`·`readMemory` 없음)

- [ ] **Step 3: 구현**

```ts
// src/brain/decision.ts
export interface OldFsmMemory {
  initial_state: string;
  states: { id: string; description: string; rules: { trigger: string; action: string }[]; next: { to: string; on: string }[] }[];
}
export const OBJECT_STATES: Readonly<Record<string, string>> = { left_cup: AWAY_STATE };

const isOldFsm = (v: unknown): v is OldFsmMemory =>
  !!v && typeof v === "object" && Array.isArray((v as { states?: unknown }).states) && (v as OldFsmMemory).states.some((s) => s && typeof s === "object" && "rules" in s);

export function upgradeMemory(old: OldFsmMemory): FsmMemory {
  const gone = (id: string) => id in OBJECT_STATES;
  const seed = (id: string) => CUP_FSM_MEMORY.states.find((s) => s.id === id);
  const keep = (a: string) => TASKS[a]?.plan !== false;
  const states: FsmState[] = old.states.filter((s) => !gone(s.id)).map((s) => {
    const next: FsmEdge[] = s.rules.filter((r) => keep(r.action)).map((r) => ({ to: s.id, on: r.trigger, action: r.action }));
    for (const n of s.next) {
      if (!gone(n.to)) { next.push({ to: n.to, on: n.on }); continue; }
      const into = OBJECT_STATES[n.to]!;
      const rules = old.states.find((x) => x.id === n.to)?.rules.filter((r) => keep(r.action)) ?? [];
      if (!rules.length) next.push({ to: into, on: n.on });
      // 같은 on에 행동은 하나: 첫 규칙만 그 on을 쓰고, 나머지는 「on (트리거)」로 가른다
      rules.forEach((r, i) => next.push({ to: into, on: i === 0 ? n.on : `${n.on} (${r.trigger})`, when: r.trigger, action: r.action }));
    }
    const seen = new Set<string>();
    return { id: s.id, description: s.description, activity: [...(seed(s.id)?.activity ?? [])], next: next.filter((e) => !seen.has(e.on) && !!seen.add(e.on)) };
  });
  for (const id of new Set(Object.values(OBJECT_STATES))) {
    if (states.some((s) => s.id === id)) continue;
    const s = seed(id)!;
    states.push({ ...s, activity: [...s.activity], next: s.next.filter((e) => states.some((x) => x.id === e.to)).map((e) => ({ ...e })) });
  }
  // 없앤 상태에서 나가던 화살표(돌아옴·외출·밤)는 대신 상태에서 나간다
  for (const o of old.states.filter((x) => gone(x.id))) {
    const into = states.find((x) => x.id === OBJECT_STATES[o.id])!;
    for (const n of o.next) {
      const to = gone(n.to) ? OBJECT_STATES[n.to]! : n.to;
      if (to !== into.id && !into.next.some((e) => e.on === n.on)) into.next.push({ to, on: n.on });
    }
  }
  // 두 상태가 같은 하는 일을 가지면 앞 상태만 둔다
  const owned = new Set<string>();
  for (const s of states) s.activity = s.activity.filter((a) => !owned.has(a) && !!owned.add(a));
  const initial = gone(old.initial_state) ? OBJECT_STATES[old.initial_state]! : old.initial_state;
  return validateFsm({ initial_state: initial, states });
}

/** 기록 DB·요청에서 읽은 기억: 옛 fsm 모양이면 새 모양으로 바꿔 검사한다. */
export function readMemory(value: unknown, kind: "list" | "fsm"): PamMemory {
  return kind === "fsm" && isOldFsm(value) ? upgradeMemory(value) : validateMemory(value, kind);
}
```

`SEED_PATCHES`·`patchMemory`와 `reflect.ts`의 seed 바뀜 넣기(`markSeedPatch` 쓰는 곳)를 지운다. 옛 바뀜(`2026-11-16-clear-habit`)은 `upgradeMemory`가 「그대로 두기」 규칙을 버리므로 같은 일을 한다. `reflect.ts`에서 DB 기억을 `validateMemory(m.memory, m.kind)`로 읽던 곳(`readDayMemory`, `dayMemory`, 반성 판본 읽기 68행)을 모두 `readMemory(m.memory, m.kind)`로 바꾼다. seed 비교(`JSON.stringify(m.memory) !== seed`)는 그대로라 옛 seed 판본이 가장 새 판본이면 새 seed 판본이 올라간다.

- [ ] **Step 4: 통과 확인**

Run: `npm run heavy -- npx vitest run tests/brain-decision.test.ts tests/history-reflect.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/brain/decision.ts src/brain/history/reflect.ts src/brain/pam/answer.ts tests/brain-decision.test.ts tests/history-reflect.test.ts scripts/old-fsm-seed.ts
git commit -m "feat(brain): read old FSM memories as person-state memories and raise the new seed version"
```

---

### Task 3: PAM 판단 계약 `pam-predict/3`

**Files:**
- Modify: `src/contract/pam.ts` (`PamPredictContract = "pam-predict/3"`, 요청 `last_state`, `Prediction` 칸)
- Modify: `src/brain/pam/request.ts` (`last_state`), `src/brain/pam/client.ts` (`PAM_PREDICT`), `src/brain/pam/prompt.ts` (`PREDICT_STATE` 줄), `src/brain/pam/answer.ts` (`parsePrediction(raw, tasks, memory)`)
- Modify: `src/brain/decision.ts` (`validateFsmPrediction`)
- Modify: `src/brain/pam/scenarios/noonchi/scenario.json` (판단 프롬프트 바꿈 셋)
- Modify: `tests/helpers/pam.ts` (가짜 PAM LLM이 새 답을 낸다)
- Test: `tests/pam-answer.test.ts`, `tests/pam-request.test.ts`, `tests/pam-golden.test.ts`(정답 다시 쓰기), `tests/pam-prompts.test.ts`

**Interfaces:**
- Consumes: Task 1 `FsmMemory`·`ANY_STATE`.
- Produces:
  - `interface Prediction { observation: string; reasoning: string; task_index: number; state?: string; from?: string | null; next_index?: number }` — fsm 기억이면 `state`·`from`·`next_index`가 늘 있고 `task_index`는 서버가 만든 값이다.
  - `validateFsmPrediction(value: unknown, memory: FsmMemory, tasks: string[]): Prediction`
  - `PredictRequest.last_state: string | null`
  - `PREDICT_STATE = "Person state at the previous decision: "`

- [ ] **Step 1: 실패하는 시험 쓰기** (`tests/pam-answer.test.ts`)

```ts
describe("사람 상태 FSM 판단 답", () => {
  const tasks = ["컵 치우기", "사용자에게 물어보기", "컵에 물 채워 주기"];
  const ok = (o: object) => JSON.stringify({ observation: "o", reasoning: "r", ...o });
  it("화살표의 행동을 서버가 task_index로 만든다(답에 task_index 칸이 없다)", () => {
    const p = parsePrediction(ok({ state: "away", from: "drinking", next_index: 0 }), tasks, CUP_FSM_MEMORY);
    expect(p).toMatchObject({ status: "valid", selected_action: "컵 치우기", prediction: { task_index: 0, state: "away", from: "drinking", next_index: 0 } });
  });
  it("화살표 없음(-1, from null)은 대기다", () => {
    expect(parsePrediction(ok({ state: "drinking", from: null, next_index: -1 }), tasks, CUP_FSM_MEMORY)).toMatchObject({ status: "valid", selected_action: null, prediction: { task_index: -1 } });
  });
  it("화살표 행동이 지금 행동 목록에 없으면(코치 행동을 눈치 모드에서) 화살표는 남기고 행동은 대기다", () => {
    const p = parsePrediction(ok({ state: "cooking", from: "cooking", next_index: 0 }), tasks, CUP_FSM_MEMORY);
    expect(p).toMatchObject({ status: "valid", selected_action: null, prediction: { task_index: -1, from: "cooking", next_index: 0 } });
  });
  it("없는 상태, 넘는 번호, 도착 상태가 화살표와 다름, \"*\" 화살표인데 같은 상태, task_index 칸이 있으면 invalid다", () => {
    for (const bad of [
      { state: "nap", from: null, next_index: -1 },
      { state: "away", from: "drinking", next_index: 9 },
      { state: "cooking", from: "drinking", next_index: 2 },
      { state: "drinking", from: "drinking", next_index: 0 },
      { state: "away", from: "drinking", next_index: 0, task_index: 0 },
    ]) expect(parsePrediction(ok(bad), tasks, CUP_FSM_MEMORY).status).toBe("invalid");
  });
});
```

(`drinking.next[2]`는 `watching_tv`로 가는 화살표다.)

`tests/pam-request.test.ts`: `contract: "pam-predict/3"`와 `last_state`(문자열·null)는 받고, `"pam-predict/2"`·`last_state` 없음은 거절한다. 판단 메시지 사용자 글 첫 칸 앞에 `PREDICT_STATE + (last_state ?? "unknown")` 줄이 들어간다.

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/pam-answer.test.ts tests/pam-request.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// src/brain/decision.ts
export function validateFsmPrediction(value: Json, memory: FsmMemory, tasks: string[]): Prediction {
  validateTasks(tasks);
  const p = object(value, ["observation", "reasoning", "state", "from", "next_index"], "prediction");
  text(p.observation, "prediction.observation");
  text(p.reasoning, "prediction.reasoning");
  const state = text(p.state, "prediction.state");
  const byId = (id: string) => memory.states.find((s) => s.id === id);
  if (!byId(state)) throw new ContractError(`prediction.state: unknown state identifier ${pyRepr(state)}`);
  const index = p.next_index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < -1) throw new ContractError("prediction.next_index: expected an integer from -1");
  if (index === -1) {
    if (p.from !== null) throw new ContractError("prediction.from: expected null when next_index is -1");
    return { observation: p.observation as string, reasoning: p.reasoning as string, task_index: -1, state, from: null, next_index: -1 };
  }
  const from = byId(text(p.from, "prediction.from"));
  if (!from) throw new ContractError(`prediction.from: unknown state identifier ${pyRepr(p.from)}`);
  const edge = from.next[index];
  if (!edge) throw new ContractError(`prediction.next_index: state ${pyRepr(from.id)} has ${from.next.length} transitions`);
  if (edge.to === ANY_STATE ? state === from.id : edge.to !== state) throw new ContractError(`prediction.state: transition ${from.id}[${index}] goes to ${pyRepr(edge.to)}`);
  const task = edge.action ? tasks.indexOf(edge.action) : -1;
  return { observation: p.observation as string, reasoning: p.reasoning as string, task_index: task, state, from: from.id, next_index: index };
}
```

```ts
// src/brain/pam/answer.ts
export function parsePrediction(raw: string, tasks: string[], memory?: PamMemory): ParsedPrediction {
  // ...지금과 같고 검사만:
  const prediction = memory && "states" in memory ? validateFsmPrediction(readPyJson(raw), memory, tasks) : validatePrediction(readPyJson(raw), tasks);
}
```

`client.ts`의 판단은 요청의 `memory_kind === "fsm"`이면 `parsePrediction(raw, tasks, memory)`. `request.ts` `PredictSchema`: `contract: z.literal("pam-predict/3")`, `last_state: z.string().min(1).nullable()`. `prompt.ts`: `buildPredictMessages`의 사용자 글을 `[PREDICT_STATE + (r.last_state ?? "unknown"), PREDICT_TIME + r.final_time, PREDICT_LOG + r.observation_text]`로.

`scenario.json` `prompt_replacements`에 더할 것(`old`는 `predictor_fsm.txt` 원문 그대로, 줄바꿈 포함):

1. `old`: "- The memory is structured as a hybrid finite-state machine: each state captures a\nphase of the user's routine, inside each state a small list of production rules\ndescribes how the robot should help while the user is in that phase, and event-\ndriven transitions describe how the routine progresses between phases. Each rule's\ntrigger is a single short natural-language statement describing the visible event/\nmoment that causes the rule to fire."
   `new`: "- The memory is a finite-state machine of the PERSON's activities. Each state is one thing the person is doing (its `activity` lists the matching person activity values of the observation log; `away` means the person is not visible). Each transition in a state's `next` is (to, on, when, action): when the person does `on` (moves to another activity, or keeps the same one for a self-transition) and `when` holds, the robot does `action`. `to: \"*\"` means moving to any other state. A transition without `action` only records the routine.\n- Robot actions exist only on transitions. Doing nothing (waiting, leaving an object as it is) is not an action: it is no transition."
   `reason`: "사람 상태 FSM(2026-11-18 사용자 결정)"
2. `old`: "- Use the memory holistically as structured context –- you do not need to commit to\na single state; rather, use the state descriptions, per-state rules, and transitions\n together to judge whether any rule from the memory fires for the current scene."
   `new`: "- First decide the person's current state from the latest observations (use the previous state given in the input). Then decide whether exactly one transition of the previous state happened now: its `on` happened and its `when` holds in the latest observations. If none happened, answer no transition."
3. 출력 모양: `old`는 「## Output Schema」 아래 JSON 블록 전체, `new`:
   "{\n  \"observation\": \"<single concise sentence describing the relevant current scene state>\",\n  \"reasoning\":   \"<single concise sentence naming the current state and the transition that happened, if any>\",\n  \"state\":       \"<current state id>\",\n  \"from\":        \"<state id the transition left, or null when no transition>\",\n  \"next_index\":  <integer: index in that state's next list, or -1 for no transition>\n}"
   그리고 「## Output Requirements」의 `task_index` 줄을 `state`·`from`·`next_index` 설명으로 바꾼다.

`tests/helpers/pam.ts`의 `Pred`에 `state`·`from`·`next_index`를 더하고 fsm 요청이면 `task_index` 대신 그 셋을 낸다(가짜 답 `pick(action, …)`은 seed에서 그 행동의 화살표를 찾아 `from`·`next_index`를 채운다. 시험 도우미만 찾는다).

- [ ] **Step 4: 정답 다시 쓰기와 통과 확인**

Run: `npm run heavy -- npx vitest run tests/pam-golden.test.ts -u` 뒤 `git diff tests/fixtures/pam-golden`(기억 JSON·바꾼 문장·출력 모양만 바뀌었는지 본다), `npm run heavy -- npx vitest run tests/pam-answer.test.ts tests/pam-request.test.ts tests/pam-prompts.test.ts tests/pam-golden.test.ts tests/pam-budget.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/contract/pam.ts src/brain/decision.ts src/brain/pam tests/helpers/pam.ts tests/pam-*.test.ts tests/fixtures/pam-golden
git commit -m "feat(pam): pam-predict/3 answers the person state and the transition; the server derives the action"
```

---

### Task 4: 판단이 답의 상태·화살표를 그대로 쓴다

**Files:**
- Create: `src/brain/person.ts` (`stateOfWorld`)
- Modify: `src/brain/decide.ts` (거꾸로 찾기 지움, `last_state` 넘김, 판단 기록 `fsm`)
- Modify: `src/brain/decision.ts` (`fsmRuleOf`·`fsmNow` 지움, `edgeLearned`)
- Modify: `src/contract/pam.ts` (`FsmAt`·`FsmRuleAt` → `FsmStep`), `src/contract/events.ts:137-139,338`
- Modify: `src/brain/thought.ts:27-32`, `src/world/labels.ts:10` (`FSM_STATE_TEXT`), `ui/src/dashboard/data.ts:150-170`, `ui/src/dashboard/words.ts`
- Modify: `scripts/twin3d/fake-run.ts:117,177`
- Test: `tests/world-decide.test.ts`, `tests/brain-thought.test.ts`, `tests/brain-person.test.ts`(새), `ui/tests/dashboard/data.test.ts`

**Interfaces:**
- Consumes: Task 3 `Prediction.state/from/next_index`.
- Produces:
  - `export interface FsmStep { state: string; from: string | null; next_index: number; to: string | null; on: string | null; when: string | null; action: string | null; learned: boolean }` — 판단 기록 `fsm`. 화살표 없음이면 `next_index` -1, `from`·`to`·`on`·`when`·`action`이 null.
  - `edgeLearned(from: string, edge: FsmEdge): boolean` — seed에 같은 `from`·`on`·`action` 화살표가 없으면 true.
  - `fsmStep(memory: FsmMemory, p: Prediction): FsmStep` — PAM 답 → 판단 기록 `fsm`.
  - `stateOfWorld(memory: FsmMemory, world: Pick<WorldView, "person">): string | null` — 사람이 안 보이면 `away`(기억에 있으면), 보이면 이번 등장 뒤 하는 일 사실이 `activity`에 든 상태, 없으면 null.
  - `Decider.fsmState(): string | null` — 마지막 유효 판단의 `state`(판단 전 null).

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
// tests/world-decide.test.ts (이 파일의 emptyWorld·event·memory 도우미를 쓴다)
it("PAM 답의 상태·화살표를 판단 기록 fsm에 그대로 싣고, 다음 요청에 직전 상태를 보낸다(거꾸로 찾지 않는다)", async () => {
  const answers = [
    { observation: "o", reasoning: "r", state: "away", from: "drinking", next_index: 0 },
    { observation: "o", reasoning: "r", state: "away", from: null, next_index: -1 },
  ];
  pam = await startFakePamLlm({ predict: () => answers.shift()! });
  const records: DecisionRecord[] = [];
  const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory, emit: () => {}, onDecision: (r) => records.push(r), offsetMinutes: 540, clock: { now: () => 10_000 } });
  for (let i = 0; i < 2; i++) {
    d.onChanges([{ kind: "person_gone", at_ms: 9000 + i, subject: "person", text: "사람 안 보임", meaningful: true }]);
    d.tick();
    await d.idle();
  }
  expect(records.map((r) => [r.action, r.fsm])).toEqual([
    ["컵 치우기", { state: "away", from: "drinking", next_index: 0, to: "*", on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", when: "컵이 식탁 등에 남아 있고 아무도 컵을 들거나 만지지 않는다.", action: "컵 치우기", learned: false }],
    [null, { state: "away", from: null, next_index: -1, to: null, on: null, when: null, action: null, learned: false }],
  ]);
  expect((pam.bodies as { last_state: string | null }[]).map((b) => b.last_state)).toEqual([null, "away"]);
  expect(d.fsmState()).toBe("away");
});
```

(가짜 PAM LLM `startFakePamLlm({ predict })`의 답 모양 `Pred`는 Task 3에서 새 칸을 받는다. `pam.bodies`는 받은 요청 본문이다.)

```ts
// tests/brain-person.test.ts
describe("World State 하는 일 → 사람 상태", () => {
  const person = (o: Partial<WorldPerson>): Pick<WorldView, "person"> => ({ person: { visible: true, since_ms: 0, last_seen_ms: 1, count: 1, position: null, position_ms: null, room: null, room_label: null, near: [], holding: [], facts: {}, answered_ms: null, ...o } });
  const act = (v: string, at = 5) => ({ activity: { value: v, at_ms: at, since_ms: at, certainty: "confirmed" as const } });
  it("마시는 중이면 drinking, TV 보는 중이면 watching_tv, 안 보이면 away, 이번 등장 전 사실·모르는 일은 null", () => {
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ facts: act("drinking") }))).toBe("drinking");
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ facts: act("watching_tv") }))).toBe("watching_tv");
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ visible: false }))).toBe("away");
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ since_ms: 10, facts: act("drinking", 5) }))).toBeNull();
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ facts: act("reading") }))).toBeNull();
  });
});
```

```ts
// tests/brain-thought.test.ts (이 파일의 decision(id, action, fsm) 도우미. rule 도우미는 아래 step으로 바꾼다)
const step = (o: Partial<FsmStep> = {}): FsmStep => ({ state: "away", from: null, next_index: -1, to: null, on: null, when: null, action: null, learned: false, ...o });
it("허락 문장은 판단이 낸 화살표에서 만든다: seed 화살표는 RULE_IF, 배운 화살표는 on·when을 줄이지 않고, 화살표 없음은 줄이 없다", () => {
  const leave = CUP_FSM_MEMORY.states[0]!.next[0]!;
  expect(decisionLines(decision("pam-1", "컵 치우기", step({ from: "drinking", next_index: 0, to: "*", on: leave.on, when: leave.when!, action: "컵 치우기" })))).toEqual(["컵을 두고 자리를 뜨면 치워도 된다고 하셨어요"]);
  expect(decisionLines(decision("pam-2", "사용자에게 물어보기", step({ from: "drinking", next_index: 4, to: "away", on: "사용자가 그릇을 두고 나간다.", when: "그릇이 식탁에 남는다.", action: "사용자에게 물어보기", learned: true })))[0]).toMatch(/^사용자가 그릇을 두고 나간다. 그릇이 식탁에 남는다면 /);
  expect(decisionLines(decision("pam-3", null, step({ state: "drinking" })))).toEqual([]);
});
```

(허락 문장 정답 「컵을 두고 자리를 뜨면 치워도 된다고 하셨어요」는 지금 `TASK_SAY`·`RULE_IF` 그대로다. 저장소 규칙 표의 「허락 문장은 사용자가 정한 짧은 꼴」을 지킨다.)

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/world-decide.test.ts tests/brain-person.test.ts tests/brain-thought.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// src/brain/person.ts
// 사람 상태 FSM의 지금 상태를 World State로 본다(판단과 판단 사이, 목표 세우기가 쓴다). 판단 때 상태는 PAM 답(state)이 정한다.
import type { WorldView } from "../contract/world.js";
import { AWAY_STATE, type FsmMemory } from "./decision.js";

export function stateOfWorld(memory: FsmMemory, world: Pick<WorldView, "person">): string | null {
  const p = world.person;
  if (!p.visible) return memory.states.some((s) => s.id === AWAY_STATE) ? AWAY_STATE : null;
  const f = p.facts.activity;
  if (!f || f.at_ms < (p.since_ms ?? Number.NEGATIVE_INFINITY)) return null;
  return memory.states.find((s) => s.activity.includes(f.value))?.id ?? null;
}
```

```ts
// src/brain/decide.ts (판단 받은 뒤)
const step = mem.kind === "fsm" && "states" in mem.memory ? fsmStep(mem.memory, p) : null;
if (step) this.lastState = step.state;
this.finish({ ...base, status: "valid", prediction, action, fsm: step, ...(usage ? { usage } : {}) });

// 보낼 때
this.o.pam.predict({ final_time: finalTime, observation_text: textSent, memory_kind: mem.kind, memory: mem.memory, tasks, last_state: this.lastState }, …);
```

```ts
// src/brain/decision.ts
export function edgeLearned(from: string, edge: FsmEdge): boolean {
  return !CUP_FSM_MEMORY.states.find((s) => s.id === from)?.next.some((e) => e.on === edge.on && e.action === edge.action);
}
/** PAM 답 → 판단 기록 fsm(답을 그대로, 화살표는 기억에서 그 번호). */
export function fsmStep(memory: FsmMemory, p: Prediction): FsmStep {
  const edge = p.from ? memory.states.find((s) => s.id === p.from)?.next[p.next_index ?? -1] ?? null : null;
  return {
    state: p.state!, from: edge ? p.from! : null, next_index: edge ? p.next_index! : -1, to: edge?.to ?? null, on: edge?.on ?? null, when: edge?.when ?? null, action: edge?.action ?? null,
    learned: edge ? edgeLearned(p.from!, edge) : false,
  };
}
```

`lastState`의 타입은 `string | null`(처음 null). `fsmNow`·`fsmRuleOf`·`FsmAt`·`FsmRuleAt`을 지운다(`npx tsc`가 남은 곳을 알려 준다: `src/act/track/goal.ts`는 Task 5).

`thought.ts` `decisionLines`:

```ts
export function decisionLines(e: Decision): string[] {
  const f = e.status === "valid" ? e.fsm : null;
  if (!e.action || !f?.on || f.action !== e.action) return [];
  return [`${ruleIf({ trigger: f.when ? `${f.on} ${f.when}` : f.on, action: e.action, learned: f.learned })} ${TASK_SAY[e.action]?.may ?? `${josa(e.action, "을/를")} 해도`} 된다고 하셨어요`];
}
```

`FSM_STATE_TEXT`: `{ drinking: "먹거나 마시는 중", watching_tv: "TV 보는 중", cooking: "주방에서 할 일을 찾음", away: "자리에 없음" }`(`left_cup` 지움). 화면 알약(`ui/src/dashboard/data.ts` `talkOf`, FSM 카드가 먼저 들어왔으면 그 카드 자료): 상태 = `FSM_STATE_TEXT[f.state] ?? f.state`, 트리거 = `f.on ?? WORDS.noTransition`(「화살표 없음」), 액션 = `f.action ?? WORDS.idle`. `WORDS.manyRules`·`noRule`·`unknown`(상태 모름)은 지운다. `events.ts`의 판단 기록 `fsm` 타입은 `FsmStep | null`.

- [ ] **Step 4: 통과 확인**

Run: `npm run heavy -- npx tsc --noEmit -p .`, `npm run heavy -- npx vitest run tests/world-decide.test.ts tests/brain-person.test.ts tests/brain-thought.test.ts tests/brain-pam.test.ts`, `npm run heavy -- npm --prefix ui run build`, `npm run heavy -- npm --prefix ui test`, `npm run heavy -- npm run lint`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/brain src/contract src/world/labels.ts ui/src/dashboard scripts/twin3d/fake-run.ts tests/world-decide.test.ts tests/brain-person.test.ts tests/brain-thought.test.ts ui/tests/dashboard
git commit -m "feat(brain): decisions keep the PAM state and transition as given; drop the reverse rule lookup"
```

---

### Task 5: 목표 = 지금 상태에서 나가는 화살표의 행동

**Files:**
- Modify: `src/brain/goal.ts` (`goalAhead`)
- Modify: `src/act/track/goal.ts:60-115` (지금 상태, 메시지 상자 줄, 목표 기록 `fsm`)
- Modify: `src/act/track/tracker.ts:118-120` (`habit`에 World State 상태)
- Modify: `src/server/home/act.ts` (`habit: () => …`)
- Test: `tests/brain-goal.test.ts`, `tests/act-goal.test.ts`

**Interfaces:**
- Consumes: Task 4 `stateOfWorld`, `Decider.fsmState()`, Task 1 `FsmMemory`.
- Produces:
  - `interface GoalPick { state: string; index: number; to: string; on: string; when: string | null; action: string }`
  - `goalAhead(i: { memory: PamMemory; kind: "list" | "fsm"; state: string | null; tasks: readonly string[]; cls: string }): GoalPick | null` — `state`는 지금 상태(World State 하는 일로 정한 것이 먼저, 없으면 마지막 판단 상태). null이면 세우지 않는다.

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
// tests/brain-goal.test.ts
describe("goalAhead (사람 상태 FSM)", () => {
  const tasks = tasksFor("noonchi");
  it("마시는 중이면 그 상태에서 나가는 화살표의 손대는 다 쓴 뒤 행동(컵 치우기)을 고른다", () => {
    expect(goalAhead({ memory: CUP_FSM_MEMORY, kind: "fsm", state: "drinking", tasks, cls: "cup" })).toEqual({
      state: "drinking", index: 0, to: "*", on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", when: "컵이 식탁 등에 남아 있고 아무도 컵을 들거나 만지지 않는다.", action: "컵 치우기",
    });
  });
  it("TV 보는 중에서도 컵 치우기를 고른다(옛 FSM은 처음 상태가 아니면 못 골랐다)", () => {
    expect(goalAhead({ memory: CUP_FSM_MEMORY, kind: "fsm", state: "watching_tv", tasks, cls: "cup" })?.action).toBe("컵 치우기");
  });
  it("상태를 모르면, 자기 화살표(물 채우기)뿐이면, 다른 종류면 세우지 않는다", () => {
    expect(goalAhead({ memory: CUP_FSM_MEMORY, kind: "fsm", state: null, tasks, cls: "cup" })).toBeNull();
    expect(goalAhead({ memory: CUP_FSM_MEMORY, kind: "fsm", state: "cooking", tasks, cls: "cup" })).toBeNull();
    expect(goalAhead({ memory: CUP_FSM_MEMORY, kind: "fsm", state: "drinking", tasks, cls: "bowl" })).toBeNull();
  });
});
```

`tests/act-goal.test.ts`의 `goalSetup` `habit`은 `{ memory: CUP_FSM_MEMORY, kind: "fsm", state: o.state === undefined ? "drinking" : o.state, version: 1 }` 그대로 두고, 「처음 상태가 drinking이 아니어도 사람이 마시는 중이면(World State) 세운다」 시험을 더한다(`state: null`이고 사람 사실 `drinking` → 세움).

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/brain-goal.test.ts tests/act-goal.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// src/brain/goal.ts
export interface GoalPick { state: string; index: number; to: string; on: string; when: string | null; action: string }

export function goalAhead(i: { memory: PamMemory; kind: "list" | "fsm"; state: string | null; tasks: readonly string[]; cls: string }): GoalPick | null {
  if (i.kind !== "fsm" || !("states" in i.memory) || i.state === null) return null;
  const here = i.memory.states.find((s) => s.id === i.state);
  if (!here) return null;
  const fits = (action: string | undefined): action is string => !!action && i.tasks.includes(action) && taskOf(action)?.afterUse === true && touchTarget(action) === i.cls;
  // 그 상태를 떠나는 화살표만(자기 자신으로 가는 화살표는 쓰는 중의 도움이라 목표가 아니다)
  const hits = here.next.map((e, index) => ({ e, index })).filter(({ e }) => e.to !== here.id && fits(e.action));
  if (new Set(hits.map(({ e }) => e.action)).size !== 1) return null;
  const { e, index } = hits[0]!;
  return { state: here.id, index, to: e.to, on: e.on, when: e.when ?? null, action: e.action! };
}
```

`src/act/track/goal.ts`:
- `arm()`의 상태: `const state = stateOfWorld(habit.memory, world) ?? habit.state`(`habit.state`는 `Decider.fsmState()`).
- 메시지 상자 줄: `ruleIf({ trigger: pick.when ? \`${pick.on} ${pick.when}\` : pick.on, action: pick.action, learned: edgeLearned(pick.state, { to: pick.to, on: pick.on, action: pick.action }) })`.
- 목표 기록(`record`)의 `fsm`: `{ state: g.view.state, from: g.view.state, next_index: g.pick.index, to: g.pick.to, on: g.pick.on, when: g.pick.when, action: g.view.action, learned }`(`GoalPick.index`는 그 상태 `next`의 번호).
- `PendingGoal.trigger`에는 `pick.on`, 계획 입력 `PlanAhead.on`에는 `pick.when ?? pick.on`.

- [ ] **Step 4: 통과 확인**

Run: `npm run heavy -- npx vitest run tests/brain-goal.test.ts tests/act-goal.test.ts tests/goal-e2e.test.ts tests/goal-server.test.ts`
Expected: PASS(goal-e2e는 사람 사라짐 → 첫 명령 1초 안 그대로)

- [ ] **Step 5: 커밋**

```bash
git add src/brain/goal.ts src/act/track/goal.ts src/act/track/tracker.ts src/server/home/act.ts tests/brain-goal.test.ts tests/act-goal.test.ts
git commit -m "feat(goal): arm the goal from the transitions leaving the current person state"
```

---

### Task 6: 반성이 하루 흐름에서 상태·화살표·행동을 배운다

**Files:**
- Modify: `src/brain/pam/scenarios/noonchi/scenario.json` (반성 프롬프트 바꿈)
- Modify: `src/brain/history/habits.ts` (규칙 줄 → 화살표 줄)
- Modify: `src/brain/history/reflect.ts:160-200`, `src/contract/events.ts:153`(반성 기록 `learned`·`active`·`dropped`), `ui/src/dashboard/data.ts:58-70`, `src/server/home/index.ts:153`, `scripts/demo-setup.ts:56,194`
- Test: `tests/history-habits.test.ts`, `tests/history-reflect.test.ts`, `tests/pam-golden.test.ts`(`r-fsm` 정답), `ui/tests/dashboard/data.test.ts`

**Interfaces:**
- Consumes: Task 1 `FsmMemory`·`FsmEdge`.
- Produces:
  - `interface EdgeLine { from: string; to: string; on: string; when: string | null; action: string }`(행동 있는 화살표 한 줄)
  - `learnedEdges(previous: FsmMemory, proposed: FsmMemory): EdgeLine[]`
  - `coachGuard(seed: FsmMemory, proposed: FsmMemory): HabitOutput` — 코치 행동 화살표는 seed 그대로.
  - `HabitInput`·`HabitOutput`·`HabitFilter`는 이름 그대로, 기억은 새 모양. `HabitRuleNote`는 `{ from; to; on; action; kept; reason; seen?; fired?; p?; conditions? }`.

반성 프롬프트(`reflector_fsm_update.txt`) 바꿈(`old`는 원문 그대로):
1. 「# Inputs」의 "- Current memory: the FSM (states, per-state (trigger, action) entries, and\ntransitions) that was applied today" → "- Current memory: the person-state FSM (states with activities, and transitions with when/action) that was applied today".
2. 「# Memory Structure」 절 전체(“The memory is structured as a HYBRID FINITE-STATE MACHINE.”부터 “- Exactly one state is the `initial_state`.”까지) → 아래 글:
   "The memory is a FINITE-STATE MACHINE of the PERSON's activities.\n- Read today's observations as a flow of what the person did (drinking at the table, watching TV, cooking, away, …). Each STATE is one such activity, not a situation of objects (no state like 'cup left behind'). `activity` lists the matching person activity values of the observation log; one value belongs to one state. `away` is the person not visible.\n- A TRANSITION in a state's `next` is (to, on, when, action): `on` is the person's change of activity (or keeping it, for a self-transition), `when` is the object or home condition, `action` is the one task the robot does then. `to: \"*\"` is moving to any other state and needs an action. In the instructions below, a RULE means a transition with an action, and its trigger is `on` plus `when`.\n- In one state, two transitions never share the same `on`: one trigger has one action. Doing nothing (waiting, leaving an object as it is) is not an action: leave the transition out.\n- Exactly one state is the `initial_state`."
3. 「# Output」 JSON 블록 → 새 모양(「새 기억 모양」 절과 같은 칸, 값은 `<snake_case>`·`<one-sentence>`·`[<activity value>, ...]`·`[{"to": "<state_id or *>", "on": "<NL event>", "when": "<NL condition, optional>", "action": "<task name, optional>"}]`).
4. "- Ensure `initial_state` names one of the states, and every `next.to` references an\nexisting state id." → 끝에 " or \"*\""를 더한다.

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
// tests/history-habits.test.ts
describe("반성 뒤 검사(화살표)", () => {
  it("배운 화살표는 행동 있는 화살표 가운데 전에 없던 것이다", () => {
    const proposed = structuredClone(CUP_FSM_MEMORY);
    proposed.states[0]!.next.push({ to: "away", on: "사용자가 그릇을 두고 나간다.", when: "그릇이 식탁에 남는다.", action: "사용자에게 물어보기" });
    expect(learnedEdges(CUP_FSM_MEMORY, proposed)).toEqual([{ from: "drinking", to: "away", on: "사용자가 그릇을 두고 나간다.", when: "그릇이 식탁에 남는다.", action: "사용자에게 물어보기" }]);
  });
  it("코치 행동 화살표는 seed 그대로 지킨다(바뀐 것은 빼고 seed 것을 되돌린다)", () => {
    const proposed = structuredClone(CUP_FSM_MEMORY);
    const cook = proposed.states.find((s) => s.id === "cooking")!;
    cook.next[0] = { ...cook.next[0]!, on: "라면 얘기를 한다." };
    const out = coachGuard(CUP_FSM_MEMORY, proposed);
    expect(out.memory.states.find((s) => s.id === "cooking")!.next.filter((e) => e.action === "라면 끓이기 알려 주기")).toEqual([CUP_FSM_MEMORY.states.find((s) => s.id === "cooking")!.next[0]]);
    expect(out.notes).toContainEqual(expect.objectContaining({ from: "cooking", on: "라면 얘기를 한다.", kept: false, reason: "coach" }));
  });
});
```

`tests/history-reflect.test.ts`: 가짜 PAM 반성 답이 새 모양 기억(마시는 중 → `*` 화살표 더함)을 내면 판본이 저장되고 반성 기록 `learned`가 `EdgeLine[]`이다. 옛 모양을 내면 실패로 남는다(「incorrect fields」).

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/history-habits.test.ts tests/history-reflect.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// src/brain/history/habits.ts
export interface EdgeLine { from: string; to: string; on: string; when: string | null; action: string }
const keyOf = (e: EdgeLine) => JSON.stringify([e.from, e.to, e.on, e.when, e.action]);
const linesOf = (m: FsmMemory): EdgeLine[] => m.states.flatMap((s) => s.next.filter((e) => e.action).map((e) => ({ from: s.id, to: e.to, on: e.on, when: e.when ?? null, action: e.action! })));

export function learnedEdges(previous: FsmMemory, proposed: FsmMemory): EdgeLine[] {
  const had = new Set(linesOf(previous).map(keyOf));
  return linesOf(proposed).filter((e) => !had.has(keyOf(e)));
}

export function coachGuard(seed: FsmMemory, proposed: FsmMemory): HabitOutput {
  const seedCoach = linesOf(seed).filter((e) => isCoach(e.action));
  const notes: HabitRuleNote[] = [];
  const states = proposed.states.map((s) => ({
    ...s, activity: [...s.activity],
    next: s.next.filter((e) => {
      if (!e.action || !isCoach(e.action)) return true;
      const same = seedCoach.some((c) => c.from === s.id && c.on === e.on && c.action === e.action && c.to === e.to);
      notes.push({ from: s.id, to: e.to, on: e.on, action: e.action, kept: same, reason: same ? "unchanged" : "coach" });
      return false;
    }),
  }));
  for (const c of seedCoach) {
    const edge: FsmEdge = { to: c.to, on: c.on, ...(c.when ? { when: c.when } : {}), action: c.action };
    const here = states.find((s) => s.id === c.from);
    if (here) {
      // 같은 on이 이미 있으면(반성이 그 on에 다른 행동을 둠) 그것을 seed 것으로 바꾼다: 트리거 하나에 행동 하나
      here.next = [...here.next.filter((e) => e.on !== c.on), edge];
      continue;
    }
    const from = seed.states.find((s) => s.id === c.from)!;
    const ids = new Set(states.map((s) => s.id));
    const owned = new Set(states.flatMap((s) => s.activity));
    states.push({ id: from.id, description: from.description, activity: from.activity.filter((a) => !owned.has(a)), next: [edge, ...from.next.filter((e) => !e.action && ids.has(e.to))] });
  }
  return { memory: { initial_state: proposed.initial_state, states }, notes };
}
```

`keepAll`은 `learnedEdges`로 같은 일을 한다. `reflect.ts`는 `learnedRules` → `learnedEdges`, `RuleLine` → `EdgeLine`. 화면 반성 줄(`ui/src/dashboard/data.ts` `reflectionThoughts`)은 `sentence(rule.when ?? rule.on)`. `scripts/demo-setup.ts` `rulesLine`은 `${x.from} → ${x.to}: ${x.on} → ${x.action}`.

- [ ] **Step 4: 정답 다시 쓰기와 통과 확인**

Run: `npm run heavy -- npx vitest run tests/pam-golden.test.ts -u`(반성 메시지 정답), `npm run heavy -- npx vitest run tests/history-habits.test.ts tests/history-reflect.test.ts tests/pam-golden.test.ts tests/pam-prompts.test.ts`, `npm run heavy -- npm --prefix ui run build`, `npm run heavy -- npm --prefix ui test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/brain/pam/scenarios/noonchi/scenario.json src/brain/history src/contract/events.ts src/server/home/index.ts ui/src/dashboard scripts/demo-setup.ts tests/history-*.test.ts tests/fixtures/pam-golden ui/tests/dashboard
git commit -m "feat(reflect): learn person states and transitions with actions from the day's flow"
```

---

### Task 7: 시연 기억 데이터·기록 정답·e2e

**Files:**
- Modify: `scripts/seed-history.ts:403-450` (합성 일주일 기억을 새 모양으로, 판단 기록의 reasoning 글)
- Modify: `scripts/demo-setup.ts:40,277-284` (`SEED_RULES` → 화살표)
- Modify: `scripts/twin3d/fake-run.ts` (판단 `fsm`)
- Test: `tests/seed-history.test.ts`, `tests/demo-e2e.test.ts`, `tests/history-api.test.ts`, `tests/fixtures/history-golden/*`(정답 다시 쓰기), `tests/goal-e2e.test.ts`

**Interfaces:**
- Consumes: Task 1~6 전부.
- Produces: 시연 DB의 기억 판본이 새 모양이다(옛 DB는 Task 2의 `readMemory`로 읽힌다).

합성 일주일(seed-history) 기억 바꾸기:
- `PAST_LEFT_CUP`(비면 치우기·남으면 두기·안 보이면 묻기)은 `drinking → away` 화살표 셋으로: 「비면 치우기」(`action: 컵 치우기`), 「안 보이면 묻기」(`action: 사용자에게 물어보기`). 「남으면 두기」는 안 하기라 화살표를 두지 않는다(같은 `on`은 하나이므로 `on` 글을 「사용자가 빈 컵을 두고 떠난다.」·「사용자가 안이 안 보이는 컵을 두고 떠난다.」로 가른다).
- `morning_coffee`(`activity: ["drinking"]`이면 `drinking`과 겹치므로 `drinking`의 `activity`를 `["eating"]`으로, `morning_coffee`는 `["drinking"]`), `away`, `night`(`activity: ["resting"]`)은 사람 상태 그대로. 에어컨 습관은 `watching_tv` 자기 화살표.
- 판단 reasoning 글의 「left_cup 규칙대로」는 「마시는 중에서 떠난 화살표대로」로.

- [ ] **Step 1: 실패하는 시험 쓰기** (`tests/seed-history.test.ts`)

```ts
it("합성 일주일의 기억 판본은 모두 새 모양이고 사람+물건 상태가 없다", () => {
  const db = seedWeek();
  for (const v of db.memoryVersions()) {
    const m = validateMemory(v.memory, "fsm") as FsmMemory;
    expect(m.states.some((s) => s.id === "left_cup")).toBe(false);
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/seed-history.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현** — 합성 기억은 지금처럼 옛 모양으로 쌓고 마지막에 Task 2의 `upgradeMemory`로 바꾼다(같은 바꾸기 규칙 하나만 둔다):

```ts
// scripts/seed-history.ts
import { OLD_CUP_FSM_MEMORY } from "./old-fsm-seed.js";   // Task 2의 옛 seed 자료(main 10ef2ec CUP_FSM_MEMORY)
import { upgradeMemory, type FsmMemory, type OldFsmMemory } from "../src/brain/decision.js";

/** 습관 전 seed(옛 모양): 옛 seed에서 left_cup 규칙만 그때 규칙으로. */
const PAST_OLD: OldFsmMemory = {
  ...OLD_CUP_FSM_MEMORY,
  states: OLD_CUP_FSM_MEMORY.states.map((s) => (s.id === "left_cup" ? { ...s, rules: PAST_LEFT_CUP.map((r) => ({ ...r })) } : s)),
};
export const PAST_SEED: FsmMemory = upgradeMemory(PAST_OLD);

export function memoryAfter(i: number, h: Pick<HomeInfo, "table" | "side" | "livingAc">, habit = false): FsmMemory {
  const m = structuredClone(PAST_OLD);
  // …(지금 몸 그대로: left_cup 설명·next, night·morning_coffee·away 상태, 에어컨 습관 규칙)
  return upgradeMemory(m);
}
```

옛 seed 자료 `scripts/old-fsm-seed.ts`는 `export const OLD_CUP_FSM_MEMORY: OldFsmMemory = { … }`(main 10ef2ec `CUP_FSM_MEMORY` 글 그대로)이고 Task 2 시험도 이것을 쓴다(json 대신 ts). 「남으면 그대로 두기」 규칙은 `upgradeMemory`가 버리고, 「비면 치우기」·「안 보이면 묻기」는 같은 `on`(「사용자가 컵을 두고 자리를 떠나 보이지 않는다.」)이라 앞의 「비면 치우기」만 그 `on`을 쓰고 「안 보이면 묻기」는 `on (트리거)`로 갈린다. 판단 reasoning 글의 「left_cup 규칙대로」는 「마시는 중에서 떠나는 화살표대로」로 바꾼다. `scripts/demo-setup.ts`의 `SEED_RULES`는 `CUP_FSM_MEMORY.states.flatMap((s) => s.next.filter((e) => e.action).map((e) => ({ trigger: e.on, action: e.action! })))`.

- [ ] **Step 4: 기록 정답·e2e**

Run: `npm run heavy -- npx vitest run tests/demo-e2e.test.ts -u` 뒤 `git diff tests/fixtures`(판단 `fsm` 칸과 반성 `learned` 모양만 바뀌고 메시지 상자 허락 문장·행동 줄은 그대로인지 본다), `npm run heavy -- npx vitest run tests/seed-history.test.ts tests/demo-e2e.test.ts tests/history-api.test.ts tests/goal-e2e.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add scripts/seed-history.ts scripts/demo-setup.ts scripts/twin3d/fake-run.ts tests/seed-history.test.ts tests/demo-e2e.test.ts tests/fixtures
git commit -m "chore(demo): demo memories and history goldens in the person-state FSM"
```

---

### Task 8: FSM 카드 맞춤 (`feat/fsm-card`가 main에 들어간 뒤)

**Files:**
- Modify: `src/contract/habit.ts`(`HabitFsm`), `src/brain/habit.ts`(`habitView`), `ui/src/dashboard/fsm.ts`(`fsmViewOf`), `ui/src/dashboard/FsmCard.tsx`
- Test: `tests/brain-habit.test.ts`, `ui/tests/dashboard/fsm.test.ts`

**Interfaces:**
- Consumes: Task 4 `FsmStep`(판단 기록 `fsm`), Task 1 `FsmMemory`.
- Produces: `interface HabitFsm { version: number; initial: string; states: { id: string; name: string; learned: boolean }[]; next: { from: string; to: string; on: string; when: string | null; action: string | null; learned: boolean }[] }` — 카드 계획의 `rules`를 없애고 `next`에 행동을 싣는다.

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
// tests/brain-habit.test.ts
it("그림 자료는 사람 상태와 행동 붙은 화살표다(규칙 칸이 없다)", () => {
  const h = habitView(CUP_FSM_MEMORY, 3);
  expect(h).not.toHaveProperty("rules");
  expect(h.states.map((s) => s.name)).toEqual(["먹거나 마시는 중", "TV 보는 중", "주방에서 할 일을 찾음", "자리에 없음"]);
  expect(h.next).toContainEqual({ from: "drinking", to: "*", on: "컵을 두고 자리를 뜨면", when: "컵이 식탁 등에 남아 있고 아무도 컵을 들거나 만지지 않는다", action: "컵 치우기", learned: false });
});
```

```ts
// ui/tests/dashboard/fsm.test.ts
it("판단이 낸 화살표만 켜고(from·on 같은 선), 화살표 없음이면 아무 선도 켜지 않는다", () => {
  expect(fsmViewOf(dash({ fsm: { state: "away", from: "drinking", next_index: 0, to: "*", on: ON, when: null, action: "컵 치우기", learned: false } }))!.lines.filter((l) => l.lit)).toHaveLength(1);
  expect(fsmViewOf(dash({ fsm: { state: "drinking", from: null, next_index: -1, to: null, on: null, when: null, action: null, learned: false } }))!.lines.some((l) => l.lit)).toBe(false);
});
```

- [ ] **Step 2: 실패 확인** — `npm run heavy -- npx vitest run tests/brain-habit.test.ts`, `npm run heavy -- npm --prefix ui test`. Expected: FAIL
- [ ] **Step 3: 구현**

```ts
// src/brain/habit.ts (카드 갈래의 habitView를 바꾼다)
const plain = (t: string) => t.trim().replace(/[.。]+$/, "");
export function habitView(memory: FsmMemory, version: number): HabitFsm {
  const seedIds = new Set(CUP_FSM_MEMORY.states.map((s) => s.id));
  return {
    version, initial: memory.initial_state,
    states: memory.states.map((s) => ({ id: s.id, name: FSM_STATE_TEXT[s.id] ?? plain(s.description.split(/[.。]/)[0]!), learned: !seedIds.has(s.id) })),
    next: memory.states.flatMap((s) => s.next.map((e) => {
      const learned = e.action ? edgeLearned(s.id, e) : false;
      const on = e.action ? ruleIf({ trigger: e.on, action: e.action, learned }) : NEXT_ON[e.on] ?? plain(e.on);
      return { from: s.id, to: e.to, on, when: e.when ? plain(e.when) : null, action: e.action ?? null, learned };
    })),
  };
}
```

화면 `fsmViewOf`(카드 갈래 `ui/src/dashboard/fsm.ts`)는 `rules` 대신 `next`를 읽는다: 지금 상태 원은 판단 `fsm.state`, 켠 선은 `from === fsm.from && 원래 on 순서 === fsm 화살표` 하나(서버가 `HabitFsm.next`를 기억 차례 그대로 싣고, 판단 `fsm`의 `from`·`next_index`로 `next`에서 그 상태의 `next_index`번째를 찾는다). `"*"` 화살표는 그 상태에서 나가는 짧은 선(도착 원 없음), 위에 행동 글.
- [ ] **Step 4: 통과 확인** — `npm run heavy -- npx tsc --noEmit -p .`, 위 두 시험, `npm run heavy -- npm --prefix ui run build`, `npm run heavy -- npm run lint`. Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(dashboard): FSM card draws person states and action transitions, lighting the decided one"`

---

### Task 9: 문서·SSOT

**Files:**
- Modify: `docs/reference.md`(판단·목표·반성 줄), `docs/pam-interface.md`(`pam-predict/3`·`pam-reflect/3`, 「박석준과 맞출 것」), `src/brain/pam/README.md`(표의 기억 모양 줄)
- Modify (docs 저장소): `01_Product/구현명세서 SSOT.md` 5.9 Rule·5.10 Decision·6.3 PAM 판단·미리 세운 목표·6.12 PAM, `변경이력.md`

- [ ] **Step 1:** 이 저장소 문서 셋을 위 「새 기억 모양」·「PAM 판단 답」 절 그대로 고친다(판단 답 칸, 서버가 행동을 만든다, 거꾸로 찾기 없음, 안 하기는 화살표 없음, 옛 기억 읽기).
- [ ] **Step 2:** SSOT: 5.9 Rule을 「화살표(상태·트리거·조건 → 행동)」로, 5.10 Decision에 `state`·`from`·`next_index`·`fsm`(FsmStep), 6.3 PAM 판단 출력과 seed FSM 설명, 미리 세운 목표 문단(지금 상태에서 나가는 화살표), 6.12 계약 이름. 판을 1.27에서 1.28로 올리고 `변경이력.md`에 한 줄.
- [ ] **Step 3:** `npm run heavy -- npm run lint`, 전체 시험 `npm run heavy -- npx vitest run`(부하 실패는 따로 다시).
- [ ] **Step 4: 커밋** — 이 저장소 `git commit -m "docs: person-state FSM memory, pam-predict/3 and goals"`, docs 저장소 `git commit -m "docs: 구현명세서 SSOT 1.28 (사람 상태 FSM), 변경이력"`.

---

## 속도 영향 (2026-11-18 d1 세 판 기준)

| 무엇 | 지금 | 사람 상태 FSM | 까닭 |
|---|---|---|---|
| 목표가 서는 때 | 4.2~4.5초(쓰는 중 지킴 + 처음 상태가 마침 `drinking`) | 4.2~4.5초 그대로 | 상태를 World State 하는 일(마시는 중)로 바로 정한다. PAM 답만 기다리면 첫 판단(7.3·7.5·12.1초)까지 3~8초 늦다 |
| 처음 상태가 다를 때 목표 | 못 세움(직전 맞은 규칙이 `watching_tv`면 한 걸음 앞에 컵 치우기 없음) | 세움 | 상태마다 나가는 화살표를 본다 |
| PAM 판단 한 번 | 1.6~2.4초 | 약 +0.05초 안 | 기억 JSON 3,267 → 약 3,700바이트(+14%), 판단 입력 약 16.3 → 17.5KB(+7%, 바뀐 문장 포함). 출력은 `state`·`from`·`next_index` 약 15토큰 늘고 `task_index`는 빠진다 |
| 사람 떠남 → 첫 명령 | 3.1·1.9·1.6초 | 같음 | PAM 확인 한 번 + 미리 만든 계획 그대로 |
| 화면 알약 | 「규칙 여럿」·「상태 모름」이 뜸 | 늘 상태 하나, 켠 화살표 하나 또는 「화살표 없음」 | 거꾸로 찾기를 없앤다 |
| 반성 한 번 | 하루 한 번 | 출력 약 +14% | 화살표가 행동을 안는다 |

## 팀 영향: 석준이가 PAM을 맡으면 바뀌는 곳

1. 기억 모양: `src/brain/decision.ts` `FsmMemory`·`validateMemory`(상태 안 `rules` 없음, `activity`, 화살표 `when`·`action`, `"*"`, 같은 상태 같은 `on` 거절, 안 하기 행동 거절). 옛 모양은 `upgradeMemory`로만 읽는다.
2. 판단 계약 `pam-predict/3`: 요청 `last_state`, 답 `state`·`from`·`next_index`(`task_index` 칸 없음, 서버가 만든다). 답 검사 `validateFsmPrediction`.
3. 반성 계약 `pam-reflect/3`: 같은 기억 모양을 낸다. 바꿈 글은 `src/brain/pam/scenarios/noonchi/scenario.json`에만 있다(논문 프롬프트 파일은 그대로).
4. 습관 거르기 자리 `HabitFilter`(`src/brain/history/habits.ts`): 입력·출력 기억이 새 모양, 결과 줄이 `EdgeLine`·`HabitRuleNote`(`from`·`to`·`on`). 30일 기록으로 화살표를 셀 때 판단 기록 `fsm`(`from`·`on`)을 그대로 쓰면 된다.
5. ai 저장소(Python PAM, `pam/contracts.py`·`messages.py`·`tests/test_contracts.py`): 이 저장소 판단은 TypeScript지만, ai 저장소 시험·vLLM 학습 자료가 옛 모양이면 같은 검사·답 모양으로 맞춘다.
6. vLLM PAM 모델(`INFERENCE_MODE=vllm`): 답에 `state`·`from`·`next_index`를 내도록 학습 자료·평가를 바꾼다.
7. `docs/pam-interface.md` 「박석준과 맞출 것」에 위 1~6을 줄로 더한다.

## 사용자에게 물을 것

1. 상태 목록: seed는 「먹거나 마시는 중·TV 보는 중·요리하려 함·자리에 없음」 넷이에요. 「방에서 공부 중」「자는 중」을 지금 넣을까요, 반성이 배우게 둘까요?
2. 「자리에 없음」: 카메라에 안 보이면 다른 방에 있어도 「자리에 없음」으로 볼까요, 「모름」을 따로 둘까요?
3. 옛 기억: 배운 습관을 새 모양으로 바꿔 이어 쓸까요(계획 기본), 새 seed로 다시 시작할까요?
4. 「컵 그대로 두기」: 화살표 행동이 될 수 없으니 행동 목록에서 뺄까요(PAM 목록에서만 빼고 계획 전 검사 쓰임은 남김)?
5. 상태를 World State 「하는 일」과 바로 이을까요(`activity` 칸, 목표가 지금처럼 4초쯤 섬)? 안 이으면 첫 PAM 판단까지 3~8초 늦어요.
6. PAM은 기억 화살표에 있는 행동만 고를 수 있어요. 기억에 없는 일은 말 부탁(말 에이전트) 길로만 돼요. 괜찮을까요?
