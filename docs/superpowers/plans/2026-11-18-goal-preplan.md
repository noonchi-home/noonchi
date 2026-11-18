# 미리 세운 목표: 쓰는 것을 볼 때 다음 할 일 계획해 두기 Implementation Plan

> **쉬운 요약**
> 1. 사람이 컵으로 마시는 것을 보면, 배운 습관(FSM)을 한 걸음 앞서 읽어 「컵을 두고 떠나면 컵 치우기」를 목표로 세워요. 메시지 상자에 「컵을 두고 자리를 뜨면 컵을 치울게요」 한 줄과 「목표 · 컵 치우기」 알약이 떠요.
> 2. 사람이 아직 마시는 동안 같은 계획 모드로 계획을 미리 만들어 둬요. 폰에는 아무것도 보내지 않아요(관찰만).
> 3. 사람이 떠나면(컵은 그대로) PAM을 바로 부르고, PAM이 「컵 치우기」를 고르면 미리 만든 계획을 지금 World State로 다시 검사해 바로 첫 명령을 보내요. 계획 모드를 다시 부르지 않아요.
> 4. 들고 나감·다시 나타남·컵이 옮겨짐·다른 판단·안전 알림·코치 모드·시간 넘음이면 목표를 버리고 지금 길(PAM 판단 → 계획 모드)로 돌아가요.
> 5. 사람이 떠난 뒤 첫 명령까지 지금 7~14초 → 약 1.0~1.9초(PAM 확인 한 번 + 판단 타이머 한 번).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사람이 손대는 행동의 대상을 쓰는 동안 습관 FSM 한 걸음 앞 규칙을 목표로 세우고 계획을 미리 만들어, 사람이 떠나면 1~2초 안에 첫 명령을 낸다.

**Architecture:** 고르기는 판단 쪽 순수 함수(`src/brain/goal.ts` `goalAhead`)가 FSM 기억과 지금 상태로 한다. 세우기·미리 만들기·사람이 떠남 보기·버리기는 실행 추적의 새 부분 `GoalWatch`(`src/act/track/goal.ts`)가 쓰는 중 지킴(`use.ts`) 옆에서 한다. 미리 만들기는 지금과 같은 계획 모드(`o.planner`)를 일찍 부르는 것이고, 쓸 때는 모델이 낸 `submit_plan` 인자를 지금 맥락으로 계획 검사(`PlanDraft`)에 다시 넣는다(`resubmit`). 목표는 STATE 토픽 `/brain/goal`에 실려 녹화되고, 대시보드는 같은 모양을 `{type:"goal"}`로 받는다.

**Tech Stack:** Node 22 TypeScript, zod 4.6.5, Vitest, 가짜 OpenAI 서버(`scripts/fake-openai.ts`), 가짜 PAM LLM(`tests/helpers/pam.ts`), React 대시보드(`ui/`, 21st.dev Status 부품).

**Spec:** 사용자 결정(2026-11-18, 조정자 전달) 「컵을 마시는걸 볼때 저걸 다 마시면 치워야겠다는 목표를 세우고 사용자가 사라지면 관련된 행동을 계획하고 실행하는구조」. 바탕 계획: `docs/superpowers/plans/2026-11-17-stage-queue.md`(토픽·QoS·노드, 묶음 3·4), `docs/superpowers/plans/2026-11-18-vlm-objects.md`(World State 물건은 VLM 답으로, 다른 에이전트가 진행 중). 저장소 규칙 표 `CLAUDE.md`.

## 정한 것 (2026-11-18, 사용자)

1. 사람이 물건을 쓰는 것을 볼 때(예: 컵으로 마심) 습관 FSM을 한 걸음 앞서 읽어, 다음에 올 트리거의 규칙(컵을 두고 떠남 → `left_cup` → 「컵 치우기」)을 목표로 세운다.
2. 그 목표의 계획을 미리 만든다(계획 모드는 지금도 `submit_plan` 한 번으로 계획 전체를 낸다. 지금은 계기 뒤 5~10초).
3. 계기(사람 사라짐, 컵은 그대로·안 건드림)가 오면 미리 만든 계획을 지금 World State로 다시 검사하고(지금 계획 검사) 첫 명령을 바로 낸다. 목표: 사람이 사라진 것이 확정된 뒤 1~2초 안에 첫 명령(지금 r7 7초, r8 14초. 예: 사람 사라짐 15.6초 → PAM 17.2초 → 계획 22.5초 → 첫 명령 22.6초).
4. 맞지 않게 되면 목표를 버리고 지금 길로 돌아간다: 컵을 들고 나감, 금방 돌아옴, 컵이 옮겨짐, 다른 판단·계획이나 안전 사건이 맡음.
5. 대시보드 메시지 상자가 미리 세운 목표를 보인다(줄이나 알약, 예 「목표 · 다 마시면 컵 치우기」). 메시지 상자 줄은 사실로만, 로봇 말(「컵을 치울게요」). 실제 폰 명령만 「~해 주세요」.
6. 안전(쓰러짐 의심·켠 위험 가전 끄기 안내)과 사람 요청(말)은 늘 목표보다 먼저다.
7. 규칙으로 계획을 만들지 않는다: 미리 만든 계획도 같은 계획 모드에서 나온다(`tests/same-structure.test.ts`).
8. 트윈 성능(사건 → 행동 시간)이 먼저다. 새로 기다리는 시간을 넣지 않고, 증거 수(등장 2초, 사람 사라짐 4초, 내용물 3장)는 그대로 둔다.

## 사용자 답과 Codex 검토 반영 (2026-11-18, 26bff0f 뒤)

이 절이 아래 Task 글과 다르면 이 절이 맞다. 바탕은 `refactor/stage-queue` 0371f2a(VLM으로만 물건, 화면 최신)를 합친 d4aa515다.

**사용자 답:**

| 질문 | 답 | 계획에서 |
|---|---|---|
| 떠난 뒤 PAM 확인 | PAM이 한 번 더 확인한 뒤 실행(기본안) | 그대로(Task 5) |
| 메시지 상자 문장 | 「컵을 두고 자리를 뜨면 컵을 치울게요」 | 조건은 합친 코드의 `ruleIf`(`src/world/labels.ts`, 시연 규칙은 `RULE_IF`)로 만든다. `FSM_STATE_IF`는 합친 코드에서 없어졌다 |
| 목표를 들고 있는 시간 | 30분 | `GOAL_DEFAULTS.armMs` 30분 |
| 떠난 뒤 PAM이 안 고르면 | 15초 뒤 버림 | `GOAL_DEFAULTS.fireWaitMs` 15초(대기 판단만 이어질 때). 다른 행동을 고르면 그 일이 맡으므로 바로 버린다 |
| 처음 하는 일 승인 | 「proactive를 위해 알아서 판단하는 것 위주로 보여주자. 지금은 그냥 실행」 | 미리 세운 목표로 시작한 실행은 첫 단계 전 승인을 묻지 않는다(`Run.goal`이 있으면 `Approvals.need`가 null). 위험 목록(현관 잠금 해제, 인덕션·전자레인지 켜기 등)은 안전 규칙이라 그 단계에서 지금처럼 늘 묻는다. 일반 승인 규칙은 다른 에이전트가 바꾼다(그때 `CLAUDE.md` 승인 줄에 이 예외를 함께 적는다) |

**Codex 검토(26bff0f, P2 일곱):**

| # | 지적 | 반영 |
|---|---|---|
| Task 4:910 | 목표 컵 id를 계획 입력·반환 검사에 묶지 않아 컵 둘이면 다른 컵 계획을 저장할 수 있음 | `PlanAhead`에 `object`(목표 물건 id)를 싣고 계획 입력 줄에 넣는다. 계획 검사(`PlanDraft.finish`)는 `ahead`가 있으면 같은 종류의 다른 World State 물건을 쓰는 단계(물건·대상·끝 조건)를 「미리 세운 목표의 물건은 cup_1입니다」로 버린다(모델이 고쳐 다시 낸다). `GoalWatch`도 받은 계획의 그 종류 물건(`planObjectsOf`)이 목표 물건뿐인지 본 뒤에만 준비됨으로 둔다 |
| Task 5:1252 | 떠나기 전에 보낸 PAM 답도 받아 씀 | `take`는 `d.atMs >= gone_ms`인 판단만 받는다. 그보다 앞선 같은 행동 판단은 `holds`가 맡아 기록만 한다(「다 쓰고 떠나면 할 일로 두었어요」). 목표 id가 세대다(버리면 새 목표는 새 id) |
| Task 4:922 | 떠난 뒤 미리 만들기가 끝나면 fired를 ready로 되돌림 | 상태를 둘로 나눈다: `status`(armed·fired·used·dropped, 관찰 단계)와 `prep`(waiting·planning·ready·failed, 미리 만들기). 미리 만들기 결과는 `prep`만 바꾸고, fired와 PAM 부르기(`nudge`, fired로 바뀔 때 한 번)는 그대로다 |
| Task 5:1275 | 취소된 호출도 fallback을 불러 새 계획까지 끊음 | 받아 쓰기(`take`)는 판단 받기 신호가 끊겼으면 다시 검사·fallback을 하지 않고 `{ ok: false }`만 낸다(`Planner.plan`이 지금 호출을 먼저 끊으므로 새 사람 요청 계획을 끊지 않는다) |
| Task 4:862 | 충전 자리 복귀 중에도 목표를 세우고 미리 만듦(뒤 판단은 `dock.busy()`에 버려짐) | 복귀 중(`core.dock.busy()`)이면 세우지 않고, 있던 목표는 까닭 `dock`으로 버린다 |
| Task 3:483 | STATE는 중간 값을 합쳐 모든 전환이 녹화된다는 보장이 없음 | 전환은 RELIABLE `/brain/goal_changes`(열쇠 목표 id, 순서 없음)로 하나씩 내고, `/brain/goal`(STATE)은 늦게 붙은 노드·대시보드용 최신 보기로만 쓴다. 녹화 시험은 RELIABLE 토픽으로 본다 |
| Task 9:1896 | 시험 프레임에 카메라 자세·위치 맞춤이 없어 컵 면이 null이라 미리 만들기가 시작되지 않음 | e2e는 `tests/mokryeon-e2e.test.ts`처럼 위치를 맞추고(`alignOnServer`) 맞춘 카메라 자세를 실은 엔진 프레임을 보낸다. 가짜 VLM 답은 VLM 물건 목록(`objects`)을 싣고, 물건 확정 지연(VLM 2초 간격, 약 4.8초)을 지난 뒤 목표가 서는 것을 본다 |

**바뀐 모양(코드 기준):**

```ts
// src/contract/goal.ts
export type GoalStatus = "armed" | "fired" | "used" | "dropped";
export type GoalPrep = "waiting" | "planning" | "ready" | "failed";
export type GoalDrop = "took" | "back" | "moved" | "other" | "safety" | "mode" | "dock" | "expired" | "pam" | "stale";
// PendingGoal: status·prep을 따로 싣는다(나머지 칸은 Task 3 그대로)

// src/agent/planTools.ts
export interface PlanAhead { trigger: string; on: string | null; object: string }

// src/act/track/goal.ts
//   holds(d): 같은 행동이고 (아직 떠나지 않음 또는 d.atMs < gone_ms)
//   take(d, signal, fallback): fired이고 같은 행동이고 d.atMs >= gone_ms일 때만. 받아 쓰는 중 signal이 끊기면 { ok: false }(fallback 없음)
//   watch: 안전 → mode → dock(복귀 중) → other → expired → (떠남 판단)
// src/act/track/core.ts: Run.goal(목표 id, 아니면 null), Job.prepared { seenSince, goal }
// src/act/track/approval.ts: need(r)는 r.goal이 있으면 null(위험 목록 가전 단계 질문은 따로 그대로)
// 토픽: "/brain/goal"(STATE, 최신 보기), "/brain/goal_changes"(RELIABLE, 전환마다). publishGoal은 둘 다 낸다
// 대시보드 알약: status가 armed·fired인 동안
```

**더하는 시험:** 컵 둘일 때 목표 컵이 아닌 컵 계획은 버림(Task 2·4), 떠나기 전 판단은 받지 않음(Task 5), 떠난 뒤 미리 만들기가 끝나도 fired 유지·PAM 다시 안 부름(Task 5), 끊긴 받아 쓰기는 계획 모드를 부르지 않음(Task 5), 복귀 중 세우지 않음·있던 목표 버림(Task 6), 전환 다섯이 RELIABLE로 다 녹화됨(Task 3), 목표 실행은 승인을 묻지 않고 위험 목록 가전 단계는 묻는다(Task 5), 맞춘 카메라 e2e(Task 9).

## 이 계획에서 정한 것 (지연에 주는 효과와 함께)

1. **무엇을 목표로 세울지는 FSM이 정한다.** `goalAhead`는 지금 상태와 `next` 한 번으로 가는 상태의 규칙 가운데, 지금 행동 목록에 있고, 행동 목록의 새 칸 `afterUse`(사람이 대상을 다 쓰고 떠난 뒤 하는 일)이고, 그 행동이 손대는 종류가 지금 쓰는 종류인 규칙을 본다. 행동이 하나일 때만 고른다. 지금 상태는 판단이 마지막으로 맞은 규칙의 상태(`Decider` `fsmState`)이고, 아직 없으면 기억의 처음 상태, 정할 수 없으면 모든 상태를 본다. 지금 상태 자기 규칙도 본다: 앞 판에 치운 뒤 상태가 `left_cup`에 머물러 있어도 다음 판에 목표를 세운다. 지연 효과: 없음(LLM 없음, 마이크로초).
   - seed 기억에서 `drinking`의 한 걸음 뒤 손대는 컵 규칙은 「컵 치우기」(`left_cup`)와 「컵에 콜라 따라 주기」(`watching_tv`) 둘이다. 「컵에 콜라 따라 주기」는 사람이 있는 동안 하는 일이라 `afterUse`가 아니다. 그래서 「컵 치우기」 하나가 남는다.
2. **세우는 때:** 쓰는 중 지킴(`UseWatch`)이 사람이 쓰는 종류를 붙잡은 때. 다른 계획이 열려 있거나 만드는 중이거나 안전 알림이 있으면 세우지 않는다. 한 등장(World State 사람 `since_ms`)에 한 번만 세운다(버리거나 쓴 뒤 같은 등장에서 다시 세우지 않아 계획 모드를 되풀이해 부르지 않는다). 처음 세울 때 메시지 상자 줄 하나(`FSM_STATE_IF[상태] + TASK_SAY[행동].will`, 예 「컵을 두고 자리를 뜨면 컵을 치울게요」).
3. **미리 만드는 때:** 대상 물건이 면 위에 놓여 있을 때(손에 있으면 놓을 때까지 기다린다: 손에 든 컵 자리로 만든 계획은 가기 단계 자리가 틀린다) 계획 모드를 한 번 부른다. 계획 입력에 `[미리 세운 목표]` 줄을 더한다. 실패하면 다시 부르지 않는다. 진짜 판단의 계획이 시작되면 계획 모드가 미리 만들기를 끊는다(`Planner` 한 번에 하나, 지금 그대로). 지연 효과: 사람이 떠나기 전에 5~10초를 다 쓴다. 비용: 목표를 쓰면 계획 모드 호출 수는 지금과 같고(지금은 계기 뒤 한 번), 버리면 한 번 더 든다.
4. **사람이 떠남(fired):** World State 사람이 안 보이고 대상 물건(옮김 표시 `followed_by`를 따라간 물건)이 있고 손에 없으면 fired로 바꾸고 판단을 바로 부르게 한다(`nudge`). 손에 있음으로 남아 있으면 내려놓음이 보일 때까지 기다린다. 지연 효과: 주기 판단 차례 기다림 0~5초 → 판단 타이머 한 번 0~0.25초.
5. **PAM이 확인한다(기본, 열린 질문 1):** 사람이 떠난 뒤 PAM 판단이 같은 행동을 고르면 판단 받기(`Starter.onDecision`)가 계획 모드 대신 미리 만든 계획을 그 판단으로 다시 낸다(`resubmit`: 모델이 낸 `submit_plan` 인자를 지금 판단·World State·평면도·손 자리·치운 물건으로 `PlanDraft`에 다시 넣고, World State 물건 id만 `followed_by` 끝 id로 바꾼다). 계획 id·단계 id는 그 PAM 판단 id다. 다시 검사를 못 넘으면 계획 모드로 간다. 미리 만드는 중이면 그 호출을 받아 쓴다(새로 부르지 않는다). 지연 효과: 계획 5.3초 → 수 ms.
6. **실행 전 검사의 「판단 뒤에 다시 봄」 기준:** 미리 만든 계획은 「사람이 떠난 때(`gone_ms`) 또는 그 뒤에 본 대상」이면 통과한다(`seenSince`, 낡음 한도 `STALE_MS` 3초는 그대로). 사람 없이 컵을 본 같은 사진이 PAM이 본 근거이기 때문이다. 지연 효과: 판단 뒤 새 사진을 기다리지 않는다(VLM 간격 2초 + 답 1.8초까지 아낌).
7. **사람이 아직 쓰는 동안 PAM이 같은 행동을 고르면** 계획을 만들지 않고 기록만 한다(「다 쓰고 떠나면 할 일로 두었어요」). 지금은 그 계획이 쓰는 중 기다림 30초(`CONTENTS_HOLD.holdMs`)를 넘으면 닫혀 버린다. 목표는 시간 한도가 따로 있다.
8. **사람 요청이 먼저:** 미리 만든 계획으로 시작한 실행은 「쓰는 중이라 미룬 계획」과 같게 본다(`Run.useHeld`): 폰 대화·승인 대기 중이면 첫 명령을 미룬다(지금 검사된 길). 안전 알림이면 목표를 버린다.
9. **처음 하는 일 승인:** 미리 묻지 않는다. 지금처럼 첫 명령 자리에서 「컵 치우기를 할까요?」를 묻는다(승인한 일이면 묻지 않음).
10. **통로(stage-queue):** 목표는 STATE 토픽 `/brain/goal`(열쇠 `_`, 순서 `stamp`, 보내는 노드 `brain`·`act`)에 상태가 바뀔 때마다 `{goal}`로 낸다(세움·계획 중·준비됨·사람 떠남·씀·버림과 까닭, 미리 만든 계획 보기 포함). 기록 노드가 녹화(bag)에 남긴다(STATE 토픽은 사진 칸이 없어 녹화 대상). 기록 DB에는 줄을 더하지 않는다(반성 입력이 아니다). 묶음 4 전에는 `/brain/plan`처럼 실행 추적(거울 노드 `act`의 `Outbox`)이 낸다.
11. **바깥 모양 하나:** `PendingGoal`(`src/contract/goal.ts`)을 `/brain/goal`과 대시보드 `{type:"goal"}`가 같이 쓴다. 대시보드는 세움·계획 중·준비됨·사람 떠남인 동안 메시지 상자 머리에 알약 「목표 · 컵 치우기」(21st.dev Status, 지금 알약 줄에 더함, 새 화면 자리 없음)를 보인다.

## 지연 예산 (사람 사라짐 확정 → 첫 명령)

| 구간 | 지금(r8 예) | 새 구조(PAM 확인, 기본) | 근거 |
|---|---|---|---|
| 사람 사라짐 → PAM 부름 | 주기 판단 차례 기다림 0~5초(`PAM_PERIOD_MS` 5000) | 0~0.25초(`nudge`, 판단 타이머 250ms 한 번) | `src/world/trigger.ts` `due`, `src/server/home/observe.ts` `startLoop` |
| PAM 답 | 사라짐 15.6 → PAM 17.2 = 1.6초(기다림 포함) | 약 1.0~1.6초(r8 1.6초를 위 끝으로 봄) | |
| 계획 | 17.2 → 22.5 = 5.3초 | 수 ms(`resubmit`: `PlanDraft` 결정론 검사) | 사람이 쓰는 동안 미리 만듦 |
| 실행 전 검사 → 첫 명령 | 22.5 → 22.6 = 0.1초 | 0초(`seenSince`: 사람이 떠난 사진의 컵으로 통과) | `src/act/check.ts` |
| **합** | **7~14초**(r7 7초, r8 14초) | **약 1.0~1.9초** | |
| 나쁜 때 | — | 사라질 때 PAM 판단이 이미 나가 있음(주기 5초 중 약 1.2초): + PAM 한 번 → 약 2.0~3.5초 | `maxInflight` 1 |
| 미리 만들기가 덜 끝남 | — | 컵을 내려놓고 5~10초 안에 떠남: 남은 미리 만들기 시간(그 호출을 받아 쓴다) | |
| 바로 실행(열린 질문 1의 다른 답) | — | 0~0.25초(PAM 확인 없음) | |

- 시험이 막는 것: 시험 시계 기준 「사람 사라짐 변화 → 첫 명령」이 판단 타이머 한 번(250ms) 안이고 그동안 계획 모드 호출이 0번(Task 5), 가짜 서버 e2e에서 실제 시간 1초 안(Task 9, 가짜 PAM은 바로 답함).
- `feat/vlm-objects`가 물건 `last_seen_ms`를 VLM 답(2초 간격 + 답 1.8초)으로만 바꾸게 되면, PAM 답을 받는 때(사라짐 답 뒤 약 1.5초) 컵 나이가 약 3.3초라 낡음 한도 3초에 걸려 다음 VLM 답까지 0~2초가 더해질 수 있다. 낡음 한도는 그 가지가 정한다. 이 계획은 World State 사실·id·`followed_by`만 읽는다.

## 로봇 FSM·통로와의 관계

- 사용자가 가져온 로봇 FSM(Idle, Observe, Navigate, Execute, Dock, Recovery)에서 이 기능은 「목표가 있는 Observe」다. 목표 상태 armed·planning·ready·fired가 Observe의 하위 상태이고, used가 Navigate(첫 가기 단계) → Execute(집기·넣기) → Dock(계획 뒤 충전 자리, `dock.ts`)로 넘어가는 때다. dropped는 목표 없는 Observe로 돌아간다. 로봇 FSM은 여기서 만들지 않는다. 만들 때 그 노드가 `/brain/goal`을 Observe 하위 상태의 입력으로 읽는다.
- stage-queue 묶음 3(실행 추적 노드): `GoalWatch`는 실행 추적 안에 있으므로 `act` 노드가 `/brain/goal`을 직접 낸다.
- stage-queue 묶음 4(판단 노드): 세우기·미리 만들기는 FSM 기억과 계획 모드를 가진 `brain` 노드로 옮긴다. `brain`이 `/brain/goal`을 내고 미리 만든 계획을 `/brain/plan {prepared: true}`로 내며, `/world/changes`의 사람 사라짐을 받아 바로 판단한다(`nudge`가 없어진다). `act`는 PAM 판단과 같은 행동이면 받아 둔 계획을 다시 검사해 시작한다. 재생은 목표가 입력(`/world/state`·`/brain/decision`)에서 결정론으로 나오므로 PAM 답을 재생하는 방법(묶음 4에서 정함)을 따른다.

---

## Global Constraints

- 무거운 일은 하나씩: 시험은 파일 하나도 `npm run heavy -- npx vitest run <파일>`. e2e·typecheck·전체 시험은 빈 메모리 3GB 이상에서.
- 서버·PAM·실제 모델을 띄우지 않는다. 가짜 서버(`scripts/fake-openai.ts`, `tests/helpers/pam.ts`)만.
- force·amend·bare `git stash` 금지. 영어 커밋, attribution 없음. `git add <경로>`로 그 작업 파일만, 커밋 전 `git status`로 스테이징이 그 작업뿐인지 본다. push는 조정자가 한다.
- 저장소 규칙 표(`CLAUDE.md`)를 지킨다. 특히:
  - 계획은 계획 모드(`src/agent/planner.ts`)만 만든다. src에 `cupPlan`·`askPlan`·`planFor` 이름을 쓰지 않는다(`tests/same-structure.test.ts`).
  - 메시지 상자 줄은 모델 없이 사실로만, 로봇 말(「~ㄹ게요」). 실제 폰 명령만 「~주세요」.
  - 사람이 쓰는 중이면 관찰만: 목표·미리 만들기는 폰·대시보드 명령을 내지 않는다.
  - 화면 부품은 21st.dev 부품(Status)을 그대로 배치만. 새 화면 자리를 만들지 않는다(지금 알약 줄·메시지 상자 줄로).
  - 모드는 `src/act/mode.ts` `modeNow` 한 곳. 목표는 모드를 바꾸지 않는다.
  - 도메인 경계(`scripts/lint-domains.ts`): 다른 도메인은 입구(`index.ts`)나 공용 표로만. 바깥 글 자르기는 `headWithin`.
- `src/world/state/*`의 물건 정체(id 붙이기·합치기)를 바꾸지 않는다. World State 사실·id·`followed_by`만 읽는다.
- 증거 수(등장 2초, 사람 사라짐 4초, 내용물 3장)와 낡음 한도를 바꾸지 않는다. 새 기다림을 넣지 않는다.
- 안전 알림·사람 말은 늘 목표보다 먼저다.
- 끝 조건(stage-queue 묶음 공통): 데모 e2e 넷(`demo-e2e`, `noonchi-e2e`, `coach-e2e`, `cup-branches-e2e`) + 영상 모드(`video-mode-e2e`, `video-real-e2e`, `video-mode-parity`, `ui/tests/phone-mode-parity.test.ts`) + 기록 DB 같음 정답 + `npm run typecheck` + `npm run lint`.

---

## File Structure

| 파일 | 맡는 일 |
|---|---|
| `src/brain/goal.ts`(새) | `goalAhead`: 습관 FSM 한 걸음 앞에서 목표 고르기(순수 함수) |
| `src/brain/decide.ts` | `fsmState()`(판단이 마지막으로 맞은 상태), `nudge()` |
| `src/brain/index.ts` | `goalAhead`·`GoalPick`·`decisionWorld`·`fsmRuleOf`·`PamMemory` 내보내기 |
| `src/world/trigger.ts` | `Trigger.nudge()`: 다음 한 번은 주기·최소 간격을 기다리지 않음 |
| `src/act/tasks.ts` | `TaskSpec.afterUse`(「컵 치우기」), `followedId`(옮김 표시 끝 id) |
| `src/agent/planTools.ts` | `AgentPlan.submitted`, `PlanAhead`, `PlanContext.ahead`, `resubmit` |
| `src/agent/planInput.ts` | `[미리 세운 목표]` 줄 |
| `src/agent/index.ts` | `resubmit`·`PlanAhead` 내보내기 |
| `src/contract/goal.ts`(새) | `PendingGoal`·`GoalStatus`·`GoalDrop`·`BrainGoalMsg` |
| `src/contract/events.ts` | `ServerMessage`에 `{type:"goal"; goal}` |
| `src/bus/topics.ts` | `/brain/goal`(STATE) 몸 모양과 계약 같음 검사 |
| `src/act/track/goal.ts`(새) | `GoalWatch`: 세우기·미리 만들기·사람 떠남·받아 쓰기(`take`)·맡기(`holds`)·버리기 |
| `src/act/track/use.ts` | `holding()`: 붙잡은 종류·물건 id |
| `src/act/track/core.ts` | `TrackCore.goal`, `Job.prepared`, `Run.seenSince` |
| `src/act/track/tracker.ts` | 옵션(`habit`·`reuse`·`onGoal`·`nudge`·`goalArmMs`, `planner`의 `ahead`, `check`의 `seenSince`), tick·onWorld·stop·idle, `goal()` |
| `src/act/track/start.ts` | 판단 받기: 다른 행동이면 목표 버림, 같은 행동이면 맡김·받아 쓰기, `Run.seenSince`·`useHeld` |
| `src/act/check.ts` | `CheckInput.seenSince` |
| `src/act/labels.ts` | `GOAL_TEXT.armed`, `EXEC_TEXT.goalWait` |
| `src/server/home/act.ts` | 계획 맥락 하나로(`planCtx`), `reuse`·`habit`·`nudge`·`onGoal`(`publishGoal`)·`check` 잇기 |
| `src/server/home/core.ts`, `src/server/home/index.ts`, `src/server/app.ts` | 마지막 목표, 접속 때 `{type:"goal"}` |
| `ui/src/dashboard/data.ts`, `ui/src/dashboard/TalkBox.tsx`, `ui/src/dashboard/words.ts` | 목표 알약 |
| `tests/helpers/history-golden.ts` | 주기 판단 메모에 `EXEC_TEXT.goalWait` |
| `tests/brain-goal.test.ts`, `tests/agent-resubmit.test.ts`, `tests/act-goal.test.ts`, `tests/goal-server.test.ts`, `tests/goal-e2e.test.ts`(새) | 시험 |
| `tests/world-decide.test.ts`, `tests/world-trigger.test.ts`, `tests/act-check.test.ts`, `tests/bus-topics.test.ts`, `tests/record-bag.test.ts`, `tests/server.test.ts`, `ui/tests/dashboard/data.test.ts`, `ui/tests/dashboard/screen.test.tsx` | 더하는 시험 |

---

### Task 1: 습관 FSM 한 걸음 앞에서 목표 고르기

**Files:**
- Create: `src/brain/goal.ts`
- Modify: `src/act/tasks.ts`(`TaskSpec.afterUse`, 「컵 치우기」), `src/brain/decide.ts`(`fsmState`), `src/brain/index.ts`
- Test: `tests/brain-goal.test.ts`(새), `tests/world-decide.test.ts`

**Interfaces:**
- Produces: `goalAhead(i: { memory: PamMemory; kind: "list" | "fsm"; state: string | null | undefined; tasks: readonly string[]; cls: string }): GoalPick | null`, `interface GoalPick { state: string; trigger: string; action: string; on: string | null }`, `TaskSpec.afterUse?: true`, `Decider.fsmState(): string | null | undefined`. `src/brain/index.ts`가 `goalAhead`, `type GoalPick`, `decisionWorld`, `fsmRuleOf`, `type PamMemory`를 낸다.

- [ ] **Step 1: 실패하는 시험을 쓴다** (`tests/brain-goal.test.ts`)

```ts
// 미리 세울 목표 고르기(src/brain/goal.ts): 습관 FSM의 지금 상태와 한 걸음 뒤 상태에서, 사람이 쓰는 종류에 손대는 「떠난 뒤 하는 일」(afterUse) 규칙 하나를 고른다.
import { describe, expect, it } from "vitest";
import { goalAhead } from "../src/brain/goal.js";
import { CUP_FSM_MEMORY, type FsmMemory } from "../src/brain/decision.js";
import { TASKS, tasksFor } from "../src/act/tasks.js";

const NOONCHI = tasksFor("noonchi");
const LEFT_CUP = CUP_FSM_MEMORY.states.find((s) => s.id === "left_cup")!;
const pick = (state: string | null | undefined, o: { cls?: string; tasks?: readonly string[]; memory?: FsmMemory } = {}) =>
  goalAhead({ memory: o.memory ?? CUP_FSM_MEMORY, kind: "fsm", state, tasks: o.tasks ?? NOONCHI, cls: o.cls ?? "cup" });

describe("미리 세울 목표 고르기(습관 FSM 한 걸음 앞)", () => {
  it("마시는 중(drinking)에 컵을 쓰면 한 걸음 뒤 left_cup의 「컵 치우기」를 고르고, next 글은 컵을 두고 떠나는 글이다", () => {
    expect(pick("drinking")).toEqual({ state: "left_cup", trigger: LEFT_CUP.rules[0]!.trigger, action: "컵 치우기", on: "사용자가 컵을 두고 자리를 떠나 보이지 않는다." });
  });

  it("판단 전(undefined)이면 처음 상태(drinking)에서 보고, 앞 판에 치워 left_cup에 머물러 있으면 그 상태의 규칙으로 고른다", () => {
    expect(pick(undefined)?.action).toBe("컵 치우기");
    expect(pick("left_cup")).toMatchObject({ state: "left_cup", action: "컵 치우기", on: null });
  });

  it("afterUse 행동만 고른다: TV 보는 중 한 걸음 뒤의 「컵에 콜라 따라 주기」는 컵에 손대는 행동이어도 사람이 있는 동안 하는 일이라 빠진다", () => {
    expect(TASKS["컵 치우기"]!.afterUse).toBe(true);
    expect(TASKS["컵에 콜라 따라 주기"]!.afterUse).toBeUndefined();
    expect(TASKS["컵에 물 채워 주기"]!.afterUse).toBeUndefined();
    expect(pick("watching_tv")?.action).toBe("컵 치우기");
  });

  it("세우지 않는 때: 쓰는 종류가 다름(병), 지금 행동 목록에 없음(코치 모드), list 기억, 한 걸음 안에 없음(cooking)", () => {
    expect(pick("drinking", { cls: "bottle" })).toBeNull();
    expect(pick("drinking", { tasks: tasksFor("coach") })).toBeNull();
    expect(goalAhead({ memory: { rules: [{ trigger: "t", action: "컵 치우기" }] }, kind: "list", state: undefined, tasks: NOONCHI, cls: "cup" })).toBeNull();
    expect(pick("cooking")).toBeNull();
  });

  it("지금 상태를 정할 수 없으면(null) 모든 상태를 보고, 반성이 같은 행동 규칙을 다른 상태에 더해도 행동이 하나라 고르며 한 걸음 뒤 상태의 규칙을 먼저 본다", () => {
    expect(pick(null)?.action).toBe("컵 치우기");
    const learned: FsmMemory = { ...CUP_FSM_MEMORY, states: CUP_FSM_MEMORY.states.map((s) => (s.id === "drinking" ? { ...s, rules: [...s.rules, { trigger: "배운 트리거", action: "컵 치우기" }] } : s)) };
    expect(pick("drinking", { memory: learned })).toMatchObject({ state: "left_cup", action: "컵 치우기" });
  });
});
```

`tests/world-decide.test.ts` 첫 `describe` 안에 더한다(같은 파일의 `pam` 변수·닫기, `emptyWorld`·`memory`·`event`를 쓴다):

```ts
  it("fsmState는 판단이 마지막으로 맞은 규칙의 상태다(처음에는 undefined). 미리 세울 목표가 읽는다", async () => {
    pam = await startFakePamLlm({ predict: (v) => ({ observation: "o", reasoning: "r", task_index: v.tasks.indexOf("컵 치우기") }) });
    const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory, emit: () => {}, offsetMinutes: 540 });
    expect(d.fsmState()).toBeUndefined();
    d.onChanges([{ kind: "person_gone", at_ms: 0, subject: "person", text: "사람 안 보임", meaningful: true }]);
    d.tick();
    await d.idle();
    expect(d.fsmState()).toBe("left_cup");
    d.stop();
  });
```

- [ ] **Step 2: 실패를 본다**

Run: `npm run heavy -- npx vitest run tests/brain-goal.test.ts tests/world-decide.test.ts`
Expected: FAIL — `Cannot find module '../src/brain/goal.js'`, `d.fsmState is not a function`.

- [ ] **Step 3: 구현한다**

`src/act/tasks.ts` `TaskSpec`에 칸을 더하고 「컵 치우기」에 단다:

```ts
  /** 사람이 대상(target)을 다 쓰고 떠난 뒤 하는 일(치우기): 사람이 그 종류를 쓰는 것을 보면 습관 FSM이 다음 규칙으로 고를 때 미리 목표로 세우고 계획을 만들어 둔다
   *  (src/brain/goal.ts goalAhead, src/act/track/goal.ts). 사람이 있는 동안 하는 일(채우기·따르기)은 아니다. */
  afterUse?: true;
```

```ts
  "컵 치우기": {
    name: "컵 치우기", description: "사람이 자리를 비운 뒤 식탁 등에 남은 컵을 사람이 싱크대에 넣게 한다.", target: "cup", touch: true, afterUse: true,
    allow: { kinds: HAND, need: HAND },
  },
```

`src/brain/goal.ts`:

```ts
// 미리 세울 목표 고르기(2026-11-18 사용자 결정): 사람이 손대는 행동의 대상을 쓰는 것을 보면, 습관 FSM을 한 걸음 앞서 읽어 사람이 떠난 뒤 할 일을 고른다.
// FSM이 무엇·언제를 정하고, 행동 목록(src/act/tasks.ts)의 afterUse 칸은 「사람이 대상을 다 쓰고 떠난 뒤 하는 일」인지만 적는다. 규칙을 실행하거나 상태를 넘기지 않는다.
// - 지금 상태(판단이 마지막으로 맞은 규칙의 상태, src/brain/decide.ts fsmState)와 그 상태에서 next 한 번으로 가는 상태의 규칙을 본다(한 걸음 뒤 상태를 먼저).
//   지금 상태를 정할 수 없으면(null) 모든 상태를 본다. 아직 없음(undefined)·지금 기억에 없는 상태는 기억의 처음 상태다(fsmNow와 같다).
// - 맞는 규칙: 지금 행동 목록에 있고, afterUse이고, 그 행동이 손대는 종류(touchTarget)가 사람이 쓰는 종류다.
// - 맞는 행동이 하나일 때만 고른다(둘 이상이면 어느 것이 먼저 올지 FSM으로 정할 수 없어 세우지 않는다).
import { taskOf, touchTarget } from "../act/tasks.js";
import type { PamMemory } from "./decision.js";

/** 고른 목표: 규칙이 있는 상태·그 트리거·행동, 지금 상태에서 그 상태로 가는 next 글(지금 상태 자기 규칙이거나 모든 상태를 봤으면 null). */
export interface GoalPick { state: string; trigger: string; action: string; on: string | null }

export function goalAhead(i: { memory: PamMemory; kind: "list" | "fsm"; state: string | null | undefined; tasks: readonly string[]; cls: string }): GoalPick | null {
  if (i.kind !== "fsm" || !("states" in i.memory)) return null;
  const m = i.memory;
  const byId = (id: string | undefined) => (id === undefined ? undefined : m.states.find((s) => s.id === id));
  const here = i.state === null ? null : byId(i.state) ?? byId(m.initial_state)!;
  const near = here
    ? [...here.next.flatMap((n) => { const s = byId(n.to); return s && s.id !== here.id ? [{ s, on: n.on as string | null }] : []; }), { s: here, on: null }]
    : m.states.map((s) => ({ s, on: null }));
  const fits = (action: string) => i.tasks.includes(action) && taskOf(action)?.afterUse === true && touchTarget(action) === i.cls;
  const hits: GoalPick[] = near.flatMap(({ s, on }) => s.rules.filter((r) => fits(r.action)).map((r) => ({ state: s.id, trigger: r.trigger, action: r.action, on })));
  return new Set(hits.map((h) => h.action)).size === 1 ? hits[0]! : null;
}
```

`src/brain/decide.ts` `Decider`에 더한다:

```ts
  /** 판단이 마지막으로 맞은 규칙의 FSM 상태(미리 세울 목표가 읽는다, src/brain/goal.ts). undefined 아직 없음(기억의 처음 상태), null 규칙이 여러 상태라 정할 수 없었음. */
  fsmState(): string | null | undefined {
    return this.lastState;
  }
```

(지금 private 칸 `fsmState`(59행)를 `lastState`로 이름을 바꾸고, 쓰는 곳 113·115·116행도 같이 바꾼다. 메서드 이름과 겹치지 않게 하려는 것이다.)

`src/brain/index.ts`:

```ts
export { Decider, decisionWorld } from "./decide.js";
export { type PamMemory, fsmRuleOf } from "./decision.js";
export { type GoalPick, goalAhead } from "./goal.js";
```

- [ ] **Step 4: 통과를 본다**

Run: `npm run heavy -- npx vitest run tests/brain-goal.test.ts tests/world-decide.test.ts tests/act-tasks.test.ts` 그리고 `npm run heavy -- npm run typecheck`, `npm run lint`
Expected: PASS(`tests/act-tasks.test.ts`의 tasks.json 견주기는 이름만 봐서 그대로).

- [ ] **Step 5: 커밋**

```bash
git add src/brain/goal.ts src/brain/decide.ts src/brain/index.ts src/act/tasks.ts tests/brain-goal.test.ts tests/world-decide.test.ts
git status
git commit -m "feat(brain): pick the next after-use habit action one step ahead in the FSM for the class a person is using"
```

---

### Task 2: 미리 만든 계획을 지금 맥락으로 다시 내기(`resubmit`)

**Files:**
- Modify: `src/agent/planTools.ts`, `src/agent/planInput.ts`, `src/agent/index.ts`, `src/act/tasks.ts`(`followedId`)
- Test: `tests/agent-resubmit.test.ts`(새)

**Interfaces:**
- Consumes: 없음
- Produces: `AgentPlan.submitted?: unknown`, `interface PlanAhead { trigger: string; on: string | null }`, `PlanContext.ahead?: PlanAhead`, `resubmit(plan: AgentPlan, ctx: PlanContext): PlanResult`, `followedId(world: Pick<WorldView, "objects">, id: string): string`

- [ ] **Step 1: 실패하는 시험을 쓴다** (`tests/agent-resubmit.test.ts`)

```ts
// 미리 만든 계획 다시 내기(src/agent/planTools.ts resubmit): 모델을 다시 부르지 않고, 모델이 낸 submit_plan 인자를 새 판단·지금 World State로 계획 검사에 다시 넣는다.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resubmit, type AgentPlan } from "../src/agent/planTools.js";
import { planInput } from "../src/agent/planInput.js";
import type { DecisionRecord } from "../src/contract/events.js";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { smallFloor } from "./helpers/floor.js";
import { planContext, startFakePlanner, testPlanner, type FakePlanner } from "./helpers/planner.js";

let llm: FakePlanner;
beforeAll(async () => { llm = await startFakePlanner(); });
afterAll(async () => { await llm.close(); });

const cupAt = (id: string, over: Partial<WorldObject> = {}): WorldObject => ({
  id, cls: "cup", position: [7, 0.75, 3], surface: "t", surface_label: "식탁", room: "hall", error_m: 0.1, status: "present", first_seen_ms: 0, last_seen_ms: 9_000, last_in_view_ms: 9_000,
  facts: { place: { value: "on_table", at_ms: 9_000, since_ms: 9_000, certainty: "confirmed" } }, answered_ms: null, devices: [], closer_hold: false, followed_by: null, ...over,
});
const view = (objects: WorldObject[]): WorldView => ({
  at_ms: 10_000, objects, person: { visible: false, since_ms: 9_000, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} },
  fixtures: [], devices: [], eye: null, frame_ms: 9_000, vlm_missing: 0, yolo_missing: 0,
});
const decision = (id: string, prediction: DecisionRecord["prediction"] = { observation: "사람이 컵을 두고 자리를 비움", reasoning: "습관대로 치운다", task_index: 0 }): DecisionRecord => ({
  id, seq: 1, atMs: 8_000, textSent: "t", finalTime: "x", status: "valid", prediction, action: "컵 치우기", memoryVersion: 1, world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
});
/** 목표 기록(goal-1, PAM 판단이 아니라 prediction 없음)으로 만든 계획. */
async function prepared(world: WorldView): Promise<AgentPlan> {
  const r = await testPlanner(llm).plan({ ...planContext({ decision: decision("goal-1", null), world, floor: smallFloor() }), ahead: { trigger: "t", on: "사용자가 컵을 두고 자리를 떠나 보이지 않는다." } });
  if (!r.ok) throw new Error(r.error);
  return r.plan;
}

describe("미리 만든 계획 다시 내기", () => {
  it("새 판단으로 다시 내면 모델을 부르지 않고, 계획·단계 id와 판단 글은 새 판단 것이며 명령·조건은 같다", async () => {
    const w = view([cupAt("cup_1")]);
    const pre = await prepared(w);
    const calls = llm.bodies().length;
    const r = resubmit(pre, planContext({ decision: decision("pam-7"), world: w, floor: smallFloor() }));
    expect(llm.bodies()).toHaveLength(calls);
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.view.id).toBe("plan:pam-7");
    expect(r.plan.steps.map((s) => s.id)).toEqual(pre.steps.map((_, i) => `plan:pam-7:${i + 1}`));
    expect(r.plan.steps.map((s) => [s.kind, s.command, s.until])).toEqual(pre.steps.map((s) => [s.kind, s.command, s.until]));
    expect(r.plan.view.judgment).toBe("습관대로 치운다");
  });

  it("컵이 옮겨져 새 id가 붙으면(followed_by cup_1 → cup_2) 계획의 물건 id를 cup_2로 바꿔 낸다", async () => {
    const pre = await prepared(view([cupAt("cup_1")]));
    const moved = view([cupAt("cup_1", { status: "gone", followed_by: "cup_2" }), cupAt("cup_2", { position: [7.3, 0.75, 3] })]);
    const r = resubmit(pre, planContext({ decision: decision("pam-8"), world: moved, floor: smallFloor() }));
    if (!r.ok) throw new Error(r.error);
    expect(JSON.stringify(r.plan.steps)).not.toContain("cup_1");
    expect(r.plan.steps.find((s) => s.kind === "pick")!.object).toBe("cup_2");
  });

  it("컵이 이어진 물건 없이 사라졌거나, 이미 치운 물건(placed)이거나, submit_plan 인자가 없거나, 다른 할 일의 계획이면 내지 않는다", async () => {
    const pre = await prepared(view([cupAt("cup_1")]));
    const fp = smallFloor();
    expect(resubmit(pre, planContext({ decision: decision("pam-9"), world: view([cupAt("cup_1", { status: "gone" })]), floor: fp })).ok).toBe(false);
    expect(resubmit(pre, planContext({ decision: decision("pam-9"), world: view([cupAt("cup_1")]), floor: fp, placed: new Map([["cup_1", { target: "sink_1", atMs: 1 }]]) })).ok).toBe(false);
    expect(resubmit({ ...pre, submitted: undefined }, planContext({ decision: decision("pam-9"), world: view([cupAt("cup_1")]), floor: fp })).ok).toBe(false);
    expect(resubmit({ ...pre, task: "사용자에게 물어보기" }, planContext({ decision: decision("pam-9"), world: view([cupAt("cup_1")]), floor: fp })).ok).toBe(false);
  });

  it("계획 입력: 미리 세운 목표가 있으면 [미리 세운 목표] 줄에 next 글을 넣고, 없으면 그 줄이 없다", () => {
    const ctx = planContext({ decision: decision("goal-1", null), world: view([cupAt("cup_1")]), floor: smallFloor() });
    expect(planInput(ctx)).not.toContain("[미리 세운 목표]");
    expect(planInput({ ...ctx, ahead: { trigger: "t", on: "사용자가 컵을 두고 자리를 떠나 보이지 않는다." } }))
      .toContain("[미리 세운 목표] 목표 물건 cup_1. 사람이 아직 쓰는 중이다. 「사용자가 컵을 두고 자리를 떠나 보이지 않는다.」가 되면 할 일이다. 사람이 떠난 뒤를 생각해 계획하고, 물건은 cup_1만 쓴다.");
  });
});
```

- [ ] **Step 2: 실패를 본다**

Run: `npm run heavy -- npx vitest run tests/agent-resubmit.test.ts`
Expected: FAIL — `resubmit`이 없다.

- [ ] **Step 3: 구현한다**

`src/act/tasks.ts`:

```ts
/** 옮김 표시(World State followed_by)를 따라간 끝 물건 id(최대 5번). 표시가 없으면 그 id. 미리 만든 계획 다시 내기·미리 세운 목표가 쓴다. */
export function followedId(world: Pick<WorldView, "objects">, id: string): string {
  let at = id;
  for (let i = 0; i < 5; i++) {
    const next = world.objects.find((o) => o.id === at)?.followed_by ?? null;
    if (!next || next === id) break;
    at = next;
  }
  return at;
}
```

`src/agent/planTools.ts`:

```ts
/** 검사를 통과한 계획: 화면 계획(PlanView, 단계 순서·id가 steps와 같다)과 실행 단계.
 *  submitted: 이 계획을 낸 submit_plan 인자(모델이 낸 그대로). 미리 만든 계획을 다른 판단으로 다시 낼 때 쓴다(resubmit). add·finish로 만든 계획은 없다. */
export interface AgentPlan { view: PlanView; steps: AgentStep[]; task: string; submitted?: unknown }

/** 계획 입력의 미리 세운 목표(src/act/track/goal.ts): 사람이 아직 대상을 쓰는 동안 만드는 계획이다. trigger는 그 습관 규칙의 트리거, on은 지금 상태에서 그 상태로 가는 글. */
export interface PlanAhead { trigger: string; on: string | null }
```

`PlanContext`에 `ahead?: PlanAhead;`(설명: 「미리 세운 목표의 계획이면 그 목표. 입력에 [미리 세운 목표] 줄을 넣는다」)를 더한다.

`PlanDraft.submit`의 끝을 바꾼다:

```ts
    const f = this.finish();
    if (!f.ok) return again(f.error);
    // 모델이 낸 인자 그대로 둔다: 미리 만든 계획을 다른 판단·World State로 다시 낼 때 쓴다(resubmit)
    f.plan.submitted = structuredClone(raw);
    return f;
```

파일 끝에 더한다:

```ts
/** 미리 만든 계획을 지금 맥락(새 판단·World State·평면도·손 자리·치운 물건)으로 다시 검사해 그 판단의 계획으로 낸다. 모델을 부르지 않는다.
 *  계획을 새로 만들지 않는다: 모델이 낸 submit_plan 인자를 그대로 다시 내고, 그 안에서 World State 물건 id와 똑같은 글만 옮김 표시(followed_by) 끝 id로 바꾼다.
 *  계획 id·단계 id는 새 판단 id로, 경로는 지금 손 자리에서 다시 잇는다. 검사를 못 넘으면 까닭을 낸다(부르는 쪽이 계획 모드로 돌아간다). */
export function resubmit(plan: AgentPlan, ctx: PlanContext): PlanResult {
  if (plan.submitted === undefined) return { ok: false, error: "다시 낼 submit_plan 인자가 없음" };
  if (plan.task !== ctx.task.name) return { ok: false, error: `다른 할 일의 계획: ${plan.task}` };
  const ids = new Set(ctx.world.objects.map((o) => o.id));
  const swap = (v: unknown): unknown =>
    typeof v === "string" ? (ids.has(v) ? followedId(ctx.world, v) : v)
      : Array.isArray(v) ? v.map(swap)
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v;
  const r = new PlanDraft(ctx).submit(swap(plan.submitted));
  return r.ok ? { ok: true, plan: r.plan } : { ok: false, error: r.error };
}
```

(`followedId`는 `../act/tasks.js` import 줄에 더한다.)

`src/agent/planInput.ts` `planInput`의 `[PAM 판단]` 줄 바로 뒤:

```ts
    ...(ctx.ahead ? [`[미리 세운 목표] 목표 물건 ${ctx.ahead.object}. 사람이 아직 쓰는 중이다. 「${ctx.ahead.on ?? ctx.ahead.trigger}」가 되면 할 일이다. 사람이 떠난 뒤를 생각해 계획하고, 물건은 ${ctx.ahead.object}만 쓴다.`] : []),
```

`src/agent/index.ts`의 planTools 내보내기 줄에 `resubmit`, `type PlanAhead`를 더한다.

- [ ] **Step 4: 통과를 본다**

Run: `npm run heavy -- npx vitest run tests/agent-resubmit.test.ts tests/agent-planner.test.ts tests/same-structure.test.ts`, `npm run heavy -- npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/agent/planTools.ts src/agent/planInput.ts src/agent/index.ts src/act/tasks.ts tests/agent-resubmit.test.ts
git status
git commit -m "feat(agent): keep the accepted submit_plan args and recheck a prepared plan for a new decision without calling the model"
```

---

### Task 3: `/brain/goal` 토픽과 목표 계약

**Files:**
- Create: `src/contract/goal.ts`
- Modify: `src/bus/topics.ts`, `docs/superpowers/plans/2026-11-17-stage-queue.md`(토픽 표에 한 줄)
- Test: `tests/bus-topics.test.ts`, `tests/record-bag.test.ts`

**Interfaces:**
- Produces: `type GoalStatus`, `type GoalDrop`, `interface PendingGoal`, `interface BrainGoalMsg { goal: PendingGoal }`, 토픽 `"/brain/goal"`(STATE, `from: ["brain", "act"]`)

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/bus-topics.test.ts`의 몸 모양 `describe`(안에 `ok`가 있는 곳)에 더한다:

```ts
  it("/brain/goal은 목표 하나({goal})만 받고, 모르는 상태·모르는 칸·사진 칸이면 거절한다. STATE이고 보내는 노드는 brain·act다", () => {
    const g = {
      id: "goal-1", action: "컵 치우기", state: "left_cup", trigger: "t", object: "cup_1", cls: "cup", status: "ready", reason: null, text: "컵을 두고 자리를 뜨면 컵을 치울게요",
      armed_ms: 1, ready_ms: 2, gone_ms: null, fired_ms: null, plan: { id: "plan:goal-1", steps: [] },
    };
    expect(ok("/brain/goal", { goal: g })).toBe(true);
    expect(ok("/brain/goal", { goal: { ...g, status: "dropped", reason: "took" } })).toBe(true);
    expect(ok("/brain/goal", { goal: { ...g, status: "done" } })).toBe(false);
    expect(ok("/brain/goal", { goal: { ...g, jpeg_b64: "AA==" } })).toBe(false);
    expect(ok("/brain/goal", { goal: g, extra: 1 })).toBe(false);
    expect(TOPICS["/brain/goal"].qos).toEqual({ kind: "state" });
    expect(TOPICS["/brain/goal"].from).toEqual(["brain", "act"]);
  });
```

`tests/record-bag.test.ts`: `sender`의 이름 타입에 `"act"`를 더하고 시험을 더한다:

```ts
  it("미리 세운 목표(/brain/goal, STATE)는 바뀔 때마다 녹화에 남고 기록 DB에는 줄이 없다(반성 입력이 아님)", async () => {
    const bus = new MemoryBus();
    const db = HistoryDb.open(":memory:");
    const bag = Bag.open(":memory:");
    const rec = await startRecorder({ bus, epoch: EPOCH, db, bag });
    rec.start();
    const act = await sender("act", bus);
    const goal = {
      id: "goal-1", action: "컵 치우기", state: "left_cup", trigger: "t", object: "cup_1", cls: "cup", status: "armed" as const, reason: null, text: null,
      armed_ms: 1, ready_ms: null, gone_ms: null, fired_ms: null, plan: null,
    };
    for (const status of ["armed", "planning", "ready", "fired", "used"] as const) {
      await act.publish("/brain/goal", { goal: { ...goal, status } });
      await tick();
    }
    await rec.idle();
    const kept = bag.range(0, Number.MAX_SAFE_INTEGER).filter(({ e }) => e.topic === "/brain/goal").map(({ e }) => (e.body as { goal: { status: string } }).goal.status);
    expect(kept).toEqual(["armed", "planning", "ready", "fired", "used"]);
    expect(db.list({})).toEqual([]);
  });
```

- [ ] **Step 2: 실패를 본다**

Run: `npm run heavy -- npx vitest run tests/bus-topics.test.ts tests/record-bag.test.ts`
Expected: FAIL — `TOPICS["/brain/goal"]`이 없다(타입 오류·undefined).

- [ ] **Step 3: 구현한다**

`src/contract/goal.ts`:

```ts
// 미리 세운 목표(src/act/track/goal.ts)의 바깥 모양: 노드 통로 /brain/goal(STATE, 녹화)과 대시보드 {type:"goal"}이 같은 것을 싣는다.
import type { PlanView } from "./plan.js";

/** armed 세움(계획 없음) · planning 계획을 미리 만드는 중 · ready 계획 준비됨 · fired 사람이 떠나 판단을 바로 부름 · used 판단이 같은 행동을 골라 계획을 씀 · dropped 버림. */
export type GoalStatus = "armed" | "planning" | "ready" | "fired" | "used" | "dropped";
/** 버린 까닭: took 들고 나감, back 다시 나타남, moved 물건이 사라지거나 다른 면으로 옮겨지거나 치워짐, other 다른 판단·계획, safety 안전 알림,
 *  mode 지금 행동 목록에 없음(코치 모드), expired 세워 둘 수 있는 시간이 지남, pam 사람이 떠난 뒤 PAM이 그 행동을 고르지 않음,
 *  stale 미리 만든 계획이 없거나 지금 World State 검사를 못 넘음. */
export type GoalDrop = "took" | "back" | "moved" | "other" | "safety" | "mode" | "expired" | "pam" | "stale";

export interface PendingGoal {
  /** goal-<번호>. */
  id: string;
  action: string;
  /** 그 규칙이 있는 FSM 상태 id와 트리거 글. */
  state: string;
  trigger: string;
  /** 대상 World State 물건 id(지금 따라가는 id)와 종류. */
  object: string;
  cls: string;
  status: GoalStatus;
  reason: GoalDrop | null;
  /** 메시지 상자 줄(클로이드 말, 사실로만). 조건 글 표에 없는 상태면 null. */
  text: string | null;
  armed_ms: number;
  ready_ms: number | null;
  /** 사람이 떠난 때(World State 사람 since_ms)와 그것을 본 때. */
  gone_ms: number | null;
  fired_ms: number | null;
  /** 미리 만든 계획 보기(없으면 null). */
  plan: PlanView | null;
}

export interface BrainGoalMsg { goal: PendingGoal }
```

`src/bus/topics.ts`: import에 `import type { BrainGoalMsg } from "../contract/goal.js";`, `import type { PlanView } from "../contract/plan.js";`를 더하고, `deviceChange` 아래에:

```ts
/** /brain/goal: 미리 세운 목표 하나. 계획 보기는 실행 추적이 타입으로 만든 객체라 깊이 보지 않는다(최상위 id·steps만). */
const planView = z.custom<PlanView>((v) => isObj(v) && typeof v.id === "string" && Array.isArray(v.steps));
const pendingGoal = z.strictObject({
  id, action: z.string().min(1), state: z.string().min(1), trigger: z.string(), object: id, cls: z.string().min(1),
  status: z.enum(["armed", "planning", "ready", "fired", "used", "dropped"]),
  reason: z.enum(["took", "back", "moved", "other", "safety", "mode", "expired", "pam", "stale"]).nullable(),
  text: z.string().nullable(), armed_ms: at, ready_ms: at.nullable(), gone_ms: at.nullable(), fired_ms: at.nullable(), plan: planView.nullable(),
});
const brainGoal = z.strictObject({ goal: pendingGoal });
```

`TopicBodiesSame`에 `Assert<Equal<z.infer<typeof brainGoal>, BrainGoalMsg>>,`를, `TOPICS`의 `/brain/plan` 줄 아래에:

```ts
  "/brain/goal": { qos: { kind: "state" }, body: brainGoal, key: one, order: "stamp", from: ["brain", "act"] },
```

`docs/superpowers/plans/2026-11-17-stage-queue.md` 토픽 표의 `/brain/plan` 줄 아래에 한 줄:

```md
| `/brain/goal` | STATE | `_` | `stamp` | brain(묶음 4 전에는 act) | 미리 세운 목표(상태·까닭·미리 만든 계획 보기, `docs/superpowers/plans/2026-11-18-goal-preplan.md`) |
```

- [ ] **Step 4: 통과를 본다**

Run: `npm run heavy -- npx vitest run tests/bus-topics.test.ts tests/record-bag.test.ts tests/bus-memory.test.ts`, `npm run heavy -- npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/contract/goal.ts src/bus/topics.ts tests/bus-topics.test.ts tests/record-bag.test.ts docs/superpowers/plans/2026-11-17-stage-queue.md
git status
git commit -m "feat(bus): add the /brain/goal state topic for the pending goal and record it in the bag"
```

---

### Task 4: 목표 세우기와 계획 미리 만들기(`GoalWatch`)

**Files:**
- Create: `src/act/track/goal.ts`
- Modify: `src/act/track/use.ts`(`holding`), `src/act/track/core.ts`(`goal`), `src/act/track/tracker.ts`, `src/act/labels.ts`(`GOAL_TEXT`)
- Test: `tests/act-goal.test.ts`(새)

**Interfaces:**
- Consumes: `goalAhead`, `decisionWorld`, `fsmRuleOf`, `PamMemory`(Task 1), `PlanAhead`·`AgentPlan`(Task 2), `PendingGoal`(Task 3), `followedId`(Task 2)
- Produces: `class GoalWatch extends Part { update(): void; current(): PendingGoal | null; idle(): Promise<void>; stop(): void }`, `GOAL_DEFAULTS = { armMs: 1_800_000, fireWaitMs: 15_000 }`, `UseWatch.holding(): { cls: string; id: string | null }[]`, `TrackerOptions.habit?: () => { memory: PamMemory; kind: "list" | "fsm"; state: string | null | undefined; version: number } | null`, `TrackerOptions.onGoal?: (g: PendingGoal) => void`, `TrackerOptions.planner: (d: DecisionRecord, signal: AbortSignal, ahead?: PlanAhead) => PlanResult | Promise<PlanResult>`, `ExecutionTracker.goal(): PendingGoal | null`, `GOAL_TEXT.armed(cond: string, will: string): string`

- [ ] **Step 1: 실패하는 시험을 쓴다** (`tests/act-goal.test.ts`, 이 파일은 Task 5·6이 이어 쓴다)

```ts
// 미리 세운 목표(src/act/track/goal.ts): 사람이 컵을 쓰는 것을 보면 습관 FSM 한 걸음 앞의 「컵 치우기」를 목표로 세우고 계획을 미리 만들어 둔다.
// 사람이 떠나면 판단을 바로 부르게 하고, PAM이 같은 행동을 고르면 미리 만든 계획을 다시 검사해 첫 명령을 낸다(계획 모드를 다시 부르지 않는다).
// 계획 모델은 같은 주소 자리의 가짜 OpenAI 서버(tests/helpers/planner.ts), 시계는 시험 시계(clock.t)다. smallFloor: 식탁 table_1 [7, 3], 싱크대 sink_1 [5, 1].
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExecutionTracker, type TrackerOptions } from "../src/act/track/tracker.js";
import { PlanHub } from "../src/act/hub.js";
import { checkPlan } from "../src/act/check.js";
import { tasksFor } from "../src/act/tasks.js";
import { EXEC_TEXT, USE_THOUGHT } from "../src/act/labels.js";
import { ApprovalStore } from "../src/agent/approval.js";
import { resubmit, type PlanAhead } from "../src/agent/planTools.js";
import { CUP_FSM_MEMORY } from "../src/brain/decision.js";
import type { BrainLog, DecisionRecord } from "../src/contract/events.js";
import type { PendingGoal } from "../src/contract/goal.js";
import type { PlannedCommandMessage } from "../src/contract/phone.js";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { POSE_FALL } from "../src/world/vocab.js";
import { smallFloor } from "./helpers/floor.js";
import { planContext, startFakePlanner, testPlanner, type FakePlanner } from "./helpers/planner.js";

let llm: FakePlanner;
beforeAll(async () => { llm = await startFakePlanner(); });
afterAll(async () => { await llm.close(); });

const NOONCHI = tasksFor("noonchi");
const PLACES: Record<string, { label: string; position: [number, number, number] }> = {
  table_1: { label: "식탁", position: [7, 0.75, 3] }, sink_1: { label: "싱크대", position: [5, 0.9, 1] },
};
const fact = (value: string, at: number) => ({ value, at_ms: at, since_ms: at, certainty: "confirmed" as const });
/** 식탁 위 컵. place in_hand면 면 없음. */
const cupOn = (o: { id?: string; place?: string; seen: number; surface?: string | null; status?: WorldObject["status"]; followed_by?: string | null; carried?: true }): WorldObject => ({
  id: o.id ?? "cup_1", cls: "cup", position: [7, 0.75, 3], surface: o.surface === undefined ? (o.place === "in_hand" ? null : "t") : o.surface, surface_label: "식탁", room: "hall", error_m: 0.1,
  status: o.status ?? "present", first_seen_ms: 0, last_seen_ms: o.seen, last_in_view_ms: o.seen, facts: { place: fact(o.place ?? "on_table", o.seen) }, answered_ms: null, devices: [], closer_hold: false,
  followed_by: o.followed_by ?? null, ...(o.carried ? { carried: o.carried } : {}),
});
type Who = { act?: string; holding?: string[]; posture?: string } | null;
/** PAM 판단(사람이 떠난 뒤 컵 치우기, action null이면 대기). */
const pam = (id: string, seq: number, atMs: number, action: string | null = "컵 치우기"): DecisionRecord => ({
  id, seq, atMs, textSent: "t", finalTime: "x", status: "valid", prediction: { observation: "사람이 컵을 두고 자리를 비움", reasoning: "습관대로 치운다", task_index: action ? NOONCHI.indexOf(action) : -1 },
  action, memoryVersion: 1, tasks: NOONCHI, world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
});

/** 실행 추적 + 미리 세운 목표. person(who)로 사람을 바꾸고(나타나면 since_ms, 사라지면 그때가 since_ms), setObjects로 물건을 바꾼다.
 *  tick은 시계를 ms 움직이고, 있는 물건을 지금 본 것으로 고친 뒤 tracker.tick을 부른다. gone은 World State 사람 사라짐 변화처럼 onWorld를 부른다. */
function goalSetup(o: { over?: Partial<TrackerOptions>; state?: string | null } = {}) {
  const clock = { t: 10_000, now() { return this.t; } };
  let who: Who = null;
  let since = 0;
  let goneAt = 0;
  let objects: WorldObject[] = [cupOn({ seen: clock.t })];
  const w = (): WorldView => {
    const facts = who
      ? { ...(who.act ? { activity: fact(who.act, clock.t) } : {}), ...(who.holding ? { holding: fact("holding_object", clock.t) } : {}), ...(who.posture ? { posture: fact(who.posture, clock.t) } : {}) }
      : {};
    return {
      at_ms: clock.t, objects, fixtures: [], devices: [], eye: null, frame_ms: clock.t, vlm_missing: 0, yolo_missing: 0,
      person: { visible: !!who, since_ms: who ? since : goneAt, last_seen_ms: who ? clock.t : null, count: who ? 1 : 0, room: null, room_label: null, position: null, near: [], holding: who?.holding ?? [], position_ms: null, answered_ms: null, facts },
    };
  };
  const goals: PendingGoal[] = [];
  const thoughts: string[] = [];
  const logs: BrainLog[] = [];
  const phone: PlannedCommandMessage[] = [];
  let nudged = 0;
  const plans = new PlanHub(smallFloor(), () => {}, () => "t");
  const planner = testPlanner(llm);
  const approvals = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "goal-")), "homes", "h", "approvals.json"), () => "t");
  approvals.answer("task:컵 치우기", "approve");
  const ctx = (d: DecisionRecord, ahead?: PlanAhead) => ({ ...planContext({ decision: d, world: w(), floor: plans.floor() }), ...(ahead ? { ahead } : {}) });
  const t = new ExecutionTracker({
    plans, world: w, floor: () => plans.floor(), planGapMs: 0, approvals, clock, tasks: () => NOONCHI, locate: (id) => PLACES[id],
    planner: (d, signal, ahead) => planner.plan(ctx(d, ahead), signal),
    check: (d, p, seenSince) => checkPlan({ decision: d, tasks: NOONCHI, plan: p, world: w(), nowMs: clock.t, staleMs: 3000, mode: "test", ...(seenSince !== undefined ? { seenSince } : {}) }),
    reuse: (d, plan) => resubmit(plan, ctx(d)),
    habit: () => ({ memory: CUP_FSM_MEMORY, kind: "fsm", state: o.state === undefined ? "drinking" : o.state, version: 1 }),
    onGoal: (g) => goals.push(g), nudge: () => { nudged++; }, thought: (text) => thoughts.push(text),
    toPhone: (m) => phone.push(m), emit: (l) => logs.push(l), ...o.over,
  });
  t.onEye([3, 1]);
  const tick = (ms = 250) => {
    clock.t += ms;
    objects = objects.map((x) => (x.status === "present" ? { ...x, last_seen_ms: clock.t, last_in_view_ms: clock.t } : x));
    t.onEye([3, 1]);
    t.tick();
  };
  const person = (p: Who) => {
    if (p && !who) since = clock.t;
    if (!p && who) goneAt = clock.t;
    who = p;
  };
  const gone = () => {
    person(null);
    t.onWorld([{ kind: "person_gone", at_ms: clock.t, subject: "person", text: "사람 안 보임", meaningful: true }]);
  };
  const setObjects = (f: (xs: WorldObject[]) => WorldObject[]) => { objects = f(objects); };
  const decide = async (d: DecisionRecord) => { t.onDecision(d); await t.idle(); };
  const commands = () => phone.flatMap((m) => (m.type === "command" ? [m] : []));
  const planCalls = () => llm.bodies().length;
  const statuses = () => goals.map((g) => g.status);
  return { t, clock, tick, person, gone, setObjects, goals, statuses, thoughts, logs, phone, commands, decide, planCalls, nudged: () => nudged, world: w };
}

describe("미리 세운 목표: 세우기와 미리 만들기", () => {
  it("사람이 컵으로 마시는 것을 보면 「컵 치우기」 목표를 세우고 메시지 상자에 「컵을 두고 자리를 뜨면 컵을 치울게요」를 한 번 올린다. 폰 명령은 없다", async () => {
    const s = goalSetup();
    s.person({ act: "drinking" });
    s.tick();
    expect(s.goals[0]).toMatchObject({ id: "goal-1", action: "컵 치우기", state: "left_cup", object: "cup_1", cls: "cup", status: "armed", reason: null, text: "컵을 두고 자리를 뜨면 컵을 치울게요" });
    expect(s.thoughts).toEqual([USE_THOUGHT.act("마시는 중"), "컵을 두고 자리를 뜨면 컵을 치울게요"]);
    for (let i = 0; i < 20; i++) s.tick();
    await s.t.idle();
    expect(s.thoughts).toHaveLength(2);
    expect(s.commands()).toEqual([]);
  });

  it("사람이 떠나기 전에 계획 모드를 한 번만 불러 계획을 준비해 둔다(armed → planning → ready, 계획 보기 plan:goal-1). 계획 입력에 [미리 세운 목표] 줄이 있다", async () => {
    const s = goalSetup();
    const before = s.planCalls();
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    for (let i = 0; i < 20; i++) s.tick();
    await s.t.idle();
    expect(s.planCalls() - before).toBe(1);
    expect(s.statuses()).toEqual(["armed", "planning", "ready"]);
    expect(s.t.goal()).toMatchObject({ status: "ready", plan: { id: "plan:goal-1" } });
    expect(JSON.stringify(llm.bodies().at(-1))).toContain("[미리 세운 목표]");
    expect(s.commands()).toEqual([]);
    expect(s.logs.filter((l) => l.type === "execution")).toEqual([]);
  });

  it("컵이 손에 있는 동안에는 미리 만들지 않고, 식탁에 내려놓으면 만든다", async () => {
    const s = goalSetup();
    s.setObjects(() => [cupOn({ seen: s.clock.t, place: "in_hand" })]);
    s.person({ act: "drinking", holding: ["cup_1"] });
    s.tick();
    await s.t.idle();
    expect(s.t.goal()?.status).toBe("armed");
    s.setObjects(() => [cupOn({ seen: s.clock.t })]);
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    expect(s.t.goal()?.status).toBe("ready");
  });

  it("세우지 않는 때: 습관 기억이 없음, 코치 모드 행동 목록, 쓰러짐 의심, 다른 계획이 열려 있음", async () => {
    for (const over of [{ habit: () => null }, { tasks: () => tasksFor("coach") }] as Partial<TrackerOptions>[]) {
      const s = goalSetup({ over });
      s.person({ act: "drinking" });
      s.tick();
      expect(s.goals).toEqual([]);
    }
    const fall = goalSetup();
    fall.person({ act: "drinking", posture: POSE_FALL });
    fall.tick();
    expect(fall.goals).toEqual([]);
    const busy = goalSetup();
    await busy.decide(pam("pam-1", 1, busy.clock.t, "사용자에게 물어보기"));
    busy.person({ act: "drinking" });
    busy.tick();
    expect(busy.goals).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 본다**

Run: `npm run heavy -- npx vitest run tests/act-goal.test.ts`
Expected: FAIL — `habit`·`onGoal`·`reuse`가 `TrackerOptions`에 없다(타입), `s.t.goal is not a function`.

- [ ] **Step 3: 구현한다**

`src/act/labels.ts`:

```ts
/** 미리 세운 목표(src/act/track/goal.ts): 메시지 상자 줄(클로이드가 하는 말, 「<상태 조건> <행동 말>」, src/world/labels.ts FSM_STATE_IF·src/act/tasks.ts TASK_SAY). */
export const GOAL_TEXT = {
  armed: (cond: string, will: string) => `${cond} ${will}`,
} as const;
```

`src/act/track/use.ts` `UseWatch`에:

```ts
  /** 붙잡은 것(종류와 물건 id, 종류 전체면 null). 지금 World State로 다시 보고 답한다. 미리 세운 목표(goal.ts)가 읽는다. */
  holding(): { cls: string; id: string | null }[] {
    this.update();
    return [...this.held.values()].map((h) => ({ cls: h.cls, id: h.id }));
  }
```

`src/act/track/goal.ts`:

```ts
// 실행 추적의 미리 세운 목표(GoalWatch, 2026-11-18 사용자 결정 「컵을 마시는 걸 볼 때 다 마시면 치워야겠다는 목표를 세우고, 사용자가 사라지면 관련된 행동을 계획하고 실행」).
// - 세우기: 쓰는 중 지킴(use.ts)이 사람이 쓰는 종류를 붙잡으면 습관 FSM을 한 걸음 앞서 읽어(src/brain/goal.ts goalAhead) 사람이 떠난 뒤 할 일을 목표로 세운다.
//   다른 계획이 열려 있거나 만드는 중이거나 안전 알림이 있으면 세우지 않는다. 한 등장(World State 사람 since_ms)에 한 번만 세운다(버리거나 쓴 뒤 같은 등장에서 다시 세우지 않는다).
//   처음 세울 때 메시지 상자에 「<상태 조건> <행동 말>」 한 줄(클로이드 말, 사실로만)을 올린다.
// - 미리 만들기: 대상 물건이 면 위에 놓여 있고(손에 있으면 놓을 때까지 기다린다) 계획 모드가 비어 있을 때 같은 계획 모드(o.planner)를 목표 기록으로 한 번 부른다.
//   폰·대시보드 명령은 내지 않는다(관찰만). 실패하면 다시 부르지 않는다. 진짜 판단의 계획이 시작되면 계획 모드(한 번에 하나)가 미리 만들기를 끊는다.
// 바뀔 때마다 o.onGoal로 낸다(서버가 /brain/goal STATE와 대시보드로 보낸다).
import type { DecisionRecord } from "../../contract/events.js";
import type { PendingGoal } from "../../contract/goal.js";
import type { ObjClass, WorldView } from "../../contract/world.js";
import type { AgentPlan, PlanResult } from "../../agent/index.js";
import { decisionWorld, fsmRuleOf, goalAhead, type GoalPick } from "../../brain/index.js";
import { FSM_STATE_IF } from "../../world/labels.js";
import { GOAL_TEXT } from "../labels.js";
import { emergencyOf } from "../mode.js";
import { followedId, TASK_NAMES, TASK_SAY, targetOf } from "../tasks.js";
import { Part } from "./core.js";

/** 목표를 세워 둘 수 있는 시간(ms, 열린 질문 2)과, 사람이 떠난 뒤 PAM이 그 행동을 고르기를 기다리는 시간(ms, 열린 질문 3: 바로 부름 + 주기 판단 두 번). */
export const GOAL_DEFAULTS = { armMs: 30 * 60_000, fireWaitMs: 15_000 } as const;

interface Goal {
  view: PendingGoal;
  pick: GoalPick;
  /** 지금 따라가는 대상 물건 id(옮김 표시로 바뀐다). */
  objectId: string;
  /** 세운 때 사람 등장(since_ms). */
  presence: number | null;
  /** 미리 만든 계획과 그때 대상이 놓인 면. */
  plan: AgentPlan | null;
  surface: string | null;
  /** 미리 만드는 중인 계획 모드 호출. */
  job: { abort: AbortController; done: Promise<PlanResult> } | null;
  /** 미리 만들기를 해 봤다(실패해도 다시 부르지 않는다). */
  tried: boolean;
}

export class GoalWatch extends Part {
  private goal: Goal | null = null;
  private n = 0;
  /** 목표를 버리거나 쓴 등장(그 등장에서는 다시 세우지 않는다). */
  private spent: number | null | undefined = undefined;
  private readonly jobs = new Set<Promise<unknown>>();

  current(): PendingGoal | null {
    return this.goal?.view ?? null;
  }

  /** tick·World State 변화마다(쓰는 중 지킴 뒤에) 부른다. */
  update(): void {
    if (this.core.stopped) return;
    if (!this.goal) this.arm();
    if (this.goal) this.preplan(this.goal);
  }

  private arm(): void {
    const world = this.o.world();
    const p = world.person;
    const habit = this.o.habit?.();
    if (!habit || !p.visible || p.since_ms === this.spent || this.core.open() || this.core.planning) return;
    if (emergencyOf({ world, offNotices: this.core.safety.offTrack().notices })) return;
    const tasks = this.o.tasks?.() ?? TASK_NAMES;
    for (const h of this.core.use.holding()) {
      const pick = goalAhead({ memory: habit.memory, kind: habit.kind, state: habit.state, tasks, cls: h.cls });
      const objectId = h.id ?? targetOf({ target: h.cls as ObjClass }, world, this.core.steps.placed())?.id ?? null;
      if (!pick || !objectId) continue;
      const id = `goal-${++this.n}`;
      const cond = FSM_STATE_IF[pick.state];
      const will = TASK_SAY[pick.action]?.will;
      const text = cond && will ? GOAL_TEXT.armed(cond, will) : null;
      this.goal = {
        pick, objectId, presence: p.since_ms, plan: null, surface: null, job: null, tried: false,
        view: {
          id, action: pick.action, state: pick.state, trigger: pick.trigger, object: objectId, cls: h.cls, status: "armed", reason: null, text,
          armed_ms: this.clock.now(), ready_ms: null, gone_ms: null, fired_ms: null, plan: null,
        },
      };
      this.publish();
      if (text) this.o.thought?.(text, id);
      return;
    }
  }

  /** 계획 모드에 넘기는 목표 기록(판단 기록 모양, PAM 판단이 아니라 prediction이 없다). 계획 id는 plan:goal-n이고, 쓸 때 PAM 판단 id로 다시 낸다(resubmit). */
  private record(g: Goal, world: WorldView, now: number): DecisionRecord {
    const habit = this.o.habit?.();
    const rule = habit ? fsmRuleOf(habit.memory, habit.kind, g.view.action) : null;
    return {
      id: g.view.id, seq: 0, atMs: now, textSent: "", finalTime: new Date(now).toISOString(), status: "valid", prediction: null, action: g.view.action,
      fsm: { state: g.view.state, trigger: g.view.trigger, learned: rule?.learned ?? false, matched: true }, memoryVersion: habit?.version ?? 0,
      tasks: [...(this.o.tasks?.() ?? TASK_NAMES)], world: decisionWorld(world),
    };
  }

  private preplan(g: Goal): void {
    if (g.plan || g.job || g.tried || g.view.status !== "armed" || this.core.open() || this.core.planning) return;
    const world = this.o.world();
    const o = world.objects.find((x) => x.id === followedId(world, g.objectId));
    // 대상이 면 위에 놓였을 때 만든다: 손에 든 컵 자리로 만든 계획은 가기 단계 자리가 틀린다
    if (!o || o.status !== "present" || !o.surface || o.facts.place?.value === "in_hand" || o.carried === true) return;
    g.objectId = o.id;
    g.surface = o.surface;
    g.tried = true;
    const now = this.clock.now();
    const abort = new AbortController();
    let out: PlanResult | Promise<PlanResult>;
    try {
      out = this.o.planner(this.record(g, world, now), abort.signal, { trigger: g.pick.trigger, on: g.pick.on });
    } catch (e) {
      out = { ok: false, error: (e as Error).message };
    }
    const done: Promise<PlanResult> = Promise.resolve(out).catch((e: unknown) => ({ ok: false as const, error: (e as Error).message }));
    g.job = { abort, done };
    this.set(g, { status: "planning", object: o.id });
    const p = done.then((r) => {
      if (this.goal !== g || g.job?.done !== done) return;
      g.job = null;
      if (r.ok) {
        g.plan = r.plan;
        this.set(g, { status: "ready", ready_ms: this.clock.now(), plan: r.plan.view });
      } else this.set(g, { status: "armed" });
    }).finally(() => { this.jobs.delete(p); });
    this.jobs.add(p);
  }

  private set(g: Goal, v: Partial<PendingGoal>): void {
    g.view = { ...g.view, ...v };
    if (this.goal === g) this.publish();
  }

  private publish(): void {
    const g = this.goal;
    if (g && !this.core.stopped) this.o.onGoal?.(g.view);
  }

  /** 미리 만드는 호출이 끝날 때까지 기다린다(시험용). */
  async idle(): Promise<void> {
    while (this.jobs.size) await Promise.all([...this.jobs]);
  }

  /** 멈추면 미리 만드는 호출을 끊고 더 내지 않는다. */
  stop(): void {
    this.goal?.job?.abort.abort();
  }
}
```

`src/act/track/core.ts`: `import type { GoalWatch } from "./goal.js";`, `TrackCore`에 `goal!: GoalWatch;`.

`src/act/track/tracker.ts`:
- import: `import { GoalWatch } from "./goal.js";`, `import type { PendingGoal } from "../../contract/goal.js";`, `import type { PamMemory } from "../../brain/index.js";`, `type AgentPlan, type PlanAhead`를 agent import에 더한다.
- `TrackerOptions`:

```ts
  /** 에이전트 계획 모드(src/agent/planner.ts). 판단 하나에 한 번 부른다. 새 판단·「그만」·멈춤이면 signal을 끊는다.
   *  ahead가 있으면 미리 세운 목표의 계획이다(src/act/track/goal.ts, 계획 입력에 [미리 세운 목표] 줄). */
  planner: (d: DecisionRecord, signal: AbortSignal, ahead?: PlanAhead) => PlanResult | Promise<PlanResult>;
  /** 습관 FSM: 그날 기억(판본)과 판단이 마지막으로 맞은 상태(src/brain/decide.ts fsmState). 쓰는 것을 보면 한 걸음 앞 규칙으로 목표를 세운다(goal.ts). 없으면 세우지 않는다. */
  habit?: () => { memory: PamMemory; kind: "list" | "fsm"; state: string | null | undefined; version: number } | null;
  /** 목표가 바뀔 때(세움·계획 중·준비됨·사람 떠남·씀·버림): 서버가 /brain/goal과 대시보드로 보낸다. */
  onGoal?: (g: PendingGoal) => void;
```

- 생성자: `core.goal = new GoalWatch(core);`(`core.use` 다음).
- `tick()`: `if (!core.stopped) core.use.update();` 바로 뒤에 `if (!core.stopped) core.goal.update();`
- `onWorld()`: `core.coach.see(changes);` 뒤에 `if (!core.stopped) core.goal.update();`
- `stop()`: 첫 줄에 `core.goal.stop();`
- `idle()`: `await Promise.all([this.core.start.idle(), this.core.goal.idle()]);`
- 공개 메서드:

```ts
  /** 미리 세운 목표(goal.ts). 없으면 null. */
  goal(): PendingGoal | null {
    return this.core.goal.current();
  }
```

(Task 5의 `reuse`·`nudge`·`check`의 `seenSince` 옵션은 Task 5에서 더한다. 이 Task의 시험은 그 옵션을 넘기므로 Step 3에서 `TrackerOptions`에 Task 5의 옵션 선언 셋도 함께 더한다:)

```ts
  /** 미리 만든 계획을 지금 판단·World State로 다시 검사해 그 판단의 계획으로 낸다(src/agent/planTools.ts resubmit). 없으면 미리 만든 계획을 쓰지 않는다. */
  reuse?: (d: DecisionRecord, plan: AgentPlan) => PlanResult;
  /** 목표의 사람이 떠났다: 판단을 다음 판단 타이머에 바로 부르게 한다(src/brain/decide.ts nudge). */
  nudge?: () => void;
  /** 목표를 세워 둘 수 있는 시간(ms). 없으면 GOAL_DEFAULTS.armMs. */
  goalArmMs?: number;
```

그리고 `check`의 타입을 `(d: DecisionRecord, plan: PlanView, seenSince?: number) => CheckResult`로 바꾸고(설명 끝에 「seenSince: 미리 만든 계획이면 사람이 떠난 때(src/act/check.ts CheckInput.seenSince)」), 시험의 `checkPlan` 호출이 타입 검사를 넘게 `src/act/check.ts` `CheckInput`에 `seenSince?: number;` 선언을 더한다(설명과 쓰는 줄은 Task 5). `tsconfig.json`이 `tests`도 검사한다.

- [ ] **Step 4: 통과를 본다**

Run: `npm run heavy -- npx vitest run tests/act-goal.test.ts tests/act-track.test.ts`, `npm run heavy -- npm run typecheck`, `npm run lint`
Expected: PASS(`act-track` 시험은 `habit`이 없어 목표를 세우지 않으므로 그대로).

- [ ] **Step 5: 커밋**

```bash
git add src/act/track/goal.ts src/act/track/use.ts src/act/track/core.ts src/act/track/tracker.ts src/act/labels.ts src/act/check.ts tests/act-goal.test.ts
git status
git commit -m "feat(act): arm a pending goal while a person uses the target and prepare its plan with the same plan mode"
```

---

### Task 5: 사람이 떠나면 PAM을 바로 부르고 미리 만든 계획으로 시작

**Files:**
- Modify: `src/act/track/goal.ts`(`watch`·`take`·`holds`·`end`·`drop`), `src/act/track/start.ts`, `src/act/track/core.ts`(`Job.prepared`, `Run.seenSince`), `src/act/check.ts`(`seenSince`), `src/act/labels.ts`(`EXEC_TEXT.goalWait`), `src/world/trigger.ts`(`nudge`), `src/brain/decide.ts`(`nudge`), `tests/helpers/history-golden.ts`
- Test: `tests/act-goal.test.ts`, `tests/act-check.test.ts`, `tests/world-trigger.test.ts`

**Interfaces:**
- Consumes: Task 4의 `GoalWatch`, Task 2의 `resubmit`
- Produces: `GoalWatch.take(d: DecisionRecord, signal: AbortSignal, fallback: () => PlanResult | Promise<PlanResult>): { out: PlanResult | Promise<PlanResult>; seenSince: number } | null`, `GoalWatch.holds(d: DecisionRecord): boolean`, `GoalWatch.drop(reason: GoalDrop): void`, `Job.prepared?: { seenSince: number }`, `Run.seenSince: number | null`, `CheckInput.seenSince?: number`, `Trigger.nudge(): void`, `Decider.nudge(): void`, `EXEC_TEXT.goalWait`

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/act-goal.test.ts`에 더한다(import에 `Decider`·`Trigger`·`startFakePamLlm`·`pamClientFor`를 더한다: `import { Decider } from "../src/brain/decide.js"; import { Trigger } from "../src/world/trigger.js"; import { pamClientFor, startFakePamLlm } from "./helpers/pam.js";`):

```ts
describe("미리 세운 목표: 사람이 떠나면 바로 시작", () => {
  /** 마시는 동안 계획을 준비해 둔 상태까지. */
  async function ready(o: Parameters<typeof goalSetup>[0] = {}) {
    const s = goalSetup(o);
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    expect(s.t.goal()?.status).toBe("ready");
    return s;
  }

  it("사람이 떠나면(컵은 식탁에 그대로) 사람이 떠난 때를 실어 fired로 바꾸고 판단을 바로 부르게 한다(nudge 한 번). 폰 명령은 없다", async () => {
    const s = await ready();
    s.tick();
    const at = s.clock.t;
    s.gone();
    expect(s.t.goal()).toMatchObject({ status: "fired", gone_ms: at, fired_ms: at });
    expect(s.nudged()).toBe(1);
    s.tick();
    expect(s.nudged()).toBe(1);
    expect(s.commands()).toEqual([]);
  });

  it("PAM이 컵 치우기를 고르면 계획 모드를 다시 부르지 않고 미리 만든 계획을 그 판단 id로 내 판단을 받은 그 자리에서 「식탁으로 가 주세요」를 보낸다. 목표는 used", async () => {
    const s = await ready();
    s.tick();
    s.gone();
    s.tick();
    const before = s.planCalls();
    const at = s.clock.t;
    await s.decide(pam("pam-2", 2, at));
    expect(s.planCalls()).toBe(before);
    // tick 없이 판단을 받은 그 자리에서 첫 명령이 나간다
    expect(s.commands()).toHaveLength(1);
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-2", text: "식탁으로 가 주세요", speak: true });
    expect(s.goals.at(-1)).toMatchObject({ status: "used", reason: null });
    expect(s.t.goal()).toBeNull();
  });

  it("예산(시험 시계, PAM 답 시간은 뺌): 사람 사라짐 변화 뒤 판단 타이머 한 번(250ms) 안에 PAM을 부르고 그 답으로 첫 명령이 나가며, 그동안 계획 모드 호출은 0번이다. 주기 판단은 5초다", async () => {
    const pamLlm = await startFakePamLlm({ predict: (v) => ({ observation: "o", reasoning: "r", task_index: /사람 안 보임/.test(v.observation_text) ? v.tasks.indexOf("컵 치우기") : -1 }) });
    try {
      let decider: Decider | null = null;
      const s = goalSetup({ over: { nudge: () => decider?.nudge() } });
      decider = new Decider({
        pam: pamClientFor(pamLlm), world: { view: () => s.world() }, trigger: new Trigger({ mode: "periodic", minGapMs: 3000, periodMs: 5000, idleStopMs: 1_800_000, liveMs: 10_000, maxInflight: 1 }, 0),
        tasks: () => NOONCHI, memory: () => ({ memory: CUP_FSM_MEMORY, kind: "fsm", version: 1 }), emit: () => {}, offsetMinutes: 540, clock: s.clock, onDecision: (d) => s.t.onDecision(d),
      });
      /** 서버 판단 타이머(250ms)와 같은 차례: 판단 → 실행 추적. */
      const loop = async () => { s.clock.t += 250; decider!.onFrame(); decider!.tick(); await decider!.idle(); s.tick(0); await s.t.idle(); };
      s.person({ act: "drinking" });
      for (let i = 0; i < 4; i++) await loop();
      expect(s.t.goal()?.status).toBe("ready");
      const before = s.planCalls();
      const goneAt = s.clock.t;
      s.gone();
      while (!s.commands().length && s.clock.t - goneAt < 6000) await loop();
      expect(s.commands()[0]).toMatchObject({ text: "식탁으로 가 주세요" });
      expect(s.clock.t - goneAt).toBeLessThanOrEqual(250);
      expect(s.planCalls()).toBe(before);
      decider.stop();
    } finally {
      await pamLlm.close();
    }
  });

  it("PAM 판단이 미리 만드는 중에 오면 그 호출을 받아 쓴다(계획 모드를 한 번 더 부르지 않는다)", async () => {
    const s = goalSetup();
    const before = s.planCalls();
    s.person({ act: "drinking" });
    s.tick();
    expect(s.t.goal()?.status).toBe("planning");
    s.gone();
    expect(s.t.goal()?.status).toBe("fired");
    await s.decide(pam("pam-3", 3, s.clock.t));
    expect(s.planCalls() - before).toBe(1);
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-3", text: "식탁으로 가 주세요" });
  });

  it("사람이 아직 마시는 동안 PAM이 컵 치우기를 고르면 계획을 만들지 않고 「다 쓰고 떠나면 할 일로 두었어요」만 남긴다(목표가 맡는다)", async () => {
    const s = await ready();
    const before = s.planCalls();
    await s.decide(pam("pam-4", 4, s.clock.t));
    expect(s.planCalls()).toBe(before);
    expect(s.logs.at(-1)).toMatchObject({ type: "execution", plan_id: "plan:pam-4", state: "decided", text: EXEC_TEXT.goalWait });
    expect(s.t.goal()?.status).toBe("ready");
    expect(s.commands()).toEqual([]);
  });

  it("폰 대화 중이면 사람이 떠나도 첫 명령을 미루고, 대화가 끝나면 보낸다(사람 요청이 먼저)", async () => {
    let talking = true;
    const s = await ready({ over: { talking: () => talking } });
    s.tick();
    s.gone();
    await s.decide(pam("pam-5", 5, s.clock.t));
    expect(s.commands()).toEqual([]);
    talking = false;
    s.tick();
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-5", text: "식탁으로 가 주세요" });
  });
});
```

`tests/act-check.test.ts`에 더한다:

```ts
  it("미리 만든 계획(seenSince): 사람이 떠난 때나 그 뒤에 본 대상은 판단 전 사진이어도 다시 본 것으로 본다. 그 전에 본 대상·STALE_MS를 넘긴 대상은 낡음", () => {
    // 판단 8_000, 대상 마지막 9_000: 보통은 판단 뒤 사진이라 통과, 판단을 9_500으로 늦추면 낡음
    const late = { ...base().decision, atMs: 9_500 };
    expect(checkPlan(base({ decision: late }))).toMatchObject({ ok: false, reason: "stale" });
    expect(checkPlan(base({ decision: late, seenSince: 9_000 }))).toEqual({ ok: true });
    expect(checkPlan(base({ decision: late, seenSince: 9_001 }))).toMatchObject({ ok: false, reason: "stale" });
    expect(checkPlan(base({ decision: late, seenSince: 9_000, nowMs: 12_500 }))).toMatchObject({ ok: false, reason: "stale" });
  });
```

`tests/world-trigger.test.ts` 첫 `describe`에 더한다:

```ts
  it("nudge: 다음 한 번은 주기·최소 간격을 기다리지 않는다. 동시 상한·프레임 없음은 지키고, 부르면 풀린다", () => {
    const t = periodic();
    t.onFrame(1000);
    t.called(1000);
    expect(t.due(1250, false, 0)).toBe(false);
    t.nudge();
    expect(t.due(1250, false, 1)).toBe(false);
    expect(t.due(1250, false, 0)).toBe(true);
    t.called(1250);
    expect(t.due(1500, false, 0)).toBe(false);
    t.nudge();
    expect(t.due(20_000, false, 0)).toBe(false);
    const e = new Trigger({ mode: "event", minGapMs: 3000, periodMs: 5000, idleStopMs: 1_800_000, liveMs: 10_000, maxInflight: 1 }, 0);
    e.called(0);
    e.nudge();
    expect(e.due(100, false, 0)).toBe(true);
  });
```

- [ ] **Step 2: 실패를 본다**

Run: `npm run heavy -- npx vitest run tests/act-goal.test.ts tests/act-check.test.ts tests/world-trigger.test.ts`
Expected: FAIL — `fired`가 오지 않음, `EXEC_TEXT.goalWait` 없음, `seenSince` 칸 없음, `t.nudge is not a function`.

- [ ] **Step 3: 구현한다**

`src/world/trigger.ts` `Trigger`:

```ts
  private nudged = false;

  /** 다음 판단을 주기·최소 간격을 기다리지 않고 부르게 한다(미리 세운 목표의 사람이 떠남, src/act/track/goal.ts). 동시 상한·멈춤(프레임 없음)은 지킨다. 부르면 풀린다. */
  nudge(): void { this.nudged = true; }
```

`due`의 동시 상한 줄 바로 뒤에 `if (this.nudged) return this.pause(nowMs, personVisible) === null;`, `called`에 `this.nudged = false;`.

`src/brain/decide.ts` `Decider`:

```ts
  /** 다음 판단 타이머에 기다림 없이 PAM을 부르게 한다(미리 세운 목표의 사람이 떠남). 동시 상한·쉼(hold)은 그대로다. */
  nudge(): void {
    if (!this.stopped) this.o.trigger.nudge();
  }
```

`src/act/labels.ts` `EXEC_TEXT`에 `goalWait: "다 쓰고 떠나면 할 일로 두었어요",`.

`src/act/check.ts` `CheckInput`의 `seenSince` 선언(Task 4)에 설명을 단다:

```ts
  /** 미리 만든 계획(src/act/track/goal.ts)이면 사람이 떠난 때: 대상을 그때나 그 뒤에 봤으면 판단 뒤에 다시 본 것으로 본다(PAM이 본 사람 없는 같은 사진).
   *  없으면 판단 시각 뒤에 본 것만. 낡음 한도(staleMs)는 그대로 본다. */
  seenSince?: number;
```

`checkPlan`의 낡음 줄을 바꾼다:

```ts
      const unseen = i.seenSince === undefined ? o.last_seen_ms <= i.decision.atMs : o.last_seen_ms < i.seenSince;
      if (unseen || i.nowMs - o.last_seen_ms > i.staleMs) return failOn("stale", o.id);
```

`src/act/track/core.ts`:

```ts
/** at: 같은 행동 다시 계획 간격(planGapMs)을 세려고 적은 시각. prepared: 미리 만든 계획을 쓴 판단(goal.ts take), seenSince는 실행 전 검사 기준(사람이 떠난 때). */
export interface Job { decision: DecisionRecord; gen: number; abort: AbortController; at: number; prepared?: { seenSince: number } }
```

`Run`에 `/** 미리 만든 계획이면 사람이 떠난 때(실행 전 검사 seenSince, goal.ts). 아니면 null. */ seenSince: number | null;`.

`src/act/track/goal.ts`에 더한다(`import type { GoalDrop } ...`, `import { putAway } from "../tasks.js"`는 Task 6에서 쓴다):

```ts
  update(): void {
    if (this.core.stopped) return;
    if (this.goal) this.watch(this.goal);
    if (!this.goal) this.arm();
    if (this.goal) this.preplan(this.goal);
  }

  /** 사람이 떠났는지 본다: 사람이 안 보이고(World State) 대상 물건(옮김 표시를 따라감)이 있고 손에 없으면 fired로 바꾸고 판단을 바로 부르게 한다.
   *  손에 있음으로 남아 있으면 내려놓음이 보일 때까지 기다린다. (버리는 갈래는 Task 6에서 더한다.) */
  private watch(g: Goal): void {
    const world = this.o.world();
    const p = world.person;
    if (g.view.status === "fired" || p.visible) return;
    const o = world.objects.find((x) => x.id === followedId(world, g.objectId));
    if (!o || o.status === "gone" || o.facts.place?.value === "in_hand" || o.carried === true) return;
    g.objectId = o.id;
    this.set(g, { status: "fired", object: o.id, gone_ms: p.since_ms, fired_ms: this.clock.now() });
    this.o.nudge?.();
  }

  /** 사람이 아직 떠나지 않은 목표와 같은 행동의 판단인가: 판단 받기는 그 판단으로 계획을 만들지 않고 기록만 한다
   *  (쓰는 동안 만든 계획은 30초 넘게 기다리면 닫힌다. 사람이 떠나면 목표가 판단을 다시 부른다). */
  holds(d: DecisionRecord): boolean {
    const g = this.goal;
    return !!g && g.view.status !== "fired" && d.action === g.view.action;
  }

  /** 판단 받기(start.ts)가 계획 모드를 부르기 전에 묻는다. 사람이 떠난 목표(fired)와 같은 행동이면:
   *  - 미리 만든 계획이 있으면 대상이 그때 면 그대로일 때 이 판단으로 다시 검사해(o.reuse) 그 결과. 못 넘으면 버리고(stale·moved) null.
   *  - 미리 만드는 중이면 그 호출을 받아 써서(새로 부르지 않는다) 다시 검사하고, 못 넘으면 fallback(계획 모드).
   *  - 둘 다 없으면 버리고(stale) null. null이면 부르는 쪽이 계획 모드를 부른다. 쓰면 목표는 used로 끝난다.
   *  seenSince: 실행 전 검사가 대상을 다시 본 것으로 볼 기준(사람이 떠난 때). */
  take(d: DecisionRecord, signal: AbortSignal, fallback: () => PlanResult | Promise<PlanResult>): { out: PlanResult | Promise<PlanResult>; seenSince: number } | null {
    const g = this.goal;
    const reuse = this.o.reuse;
    if (!g || !reuse || g.view.status !== "fired" || d.action !== g.view.action || g.view.gone_ms === null) return null;
    const seenSince = g.view.gone_ms;
    const sameSurface = () => {
      const world = this.o.world();
      return world.objects.find((x) => x.id === followedId(world, g.objectId))?.surface === g.surface;
    };
    if (g.plan) {
      if (!sameSurface()) { this.drop("moved"); return null; }
      const r = reuse(d, g.plan);
      if (!r.ok) { this.drop("stale"); return null; }
      this.end(g, "used");
      return { out: r, seenSince };
    }
    if (g.job) {
      const job = g.job;
      signal.addEventListener("abort", () => job.abort.abort(), { once: true });
      g.job = null;
      this.end(g, "used");
      const out = job.done.then((r) => {
        if (r.ok && sameSurface()) {
          const again = reuse(d, r.plan);
          if (again.ok) return again;
        }
        return fallback();
      });
      return { out, seenSince };
    }
    this.drop("stale");
    return null;
  }

  /** 목표를 버린다(지금 길로 돌아간다). 없으면 아무것도 하지 않는다. */
  drop(reason: GoalDrop): void {
    if (this.goal) this.end(this.goal, "dropped", reason);
  }

  /** 목표를 끝낸다(used·dropped): 마지막 상태를 내고, 그 등장에서는 다시 세우지 않는다. 버리면 미리 만드는 호출을 끊는다. */
  private end(g: Goal, status: "used" | "dropped", reason: GoalDrop | null = null): void {
    if (status === "dropped") g.job?.abort.abort();
    g.job = null;
    this.spent = g.presence;
    this.set(g, { status, reason });
    this.goal = null;
  }
```

`src/act/track/start.ts` `onDecision`:
- `if (!d.action) return this.note(d, EXEC_TEXT.wait);` 바로 뒤에:

```ts
    // 사람이 아직 떠나지 않은 목표와 같은 행동이면 목표가 맡는다(사람이 떠나면 판단을 다시 부른다, goal.ts)
    if (core.goal.holds(d)) return this.note(d, EXEC_TEXT.goalWait);
```

- 계획 모드를 부르는 곳을 바꾼다:

```ts
    let out: PlanResult | Promise<PlanResult>;
    try {
      const plan = () => this.o.planner(d, job.abort.signal);
      // 사람이 떠난 목표와 같은 행동이면 미리 만든 계획을 이 판단으로 다시 검사해 쓴다(계획 모드를 다시 부르지 않는다, goal.ts take)
      const ready = core.goal.take(d, job.abort.signal, plan);
      if (ready) job.prepared = { seenSince: ready.seenSince };
      out = ready ? ready.out : plan();
    } catch (e) {
      out = { ok: false, error: (e as Error).message };
    }
```

- `planned()`의 `Run`을 만드는 곳: `usedAt: null, useHeld: false,` → `usedAt: null, useHeld: !!job.prepared,`(미리 만든 계획은 쓰는 중이라 미룬 계획처럼 첫 명령을 폰 대화·승인 대기 동안 미룬다), `seenSince: job.prepared?.seenSince ?? null,`을 더한다. (`grep -n ": Run = {" src tests`로 다른 곳에서 `Run`을 만드는지 보고 같이 더한다.)
- `tryStart`: `const c = this.o.check(r.decision, r.plan.view);` → `const c = this.o.check(r.decision, r.plan.view, r.seenSince ?? undefined);`

`tests/helpers/history-golden.ts` `DECISION_NOTES`에 `EXEC_TEXT.goalWait`를 더한다(주기 판단의 처리 메모다).

- [ ] **Step 4: 통과를 본다**

Run: `npm run heavy -- npx vitest run tests/act-goal.test.ts tests/act-check.test.ts tests/world-trigger.test.ts tests/world-decide.test.ts tests/act-track.test.ts`, `npm run heavy -- npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/act/track/goal.ts src/act/track/start.ts src/act/track/core.ts src/act/check.ts src/act/labels.ts src/world/trigger.ts src/brain/decide.ts tests/helpers/history-golden.ts tests/act-goal.test.ts tests/act-check.test.ts tests/world-trigger.test.ts
git status
git commit -m "feat(act): when the person leaves, nudge PAM and start the prepared plan on its matching decision without a second plan-mode call"
```

---

### Task 6: 맞지 않게 된 목표 버리기

**Files:**
- Modify: `src/act/track/goal.ts`(`watch` 전체), `src/act/track/start.ts`(다른 행동 판단)
- Test: `tests/act-goal.test.ts`

**Interfaces:**
- Consumes: Task 5의 `drop`·`end`·`GOAL_DEFAULTS`, `TrackerOptions.goalArmMs`
- Produces: 없음(동작만)

- [ ] **Step 1: 실패하는 시험을 쓴다** (`tests/act-goal.test.ts`)

```ts
describe("미리 세운 목표: 버리고 지금 길로", () => {
  async function ready(o: Parameters<typeof goalSetup>[0] = {}) {
    const s = goalSetup(o);
    s.person({ act: "drinking" });
    s.tick();
    await s.t.idle();
    return s;
  }
  const last = (s: ReturnType<typeof goalSetup>) => s.goals.at(-1)!;

  it("들고 나감: 사람이 떠날 때 컵도 사라지면 took로 버리고 판단을 부르지 않는다. 손에 있음으로 남으면 15초 기다린 뒤 took", async () => {
    const s = await ready();
    s.setObjects(() => [cupOn({ seen: s.clock.t, status: "gone" })]);
    s.gone();
    expect(last(s)).toMatchObject({ status: "dropped", reason: "took" });
    expect(s.nudged()).toBe(0);
    const h = await ready();
    h.setObjects(() => [cupOn({ seen: h.clock.t, place: "in_hand" })]);
    h.gone();
    expect(h.t.goal()?.status).toBe("ready");
    for (let i = 0; i < 61; i++) h.tick();
    expect(last(h)).toMatchObject({ status: "dropped", reason: "took" });
  });

  it("금방 돌아옴: fired 뒤 PAM 판단 전에 사람이 다시 보이면 back으로 버리고, 그 뒤 컵 치우기 판단은 계획 모드로 만든다(지금 길)", async () => {
    const s = await ready();
    s.tick();
    s.gone();
    s.tick();
    // 다시 나타나 컵을 쓰지 않는다(쓰면 새 등장이라 goal-2를 세운다: 「한 등장에 한 번」 시험)
    s.person({});
    s.tick();
    expect(s.goals.find((g) => g.status === "dropped")).toMatchObject({ reason: "back" });
    expect(s.t.goal()).toBeNull();
    s.person(null);
    s.tick();
    const before = s.planCalls();
    await s.decide(pam("pam-6", 6, s.clock.t));
    expect(s.planCalls() - before).toBe(1);
  });

  it("컵이 옮겨짐: 다른 면으로 옮겨진 뒤 사람이 떠나면 미리 만든 계획을 쓰지 않고 moved로 버리며 계획 모드로 만든다. 쓰는 동안 이어진 물건 없이 사라져도 moved", async () => {
    const s = await ready();
    s.setObjects(() => [cupOn({ seen: s.clock.t, surface: "sofa" })]);
    s.tick();
    s.gone();
    const before = s.planCalls();
    await s.decide(pam("pam-7", 7, s.clock.t));
    expect(s.goals.find((g) => g.status === "dropped")).toMatchObject({ reason: "moved" });
    expect(s.planCalls() - before).toBe(1);
    const m = await ready();
    m.setObjects(() => [cupOn({ seen: m.clock.t, status: "gone" })]);
    m.tick();
    expect(last(m)).toMatchObject({ status: "dropped", reason: "moved" });
  });

  it("컵이 옮겨져 새 id가 붙어도(followed_by) 같은 면이면 그 컵으로 이어 가 미리 만든 계획을 쓴다", async () => {
    const s = await ready();
    s.setObjects(() => [cupOn({ seen: s.clock.t, status: "gone", followed_by: "cup_2" }), cupOn({ id: "cup_2", seen: s.clock.t })]);
    s.tick();
    s.gone();
    const before = s.planCalls();
    await s.decide(pam("pam-8", 8, s.clock.t));
    expect(s.planCalls()).toBe(before);
    expect(s.commands()[0]).toMatchObject({ id: "plan:pam-8", text: "식탁으로 가 주세요" });
  });

  it("다른 판단: 다른 행동을 고른 판단이 오면 other로 버리고 그 판단의 계획을 만든다. 대기 판단은 버리지 않는다", async () => {
    const s = await ready();
    await s.decide(pam("pam-9", 9, s.clock.t, null));
    expect(s.t.goal()?.status).toBe("ready");
    await s.decide(pam("pam-10", 10, s.clock.t, "사용자에게 물어보기"));
    expect(s.goals.find((g) => g.status === "dropped")).toMatchObject({ reason: "other" });
  });

  it("안전·모드·시간: 쓰러짐 의심이면 safety, 행동 목록이 코치 모드로 바뀌면 mode, 세운 지 goalArmMs가 지나면 expired, 사람이 떠난 뒤 15초 안에 PAM이 고르지 않으면 pam", async () => {
    const f = await ready();
    f.person({ act: "drinking", posture: POSE_FALL });
    f.tick();
    expect(last(f)).toMatchObject({ status: "dropped", reason: "safety" });
    let coach = false;
    const m = await ready({ over: { tasks: () => (coach ? tasksFor("coach") : NOONCHI) } });
    coach = true;
    m.tick();
    expect(last(m)).toMatchObject({ status: "dropped", reason: "mode" });
    const e = await ready({ over: { goalArmMs: 1000 } });
    for (let i = 0; i < 5; i++) e.tick();
    expect(last(e)).toMatchObject({ status: "dropped", reason: "expired" });
    const p = await ready();
    p.gone();
    for (let i = 0; i < 61; i++) p.tick();
    expect(last(p)).toMatchObject({ status: "dropped", reason: "pam" });
  });

  it("한 등장에 한 번: 버린 뒤 같은 사람이 계속 마셔도 다시 세우지 않고(계획 모드 호출 늘지 않음), 떠났다 다시 나타나 마시면 goal-2를 세운다", async () => {
    const s = await ready();
    // 다른 판단으로 버린다. 열린 물어보기 계획은 「그만」으로 닫는다(다른 계획이 열려 있으면 세우지 않으므로)
    await s.decide(pam("pam-11", 11, s.clock.t, "사용자에게 물어보기"));
    expect(s.goals.at(-1)).toMatchObject({ status: "dropped", reason: "other" });
    s.t.onHeard("그만");
    const calls = s.planCalls();
    for (let i = 0; i < 20; i++) s.tick();
    await s.t.idle();
    expect(s.goals.filter((g) => g.status === "armed")).toHaveLength(1);
    expect(s.planCalls()).toBe(calls);
    s.person(null);
    s.tick();
    s.person({ act: "drinking" });
    s.tick();
    expect(s.goals.find((g) => g.id === "goal-2")).toMatchObject({ status: "armed" });
  });

  it("멈추면 미리 만드는 호출을 끊고 더 내지 않는다", async () => {
    const s = goalSetup();
    s.person({ act: "drinking" });
    s.tick();
    const n = s.goals.length;
    s.t.stop();
    await s.t.idle();
    expect(s.goals).toHaveLength(n);
  });
});
```

- [ ] **Step 2: 실패를 본다**

Run: `npm run heavy -- npx vitest run tests/act-goal.test.ts`
Expected: FAIL — 버림이 오지 않음(`dropped` 없음).

- [ ] **Step 3: 구현한다**

`src/act/track/goal.ts`의 `watch`를 바꾼다(`putAway`를 tasks import에 더한다):

```ts
  /** 목표가 아직 맞는지 보고, 사람이 떠났으면 fired로 바꾼다. 안전 알림·코치 모드·다른 계획·시간 넘음이면 버린다(지금 길로 돌아간다).
   *  - 사람이 보이는 동안: 다른 등장이면 back, 대상이 이어진 물건 없이 사라지거나 치워지면 moved.
   *  - 사람이 떠남: 대상이 없으면 took(들고 나감). 손에 있음으로 남아 있으면 사람이 떠난 때부터 fireWaitMs 기다린 뒤 took. 그대로 있으면 fired와 nudge.
   *  - fired 뒤: 사람이 다시 보이면 back, 대상이 사라지면 took, fireWaitMs 안에 PAM이 그 행동을 고르지 않으면 pam. */
  private watch(g: Goal): void {
    const world = this.o.world();
    const now = this.clock.now();
    const p = world.person;
    const v = g.view;
    if (emergencyOf({ world, offNotices: this.core.safety.offTrack().notices })) return this.drop("safety");
    if (!(this.o.tasks?.() ?? TASK_NAMES).includes(v.action)) return this.drop("mode");
    if (this.core.open() || (this.core.planning && this.core.planning.decision.action !== v.action)) return this.drop("other");
    if (now - v.armed_ms > (this.o.goalArmMs ?? GOAL_DEFAULTS.armMs)) return this.drop("expired");
    const o = world.objects.find((x) => x.id === followedId(world, g.objectId));
    if (v.status === "fired") {
      if (p.visible) return this.drop("back");
      if (!o || o.status === "gone") return this.drop("took");
      if (now - (v.fired_ms ?? now) > GOAL_DEFAULTS.fireWaitMs) return this.drop("pam");
      return;
    }
    if (p.visible) {
      if (p.since_ms !== g.presence) return this.drop("back");
      if (!o || o.status === "gone" || putAway(o, this.core.steps.placed())) return this.drop("moved");
      return;
    }
    if (!o || o.status === "gone") return this.drop("took");
    if (putAway(o, this.core.steps.placed())) return this.drop("moved");
    if (o.facts.place?.value === "in_hand" || o.carried === true) {
      if (p.since_ms !== null && now - p.since_ms > GOAL_DEFAULTS.fireWaitMs) this.drop("took");
      return;
    }
    g.objectId = o.id;
    this.set(g, { status: "fired", object: o.id, gone_ms: p.since_ms, fired_ms: now });
    this.o.nudge?.();
  }
```

`src/act/track/start.ts` `onDecision`: `holds` 줄 바로 앞에:

```ts
    // 다른 행동을 고른 판단이 맡는다: 미리 세운 목표를 버리고 지금 길로(goal.ts)
    const goal = core.goal.current();
    if (goal && goal.action !== d.action) core.goal.drop("other");
```

- [ ] **Step 4: 통과를 본다**

Run: `npm run heavy -- npx vitest run tests/act-goal.test.ts tests/act-track.test.ts tests/act-track-release.test.ts`, `npm run heavy -- npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/act/track/goal.ts src/act/track/start.ts tests/act-goal.test.ts
git status
git commit -m "feat(act): drop the pending goal when the person takes the cup, returns, the cup moves, another decision or a safety event takes over"
```

---

### Task 7: 서버 잇기 — `/brain/goal` 발행, 대시보드 메시지, PAM 바로 부르기

**Files:**
- Modify: `src/server/home/act.ts`, `src/server/home/core.ts`, `src/server/home/index.ts`, `src/server/app.ts`, `src/contract/events.ts`
- Test: `tests/goal-server.test.ts`(새), `tests/server.test.ts`

**Interfaces:**
- Consumes: Task 1~6 전부
- Produces: `publishGoal(core: Pick<HomeCore, "out" | "app" | "goal">, g: PendingGoal): void`, `HomeCore.goal: PendingGoal | null`, `AppOptions.goalLast?: () => PendingGoal | null`, `ServerMessage`의 `{ type: "goal"; goal: PendingGoal }`

- [ ] **Step 1: 실패하는 시험을 쓴다**

`tests/goal-server.test.ts`:

```ts
// 집 실행 묶음의 미리 세운 목표 잇기(src/server/home/act.ts publishGoal): 목표가 바뀌면 /brain/goal(STATE)로 내 녹화에 남고, 대시보드로 {type:"goal"}을 보내며 마지막 목표를 둔다.
import { describe, expect, it } from "vitest";
import { HistoryDb } from "../src/brain/index.js";
import { BusNode, MemoryBus, Outbox, realClock } from "../src/bus/index.js";
import type { PendingGoal } from "../src/contract/goal.js";
import { Bag, startRecorder } from "../src/record/index.js";
import { publishGoal } from "../src/server/home/act.js";

const EPOCH = { boot: "b1", home: "h#1" };
const GOAL: PendingGoal = {
  id: "goal-1", action: "컵 치우기", state: "left_cup", trigger: "t", object: "cup_1", cls: "cup", status: "armed", reason: null, text: "컵을 두고 자리를 뜨면 컵을 치울게요",
  armed_ms: 1, ready_ms: null, gone_ms: null, fired_ms: null, plan: null,
};

describe("미리 세운 목표 잇기", () => {
  it("목표가 바뀌면 /brain/goal로 내 녹화에 남고, 대시보드로 {type:\"goal\"}을 보내며 마지막 목표를 둔다", async () => {
    const bus = new MemoryBus();
    const bag = Bag.open(":memory:");
    const rec = await startRecorder({ bus, epoch: EPOCH, db: HistoryDb.open(":memory:"), bag });
    rec.start();
    const act = new BusNode({ name: "act", bus, epoch: EPOCH, log: () => {} });
    await act.prepare();
    act.start();
    const sent: unknown[] = [];
    const core = { out: { act: new Outbox(act, { clock: realClock, log: () => {} }) }, app: { broadcast: (m: unknown) => sent.push(m) }, goal: null } as unknown as Parameters<typeof publishGoal>[0];
    publishGoal(core, GOAL);
    publishGoal(core, { ...GOAL, status: "ready" });
    expect(await core.out.act!.drain(1000)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    await rec.idle();
    expect(bag.range(0, Number.MAX_SAFE_INTEGER).filter(({ e }) => e.topic === "/brain/goal").map(({ e }) => (e.body as { goal: PendingGoal }).goal.status)).toEqual(["armed", "ready"]);
    expect(sent).toEqual([{ type: "goal", goal: GOAL }, { type: "goal", goal: { ...GOAL, status: "ready" } }]);
    expect(core.goal).toMatchObject({ status: "ready" });
  });
});
```

`tests/server.test.ts` 접속 시험 묶음에 더한다:

```ts
  it("WS에 붙으면 마지막 미리 세운 목표를 {type:\"goal\"}로 말풍선 글 뒤에 보낸다(없으면 보내지 않는다)", async () => {
    const home = makeHome();
    const goal = {
      id: "goal-1", action: "컵 치우기", state: "left_cup", trigger: "t", object: "cup_1", cls: "cup", status: "ready" as const, reason: null, text: "컵을 두고 자리를 뜨면 컵을 치울게요",
      armed_ms: 1, ready_ms: 2, gone_ms: null, fired_ms: null, plan: null,
    };
    const app = createApp({ hub: home.hub, policy: home.policy, rooms: ROOMS, log: () => {}, say: () => ({ text: null }), goalLast: () => goal });
    const { url } = await app.listen(0, "127.0.0.1");
    cleanups.push(() => app.close());
    const { waitFor } = await listen(url);
    expect(await waitFor((m) => m.type === "goal")).toEqual({ type: "goal", goal });
  });
```

- [ ] **Step 2: 실패를 본다**

Run: `npm run heavy -- npx vitest run tests/goal-server.test.ts tests/server.test.ts`
Expected: FAIL — `publishGoal`이 없다, `goalLast`가 `AppOptions`에 없다.

- [ ] **Step 3: 구현한다**

`src/contract/events.ts` `ServerMessage` 끝에:

```ts
  /** 미리 세운 목표(src/act/track/goal.ts): 바뀔 때마다, 그리고 접속 때 마지막 것. 대시보드는 세움·계획 중·준비됨·사람 떠남인 동안 메시지 상자 알약으로 보인다. */
  | { type: "goal"; goal: PendingGoal };
```

(`import type { PendingGoal } from "./goal.js";`)

`src/server/app.ts` `AppOptions`에:

```ts
  /** 마지막 미리 세운 목표(src/act/track/goal.ts). /events 접속 때 {type:"goal"}. 없거나 null이면 보내지 않는다. */
  goalLast?: () => PendingGoal | null;
```

접속 처리에서 `if (opts.actMode) send(ws, { type: "mode", mode: opts.actMode() });` 뒤에:

```ts
    const goal = opts.goalLast?.();
    if (goal) send(ws, { type: "goal", goal });
```

`src/server/home/core.ts` `HomeCore`(말풍선 카드 칸 근처)에 `/** 마지막 미리 세운 목표(접속한 대시보드에 다시 보낸다). */ goal: PendingGoal | null = null;`.

`src/server/home/index.ts`: `actMode: () => core.mode(),` 아래에 `goalLast: () => core.goal,`.

`src/server/home/act.ts`:
- import에 `resubmit, type PlanAhead, type PlanContext`(agent), `type TaskSpec`(act/tasks), `type DecisionRecord`(contract/events), `type PendingGoal`(contract/goal).
- 파일에 더한다:

```ts
/** 미리 세운 목표(src/act/track/goal.ts)를 /brain/goal(STATE, 녹화)과 대시보드로 보낸다. 접속한 대시보드에 다시 보내려고 마지막 것을 둔다. */
export function publishGoal(core: Pick<HomeCore, "out" | "app" | "goal">, g: PendingGoal): void {
  core.goal = g;
  core.out.act?.push("/brain/goal", { goal: g });   // 거울 노드(act)의 차례대로 보내기(src/bus/outbox.ts)
  core.app?.broadcast({ type: "goal", goal: g });
}
```

- `startAct` 안에서 계획 맥락을 하나로 만들고 실행 추적 옵션을 잇는다:

```ts
  // 계획 입력: 계획 모드·미리 만든 계획 다시 내기가 같은 맥락을 쓴다(이미 치운 물건 placed는 그때 것)
  const planCtx = (d: DecisionRecord, task: TaskSpec, ahead?: PlanAhead): PlanContext => ({
    decision: d, task, world: view(), floor: plans.floor(), places: core.places(), names: placeNames, rooms: twin.rooms, devices: deviceViews(signals), nowIso: new Date(now()).toISOString(),
    placed: new Map(core.tracker?.placed() ?? []), ...(task.coach ? { lesson: lessons.get(task.name) } : {}), ...(ahead ? { ahead } : {}),
  });
```

```ts
    planner: (d, signal, ahead) => {
      const task = taskOf(d.action);
      if (!task) return { ok: false, error: "행동 목록에 없는 행동" };
      return planner.plan(planCtx(d, task, ahead), signal);
    },
    // 미리 세운 목표(src/act/track/goal.ts): 그날 습관 기억과 판단이 마지막으로 맞은 상태, 미리 만든 계획 다시 내기, 목표 보내기, 사람이 떠나면 판단 바로 부르기
    habit: () => ({ ...memoryForDay(history.db, history.db.dayOf(now())), state: decide.fsmState() }),
    reuse: (d, plan) => {
      const task = taskOf(d.action);
      return task ? resubmit(plan, planCtx(d, task)) : { ok: false, error: "행동 목록에 없는 행동" };
    },
    onGoal: (g) => publishGoal(core, g),
    nudge: () => decide.nudge(),
    check: (d, p, seenSince) => checkPlan({
      decision: d, tasks: d.tasks ?? pamTasks(core.mode(), false), plan: p, world: view(), nowMs: now(), staleMs: core.act.staleMs, mode: ctx.mode?.() ?? "test", deviceSteps: deviceSteps(p),
      placed: core.tracker?.placed(), ...(seenSince !== undefined ? { seenSince } : {}),
    }),
```

(지금 `planner`·`check` 줄을 위 것으로 바꾼다. `routeWorldChanges`가 `tracker.onWorld`를 부르므로 사람 사라짐 변화가 오면 그 자리에서 목표가 fired·nudge가 되고, 다음 판단 타이머(250ms)가 PAM을 부른다.)

- [ ] **Step 4: 통과를 본다**

Run: `npm run heavy -- npx vitest run tests/goal-server.test.ts tests/server.test.ts tests/observe-start.test.ts`, `npm run heavy -- npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/server/home/act.ts src/server/home/core.ts src/server/home/index.ts src/server/app.ts src/contract/events.ts tests/goal-server.test.ts tests/server.test.ts
git status
git commit -m "feat(server): wire the pending goal to /brain/goal, the dashboard, the habit FSM, plan recheck and an immediate PAM call"
```

---

### Task 8: 대시보드 메시지 상자의 목표 알약

**Files:**
- Modify: `ui/src/dashboard/data.ts`, `ui/src/dashboard/TalkBox.tsx`, `ui/src/dashboard/words.ts`
- Test: `ui/tests/dashboard/data.test.ts`, `ui/tests/dashboard/screen.test.tsx`

**Interfaces:**
- Consumes: `ServerMessage`의 `{type:"goal"}`(Task 7)
- Produces: `DashData.goal: PendingGoal | null`, `Talk.goal?: string`(행동 이름), `WORDS.pill.goal`

- [ ] **Step 1: 실패하는 시험을 쓴다**

`ui/tests/dashboard/data.test.ts`:

```ts
import type { PendingGoal } from "../../../src/contract/goal.ts";

it("미리 세운 목표(goal 메시지)는 세움·계획 중·준비됨·사람 떠남인 동안 메시지 상자 알약(행동 이름)이고, 씀·버림이면 없다. hello는 지운다", () => {
  const g: PendingGoal = {
    id: "goal-1", action: "컵 치우기", state: "left_cup", trigger: "t", object: "cup_1", cls: "cup", status: "ready", reason: null, text: "컵을 두고 자리를 뜨면 컵을 치울게요",
    armed_ms: 1, ready_ms: 2, gone_ms: null, fired_ms: null, plan: null,
  };
  let s = reduceDash(EMPTY_DASH, { type: "goal", goal: g }, 0);
  expect(talkOf(s)).toEqual({ lines: [], fsm: null, goal: "컵 치우기" });
  s = reduceDash(s, { type: "goal", goal: { ...g, status: "fired" } }, 0);
  expect(talkOf(s)?.goal).toBe("컵 치우기");
  s = reduceDash(s, { type: "goal", goal: { ...g, status: "used" } }, 0);
  expect(talkOf(s)).toBeNull();
  s = reduceDash(reduceDash(s, { type: "goal", goal: { ...g, id: "goal-2", status: "armed" } }, 0), { type: "hello", devices: 0, provider: null, hub: "memory", home: null }, 0);
  expect(s.goal).toBeNull();
});
```

`ui/tests/dashboard/screen.test.tsx`의 메시지 상자 `describe`에 더하고, 같은 파일 「모든 자리가 같다」 시험의 `variants`에 `["목표", screenAt(2, { talk: { ...TALK, goal: "컵 치우기" } })],`를 더한다:

```ts
  it("미리 세운 목표가 있으면 머리 알약 줄 끝에 「목표 · 컵 치우기」(Status)가 있고, 없으면 없다", () => {
    draw(screenAt(2, { talk: { ...TALK, goal: "컵 치우기" } }));
    const pills = [...talk().querySelectorAll<HTMLElement>("[data-talk-pill]")];
    expect(pills.map((p) => p.dataset.talkPill)).toEqual(["state", "trigger", "action", "goal"]);
    expect(pills.at(-1)).toHaveTextContent("목표 · 컵 치우기");
    expect(pills.at(-1)!.getAttribute("data-slot")).toBe("status");
  });
```

- [ ] **Step 2: 실패를 본다**

Run: `npm run heavy -- npm --prefix ui test -- dashboard/data.test.ts dashboard/screen.test.tsx`
Expected: FAIL — `goal` 메시지를 모르고 알약이 없다.

- [ ] **Step 3: 구현한다**

`ui/src/dashboard/words.ts`: `pill: { state: "상태", trigger: "트리거", action: "액션", goal: "목표" },`.

`ui/src/dashboard/data.ts`:

```ts
import type { PendingGoal } from "../../../src/contract/goal.ts";
```

`DashData`에 `/** 미리 세운 목표(goal 메시지, src/act/track/goal.ts). 마지막으로 받은 것. */ goal: PendingGoal | null;`, `EMPTY_DASH`에 `goal: null`.

```ts
/** 메시지 상자 알약으로 보이는 목표 상태(세움·계획 중·준비됨·사람 떠남). 씀·버림이면 보이지 않는다. */
const GOAL_SHOWN = new Set<PendingGoal["status"]>(["armed", "planning", "ready", "fired"]);
```

`reduceDash`에:

```ts
    case "goal":
      return s.goal?.id === m.goal.id && s.goal.status === m.goal.status ? s : { ...s, goal: m.goal };
```

`Talk`에 `/** 미리 세운 목표의 행동 이름(알약 「목표 · …」). 없으면 칸이 없다. */ goal?: string;`. `talkOf` 끝을 바꾼다:

```ts
  const goal = s.goal && GOAL_SHOWN.has(s.goal.status) ? s.goal.action : null;
  return lines.length || fsm || goal ? { lines, fsm, ...(goal ? { goal } : {}) } : null;
```

`ui/src/dashboard/TalkBox.tsx`의 `ItemHeader`:

```tsx
          <ItemHeader className="min-w-0 justify-start">
            {talk?.fsm && <FsmPills pills={talk.fsm} />}
            {talk?.goal && <Status variant="brand" data-talk-pill="goal">{`${WORDS.pill.goal} · ${talk.goal}`}</Status>}
          </ItemHeader>
```

(컴포넌트 머리 설명에 「알약 셋 뒤에 미리 세운 목표 알약(있을 때)」을 더한다.)

- [ ] **Step 4: 통과를 본다**

Run: `npm run heavy -- npm --prefix ui test -- dashboard`, `npm run lint`(화면 글·부품·색·글 크기), `npm run heavy -- npm run typecheck`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add ui/src/dashboard/data.ts ui/src/dashboard/TalkBox.tsx ui/src/dashboard/words.ts ui/tests/dashboard/data.test.ts ui/tests/dashboard/screen.test.tsx
git status
git commit -m "feat(ui): show the pending goal as a pill in the dashboard message box"
```

---

### Task 9: 가짜 서버 처음부터 끝까지와 묶음 끝 조건

**Files:**
- Create: `tests/goal-e2e.test.ts`
- Test: 데모 e2e 넷, 영상 모드 셋, `ui/tests/phone-mode-parity.test.ts`, 기록 DB 같음 정답

**Interfaces:**
- Consumes: Task 1~8 전부

- [ ] **Step 1: 실패하는 시험을 쓴다** (`tests/goal-e2e.test.ts`, 틀은 `tests/cup-branches-e2e.test.ts`와 같다. `feat/vlm-objects`를 합친 뒤면 가짜 VLM 답을 그 가지 모양(`people`·`objects`)으로 바꾼다)

```ts
// 미리 세운 목표를 처음부터 끝까지(가짜 서버): 사람이 컵으로 마시는 동안 「컵 치우기」 목표를 세우고 계획을 미리 만든다. 사람이 떠나면 판단을 바로 부르고
// PAM이 컵 치우기를 고르면 미리 만든 계획으로 첫 명령을 낸다(계획 모드 호출은 처음 한 번뿐). 주기 판단은 5초다.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import type { Detection } from "../src/contract/observe.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { ScriptedDetector, det } from "./helpers/detectors.js";
import { cupBranchPredict, startFakePamLlm, type FakePamLlm, pamLlmEnv } from "./helpers/pam.js";
import { CUP_SCRIPTS, planTurn, plannerRespond } from "./helpers/planner.js";
import { openPhone, openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
let srv: RunningServer | undefined;
let fake: FakeServer | undefined;
let pam: FakePamLlm | undefined;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await srv?.close();
  srv = undefined;
  await fake?.close();
  fake = undefined;
  await pam?.close();
  pam = undefined;
});

/** 받은 메시지에 받은 시각(_at, 실제 시계)을 붙인다. */
const inbox = (list: Msg[]) => (ws: WebSocket) => ws.on("message", (d, bin) => { if (!bin) list.push({ ...JSON.parse(String(d)), _at: Date.now() }); });
const CUP = det("cup", 0.9, [220, 160, 40, 20], 41);
const PERSON = det("person", 0.9, [40, 40, 120, 280]);
interface Scene { dets: Detection[]; facts: Record<string, string[]> }

describe("미리 세운 목표(가짜 서버 처음부터 끝까지)", () => {
  it("마시는 동안 목표를 세우고 계획을 미리 만든다. 사람이 떠나면 계획 모드를 다시 부르지 않고 사람 사라짐 1초 안에 「식탁으로 가 주세요」를 보낸다", async () => {
    const scene: Scene = { dets: [PERSON, CUP], facts: { person: ["sitting", "drinking"], cup: ["on_table", "has_contents"] } };
    fake = await startFakeOpenAI({
      reply: (body) => {
        if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
        const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
        const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
        const dets = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string; class: string }[];
        return JSON.stringify({ scene: "kitchen", observations: dets.flatMap((d) => (scene.facts[d.class] ?? []).map((state) => ({ object_id: d.id, state }))), summary: "식탁" });
      },
      respond: plannerRespond({ ...CUP_SCRIPTS }),
    });
    pam = await startFakePamLlm({ predict: cupBranchPredict });
    const runtimeDir = mkdtempSync(join(tmpdir(), "rt-"));
    mkdirSync(join(runtimeDir, "homes", "apartment"), { recursive: true });
    writeFileSync(join(runtimeDir, "homes", "apartment", "approvals.json"), JSON.stringify({ always: { "task:컵 치우기": "2026-11-13T00:00:00.000Z" }, never: {} }));
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: runtimeDir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", PAM_PERIOD_MS: "5000",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, ...pamLlmEnv(pam), OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1` },
      brain: { detector: new ScriptedDetector(() => scene.dets) }, log: () => {},
    });
    const dash: Msg[] = [];
    sockets.push(await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: inbox(dash) }));
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const phone: Msg[] = [];
    const ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: inbox(phone) });
    sockets.push(ws);
    let n = 0;
    const frame = () => ws.send(encodeFramePacket({ kind: "engine", width: 480, height: 360, captured_at: Date.now(), time_err_ms: 0 }, Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
    const pump = async (until: () => boolean, ms = 30_000) => {
      for (const end = Date.now() + ms; Date.now() < end; ) {
        if (until()) return;
        frame();
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`조건이 ${ms / 1000}초 안에 맞지 않음`);
    };
    const goals = () => dash.filter((m) => m.type === "goal").map((m) => m.goal.status as string);
    const planned = () => fake!.requests.filter((r) => r.method === "POST" && r.path.endsWith("/responses") && planTurn(r.body)?.action === "컵 치우기").length;
    const spoken = () => phone.filter((m) => m.type === "command" && m.speak);

    await pump(() => goals().includes("ready"));
    expect(goals().slice(0, 3)).toEqual(["armed", "planning", "ready"]);
    expect(planned()).toBe(1);
    expect(spoken()).toEqual([]);
    expect(dash.some((m) => m.type === "thought" && m.messages.some((t: { text: string }) => t.text === "컵을 두고 자리를 뜨면 컵을 치울게요"))).toBe(true);

    scene.dets = [CUP];
    scene.facts = { cup: ["on_table", "has_contents"] };
    await pump(() => spoken().length > 0);
    const gone = dash.find((m) => m.type === "brain" && m.event.type === "world_change" && m.event.kind === "person_gone")!;
    expect(spoken()[0]).toMatchObject({ text: "식탁으로 가 주세요", kind: "go" });
    expect(spoken()[0]!._at - gone._at).toBeLessThanOrEqual(1000);
    expect(planned()).toBe(1);
    expect(goals().slice(-2)).toEqual(["fired", "used"]);
  }, 90_000);
});
```

- [ ] **Step 2: 실패를 본다(앞 Task 없이)**: Task 1~8을 다 넣은 뒤에 쓰므로, 시험을 먼저 넣고 Task 7의 `onGoal`·`nudge` 줄을 잠시 빼서 돌려 「goal 메시지 없음」·「1초 넘음」으로 실패하는 것을 본 뒤 되돌린다.

Run: `npm run heavy -- npx vitest run tests/goal-e2e.test.ts`
Expected(뺀 때): FAIL — `조건이 30초 안에 맞지 않음`(ready 없음). 되돌린 뒤 PASS.

- [ ] **Step 3: 묶음 끝 조건을 하나씩 돌린다**

```bash
npm run heavy -- npx vitest run tests/demo-e2e.test.ts
npm run heavy -- npx vitest run tests/noonchi-e2e.test.ts
npm run heavy -- npx vitest run tests/coach-e2e.test.ts
npm run heavy -- npx vitest run tests/cup-branches-e2e.test.ts
npm run heavy -- npx vitest run tests/video-mode-e2e.test.ts tests/video-real-e2e.test.ts tests/video-mode-parity.test.ts
npm run heavy -- npm --prefix ui test -- phone-mode-parity
npm run heavy -- npm run typecheck
npm run lint
```

Expected: PASS. 기록 DB 같음 정답(`tests/fixtures/history-golden`)은 바뀌지 않아야 한다(미리 세운 목표는 기록 DB 줄을 더하지 않고, 「다 쓰고 떠나면 할 일로 두었어요」는 주기 판단 메모로 빠진다). 정답이 다르면 `systematic-debugging`으로 까닭을 찾는다(정답을 다시 쓰지 않는다). 기존 시험이 계획 모드 요청 수를 세어 실패하면, 그 장면에서 목표가 세워져 미리 만들기 한 번이 더해진 것인지 확인하고 그 수를 새 값으로 바꾸며 그 줄에 「미리 세운 목표의 미리 만들기(2026-11-18-goal-preplan)」를 적는다. 다른 까닭이면 코드를 고친다.

- [ ] **Step 4: 커밋**

```bash
git add tests/goal-e2e.test.ts
git status
git commit -m "test(e2e): a pending goal prepares the cup plan while drinking and sends the first command within 1 s after the person leaves"
```

---

### Task 10: 구현명세서와 저장소 설명

**Files:**
- Modify: docs 저장소 `01_Product/구현명세서 SSOT.md` 6.3 판단·검사·실행, `변경이력.md`; 이 저장소 `docs/reference.md`(실행 추적 줄이 있는 곳)

- [ ] **Step 1:** `grep -n "쓰는 중\|관찰만\|holdMs\|30초" "../docs/01_Product/구현명세서 SSOT.md"`로 바꿀 자리를 찾는다.
- [ ] **Step 2:** 6.3에 「미리 세운 목표」 문단을 결론만 쓴다(무엇을 언제 세우는지, 미리 만들기, 사람이 떠나면 PAM 확인 뒤 미리 만든 계획, 버리는 경우 아홉, `/brain/goal`, 메시지 상자 알약·줄, 지연 약 1.0~1.9초). 판본을 올리고 `변경이력.md`에 한 줄 남긴다(docs 규칙: 문서 안에 판본 바뀜 글을 넣지 않는다).
- [ ] **Step 3:** `docs/reference.md`의 실행 추적 파일 목록에 `goal.ts` 한 줄을 더한다.
- [ ] **Step 4:** 각 저장소에서 그 파일만 `git add`하고 `git status`로 본 뒤 커밋한다(docs 저장소: `docs(spec): add pending goal preplanning to 6.3`, 이 저장소: `docs(reference): list the pending goal part of the tracker`).

---

## 정한 답 (2026-11-18, 사용자)

1. 떠난 뒤 PAM이 한 번 더 확인한 뒤 실행한다(약 1.0~1.9초).
2. 목표는 30분까지 들고 있는다.
3. 떠난 뒤 PAM이 그 행동을 고르지 않으면 15초 뒤 버린다.
4. 메시지 상자 문장은 「컵을 두고 자리를 뜨면 컵을 치울게요」다.
5. 목표로 미리 만든 계획은 승인을 묻지 않고 실행한다. 위험 목록은 그 단계에서 늘 묻는다(위 「사용자 답과 Codex 검토 반영」).

## 위험

| 위험 | 막는 것 |
|---|---|
| 미리 만든 계획을 못 쓰고 버림(들고 나감·다른 판단) → 계획 모드 호출 한 번 더 | 목표마다 미리 만들기 한 번, 같은 등장에서 다시 세우지 않음(Task 6 시험). 쓰면 호출 수는 지금과 같다 |
| 사라질 때 PAM 판단이 이미 나가 있음 → 약 1~1.6초 더 | `maxInflight` 1은 그대로 둔다(PAM 동시 호출을 늘리지 않음). 지연 예산 표 「나쁜 때」 |
| 손에 든 컵 자리로 만든 계획 → 가기 자리가 틀림 | 면 위에 놓였을 때만 미리 만들고, 쓸 때 면이 다르면 버림(moved) |
| 컵이 옮겨져 새 id | `followed_by`를 따라 id를 바꾸고 `PlanDraft`가 다시 검사(Task 2·6 시험) |
| 낡음 기준을 느슨하게 함 | 미리 만든 계획에만, 「사람이 떠난 때나 그 뒤에 본 대상」과 낡음 한도 3초를 같이 본다(Task 5 `act-check` 시험) |
| VLM만으로 물건을 고치게 되면 낡음 한도에 걸려 0~2초 더 | `feat/vlm-objects`의 낡음 규칙을 합친 뒤 Task 9 e2e로 다시 잰다. 이 계획은 그 규칙을 바꾸지 않는다 |
| 사람 요청·안전이 늦어짐 | 안전이면 버림, 대화·승인 대기 중이면 첫 명령을 미룸(지금 검사된 `useHeld` 길) |
| 같은 계획 모드 인스턴스를 같이 씀 | 미리 만들기는 계획 모드가 비어 있을 때만 시작하고, 진짜 판단의 계획이 시작되면 그쪽이 끊는다(지금 「계획은 한 번에 하나」) |

## Self-Review

- 정한 것 1(한 걸음 앞 규칙) → Task 1. 2(미리 만들기) → Task 4. 3(다시 검사·바로 첫 명령, 1~2초) → Task 2·5·9(시험 시계 250ms, e2e 1초). 4(버리기: 들고 나감·돌아옴·옮겨짐·다른 판단·안전) → Task 6(+ 모드·시간·PAM 안 고름). 5(메시지 상자 줄·알약, 로봇 말) → Task 4(줄)·8(알약). 6(안전·사람 요청 먼저) → Task 4(안전이면 세우지 않음)·5(대화 중 미룸)·6(안전이면 버림). 7(같은 계획 모드) → Task 2·4(`resubmit`은 모델 인자를 다시 검사만, 이름에 `planFor` 없음). 8(새 기다림 없음, 증거 수 그대로) → 지연 예산 표, Global Constraints.
- 통로: `/brain/goal` 토픽·녹화(Task 3), 서버 발행(Task 7), 묶음 3·4로 옮길 모양(「로봇 FSM·통로와의 관계」).
- 시험 요구: 마시는 동안 세움(Task 4), 계기 전 계획 준비(Task 4), 예산 안 첫 명령(Task 5 시험 시계·Task 9 e2e), 들고 감·돌아옴·안전으로 버림(Task 6), 메시지 상자 목표(Task 4 줄·Task 8 알약), 통로 기록(Task 3·7).
- 이름 맞춤: `goalAhead`·`GoalPick`(Task 1), `resubmit`·`PlanAhead`·`AgentPlan.submitted`·`followedId`(Task 2), `PendingGoal`·`GoalStatus`·`GoalDrop`·`BrainGoalMsg`·`/brain/goal`(Task 3), `GoalWatch`(`update`·`current`·`holds`·`take`·`drop`·`idle`·`stop`)·`GOAL_DEFAULTS`·`GOAL_TEXT`·`EXEC_TEXT.goalWait`·`UseWatch.holding`·`TrackerOptions`(`habit`·`reuse`·`onGoal`·`nudge`·`goalArmMs`)·`Job.prepared`·`Run.seenSince`·`CheckInput.seenSince`·`Trigger.nudge`·`Decider.nudge`·`Decider.fsmState`(Task 4·5), `publishGoal`·`HomeCore.goal`·`AppOptions.goalLast`·`{type:"goal"}`(Task 7), `DashData.goal`·`Talk.goal`·`WORDS.pill.goal`(Task 8)가 Task 사이에서 같다.
