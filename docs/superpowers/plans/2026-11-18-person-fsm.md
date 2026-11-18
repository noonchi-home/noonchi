# 사람 활동 FSM과 네 기계 나누기 Implementation Plan

> **쉬운 요약**
> 1. 기계를 넷으로 나눠요: **사람 활동 FSM**(배움), **목표 기계**(세움 → 미리 만드는 중 → 준비됨 → 시작 → 끝/버림), **로봇 실행 기계**(대기·관찰·이동·실행·복귀·막힘 복구), **안전 기계**(평소 → 의심 → 비상). 위에서 **관리자**가 「안전 > 말로 한 부탁 > 목표 > 대기」로 무엇을 할지 정하고 눈치·코치 모드도 정해요.
> 2. 실제 폰 명령은 로봇 실행 기계 하나만 내요. 계획 단계(가기·집기·넣기)는 「실행」 안의 하위 단계예요.
> 3. 안전 「의심」(쓰러짐 의심)이면 로봇이 그 사람 쪽으로 가서 실제 폰으로 「괜찮으세요?」를 소리로 묻고 들어요(두 번 × 8초). 「괜찮아」류 말이면 평소로, 말 답이 없거나 도움 말이면 비상으로 올려요. 대답은 말로만 받아요. 보호자 전화는 `feat/fall-call` 계획대로 나중이에요.
> 4. 사람 활동 FSM의 상태는 사람이 하는 일 하나예요(먹거나 마시는 중·TV 보는 중·요리하는 중·자리에 없음으로 시작). 행동은 화살표에만 붙어요. 물건·집 조건(컵 남음·아무도 안 만짐·내용물)은 FSM에 없고 그 행동의 실행 전 검사가 봐요.
> 5. PAM 판단 답이 「지금 상태, 일어난 화살표, 그 행동」을 함께 내요. 서버·화면은 그대로 쓰고 거꾸로 찾기(`fsmNow`)는 없애요. 「대기」「그대로 두기」는 화살표 없음이에요.
> 6. 반성이 낸 기억은 코드 검사(모양) → LLM 검사(뜻)를 지나야 써요. 거절이면 까닭을 돌려줘 한 번 다시 반성하고, 그래도 거절이면 전날 기억을 그대로 써요.
> 7. 옛 기억은 옮기지 않아요(합성 기록에서 나온 것). 합성 일주일을 새 모양으로 다시 쌓고, 옛 모양 기억을 읽으면 새 seed로 다시 시작해요.
> 8. 한 번에 다 바꾸지 않아요. 묶음 A(사람 활동 FSM) → B(상태 토픽 그림자) → C(안전) → D(로봇 실행) → E(목표·관리자) → F(노드 나누기) 차례로, 묶음마다 세 영상이 통과하고 사람 떠남 → 첫 명령 1.6~3.3초가 나빠지지 않아야 해요.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 습관 FSM을 사람 활동만의 Mealy 꼴로 바꾸고(묶음 A), 목표·로봇 실행·안전을 따로 도는 상태 기계로 나눠 관리자가 우선순위로 고르게 한다(묶음 B~F). 실제 폰 명령은 로봇 실행 기계 하나만 낸다.

**Architecture:** 묶음 A는 기억 모양·검사(`src/brain/decision.ts`), PAM 계약 `pam-predict/3`(답에 상태·화살표), 반성 뒤 코드 검사·LLM 검사, 목표 고르기를 바꾼다. 묶음 B~F는 지금 실행 추적(`src/act/track/`)에 흩어진 상태를 기계 넷과 관리자로 옮긴다: 먼저 지금 코드에서 상태를 읽어 토픽으로만 내는 그림자(B), 그다음 안전(C)·로봇 실행(D)·목표와 관리자(E)를 하나씩 진짜로 바꾸고, 마지막에 Redis 노드로 나눈다(F, `refactor/stage-queue` 묶음 3·4 뒤). 기계마다 노드 하나·상태 토픽 하나(STATE 최신 보기 + RELIABLE 전이 기록)이고 녹화·재생에 남는다.

**Tech Stack:** Node 22 TypeScript, zod 4.6.5, Vitest, RedisBus·MemoryBus(`src/bus/`), 가짜 PAM LLM(`tests/helpers/pam.ts`), PAM 골든(`tests/pam-golden.test.ts`), React 대시보드(`ui/`).

**Spec:** 사용자 말(2026-11-18, 조정자 전달): 「FSM을 사람의 상태로만 하면 더 자연스러우려나 … 마시는중에서 다른 상태로 넘어가면(티비보기/방에서 공부하기) 이전에 것을 해결하는 느낌이지」, 「트리거에 대해 행동을 하는 게 FSM 아니야?」, 「로봇상태는 우리 폰에 지시하기 위함이니까 필요한거」, 「마시는 중만 넣어야지 컵 있음은 사람 상태 아니잖아」, 「FSM 만드는 규칙 정확히 해야겠네」, 「검사를 규칙기반으로 해? LLM으로 해야 하는 거 아녀?」(→ 코드 검사와 LLM 검사로 나눔). 바탕: main 10ef2ec, `docs/superpowers/plans/2026-11-17-stage-queue.md`(노드·토픽·폰 사용권), `docs/superpowers/plans/2026-11-18-fsm-card.md`(`feat/fsm-card`).

## 정한 것 (2026-11-18, 사용자·조정자)

1. 기계는 넷이다: 사람 활동 FSM(배움, 반성은 이것만 고친다), 목표 기계, 로봇 실행 기계, 안전 기계. 위에 목표·모드 관리자가 「안전 > 말로 한 부탁 > 목표 > 대기」로 정하고 지금 모드(눈치·코치)도 정한다.
2. 실제 폰 명령은 로봇 실행 기계 하나만 낸다. 관찰 모드·찾기·내용물 보기·충전 복귀·계획 단계 명령이 모두 이 기계를 거친다. 계획 단계는 「실행」 안의 하위 단계다.
3. 안전 기계는 다른 기계와 따로(병렬로) 돌고, 비상이면 로봇 실행 기계를 바로 멈추게 한다.
4. 목표 기계는 사람 FSM과 따로다. 화면에서도 사람 FSM 화살표가 아니라 메시지 상자 별도 한 줄이다.
5. 기계마다 노드 하나·상태 토픽 하나(STATE 최신 + 전이 RELIABLE 기록), 녹화·재생에 남는다.
6. PAM 판단 답이 지금 사람 상태, 일어난 화살표, 그 행동(없으면 없음)을 낸다. 거꾸로 찾기(`fsmRuleOf`·`fsmNow`)는 없앤다.
7. 사람 활동 FSM 상태는 넷으로 시작한다(먹거나 마시는 중·TV 보는 중·요리하는 중·자리에 없음). 반성은 다른 활동만 새 상태로 더하고, 비슷한 상태는 합치며, 상태는 12개까지다.
8. 「자리에 없음」은 하나다(안 보이면 자리에 없음, 「모름」 따로 없음). 처음 상태도 그것이다.
9. 옛 기억은 옮기지 않는다(합성 일주일 기록에서 나온 것). 합성 데이터를 새 모양으로 다시 쌓고, 옛 모양 기억을 읽으면 새 seed로 다시 시작한다고 한 줄 남긴다.
10. 상태를 World State 사람 하는 일과 바로 잇는다(목표가 4초쯤 선다).
11. 「컵 그대로 두기」는 PAM 행동 목록에서 뺀다(안 하기 = 화살표 없음). PAM은 기억 화살표의 행동만 고르고, 기억에 없는 일은 말 부탁 길(말 요청 에이전트 `request_task` → 계획 모드 → 실행, Task 12)로만 한다.
12. 기억 검사는 둘이다: 코드 검사(모양, 정답이 분명한 것)와 LLM 검사(뜻). 물건 낱말 목록으로 상태 이름을 막지 않는다(놓치거나 지나치게 막는다).
13. 합성 이야기는 「떠나면 처음엔 묻고 → 4일째부터 바로 치우기」다(Task 9).
14. 안전 「의심」(쓰러짐 의심)이면 로봇 실행 기계가 그 사람 쪽으로 가서(이동·관찰) 실제 폰으로 「괜찮으세요?」를 소리로 묻고 듣는다. 「괜찮아」류 말이면 평소로, 정해진 시간 안에 말 답이 없거나 도움 말이면 비상으로 올린다. 묻는 횟수·듣는 시간은 `feat/fall-call` 계획(f3abcb5) 기본안(두 번 × 8초)을 따른다. 대답은 말로만 받는다(음성 우선). 보호자 전화는 그 계획대로 나중이고, 지금 비상 = 멈춤·안전 알림이다.
15. 로봇 실행 기계 상태는 대시보드에 보이지 않는다(상태 토픽·기록·시각표에만).
16. 묶음 F는 `refactor/stage-queue` 묶음 3·4 뒤에 한다.
17. 말 부탁은 손대는 단계(집기·넣기) 중이면 그 단계 뒤로 미룬다. 말 대화 답(말 에이전트의 대답)은 로봇 실행 기계 밖이다. 기억 뜻 검사 모델은 PAM LLM 그대로다.
18. 쓰러짐 확인의 두 번째 질문(보호자 전화 전)은 「괜찮으세요? 괜찮으시면 괜찮아라고 말해 주세요.」다(사용자 확정). 보호자 전화가 들어오면 `feat/fall-call` 계획 글로 바꾼다.

## 사람 FSM 만드는 규칙 (구현명세서 SSOT에도 같은 절)

1. **상태** = 사람이 하는 일 하나(비전으로 볼 수 있는 활동). 예: 마시는 중·TV 보는 중·노트북 하는 중·요리하는 중·자리에 없음. 물건 상태(컵 있음·내용물)·로봇 행동·장소만·시간대는 상태가 아니다. 안 보이면 「자리에 없음」 하나이고 처음 상태도 그것이다. 동시에 두 일이면 주된 일이 상태이고 나머지는 「같이 하는 일」이다(예: 노트북 하는 중 + 같이 마시는 중). 상태는 12개까지, 같은 활동은 합친다. 상태마다 World State 사람 하는 일 값(`activity`)을 단다.
2. **화살표** = 사람의 일이 바뀜(A → B, 또는 A → 다른 어느 일로든 `*`). 같은 일 중의 사람 사건(말·몸짓)은 자기 자신으로 가는 화살표다. 화살표 조건(`when`)은 사람 쪽 사실만이다(같이 하던 일, 한 말). (출발, 사건 `on`, 조건 `when`)이 같은 화살표는 하나뿐이다.
3. **행동** = 화살표 위에만, 하나, 로봇 할 일 목록에 있는 것만. 안 하기는 화살표 없음이다. 물건·집 조건(컵 남음·아무도 안 만짐·내용물)은 FSM에 넣지 않고 그 행동의 실행 전 검사(지금 있는 계획 전·실행 전 검사)가 본다. 맞지 않으면 그 검사대로 하고, 검사할 것이 없으면 조용히 안 한다.
4. **목표** = 지금 상태에서 나가는 화살표의 행동을 읽기만 한다(목표 기계가 쓴다).
5. **반성** = 새 활동 상태 더하기, 화살표·행동 더하기·바꾸기·지우기만 한다. 1~3을 어긴 기억은 거절하고 전날 기억을 쓴다. 로봇·목표·안전 기계는 기억에 없어 반성이 고칠 수 없다.

**검사 둘:**

| 검사 | 보는 것 | 언제 | 어디 |
|---|---|---|---|
| 코드 검사(모양) | 같은 (출발·사건·조건) 화살표 둘, 목록 밖 행동·안 하기 행동, 행동 없는 `*` 화살표, 상태 12개 초과, 처음 상태 「자리에 없음」(`away`)이 있고 처음 상태다. 그 밖 모양: 칸, 없는 상태로 가는 화살표, 모르는 하는 일 값·한 값이 두 상태에, `away` 밖 상태의 하는 일 값 없음 | 판단 요청·반성 직후·DB 읽기 | `validateMemory`(`src/brain/decision.ts`), 시험으로 막는다 |
| LLM 검사(뜻) | 상태 이름·설명이 사람이 하는 일인지(물건·장소·로봇 행동·시간대가 섞이지 않았는지, 예 「컵 두고 떠남」 거절), 화살표 조건이 사람 쪽 사실만인지, 비슷한 상태(「TV 시청 중」·「TV 보는 중」)를 합쳐야 하는지 | 반성 직후 한 번(코드 검사 뒤) | `PamClient.checkMemory`(같은 PAM LLM 통로·같은 구조, 엄격한 JSON: 통과 여부 + 항목별 까닭) |

**흐름:** 반성 → 코치 화살표 지키기·습관 거르기 → 코드 검사 → LLM 검사 → 거절이면 까닭을 반성 피드백에 붙여 한 번 다시 → 그래도 거절이면 새 판본을 저장하지 않고 전날 기억을 쓴다(반성 기록에 까닭). 판단 속도에는 영향이 없다(하루 한 번).

## 새 기억 모양 (`kind: "fsm"`, 2026-11-18 판)

- 상태: `id`(snake_case), `description`(한 문장), `activity`(World State 사람 하는 일 값, `src/world/vocab.ts` facet `activity`에서 `other`·`unknown` 빼고. 한 값은 한 상태에만, `away`만 빈 목록), `next`(화살표).
- 화살표: `to`(상태 id 또는 `"*"`), `on`(사람 사건), `when`(사람 쪽 조건, 없어도 됨), `action`(행동 이름, 없으면 상태만 넘어감). `"*"`는 행동이 있을 때만.

seed(`CUP_FSM_MEMORY`):

```ts
export const CUP_FSM_MEMORY: FsmMemory = {
  initial_state: "away",
  states: [
    {
      id: "drinking", description: "사용자가 먹거나 마시는 중이다.", activity: ["drinking", "eating"],
      next: [
        { to: "*", on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", action: "컵 치우기" },
        { to: "drinking", on: "사용자가 마시던 것을 다 마시고 계속 먹는다.", action: "컵에 물 채워 주기" },
      ],
    },
    {
      id: "watching_tv", description: "사용자가 TV를 보는 중이다.", activity: ["watching_tv"],
      next: [
        { to: "watching_tv", on: "사용자가 TV를 보며 마시던 것을 다 마신다.", when: "같이 마시는 중이었다.", action: "컵에 콜라 따라 주기" },
        // 의도 파악(2026-11-13): 바라는 것을 돌려 말한 혼잣말(「아 덥다」)이나 부채질
        { to: "watching_tv", on: "사용자가 덥다고 말하거나 더워서 부채질을 한다.", action: "에어컨 켜기" },
        { to: "*", on: "사용자가 TV 보기를 끝내고 다른 일로 넘어간다.", when: "같이 마시는 중이었다.", action: "컵 치우기" },
      ],
    },
    // 코치(2026-11-13): 코치 모드에서만 이 화살표의 행동이 행동 목록에 있다(src/act/tasks.ts tasksFor)
    {
      id: "cooking", description: "사용자가 요리하는 중이다.", activity: ["cooking"],
      next: [
        { to: "cooking", on: "사용자가 라면 끓이는 법을 알려 달라고 말했거나, 라면을 끓이다 무엇을 해야 할지 모르겠다고 말한다.", action: "라면 끓이기 알려 주기" },
        { to: "cooking", on: "사용자가 전자레인지 쓰는 법을 묻거나 이거 어떻게 하냐고 말한다.", action: "전자레인지로 데우기 알려 주기" },
        { to: "drinking", on: "사용자가 요리를 마치고 먹기 시작한다." },
      ],
    },
    {
      id: "away", description: "사용자가 카메라에 보이지 않는다.", activity: [],
      next: [
        { to: "drinking", on: "사용자가 돌아와 먹거나 마신다." },
        { to: "watching_tv", on: "사용자가 돌아와 TV를 본다." },
        { to: "cooking", on: "사용자가 돌아와 요리를 시작한다." },
      ],
    },
  ],
};
```

빈 컵·남은 음료·아무도 안 만짐은 seed에 없다: 「컵 치우기」는 실행 전 검사(대상 있음·손에 없음·쓰는 중 아님, `src/act/check.ts`)가, 「컵에 물 채워 주기」·「컵에 콜라 따라 주기」는 행동 조건(`want: { contents: "empty" }`)이 본다.

## PAM 판단 답 (`pam-predict/3`, fsm 기억)

```json
{ "observation": "…", "reasoning": "…", "state": "away", "from": "drinking", "next_index": 0 }
```

- `state`: 지금 사람 상태 id. 기억에 없는 활동이면 임시 상태 `~<하는 일 값>`(예 `~using_laptop`, World State 하는 일 값 가운데 기억 상태가 갖지 않은 것). `from`: 이번에 일어난 화살표가 나간 상태 id(화살표 없음이면 `null`). `next_index`: `from` 상태 `next`의 번호(없음 `-1`).
- `"*"` 화살표는 출발 상태를 떠나기만 하면 켜진다(도착이 임시 상태여도). 이름 있는 도착 화살표는 `state`가 그 상태여야 한다. 임시 상태에서 나가는 화살표는 없다(임시 상태는 그날 기록으로 남아 반성이 배울 거리다, Codex 8ab2d06 P2).
- 서버가 행동을 만든다: 그 화살표 `action`이 지금 행동 목록에 있으면 그 번호, 아니면 `-1`. 판단 기록·계획·화면은 지금처럼 `task_index`를 본다.
- 요청에 `last_state`(직전 판단의 `state`, 처음이면 `null`)를 싣는다.

## 네 개 나누기

### 기계 넷과 관리자

| 기계 | 상태 | 바꾸는 것 | 노드 | 상태 토픽(STATE) | 전이 기록(RELIABLE) |
|---|---|---|---|---|---|
| 사람 활동 FSM | 기억의 상태 id(`away`부터) | PAM 판단 답(`state`·화살표), 판단 사이에는 World State 하는 일(`stateOfWorld`) | `brain` | `/brain/person` | `/brain/person_changes` |
| 목표 기계 | 세움 `armed` → 미리 만드는 중 `planning` → 준비됨 `ready` → 시작 `started` → 끝 `done` / 버림 `dropped` | 사람 FSM 상태·쓰는 중 지킴·계획 모드 결과·사람 떠남·관리자 | `goal`(새) | `/goal/state` | `/goal/changes`(지금 `/brain/goal`·`/brain/goal_changes`를 바꿈) |
| 로봇 실행 기계 | 대기 `idle` · 관찰 `observe` · 이동 `move` · 실행 `run`(하위: 계획 단계) · 복귀 `return` · 막힘 복구 `recover` | 관리자의 일(`/manager/order`), World State·폰 답 | `act`(로봇) | `/robot/state` | `/robot/changes`. 실제 폰 명령 `/act/phone_command`는 이 노드만 낸다 |
| 안전 기계 | 평소 `normal` → 의심 `suspect` → 비상 `emergency`(까닭마다: 쓰러짐 `fall`, 위험 가전 `device`) | World State 자세, 쓰러짐 확인 답(들은 말), 켠 위험 가전 추적·끄기 안내 줄 | `safety`(새) | `/safety/state` | `/safety/changes` |
| 관리자 | 맡은 쪽 `safety` · `request` · `goal` · `idle`, 모드 `noonchi`·`coach`, PAM 행동 목록 | 안전·판단(들은 말 든 판단)·목표·로봇 상태 | `manager`(새) | `/manager/state` | `/manager/changes`, 로봇에 내리는 일 `/manager/order` |

기록 DB에는 전이 기록마다 한 줄(종류 `person`·`goal`·`robot`·`safety`·`manager`)을 남기고, 영상 판정 시각표(`scripts/video-check.ts`)에 「사람」「목표」「로봇」「안전」「관리」 줄로 보인다. 녹화는 전이 토픽을 모두 남기고, 격리 재생은 입력 토픽으로 같은 전이가 다시 나오는지 견준다.

### 상태와 전이

**목표 기계**(지금 `PendingGoal`의 `status`·`prep` 두 칸을 한 줄로):

| 전이 | 계기 |
|---|---|
| (없음) → 세움 | 쓰는 중 지킴이 그 종류를 붙잡고, 지금 사람 상태에서 나가는 화살표에 손대는 다 쓴 뒤 행동이 하나(`goalAhead`) |
| 세움 → 미리 만드는 중 | 계획 모드가 비어 있고 둘 자리(면)를 앎 |
| 미리 만드는 중 → 준비됨 | 계획 모드가 그 물건만 다루는 계획을 냄 |
| 미리 만드는 중 → 세움(`plan_error`) | 계획 모드 실패(다시 부르지 않음, 떠나면 PAM 확인 뒤 계획 모드) |
| 세움·미리 만드는 중·준비됨 → 그대로(`left_ms`) | 사람 떠남: 판단을 바로 부름(지금 `fired`는 상태가 아니라 표시) |
| 준비됨·미리 만드는 중·세움 → 시작 | PAM이 떠난 뒤 같은 행동을 골라 관리자가 로봇에 넘김(미리 만든 계획 또는 계획 모드) |
| 시작 → 끝 | 로봇 실행 기계가 그 계획을 닫음(완료·그만·실패, `result`) |
| 아무 때 → 버림 | 지금 버림 까닭 그대로(들고 나감·다시 나타남·옮겨짐·다른 일·안전·모드·충전 복귀·30분·PAM이 안 고름·준비한 계획 버림·그만) |

화면: 메시지 상자 별도 한 줄 「목표 · 컵 치우기 · 준비됨」(지금 목표 알약 자리, 새 자리 아님). FSM 카드는 사람 FSM만 그린다.

**로봇 실행 기계**(지금 코드 상태 → 기계 상태):

| 기계 상태 | 지금 코드에서 그때 | 내는 폰 명령 |
|---|---|---|
| 대기 | 계획·찾기·보류·가까이 가서 보기·충전 복귀가 없음 | 없음 |
| 관찰 | 판단 전 보기 B, 충전 복귀 앞 확인 3초, 찾기 비추기·가까이 보기, 내용물 잘라 보기·위에서 비추기·위에서 보기, 쓰러짐 확인(묻고 듣기) | 「식탁 위를 비춰 주세요」, 「컵 안이 보이게 위에서 비춰 주세요」, 「괜찮으세요?」(소리로 읽음, 답 단추 없음) |
| 이동 | 찾기 가기, 가까이 가서 보기의 가기, 쓰러짐 확인 앞 그 사람 쪽으로 가기 | 「식탁으로 가 주세요」, 「컵 가까이 가 주세요」, 「사람 쪽으로 가 주세요」 |
| 실행(하위: 계획 단계 i, 가기·집기·넣기·하기·묻기·알림·기다리기·기기, 승인 질문, 끄기 안내) | 열린 계획(`Run`)의 지금 단계 | 계획 단계 명령, 승인 질문, 끄기 안내 |
| 복귀 | 「충전 자리로 가 주세요」 차례 | 「충전 자리로 가 주세요」 |
| 막힘 복구 | 명령 줄 막힘(눈·폰 판본·끄기 안내·승인 대기·대화·질문)으로 거둔 동안, 멈춘 단계 관찰 모드 A, 시간 초과 다시 묻기, 집기 전 다시 보기(`verify`) | 풀리면 다시 보냄, 다시 묻기 질문 |

전이: 대기 → 실행(관리자의 일, 실행 전 검사 통과), 대기 → 관찰·이동(관리자의 보기·찾기 일), 관찰 ↔ 이동, 관찰·이동 → 실행(찾음·내용물 앎), 실행 ↔ 막힘 복구, 실행 → 복귀(명령 낸 계획이 닫힘), 복귀 → 대기(1.2m 안·2분·말 부탁), 아무 때 → 대기(관리자 멈춤: 비상·「그만」·더 높은 일).

**안전 기계**(까닭마다 따로 돌고, 기계 상태는 가장 높은 것):

| 까닭 | 평소 → 의심 | 의심 → 비상 | 의심·비상 → 평소 |
|---|---|---|---|
| 쓰러짐 `fall` | World State 자세가 쓰러짐 의심(`fall_suspected`, 지금 감지 규칙 그대로) | 쓰러짐 확인에서 말 답 없음(두 번 × 8초), 도움 말 | 회복 근거가 있을 때만: 「괜찮아」류 말, 또는 사람이 다시 보이고 쓰러짐 뒤에 찍힌 사진에서 서 있음(자세 `standing`)이나 걷는 중(하는 일 `walking`)이 확인됨. 사람이 안 보이게 됨·가려짐·자세 사실이 지워짐은 회복이 아니다(의심·비상 그대로, 쓰러짐 확인을 이어 간다) |
| 위험 가전 `device` | 계획이 위험 가전을 켬(켠 가전 추적 시작) | 끄기 안내가 떠 있거나 줄에서 기다림 | 확인된 꺼짐(`releaseIfOff`) |

**쓰러짐 확인**(의심의 쓰러짐 까닭에서 로봇 실행 기계가 하는 일, 값은 `feat/fall-call` 계획 기본안):

| 차례 | 하는 일 | 시간 |
|---|---|---|
| 0 | 안전 기계가 쓰러짐 의심으로 올림. 관리자가 맡은 쪽을 `safety`로(모드 코치), 로봇은 하던 일을 멈춤 | 한 tick 안 |
| 1 | 사람 자리를 알고 폰 눈이 2m 밖이면 「사람 쪽으로 가 주세요」(이동, `near_m` 1.5), 모르거나 안이면 건너뜀 | 닿을 때까지, 15초 넘으면 그 자리에서 묻기 |
| 2 | 실제 폰 명령 줄에 「괜찮으세요?」(안전 등급, 소리로 읽음, 답 단추 없음) | 읽기 약 1.1초 |
| 3 | 다 읽은 뒤 듣기 | 8초(`FALL_LISTEN_MS`) |
| 4 | 답이 없으면 「괜찮으세요? 괜찮으시면 괜찮아라고 말해 주세요.」 | 읽기 약 3.5초 |
| 5 | 다 읽은 뒤 듣기 | 8초 |
| 6 | 그래도 답이 없으면 비상: 멈춤·안전 알림(대시보드 말풍선 카드 「사람이 쓰러진 것 같아요.」, 지금 그대로) | 의심 뒤 약 21초(가기 빼고) |

- 들은 말(`feat/fall-call` 계획의 답 표 그대로): 도움 말(도와·살려·아파요·아야·119·구급차·전화해·못 일어나·안 괜찮, 말 안 어디든) → 바로 비상. 괜찮음 말(괜찮아·괜찮습니다·괜찮다·멀쩡해·안 다쳤어·그만, 말 전체일 때만, 앞 응·네·끝 요·해 허용) → 평소, 폰 소리 「다행이에요」. 그 밖의 말 → 다음 질문으로 바로.
- 답은 말로만 받는다(`QUESTION_CHOICES`에 답 묶음 `fall_check`를 더해 `tests/voice-answers.test.ts`가 본다). 단추는 두지 않는다.
- 「괜찮아」 뒤 2분(`FALL_RECHECK_MS`) 넘게 계속 쓰러짐 의심이면 한 번 더 같은 차례로 묻는다.
- 묻는 동안 사람이 안 보이게 돼도(가림·화면 밖) 묻기·듣기를 이어 가고, 답이 없으면 그대로 비상으로 올린다. 회복은 위 표의 근거로만 본다(Codex 8ab2d06 P1).
- 보호자 전화는 `feat/fall-call` 계획대로 나중이다: 그때 6번이 「보호자에게 전화」가 되고 4번 글이 「대답이 없으면 보호자에게 전화할게요」로 바뀐다.

비상이 되면 관리자가 맡은 쪽을 `safety`로 두고 로봇 실행 기계에 「멈춤」을 내린다(한 tick 250ms 안). 안전 일(끄기 안내 명령, 쓰러짐 확인, 코치 모드)은 로봇 실행 기계가 낸다.

**관리자**(지금 흩어진 차례 규칙을 한 곳으로):

| 차례 | 맡은 쪽 | 지금 코드 |
|---|---|---|
| 1 | `safety`: 안전 기계 비상, 쓰러짐 의심(쓰러짐 확인) | `emergencyOf`, 손대는 단계·충전 복귀 중에도 비상은 받음(`start.ts` `handsOn`, `dock.ts`) |
| 2 | `request`: 들은 말이 든 판단의 행동, 말 요청 에이전트의 할 일 부탁(`request_task`), 말로 부탁한 코치 계획 | `saidIn(textSent)`, 충전 복귀 중에도 바로 받음, `modeNow`의 코치 |
| 3 | `goal`: 미리 세운 목표와 PAM 판단 행동(사람 FSM 화살표) | `start.ts onDecision`, `goal.ts take`, 같은 행동 진행 중·늦은 답·잠시 뒤 기록 |
| 4 | `idle`: 판단 전 보기·계획 밖 가까이 가서 보기·계획 전 찾기 | `find.ts idle`·`contents.ts idle` |

모드: 맡은 쪽이 `safety`이거나 말로 부탁한 코치 계획이 열려 있으면 코치, 아니면 눈치(지금 `modeNow` 그대로). PAM 행동 목록(`pamTasks`)도 관리자가 정해 `/manager/state`에 싣는다. 손대는 단계(집기·넣기) 중의 다른 행동 판단은 지금처럼 끝난 뒤로 미룬다.

### 실제 폰 명령은 로봇 실행 기계 하나만

- 지금 `Answers.send`(`src/act/track/answers.ts`)가 「실제 폰으로 보내는 하나뿐인 길」이지만 여덟 곳(`steps`·`approval`·`coach`·`contents`·`dock`·`find`·`safety`·`tracker`)이 부른다. 묶음 D에서 이 부름을 로봇 실행 기계(`src/act/robot/`)의 명령 줄 하나로 모으고, 다른 곳은 「무엇을 띄울지」만 돌려준다.
- 막는 장치: `tests/robot-phone-only.test.ts` — `src/` 전체에서 `toPhone`·`answers.send`·`/act/phone_command` 내기가 `src/act/robot/phone.ts` 밖에 있으면 실패(지금 여덟 곳 줄로 실패를 확인). 버스 토픽 표(`src/bus/topics.ts`)의 `/act/phone_command` `from`은 로봇 노드 하나다(다른 노드가 내면 버스가 거절).
- 폰 사용권 표(`refactor/stage-queue` 묶음 3 `src/phone/owner.ts`: 안전 > 승인 > 대화 > 계획 > 가까이 가서 보기)는 로봇 실행 기계의 명령 줄 막힘(막힘 복구)으로 들어간다. 말 대화 답(말 에이전트)은 명령이 아니라 대화라 이 기계 밖이다.

### 지금 코드 → 옮길 곳

| 지금 | 하는 일 | 옮길 곳 | 묶음 |
|---|---|---|---|
| `src/brain/decide.ts` `Decider`의 `lastState`·`fsmState`·`habit` | 습관 FSM 지금 상태(거꾸로 찾기) | 사람 활동 FSM: `src/brain/person.ts`(`stateOfWorld`), 판단 답의 `state` | A |
| `src/brain/decision.ts` `fsmRuleOf`·`fsmNow`·`SEED_PATCHES` | 행동 → 규칙 거꾸로 찾기, seed 바뀜 | 지움 | A |
| `src/brain/goal.ts` `goalAhead` | 목표 고르기 | 그대로(화살표 읽기), E에서 목표 기계가 부름 | A·E |
| `src/act/mode.ts` `emergencyOf` | 비상인가 | 안전 기계 `level === "emergency"` | C |
| `src/act/mode.ts` `modeNow`·`pamTasks` | 모드·PAM 행동 목록 | 관리자 `src/manage/` | E |
| `src/act/track/safety.ts` `SafetyTracker` | 켠 위험 가전·끄기 안내 줄·회차·풀림 | 안전 기계 `src/safety/`(비공개 `#` 칸 그대로). 끄기 안내 명령 띄우기는 로봇 실행 기계 | C·D |
| `src/act/track/goal.ts` `GoalWatch` | 세움·미리 만들기·떠남·버림·받아 쓰기 | 목표 기계 `src/goal/`, 받아 쓰기는 관리자 → 로봇 | E |
| `src/act/track/start.ts` `Starter.onDecision` 차례(늦은 답·충전 복귀 중·손대는 단계·목표 맡음·같은 행동·다른 행동이 맡음) | 판단을 받을지 | 관리자 | E |
| `src/act/track/start.ts` 계획 모드 부르기(`planner`·`take`) | 계획 만들기 | `brain`(stage-queue 묶음 4), 받아 쓰기는 목표 기계 | E·F |
| `src/act/track/start.ts` `tryStart`·`begin`·`held` | 실행 전 검사·첫 명령·집기 전 다시 보기 | 로봇 「대기 → 실행」, 「막힘 복구」 | D |
| `src/act/track/steps.ts` `Steps` | 단계 진행·명령·시간 초과·멈춤 | 로봇 「실행」 하위 단계 | D |
| `src/act/track/approval.ts` | 승인 질문 | 로봇 「실행」 하위(질문) | D |
| `src/act/track/coach.ts` | 코치 단계 알림·다시 알리기 | 로봇 「실행」 하위 | D |
| `src/act/track/dock.ts` `Dock` | 확인 3초·충전 자리 가기 | 로봇 「관찰」 → 「복귀」 | D |
| `src/act/track/find.ts` `Finder` | 계획 전·실행 전 찾기 | 로봇 「이동」 ↔ 「관찰」(계획 전은 관리자 `idle` 일) | D·E |
| `src/act/track/contents.ts` `ContentsHold` | 내용물 보류·가까이 가서 보기 | 로봇 「관찰」 ↔ 「이동」 | D |
| `src/act/look.ts` `Looker` | 관찰 모드 A(멈춘 단계)·B(판단 전)·C(다른 행동) | A·C: 로봇 「막힘 복구」·「실행」, B: 관리자 `idle` 일 → 로봇 「관찰」 | D·E |
| `src/act/track/answers.ts` `send`·`onAnswer`·`onHeard` | 폰 하나뿐 길·답·「그만」 | 로봇 명령 줄(`src/act/robot/phone.ts`), 「그만」은 관리자 | D·E |
| `src/act/track/phone-line.ts` | 명령 줄·막힘·되풀이 | 로봇 명령 줄·막힘 복구 | D |
| `src/act/track/use.ts` `UseWatch` | 쓰는 중 지킴 | 관리자 공통 지킴(목표 세우기·로봇 일 시작 전) | E |
| `src/server/home/act.ts` `startAct`·`publishGoal`·`goalRecorder` | 잇기·목표 토픽 | 노드 잇기, `/goal/*` | B·F |

### 작업 묶음 차례

모든 묶음 끝 조건(공통): typecheck·lint·ui 빌드·ui 시험·전체 시험(부하 실패는 따로 다시), `goal-e2e` 혼자 세 번(사람 사라짐 → 첫 명령 1초 안), **세 영상(glass·tall·mug) 통과**, 사람 떠남 → 첫 명령이 세 판 모두 3.3초 안이고 묶음 전 값보다 0.3초 넘게 늘지 않음, 목표가 서는 때 4~5초.

| 묶음 | 하는 일 | 동작 | 끝에 더 볼 것 |
|---|---|---|---|
| A 사람 활동 FSM | 이 문서 Task 1~12(Task 12는 Task 3 바로 다음) | 바뀜(기억·PAM 답·반성 검사) | PAM 골든·기록 정답 diff, 합성 일주일 |
| B 상태 토픽 그림자 | `src/machines/view.ts`가 지금 객체(실행 추적 `Run`·`Dock`·`Finder`·`ContentsHold`·`SafetyTracker`·`GoalWatch`·`modeNow`)에서 기계 넷과 관리자 상태를 계산해 STATE·RELIABLE 토픽과 기록 DB 줄로 낸다. 명령·판단은 그대로 | 안 바뀜 | 데모 e2e 넷·영상 모드 셋에서 기계 상태 차례가 정답과 같다(`tests/machines-view.test.ts`), 시각표에 새 줄, 녹화에 전이 토픽 |
| C 안전 기계 | `SafetyTracker`를 `src/safety/`로 옮겨 기계가 상태를 갖고, `emergencyOf`는 기계 상태를 읽는다. 쓰러짐 의심이면 쓰러짐 확인(가서 묻고 듣기), 비상이면 관리자가 로봇에 멈춤 | 새로: 쓰러짐 확인, 비상 즉시 멈춤 | `tests/act-track-release.test.ts`가 새 경로에서 그대로 막음, `tests/coach-e2e.test.ts`, 새 「비상이면 250ms 안에 로봇 대기·명령 거둠」 |
| D 로봇 실행 기계 | `src/act/robot/`가 상태와 명령 줄 하나를 갖고, 단계·승인·코치·충전 복귀·찾기·내용물·관찰 모드 A가 그 상태 안의 처리로 들어간다 | 안 바뀜 | `tests/robot-phone-only.test.ts`, 실행 추적 시험 묶음이 고치지 않고 통과, 집 상태 변화 → 폰 명령 지연(`tests/latency-act.test.ts`) |
| E 목표 기계·관리자 | `GoalWatch` → `src/goal/` 기계(세움 → 미리 만드는 중 → 준비됨 → 시작 → 끝/버림), `Starter.onDecision` 차례·`modeNow`·`pamTasks`·`UseWatch` → `src/manage/` 관리자, 메시지 상자 목표 한 줄 | 안 바뀜(목표 줄 모양만) | `tests/act-goal.test.ts`·`tests/act-mode.test.ts`가 새 경로로 그대로, 관리자 차례 시험(안전 > 말 부탁 > 목표 > 대기), 목표 끝(`done`) 전이 |
| F 노드 나누기 | `goal`·`safety`·`manager` 노드와 토픽, 로봇 = `act` 노드, 사람 = `brain` 노드(`refactor/stage-queue` 묶음 3·4 뒤) | 안 바뀜 | 토픽 표 zod strict, 녹화·격리 재생에서 전이가 같음, 지연 예산 |

묶음 B~F는 시작할 때 이 표와 아래 시험 목록으로 단계 계획(`docs/superpowers/plans/` 새 문서)을 따로 쓴다(묶음 A처럼 작업마다 실패 시험·코드·커밋).

**묶음 B~F의 먼저 쓸 실패 시험:**
- B `tests/machines-view.test.ts`: 컵 치우기 데모에서 로봇 상태 차례가 대기 → 실행(4단계) → 관찰(확인) → 복귀 → 대기, 목표가 세움 → 미리 만드는 중 → 준비됨 → 시작 → 끝, 안전은 평소 그대로, 관리자는 대기 → 목표 → 대기. 코치 라면 데모에서 안전이 평소 → 의심(인덕션 켬) → 비상(끄기 안내) → 평소, 관리자 모드 코치.
- C `tests/safety-machine.test.ts`: 쓰러짐 의심 사실이 들어오면 250ms 안에 떠 있던 컵 치우기 명령이 지워지고 「괜찮으세요?」가 소리로 나감(사람이 2m 밖이면 먼저 「사람 쪽으로 가 주세요」), 「괜찮아요」 말이면 평소·「다행이에요」, 말 답 없이 두 번 × 8초면 비상(멈춤·안전 알림), 「도와줘」면 바로 비상, 답 단추가 없음, 쓰러짐 의심 뒤 사람이 안 보이게 되거나 자세 사실이 지워져도 평소로 가지 않음(서 있음·걷는 중이 확인되거나 「괜찮아요」일 때만 평소), 끄기 안내가 풀리면 평소. `tests/voice-answers.test.ts`에 `fall_check` 묶음.
- D `tests/robot-phone-only.test.ts`(위), `tests/robot-machine.test.ts`: 명령 줄 막힘이면 막힘 복구 → 풀리면 같은 명령 다시, 집기 전 다시 보기가 찾기로 넘어감.
- E `tests/manager.test.ts`: 목표 계획 실행 중 말 부탁(코치)이 오면 맡은 쪽 request·모드 코치, 손대는 단계 중이면 그 단계 끝까지 미룸, 비상이면 말 부탁보다 먼저, 충전 복귀 중 판단 미룸·말 부탁은 바로.
- F `tests/machine-nodes.test.ts`: 노드마다 STATE 마지막 값과 RELIABLE 전이가 녹화되고 격리 재생에서 같은 전이.

## Global Constraints

- TDD: 새 시험이 먼저 실패하는 것을 본다. 무거운 일은 `npm run heavy -- <cmd>`로 하나씩.
- 계약(`src/contract/`)을 바꾸거나 가지를 합치면 `npm --prefix ui run build`와 ui 시험도 돌린다(저장소 `CLAUDE.md` 규칙 표).
- 논문 프롬프트 파일(`src/brain/pam/prompts/paper/*.txt`)은 고치지 않는다. 바꿈은 `src/brain/pam/scenarios/noonchi/scenario.json` `prompt_replacements`로만. 바꾸면 `npx vitest run tests/pam-golden.test.ts -u`로 정답을 다시 쓰고 diff를 본다.
- 추론 모드 openai·vllm은 같은 구조다: 새 LLM 부르기(기억 뜻 검사)도 PAM LLM 통로(`src/brain/pam/llm.ts`, 주소는 `src/infer/endpoints.ts`)로만 하고, 시험은 같은 주소 자리의 가짜 서버로 한다(`tests/same-structure.test.ts`).
- 규칙으로 행동을 고르지 않는다: 행동은 PAM 답이 고른 화살표에서만 나온다. 서버는 화살표를 실행하거나 상태를 넘기지 않는다(답을 검사하고 그대로 쓴다).
- 화면 글은 할 일과 지금 상태만(`npm run lint`), 메시지 상자 줄은 사실로만, 허락 문장은 사용자가 정한 짧은 꼴(`RULE_IF`).
- 묶음마다 세 영상(glass·tall·mug)이 통과하고 사람 떠남 → 첫 명령이 3.3초 안이다.
- 구현명세서 SSOT(docs 저장소 `01_Product/구현명세서 SSOT.md`)는 코드와 같이 고친다. 바뀐 내력은 `변경이력.md`에만.
- 커밋은 작업마다 로컬로만, `git add <경로>`로 그 작업 파일만. push 하지 않는다.

## 파일 지도 (묶음 A)

| 파일 | 맡는 일 | 작업 |
|---|---|---|
| `src/brain/decision.ts` | 기억 모양·코드 검사·seed·옛 모양 알기·판단 답 검사 | 1, 2, 3 |
| `src/contract/pam.ts` | `FsmStep`, `Prediction` 칸, 계약 이름 | 3, 4 |
| `src/brain/pam/request.ts`·`client.ts`·`answer.ts`·`prompt.ts` | `pam-predict/3`, `last_state` 줄, 기억 뜻 검사 부르기 | 3, 7 |
| `src/brain/pam/memoryCheck.ts`(새), `scenarios/noonchi/memory_check.txt`(새) | 기억 뜻 검사(LLM) | 7 |
| `src/brain/pam/scenarios/noonchi/scenario.json` | 판단·반성 프롬프트 바꿈 | 3, 6 |
| `src/brain/decide.ts`, `src/brain/person.ts`(새) | 답의 상태·화살표를 판단 기록에, World State 하는 일 → 상태 | 4 |
| `src/brain/thought.ts`, `src/world/labels.ts` | 허락 문장, 상태 이름 | 4 |
| `src/brain/goal.ts`, `src/act/track/goal.ts` | 목표 = 지금 상태에서 나가는 화살표 행동 | 5 |
| `src/brain/history/habits.ts`·`reflect.ts` | 반성 뒤 검사·다시 반성 한 번·배운 화살표 | 2, 6, 7 |
| `src/act/tasks.ts`, `scenarios/noonchi/tasks.json` | 「컵 그대로 두기」 빼기 | 8 |
| `scripts/seed-history.ts`·`demo-setup.ts`·`twin3d/fake-run.ts` | 합성 일주일 새로 쌓기 | 9 |
| `src/brain/habit.ts`(FSM 카드 갈래) | 카드 그림 자료를 화살표로 | 10 |
| `src/agent/tools.ts`·`src/act/track/tracker.ts` | 말 부탁 → 계획 모드(`request_task`, `onRequest`) | 12 |
| `docs/reference.md`, `docs/pam-interface.md`, `src/brain/pam/README.md`, SSOT | 문서 | 11 |

---

## 묶음 A 작업

### Task 1: 새 기억 모양·코드 검사·seed

**Files:**
- Modify: `src/brain/decision.ts` (타입 `FsmMemory`·`validateMemory`·`CUP_FSM_MEMORY`)
- Modify: `src/brain/pam/budget.ts:23` (빈 기억 모양)
- Test: `tests/brain-decision.test.ts`

**Interfaces:**
- Produces:
  - `export const ANY_STATE = "*"; export const AWAY_STATE = "away"; export const MAX_STATES = 12;`
  - `export interface FsmEdge { to: string; on: string; when?: string; action?: string }`
  - `export interface FsmState { id: string; description: string; activity: string[]; next: FsmEdge[] }`
  - `export interface FsmMemory { initial_state: string; states: FsmState[] }`
  - `validateMemory(value, "fsm"): FsmMemory`(코드 검사, 새 모양만), `PERSON_ACTIVITIES: readonly string[]`
  - `CUP_FSM_MEMORY: FsmMemory`(「새 기억 모양」 절의 seed)

- [ ] **Step 1: 실패하는 시험 쓰기** (`tests/brain-decision.test.ts` 끝에)

```ts
describe("사람 활동 FSM 코드 검사", () => {
  const base = () => structuredClone(CUP_FSM_MEMORY) as FsmMemory;
  const drink = (m: FsmMemory) => m.states.find((s) => s.id === "drinking")!;
  it("seed는 사람 상태 넷이고 처음은 자리에 없음, 행동은 화살표에만, 물건 조건이 없다", () => {
    expect(validateMemory(CUP_FSM_MEMORY, "fsm")).toBe(CUP_FSM_MEMORY);
    expect(CUP_FSM_MEMORY.initial_state).toBe("away");
    expect(CUP_FSM_MEMORY.states.map((s) => s.id)).toEqual(["drinking", "watching_tv", "cooking", "away"]);
    expect(CUP_FSM_MEMORY.states.some((s) => "rules" in s)).toBe(false);
    expect(drink(CUP_FSM_MEMORY).next[0]).toEqual({ to: "*", on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", action: "컵 치우기" });
  });
  it("같은 (출발·사건·조건) 화살표 둘은 거절한다. 조건이 다르면 된다", () => {
    const m = base();
    drink(m).next.push({ ...drink(m).next[0]!, action: "사용자에게 물어보기" });
    expect(() => validateMemory(m, "fsm")).toThrow(/duplicate transition/);
    const ok = base();
    drink(ok).next.push({ ...drink(ok).next[0]!, when: "같이 TV를 보는 중이었다.", action: "사용자에게 물어보기" });
    expect(validateMemory(ok, "fsm")).toBe(ok);
  });
  it("목록 밖 행동·안 하기 행동은 거절한다", () => {
    const m = base(); drink(m).next[0]!.action = "컵 닦기";
    expect(() => validateMemory(m, "fsm")).toThrow(/not an action/);
    const keep = base(); drink(keep).next[0]!.action = "컵 그대로 두기";
    expect(() => validateMemory(keep, "fsm")).toThrow(/not an action/);
  });
  it("행동 없는 \"*\" 화살표, 상태 12개 초과, 자리에 없음이 없거나 처음 상태가 아니면 거절한다", () => {
    const any = base(); drink(any).next.push({ to: "*", on: "사용자가 일어난다." });
    expect(() => validateMemory(any, "fsm")).toThrow(/needs an action/);
    const many = base();
    const free = PERSON_ACTIVITIES.filter((a) => !many.states.some((s) => s.activity.includes(a)));
    for (let i = 0; i < 9; i++) many.states.push({ id: `extra_${i}`, description: "사용자가 다른 일을 한다.", activity: [free[i]!], next: [] });
    expect(() => validateMemory(many, "fsm")).toThrow(/at most 12 states/);
    const first = base(); first.initial_state = "drinking";
    expect(() => validateMemory(first, "fsm")).toThrow(/initial_state: must be 'away'/);
    const noAway = base(); noAway.states = noAway.states.filter((s) => s.id !== "away").map((s) => ({ ...s, next: s.next.filter((e) => e.to !== "away") })); noAway.initial_state = "drinking";
    expect(() => validateMemory(noAway, "fsm")).toThrow(/'away' state is required/);
  });
  it("모양: 없는 상태로 가는 화살표, 모르는 하는 일 값, 한 값이 두 상태에, 자리에 없음 밖의 상태에 하는 일 값 없음, 옛 모양(rules)", () => {
    const to = base(); drink(to).next.push({ to: "nap", on: "사용자가 잔다." });
    expect(() => validateMemory(to, "fsm")).toThrow(/unknown state identifier 'nap'/);
    const act = base(); drink(act).activity.push("flying");
    expect(() => validateMemory(act, "fsm")).toThrow(/unknown activity 'flying'/);
    const two = base(); two.states[1]!.activity.push("drinking");
    expect(() => validateMemory(two, "fsm")).toThrow(/activity 'drinking' is in two states/);
    const none = base(); drink(none).activity = [];
    expect(() => validateMemory(none, "fsm")).toThrow(/needs at least one activity/);
    const old = { initial_state: "away", states: [{ id: "away", description: "d", rules: [], next: [] }] };
    expect(() => validateMemory(old, "fsm")).toThrow(/incorrect fields/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/brain-decision.test.ts`
Expected: FAIL (`activity`·`"*"`·`MAX_STATES`가 없고 옛 모양이 통과)

- [ ] **Step 3: 구현** (`src/brain/decision.ts`)

```ts
import { STATES } from "../world/vocab.js";
import { TASKS, TASK_NAMES } from "../act/tasks.js";

export const ANY_STATE = "*";
export const AWAY_STATE = "away";
/** 상태 수 상한(사용자 결정 2026-11-18). */
export const MAX_STATES = 12;
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

/** 행동 목록의 하는 행동인가(안 하기 행동 TaskSpec.plan false는 아니다). */
const isAction = (a: string) => TASK_NAMES.includes(a) && TASKS[a]?.plan !== false;

/** 사람 활동 FSM 코드 검사(모양, 정답이 분명한 것). 뜻(상태가 사람이 하는 일인지·조건이 사람 쪽인지·합칠 상태)은 기억 뜻 검사(LLM)가 본다. */
function validateFsm(value: Json): FsmMemory {
  const m = object(value, ["initial_state", "states"], "memory");
  const initial = text(m.initial_state, "memory.initial_state");
  const states = array(m.states, "memory.states");
  if (!states.length) throw new ContractError("memory.states: at least one state is required");
  if (states.length > MAX_STATES) throw new ContractError(`memory.states: at most ${MAX_STATES} states`);
  const ids = new Set<string>();
  const owner = new Map<string, string>();
  const destinations: [string, string][] = [];
  states.forEach((state, i) => {
    const p = `memory.states[${i}]`;
    const s = object(state, ["id", "description", "activity", "next"], p);
    const id = text(s.id, `${p}.id`);
    if (id === ANY_STATE || id.startsWith(TEMP_STATE)) throw new ContractError(`${p}.id: '*' and '~…' are reserved`);
    if (ids.has(id)) throw new ContractError(`${p}.id: duplicate state identifier ${pyRepr(id)}`);
    ids.add(id);
    text(s.description, `${p}.description`);
    const acts = array(s.activity, `${p}.activity`);
    if (id !== AWAY_STATE && !acts.length) throw new ContractError(`${p}.activity: state ${pyRepr(id)} needs at least one activity`);
    if (id === AWAY_STATE && acts.length) throw new ContractError(`${p}.activity: 'away' has no activity`);
    acts.forEach((a, j) => {
      const v = text(a, `${p}.activity[${j}]`);
      if (!PERSON_ACTIVITIES.includes(v)) throw new ContractError(`${p}.activity[${j}]: unknown activity ${pyRepr(v)}`);
      if (owner.has(v)) throw new ContractError(`${p}.activity[${j}]: activity ${pyRepr(v)} is in two states`);
      owner.set(v, id);
    });
    const keys = new Set<string>();
    array(s.next, `${p}.next`).forEach((e, j) => {
      const ep = `${p}.next[${j}]`;
      const edge = objectWith(e, ["to", "on"], ["when", "action"], ep);
      const to = text(edge.to, `${ep}.to`);
      const on = text(edge.on, `${ep}.on`);
      const when = "when" in edge ? text(edge.when, `${ep}.when`) : null;
      const key = JSON.stringify([on, when]);
      if (keys.has(key)) throw new ContractError(`${ep}: duplicate transition (on, when) in state ${pyRepr(id)}`);
      keys.add(key);
      const action = "action" in edge ? text(edge.action, `${ep}.action`) : null;
      if (action !== null && !isAction(action)) throw new ContractError(`${ep}.action: ${pyRepr(action)} is not an action in the task list (no action means no transition)`);
      if (to === ANY_STATE && action === null) throw new ContractError(`${ep}.to: '*' needs an action`);
      if (to !== ANY_STATE) destinations.push([`${ep}.to`, to]);
    });
  });
  if (!ids.has(AWAY_STATE)) throw new ContractError("memory.states: the 'away' state is required");
  if (initial !== AWAY_STATE) throw new ContractError("memory.initial_state: must be 'away'");
  for (const [path, to] of destinations) if (!ids.has(to)) throw new ContractError(`${path}: unknown state identifier ${pyRepr(to)}`);
  return m as unknown as FsmMemory;
}
```

`validateMemory(value, kind)`의 fsm 갈래는 `return validateFsm(value)`로 바꾸고, seed는 「새 기억 모양」 절의 `CUP_FSM_MEMORY`로 바꾼다. `budget.ts:23`의 빈 기억은 `{ initial_state: "away", states: [{ id: "away", description: "d", activity: [], next: [] }] }`.

- [ ] **Step 4: 통과 확인**

Run: `npm run heavy -- npx vitest run tests/brain-decision.test.ts`
Expected: PASS(옛 seed를 쓰던 다른 시험은 Task 2~9에서 고친다. 커밋 전에 `npx tsc --noEmit -p .` 오류 목록을 작업 노트에 남긴다)

- [ ] **Step 5: 커밋**

```bash
git add src/brain/decision.ts src/brain/pam/budget.ts tests/brain-decision.test.ts
git commit -m "feat(brain): person-activity FSM memory with action transitions and its code check"
```

---

### Task 2: 옛 모양 기억은 옮기지 않고 새 seed로 다시 시작

사용자 답(2026-11-18): 지금 기억은 합성 일주일 기록(`scripts/seed-history.ts`·`scripts/demo-setup.ts`)에서 나온 것이라 옮기지 않는다. 합성 데이터는 Task 7이 처음부터 새 모양으로 다시 쌓는다. 기록 DB에서 옛 모양 기억(상태 안 `rules`)을 읽으면 새 seed 판본을 올려 그것으로 다시 시작하고, 서버 로그에 한 줄 남긴다.

**Files:**
- Modify: `src/brain/decision.ts` (`isOldFsm`, `SEED_PATCHES`·`patchMemory` 지움)
- Modify: `src/brain/history/reflect.ts` (`memoryForDay`·`readDayMemory`·`dayMemory`, seed 바뀜 넣기 지움)
- Modify: `src/server/home/index.ts` 또는 `memoryForDay`를 부르는 곳(로그 넘기기)
- Test: `tests/history-reflect.test.ts`

**Interfaces:**
- Consumes: Task 1의 `validateMemory`·`CUP_FSM_MEMORY`.
- Produces:
  - `isOldFsm(value: unknown): boolean` — 상태 하나라도 `rules` 칸이 있으면 옛 모양.
  - `memoryForDay(db, day, o?: { log?: (line: string) => void }): DayMemory` — 그날 판본이 옛 모양이면 새 seed 판본을 저장·고정하고 `MEMORY_TEXT.restart(version)`(「옛 모양 기억 <v>판이라 새 seed로 다시 시작해요」)을 `log`로 남긴다.

- [ ] **Step 1: 실패하는 시험 쓰기** (`tests/history-reflect.test.ts`)

```ts
describe("옛 모양 기억", () => {
  const OLD = { initial_state: "drinking", states: [{ id: "drinking", description: "먹는 중", rules: [{ trigger: "컵이 빈다.", action: "컵에 물 채워 주기" }], next: [] }] };
  it("그날 판본이 옛 모양이면 옮기지 않고 새 seed 판본을 올려 쓰고 로그에 한 줄 남긴다", () => {
    const db = HistoryDb.open(":memory:");
    const old = db.saveMemory({ kind: "fsm", memory: OLD, day: "2026-11-18", appliesDay: "2026-11-19", source: "reflection" });
    const lines: string[] = [];
    const m = memoryForDay(db, "2026-11-19", { log: (l) => lines.push(l) });
    expect(m.version).toBeGreaterThan(old);
    expect(m.memory).toEqual(CUP_FSM_MEMORY);
    expect(lines).toEqual([`옛 모양 기억 ${old}판이라 새 seed로 다시 시작해요`]);
    expect(memoryForDay(db, "2026-11-19").version).toBe(m.version);
  });
  it("반성은 옛 모양 판본을 읽지 않는다(그날 판본이 옛 모양이면 새 seed로 반성한다)", async () => {
    const db = HistoryDb.open(":memory:");
    db.saveMemory({ kind: "fsm", memory: OLD, day: null, appliesDay: null, source: "seed" });
    db.add("world", Date.parse("2026-11-19T03:00:00Z"), "사람 보임");
    const sent: unknown[] = [];
    const pam = fakeReflectPam((req) => { sent.push(req.memory); return CUP_FSM_MEMORY; });
    await runReflection(db, pam, "2026-11-19");
    expect(sent).toEqual([CUP_FSM_MEMORY]);
  });
});
```

(`fakeReflectPam`은 이 파일의 가짜 반성 PAM 도우미를 쓴다.)

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/history-reflect.test.ts`
Expected: FAIL (옛 모양을 `validateMemory`가 거절해 오류)

- [ ] **Step 3: 구현**

```ts
// src/brain/decision.ts
/** 2026-11-18 전 모양(상태 안 rules)인가. 옮기지 않는다(합성 기록에서 나온 기억이라 새 seed로 다시 시작, 사용자 답). */
export const isOldFsm = (v: unknown): boolean =>
  !!v && typeof v === "object" && Array.isArray((v as { states?: unknown }).states)
  && (v as { states: unknown[] }).states.some((s) => !!s && typeof s === "object" && "rules" in s);
```

```ts
// src/brain/history/reflect.ts (dayMemory 맨 앞, readDayMemory도 같은 갈래)
const m = pinned !== null ? db.memoryVersion(pinned) : db.memoryFor(day);
if (m && m.kind === "fsm" && isOldFsm(m.memory)) {
  const version = db.saveMemory({ kind: "fsm", memory: CUP_FSM_MEMORY, day: null, appliesDay: null, source: "seed" });
  db.pinMemory(day, version, true);
  o.log?.(MEMORY_TEXT.restart(m.version));
  return { memory: CUP_FSM_MEMORY, kind: "fsm", version };
}
```

`readDayMemory`는 옛 모양이면 저장하지 않고 `{ memory: CUP_FSM_MEMORY, kind: "fsm" }`을 돌려준다. `MEMORY_TEXT = { restart: (v: number) => \`옛 모양 기억 ${v}판이라 새 seed로 다시 시작해요\` }`는 `src/brain/history/labels.ts`에 둔다. `SEED_PATCHES`·`patchMemory`·`markSeedPatch` 쓰는 곳을 지운다(옛 바뀜 「2026-11-16-clear-habit」은 새 seed에 이미 들어 있다). 서버(`src/server/home/index.ts`)는 `memoryForDay`를 부를 때 `log: ctx.log`를 넘긴다.

- [ ] **Step 4: 통과 확인**

Run: `npm run heavy -- npx vitest run tests/history-reflect.test.ts tests/brain-decision.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/brain/decision.ts src/brain/history/reflect.ts src/brain/history/labels.ts src/server/home/index.ts tests/history-reflect.test.ts
git commit -m "feat(brain): restart from the new seed when the day's memory has the old FSM shape"
```

---

### Task 3: PAM 판단 계약 `pam-predict/3`

Task 3 바로 다음에 Task 12(말 부탁 길)를 한다. 그 전에는 기억에 없는 행동 말 부탁이 막힌다.

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
  it("기억에 없는 활동은 임시 상태(~하는 일 값)로 내고, \"*\" 화살표는 그 임시 상태로 떠나도 켜진다", () => {
    expect(parsePrediction(ok({ state: "~using_laptop", from: "drinking", next_index: 0 }), tasks, CUP_FSM_MEMORY)).toMatchObject({ status: "valid", selected_action: "컵 치우기", prediction: { state: "~using_laptop" } });
    for (const bad of [
      { state: "~using_laptop", from: "away", next_index: 1 },   // 이름 있는 도착(watching_tv) 화살표
      { state: "~flying", from: null, next_index: -1 },           // 모르는 하는 일 값
      { state: "~drinking", from: null, next_index: -1 },         // 기억 상태가 가진 하는 일 값
    ]) expect(parsePrediction(ok(bad), tasks, CUP_FSM_MEMORY).status).toBe("invalid");
  });
  it("없는 상태, 넘는 번호, 도착 상태가 화살표와 다름, \"*\" 화살표인데 같은 상태, task_index 칸이 있으면 invalid다", () => {
    for (const bad of [
      { state: "nap", from: null, next_index: -1 },
      { state: "away", from: "drinking", next_index: 9 },
      { state: "cooking", from: "drinking", next_index: 1 },
      { state: "drinking", from: "drinking", next_index: 0 },
      { state: "away", from: "drinking", next_index: 0, task_index: 0 },
    ]) expect(parsePrediction(ok(bad), tasks, CUP_FSM_MEMORY).status).toBe("invalid");
  });
});
```

(`drinking.next[1]`은 자기 자신으로 가는 물 채우기 화살표다.)

`tests/pam-request.test.ts`: `contract: "pam-predict/3"`와 `last_state`(문자열·null)는 받고, `"pam-predict/2"`·`last_state` 없음은 거절한다. 판단 메시지 사용자 글 첫 칸 앞에 `PREDICT_STATE + (last_state ?? "unknown")` 줄이 들어간다.

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/pam-answer.test.ts tests/pam-request.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// src/brain/decision.ts
/** 기억에 없는 활동의 임시 상태(~<하는 일 값>): 그 값이 World State 하는 일 값이고 기억의 어느 상태도 갖지 않았다. */
export const TEMP_STATE = "~";
export const isTempState = (memory: FsmMemory, id: string): boolean =>
  id.startsWith(TEMP_STATE) && PERSON_ACTIVITIES.includes(id.slice(1)) && !memory.states.some((s) => s.activity.includes(id.slice(1)));

export function validateFsmPrediction(value: Json, memory: FsmMemory, tasks: string[]): Prediction {
  validateTasks(tasks);
  const p = object(value, ["observation", "reasoning", "state", "from", "next_index"], "prediction");
  text(p.observation, "prediction.observation");
  text(p.reasoning, "prediction.reasoning");
  const state = text(p.state, "prediction.state");
  const byId = (id: string) => memory.states.find((s) => s.id === id);
  if (!byId(state) && !isTempState(memory, state)) throw new ContractError(`prediction.state: unknown state identifier ${pyRepr(state)}`);
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
   `new`: "- First decide the person's current state from the latest observations (use the previous state given in the input). If the person is doing an activity that no state has, answer the state as '~' followed by that activity value from the observation log (for example ~using_laptop). Then decide whether exactly one transition of the previous state happened now: its `on` happened and its `when` holds in the latest observations. If none happened, answer no transition."
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

### Task 12: 말 부탁 → 계획 모드 → 실행 (Task 3 바로 다음에 한다)

PAM은 Task 3부터 기억 화살표의 행동만 고른다. 그래서 기억에 없는 행동 부탁(예: TV 보는 중 「라면 끓이는 법 알려 줘」, 기억에 없는 「컵 치워 줘」)은 PAM으로는 막힌다(Codex 8ab2d06 P2). 말 요청 에이전트에 「할 일 부탁」 도구를 더해, 말 부탁 → 계획 모드 → 실행(묶음 D 뒤로는 로봇 실행 기계) 길을 둔다. 묶음 E에서는 관리자의 「말로 한 부탁」(`request`) 차례가 이 길을 받는다. Task 3과 같은 묶음 안에서 바로 이어서 해 그 사이 말 부탁이 막히지 않게 한다.

**Files:**
- Modify: `src/agent/tools.ts` (도구 `request_task`), `src/agent/agent.ts`·`src/agent/prompts.ts`(말 요청 에이전트 지시문 한 줄)
- Modify: `src/act/track/tracker.ts`·`src/act/track/start.ts` (`onRequest`)
- Modify: `src/server/home/agent.ts` (도구 → `core.tracker.onRequest`)
- Modify: `src/contract/events.ts` (판단 기록 `source?: "speech"`)
- Test: `tests/agent.test.ts`, `tests/speech-request.test.ts`(새)

**Interfaces:**
- Consumes: Task 3(PAM은 화살표 행동만), 지금 `Starter.onDecision`(들은 말이 든 판단은 충전 복귀 중에도 받음, 손대는 단계 중이면 그 단계 뒤로 미룸).
- Produces:
  - 도구 `request_task({ task: string }) → { ok: true } | { ok: false; error: string }` — `task`는 행동 목록(`TASK_NAMES`) 이름 그대로. 모드와 상관없이 받는다(코치 행동이면 계획이 열린 동안 모드가 코치, `modeNow` 그대로).
  - `ExecutionTracker.onRequest(r: { task: string; heard: string; atMs: number; afterSeq: number }): void` — `afterSeq`는 말 부탁을 받은 때까지 판단이 보낸 마지막 PAM 요청 번호(`Decider.sentSeq()`, 서버가 넣는다). 들은 말 부탁을 판단 기록 꼴(`id: say-<번호>`, `source: "speech"`, `seq: 0`, `textSent`에 「사람이 말함: 「…」」, `prediction: { observation: "사람이 말로 부탁함", reasoning: "사람이 말로 부탁함", task_index }`, `action: task`, `tasks: TASK_NAMES`)로 만들어 지금 판단 받기 길(`onDecision`)에 넣는다. 그래서 계획 전 검사·계획 모드·승인·실행이 PAM 판단과 같다.
  - 순서는 밀리초가 아니라 PAM 요청 번호(`seq`, 단조 증가)로 정한다(Codex 6802be0: 시각 비교는 같은 밀리초 가장자리가 생긴다). 말 부탁은 PAM 판단 번호와 섞지 않는다: `onDecision`은 `source === "speech"`면 seq 검사를 건너뛰고 `lastSeq`를 바꾸지 않으며 `afterSeq`를 `lastSpeechSeq`에 둔다. PAM 판단은 지금처럼 seq로 늦은 답을 거르고, 그에 더해 말 부탁을 받은 때부터 그 계획을 만드는 중이거나 열려 있는 동안 `seq <= lastSpeechSeq`인 판단(말 부탁 전에 보낸 요청의 답)은 「앞선 판단이라 쓰지 않음」으로 기록만 한다.

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
// tests/speech-request.test.ts (가짜 서버 + 가짜 OpenAI(말 요청 에이전트·계획 모드) + 가짜 PAM)
it("기억에 그 행동 화살표가 없는 상태(TV 보는 중)에서 「라면 끓이는 법 알려 줘」는 말 요청 에이전트의 request_task로 계획 모드에 가고 코치 계획이 시작된다(PAM은 화살표 없음)", async () => {
  const s = await speechSetup({ personState: "watching_tv", agentCalls: [{ name: "request_task", args: { task: "라면 끓이기 알려 주기" } }] });
  await s.say("라면 끓이는 법 알려 줘");
  await s.until(() => s.plans().some((p) => p.goal === "라면 끓이기 알려 주기" && p.status === "running"));
  expect(s.decisions().at(-1)).toMatchObject({ source: "speech", action: "라면 끓이기 알려 주기" });
  expect(s.mode()).toBe("coach");
});
it("말 부탁은 PAM 판단 번호와 섞이지 않는다: PAM seq가 높아도 첫 말 부탁을 받고, 말 부탁보다 먼저 본 PAM 판단은 그 계획을 바꾸지 않으며, 뒤의 PAM 판단(다음 seq)은 그대로 받는다", async () => {
  // tests/act-track.test.ts에 둔다(이 파일의 setup·decision 도우미)
  const t = setup();
  const pam = (id: string, seq: number, atMs: number, action: string): DecisionRecord => ({ ...decision, id, seq, atMs, action });
  await t.decide(pam("pam-9", 9, 9_000, "사용자에게 물어보기"));            // PAM seq 9까지 받음
  t.t.onRequest({ task: "라면 끓이기 알려 주기", heard: "라면 끓이는 법 알려 줘", atMs: 10_000, afterSeq: 10 });   // pam-10은 이미 보냈고 답 전
  await t.t.idle();
  expect(t.exec().at(-1)).toMatchObject({ plan_id: expect.stringMatching(/^plan:say-/), state: "decided" });
  await t.decide(pam("pam-10", 10, 10_000, "컵 치우기"));                  // 말 부탁 전에 보낸 요청의 답(같은 밀리초여도 번호로 가른다)
  expect(t.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-10", text: EXEC_TEXT.late });
  await t.decide(pam("pam-11", 11, 10_000, "라면 끓이기 알려 주기"));       // 뒤에 보낸 요청: 같은 행동이면 진행 중 기록
  expect(t.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-11", text: EXEC_TEXT.same });
});
it("말 부탁 계획을 아직 만드는 중에 그보다 먼저 본 관찰의 PAM 판단이 와도 그 계획을 끊지 않는다", async () => {
  // tests/act-track.test.ts에 둔다(이 파일의 setup·decision·world·cup·testPlanner·planContext 도우미)
  let release: (r: PlanResult) => void = () => {};
  const plans = new PlanHub(smallFloor(), () => {}, () => "t");
  const w = () => world([cup("present")]);
  const real = testPlanner(llm);
  const t = setup({ plans, w, planner: (d, signal) => (d.source === "speech" ? new Promise<PlanResult>((r) => { release = r; }) : real.plan(planContext({ decision: d, world: w(), floor: plans.floor() }), signal)) });
  t.t.onRequest({ task: "컵 치우기", heard: "컵 치워 줘", atMs: 10_000, afterSeq: 3 });
  await t.decide({ ...decision, id: "pam-3", seq: 3, atMs: 10_000, action: "사용자에게 물어보기" });   // 말 부탁 전에 보낸 요청의 답
  expect(t.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-3", text: EXEC_TEXT.late });
  release(await real.plan(planContext({ decision: { ...decision, id: "say-1" }, world: w(), floor: plans.floor() })));
  await t.t.idle();
  expect(plans.current()).toMatchObject({ id: "plan:say-1", status: "running" });
});
it("목록에 없는 이름은 거절하고 계획을 만들지 않는다", async () => {
  const s = await speechSetup({ agentCalls: [{ name: "request_task", args: { task: "설거지하기" } }] });
  await s.say("설거지 해 줘");
  expect(s.toolResults().at(-1)).toMatchObject({ ok: false });
  expect(s.plans()).toEqual([]);
});
```

(`speechSetup`은 `tests/phone-voice.test.ts`의 서버 도우미에 가짜 PAM 답 「화살표 없음」과 말 요청 에이전트 도구 호출 대본을 넣은 것이다.)

```ts
// tests/agent.test.ts
it("request_task 도구는 행동 목록 이름만 받는다", async () => {
  const backend = localBackend(hub, policy, rooms);
  expect(await backend.call("request_task", { task: "컵 치우기" })).toMatchObject({ ok: true });
  expect(await backend.call("request_task", { task: "컵 닦기" })).toMatchObject({ ok: false });
});
```

- [ ] **Step 2: 실패 확인** — `npm run heavy -- npx vitest run tests/agent.test.ts tests/speech-request.test.ts`. Expected: FAIL
- [ ] **Step 3: 구현** — `tools.ts`에 `request_task`(입력 zod `{ task: z.enum(TASK_NAMES) }`, 결과는 `onRequest` 콜백 결과), 말 요청 에이전트 지시문에 「사람이 로봇 할 일 목록의 일을 부탁하면 request_task로 넘긴다(가전 하나를 켜고 끄는 말은 지금처럼 가전 도구)」, 서버가 `onRequest`를 `core.tracker.onRequest`에 잇는다. `onRequest`는 위 판단 기록 꼴을 만들어 `this.core.start.onDecision(d)`. `Starter.onDecision` 맨 앞은:

```ts
if (d.late) return this.note(d, EXEC_TEXT.late);          // 판단이 버린 늦은 답(아래 Decider): 기록만
if (d.source === "speech") this.lastSpeechSeq = d.afterSeq!;   // 말 부탁: PAM 번호와 섞지 않는다
else {
  if (d.seq < this.lastSeq) return this.note(d, EXEC_TEXT.late);
  this.lastSeq = d.seq;
  // 말 부탁을 받은 때부터(그 계획을 만드는 중이어도) 그 전에 보낸 요청의 PAM 판단은 쓰지 않는다
  const speech = core.planning?.decision.source === "speech" || core.open()?.decision.source === "speech";
  if (speech && d.seq <= this.lastSpeechSeq) return this.note(d, EXEC_TEXT.late);
}
```
 같은 행동을 PAM도 골랐으면 지금 「같은 행동을 진행 중」 기록으로 하나만 돈다.
- [ ] **Step 4: 통과 확인** — `npm run heavy -- npx tsc --noEmit -p .`, 위 두 시험, `npm run heavy -- npx vitest run tests/phone-voice.test.ts tests/coach-e2e.test.ts tests/same-structure.test.ts`, `npm run heavy -- npm --prefix ui run build`. Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(agent): spoken task requests go to plan mode through request_task"`

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
  - `Decider.onExecution(planId: string, state: ExecState): void` — 실행 기록을 받아 「아직 시작 안 된 화살표」(`pending`)를 푼다.
  - `PENDING_EDGE_MS = 15_000` — 행동이 시작되지 않은 화살표를 다시 켤 수 있게 두는 시간(목표 `fireWaitMs`와 같다).
  - `Decider.sentSeq(): number` — 지금까지 보낸 마지막 PAM 요청 번호(말 부탁 `afterSeq`).
  - 판단 기록 `late?: true`(`src/contract/events.ts`) — 판단이 버린 늦은 답. `action`은 null이고 실행 추적은 「앞선 판단이라 쓰지 않음」으로 기록만 한다.

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
    // 첫 판단의 행동(컵 치우기)이 시작됐다: 기다리던 화살표가 풀려 다음 요청의 직전 상태는 넘어간 상태(away)다(아래 pending 시험과 같은 규칙)
    if (i === 0) d.onExecution("plan:pam-1", "running");
  }
  expect(records.map((r) => [r.action, r.fsm])).toEqual([
    ["컵 치우기", { state: "away", from: "drinking", next_index: 0, to: "*", on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", when: null, action: "컵 치우기", learned: false }],
    [null, { state: "away", from: null, next_index: -1, to: null, on: null, when: null, action: null, learned: false }],
  ]);
  expect((pam.bodies as { last_state: string | null }[]).map((b) => b.last_state)).toEqual([null, "away"]);
  expect(d.fsmState()).toBe("away");
});
```

(가짜 PAM LLM `startFakePamLlm({ predict })`의 답 모양 `Pred`는 Task 3에서 새 칸을 받는다. `pam.bodies`는 받은 요청 본문이다.)

```ts
// tests/world-decide.test.ts
it("행동이 붙은 화살표의 행동이 시작되지 않으면(목표가 맡아 기록만 함) 다음 요청의 직전 상태는 그 출발 상태다. 실행이 시작되거나 15초가 지나면 넘어간 상태다", async () => {
  const leave = { observation: "o", reasoning: "r", state: "away", from: "drinking", next_index: 0 };
  const none = { observation: "o", reasoning: "r", state: "away", from: null, next_index: -1 };
  const answers = [leave, leave, leave, none, leave, leave, none];
  pam = await startFakePamLlm({ predict: () => answers.shift()! });
  let now = 10_000;
  const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory, emit: () => {}, onDecision: () => {}, offsetMinutes: 540, clock: { now: () => now } });
  const call = async () => { d.onChanges([{ kind: "person_gone", at_ms: now, subject: "person", text: "사람 안 보임", meaningful: true }]); d.tick(); await d.idle(); };
  await call();                       // pam-1: drinking → * 컵 치우기, 실행 기록 없음(목표가 맡아 기록만)
  now += 6_000; await call();         // pam-2: 직전 상태 drinking, 같은 화살표를 다시 냄(처음 낸 때는 그대로)
  now += 6_000; await call();         // pam-3: 직전 상태 drinking, 또 같은 화살표
  now += 6_000; await call();         // pam-4: 처음 낸 때부터 18초 → 풀려 직전 상태 away(반복이 한도를 늘리지 않는다)
  await call();                       // pam-5: 다시 drinking → *
  await call();                       // pam-6: 직전 상태 drinking, 같은 화살표 반복
  d.onExecution("plan:pam-5", "running");   // 처음 판단(pam-5)의 실행이 시작돼도 푼다
  await call();                       // pam-7
  expect((pam.bodies as { last_state: string | null }[]).map((b) => b.last_state)).toEqual([null, "drinking", "drinking", "away", "away", "drinking", "away"]);
});
```

(pam-4는 처음 낸 때(pam-1)부터 15초가 지나 풀렸다. pam-6이 같은 화살표를 다시 냈어도 처음 판단 pam-5의 실행이 시작되면 다음 요청은 `away`다.)

```ts
// tests/world-decide.test.ts
describe("풀린 화살표의 늦은 답은 번호로 버린다", () => {
  const leave = { observation: "o", reasoning: "r", state: "away", from: "drinking", next_index: 0 };
  const none = { observation: "o", reasoning: "r", state: "away", from: null, next_index: -1 };
  async function run(between: (d: Decider, tick: (ms: number) => void) => void) {
    const answers = [leave, leave, none];
    pam = await startFakePamLlm({ predict: () => answers.shift()! });
    let now = 10_000;
    const records: DecisionRecord[] = [];
    const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory, emit: () => {}, onDecision: (r) => records.push(r), offsetMinutes: 540, clock: { now: () => now } });
    const send = () => { d.onChanges([{ kind: "person_gone", at_ms: now, subject: "person", text: "사람 안 보임", meaningful: true }]); d.tick(); };
    send(); await d.idle();                // pam-1: drinking → * 컵 치우기
    send();                                // pam-2를 보냄(답 전)
    between(d, (ms) => { now += ms; });
    await d.idle();                        // pam-2 답(같은 화살표)이 늦게 옴
    send(); await d.idle();                // pam-3
    return { records, lastStates: (pam.bodies as { last_state: string | null }[]).map((b) => b.last_state) };
  }
  it("같은 밀리초에 보낸 요청과 running이어도 그 답은 버린다(행동 없이 late, 직전 상태는 away)", async () => {
    const r = await run((d) => d.onExecution("plan:pam-1", "running"));
    expect(r.records[1]).toMatchObject({ id: "pam-2", action: null, late: true });
    expect(r.lastStates).toEqual([null, "drinking", "away"]);
  });
  it("계획이 끝나고 15초가 지난 뒤 온 늦은 답도 버린다(같은 일을 다시 시작하지 않는다)", async () => {
    const r = await run((d, tick) => { d.onExecution("plan:pam-1", "running"); d.onExecution("plan:pam-1", "done"); tick(20_000); });
    expect(r.records[1]).toMatchObject({ id: "pam-2", action: null, late: true });
    expect(r.lastStates).toEqual([null, "drinking", "away"]);
  });
});
```

```ts
// tests/brain-person.test.ts
describe("World State 하는 일 → 사람 상태", () => {
  const person = (o: Partial<WorldPerson>): Pick<WorldView, "person"> => ({ person: { visible: true, since_ms: 0, last_seen_ms: 1, count: 1, position: null, position_ms: null, room: null, room_label: null, near: [], holding: [], facts: {}, answered_ms: null, ...o } });
  const act = (v: string, at = 5) => ({ activity: { value: v, at_ms: at, since_ms: at, certainty: "confirmed" as const } });
  it("마시는 중이면 drinking, TV 보는 중이면 watching_tv, 안 보이면 away, 기억에 없는 활동은 임시 상태, 이번 등장 전 사실·다른 일은 null", () => {
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ facts: act("drinking") }))).toBe("drinking");
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ facts: act("watching_tv") }))).toBe("watching_tv");
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ visible: false }))).toBe("away");
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ since_ms: 10, facts: act("drinking", 5) }))).toBeNull();
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ facts: act("reading") }))).toBe("~reading");
    expect(stateOfWorld(CUP_FSM_MEMORY, person({ facts: act("other") }))).toBeNull();
  });
});
```

```ts
// tests/brain-thought.test.ts (이 파일의 decision(id, action, fsm) 도우미. rule 도우미는 아래 step으로 바꾼다)
const step = (o: Partial<FsmStep> = {}): FsmStep => ({ state: "away", from: null, next_index: -1, to: null, on: null, when: null, action: null, learned: false, ...o });
it("허락 문장은 판단이 낸 화살표에서 만든다: seed 화살표는 RULE_IF, 배운 화살표는 on·when을 줄이지 않고, 화살표 없음은 줄이 없다", () => {
  const leave = CUP_FSM_MEMORY.states[0]!.next[0]!;
  expect(decisionLines(decision("pam-1", "컵 치우기", step({ from: "drinking", next_index: 0, to: "*", on: leave.on, action: "컵 치우기" })))).toEqual(["컵을 두고 자리를 뜨면 치워도 된다고 하셨어요"]);
  expect(decisionLines(decision("pam-2", "사용자에게 물어보기", step({ from: "drinking", next_index: 2, to: "away", on: "사용자가 외출하러 나간다.", when: "같이 마시는 중이었다.", action: "사용자에게 물어보기", learned: true })))[0]).toMatch(/^사용자가 외출하러 나간다\. 같이 마시는 중이었다면 /);
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
  const owner = memory.states.find((s) => s.activity.includes(f.value));
  if (owner) return owner.id;
  // 기억에 없는 활동: 임시 상태(그날 기록으로 남아 반성이 배울 거리)
  return isTempState(memory, `${TEMP_STATE}${f.value}`) ? `${TEMP_STATE}${f.value}` : null;
}
```

```ts
// src/brain/decide.ts
/** 행동이 붙은 화살표를 낸 판단의 행동이 아직 시작되지 않았다(목표가 맡아 기록만 함·컵 확정 전 계획 전 검사가 막음 등): 그 출발 상태.
 *  풀릴 때까지 다음 요청의 직전 상태는 이 출발 상태라 PAM이 같은 화살표를 다시 낼 수 있다(Codex 8ab2d06 P2: 컵 확정 전 판단을 목표가 버리면 직전 상태가 이미
 *  away라 컵이 확정된 뒤 화살표가 없어 치우기가 시작되지 않았다). 처음 낸 때(at)와 화살표(from·next_index)는 지키고, 같은 화살표를 다시 낸 판단은
 *  계획 id만 더한다(Codex b28711d P2: 덮어쓰면 처음 계획의 running으로 풀리지 않고 5초마다 늘어 15초 한도가 끝나지 않았다).
 *  그 화살표의 어느 판단이든 실행이 시작되면(실행 기록 running·done), 다른 화살표가 오면, 처음 낸 때부터 PENDING_EDGE_MS가 지나면 푼다. */
private pending: { from: string; next: number; plans: Set<string>; at: number } | null = null;
/** 실행이 시작돼 푼 화살표와 그때까지 보낸 마지막 PAM 요청 번호. 그 번호 이하 요청의 같은 화살표 답(늦게 온 반복 답)은 통째로 버린다:
 *  pending도 되살리지 않고 행동도 실행 추적에 넘기지 않는다(판단 기록 late, 실행 기록 「앞선 판단」). 순서는 시각이 아니라 번호로 본다
 *  (Codex 26d2482·6802be0: 시각 비교는 같은 밀리초에서 놓치고, 계획이 끝나고 15초 뒤 온 늦은 답이 같은 일을 다시 시작할 수 있었다). */
private released: { from: string; next: number; seq: number } | null = null;

// 판단 받은 뒤
const step = mem.kind === "fsm" && "states" in mem.memory ? fsmStep(mem.memory, p) : null;
if (step) {
  const stale = this.released !== null && step.from === this.released.from && step.next_index === this.released.next && base.seq <= this.released.seq;
  if (stale) {
    // 늦은 답 전체를 버린다: 상태·pending을 바꾸지 않고 행동 없이 기록만(실행 추적은 late를 「앞선 판단」으로 남긴다)
    return this.finish({ ...base, status: "valid", prediction, action: null, fsm: step, late: true, ...(usage ? { usage } : {}) });
  }
  this.lastState = step.state;
  const same = this.pending !== null && step.from === this.pending.from && step.next_index === this.pending.next;
  if (same) this.pending!.plans.add(planIdOf(base.id));
  else if (step.from !== null && step.action !== null && action !== null) this.pending = { from: step.from, next: step.next_index, plans: new Set([planIdOf(base.id)]), at: now };
  else if (step.from !== null) this.pending = null;
}
this.finish({ ...base, status: "valid", prediction, action, fsm: step, ...(usage ? { usage } : {}) });

// 보낼 때
if (this.pending && now - this.pending.at > PENDING_EDGE_MS) this.pending = null;
const last = this.pending?.from ?? this.lastState;
this.o.pam.predict({ final_time: finalTime, observation_text: textSent, memory_kind: mem.kind, memory: mem.memory, tasks, last_state: last }, …);

/** 실행 기록(서버가 실행 추적 emit에서 넘긴다): 기다리던 화살표의 행동이 시작되면 푼다. */
onExecution(planId: string, state: ExecState): void {
  const p = this.pending;
  if (!p?.plans.has(planId) || (state !== "running" && state !== "done")) return;
  this.released = { from: p.from, next: p.next, seq: this.seq };   // 그때까지 보낸 마지막 요청 번호
  this.pending = null;
}
```

서버(`src/server/home/act.ts`)는 실행 추적 `emit`의 `execution` 기록을 `decide.onExecution(l.plan_id, l.state)`로도 넘긴다.

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

임시 상태(`~<값>`)의 이름은 `STATE_TEXT[값]`(예 「노트북 쓰는 중」). `FSM_STATE_TEXT`: `{ drinking: "먹거나 마시는 중", watching_tv: "TV 보는 중", cooking: "요리하는 중", away: "자리에 없음" }`(`left_cup` 지움). 화면 알약(`ui/src/dashboard/data.ts` `talkOf`, FSM 카드가 먼저 들어왔으면 그 카드 자료): 상태 = `FSM_STATE_TEXT[f.state] ?? f.state`, 트리거 = `f.on ?? WORDS.noTransition`(「화살표 없음」), 액션 = `f.action ?? WORDS.idle`. `WORDS.manyRules`·`noRule`·`unknown`(상태 모름)은 지운다. `events.ts`의 판단 기록 `fsm` 타입은 `FsmStep | null`.

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
      state: "drinking", index: 0, to: "*", on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", when: null, action: "컵 치우기",
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
   "The memory is a FINITE-STATE MACHINE of the PERSON's activities.\n- A STATE is one thing the person is doing that the camera can see (drinking, watching TV, using a laptop, cooking). It is never an object situation (a cup left behind, contents), a place alone, a robot action, or a time of day. When the person is not visible the state is `away`; `away` is also the `initial_state`. If the person does two things at once, the main one is the state and the other is a \"doing together\" condition. Add a new state only for a different activity, merge states that are the same activity, and keep at most 12 states. A state written as '~<activity value>' in today's decisions is an activity not in memory yet: add it as a new state if it is a different activity. `activity` lists the matching person activity values of the observation log; one value belongs to one state.\n- A TRANSITION in a state's `next` is (to, on, when, action): `on` is the person's change of activity, or a person event (speech, gesture) during the same activity for a self-transition; `when` is a person-side fact only (what the person was doing together, what the person said); `action` is the one task the robot does then. Object or home conditions (a cup remains, nobody touches it, contents) never go into the memory: the task's own checks handle them. `to: \"*\"` is moving to any other state and needs an action. In the instructions below, a RULE means a transition with an action, and its trigger is `on` plus `when`.\n- In one state, two transitions never share the same (`on`, `when`): one trigger has one action. Doing nothing (waiting, leaving an object as it is) is not an action: leave the transition out."
3. 「# Output」 JSON 블록 → 새 모양(「새 기억 모양」 절과 같은 칸, 값은 `<snake_case>`·`<one-sentence>`·`[<activity value>, ...]`·`[{"to": "<state_id or *>", "on": "<NL event>", "when": "<NL condition, optional>", "action": "<task name, optional>"}]`).
4. "- Ensure `initial_state` names one of the states, and every `next.to` references an\nexisting state id." → 끝에 " or \"*\""를 더한다.

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
// tests/history-habits.test.ts
describe("반성 뒤 검사(화살표)", () => {
  it("배운 화살표는 행동 있는 화살표 가운데 전에 없던 것이다", () => {
    const proposed = structuredClone(CUP_FSM_MEMORY);
    proposed.states[0]!.next.push({ to: "away", on: "사용자가 외출하러 나간다.", action: "사용자에게 물어보기" });
    expect(learnedEdges(CUP_FSM_MEMORY, proposed)).toEqual([{ from: "drinking", to: "away", on: "사용자가 외출하러 나간다.", when: null, action: "사용자에게 물어보기" }]);
  });
  it("코치 행동 화살표는 seed 그대로 지킨다(바뀐 것은 빼고 seed 것을 되돌린다)", () => {
    const proposed = structuredClone(CUP_FSM_MEMORY);
    const cook = proposed.states.find((s) => s.id === "cooking")!;
    cook.next[0] = { ...cook.next[0]!, on: "라면 얘기를 한다." };
    const out = coachGuard(CUP_FSM_MEMORY, proposed);
    expect(out.memory.states.find((s) => s.id === "cooking")!.next.filter((e) => e.action === "라면 끓이기 알려 주기")).toEqual([CUP_FSM_MEMORY.states.find((s) => s.id === "cooking")!.next[0]]);
    expect(out.notes).toContainEqual(expect.objectContaining({ from: "cooking", on: "라면 얘기를 한다.", kept: false, reason: "coach" }));
  });
  it("반성이 요리 상태 id를 바꿨으면 그 하는 일(cooking)을 가진 상태에 코치 화살표를 붙이고 seed cooking을 되살리지 않는다(코드 검사 통과)", () => {
    const proposed = structuredClone(CUP_FSM_MEMORY);
    const cook = proposed.states.find((s) => s.id === "cooking")!;
    cook.id = "making_food";
    cook.next = cook.next.filter((e) => !e.action);
    for (const s of proposed.states) for (const e of s.next) if (e.to === "cooking") e.to = "making_food";
    const out = coachGuard(CUP_FSM_MEMORY, proposed);
    expect(out.memory.states.map((s) => s.id)).not.toContain("cooking");
    expect(out.memory.states.find((s) => s.id === "making_food")!.next.filter((e) => e.action === "라면 끓이기 알려 주기")).toEqual([expect.objectContaining({ to: "making_food" })]);
    expect(validateMemory(out.memory, "fsm")).toBe(out.memory);
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
  /** seed 상태 id → 지금 기억에서 그 상태(같은 id, 없으면 그 seed 상태의 하는 일을 가진 상태 = 반성이 이름을 바꾼 상태). 없으면 null. */
  const hostOf = (seedId: string) => {
    const at = seed.states.find((s) => s.id === seedId);
    return states.find((s) => s.id === seedId) ?? (at ? states.find((s) => s.activity.some((a) => at.activity.includes(a))) : undefined) ?? null;
  };
  for (const c of seedCoach) {
    // 그 id 상태가 없으면 이름을 바꾼 상태에 붙이고, 도착(to)도 같은 규칙으로 바꾼다(Codex b28711d P2: 자기 화살표 to가 없는 cooking을 가리켰다). 아무도 안 가졌을 때만 seed 상태를 되살린다
    const seedFrom = seed.states.find((s) => s.id === c.from)!;
    const here = hostOf(c.from);
    const to = c.to === ANY_STATE ? ANY_STATE : hostOf(c.to)?.id ?? c.to;
    const edge: FsmEdge = { to, on: c.on, ...(c.when ? { when: c.when } : {}), action: c.action };
    if (here) {
      // 같은 (on, when)이 이미 있으면(반성이 그 트리거에 다른 행동을 둠) 그것을 seed 것으로 바꾼다: 트리거 하나에 행동 하나
      here.next = [...here.next.filter((e) => e.on !== c.on || (e.when ?? null) !== c.when), edge];
      continue;
    }
    const ids = new Set(states.map((s) => s.id));
    states.push({ id: seedFrom.id, description: seedFrom.description, activity: [...seedFrom.activity], next: [edge, ...seedFrom.next.filter((e) => !e.action && ids.has(e.to))] });
  }
  return { memory: { initial_state: proposed.initial_state, states }, notes };
}
```

`keepAll`은 `learnedEdges`로 같은 일을 한다. 하루 요약(`src/brain/history/summary.ts` `daySummary`)의 판단 줄에 그 판단의 사람 상태(`fsm.state`, 임시 상태 `~…` 포함)를 붙여 반성이 기억에 없던 활동을 본다. `reflect.ts`는 `learnedRules` → `learnedEdges`, `RuleLine` → `EdgeLine`. 화면 반성 줄(`ui/src/dashboard/data.ts` `reflectionThoughts`)은 `sentence(rule.when ?? rule.on)`. `scripts/demo-setup.ts` `rulesLine`은 `${x.from} → ${x.to}: ${x.on} → ${x.action}`.

- [ ] **Step 4: 정답 다시 쓰기와 통과 확인**

Run: `npm run heavy -- npx vitest run tests/pam-golden.test.ts -u`(반성 메시지 정답), `npm run heavy -- npx vitest run tests/history-habits.test.ts tests/history-reflect.test.ts tests/pam-golden.test.ts tests/pam-prompts.test.ts`, `npm run heavy -- npm --prefix ui run build`, `npm run heavy -- npm --prefix ui test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/brain/pam/scenarios/noonchi/scenario.json src/brain/history src/contract/events.ts src/server/home/index.ts ui/src/dashboard scripts/demo-setup.ts tests/history-*.test.ts tests/fixtures/pam-golden ui/tests/dashboard
git commit -m "feat(reflect): learn person states and transitions with actions from the day's flow"
```

---

### Task 7: 기억 뜻 검사(LLM)와 다시 반성 한 번

**Files:**
- Create: `src/brain/pam/memoryCheck.ts`, `src/brain/pam/scenarios/noonchi/memory_check.txt`
- Modify: `src/brain/pam/client.ts` (`PamClient.checkMemory`), `src/brain/history/reflect.ts` (흐름), `src/brain/history/labels.ts` (`REFLECT_TEXT.rejected`), `src/contract/events.ts`(반성 기록 `rejected`)
- Modify: `tests/helpers/pam.ts` (가짜 PAM LLM이 뜻 검사 요청에 답한다)
- Test: `tests/pam-memory-check.test.ts`(새), `tests/history-reflect.test.ts`

**Interfaces:**
- Consumes: Task 1 `FsmMemory`·`validateMemory`, Task 6 반성 흐름.
- Produces:
  - `interface MemoryVerdict { ok: boolean; items: { kind: "state" | "condition" | "merge"; ref: string; ok: boolean; why: string }[] }`
  - `parseVerdict(raw: string): MemoryVerdict`(엄격한 JSON: 칸이 정확하고, `ok`는 `items`가 모두 통과일 때만 참이어야 한다. 아니면 `ContractError`)
  - `PamClient.checkMemory(memory: FsmMemory, o?: { signal?: AbortSignal; onUsage?: (u: PamUsage) => void }): Promise<MemoryVerdict>` — PAM LLM 통로 한 번(같은 주소·같은 전송 값, `config/transport.json`의 반성 값). 답이 틀리면 거절 판정(`{ ok: false, items: [{ kind: "state", ref: "*", ok: false, why: "검사 답을 읽을 수 없음" }] }`).
  - `REFLECT_TEXT.rejected(why: string)` — 「반성 기억을 쓰지 않아요 · <까닭>」

뜻 검사 프롬프트(`memory_check.txt`, 이 저장소에서 만든 글이라 논문 해시 대상이 아니다):

```text
You check a person-activity finite-state machine that a household robot learned. Answer only with one JSON object.
Rules:
1. Each state is ONE thing the person is doing that a camera can see (drinking, watching TV, using a laptop, cooking, away). A state must not be an object situation (a cup left behind, contents), a place alone, a robot action, or a time of day. If the person does two things at once, the main one is the state and the other is a "doing together" condition.
2. Each transition condition (`when`) is a person-side fact only: what the person was doing together, or what the person said. Object or home conditions (a cup remains, nobody touches it, contents, temperature) are not allowed.
3. Two states that are the same activity in other words (for example "watching TV" and "TV viewing") must be merged.
Output: {"ok": <true only if every item is ok>, "items": [{"kind": "state" | "condition" | "merge", "ref": "<state id, or state id + '.next[' + index + ']', or 'id1+id2'>", "ok": <bool>, "why": "<one short Korean sentence>"}]}
List one item per state, one per transition that has `when`, and one per pair that should be merged.
```

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
// tests/pam-memory-check.test.ts
describe("기억 뜻 검사(LLM)", () => {
  it("엄격한 JSON만 받는다: ok는 항목이 모두 통과일 때만 참이다", () => {
    expect(parseVerdict(JSON.stringify({ ok: true, items: [{ kind: "state", ref: "drinking", ok: true, why: "마시는 일" }] }))).toEqual({ ok: true, items: [{ kind: "state", ref: "drinking", ok: true, why: "마시는 일" }] });
    expect(() => parseVerdict(JSON.stringify({ ok: true, items: [{ kind: "state", ref: "left_cup", ok: false, why: "물건 상황" }] }))).toThrow(/ok/);
    expect(() => parseVerdict("```json\n{}\n```")).toThrow();
    expect(() => parseVerdict(JSON.stringify({ ok: true, items: [], extra: 1 }))).toThrow(/incorrect fields/);
  });
  it("PAM LLM 통로로 부르고(같은 가짜 서버), 기억 JSON을 넘긴다", async () => {
    const pam = await startFakePamLlm({ check: (v) => ({ ok: v.memory.states.every((s: { id: string }) => s.id !== "left_cup"), items: [] }) });
    const verdict = await pamClientFor(pam).checkMemory(CUP_FSM_MEMORY);
    expect(verdict.ok).toBe(true);
    expect(pam.bodies.at(-1)).toMatchObject({ role: "check" });
    await pam.close();
  });
});
```

```ts
// tests/history-reflect.test.ts
describe("반성 → 코드 검사 → 뜻 검사", () => {
  const LEFT = () => { const m = structuredClone(CUP_FSM_MEMORY); m.states.splice(3, 0, { id: "left_cup", description: "사용자가 컵을 두고 떠났다.", activity: ["putting_away"], next: [] }); return m; };
  it("뜻 검사가 거절하면 까닭을 피드백에 붙여 한 번 다시 반성하고, 다시 낸 기억이 통과하면 그것을 쓴다", async () => {
    const asked: (string | null)[] = [];
    const answers = [LEFT(), CUP_FSM_MEMORY];
    const pam = await startFakePamLlm({
      reflect: (v) => { asked.push(v.feedback); return answers.shift()!; },
      check: (v) => (v.memory.states.some((s: { id: string }) => s.id === "left_cup")
        ? { ok: false, items: [{ kind: "state", ref: "left_cup", ok: false, why: "컵 상황은 사람이 하는 일이 아니다" }] }
        : { ok: true, items: [] }),
    });
    const db = dayWithLog();
    const r = await runReflection(db, pamClientFor(pam), DAY);
    expect(r).toMatchObject({ ok: true });
    expect(asked[1]).toContain("컵 상황은 사람이 하는 일이 아니다");
    await pam.close();
  });
  it("반성 답이 기억 모양부터 틀리면(옛 모양 rules) 그 까닭을 피드백에 붙여 한 번 다시 반성한다", async () => {
    const asked: (string | null)[] = [];
    const OLD = { initial_state: "away", states: [{ id: "away", description: "d", rules: [], next: [] }] };
    const answers: unknown[] = [OLD, CUP_FSM_MEMORY];
    const pam = await startFakePamLlm({ reflect: (v) => { asked.push(v.feedback); return answers.shift()!; }, check: () => ({ ok: true, items: [] }) });
    const r = await runReflection(dayWithLog(), pamClientFor(pam), DAY);
    expect(r).toMatchObject({ ok: true });
    expect(asked[1]).toMatch(/incorrect fields/);
    await pam.close();
  });
  it("다시 낸 기억도 거절이면(코드 검사든 뜻 검사든) 새 판본을 저장하지 않고 까닭을 반성 기록에 남긴다", async () => {
    const pam = await startFakePamLlm({ reflect: () => LEFT(), check: () => ({ ok: false, items: [{ kind: "state", ref: "left_cup", ok: false, why: "물건 상황" }] }) });
    const db = dayWithLog();
    const before = db.latestMemoryVersion();
    const r = await runReflection(db, pamClientFor(pam), DAY);
    expect(r).toMatchObject({ ok: false });
    expect(db.latestMemoryVersion()).toBe(before);
    expect(db.list({ kinds: ["reflection"] }).at(-1)!.text).toContain("물건 상황");
    await pam.close();
  });
});
```

(`dayWithLog`·`DAY`는 이 파일의 지금 도우미다. 가짜 PAM LLM은 시스템 글로 판단·반성·뜻 검사를 가른다: `tests/helpers/pam.ts`의 `unrender`에 `memory_check.txt`를 더한다.)

- [ ] **Step 2: 실패 확인**

Run: `npm run heavy -- npx vitest run tests/pam-memory-check.test.ts tests/history-reflect.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// src/brain/history/reflect.ts (runReflection 안, Task 6의 거르기 뒤)
/** 반성 한 번 + 코치 화살표 지키기·습관 거르기 + 코드 검사 + 뜻 검사. 거절이면 까닭 글. */
const attempt = async (feedback: string | null): Promise<{ memory: FsmMemory; why: null } | { memory: null; why: string }> => {
  let memory: FsmMemory;
  try {
    // 반성 답의 모양 오류(PamClient.reflect가 PamAnswerError로 던짐)도 코드 검사 거절과 같이 까닭으로 받아 한 번 다시 반성한다(Codex 8ab2d06 P2)
    const raw = await pam.reflect({ ...req, feedback }, "fsm", call);
    memory = await afterReflect(raw);   // coachGuard → filter → coachGuard → validateMemory(코드 검사)
  } catch (e) {
    if (e instanceof ContractError) return { memory: null, why: e.message };   // PamAnswerError·코드 검사. 연결 오류(PamLinkError)는 그대로 던진다
    throw e;
  }
  const verdict = await pam.checkMemory(memory, call);
  return verdict.ok ? { memory, why: null } : { memory: null, why: verdict.items.filter((x) => !x.ok).map((x) => `${x.ref}: ${x.why}`).join(" / ") };
};
let got = await attempt(feedback);
if (got.why !== null) got = await attempt([feedback, `기억 검사 까닭: ${got.why}`].filter(Boolean).join("\n"));
if (got.why !== null) {
  done(false, REFLECT_TEXT.rejected(got.why), null, null);
  return { ok: false, error: got.why };
}
```

`afterReflect`는 Task 6의 「반성 뒤 검사」(코치 화살표 지키기 → 거르기 → 코치 화살표 지키기 → `validateMemory`)를 함수로 뺀 것이다. `memoryCheck.ts`는 `adaptedTemplate` 대신 `memory_check.txt`를 읽어 `{ role: "system", content }`와 사용자 글 `Memory:\n<JSON>`으로 PAM LLM을 부르고(`llm.ts`의 반성 호출과 같은 함수, 같은 생성 설정), 답을 `parseVerdict`로 읽는다. 반성 기록 data에 `rejected: string | null`을 싣는다.

- [ ] **Step 4: 통과 확인**

Run: `npm run heavy -- npx vitest run tests/pam-memory-check.test.ts tests/history-reflect.test.ts tests/same-structure.test.ts tests/pam-llm.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/brain/pam/memoryCheck.ts src/brain/pam/scenarios/noonchi/memory_check.txt src/brain/pam/client.ts src/brain/history src/contract/events.ts tests/helpers/pam.ts tests/pam-memory-check.test.ts tests/history-reflect.test.ts
git commit -m "feat(reflect): check the reflected memory's meaning with the PAM LLM and reflect once more on rejection"
```

---

### Task 8: 「컵 그대로 두기」 빼기

사용자 답: 안 하기는 화살표 없음이라 행동 목록에서 뺀다.

**Files:**
- Modify: `src/act/tasks.ts`(`TASKS`·`TASK_NAMES`에서 지움, `plan?: false` 칸과 쓰는 곳), `src/brain/pam/scenarios/noonchi/tasks.json`, `src/brain/pam/scenarios/noonchi/scenario.json`(반성 action 이름 줄), `src/act/labels.ts`(`TASK_SAY`·계획 없는 행동 글), `src/act/say.ts`(그대로 두기 말), `src/act/track/start.ts:67`(계획 없는 행동 갈래), `src/act/track/tracker.ts:4`(머리 설명)
- Test: `grep -rl "컵 그대로 두기" tests ui/tests`(지금 36개)에서 행동 목록 자료를 고친다, `tests/pam-scenario.test.ts`, `tests/act-tasks.test.ts`

- [ ] **Step 1: 실패하는 시험 쓰기** (`tests/act-tasks.test.ts`)

```ts
it("행동 목록에는 안 하기 행동이 없다(안 하기는 화살표 없음)", () => {
  expect(TASK_NAMES).not.toContain("컵 그대로 두기");
  expect(Object.values(TASKS).some((t) => "plan" in t)).toBe(false);
});
```

- [ ] **Step 2: 실패 확인** — `npm run heavy -- npx vitest run tests/act-tasks.test.ts`. Expected: FAIL
- [ ] **Step 3: 구현** — 위 파일에서 「컵 그대로 두기」와 `plan: false` 갈래(에이전트를 부르지 않고 기록만 하던 길, `say.ts`의 그대로 두기 말)를 지운다. 행동 번호가 앞으로 당겨지는 것은 괜찮다(`task_index`는 서버가 만든다, Task 3). 시험 자료의 행동 목록을 고친다.
- [ ] **Step 4: 통과 확인** — `npm run heavy -- npx tsc --noEmit -p .`, `npm run heavy -- npx vitest run tests/act-tasks.test.ts tests/pam-scenario.test.ts tests/act-say.test.ts tests/act-track.test.ts`, `npm run heavy -- npm --prefix ui test`. Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(act): drop the keep-cup task; doing nothing is no transition"`

---

### Task 9: 합성 일주일 기록을 새 모양으로 다시 쌓기·기록 정답·e2e

사용자 답: 기억은 합성 기록에서 나온 것이라 옮기지 않고 합성 데이터를 새 모양으로 다시 만든다. 새 규칙에서 내용물(빈 컵·남은 음료)·시간(아침·밤)은 상태도 조건도 아니다: 합성 이야기는 「컵을 두고 떠나면 묻기 → 사용자가 치워 달라고 답한 뒤(4일째부터) 치우기」로 바꾸고, 내용물은 실행 전 검사가, 시간 습관은 습관 거르기(`HabitFilter` 조건)가 맡는다.

**Files:**
- Modify: `scripts/seed-history.ts:403-450` (`PAST_SEED`·`memoryAfter`를 새 모양으로, 합성 판단 글)
- Modify: `scripts/demo-setup.ts:40,277-284` (`SEED_RULES` → 화살표)
- Modify: `scripts/twin3d/fake-run.ts` (판단 `fsm`)
- Test: `tests/seed-history.test.ts`, `tests/demo-e2e.test.ts`, `tests/history-api.test.ts`, `tests/fixtures/history-golden/*`(정답 다시 쓰기), `tests/goal-e2e.test.ts`

**Interfaces:**
- Consumes: Task 1~8.
- Produces: `PAST_SEED: FsmMemory`, `memoryAfter(i, h, habit?): FsmMemory`(둘 다 코드 검사 통과).

- [ ] **Step 1: 실패하는 시험 쓰기** (`tests/seed-history.test.ts`)

```ts
it("합성 일주일의 기억 판본은 모두 새 모양이고 상태는 seed 넷, 떠날 때 행동은 3일째까지 묻기·4일째부터 치우기다", () => {
  const db = seedWeek();
  for (const v of db.memoryVersions()) {
    expect(isOldFsm(v.memory)).toBe(false);
    expect((validateMemory(v.memory, "fsm") as FsmMemory).states.map((s) => s.id)).toEqual(["drinking", "watching_tv", "cooking", "away"]);
  }
  const leave = (i: number) => memoryAfter(i, HOME).states.find((s) => s.id === "drinking")!.next.find((e) => e.to === "*")!.action;
  expect([0, 1, 2].map(leave)).toEqual(["사용자에게 물어보기", "사용자에게 물어보기", "사용자에게 물어보기"]);
  expect([3, 6].map(leave)).toEqual(["컵 치우기", "컵 치우기"]);
  expect(memoryAfter(6, HOME, true).states.find((s) => s.id === "watching_tv")!.next.filter((e) => e.action === "에어컨 켜기")).toHaveLength(2);
});
```

(`seedWeek`·`HOME`은 이 파일의 지금 도우미·집 자료다.)

- [ ] **Step 2: 실패 확인** — `npm run heavy -- npx vitest run tests/seed-history.test.ts`. Expected: FAIL
- [ ] **Step 3: 구현**

```ts
// scripts/seed-history.ts
/** 습관 전 seed: 마시는 중에서 떠날 때 치울지 묻는다(합성 일주일 앞 사흘). */
export const PAST_SEED: FsmMemory = {
  ...CUP_FSM_MEMORY,
  states: CUP_FSM_MEMORY.states.map((s) => ({
    ...s, activity: [...s.activity],
    next: s.next.map((e) => (s.id === "drinking" && e.to === ANY_STATE ? { ...e, action: "사용자에게 물어보기" } : { ...e })),
  })),
};

/** i번째 날 반성이 남기는 기억. 상태는 seed 넷 그대로. 4일째(i ≥ 3)부터 사용자가 치워 달라고 답한 것을 배워 떠날 때 치운다.
 *  habit이면 TV를 보기 시작할 때 말없이 에어컨을 켜는 화살표를 더한다. 시간 습관(평일 7시 커피, 밤에는 묻지 않기)은 설명에만 적는다. */
export function memoryAfter(i: number, h: Pick<HomeInfo, "table" | "side" | "livingAc">, habit = false): FsmMemory {
  const m = structuredClone(PAST_SEED);
  const state = (id: string) => m.states.find((s) => s.id === id)!;
  const drink = state("drinking");
  if (i >= 3) drink.next.find((e) => e.to === ANY_STATE)!.action = "컵 치우기";
  if (i >= 1) drink.description += ` ${i >= 5 ? "평일 7시쯤, 주말 8시 40분쯤" : "평일 7시쯤"} 일어나 ${h.table.label}에서 커피를 마신다.`;
  if (i >= 1) state("away").description = `평일 8시 30분쯤부터 18시 30분쯤까지 사용자가 집에 없다.${i >= 4 ? " 금요일에는 21시쯤 돌아오기도 한다." : ""} 22시가 넘으면 폰으로 묻지 않기를 바란다.`;
  if (habit) state("watching_tv").next.push({ to: "watching_tv", on: "사용자가 소파에 앉아 TV를 보기 시작한다.", action: "에어컨 켜기" });
  return validateMemory(m, "fsm") as FsmMemory;
}
```

합성 판단 글: 「left_cup 규칙대로」 → 「마시는 중에서 떠나는 화살표대로」, 「drinking 단계로 돌아와」 → 「마시는 중으로 돌아와」, 「watching_tv 규칙대로」 → 「TV 보는 중 화살표대로」. 사흘째까지 떠날 때의 판단은 「사용자에게 물어보기」, 넷째 날부터 「컵 치우기」, 그대로 두기를 고르던 판단은 대기. `scripts/demo-setup.ts`의 `SEED_RULES`는 `CUP_FSM_MEMORY.states.flatMap((s) => s.next.filter((e) => e.action).map((e) => ({ trigger: e.on, action: e.action! })))`, `rulesLine`은 `${x.from} → ${x.to}: ${x.on} → ${x.action}`.

- [ ] **Step 4: 기록 정답·e2e** — `npm run heavy -- npx vitest run tests/demo-e2e.test.ts -u` 뒤 `git diff tests/fixtures`(판단 `fsm` 칸·반성 `learned` 모양·합성 기억만 바뀌고 메시지 상자 허락 문장·행동 줄은 그대로인지 본다), `npm run heavy -- npx vitest run tests/seed-history.test.ts tests/demo-e2e.test.ts tests/history-api.test.ts tests/goal-e2e.test.ts`. Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "chore(demo): rebuild the synthetic week and history goldens in the person-activity FSM"`

---

### Task 10: FSM 카드 맞춤 (`feat/fsm-card`가 main에 들어간 뒤)

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
  expect(h.states.map((s) => s.name)).toEqual(["먹거나 마시는 중", "TV 보는 중", "요리하는 중", "자리에 없음"]);
  expect(h.next).toContainEqual({ from: "drinking", to: "*", on: "컵을 두고 자리를 뜨면", when: null, action: "컵 치우기", learned: false });
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

화면 `fsmViewOf`(카드 갈래 `ui/src/dashboard/fsm.ts`)는 `rules` 대신 `next`를 읽는다: 지금 상태 원은 판단 `fsm.state`, 켠 선은 `from === fsm.from && 원래 on 순서 === fsm 화살표` 하나(서버가 `HabitFsm.next`를 기억 차례 그대로 싣고, 판단 `fsm`의 `from`·`next_index`로 `next`에서 그 상태의 `next_index`번째를 찾는다). `"*"` 화살표는 그 상태에서 나가는 짧은 선(도착 원 없음), 위에 행동 글. 지금 상태가 임시 상태(`~…`)면 그 하는 일 이름(`STATE_TEXT`) 원 하나를 지금 상태로 더한다(기억 상태가 아니라 나가는 화살표가 없다).
- [ ] **Step 4: 통과 확인** — `npm run heavy -- npx tsc --noEmit -p .`, 위 두 시험, `npm run heavy -- npm --prefix ui run build`, `npm run heavy -- npm run lint`. Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(dashboard): FSM card draws person states and action transitions, lighting the decided one"`

---

### Task 11: 문서·SSOT

**Files:**
- Modify: `docs/reference.md`(판단·목표·반성 줄), `docs/pam-interface.md`(`pam-predict/3`·`pam-reflect/3`, 「박석준과 맞출 것」), `src/brain/pam/README.md`(표의 기억 모양 줄)
- Modify (docs 저장소): `01_Product/구현명세서 SSOT.md` 5.9 Rule·5.10 Decision·6.3 PAM 판단·미리 세운 목표·6.12 PAM, `변경이력.md`

- [ ] **Step 1:** 이 저장소 문서 셋을 위 「새 기억 모양」·「PAM 판단 답」 절 그대로 고친다(판단 답 칸, 서버가 행동을 만든다, 거꾸로 찾기 없음, 안 하기는 화살표 없음, 옛 기억 읽기).
- [ ] **Step 2:** SSOT: 이 문서의 「사람 FSM 만드는 규칙」 절(검사 둘·흐름 포함)을 6.12 PAM 앞에 같은 글로 두고, 5.9 Rule을 「화살표(상태·트리거·조건 → 행동)」로, 5.10 Decision에 `state`·`from`·`next_index`·`fsm`(FsmStep), 6.3 PAM 판단 출력과 seed FSM 설명, 미리 세운 목표 문단(지금 상태에서 나가는 화살표), 6.12 계약 이름. 판을 1.27에서 1.28로 올리고 `변경이력.md`에 한 줄.
- [ ] **Step 3:** `npm run heavy -- npm run lint`, 전체 시험 `npm run heavy -- npx vitest run`(부하 실패는 따로 다시).
- [ ] **Step 4: 커밋** — 이 저장소 `git commit -m "docs: person-state FSM memory, pam-predict/3 and goals"`, docs 저장소 `git commit -m "docs: 구현명세서 SSOT 1.28 (사람 상태 FSM), 변경이력"`.

---

## 속도 영향 (2026-11-18 d1·59447ec 영상 기준)

| 무엇 | 지금 | 바꾼 뒤 | 까닭 |
|---|---|---|---|
| 사람 떠남 → 첫 명령 | 유리컵 3.1초·키 큰 컵 1.9초·머그 1.6초 | 같음, 묶음마다 3.3초 안·+0.3초 안 | 묶음 A: 같은 길(PAM 확인 한 번 + 미리 만든 계획). B: 토픽 내기만. C·D·E: 같은 프로세스 함수 부르기(새 기다림 없음). F: 판단 → 관리자 → 로봇 → 폰 토픽 두 번 더 지남(RedisBus 한 번 1~3ms, 예산 50ms) |
| 목표가 서는 때 | 4.2~4.5초 | 같음 | 상태를 World State 하는 일(마시는 중)로 바로 정한다. PAM 답만 기다리면 첫 판단(7.3·7.5·12.1초)까지 3~8초 늦다 |
| 처음 상태가 다를 때 목표 | 못 세움(직전 맞은 규칙이 `watching_tv`면) | 세움 | 상태마다 나가는 화살표를 본다 |
| PAM 판단 한 번 | 1.6~2.4초 | 약 +0.05초 안 | seed 기억 JSON 3,267 → 2,635바이트(물건 조건·「그대로 두기」가 빠짐), 바뀐 프롬프트 문장 약 +1KB, 판단 입력 약 16.3 → 16.7KB(+2%). 출력은 `state`·`from`·`next_index` 약 15토큰 늘고 `task_index`는 빠진다 |
| 반성 한 번 | 하루 한 번 PAM 반성 1번 | 반성 1번 + 뜻 검사 1번(거절이면 반성·검사 한 번 더) | 하루 한 번이라 판단 속도에 영향 없음. 뜻 검사 입력은 기억 JSON(약 3KB)과 프롬프트 |
| 비상 → 로봇 멈춤 | 다음 판단이 바꿀 때까지(5초 안팎) | 한 tick(250ms) 안 | 묶음 C |
| 쓰러짐 의심 → 비상 | 바로(쓰러짐 의심 = 비상) | 말 답이 없으면 약 21초 뒤(가기 빼고), 도움 말이면 바로 | 사용자 결정: 가서 묻고 답이 없으면 올림. 그사이 하던 일은 멈춰 있다 |
| 화면 알약 | 「규칙 여럿」·「상태 모름」이 뜸 | 늘 상태 하나, 켠 화살표 하나 또는 화살표 없음 | 거꾸로 찾기를 없앤다 |

## 팀 영향: PAM을 맡은 팀원(박석준)이 보는 곳

1. 기억 모양과 코드 검사: `src/brain/decision.ts` `FsmMemory`·`validateMemory`(상태 안 `rules` 없음, `activity`, 화살표 `when`·`action`, `"*"`, 같은 (출발·사건·조건) 거절, 목록 밖·안 하기 행동 거절, 상태 12개, `away` 처음 상태). 「사람 FSM 만드는 규칙」 절이 기준이다.
2. 판단 계약 `pam-predict/3`: 요청 `last_state`, 답 `state`·`from`·`next_index`(`task_index` 칸 없음, 서버가 만든다). 답 검사 `validateFsmPrediction`.
3. 반성 계약 `pam-reflect/3`과 반성 흐름: 같은 기억 모양을 내고, 뒤에 코드 검사·뜻 검사(`PamClient.checkMemory`, `memory_check.txt`)가 붙으며, 거절이면 까닭이 피드백으로 한 번 더 온다. 프롬프트 바꿈은 `scenario.json`에만 있다.
4. 습관 거르기 자리 `HabitFilter`(`src/brain/history/habits.ts`): 입력·출력이 새 모양 기억, 줄이 `EdgeLine`·`HabitRuleNote`(`from`·`to`·`on`). 시간·요일 같은 조건은 FSM `when`이 아니라 여기 결과(`conditions`)로만 둔다.
5. PAM 행동 목록은 묶음 E부터 관리자(`/manager/state`)가 정한다(지금 `pamTasks`와 같은 값). 「컵 그대로 두기」가 빠져 번호가 당겨진다.
6. 묶음 B~F의 로봇·목표·안전 기계는 PAM을 바꾸지 않는다. 판단은 지금처럼 `/brain/decision`으로 나가고, 관리자가 받아 로봇에 넘긴다.
7. ai 저장소(Python PAM)·vLLM 학습 자료: 이 저장소 판단은 TypeScript지만, 그쪽 시험·학습 자료가 옛 모양이면 같은 검사·답 모양으로 맞춘다. `docs/pam-interface.md` 「박석준과 맞출 것」에 1~7을 더한다.

## 사용자 답 (2026-11-18)

| 물음 | 답 | 계획에서 |
|---|---|---|
| 상태 목록 | 넷으로 시작. 반성은 다른 활동만 새 상태, 「노트북 보며 마시는 중」 같은 조합은 상태가 아님, 비슷한 상태는 합침, 12개 상한 | 「사람 FSM 만드는 규칙」 1·5, Task 1(12개), Task 6·7(반성 프롬프트·뜻 검사) |
| 자리에 없음 | 하나(안 보이면 자리에 없음) | `away`, 처음 상태 |
| 옛 기억 | 옮기지 않음, 합성 데이터를 새로 쌓음 | Task 2(새 seed로 다시 시작 한 줄), Task 9 |
| 상태 잇기 | World State 하는 일과 바로 이음 | `activity`, `stateOfWorld`(Task 4·5) |
| 「컵 그대로 두기」 | PAM 행동 목록에서 뺌 | Task 8 |
| 기억 밖 행동 | 화살표 행동만, 기억에 없는 일은 말 부탁 길 | Task 3 답 검사 |
| 컵 있음 | 사람 상태도 화살표 조건도 아님(바로잡음) | 「사람 FSM 만드는 규칙」 2·3, seed |
| 검사 | 코드 검사(모양)와 LLM 검사(뜻)로 나눔 | Task 1, Task 7 |

## 사용자 답 (네 기계, 2026-11-18)

| 물음 | 답 | 계획에서 |
|---|---|---|
| 합성 이야기 | 바뀐 이야기(떠나면 처음엔 묻고 → 4일째부터 바로 치우기) | Task 9 |
| 안전 「의심」 | 가서 「괜찮으세요?」를 묻고 말 답이 없으면 비상으로 | 「쓰러짐 확인」, 묶음 C |
| 로봇 실행 기계 상태 화면 | 보이지 않음 | 상태 토픽·기록·시각표만 |
| 묶음 F | `refactor/stage-queue` 묶음 3·4 뒤 | 작업 묶음 표 |
| 말 부탁과 손대는 단계 | 그 단계 뒤로 미룸 | 관리자 |
| 말 대화 답 | 로봇 실행 기계 밖 | 「실제 폰 명령은 로봇 실행 기계 하나만」 |
| 뜻 검사 모델 | PAM LLM 그대로 | Task 7 |
