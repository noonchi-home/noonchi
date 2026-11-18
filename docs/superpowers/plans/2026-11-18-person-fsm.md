# 사람 활동 FSM과 네 기계 나누기 Implementation Plan

> **쉬운 요약**
> 1. 기계를 넷으로 나눠요: **사람 활동 FSM**(배움), **목표 기계**(세움 → 미리 만드는 중 → 준비됨 → 시작 → 끝/버림), **로봇 실행 기계**(대기·관찰·이동·실행·복귀·막힘 복구), **안전 기계**(평소 → 의심 → 비상). 위에서 **관리자**가 「안전 > 말로 한 부탁 > 목표 > 대기」로 무엇을 할지 정하고 눈치·코치 모드도 정해요.
> 2. 실제 폰 명령은 로봇 실행 기계 하나만 내요. 계획 단계(가기·집기·넣기)는 「실행」 안의 하위 단계예요.
> 3. 안전 「의심」(쓰러짐 의심)이면 로봇이 그 사람 쪽으로 가서 실제 폰으로 「괜찮으세요?」를 소리로 묻고 들어요(두 번 × 8초). 「괜찮아」류 말이면 평소로, 말 답이 없거나 도움 말이면 비상으로 올려요. 대답은 말로만 받아요. 보호자 전화는 `feat/fall-call` 계획대로 나중이에요.
> 4. 사람 활동 FSM의 상태는 사람이 하는 일 하나예요(먹거나 마시는 중·TV 보는 중·요리하는 중·자리에 없음으로 시작). 행동은 화살표에만 붙어요. 물건·집 조건(컵 남음·아무도 안 만짐·내용물)은 FSM에 없고 그 행동의 실행 전 검사가 봐요.
> 5. PAM 판단 답이 「지금 상태, 일어난 화살표, 그 행동」을 함께 내요. 서버·화면은 그대로 쓰고 거꾸로 찾기(`fsmNow`)는 없애요. 「대기」「그대로 두기」는 화살표 없음이에요.
> 6. 반성은 (출발 상태, 행동)마다 화살표 조건 후보 1~3개를 내요(후보 FSM). 코드 검사(모양) → LLM 검사(뜻) → 시각 찾기 → 채택 검사(석준 님 방식: 따라온 비율 75% 이상·단측 이항검정 p < 0.001, 「치워 줘」 답도 따라온 것)를 지난 후보만 로봇이 쓰는 FSM에 들어가요. 거절이면 까닭을 돌려줘 한 번 다시 반성하고, 그래도 안 되면 전날 기억을 써요.
> 7. 옛 기억은 옮기지 않아요(합성 기록에서 나온 것). 합성 일주일을 새 모양으로 다시 쌓고, 옛 모양 기억을 읽으면 새 seed로 다시 시작해요.
> 8. 한 번에 다 바꾸지 않아요. 묶음 A(사람 활동 FSM) → B(상태 토픽 그림자) → C(안전) → D(로봇 실행) → E(목표·관리자) → F(노드 나누기) 차례로, 묶음마다 세 영상이 통과하고 사람 떠남 → 첫 명령 1.6~3.3초가 나빠지지 않아야 해요.
> 9. 사용자가 정한 습관(물 채우기·콜라·에어컨·코치)은 검사 없이 늘 로봇 FSM에 있어요. **배우는 습관은 컵 치우기와 「말없이 TV 보기 시작 → 에어컨 켜기」 둘**이에요: seed에는 둘 다 없어요. 컵은 처음 이틀은 떠날 때 묻고 채택 검사를 지난 3일째부터 바로 치워요. 에어컨은 4일째부터 말없이 켜요(덥다·부채질 → 에어컨은 정한 습관이라 늘 있어요). 배우기 전 떠날 때 메시지 상자는 「컵을 치울지 여쭤볼게요」예요. 로봇이 이미 치운 때는 셈에서 빼요(못 봄). 치우기를 보는 시험·영상·시연은 배운 뒤 기억으로 돌고, 목표 미리 세우기도 배운 화살표에서만 서요.
> 10. 대시보드는 FSM 원 카드 대신 시간 줄(사람 · 예상 · 로봇)을 써요(2026-11-19 결정). 사람 줄에는 사람 상태 구간이, 로봇 줄에는 로봇 실행 기계의 계획 단계 구간이 보여요. 화면은 `feat/fsm-card`가 만들고, 이 계획은 두 줄에 넣을 자료를 넘겨요.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 습관 FSM을 사람 활동만의 Mealy 꼴로 바꾸고(묶음 A), 목표·로봇 실행·안전을 따로 도는 상태 기계로 나눠 관리자가 우선순위로 고르게 한다(묶음 B~F). 실제 폰 명령은 로봇 실행 기계 하나만 낸다.

**Architecture:** 묶음 A는 기억 모양·검사(`src/brain/decision.ts`), PAM 계약 `pam-predict/3`(답에 상태·화살표), 반성 뒤 코드 검사·LLM 검사, 목표 고르기를 바꾼다. 묶음 B~F는 지금 실행 추적(`src/act/track/`)에 흩어진 상태를 기계 넷과 관리자로 옮긴다: 먼저 지금 코드에서 상태를 읽어 토픽으로만 내는 그림자(B), 그다음 안전(C)·로봇 실행(D)·목표와 관리자(E)를 하나씩 진짜로 바꾸고, 마지막에 Redis 노드로 나눈다(F, `refactor/stage-queue` 묶음 3·4 뒤). 기계마다 노드 하나·상태 토픽 하나(STATE 최신 보기 + RELIABLE 전이 기록)이고 녹화·재생에 남는다.

**Tech Stack:** Node 22 TypeScript, zod 4.6.5, Vitest, RedisBus·MemoryBus(`src/bus/`), 가짜 PAM LLM(`tests/helpers/pam.ts`), PAM 골든(`tests/pam-golden.test.ts`), React 대시보드(`ui/`).

**Spec:** 사용자 말(2026-11-18, 조정자 전달): 「FSM을 사람의 상태로만 하면 더 자연스러우려나 … 마시는중에서 다른 상태로 넘어가면(티비보기/방에서 공부하기) 이전에 것을 해결하는 느낌이지」, 「트리거에 대해 행동을 하는 게 FSM 아니야?」, 「로봇상태는 우리 폰에 지시하기 위함이니까 필요한거」, 「마시는 중만 넣어야지 컵 있음은 사람 상태 아니잖아」, 「FSM 만드는 규칙 정확히 해야겠네」, 「검사를 규칙기반으로 해? LLM으로 해야 하는 거 아녀?」(→ 코드 검사와 LLM 검사로 나눔). 바탕: main 10ef2ec, `docs/superpowers/plans/2026-11-17-stage-queue.md`(노드·토픽·폰 사용권), `docs/superpowers/plans/2026-11-18-fsm-card.md`(`feat/fsm-card`).

## 정한 것 (2026-11-18, 사용자·조정자)

1. 기계는 넷이다: 사람 활동 FSM(배움, 반성은 이것만 고친다), 목표 기계, 로봇 실행 기계, 안전 기계. 위에 목표·모드 관리자가 「안전 > 말로 한 부탁 > 목표 > 대기」로 정하고 지금 모드(눈치·코치)도 정한다.
2. 실제 폰 명령은 로봇 실행 기계 하나만 낸다. 관찰 모드·찾기·내용물 보기·충전 복귀·계획 단계 명령이 모두 이 기계를 거친다. 계획 단계는 「실행」 안의 하위 단계다.
3. 안전 기계는 다른 기계와 따로(병렬로) 돌고, 비상이면 로봇 실행 기계를 바로 멈추게 한다.
4. 목표 기계는 사람 FSM과 따로다. 화면에서도 사람 FSM과 섞지 않는다(목표가 보이는 자리는 `feat/fsm-card`가 정한다).
5. 기계마다 노드 하나·상태 토픽 하나(STATE 최신 + 전이 RELIABLE 기록), 녹화·재생에 남는다.
6. PAM 판단 답이 지금 사람 상태, 일어난 화살표, 그 행동(없으면 없음)을 낸다. 거꾸로 찾기(`fsmRuleOf`·`fsmNow`)는 없앤다.
7. 사람 활동 FSM 상태는 넷으로 시작한다(먹거나 마시는 중·TV 보는 중·요리하는 중·자리에 없음). 반성은 다른 활동만 새 상태로 더하고, 비슷한 상태는 합치며, 상태는 12개까지다.
8. 「자리에 없음」은 하나다(안 보이면 자리에 없음, 「모름」 따로 없음). 처음 상태도 그것이다.
9. 옛 기억은 옮기지 않는다(합성 일주일 기록에서 나온 것). 합성 데이터를 새 모양으로 다시 쌓고, 옛 모양 기억을 읽으면 새 seed로 다시 시작한다고 한 줄 남긴다.
10. 상태를 World State 사람 하는 일과 바로 잇는다(목표가 4초쯤 선다).
11. 「컵 그대로 두기」는 PAM 행동 목록에서 뺀다(안 하기 = 화살표 없음). PAM은 기억 화살표의 행동만 고르고, 기억에 없는 일은 말 부탁 길(말 요청 에이전트 `request_task` → 계획 모드 → 실행, Task 12)로만 한다.
12. 기억 검사는 둘이다: 코드 검사(모양, 정답이 분명한 것)와 LLM 검사(뜻). 물건 낱말 목록으로 상태 이름을 막지 않는다(놓치거나 지나치게 막는다).
13. 합성 이야기는 「처음 이틀은 묻고 → 3일째부터 바로 치우기」다(사용자 확정 2026-11-18, 채택 검사로 센 날, Task 9).
14. 안전 「의심」(쓰러짐 의심)이면 로봇 실행 기계가 그 사람 쪽으로 가서(이동·관찰) 실제 폰으로 「괜찮으세요?」를 소리로 묻고 듣는다. 「괜찮아」류 말이면 평소로, 정해진 시간 안에 말 답이 없거나 도움 말이면 비상으로 올린다. 묻는 횟수·듣는 시간은 `feat/fall-call` 계획(f3abcb5) 기본안(두 번 × 8초)을 따른다. 대답은 말로만 받는다(음성 우선). 보호자 전화는 그 계획대로 나중이고, 지금 비상 = 멈춤·안전 알림이다.
15. 로봇 실행 기계 상태는 대시보드 시간 줄(사람 · 예상 · 로봇)의 로봇 줄로 보인다(계획 단계 구간, 2026-11-19 대시보드 결정). FSM 원 카드는 쓰지 않는다. 화면은 `feat/fsm-card`가 만들고, 이 계획은 사람 줄 자료(사람 상태 구간, Task 10)와 로봇 줄 자료(로봇 실행 기계 전이, 묶음 B)를 넘긴다.
16. 묶음 F는 `refactor/stage-queue` 묶음 3·4 뒤에 한다.
17. 말 부탁은 손대는 단계(집기·넣기) 중이면 그 단계 뒤로 미룬다. 말 대화 답(말 에이전트의 대답)은 로봇 실행 기계 밖이다. 기억 뜻 검사 모델은 PAM LLM 그대로다.
18. 쓰러짐 확인의 두 번째 질문(보호자 전화 전)은 「괜찮으세요? 괜찮으시면 괜찮아라고 말해 주세요.」다(사용자 확정). 보호자 전화가 들어오면 `feat/fall-call` 계획 글로 바꾼다.
19. 석준 님 ai 저장소의 채택 검사와 덩어리 기록을 묶음 A에 넣는다(사용자 결정 2026-11-18). 반성은 (출발 상태, 행동)마다 화살표 조건 후보 1~3개를 가진 후보 FSM을 내고, 로봇이 쓰는 FSM에는 seed 화살표(사용자가 정한 습관·떠날 때 묻기)와 채택 검사를 통과한 후보 화살표만 간다. 후보 문구·상태 id는 반성이 바꾸지 않는다.
20. 셈하기: 후보가 나온 뒤 검사 창 안에 사람이 직접 그 일을 했거나, 로봇이 물었을 때 「치워 줘」류로 답했으면 따라온 것(k)이다. 「두라」 답이나 아무 일 없음은 따라오지 않은 것(n만), 안 보임은 못 봄. 로봇이 습관대로 그 일을 한 구간(사람이 하지도 답하지도 않음)도 못 봄이다(로봇이 한 일이 스스로 습관을 굳히지 않는다, 사용자 답 2026-11-18). 답이 있는 창은 사람이 안 보였어도 본 것이다.
21. 채택 검사는 Node로 옮겨(`src/brain/pam/adopt.ts`, 계산만) 석준 님 시험 경우를 그대로 옮겨 같은 답으로 막는다.
22. 검사 순서: 반성 → 코드 모양 검사 → LLM 뜻 검사 → 시각 찾기·채택 검사 → 통과한 것만 로봇 FSM. 하루 기록은 덩어리(시작·끝·한 문장)로 묶어 반성·시각 찾기 입력으로 쓰고 사람 상태 흐름과 잇는다.
23. 사용자가 정한 습관(물 채우기·콜라·에어컨·코치)은 채택 검사 없이 늘 로봇 FSM에 있다(사용자 답 2026-11-18). 이 습관은 seed(`CUP_FSM_MEMORY`)에 있다(설정화면 `/setup/`에는 습관 칸이 없고 집·기기·모드·자리만 있다). 반성·채택은 이 화살표를 바꾸지 않는다.
24. 배우는 습관은 컵 치우기와 「말없이 TV 보기 시작 → 에어컨 켜기」(데모 「2-습관」, 사용자 답 2026-11-19)다(`TASKS[…].learn`, `LEARNED_ACTIONS` = 컵 치우기·에어컨 켜기). 에어컨 켜기는 행동이 배우는 행동이어도 덥다·부채질 화살표는 사용자가 정한 습관이라 늘 둔다: 정한 습관은 행동 이름이 아니라 seed 화살표(묻기가 아닌 seed 행동 화살표)로 가린다. 말없이 켜기는 채택 검사를 지나면 자리에 없음 → TV 보는 중 진입 화살표(「사용자가 돌아와 TV를 본다.」, seed에는 행동 없음)에 그 자리(같은 번호)에서 붙는다. seed에는 컵 치우기 화살표가 없고, 그 자리(마시는 중에서 떠남·TV 보며 마시던 중 떠남)는 「사용자에게 물어보기」 화살표다. 채택 검사를 지난 컵 치우기 후보만 로봇 FSM에 들어가고, 같은 트리거(on·when)의 묻기 화살표를 그 자리(같은 번호)에서 바꾼다. 반성 후보는 배우는 행동만 받는다(다른 행동 후보는 빼고 기록).
25. 치우기를 보는 시험·영상·시연은 배운 뒤 기억(`LEARNED_FSM_MEMORY` = 합성 3일째부터 쓰는 로봇 FSM과 같은 화살표)으로 돈다. seed 기억으로 돌면 떠날 때 묻는다(묻기 시험은 따로 둔다). 목표 미리 세우기도 배운 컵 치우기 화살표에서만 선다(묻기는 손대는 행동이 아니라 목표가 없다).
26. 메시지 상자(사용자 답 2026-11-19): 배우기 전 떠날 때는 허락 문장 없이 로봇 말 「컵을 치울지 여쭤볼게요.」 한 줄이다. 배운 뒤는 지금처럼 「컵을 두고 자리를 뜨면 치워도 된다고 하셨어요」 → 「컵을 치울게요.」다.
27. TV 보며 마시다 떠날 때(TV 보는 중 → 다른 일, 같이 마시는 중)는 배운 뒤에도 묻는다(사용자 답 2026-11-19, 합성 일주일에 이 일이 없다). 식탁(마시는 중)에서 떠나면 바로 치우고 TV 앞에서 떠나면 묻는 차이를 시험 하나로 지킨다(Task 3).
28. 말없이 에어컨은 **4일째부터**다(사용자 확인 2026-11-19): 1일째 「아 덥다」에 로봇이 켠 창은 로봇이 한 때라 셈에서 빠진다(못 봄). 「아 덥다」를 따라온 것으로 치지 않는다.

## 사람 FSM 만드는 규칙 (구현명세서 SSOT에도 같은 절)

1. **상태** = 사람이 하는 일 하나(비전으로 볼 수 있는 활동). 예: 마시는 중·TV 보는 중·노트북 하는 중·요리하는 중·자리에 없음. 물건 상태(컵 있음·내용물)·로봇 행동·장소만·시간대는 상태가 아니다. 안 보이면 「자리에 없음」 하나이고 처음 상태도 그것이다. 동시에 두 일이면 주된 일이 상태이고 나머지는 「같이 하는 일」이다(예: 노트북 하는 중 + 같이 마시는 중). 상태는 12개까지, 같은 활동은 합친다. 상태마다 World State 사람 하는 일 값(`activity`)을 단다.
2. **화살표** = 사람의 일이 바뀜(A → B, 또는 A → 다른 어느 일로든 `*`). 같은 일 중의 사람 사건(말·몸짓)은 자기 자신으로 가는 화살표다. 화살표 조건(`when`)은 사람 쪽 사실만이다(같이 하던 일, 한 말). (출발, 사건 `on`, 조건 `when`)이 같은 화살표는 하나뿐이다.
3. **행동** = 화살표 위에만, 하나, 로봇 할 일 목록에 있는 것만. 안 하기는 화살표 없음이다. 물건·집 조건(컵 남음·아무도 안 만짐·내용물)은 FSM에 넣지 않고 그 행동의 실행 전 검사(지금 있는 계획 전·실행 전 검사)가 본다. 맞지 않으면 그 검사대로 하고, 검사할 것이 없으면 조용히 안 한다.
4. **목표** = 지금 상태에서 나가는 화살표의 행동을 읽기만 한다(목표 기계가 쓴다).
5. **반성** = 새 활동 상태 더하기, 화살표·행동 더하기·바꾸기·지우기만 한다. 행동 화살표는 배우는 행동(컵 치우기·에어컨 켜기)만 (출발 상태, 행동)마다 조건 후보 1~3개로 내고(후보 FSM), 채택 검사를 통과한 후보만 로봇 FSM 화살표가 된다. 사용자가 정한 습관 화살표(seed)는 반성이 고치지 않는다. 있던 상태 id·후보 문구는 바꾸지 않는다. 1~3을 어긴 기억은 거절하고 전날 기억을 쓴다. 로봇·목표·안전 기계는 기억에 없어 반성이 고칠 수 없다.

**검사 셋:**

| 검사 | 보는 것 | 언제 | 어디 |
|---|---|---|---|
| 코드 검사(모양) | 같은 (출발·사건·조건) 화살표 둘, 목록 밖 행동·안 하기 행동, 행동 없는 `*` 화살표, 상태 12개 초과, 처음 상태 「자리에 없음」(`away`)이 있고 처음 상태다. 그 밖 모양: 칸, 없는 상태로 가는 화살표, 모르는 하는 일 값·한 값이 두 상태에, `away` 밖 상태의 하는 일 값 없음 | 판단 요청·반성 직후·DB 읽기 | `validateMemory`(`src/brain/decision.ts`), 시험으로 막는다 |
| 채택 검사(따라옴) | 후보마다 따라온 비율 75% 이상이고 단측 이항검정 p < 0.001(p0 = max(다른 때 비율, 0.01), 검사 창 300초, 마지막 후보만 공로, 안 보인 구간·로봇이 그 일을 한 구간은 못 봄, 「치워 줘」 답은 따라옴, 「두세요」 답이 있는 창은 본 것) | 밤 흐름의 시각 찾기 뒤 | `src/brain/pam/adopt.ts`(석준 님 `trigger_check.py` 그대로에 답 칸 `answered` 하나, 모델 안 부름) |
| LLM 검사(뜻) | 상태 이름·설명이 사람이 하는 일인지(물건·장소·로봇 행동·시간대가 섞이지 않았는지, 예 「컵 두고 떠남」 거절), 화살표 조건이 사람 쪽 사실만인지, 비슷한 상태(「TV 시청 중」·「TV 보는 중」)를 합쳐야 하는지 | 반성 직후 한 번(코드 검사 뒤) | `PamClient.checkMemory`(같은 PAM LLM 통로·같은 구조, 엄격한 JSON: 통과 여부 + 항목별 까닭) |

**흐름:** 덩어리 기록 → 반성(후보 FSM) → 배우지 않는 행동 후보 빼기(사용자가 정한 습관·코치) → 코드 검사 → LLM 검사 → 거절이면 까닭을 반성 피드백에 붙여 한 번 다시 → 시각 찾기 → 채택 검사 → 로봇 FSM(seed 화살표 + 통과한 배우는 행동 후보, 같은 트리거의 묻기 화살표는 바꾸고 정한 습관 화살표는 그대로) → 코드 검사 → 저장(로봇·후보 판본과 반성 기록을 한 트랜잭션으로, 후보 판본은 실행 기억으로 뽑히지 않음). 끝내 거절·실패면 새 판본을 저장하지 않고 전날 기억을 쓴다(반성 기록에 까닭). 판단 속도에는 영향이 없다(밤 한 번).

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
        // 컵 치우기는 배우는 습관이라 seed에 없다(2026-11-18 사용자 답): 떠날 때는 묻고, 채택 검사를 지난 컵 치우기 후보가 이 화살표를 바꾼다
        { to: "*", on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", action: "사용자에게 물어보기" },
        { to: "drinking", on: "사용자가 마시던 것을 다 마시고 계속 먹는다.", action: "컵에 물 채워 주기" },
      ],
    },
    {
      id: "watching_tv", description: "사용자가 TV를 보는 중이다.", activity: ["watching_tv"],
      next: [
        { to: "watching_tv", on: "사용자가 TV를 보며 마시던 것을 다 마신다.", when: "같이 마시는 중이었다.", action: "컵에 콜라 따라 주기" },
        // 의도 파악(2026-11-13): 바라는 것을 돌려 말한 혼잣말(「아 덥다」)이나 부채질
        { to: "watching_tv", on: "사용자가 덥다고 말하거나 더워서 부채질을 한다.", action: "에어컨 켜기" },
        { to: "*", on: "사용자가 TV 보기를 끝내고 다른 일로 넘어간다.", when: "같이 마시는 중이었다.", action: "사용자에게 물어보기" },
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

seed 행동 화살표는 둘로 나뉜다: **사용자가 정한 습관**(물 채우기·콜라·에어컨·코치 둘, 늘 둠)과 **떠날 때 묻기**(마시는 중·TV 보며 마시던 중, 컵 치우기를 배우기 전 길). 채택 검사를 지난 컵 치우기 후보는 같은 트리거의 묻기 화살표를 바꾼다. 말없이 에어컨 켜기는 seed에 없고, 통과하면 자리에 없음의 진입 화살표 `{ to: "watching_tv", on: "사용자가 돌아와 TV를 본다." }`에 `action: "에어컨 켜기"`가 붙는다(같은 번호). 직전 상태가 자리에 없음일 때 PAM이 고르는 화살표가 이것이라 TV를 보기 시작하는 판단에서 켠다(Codex b115d69 P2: TV 보는 중 자기 화살표에 두면 직전 상태가 자리에 없음일 때 고를 수 없었다). 다른 일(마시는 중 등)에서 TV로 넘어가면 그 상태의 떠나는 화살표가 켜지고 이 습관은 켜지지 않는다. 첫 판단처럼 직전 상태를 모르면 처음 상태(자리에 없음)로 본다(Task 3 판단 프롬프트). 컵 치우기만 배운 결과가 배운 뒤 기억이다(합성 3일째부터 쓰는 기억):

```ts
// scripts/learned-memory.ts (Task 1): 채택 검사를 지난 뒤(합성 3일째부터)의 로봇 FSM. 치우기를 보는 시험·영상·시연이 쓴다
/** seed에서 그 상태들의 떠날 때 묻기 화살표만 컵 치우기로(같은 번호·on·when). 기본은 마시는 중 하나(합성 일주일이 배우는 것). */
export function learnedFsm(states: readonly string[] = ["drinking"]): FsmMemory {
  const m = structuredClone(CUP_FSM_MEMORY);
  for (const s of m.states) if (states.includes(s.id)) for (const e of s.next) if (e.to === ANY_STATE && e.action === ASK_ACTION) e.action = "컵 치우기";
  return validateMemory(m, "fsm") as FsmMemory;
}
export const LEARNED_FSM_MEMORY = learnedFsm();
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

## 후보 FSM과 채택 검사 (석준 님 ai 저장소 origin/main 48d56a1에서 옮김)

출처(읽기만): `pam/trigger_check.py`, `tests/test_trigger_check.py`, `prompts/text/README.md`, `prompts/text/marking.txt`, `prompts/text/chunking.txt`, `pam/daily_run.py`, `pam/contracts.py`. 계산은 그대로 옮기고, 모양만 이 계획의 사람 활동 FSM(화살표)에 맞춘다.

**두 FSM:**
- **후보 FSM**(반성이 냄, 기록 DB 기억 종류 `fsm_candidates`): 상태마다 행동 없는 화살표 `next`와, (출발 상태, 행동)마다 화살표 조건 후보 1~3개를 가진 `rules`.
- **로봇 FSM**(판단이 PAM에 보냄, 기억 종류 `fsm`): seed(사용자가 정한 습관 화살표는 늘, 떠날 때 묻기 화살표) + 채택 검사를 통과한 배우는 행동 후보(컵 치우기·에어컨 켜기, 석준 님 `predictor_fsm`). 통과 후보와 같은 트리거(on·when)의 묻기 화살표는 그 후보가 그 자리(같은 번호)에서 바꾸고, 다른 트리거면 그 상태 끝에 더한다. 사용자가 정한 습관 화살표와 같은 트리거인 후보는 넣지 않는다(정한 습관이 먼저, 반성 기록 까닭 `settings`). 통과한 후보마다 화살표 하나다(석준 님은 통과 후보를 " or "로 한 트리거에 잇지만, 이 계획은 PAM 답이 화살표 번호로 하나를 가리키므로 따로 둔다).

```ts
// src/contract/pam.ts
/** 후보 하나: 사람 사건(on)과 사람 쪽 조건(when). 상태 id·이 글은 반성이 바꾸지 않는다(검사 결과가 (상태 id, 행동, on, when)에 묶인다). */
export interface Candidate { on: string; when?: string }
/** (출발 상태, 행동)마다 후보 1~3개와 도착(to: 상태 id 또는 "*"). */
export interface CandidateRule { to: string; action: string; candidates: Candidate[] }
export interface CandidateState { id: string; description: string; activity: string[]; next: { to: string; on: string }[]; rules: CandidateRule[] }
export interface CandidateFsm { initial_state: string; states: CandidateState[] }
```

**셈하기**(석준 님 `check_candidate` 그대로, 시각은 자정부터 초):
- 후보 c가 그 출발 상태에서 일어난 때마다, 그 뒤 검사 창(`FOLLOW_SECONDS` 300초, 같은 후보가 다시 나오면 거기까지) 안에 행동 a가 있으면 따라온 것(k와 n 하나씩). 마지막 후보만 공로를 받는다.
- 행동 a의 때 = 사람이 직접 그 일을 한 때(시각 찾기) ∪ **로봇이 그 일을 물었을 때 「치워 줘」류로 답한 때**(기록 DB 답 줄, 사용자 결정 2026-11-18). 「두라」 답이나 아무 일 없음은 따라오지 않은 것(n만 하나). 창이 사람이 안 보인 구간에 걸리고 행동이 없으면 「못 봄」(셈에서 뺌).
- **로봇이 한 구간은 못 봄**(사용자 답 2026-11-18): 로봇이 그 행동을 실행한 구간(실행 기록에서 그 행동 계획이 `running`이 된 때부터 `done`·`failed`까지)은 안 보인 구간에 더한다. 창 안에 사람 행동·답이 없고 그 구간에 걸리면 못 봄이다. 그래서 채택 뒤 로봇이 바로 치운 날은 n·k를 늘리지 않고, 로봇이 한 일이 스스로 습관을 굳히지 않는다. 다른 때 칸에서도 빠진다.
- **답이 있는 창은 본 것**: 창 안에 그 행동을 물은 질문의 답(「치워 주세요」·「그대로 둬요」)이 있으면 사람이 안 보였어도 못 봄이 아니다. 「치워 주세요」는 따라옴(k), 「그대로 둬요」는 따라오지 않음(n만). 석준 님 `check_candidate`에 `CheckDay.answered`(답한 때) 칸 하나만 더한다(떠난 뒤는 늘 안 보여서, 이 칸이 없으면 「그대로 둬요」 답도 못 봄이 된다).
- 다른 때 비율: 후보 창에 닿지 않고 안 보인 구간과도 겹치지 않는 창 길이 칸 가운데 행동이 든 칸의 몫. `p0 = max(다른 때 비율, 0.01)`.
- 채택: `k/n ≥ 0.75`(`RATE_MIN`)이고 단측 이항검정 `P(X ≥ k; n, p0) < 0.001`(`ALPHA`). 지난 날을 모두 모아 밤마다 다시 센다.

**덩어리 기록**(석준 님 `chunking.txt`): 하루 관찰 줄(관찰 텍스트에서 시각이 붙은 줄)을 하는 일 덩어리 `{ start, end, text }`로 묶는다. 같은 일이 이어지는 줄과 방금 한 일을 다시 말하는 줄은 한 덩어리, 사람이 안 보이는 것도 한 덩어리다. 덩어리마다 그 동안의 사람 상태(판단 기록 `fsm.state`, 임시 상태 포함, 가장 많이 나온 것)를 붙여 `[drinking] 사용자가 식탁에서 커피를 마신다.` 꼴로 반성·시각 찾기 입력에 쓴다.

**시각 찾기**(석준 님 `marking.txt`): 덩어리 기록과 줄 기록을 받아 후보마다 일어난 때(그 출발 상태일 때만), 행동마다 사람이 직접 한 때(그 일을 하러 걸어가기 시작한 줄), 사람이 안 보인 구간을 낸다. 날마다 아직 모르는 (상태, 후보)·행동만 묻고 결과를 남긴다(`runtime/homes/<집>/habit/marks-<날>.json`). 답의 시각은 그날 기록 줄의 시각만 받는다(`validateMarks`).

**밤 흐름**(하루 한 번, 판단 속도와 상관없음): 덩어리 기록 → 반성(후보 FSM, 입력: 덩어리 기록·지금까지의 후보 FSM·검사 결과·피드백) → 코드 모양 검사 → LLM 뜻 검사(거절이면 까닭을 붙여 한 번 다시 반성) → 시각 찾기(지난 날까지, 모르는 것만) → 채택 검사 → 로봇 FSM(seed 화살표 + 통과한 배우는 행동 후보, 같은 트리거의 묻기 화살표는 바꾸고 정한 습관 화살표는 그대로) → 코드 검사 → 저장(로봇 판본·후보 판본·반성 기록을 한 트랜잭션으로, 다음 날부터). 어느 단계든 끝내 거절·실패면 그날 새 판본을 저장하지 않고 전날 기억을 쓴다(반성 기록에 까닭).

**합성 이야기 날짜 계산:** 하루 한 번 컵을 두고 떠나고(후보 1번) 로봇이 물을 때마다 「치워 주세요」로 답하면(따라옴 1번) 다른 때에는 행동이 없어 `p0 = 0.01`이다. 첫날 밤 `n=1, k=1`: `P = 0.01` → 통과 못 함. 둘째 날 밤 `n=2, k=2`: `P = 0.0001 < 0.001`, `k/n = 1` → 통과. 그래서 「처음 이틀은 묻고 → 3일째부터 바로 치우기」다(사용자 확정 2026-11-18, Task 9). 3일째부터 로봇이 바로 치운 창은 못 봄이라 셈이 `n=2, k=2`에 머물고 통과가 이어진다.

**말없이 에어컨(데모 「2-습관」) 날짜 계산:** 날마다 TV 보기 시작이 한 번이고, 늘 집에 돌아온 바로 뒤다(자리에 없음 → TV 보는 중. 저녁은 밖에서 먹고 돌아온다. 합성 일요일 낮 TV는 뺀다, 하루 두 번이면 하루 앞당겨진다). 1일째는 「아 덥다」에 정한 습관 화살표로 로봇이 켜서 그 창은 못 봄이다. 2·3일째는 사람이 앉은 뒤 20~60초 안에 거실 에어컨을 스스로 켠다(따라옴). 행동은 그 행동의 대상 기기(거실 에어컨)만 센다(침실 에어컨은 다른 기기). 그래서 `p0 = 0.01`이다. 첫째 밤 `n=0`(못 봄 1) → 통과 못 함. 둘째 밤 `n=1, k=1`: `P = 0.01` → 통과 못 함. 셋째 밤 `n=2, k=2`: `P = 0.0001` → 통과. 그래서 **4일째부터** 말없이 켜고, 그 뒤 로봇이 켠 창은 못 봄이라 셈이 `n=2, k=2`에 머문다(Task 9 시험). 하루 두 번 떠나면(아침·저녁) 첫날 밤에 `n=2, k=2`로 통과해 2일째부터다. 합성 데이터는 하루 한 번(아침 커피)만 묻게 맞춘다.

## 시험·영상이 쓰는 기억 (2026-11-18 확인)

| 시험 | 지금 쓰는 기억 | 이 계획 뒤 |
|---|---|---|
| 가로 영상 셋(glass·tall·mug, 실제 모델, `scripts/video-check.ts`, 11-18 `twin-home-split/runtime`) | 배운 기억: 반성 3판(11-16 반성, 11-17부터, 옛 모양 `left_cup` 상태의 컵 치우기). 11-18 영상 시간 판단이 모두 3판 | 옛 모양이라 Task 2가 seed로 다시 시작하면 떠날 때 묻는다. 영상 전에 서버를 끈 채 `npx tsx scripts/demo-setup.ts learned --dir <서버 RUNTIME_DIR>`로 배운 뒤 기억을 넣고, `video-check`가 시작 때 확인한다(없으면 멈춤) |
| `video-check --fake` | 새 임시 runtime이라 seed 1판. 가짜 PAM이 기억을 보지 않고 컵 치우기를 고름 | 서버를 띄우기 전 임시 runtime에 배운 뒤 기억. 가짜 PAM은 받은 기억의 화살표로 답한다 |
| 서버 e2e(`goal-e2e`·`video-mode-e2e`·`video-real-e2e`·`wide-glass-e2e`·`cup-branches-e2e`·`mokryeon-e2e`·`noonchi-e2e`, `demo-e2e` 장면 1) | 새 runtime이라 seed. 가짜 PAM이 기억과 상관없이 `task_index`로 컵 치우기 | `useLearnedMemory(runtimeDir)` 뒤 서버. 가짜 PAM은 받은 기억에서 화살표를 찾고 없으면 화살표 없음 |
| 단위 시험(`world-decide`·`brain-goal`·`act-goal`·`brain-thought`·ui 고정 자료)·트윈 가짜 실행(`scripts/twin3d/fake-run.ts`) | `CUP_FSM_MEMORY`(지금 seed에 컵 치우기가 있음) | 치우기를 보는 것은 `LEARNED_FSM_MEMORY`, seed로는 묻기·목표 없음을 본다 |
| 시연(`demo-setup.ts day1`) | 빈 DB라 seed(지금 seed에 컵 치우기가 있음) | 치우기 장면은 `day1` 뒤 `learned`. 배우기 전 장면은 `day1`만(떠나면 묻기) |
| 시연 「2-습관」(`demo-setup.ts week` → `reflect --chain`, 또는 `reflect --scripted`) | 합성 7일 판본 + `habit`(말없이 에어컨 규칙을 마지막 판본에 바로 씀) | 합성 7일 밤마다 채택 검사: 마지막 판본에 배운 컵 치우기와 배운 말없이 에어컨 화살표(4일째부터)가 있다. 바로 쓰는 `habit` 갈래는 없다 |

배운 뒤 기억(`LEARNED_FSM_MEMORY`)은 실제 채택 결과(Task 13 `adoptedFsm`)와 합성 3일째부터 쓰는 로봇 FSM(Task 9 `memoryAfter`)과 화살표가 같다. 두 시험이 막는다.

## 네 개 나누기

### 기계 넷과 관리자

| 기계 | 상태 | 바꾸는 것 | 노드 | 상태 토픽(STATE) | 전이 기록(RELIABLE) |
|---|---|---|---|---|---|
| 사람 활동 FSM | 기억의 상태 id(`away`부터) | PAM 판단 답(`state`·화살표), 판단 사이에는 World State 하는 일(`stateOfWorld`) | `brain` | `/brain/person` | `/brain/person_changes` |
| 목표 기계 | 세움 `armed` → 미리 만드는 중 `planning` → 준비됨 `ready` → 시작 `started` → 끝 `done` / 버림 `dropped` | 사람 FSM 상태·쓰는 중 지킴·계획 모드 결과·사람 떠남·관리자 | `goal`(새) | `/goal/state` | `/goal/changes`(지금 `/brain/goal`·`/brain/goal_changes`를 바꿈) |
| 로봇 실행 기계 | 대기 `idle` · 관찰 `observe` · 이동 `move` · 실행 `run`(하위: 계획 단계) · 복귀 `return` · 막힘 복구 `recover` | 관리자의 일(`/manager/order`), World State·폰 답 | `act`(로봇) | `/robot/state` | `/robot/changes`. 실제 폰 명령 `/act/phone_command`는 이 노드만 낸다 |
| 안전 기계 | 평소 `normal` → 의심 `suspect` → 비상 `emergency`(까닭마다: 쓰러짐 `fall`, 위험 가전 `device`) | World State 자세, 쓰러짐 확인 답(들은 말), 켠 위험 가전 추적·끄기 안내 줄 | `safety`(새) | `/safety/state` | `/safety/changes` |
| 관리자 | 맡은 쪽 `safety` · `request` · `goal` · `idle`, 모드 `noonchi`·`coach`, PAM 행동 목록 | 안전·판단(들은 말 든 판단)·목표·로봇 상태 | `manager`(새) | `/manager/state` | `/manager/changes`, 로봇에 내리는 일 `/manager/order` |

기록 DB에는 전이 기록마다 한 줄(종류 `person`·`goal`·`robot`·`safety`·`manager`)을 남기고, 영상 판정 시각표(`scripts/video-check.ts`)에 「사람」「목표」「로봇」「안전」「관리」 줄로 보인다. 대시보드 시간 줄은 사람 줄에 사람 활동 FSM 전이를, 로봇 줄에 로봇 실행 기계 전이(실행 안 계획 단계마다 시작·끝)를 받는다(화면은 `feat/fsm-card`). 녹화는 전이 토픽을 모두 남기고, 격리 재생은 입력 토픽으로 같은 전이가 다시 나오는지 견준다.

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

화면: 목표 기계 상태는 대시보드 메시지 `goal`로 넘기고, 보이는 자리는 `feat/fsm-card`가 정한다(지금 그 갈래: 트윈 컵 위 빨간 고리, 시간 줄). FSM 원 카드는 쓰지 않는다(2026-11-19).

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

모든 묶음 끝 조건(공통): typecheck·lint·ui 빌드·ui 시험·전체 시험(부하 실패는 따로 다시), `goal-e2e` 혼자 세 번(사람 사라짐 → 첫 명령 1초 안), **세 영상(glass·tall·mug)이 배운 뒤 기억으로 통과**(서버를 끈 채 `demo-setup.ts learned`, `video-check`가 시작 때 확인), 사람 떠남 → 첫 명령이 세 판 모두 3.3초 안이고 묶음 전 값보다 0.3초 넘게 늘지 않음, 목표가 서는 때 4~5초.

| 묶음 | 하는 일 | 동작 | 끝에 더 볼 것 |
|---|---|---|---|
| A 사람 활동 FSM | 이 문서 Task 1~14(Task 12는 Task 3 바로 다음, Task 13은 Task 6 앞) | 바뀜(기억·PAM 답·반성 검사) | PAM 골든·기록 정답 diff, 합성 일주일 |
| B 상태 토픽 그림자 | `src/machines/view.ts`가 지금 객체(실행 추적 `Run`·`Dock`·`Finder`·`ContentsHold`·`SafetyTracker`·`GoalWatch`·`modeNow`)에서 기계 넷과 관리자 상태를 계산해 STATE·RELIABLE 토픽과 기록 DB 줄로 낸다. 로봇 실행 기계 전이는 대시보드 메시지 `robot`으로도 낸다(시간 줄 로봇 줄 자료: 기계 상태, 실행이면 계획 id·단계 번호·단계 글, 시작 시각). 명령·판단은 그대로 | 안 바뀜(대시보드 메시지 하나 더함) | 데모 e2e 넷·영상 모드 셋에서 기계 상태 차례가 정답과 같다(`tests/machines-view.test.ts`), 시각표에 새 줄, 녹화에 전이 토픽 |
| C 안전 기계 | `SafetyTracker`를 `src/safety/`로 옮겨 기계가 상태를 갖고, `emergencyOf`는 기계 상태를 읽는다. 쓰러짐 의심이면 쓰러짐 확인(가서 묻고 듣기), 비상이면 관리자가 로봇에 멈춤 | 새로: 쓰러짐 확인, 비상 즉시 멈춤 | `tests/act-track-release.test.ts`가 새 경로에서 그대로 막음, `tests/coach-e2e.test.ts`, 새 「비상이면 250ms 안에 로봇 대기·명령 거둠」 |
| D 로봇 실행 기계 | `src/act/robot/`가 상태와 명령 줄 하나를 갖고, 단계·승인·코치·충전 복귀·찾기·내용물·관찰 모드 A가 그 상태 안의 처리로 들어간다 | 안 바뀜 | `tests/robot-phone-only.test.ts`, 실행 추적 시험 묶음이 고치지 않고 통과, 집 상태 변화 → 폰 명령 지연(`tests/latency-act.test.ts`) |
| E 목표 기계·관리자 | `GoalWatch` → `src/goal/` 기계(세움 → 미리 만드는 중 → 준비됨 → 시작 → 끝/버림), `Starter.onDecision` 차례·`modeNow`·`pamTasks`·`UseWatch` → `src/manage/` 관리자, 메시지 상자 목표 한 줄 | 안 바뀜(목표 줄 모양만) | `tests/act-goal.test.ts`·`tests/act-mode.test.ts`가 새 경로로 그대로, 관리자 차례 시험(안전 > 말 부탁 > 목표 > 대기), 목표 끝(`done`) 전이 |
| F 노드 나누기 | `goal`·`safety`·`manager` 노드와 토픽, 로봇 = `act` 노드, 사람 = `brain` 노드(`refactor/stage-queue` 묶음 3·4 뒤) | 안 바뀜 | 토픽 표 zod strict, 녹화·격리 재생에서 전이가 같음, 지연 예산 |

묶음 B~F는 시작할 때 이 표와 아래 시험 목록으로 단계 계획(`docs/superpowers/plans/` 새 문서)을 따로 쓴다(묶음 A처럼 작업마다 실패 시험·코드·커밋).

**묶음 B~F의 먼저 쓸 실패 시험:**
- B `tests/machines-view.test.ts`: 컵 치우기 데모에서 로봇 상태 차례가 대기 → 실행(4단계) → 관찰(확인) → 복귀 → 대기, 목표가 세움 → 미리 만드는 중 → 준비됨 → 시작 → 끝, 안전은 평소 그대로, 관리자는 대기 → 목표 → 대기. 대시보드 `robot` 메시지가 실행 1~4단계마다 시작·끝 구간을 낸다(시간 줄 로봇 줄). 코치 라면 데모에서 안전이 평소 → 의심(인덕션 켬) → 비상(끄기 안내) → 평소, 관리자 모드 코치.
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
- 묶음마다 세 영상(glass·tall·mug)이 배운 뒤 기억으로 통과하고 사람 떠남 → 첫 명령이 3.3초 안이다.
- 치우기를 보는 시험·영상·시연은 배운 뒤 기억(`LEARNED_FSM_MEMORY`)으로 돈다. seed 기억이면 떠날 때 묻는다.
- 구현명세서 SSOT(docs 저장소 `01_Product/구현명세서 SSOT.md`)는 코드와 같이 고친다. 바뀐 내력은 `변경이력.md`에만.
- 커밋은 작업마다 로컬로만, `git add <경로>`로 그 작업 파일만. push 하지 않는다.

## 파일 지도 (묶음 A)

| 파일 | 맡는 일 | 작업 |
|---|---|---|
| `src/brain/decision.ts` | 기억 모양·코드 검사·seed·옛 모양 알기·판단 답 검사 | 1, 2, 3 |
| `src/act/tasks.ts` | 배우는 행동 `learn`(컵 치우기)·`LEARNED_ACTIONS`·`ASK_ACTION` | 1 |
| `scripts/learned-memory.ts`(새), `tests/helpers/memory.ts`(새) | 배운 뒤 기억·그날 판본으로 넣기 | 1, 3, 9 |
| `scripts/video-check.ts`, `src/server/routes/brain.ts` | 영상 전 배운 기억 확인, `/api/memory/day` `uses.memory` | 9 |
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
| `src/brain/person.ts`, `src/contract/events.ts`, `ui/src/lib/messages.ts` | 시간 줄 사람 줄 자료(대시보드 메시지 `person`) | 10 |
| `src/agent/tools.ts`·`src/act/track/tracker.ts` | 말 부탁 → 계획 모드(`request_task`, `onRequest`) | 12 |
| `src/brain/pam/adopt.ts`(새) | 채택 검사(석준 님 `trigger_check.py` 그대로), 로봇 FSM 만들기 | 13 |
| `src/brain/pam/marks.ts`·`chunking.txt`·`marking.txt`(새), `src/brain/history/night.ts`(새) | 덩어리 기록·시각 찾기·밤 흐름 | 14 |
| `docs/reference.md`, `docs/pam-interface.md`, `src/brain/pam/README.md`, SSOT | 문서 | 11 |

---

## 묶음 A 작업

### Task 1: 새 기억 모양·코드 검사·seed

**Files:**
- Modify: `src/brain/decision.ts` (타입 `FsmMemory`·`validateMemory`·`CUP_FSM_MEMORY`)
- Modify: `src/brain/pam/budget.ts:23` (빈 기억 모양)
- Modify: `src/act/tasks.ts` (`TaskSpec.learn`, 「컵 치우기」·「에어컨 켜기」에 `learn: true`, `LEARNED_ACTIONS`·`ASK_ACTION`, 「사용자에게 물어보기」 설명)
- Create: `scripts/learned-memory.ts` (배운 뒤 기억), `tests/helpers/memory.ts` (`useLearnedMemory`)
- Test: `tests/brain-decision.test.ts`

**Interfaces:**
- Produces:
  - `export const ANY_STATE = "*"; export const AWAY_STATE = "away"; export const MAX_STATES = 12;`
  - `export interface FsmEdge { to: string; on: string; when?: string; action?: string }`
  - `export interface FsmState { id: string; description: string; activity: string[]; next: FsmEdge[] }`
  - `export interface FsmMemory { initial_state: string; states: FsmState[] }`
  - `validateMemory(value, "fsm"): FsmMemory`(코드 검사, 새 모양만), `PERSON_ACTIVITIES: readonly string[]`
  - `CUP_FSM_MEMORY: FsmMemory`(「새 기억 모양」 절의 seed, 컵 치우기 화살표 없음)
  - `TaskSpec.learn?: true`, `LEARNED_ACTIONS: readonly string[]`(`["컵 치우기", "에어컨 켜기"]`), `ASK_ACTION = "사용자에게 물어보기"`(`src/act/tasks.ts`)
  - `learnedFsm(states?: readonly string[]): FsmMemory`, `LEARNED_FSM_MEMORY: FsmMemory`, `saveLearned(db: HistoryDb, day: string, memory?: FsmMemory): number`(`scripts/learned-memory.ts`)
  - `useLearnedMemory(runtimeDir: string): number`(`tests/helpers/memory.ts`, 서버를 띄우기 전 그 runtime 기록 DB에 오늘 판본으로)

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
    expect(drink(CUP_FSM_MEMORY).next[0]).toEqual({ to: "*", on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", action: "사용자에게 물어보기" });
  });
  it("seed에는 컵 치우기 화살표가 없고(배우는 습관) 사용자가 정한 습관 화살표는 있다. 배운 뒤 기억은 마시는 중에서 떠나는 묻기 화살표 자리만 컵 치우기다", () => {
    const actions = (m: FsmMemory) => m.states.flatMap((s) => s.next.flatMap((e) => (e.action ? [e.action] : [])));
    expect(LEARNED_ACTIONS).toEqual(["컵 치우기", "에어컨 켜기"]);
    expect(actions(CUP_FSM_MEMORY)).not.toContain("컵 치우기");
    expect(actions(CUP_FSM_MEMORY)).toEqual(expect.arrayContaining(["컵에 물 채워 주기", "컵에 콜라 따라 주기", "에어컨 켜기", "라면 끓이기 알려 주기", "전자레인지로 데우기 알려 주기"]));
    expect(validateMemory(LEARNED_FSM_MEMORY, "fsm")).toBe(LEARNED_FSM_MEMORY);
    expect(drink(LEARNED_FSM_MEMORY).next[0]).toEqual({ ...drink(CUP_FSM_MEMORY).next[0]!, action: "컵 치우기" });
    expect(LEARNED_FSM_MEMORY.states.map((s) => s.next.length)).toEqual(CUP_FSM_MEMORY.states.map((s) => s.next.length));
    expect(learnedFsm(["drinking", "watching_tv"]).states.find((s) => s.id === "watching_tv")!.next.find((e) => e.to === "*")).toMatchObject({ when: "같이 마시는 중이었다.", action: "컵 치우기" });
  });
  it("같은 (출발·사건·조건) 화살표 둘은 거절한다. 조건이 다르면 된다", () => {
    const m = base();
    drink(m).next.push({ ...drink(m).next[0]!, action: "컵 치우기" });
    expect(() => validateMemory(m, "fsm")).toThrow(/duplicate transition/);
    const ok = base();
    drink(ok).next.push({ ...drink(ok).next[0]!, when: "같이 TV를 보는 중이었다.", action: "컵 치우기" });
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

```ts
// src/act/tasks.ts
export interface TaskSpec { /* …지금 칸… */ /** 반성·채택 검사로 새 화살표를 배울 수 있는 행동(사용자 답: 컵 치우기, 말없이 TV 보기 시작 → 에어컨 켜기). seed 행동 화살표(묻기 빼고)는 이 칸과 상관없이 사용자가 정한 습관이라 늘 둔다. */ learn?: true }
// TASKS["컵 치우기"]·TASKS["에어컨 켜기"]에 learn: true. 「사용자에게 물어보기」 설명: "치울지 아직 모르는 때(배우기 전 습관, 컵 안이 안 보임 등) 폰으로 사용자에게 어떻게 할지 묻는다."
export const LEARNED_ACTIONS: readonly string[] = TASK_NAMES.filter((n) => TASKS[n]!.learn === true);
export const ASK_ACTION = "사용자에게 물어보기";
```

```ts
// scripts/learned-memory.ts (learnedFsm·LEARNED_FSM_MEMORY는 「새 기억 모양」 절 그대로)
/** 배운 뒤 기억을 그날 판본(합성, 전날 반성 자리)으로 넣고 그날을 고정한다(바꿈). 서버를 끈 채 쓴다(시험·영상·시연 준비). */
export function saveLearned(db: HistoryDb, day: string, memory: FsmMemory = LEARNED_FSM_MEMORY): number {
  const before = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const version = db.saveMemory({ kind: "fsm", memory, day: before, appliesDay: day, source: "synthetic" });
  db.pinMemory(day, version, true);
  return version;
}
```

```ts
// tests/helpers/memory.ts
export function useLearnedMemory(runtimeDir: string): number {
  const db = HistoryDb.open(join(runtimeDir, "noonchi.db"), historyTzMinutes({}));
  try { return saveLearned(db, db.dayOf(Date.now())); } finally { db.close(); }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run heavy -- npx vitest run tests/brain-decision.test.ts`
Expected: PASS(옛 seed를 쓰던 다른 시험은 Task 2~9에서 고친다. 커밋 전에 `npx tsc --noEmit -p .` 오류 목록을 작업 노트에 남긴다)

- [ ] **Step 5: 커밋**

```bash
git add src/brain/decision.ts src/brain/pam/budget.ts src/act/tasks.ts scripts/learned-memory.ts tests/helpers/memory.ts tests/brain-decision.test.ts
git commit -m "feat(brain): person-activity FSM memory with action transitions and its code check"
```

---

### Task 2: 옛 모양 기억은 옮기지 않고 새 seed로 다시 시작

사용자 답(2026-11-18): 지금 기억은 합성 일주일 기록(`scripts/seed-history.ts`·`scripts/demo-setup.ts`)에서 나온 것이라 옮기지 않는다. 합성 데이터는 Task 9가 처음부터 새 모양으로 다시 쌓는다. 기록 DB에서 옛 모양 기억(상태 안 `rules`)을 읽으면 새 seed 판본을 올려 그것으로 다시 시작하고, 서버 로그에 한 줄 남긴다. 그러면 그 서버는 떠날 때 묻는다(새 seed에 컵 치우기가 없다). 지금 세 영상의 서버처럼 치우기를 봐야 하는 런타임은 서버를 끈 채 `demo-setup.ts learned`로 배운 뒤 기억을 넣는다(Task 9).

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

`readDayMemory`는 옛 모양이면 저장하지 않고 `{ memory: CUP_FSM_MEMORY, kind: "fsm" }`을 돌려준다. `MEMORY_TEXT = { restart: (v: number) => \`옛 모양 기억 ${v}판이라 새 seed로 다시 시작해요\` }`는 `src/brain/history/labels.ts`에 둔다. `SEED_PATCHES`·`patchMemory`·`markSeedPatch` 쓰는 곳을 지운다(옛 바뀜 「2026-11-16-clear-habit」(떠나면 치우기)은 seed에 넣지 않는다: 컵 치우기는 배우는 습관이라 채택 검사를 지나야 들어간다, 2026-11-18 사용자 답). 서버(`src/server/home/index.ts`)는 `memoryForDay`를 부를 때 `log: ctx.log`를 넘긴다.

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
  it("화살표의 행동을 서버가 task_index로 만든다(답에 task_index 칸이 없다): 배운 뒤 기억은 컵 치우기, seed는 같은 화살표가 묻기다", () => {
    const p = parsePrediction(ok({ state: "away", from: "drinking", next_index: 0 }), tasks, LEARNED_FSM_MEMORY);
    expect(p).toMatchObject({ status: "valid", selected_action: "컵 치우기", prediction: { task_index: 0, state: "away", from: "drinking", next_index: 0 } });
    expect(parsePrediction(ok({ state: "away", from: "drinking", next_index: 0 }), tasks, CUP_FSM_MEMORY)).toMatchObject({ status: "valid", selected_action: "사용자에게 물어보기", prediction: { task_index: 1 } });
  });
  it("화살표 없음(-1, from null)은 대기다", () => {
    expect(parsePrediction(ok({ state: "drinking", from: null, next_index: -1 }), tasks, CUP_FSM_MEMORY)).toMatchObject({ status: "valid", selected_action: null, prediction: { task_index: -1 } });
  });
  it("배운 뒤에도 식탁(마시는 중)에서 떠나면 치우고 TV 앞(같이 마시는 중)에서 떠나면 묻는다(사용자 답 2026-11-19)", () => {
    const tvLeave = LEARNED_FSM_MEMORY.states.find((s) => s.id === "watching_tv")!.next.findIndex((e) => e.to === "*");
    expect(parsePrediction(ok({ state: "away", from: "drinking", next_index: 0 }), tasks, LEARNED_FSM_MEMORY).selected_action).toBe("컵 치우기");
    expect(parsePrediction(ok({ state: "away", from: "watching_tv", next_index: tvLeave }), tasks, LEARNED_FSM_MEMORY).selected_action).toBe("사용자에게 물어보기");
  });
  it("화살표 행동이 지금 행동 목록에 없으면(코치 행동을 눈치 모드에서) 화살표는 남기고 행동은 대기다", () => {
    const p = parsePrediction(ok({ state: "cooking", from: "cooking", next_index: 0 }), tasks, CUP_FSM_MEMORY);
    expect(p).toMatchObject({ status: "valid", selected_action: null, prediction: { task_index: -1, from: "cooking", next_index: 0 } });
  });
  it("기억에 없는 활동은 임시 상태(~하는 일 값)로 내고, \"*\" 화살표는 그 임시 상태로 떠나도 켜진다", () => {
    expect(parsePrediction(ok({ state: "~using_laptop", from: "drinking", next_index: 0 }), tasks, LEARNED_FSM_MEMORY)).toMatchObject({ status: "valid", selected_action: "컵 치우기", prediction: { state: "~using_laptop" } });
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
   `new`: "- First decide the person's current state from the latest observations (use the previous state given in the input; when it is unknown, it is the initial_state). If the person is doing an activity that no state has, answer the state as '~' followed by that activity value from the observation log (for example ~using_laptop). Then decide whether exactly one transition of the previous state happened now: its `on` happened and its `when` holds in the latest observations. If none happened, answer no transition."
3. 출력 모양: `old`는 「## Output Schema」 아래 JSON 블록 전체, `new`:
   "{\n  \"observation\": \"<single concise sentence describing the relevant current scene state>\",\n  \"reasoning\":   \"<single concise sentence naming the current state and the transition that happened, if any>\",\n  \"state\":       \"<current state id>\",\n  \"from\":        \"<state id the transition left, or null when no transition>\",\n  \"next_index\":  <integer: index in that state's next list, or -1 for no transition>\n}"
   그리고 「## Output Requirements」의 `task_index` 줄을 `state`·`from`·`next_index` 설명으로 바꾼다.

`tests/helpers/pam.ts`의 `Pred`에 `state`·`from`·`next_index`를 더하고 fsm 요청이면 `task_index` 대신 그 셋을 낸다(가짜 답 `pick(action, …)`은 **요청에 실린 기억**(`body.memory`)에서 그 행동의 화살표를 찾는다: 직전 상태(`last_state`)에 있으면 그것, 없으면 그 행동 화살표가 있는 첫 상태. `state`는 화살표 도착(`*`면 `away`). 기억에 그 행동 화살표가 없으면 화살표 없음(-1)을 낸다: seed 기억으로 도는 시험이 몰래 치우지 않는다. 시험 도우미만 찾는다).

컵 치우기를 기대하는 서버 시험은 서버를 띄우기 전에 `useLearnedMemory(runtimeDir)`로 배운 뒤 기억을 오늘 판본으로 넣는다: `tests/goal-e2e.test.ts`, `tests/video-mode-e2e.test.ts`, `tests/video-real-e2e.test.ts`, `tests/wide-glass-e2e.test.ts`, `tests/cup-branches-e2e.test.ts`, `tests/mokryeon-e2e.test.ts`, `tests/noonchi-e2e.test.ts`. `tests/demo-e2e.test.ts`는 Task 9가 맡는다.

- [ ] **Step 4: 정답 다시 쓰기와 통과 확인**

Run: `npm run heavy -- npx vitest run tests/pam-golden.test.ts -u` 뒤 `git diff tests/fixtures/pam-golden`(기억 JSON·바꾼 문장·출력 모양만 바뀌었는지 본다), `npm run heavy -- npx vitest run tests/pam-answer.test.ts tests/pam-request.test.ts tests/pam-prompts.test.ts tests/pam-golden.test.ts tests/pam-budget.test.ts`, 위 서버 시험은 하나씩 `npm run heavy -- npx vitest run <파일>`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/contract/pam.ts src/brain/decision.ts src/brain/pam tests/helpers/pam.ts tests/pam-*.test.ts tests/fixtures/pam-golden tests/goal-e2e.test.ts tests/video-mode-e2e.test.ts tests/video-real-e2e.test.ts tests/wide-glass-e2e.test.ts tests/cup-branches-e2e.test.ts tests/mokryeon-e2e.test.ts tests/noonchi-e2e.test.ts
git commit -m "feat(pam): pam-predict/3 answers the person state and the transition; the server derives the action"
```

---

### Task 12: 말 부탁 → 계획 모드 → 실행 (Task 3 바로 다음에 한다)

PAM은 Task 3부터 기억 화살표의 행동만 고른다. 그래서 기억에 없는 행동 부탁(예: TV 보는 중 「라면 끓이는 법 알려 줘」, 기억에 없는 「컵 치워 줘」)은 PAM으로는 막힌다(Codex 8ab2d06 P2). 말 요청 에이전트에 「할 일 부탁」 도구를 더해, 말 부탁 → 계획 모드 → 실행(묶음 D 뒤로는 로봇 실행 기계) 길을 둔다. 묶음 E에서는 관리자의 「말로 한 부탁」(`request`) 차례가 이 길을 받는다. Task 3과 같은 묶음 안에서 바로 이어서 해 그 사이 말 부탁이 막히지 않게 한다.

**Files:**
- Modify: `src/agent/tools.ts` (도구 `request_task`), `src/agent/agent.ts`·`src/agent/prompts.ts`(말 요청 에이전트 지시문 한 줄)
- Modify: `src/act/track/tracker.ts`·`src/act/track/start.ts` (`onRequest`), `src/act/track/answers.ts`·`src/act/prompts.ts` (묻기 답 → 말 부탁, `ASK_FOLLOW`)
- Modify: `src/server/home/agent.ts` (도구 → `core.tracker.onRequest`)
- Modify: `src/contract/events.ts` (판단 기록 `source?: "speech"`, `via?: "answer"`)
- Test: `tests/agent.test.ts`, `tests/speech-request.test.ts`(새)

**Interfaces:**
- Consumes: Task 3(PAM은 화살표 행동만), 지금 `Starter.onDecision`(들은 말이 든 판단은 충전 복귀 중에도 받음, 손대는 단계 중이면 그 단계 뒤로 미룸).
- Produces:
  - 도구 `request_task({ task: string }) → { ok: true } | { ok: false; error: string }` — `task`는 행동 목록(`TASK_NAMES`) 이름 그대로. 모드와 상관없이 받는다(코치 행동이면 계획이 열린 동안 모드가 코치, `modeNow` 그대로).
  - `ExecutionTracker.onRequest(r: { task: string; heard: string; atMs: number; afterSeq: number; via?: "answer" }): void` — `afterSeq`는 말 부탁을 받은 때까지 판단이 보낸 마지막 PAM 요청 번호(`Decider.sentSeq()`, 서버가 넣는다). 들은 말 부탁을 판단 기록 꼴(`id: say-<번호>`, `source: "speech"`, `seq: 0`, `textSent`에 「사람이 말함: 「…」」, `prediction: { observation: "사람이 말로 부탁함", reasoning: "사람이 말로 부탁함", task_index }`, `action: task`, `tasks: TASK_NAMES`)로 만들어 지금 판단 받기 길(`onDecision`)에 넣는다. 그래서 계획 전 검사·계획 모드·승인·실행이 PAM 판단과 같다.
  - **묻기 답 → 말 부탁**(Codex b115d69 P2: 지금 답 처리는 질문만 끝내서 처음 이틀에 치우기가 시작되지 않았다): 「사용자에게 물어보기」 판단의 계획이 묻기 단계 답으로 끝나면, 답 id가 `ASK_FOLLOW`(`src/act/prompts.ts`, `{ clear: "컵 치우기" }`)에 있을 때 그 계획을 `done`(지금 「답함」 기록)으로 닫은 뒤 `onRequest({ task: ASK_FOLLOW[id], heard: picked.label, atMs: now, afterSeq: o.sentSeq(), via: "answer" })`를 부른다. 「그대로 둬요」(`keep`)는 부르지 않는다. 판단 기록은 `source: "speech"`, `via: "answer"`이고 말 부탁과 같은 길·같은 순서 규칙이다(목표가 없으니 계획 모드). `ExecutionTracker` 옵션에 `sentSeq: () => number`(서버가 `Decider.sentSeq`를 넘긴다). 시각 찾기의 「치워 주세요」 답 때(`answerActions`)는 이 답 기록에서 읽는다.
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
it("묻기 계획에 「치워 주세요」로 답하면 그 계획을 닫고 컵 치우기를 말 부탁 길로 시작한다. 「그대로 둬요」면 시작하지 않는다", async () => {
  // tests/act-track.test.ts에 둔다(이 파일의 setup·decision·답 도우미)
  const t = setup({ sentSeq: () => 4 });
  await t.decide({ ...decision, id: "pam-4", seq: 4, action: "사용자에게 물어보기" });
  await t.answer("plan:pam-4", "clear");
  expect(t.exec()).toContainEqual(expect.objectContaining({ plan_id: "plan:pam-4", state: "done" }));
  expect(t.decisions().at(-1)).toMatchObject({ source: "speech", via: "answer", action: "컵 치우기", afterSeq: 4 });
  await t.t.idle();
  expect(t.exec().at(-1)).toMatchObject({ plan_id: expect.stringMatching(/^plan:say-/) });
  const k = setup({ sentSeq: () => 5 });
  await k.decide({ ...decision, id: "pam-5", seq: 5, action: "사용자에게 물어보기" });
  await k.answer("plan:pam-5", "keep");
  expect(k.decisions().filter((d) => d.source === "speech")).toEqual([]);
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
- Modify: `src/brain/thought.ts:27-32`, `src/world/labels.ts:10` (`FSM_STATE_TEXT`), `src/act/tasks.ts`(`TASK_SAY` 묻기 말), `ui/src/dashboard/data.ts:150-170`, `ui/src/dashboard/words.ts`
- Modify: `scripts/twin3d/fake-run.ts:117,177`(컵 치우기 판단 `fsm`은 `LEARNED_FSM_MEMORY` 화살표, `learned: true`), `ui/tests/dashboard/fixtures.ts`(컵 갈래 고정 자료는 배운 뒤 기억 화살표)
- Test: `tests/world-decide.test.ts`, `tests/brain-thought.test.ts`, `tests/brain-person.test.ts`(새), `ui/tests/dashboard/data.test.ts`

**Interfaces:**
- Consumes: Task 3 `Prediction.state/from/next_index`.
- Produces:
  - `export interface FsmStep { state: string; from: string | null; next_index: number; to: string | null; on: string | null; when: string | null; action: string | null; learned: boolean }` — 판단 기록 `fsm`. 화살표 없음이면 `next_index` -1, `from`·`to`·`on`·`when`·`action`이 null.
  - `edgeLearned(from: string, edge: FsmEdge): boolean` — seed에 같은 `from`·`on`·`action` 화살표가 없으면 true(묻기 자리를 바꾼 컵 치우기도 true).
  - `seedTrigger(from: string, on: string, when: string | null): boolean` — seed 그 상태에 같은 (on, when) 화살표가 있다. 허락 문장·목표 줄이 사용자가 정한 짧은 꼴(`RULE_IF`)을 쓸지 본다.
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
    ["컵 치우기", { state: "away", from: "drinking", next_index: 0, to: "*", on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", when: null, action: "컵 치우기", learned: true }],
    [null, { state: "away", from: null, next_index: -1, to: null, on: null, when: null, action: null, learned: false }],
  ]);
  expect((pam.bodies as { last_state: string | null }[]).map((b) => b.last_state)).toEqual([null, "away"]);
  expect(d.fsmState()).toBe("away");
});
```

(가짜 PAM LLM `startFakePamLlm({ predict })`의 답 모양 `Pred`는 Task 3에서 새 칸을 받는다. `pam.bodies`는 받은 요청 본문이다. 이 파일의 `memory` 도우미는 배운 뒤 기억(`LEARNED_FSM_MEMORY`)을 돌려준다. 배우기 전(seed)은 아래 시험 하나가 본다.)

```ts
// tests/world-decide.test.ts
it("배우기 전(seed) 기억이면 같은 떠남 화살표의 행동은 묻기다", async () => {
  pam = await startFakePamLlm({ predict: () => ({ observation: "o", reasoning: "r", state: "away", from: "drinking", next_index: 0 }) });
  const records: DecisionRecord[] = [];
  const seed = () => ({ memory: CUP_FSM_MEMORY, kind: "fsm" as const, version: 1 });
  const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory: seed, emit: () => {}, onDecision: (r) => records.push(r), offsetMinutes: 540, clock: { now: () => 10_000 } });
  d.onChanges([{ kind: "person_gone", at_ms: 9000, subject: "person", text: "사람 안 보임", meaningful: true }]);
  d.tick();
  await d.idle();
  expect(records[0]).toMatchObject({ action: "사용자에게 물어보기", fsm: { from: "drinking", next_index: 0, action: "사용자에게 물어보기", learned: false } });
});
```

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
it("허락 문장은 판단이 낸 화살표에서 만든다: seed 트리거면 RULE_IF(묻기 자리를 바꾼 배운 컵 치우기도), 새 트리거의 배운 화살표는 on·when을 줄이지 않고, 묻기·화살표 없음은 허락 문장이 없다", () => {
  const leave = LEARNED_FSM_MEMORY.states[0]!.next[0]!;
  expect(decisionLines(decision("pam-1", "컵 치우기", step({ from: "drinking", next_index: 0, to: "*", on: leave.on, action: "컵 치우기", learned: true })))).toEqual(["컵을 두고 자리를 뜨면 치워도 된다고 하셨어요"]);
  // 배우기 전 떠날 때: 허락 문장 없이 로봇 말만(사용자 답 2026-11-19). 배운 뒤 컵 치우기는 허락 문장 다음 「컵을 치울게요.」
  expect(decisionLines(decision("pam-2", "사용자에게 물어보기", step({ from: "drinking", next_index: 0, to: "*", on: leave.on, action: "사용자에게 물어보기" })))).toEqual([]);
  expect(SAY_TEXT.decided("사용자에게 물어보기")).toBe("컵을 치울지 여쭤볼게요.");
  expect(SAY_TEXT.decided("컵 치우기")).toBe("컵을 치울게요.");
  expect(decisionLines(decision("pam-3", "컵 치우기", step({ from: "drinking", next_index: 2, to: "*", on: "사용자가 외출하러 나간다.", when: "같이 마시는 중이었다.", action: "컵 치우기", learned: true })))[0]).toMatch(/^사용자가 외출하러 나간다\. 같이 마시는 중이었다면 /);
  expect(decisionLines(decision("pam-4", null, step({ state: "drinking" })))).toEqual([]);
});
```

(허락 문장 정답 「컵을 두고 자리를 뜨면 치워도 된다고 하셨어요」는 지금 `TASK_SAY`·`RULE_IF` 그대로다. 묻기는 허락 문장 없이 로봇 말 「컵을 치울지 여쭤볼게요.」 한 줄이다(사용자 답 2026-11-19). `SAY_TEXT`는 `src/act/labels.ts`다. 저장소 규칙 표의 「허락 문장은 사용자가 정한 짧은 꼴」을 지킨다.)

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
/** seed 그 상태에 같은 트리거(on, when)가 있는가: 묻기 자리를 바꾼 배운 컵 치우기도 사용자가 정한 짧은 꼴로 쓴다. */
export function seedTrigger(from: string, on: string, when: string | null): boolean {
  return !!CUP_FSM_MEMORY.states.find((s) => s.id === from)?.next.some((e) => e.on === on && (e.when ?? null) === when);
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
  // 묻기는 허락 문장이 없다: 로봇 말 「컵을 치울지 여쭤볼게요.」(SAY_TEXT.decided)만 나간다(사용자 답 2026-11-19)
  if (e.action === ASK_ACTION) return [];
  // 배운 화살표라도 seed와 같은 트리거(묻기 자리를 바꾼 컵 치우기)면 사용자가 정한 짧은 꼴
  const short = !f.learned || seedTrigger(f.from!, f.on, f.when);
  return [`${ruleIf({ trigger: f.when ? `${f.on} ${f.when}` : f.on, action: e.action, learned: !short })} ${TASK_SAY[e.action]?.may ?? `${josa(e.action, "을/를")} 해도`} 된다고 하셨어요`];
}
```

임시 상태(`~<값>`)의 이름은 `STATE_TEXT[값]`(예 「노트북 쓰는 중」). `FSM_STATE_TEXT`: `{ drinking: "먹거나 마시는 중", watching_tv: "TV 보는 중", cooking: "요리하는 중", away: "자리에 없음" }`(`left_cup` 지움). `TASK_SAY["사용자에게 물어보기"].will`은 「컵을 치울지 여쭤볼게요」다(배우기 전 떠날 때 메시지 상자 줄, 사용자 답 2026-11-19). `RULE_IF`에 묻기 줄은 없다. 화면 알약(`ui/src/dashboard/data.ts` `talkOf`): 상태 = `FSM_STATE_TEXT[f.state] ?? f.state`, 트리거 = `f.on ?? WORDS.noTransition`(「화살표 없음」), 액션 = `f.action ?? WORDS.idle`. `WORDS.manyRules`·`noRule`·`unknown`(상태 모름)은 지운다. `events.ts`의 판단 기록 `fsm` 타입은 `FsmStep | null`.

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
  it("배운 뒤 기억에서 마시는 중이면 그 상태에서 나가는 배운 화살표의 손대는 다 쓴 뒤 행동(컵 치우기)을 고른다", () => {
    expect(goalAhead({ memory: LEARNED_FSM_MEMORY, kind: "fsm", state: "drinking", tasks, cls: "cup" })).toEqual({
      state: "drinking", index: 0, to: "*", on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", when: null, action: "컵 치우기",
    });
  });
  it("배우기 전(seed)에는 떠날 때 화살표가 묻기라 목표를 세우지 않는다(목표는 배운 화살표에서만)", () => {
    expect(goalAhead({ memory: CUP_FSM_MEMORY, kind: "fsm", state: "drinking", tasks, cls: "cup" })).toBeNull();
    expect(goalAhead({ memory: CUP_FSM_MEMORY, kind: "fsm", state: "watching_tv", tasks, cls: "cup" })).toBeNull();
  });
  it("TV 보는 중에서도 그 상태의 컵 치우기를 배웠으면 세운다(옛 FSM은 처음 상태가 아니면 못 골랐다)", () => {
    expect(goalAhead({ memory: LEARNED_FSM_MEMORY, kind: "fsm", state: "watching_tv", tasks, cls: "cup" })).toBeNull();
    expect(goalAhead({ memory: learnedFsm(["drinking", "watching_tv"]), kind: "fsm", state: "watching_tv", tasks, cls: "cup" })).toMatchObject({ when: "같이 마시는 중이었다.", action: "컵 치우기" });
  });
  it("상태를 모르면, 자기 화살표(물 채우기)뿐이면, 다른 종류면 세우지 않는다", () => {
    expect(goalAhead({ memory: LEARNED_FSM_MEMORY, kind: "fsm", state: null, tasks, cls: "cup" })).toBeNull();
    expect(goalAhead({ memory: LEARNED_FSM_MEMORY, kind: "fsm", state: "cooking", tasks, cls: "cup" })).toBeNull();
    expect(goalAhead({ memory: LEARNED_FSM_MEMORY, kind: "fsm", state: "drinking", tasks, cls: "bowl" })).toBeNull();
  });
});
```

`tests/act-goal.test.ts`의 `goalSetup` `habit`은 `{ memory: o.memory ?? LEARNED_FSM_MEMORY, kind: "fsm", state: o.state === undefined ? "drinking" : o.state, version: 1 }`로 바꾸고 두 시험을 더한다: 「처음 상태가 drinking이 아니어도 사람이 마시는 중이면(World State) 세운다」(`state: null`이고 사람 사실 `drinking` → 세움), 「배우기 전(seed) 기억이면 마시는 중이어도 세우지 않는다」(`memory: CUP_FSM_MEMORY` → 목표 기록 없음). 메시지 상자 목표 줄은 배운 컵 치우기에서도 「컵을 두고 자리를 뜨면」 짧은 꼴이다.

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
- 메시지 상자 줄: `ruleIf({ trigger: pick.when ? \`${pick.on} ${pick.when}\` : pick.on, action: pick.action, learned: edgeLearned(pick.state, { to: pick.to, on: pick.on, action: pick.action }) && !seedTrigger(pick.state, pick.on, pick.when) })`(묻기 자리를 바꾼 배운 컵 치우기도 짧은 꼴).
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
- Modify: `src/brain/history/habits.ts` (규칙 줄 → 화살표 줄, `settingsGuard`는 후보 FSM을 거른다)
- Modify: `src/contract/pam.ts`·`src/brain/pam/request.ts`·`src/brain/pam/client.ts` (반성 `memory_kind: "fsm_candidates"`, 답은 `validateCandidateFsm`)
- Modify: `src/brain/history/reflect.ts:160-200`, `src/contract/events.ts:153`(반성 기록 `learned`·`active`·`dropped`), `ui/src/dashboard/data.ts:58-70`, `src/server/home/index.ts:153`, `scripts/demo-setup.ts:56,194`
- Test: `tests/history-habits.test.ts`, `tests/history-reflect.test.ts`, `tests/pam-golden.test.ts`(`r-fsm` 정답), `ui/tests/dashboard/data.test.ts`

**Interfaces:**
- Consumes: Task 1 `FsmMemory`·`FsmEdge`, Task 13 `adoptedFsm`·`candidateFsmOf`.
- Produces:
  - **반성 길은 후보 FSM 종류로 받는다**(Codex 2966378 P2: `pam.reflect(…, "fsm")`·`validateMemory`로 받으면 정상 후보의 `rules`가 답 오류로 거절돼 밤 반성·채택·저장까지 가지 못했다): 요청 `pam-reflect/3`의 `memory_kind: "fsm_candidates"`, `memory`는 지금까지의 후보 FSM(`db.candidatesFor(day)`, 없으면 그날 로봇 FSM의 `candidateFsmOf`). `PamClient.reflect(req, "fsm_candidates")`는 답을 `validateCandidateFsm(raw, CUP_FSM_MEMORY)`로 본다(모양 오류는 `PamAnswerError`). 로봇 FSM은 `adoptedFsm(후보, 지난 통과 후보, seed)`로만 만든다(Task 14 전에는 통과 후보가 없어 seed + 후보의 행동 없는 화살표·새 상태).
  - 반성 답은 후보 FSM(`CandidateFsm`, 「후보 FSM과 채택 검사」 절)이고 `validateCandidateFsm`(석준 님 `validate_candidate_memory`를 화살표 모양으로: 후보 1~3개·서로 다름, (출발, 행동)마다 규칙 하나, (출발·사건·조건) 하나, 나머지는 Task 1 코드 검사와 같음)이 본다. 더해서 seed 상태(id)는 모두 있고 하는 일 값(`activity`)이 seed와 같아야 하며, 새 상태는 seed 상태가 가진 하는 일 값을 가질 수 없다(정한 습관이 붙는 상태가 바뀌지 않게, Codex b115d69 P2). 어기면 까닭을 반성 피드백으로 한 번 다시. 로봇 FSM은 Task 13 `adoptedFsm`이 만든다.
  - `interface EdgeLine { from: string; to: string; on: string; when: string | null; action: string }`(행동 있는 화살표 한 줄)
  - `learnedEdges(previous: FsmMemory, proposed: FsmMemory): EdgeLine[]`
  - `settingsGuard(c: CandidateFsm): { candidates: CandidateFsm; notes: HabitRuleNote[] }` — 배우는 행동(`LEARNED_ACTIONS`)이 아닌 후보 규칙을 빼고 기록한다(까닭은 코치 행동이면 `coach`, 그 밖은 `settings`). 사용자가 정한 습관 화살표는 `adoptedFsm`이 seed 상태 화살표를 seed에서 가져와 지킨다(지금 코치만 지키던 `coachGuard`를 이것으로 바꾼다).
  - `HabitInput`·`HabitOutput`·`HabitFilter`는 이름 그대로, 기억은 새 모양. `HabitRuleNote`는 `{ from; to; on; action; kept; reason; seen?; fired?; p?; conditions? }`.

반성 프롬프트(`reflector_fsm_update.txt`) 바꿈(`old`는 원문 그대로):
1. 「# Inputs」의 "- Current memory: the FSM (states, per-state (trigger, action) entries, and\ntransitions) that was applied today" → "- Current memory: the person-state FSM (states with activities, and transitions with when/action) that was applied today".
2. 「# Memory Structure」 절 전체(“The memory is structured as a HYBRID FINITE-STATE MACHINE.”부터 “- Exactly one state is the `initial_state`.”까지) → 아래 글:
   "The memory is a FINITE-STATE MACHINE of the PERSON's activities.\n- A STATE is one thing the person is doing that the camera can see (drinking, watching TV, using a laptop, cooking). It is never an object situation (a cup left behind, contents), a place alone, a robot action, or a time of day. When the person is not visible the state is `away`; `away` is also the `initial_state`. If the person does two things at once, the main one is the state and the other is a \"doing together\" condition. Add a new state only for a different activity, merge states that are the same activity, and keep at most 12 states. A state written as '~<activity value>' in today's decisions is an activity not in memory yet: add it as a new state if it is a different activity. `activity` lists the matching person activity values of the observation log; one value belongs to one state.\n- A TRANSITION in a state's `next` is (to, on, when, action): `on` is the person's change of activity, or a person event (speech, gesture) during the same activity for a self-transition; `when` is a person-side fact only (what the person was doing together, what the person said); `action` is the one task the robot does then. Object or home conditions (a cup remains, nobody touches it, contents) never go into the memory: the task's own checks handle them. `to: \"*\"` is moving to any other state and needs an action. In the instructions below, a RULE means a transition with an action, and its trigger is `on` plus `when`.\n- In one state, two transitions never share the same (`on`, `when`): one trigger has one action. Doing nothing (waiting, leaving an object as it is) is not an action: leave the transition out."
3. 「# Output」 JSON 블록 → 후보 FSM 모양(「후보 FSM과 채택 검사」 절 `CandidateFsm`, 값은 `<snake_case>`·`<one-sentence>`·`[<activity value>, ...]`, `next`: `[{"to": "<state_id>", "on": "<NL event>"}]`, `rules`: `[{"to": "<state_id or *>", "action": "<task name>", "candidates": [{"on": "<NL event>", "when": "<NL condition, optional>"}, ...1-3]}]`).
5. 석준 님 `reflector_text_update.txt`의 더한 줄을 옮긴다: (출발 상태, 행동)마다 후보 1~3개, 후보는 행동 전 검사 창 안의 사람 순간 하나; 있던 상태 id는 글자 그대로 두고 오늘 본 일이 이미 있는 상태면 그 상태를 쓴다; 있던 후보 문구는 절대 바꾸지 않는다(바꾸면 새 후보라 지난 날을 다시 찾아야 한다); 후보가 3개 미만이면 새 후보를 더한다; 검사 결과(후보마다 n·k·통과)를 입력으로 받고, 3번 이상 나왔는데 75% 미만인 후보만 바꿔도 된다.
6. 입력: 줄 기록 대신 덩어리 기록(Task 14), 지금까지의 후보 FSM, 검사 결과, 피드백.
4. "- Ensure `initial_state` names one of the states, and every `next.to` references an\nexisting state id." → 끝에 " or \"*\""를 더한다.

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
// tests/history-habits.test.ts
describe("반성 뒤 검사(후보 FSM)", () => {
  it("배운 화살표는 행동 있는 화살표 가운데 전에 없던 것이다", () => {
    const proposed = structuredClone(CUP_FSM_MEMORY);
    proposed.states[0]!.next.push({ to: "away", on: "사용자가 외출하러 나간다.", action: "컵 치우기" });
    expect(learnedEdges(CUP_FSM_MEMORY, proposed)).toEqual([{ from: "drinking", to: "away", on: "사용자가 외출하러 나간다.", when: null, action: "컵 치우기" }]);
  });
  it("배우는 행동이 아닌 후보(코치·물 채우기)는 빼고 기록하고, 컵 치우기·에어컨 켜기 후보는 남긴다", () => {
    const c = candidateFsmOf(CUP_FSM_MEMORY);
    c.states.find((s) => s.id === "cooking")!.rules.push({ to: "cooking", action: "라면 끓이기 알려 주기", candidates: [{ on: "라면 얘기를 한다." }] });
    c.states.find((s) => s.id === "drinking")!.rules.push(
      { to: "drinking", action: "컵에 물 채워 주기", candidates: [{ on: "사용자가 물을 다 마신다." }] },
      { to: "*", action: "컵 치우기", candidates: [{ on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다." }] },
    );
    c.states.find((s) => s.id === "away")!.rules.push({ to: "watching_tv", action: "에어컨 켜기", candidates: [{ on: "사용자가 돌아와 TV를 본다." }] });
    const out = settingsGuard(c);
    expect(out.candidates.states.flatMap((s) => s.rules.map((r) => r.action))).toEqual(["컵 치우기", "에어컨 켜기"]);
    expect(out.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "cooking", on: "라면 얘기를 한다.", kept: false, reason: "coach" }),
      expect.objectContaining({ from: "drinking", on: "사용자가 물을 다 마신다.", kept: false, reason: "settings" }),
    ]));
  });
  it("반성이 seed 상태 id를 바꾸거나 빼거나, seed 상태의 하는 일 값을 옮기면 코드 검사가 거절한다(정한 습관이 붙는 상태가 바뀌지 않게)", () => {
    const renamed = candidateFsmOf(CUP_FSM_MEMORY);
    renamed.states.find((s) => s.id === "cooking")!.id = "making_food";
    for (const s of renamed.states) for (const e of s.next) if (e.to === "cooking") e.to = "making_food";
    expect(() => validateCandidateFsm(renamed, CUP_FSM_MEMORY)).toThrow(/seed state 'cooking' is required/);
    const moved = candidateFsmOf(CUP_FSM_MEMORY);
    moved.states.find((s) => s.id === "watching_tv")!.activity = [];
    moved.states.push({ id: "tv_time", description: "사용자가 TV를 본다.", activity: ["watching_tv"], next: [], rules: [] });
    expect(() => validateCandidateFsm(moved, CUP_FSM_MEMORY)).toThrow(/activity of seed state 'watching_tv' must stay/);
  });
});
```

```ts
// tests/history-reflect.test.ts
it("정상 후보 FSM 반성 답(rules에 컵 치우기 후보)은 답 오류 없이 받아져 후보 판본과 로봇 판본이 저장된다. 요청은 후보 FSM 종류다", async () => {
  const c = candidateFsmOf(CUP_FSM_MEMORY);
  c.states.find((s) => s.id === "drinking")!.rules.push({ to: "*", action: "컵 치우기", candidates: [{ on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다." }] });
  const pam = await startFakePamLlm({ reflect: () => c, check: () => ({ ok: true, items: [] }) });
  const db = dayWithLog();
  const r = await runReflection(db, pamClientFor(pam), DAY);
  expect(r).toMatchObject({ ok: true });
  expect(pam.bodies.find((b) => b.role === "reflect")).toMatchObject({ memory_kind: "fsm_candidates", memory: candidateFsmOf(CUP_FSM_MEMORY) });
  expect(db.candidatesFor(nextDay(DAY))!.memory).toEqual(c);
  // 아직 셈이 없어 로봇 FSM은 seed 그대로(떠날 때 묻기). 채택까지는 Task 14 밤 흐름 시험이 같은 길로 본다
  expect(db.memoryFor(nextDay(DAY))!.memory).toEqual(CUP_FSM_MEMORY);
  await pam.close();
});
it("반성 답을 로봇 FSM 모양(fsm)으로 내면 후보 FSM 모양 오류로 거절하고 까닭을 붙여 한 번 다시 반성한다", async () => { /* 첫 답 CUP_FSM_MEMORY → incorrect fields, 둘째 답 candidateFsmOf(CUP_FSM_MEMORY) → 통과 */ });
```

(`dayWithLog`·`DAY`·`nextDay`는 이 파일의 지금 도우미다. 반성 기록 `learned`는 로봇 FSM 사이의 `learnedEdges`다.) 옛 모양(상태 안 `rules[{trigger, action}]`)을 내면 후보 FSM 모양 오류(「incorrect fields」)로 실패로 남는다.

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

/** 배우지 않는 행동 후보를 빼고 기록한다. 사용자가 정한 습관 화살표는 adoptedFsm이 seed에서 가져온다(seed 상태의 화살표는 seed 것). */
export function settingsGuard(c: CandidateFsm): { candidates: CandidateFsm; notes: HabitRuleNote[] } {
  const notes: HabitRuleNote[] = [];
  const states = c.states.map((s) => ({
    ...s, activity: [...s.activity], next: s.next.map((e) => ({ ...e })),
    rules: s.rules.filter((r) => {
      if (LEARNED_ACTIONS.includes(r.action)) return true;
      for (const x of r.candidates) notes.push({ from: s.id, to: r.to, on: x.on, action: r.action, kept: false, reason: isCoach(r.action) ? "coach" : "settings" });
      return false;
    }).map((r) => ({ ...r, candidates: r.candidates.map((x) => ({ ...x })) })),
  }));
  return { candidates: { initial_state: c.initial_state, states }, notes };
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
- Consumes: Task 1 `FsmMemory`·`validateMemory`, Task 6 반성 흐름(후보 FSM 종류, `validateCandidateFsm`·`settingsGuard`), Task 13 `adoptedFsm`.
- Produces:
  - `interface MemoryVerdict { ok: boolean; items: { kind: "state" | "condition" | "merge"; ref: string; ok: boolean; why: string }[] }`
  - `parseVerdict(raw: string): MemoryVerdict`(엄격한 JSON: 칸이 정확하고, `ok`는 `items`가 모두 통과일 때만 참이어야 한다. 아니면 `ContractError`)
  - `PamClient.checkMemory(memory: CandidateFsm, o?: { signal?: AbortSignal; onUsage?: (u: PamUsage) => void }): Promise<MemoryVerdict>` — PAM LLM 통로 한 번(같은 주소·같은 전송 값, `config/transport.json`의 반성 값). 답이 틀리면 거절 판정(`{ ok: false, items: [{ kind: "state", ref: "*", ok: false, why: "검사 답을 읽을 수 없음" }] }`).
  - `REFLECT_TEXT.rejected(why: string)` — 「반성 기억을 쓰지 않아요 · <까닭>」

뜻 검사 프롬프트(`memory_check.txt`, 이 저장소에서 만든 글이라 논문 해시 대상이 아니다):

```text
You check a person-activity finite-state machine that a household robot learned. Answer only with one JSON object.
Rules:
1. Each state is ONE thing the person is doing that a camera can see (drinking, watching TV, using a laptop, cooking, away). A state must not be an object situation (a cup left behind, contents), a place alone, a robot action, or a time of day. If the person does two things at once, the main one is the state and the other is a "doing together" condition.
2. Each transition condition (`when`) is a person-side fact only: what the person was doing together, or what the person said. Object or home conditions (a cup remains, nobody touches it, contents, temperature) are not allowed.
3. Two states that are the same activity in other words (for example "watching TV" and "TV viewing") must be merged.
Output: {"ok": <true only if every item is ok>, "items": [{"kind": "state" | "condition" | "merge", "ref": "<state id, or state id + '.next[' + index + ']', or state id + '.rules[' + i + '].candidates[' + j + ']', or 'id1+id2'>", "ok": <bool>, "why": "<one short Korean sentence>"}]}
List one item per state, one per transition or candidate (`rules[].candidates[]`) that has `when`, and one per pair that should be merged.
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
    const verdict = await pamClientFor(pam).checkMemory(candidateFsmOf(CUP_FSM_MEMORY));
    expect(verdict.ok).toBe(true);
    expect(pam.bodies.at(-1)).toMatchObject({ role: "check" });
    await pam.close();
  });
});
```

```ts
// tests/history-reflect.test.ts
describe("반성 → 코드 검사 → 뜻 검사", () => {
  // 반성 답은 후보 FSM 모양이다(Task 6)
  const SEED_C = () => candidateFsmOf(CUP_FSM_MEMORY);
  const LEFT = () => { const c = SEED_C(); c.states.splice(3, 0, { id: "left_cup", description: "사용자가 컵을 두고 떠났다.", activity: ["putting_away"], next: [], rules: [] }); return c; };
  it("뜻 검사가 거절하면 까닭을 피드백에 붙여 한 번 다시 반성하고, 다시 낸 기억이 통과하면 그것을 쓴다", async () => {
    const asked: (string | null)[] = [];
    const answers = [LEFT(), SEED_C()];
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
    const answers: unknown[] = [OLD, SEED_C()];
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
/** 반성 한 번(후보 FSM 종류) + 배우지 않는 행동 후보 빼기 + 뜻 검사. 거절이면 까닭 글. 로봇 FSM은 통과한 뒤 adoptedFsm으로 만든다. */
const attempt = async (feedback: string | null): Promise<{ candidates: CandidateFsm; why: null } | { candidates: null; why: string }> => {
  let candidates: CandidateFsm;
  try {
    // 반성 답은 후보 FSM 종류로 받는다: PamClient.reflect가 validateCandidateFsm(raw, seed)로 보고 모양 오류는 PamAnswerError(Codex 2966378 P2).
    // 모양 오류도 까닭으로 받아 한 번 다시 반성한다(Codex 8ab2d06 P2)
    const raw = await pam.reflect({ ...req, memory_kind: "fsm_candidates", memory: db.candidatesFor(day)?.memory ?? candidateFsmOf(today.memory), feedback }, "fsm_candidates", call);
    candidates = settingsGuard(raw).candidates;
  } catch (e) {
    if (e instanceof ContractError) return { candidates: null, why: e.message };   // PamAnswerError·후보 코드 검사. 연결 오류(PamLinkError)는 그대로 던진다
    throw e;
  }
  const verdict = await pam.checkMemory(candidates, call);
  return verdict.ok ? { candidates, why: null } : { candidates: null, why: verdict.items.filter((x) => !x.ok).map((x) => `${x.ref}: ${x.why}`).join(" / ") };
};
let got = await attempt(feedback);
if (got.why !== null) got = await attempt([feedback, `기억 검사 까닭: ${got.why}`].filter(Boolean).join("\n"));
if (got.why !== null) {
  done(false, REFLECT_TEXT.rejected(got.why), null, null);
  return { ok: false, error: got.why };
}
```

통과하면 로봇 FSM = `validateMemory(adoptedFsm(got.candidates, 지난 통과 후보, CUP_FSM_MEMORY), "fsm")`(Task 14 전에는 통과 후보가 빈 집합)이고, 후보 판본(`fsm_candidates`)과 로봇 판본(`fsm`)을 저장한다(Task 14가 `saveNight` 한 트랜잭션으로 바꾼다). 반성 기록 `learned`는 `learnedEdges(오늘 로봇 FSM, 새 로봇 FSM)`, `dropped`는 `settingsGuard` 기록이다. `memoryCheck.ts`는 `adaptedTemplate` 대신 `memory_check.txt`를 읽어 `{ role: "system", content }`와 사용자 글 `Memory:\n<JSON>`으로 PAM LLM을 부르고(`llm.ts`의 반성 호출과 같은 함수, 같은 생성 설정), 답을 `parseVerdict`로 읽는다. 반성 기록 data에 `rejected: string | null`을 싣는다.

- [ ] **Step 4: 통과 확인**

Run: `npm run heavy -- npx vitest run tests/pam-memory-check.test.ts tests/history-reflect.test.ts tests/same-structure.test.ts tests/pam-llm.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/brain/pam/memoryCheck.ts src/brain/pam/scenarios/noonchi/memory_check.txt src/brain/pam/client.ts src/brain/history src/contract/events.ts tests/helpers/pam.ts tests/pam-memory-check.test.ts tests/history-reflect.test.ts
git commit -m "feat(reflect): check the reflected memory's meaning with the PAM LLM and reflect once more on rejection"
```

---

### Task 13: 채택 검사를 Node로 옮기기 (계산만, Task 6 앞에 한다)

석준 님 `pam/trigger_check.py`(origin/main 48d56a1)를 그대로 옮긴다. 모델을 부르지 않는다. 석준 님 시험 경우를 하나씩 옮겨 같은 답이 나오는지로 막는다.

**Files:**
- Create: `src/brain/pam/adopt.ts`
- Test: `tests/pam-adopt.test.ts`(석준 님 `tests/test_trigger_check.py`의 경우를 그대로)

**Interfaces:**
- Produces:
  - `FOLLOW_SECONDS = 300`, `RATE_MIN = 0.75`, `ALPHA = 0.001`, `FLOOR = 0.01`
  - `interface CheckDay { start: number; end: number; candidate: number[]; action: number[]; unseen: [number, number][]; answered?: number[] }`(자정부터 초. `unseen`에는 사람이 안 보인 구간과 로봇이 그 행동을 한 구간이 함께 든다. `answered`는 그 행동을 물은 질문에 답한 때로, 이 계획이 더한 칸이다)
  - `interface CheckResult { n: number; k: number; unknown: number; rate: number; base_rate: number; p0: number; p_value: number; passed: boolean }`
  - `binomialTail(k: number, n: number, p: number): number`, `checkCandidate(days: CheckDay[], window = FOLLOW_SECONDS): CheckResult`
  - `adoptedFsm(c: CandidateFsm, passed: ReadonlySet<string>, seed: FsmMemory): FsmMemory` — `passed`의 열쇠는 `adoptKey(state, action, candidate)` = `JSON.stringify([state, action, on, when ?? null])`. seed 상태는 seed 화살표 차례 그대로(사용자가 정한 습관 화살표는 늘), 통과한 배우는 행동 후보(컵 치우기·에어컨 켜기)는 같은 (on, when)의 묻기(또는 행동 없는) 화살표를 그 자리에서 바꾸고 새 트리거면 끝에 더한다. 사용자가 정한 습관 화살표와 같은 (on, when)인 후보와 배우는 행동이 아닌 후보는 넣지 않는다. seed 상태의 하는 일 값·화살표는 seed 것이다(후보 값을 쓰지 않는다). `adoptKey(state, action, candidate)`도 낸다. 결과는 `validateMemory`(코드 검사)를 지난다.

- [ ] **Step 1: 실패하는 시험 쓰기** (`tests/pam-adopt.test.ts`, 시각은 `t("07:10:00")`처럼 초로)

```ts
const t = (s: string) => { const [h, m, x] = s.split(":").map(Number); return h! * 3600 + m! * 60 + x!; };
const day = (candidate: string[] = [], action: string[] = [], unseen: [string, string][] = [], start = "07:00:00", end = "08:00:00"): CheckDay =>
  ({ start: t(start), end: t(end), candidate: candidate.map(t), action: action.map(t), unseen: unseen.map(([a, b]) => [t(a), t(b)]) });
const FOLLOWED = day(["07:10:00"], ["07:13:00"]);
const MISSED = day(["07:10:00"], []);
const close = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b))).toBe(true);

describe("채택 검사(석준 님 trigger_check 그대로)", () => {
  it("이항 꼬리 확률", () => {
    for (const [[k, n, p], want] of [[[2, 2, 0.01], 1e-4], [[6, 7, 0.01], 6.94e-12], [[4, 5, 0.2], 0.00672], [[9, 10, 0.8], 0.3758096384], [[0, 3, 0.5], 1.0]] as const) close(binomialTail(k, n, p), want);
  });
  it("따라온 이틀은 바닥값으로 통과, 하루는 모자람", () => {
    const two = checkCandidate([FOLLOWED, FOLLOWED]);
    expect([two.n, two.k, two.unknown, two.base_rate, two.p0, two.passed]).toEqual([2, 2, 0, 0, 0.01, true]);
    close(two.p_value, 1e-4, 1e-9);
    const one = checkCandidate([FOLLOWED]);
    expect([one.rate, one.passed]).toEqual([1, false]);
    close(one.p_value, 0.01, 1e-9);
  });
  it("5분은 세고 2초 뒤는 안 센다, 후보 앞 행동은 안 센다", () => {
    expect(checkCandidate([day(["07:10:00"], ["07:15:00"])]).k).toBe(1);
    expect(checkCandidate([day(["07:10:00"], ["07:15:02"])]).k).toBe(0);
    expect(checkCandidate([day(["07:10:00"], ["07:09:00"])])).toMatchObject({ n: 1, k: 0 });
  });
  it("안 보인 창에 행동이 없으면 못 봄", () => {
    const gone = day(["12:30:00"], [], [["12:30:04", "17:00:00"]], "12:00:00", "17:00:00");
    const seen = day(["12:30:00"], ["12:32:00"], [["12:32:06", "17:00:00"]], "12:00:00", "17:00:00");
    expect(checkCandidate([gone, seen])).toMatchObject({ n: 1, k: 1, unknown: 1 });
  });
  it("다른 때 비율은 다른 칸에서, 안 보인 칸은 뺀다", () => {
    const r = checkCandidate([day(["07:00:00"], ["07:03:00", "07:21:00", "07:41:00"])]);
    expect([r.n, r.k, r.passed]).toEqual([1, 1, false]);
    close(r.base_rate, 0.2); close(r.p0, 0.2); close(r.p_value, 0.2);
    close(checkCandidate([day(["07:00:00"], ["07:03:00", "07:12:00"], [["07:30:00", "08:00:00"]])]).base_rate, 0.25);
  });
  it("75%는 통과, 2/3는 아님", () => {
    const four = checkCandidate([FOLLOWED, FOLLOWED, FOLLOWED, MISSED]);
    expect([four.rate, four.passed]).toEqual([0.75, true]);
    const three = checkCandidate([FOLLOWED, FOLLOWED, MISSED]);
    close(three.rate, 2 / 3); expect(three.passed).toBe(false);
  });
  it("잦은 행동은 일곱째 밤에야 통과", () => {
    const week = [1, 2, 3, 4, 5, 6, 7].map((n) => day(["07:00:00"], [...(n === 3 ? [] : ["07:03:00"]), "07:21:00", "07:41:00"]));
    const n6 = checkCandidate(week.slice(0, 6)), n7 = checkCandidate(week);
    close(n6.p_value, 0.0016); expect(n6.passed).toBe(false);
    close(n7.p_value, 0.0003712); expect(n7.passed).toBe(true);
  });
  it("행동 앞 마지막 후보만 공로, 저마다 행동이 따라오면 모두 셈, 본 되풀이는 앞 것을 안 따라온 것으로 끝낸다", () => {
    expect(checkCandidate([day(["07:10:00", "07:11:00", "07:12:00"], ["07:14:00"])])).toMatchObject({ n: 3, k: 1, passed: false });
    expect(checkCandidate([day(["07:10:00", "07:20:00", "07:30:00"], ["07:12:00", "07:22:00", "07:32:00"])])).toMatchObject({ n: 3, k: 3 });
    expect(checkCandidate([day(["12:30:00", "12:31:00"], [], [["12:31:10", "17:00:00"]], "12:00:00", "17:00:00")])).toMatchObject({ n: 1, k: 0, unknown: 1 });
  });
  it("로봇이 그 일을 한 구간(unseen에 더함)에 사람 행동·답이 없으면 못 봄, 「그대로 둬요」 답(answered)이 있는 창은 안 보였어도 따라오지 않은 것(이 계획이 더한 칸)", () => {
    const robot = day(["08:00:00"], [], [["08:00:03", "08:01:40"]], "07:30:00", "09:00:00");   // 떠남 → 로봇이 바로 치움(running → done)
    expect(checkCandidate([FOLLOWED, FOLLOWED, robot])).toMatchObject({ n: 2, k: 2, unknown: 1, passed: true });
    const keep: CheckDay = { ...day(["08:00:00"], [], [["08:00:01", "09:00:00"]], "07:30:00", "09:00:00"), answered: [t("08:01:30")] };   // 떠나서 안 보임 + 「그대로 둬요」
    expect(checkCandidate([keep])).toMatchObject({ n: 1, k: 0, unknown: 0 });
    expect(checkCandidate([{ ...keep, answered: [] }])).toMatchObject({ n: 0, unknown: 1 });
  });
  it("1분 창은 그다음 1분만 세고 다른 때 칸도 1분이다, 한 번도 없으면 통과 못 함", () => {
    const late = day(["07:10:00"], ["07:11:30"]);
    expect(checkCandidate([late]).k).toBe(1);
    expect(checkCandidate([late], 60).k).toBe(0);
    expect(checkCandidate([day(["07:10:00"], ["07:10:59"])], 60).k).toBe(1);
    close(checkCandidate([day(["07:00:00"], ["07:00:30", "07:05:10"], [], "07:00:00", "07:10:00")], 60).base_rate, 1 / 8);
    expect(checkCandidate([day([], ["07:13:00"])])).toMatchObject({ n: 0, passed: false });
    expect(() => checkCandidate([FOLLOWED], 0)).toThrow(/positive whole number/);
  });
});

describe("로봇 FSM 만들기(석준 님 predictor_fsm을 화살표로)", () => {
  const LEAVE_ON = "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.";
  const withClear = () => {
    const c = candidateFsmOf(CUP_FSM_MEMORY);   // seed를 후보 FSM 모양으로(시험 도우미): seed 행동 화살표는 rules에 들지 않는다
    c.states.find((s) => s.id === "drinking")!.rules.push({ to: "*", action: "컵 치우기", candidates: [{ on: LEAVE_ON }, { on: "사용자가 외출하러 나간다." }] });
    return c;
  };
  it("통과 전에는 seed 그대로(떠날 때 묻기), 통과하면 같은 트리거의 묻기 화살표 자리가 컵 치우기가 되어 배운 뒤 기억과 같다. 후보 FSM은 그대로다", () => {
    const c = withClear();
    const before = structuredClone(c);
    expect(adoptedFsm(c, new Set(), CUP_FSM_MEMORY)).toEqual(CUP_FSM_MEMORY);
    const out = adoptedFsm(c, new Set([adoptKey("drinking", "컵 치우기", { on: LEAVE_ON })]), CUP_FSM_MEMORY);
    expect(out).toEqual(LEARNED_FSM_MEMORY);
    expect(validateMemory(out, "fsm")).toBe(out);
    expect(c).toEqual(before);
  });
  it("다른 트리거 후보는 끝에 더하고 묻기 화살표는 남는다. 사용자가 정한 습관 화살표는 후보가 없어도 늘 그대로다", () => {
    const out = adoptedFsm(withClear(), new Set([adoptKey("drinking", "컵 치우기", { on: "사용자가 외출하러 나간다." })]), CUP_FSM_MEMORY);
    const drink = out.states.find((s) => s.id === "drinking")!;
    expect(drink.next.map((e) => e.action ?? null)).toEqual(["사용자에게 물어보기", "컵에 물 채워 주기", "컵 치우기"]);
    expect(drink.next.at(-1)).toEqual({ to: "*", on: "사용자가 외출하러 나간다.", action: "컵 치우기" });
    const settings = (m: FsmMemory) => m.states.flatMap((s) => s.next.filter((e) => e.action && e.action !== "사용자에게 물어보기" && e.action !== "컵 치우기"));
    expect(settings(out)).toEqual(settings(CUP_FSM_MEMORY));
  });
  it("사용자가 정한 습관과 같은 트리거인 후보, 배우는 행동이 아닌 후보는 통과로 와도 넣지 않는다", () => {
    const c = withClear();
    const water = CUP_FSM_MEMORY.states[0]!.next[1]!;
    c.states[0]!.rules.push({ to: "drinking", action: "컵 치우기", candidates: [{ on: water.on }] }, { to: "away", action: "컵에 콜라 따라 주기", candidates: [{ on: "사용자가 외출하러 나간다." }] });
    const out = adoptedFsm(c, new Set([adoptKey("drinking", "컵 치우기", { on: water.on }), adoptKey("drinking", "컵에 콜라 따라 주기", { on: "사용자가 외출하러 나간다." })]), CUP_FSM_MEMORY);
    expect(out).toEqual(CUP_FSM_MEMORY);
  });
  it("말없이 TV 보기 시작 → 에어컨 켜기 후보는 통과하면 자리에 없음의 진입 화살표에 그 자리에서 붙고, 덥다·부채질 → 에어컨(정한 습관)은 같은 트리거 후보가 와도 그대로다", () => {
    const away = (m: FsmMemory) => m.states.find((s) => s.id === "away")!;
    const enter = away(CUP_FSM_MEMORY).next.findIndex((e) => e.to === "watching_tv");
    const TV_START_ON = away(CUP_FSM_MEMORY).next[enter]!.on;   // 「사용자가 돌아와 TV를 본다.」
    const c = candidateFsmOf(CUP_FSM_MEMORY);
    const hot = CUP_FSM_MEMORY.states[1]!.next[1]!;
    c.states.find((s) => s.id === "away")!.rules.push({ to: "watching_tv", action: "에어컨 켜기", candidates: [{ on: TV_START_ON }] });
    c.states.find((s) => s.id === "watching_tv")!.rules.push({ to: "watching_tv", action: "에어컨 켜기", candidates: [{ on: hot.on }] });
    const out = adoptedFsm(c, new Set([adoptKey("away", "에어컨 켜기", { on: TV_START_ON }), adoptKey("watching_tv", "에어컨 켜기", { on: hot.on })]), CUP_FSM_MEMORY);
    expect(away(out).next[enter]).toEqual({ to: "watching_tv", on: TV_START_ON, action: "에어컨 켜기" });
    expect(away(out).next).toHaveLength(away(CUP_FSM_MEMORY).next.length);
    expect(out.states.find((s) => s.id === "watching_tv")!.next).toEqual(CUP_FSM_MEMORY.states[1]!.next);
  });
  it("후보 FSM이 seed 상태의 하는 일 값을 바꿔 와도 로봇 FSM의 seed 상태는 seed 하는 일 값을 쓴다(정한 습관이 붙는 상태가 바뀌지 않는다)", () => {
    const c = candidateFsmOf(CUP_FSM_MEMORY);
    c.states.find((s) => s.id === "watching_tv")!.activity = ["using_laptop"];
    expect(adoptedFsm(c, new Set(), CUP_FSM_MEMORY).states.find((s) => s.id === "watching_tv")!.activity).toEqual(["watching_tv"]);
  });
});
```

(`candidateFsmOf(m: FsmMemory): CandidateFsm`는 `src/brain/pam/adopt.ts`에 둔다: 로봇 FSM의 행동 없는 화살표는 `next`로, seed가 아닌 행동 화살표는 후보 하나짜리 `rules`로. 그날 후보 판본이 아직 없을 때 반성 요청의 후보 FSM도 이것으로 만든다(Task 6).)

- [ ] **Step 2: 실패 확인** — `npm run heavy -- npx vitest run tests/pam-adopt.test.ts`. Expected: FAIL (`adopt.ts` 없음)
- [ ] **Step 3: 구현**

```ts
// src/brain/pam/adopt.ts
// 반성 후보의 채택 검사(석준 님 ai 저장소 pam/trigger_check.py, origin/main 48d56a1 그대로). 모델을 부르지 않는다.
//   채택(c → a) ⇔ k/n ≥ 0.75 이고 Σ_{i=k..n} C(n,i) p0^i (1-p0)^(n-i) < 0.001,  p0 = max(다른 때 비율, 0.01)
export const FOLLOW_SECONDS = 300;
export const RATE_MIN = 0.75;
export const ALPHA = 0.001;
export const FLOOR = 0.01;

const comb = (n: number, k: number) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
export const binomialTail = (k: number, n: number, p: number): number => { let s = 0; for (let i = k; i <= n; i++) s += comb(n, i) * p ** i * (1 - p) ** (n - i); return s; };

export function checkCandidate(days: CheckDay[], window = FOLLOW_SECONDS): CheckResult {
  if (!Number.isInteger(window) || window < 1) throw new Error("The check window must be a positive whole number of seconds.");
  let n = 0, k = 0, unknown = 0, other = 0, withAction = 0;
  for (const d of days) {
    const ordered = [...d.candidate].sort((a, b) => a - b);
    ordered.forEach((moment, i) => {
      // 반열린 창 [low, high): 후보 뒤 창, 같은 후보가 다시 나오면 거기까지. 행동 앞 마지막 후보만 공로를 받는다
      const low = moment + 1;
      let high = moment + window + 1;
      const repeat = ordered.slice(i + 1).find((later) => later > moment);
      if (repeat !== undefined && repeat < high) high = repeat;
      if (d.action.some((a) => low <= a && a < high)) { n++; k++; }
      // 「그대로 둬요」 답: 사람이 떠나 안 보였어도 본 것이고 따라오지 않은 것(이 계획이 더한 칸, Codex b115d69 P2: 빠뜨리면 거절이 쌓여도 채택이 유지됐다)
      else if ((d.answered ?? []).some((a) => low <= a && a < high)) n++;
      else if (d.unseen.some(([s, e]) => s < high && e > low)) unknown++;
      else n++;
    });
    for (let slot = d.start; slot < d.end; slot += window) {
      const slotEnd = slot + window;
      if (d.candidate.some((m) => slot <= m + window && slotEnd > m)) continue;
      if (d.unseen.some(([s, e]) => s < slotEnd && e > slot)) continue;
      other++;
      if (d.action.some((a) => slot <= a && a < slotEnd)) withAction++;
    }
  }
  const base = other ? withAction / other : 0;
  const p0 = Math.max(base, FLOOR);
  const rate = n ? k / n : 0;
  const p = n ? binomialTail(k, n, p0) : 1;
  return { n, k, unknown, rate, base_rate: base, p0, p_value: p, passed: n > 0 && rate >= RATE_MIN && p < ALPHA };
}
```

```ts
// src/brain/pam/adopt.ts (이어서)
export const adoptKey = (state: string, action: string, c: Candidate) => JSON.stringify([state, action, c.on, c.when ?? null]);
const trig = (on: string, when?: string | null) => JSON.stringify([on, when ?? null]);

/** 로봇 FSM: seed 상태는 seed 화살표 차례 그대로(사용자가 정한 습관은 늘), 통과한 배우는 행동 후보가 같은 트리거의 묻기(또는 행동 없는) 화살표를
 *  그 자리에서 바꾸고, 새 트리거면 끝에 더한다. 사용자가 정한 습관 자리와 트리거가 같은 후보는 넣지 않는다. 후보 FSM은 바꾸지 않는다. */
export function adoptedFsm(c: CandidateFsm, passed: ReadonlySet<string>, seed: FsmMemory): FsmMemory {
  const states: FsmState[] = c.states.map((s) => {
    const own = seed.states.find((x) => x.id === s.id);
    const next: FsmEdge[] = own ? own.next.map((e) => ({ ...e })) : [];
    for (const e of s.next) if (!next.some((x) => trig(x.on, x.when) === trig(e.on))) next.push({ to: e.to, on: e.on });
    for (const r of s.rules) {
      if (!LEARNED_ACTIONS.includes(r.action)) continue;
      for (const cand of r.candidates) {
        if (!passed.has(adoptKey(s.id, r.action, cand))) continue;
        const edge: FsmEdge = { to: r.to, on: cand.on, ...(cand.when ? { when: cand.when } : {}), action: r.action };
        const at = next.findIndex((x) => trig(x.on, x.when) === trig(cand.on, cand.when));
        if (at === -1) next.push(edge);
        else if (!next[at]!.action || next[at]!.action === ASK_ACTION) next[at] = edge;
      }
    }
    // seed 상태의 하는 일 값은 seed 것(Codex b115d69 P2: 후보 값을 쓰면 정한 습관이 붙는 대상이 바뀐다). 설명만 후보 것
    return { id: s.id, description: s.description, activity: [...(own ?? s).activity], next };
  });
  // seed 상태는 후보 FSM에 늘 같은 id로 있다(validateCandidateFsm이 막는다)
  return validateMemory({ initial_state: c.initial_state, states }, "fsm") as FsmMemory;
}
```

seed 상태는 후보 FSM에 늘 같은 id·같은 하는 일 값으로 있으므로(`validateCandidateFsm`, Task 6) 이름을 바꾼 상태를 찾는 `hostOf`·되살리기는 쓰지 않는다(seed 상태의 화살표 차례가 seed와 같다). `settingsGuard`는 「후보 FSM에서 배우는 행동(`LEARNED_ACTIONS`)이 아닌 후보를 빼고 기록(까닭 `coach`·`settings`)」만 한다. `answered`는 석준 님 함수에 없는 칸이라 석준 님 시험 경우는 이 칸 없이 같은 답이다.

- [ ] **Step 4: 통과 확인** — `npm run heavy -- npx vitest run tests/pam-adopt.test.ts`. Expected: PASS(석준 님 시험과 같은 숫자)
- [ ] **Step 5: 커밋** — `git commit -m "feat(pam): port the adoption check (75% and one-sided binomial test) and build the robot FSM from passing candidates"`

---

### Task 14: 덩어리 기록·시각 찾기·밤 흐름

**Files:**
- Create: `src/brain/pam/scenarios/noonchi/chunking.txt`, `marking.txt`(석준 님 `prompts/text/` 글을 집·기록 모양에 맞춘 것, 이 저장소 글이라 논문 해시 대상이 아님), `src/brain/history/night.ts`(밤 흐름), `src/brain/pam/marks.ts`(`validateChunks`·`validateMarks`, 석준 님 `contracts.py` 그대로)
- Modify: `src/brain/pam/client.ts`(`PamClient.chunk`·`PamClient.mark`: PAM LLM 통로 한 번씩), `src/brain/history/reflect.ts`(`runReflection` → 밤 흐름), `src/brain/history/db.ts`(기억 종류 `fsm_candidates`와 종류 나누기, `saveNight` 한 트랜잭션), `tests/helpers/pam.ts`(가짜 PAM LLM이 덩어리·시각 찾기에 답함)
- Test: `tests/pam-marks.test.ts`(새), `tests/history-night.test.ts`(새), `tests/history-reflect.test.ts`

**Interfaces:**
- Consumes: Task 6 후보 FSM 반성, Task 7 뜻 검사, Task 13 `checkCandidate`·`adoptedFsm`.
- Produces:
  - `PamClient.chunk(lines: string[]): Promise<{ chunks: { start: string; end: string; text: string }[] }>`, `PamClient.mark(i: { states; candidates: { state: string; candidate: Candidate }[]; actions: string[]; lines: string[]; chunks }): Promise<Marks>`
  - `answerActions(db, day): { action: string; times: number[] }[]` — 기록 DB 답 줄에서 「로봇이 물었을 때 그 일을 해 달라고 답한 때」(사용자에게 물어보기 계획의 답이 그 행동을 고른 것, 예 `clear` → 「컵 치우기」). 「두세요」 답은 넣지 않는다.
  - `answerTimes(db, day, action): number[]` — 그 행동을 물은 질문에 답한 때(「치워 주세요」·「그대로 둬요」 모두). `CheckDay.answered`에 넣는다.
  - `robotSpans(db, day, action): [number, number][]` — 로봇이 그 행동을 실행한 구간(그 행동 계획의 실행 기록 `running` → `done`·`failed`, 끝이 없으면 그날 끝까지). `CheckDay.unseen`에 더한다(사용자 답: 로봇이 습관대로 한 때는 못 봄).
  - `runNight(db, pam, day, o): Promise<NightResult>` — 덩어리 → 반성 → 코드 검사 → 뜻 검사(→ 한 번 다시) → 시각 찾기(지난 날, 모르는 것만, `runtime/homes/<집>/habit/marks-<날>.json`) → 채택 검사 → 로봇 FSM → 코드 검사 → 저장(`saveNight`: 로봇 FSM `fsm`·후보 FSM `fsm_candidates`·반성 기록(`data.checks`에 검사 결과)을 한 트랜잭션으로. 그 뒤 `habit/check-<날>.json` 사본). 옵션 `o.writeFile`은 파일 쓰기(시험이 실패를 넣는다).
  - 기억 종류 나누기(Codex b115d69 P2): `memoryFor(day)`·`latestMemoryVersion()`·`memoryVersions()`·`pinMemory`·`/api/memory/day`는 실행 기억(`fsm`·`list`)만 본다. `pinMemory`에 후보 판본 번호를 주면 `not an execution memory` 오류. 후보는 `candidatesFor(day): MemoryVersion | null`(그날까지 가장 새 후보 판본, 다음 밤 반성 입력)로만 읽는다. `saveMemory`의 `kind`에 `"fsm_candidates"`를 더한다.
  - `saveNight(o: { day: string; appliesDay: string; robot: FsmMemory; candidates: CandidateFsm; reflection: { text: string; data: unknown } }): { robot: number; candidates: number }` — `BEGIN IMMEDIATE` 안에서 두 판본(안에서 `saveMemory`를 로봇·후보 차례로 부른다)·반성 기록·`appliesDay` 고정을 저장하고 `COMMIT`, 어느 하나라도 던지면 `ROLLBACK`하고 다시 던진다(Codex b115d69 P2: 뒤 저장이 실패하면 새 로봇 판본만 남아 「실패하면 전날 기억」이 깨졌다). 시각 찾기 사본(`marks-<날>.json`)은 트랜잭션 전에 임시 파일 → 이름 바꾸기로 쓴다(그날 사실의 사본이라 기억이 저장되지 않아도 다음 밤에 다시 쓴다). `check-<날>.json`은 커밋 뒤 임시 파일 → 이름 바꾸기로 쓰는 사본이고, 실패하면 로그 한 줄만 남긴다(검사 결과는 반성 기록 `data.checks`에 있다).
  - `NightResult = { ok: boolean; passed: { state: string; action: string; on: string; when?: string }[]; checks: (CheckResult & { state: string; action: string; on: string; when: string | null })[] }`

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
// tests/history-night.test.ts
it("「치워 주세요」 답은 따라온 것으로 센다: 하루 한 번 떠남 + 답이면 둘째 밤에 통과해 로봇 FSM에 그 화살표가 생긴다", async () => {
  const pam = await startFakePamLlm({ chunk: oneChunkPerLine, reflect: () => CANDIDATES_ASK_THEN_CLEAR, check: () => ({ ok: true, items: [] }), mark: markLeaveAt("08:00:00") });
  const db = HistoryDb.open(":memory:");
  for (const d of ["2026-11-10", "2026-11-11"]) leaveAndAnswer(db, d, "08:00:00", "08:01:30", "clear");   // 08:00 떠남, 08:01:30 「치워 주세요」
  const first = await runNight(db, pamClientFor(pam), "2026-11-10", { dir: tmp() });
  expect(first.passed).toEqual([]);
  const second = await runNight(db, pamClientFor(pam), "2026-11-11", { dir: tmp() });
  expect(second.passed).toEqual([{ state: "drinking", action: "컵 치우기", on: LEAVE_ON }]);
  // 반성 답은 후보 FSM 종류로 받아 정상 후보 rules가 답 오류 없이 채택까지 간다(Codex 2966378 P2)
  expect(pam.bodies.filter((b) => b.role === "reflect").every((b) => b.memory_kind === "fsm_candidates")).toBe(true);
  expect(memoryForDay(db, "2026-11-12").memory.states.find((s) => s.id === "drinking")!.next.some((e) => e.action === "컵 치우기" && e.on === LEAVE_ON)).toBe(true);
  await pam.close();
});
it("채택 뒤 로봇이 바로 치운 날(사람이 하지도 답하지도 않음)은 못 봄이라 셈이 늘지 않고 채택이 이어진다", async () => {
  const pam = await startFakePamLlm({ chunk: oneChunkPerLine, reflect: () => CANDIDATES_ASK_THEN_CLEAR, check: () => ({ ok: true, items: [] }), mark: markLeaveAt("08:00:00") });
  const db = HistoryDb.open(":memory:");
  const dir = tmp();
  for (const d of ["2026-11-10", "2026-11-11"]) leaveAndAnswer(db, d, "08:00:00", "08:01:30", "clear");
  leaveAndRobotClears(db, "2026-11-12", "08:00:00", "08:00:03", "08:01:40");   // 08:00 떠남, 08:00:03 로봇 컵 치우기 running, 08:01:40 done, 답 없음
  await runNight(db, pamClientFor(pam), "2026-11-10", { dir });
  await runNight(db, pamClientFor(pam), "2026-11-11", { dir });
  const third = await runNight(db, pamClientFor(pam), "2026-11-12", { dir });
  expect(robotSpans(db, "2026-11-12", "컵 치우기")).toEqual([[t("08:00:03"), t("08:01:40")]]);
  expect(third.checks).toContainEqual(expect.objectContaining({ state: "drinking", action: "컵 치우기", on: LEAVE_ON, n: 2, k: 2, unknown: 1, passed: true }));
  await pam.close();
});
it("「그대로 둬요」 답은 사람이 떠나 안 보였어도 셈에 든다: 치워·둬요·둬요·치워면 n=4·k=2로 통과하지 않고 떠날 때는 계속 묻는다", async () => {
  const pam = await startFakePamLlm({ chunk: oneChunkPerLine, reflect: () => CANDIDATES_ASK_THEN_CLEAR, check: () => ({ ok: true, items: [] }), mark: markLeaveAt("08:00:00") });
  const db = HistoryDb.open(":memory:");
  const dir = tmp();
  const days = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];
  (["clear", "keep", "keep", "clear"] as const).forEach((a, i) => leaveAndAnswer(db, days[i]!, "08:00:00", "08:01:30", a));
  let last: NightResult | null = null;
  for (const d of days) last = await runNight(db, pamClientFor(pam), d, { dir });
  expect(last!.checks).toContainEqual(expect.objectContaining({ state: "drinking", action: "컵 치우기", on: LEAVE_ON, n: 4, k: 2, unknown: 0, passed: false }));
  expect(memoryForDay(db, "2026-11-14").memory.states.find((s) => s.id === "drinking")!.next[0]!.action).toBe("사용자에게 물어보기");
  await pam.close();
});
it("후보 판본(fsm_candidates)은 실행 기억으로 뽑히지 않는다: 밤 흐름이 후보를 로봇 FSM과 함께 저장해도 다음 날 판단 기억·/api/memory/day·가장 새 판본은 로봇 FSM이다", async () => {
  const pam = await startFakePamLlm({ chunk: oneChunkPerLine, reflect: () => CANDIDATES_ASK_THEN_CLEAR, check: () => ({ ok: true, items: [] }), mark: markLeaveAt("08:00:00") });
  const db = HistoryDb.open(":memory:");
  leaveAndAnswer(db, "2026-11-10", "08:00:00", "08:01:30", "clear");
  await runNight(db, pamClientFor(pam), "2026-11-10", { dir: tmp() });
  const uses = db.memoryFor("2026-11-11")!;
  expect(uses.kind).toBe("fsm");
  expect(db.memoryVersion(db.latestMemoryVersion()!)!.kind).toBe("fsm");
  expect(db.candidatesFor("2026-11-11")!.kind).toBe("fsm_candidates");
  expect(() => db.pinMemory("2026-11-11", db.candidatesFor("2026-11-11")!.version)).toThrow(/not an execution memory/);
  await pam.close();
});
it("밤 저장은 하나로 한다: 로봇 판본 뒤 후보 판본 저장이 실패하면 둘 다 없고 다음 날은 전날 기억, 반성 기록은 실패다. 검사 파일 쓰기가 실패해도 기억과 반성 기록 checks는 남는다", async () => {
  const pam = await startFakePamLlm({ chunk: oneChunkPerLine, reflect: () => CANDIDATES_ASK_THEN_CLEAR, check: () => ({ ok: true, items: [] }), mark: markLeaveAt("08:00:00") });
  const db = HistoryDb.open(":memory:");
  for (const d of ["2026-11-10", "2026-11-11"]) leaveAndAnswer(db, d, "08:00:00", "08:01:30", "clear");
  await runNight(db, pamClientFor(pam), "2026-11-10", { dir: tmp() });
  const before = db.memoryFor("2026-11-12")!.version;
  const save = db.saveMemory.bind(db);
  db.saveMemory = (m) => { if (m.kind === "fsm_candidates") throw new Error("disk full"); return save(m); };
  const failed = await runNight(db, pamClientFor(pam), "2026-11-11", { dir: tmp() });
  expect(failed.ok).toBe(false);
  expect(db.memoryFor("2026-11-12")!.version).toBe(before);
  db.saveMemory = save;
  const dir = tmp();
  const ok = await runNight(db, pamClientFor(pam), "2026-11-11", { dir, writeFile: () => { throw new Error("disk full"); } });
  expect(ok.ok).toBe(true);
  expect(db.memoryFor("2026-11-12")!.version).toBeGreaterThan(before);
  expect(db.list({ kinds: ["reflection"], limit: 5 }).at(-1)!.data).toMatchObject({ ok: true, checks: expect.arrayContaining([expect.objectContaining({ action: "컵 치우기", passed: true })]) });
  await pam.close();
});
it("「두세요」 답·아무 일 없음은 따라오지 않은 것, 안 보인 창은 못 봄", async () => {
  const db = HistoryDb.open(":memory:");
  leaveAndAnswer(db, "2026-11-10", "08:00:00", "08:01:30", "keep");
  expect(answerActions(db, "2026-11-10")).toEqual([]);
  expect(answerTimes(db, "2026-11-10", "컵 치우기")).toEqual([t("08:01:30")]);   // 답은 본 것: 떠나서 안 보였어도 n
  leaveAndAnswer(db, "2026-11-11", "08:00:00", "08:01:30", "clear");
  expect(answerActions(db, "2026-11-11")).toEqual([{ action: "컵 치우기", times: [t("08:01:30")] }]);
});
it("시각 찾기는 날마다 모르는 (상태, 후보)·행동만 묻고, 덩어리 기록에 사람 상태가 붙는다", async () => { /* 가짜 PAM이 받은 요청 본문으로 확인 */ });
```

```ts
// tests/pam-marks.test.ts (석준 님 validate_chunks·validate_marks 경우)
it("덩어리는 시각 순서로 겹치지 않고 기록 줄의 시각만, 시각 찾기는 물은 것을 꼭 한 번씩 답한다", () => {
  expect(() => validateChunks({ chunks: [{ start: "07:00:02", end: "07:00:00", text: "x" }] })).toThrow(/end must not come before start/);
  expect(() => validateChunks({ chunks: [{ start: "07:00:01", end: "07:00:03", text: "x" }] }, ["07:00:00", "07:00:10", 2])).toThrow(/not the time of a line/);
  expect(() => validateMarks({ candidates: [], actions: [], unseen: [] }, [["drinking", "c"]], [])).toThrow(/answer every asked candidate exactly once/);
});
```

- [ ] **Step 2: 실패 확인** — `npm run heavy -- npx vitest run tests/pam-marks.test.ts tests/history-night.test.ts`. Expected: FAIL
- [ ] **Step 3: 구현** — `marks.ts`는 석준 님 `validate_chunks`·`validate_marks`를 글자 그대로 옮긴다(오류 글 영어 그대로). `chunking.txt`·`marking.txt`는 석준 님 글에서 집 설명·「상태」를 사람 활동 FSM 상태로, 후보를 `state | on (when)` 줄로 바꾼다. `runNight`는 「후보 FSM과 채택 검사」 절의 밤 흐름 차례이고, 저장은 `saveNight` 하나로 한다(실패면 `ok: false`, 저장된 것 없음, 반성 기록은 실패 줄 하나). 시각 찾기 결과에 행동 때로 `answerActions`를, 안 보인 구간으로 `robotSpans`를, `answered`로 `answerTimes`를 더한다. 끝내 실패면 저장하지 않고 `done(false, REFLECT_TEXT.rejected(까닭))`.
- [ ] **Step 4: 통과 확인** — `npm run heavy -- npx vitest run tests/pam-marks.test.ts tests/history-night.test.ts tests/history-reflect.test.ts tests/pam-adopt.test.ts tests/same-structure.test.ts`. Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(reflect): nightly chunks, marking and adoption check before the robot FSM; spoken clear answers count as followed"`

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

### Task 9: 합성 일주일·배운 뒤 기억 넣기·영상 확인·기록 정답·e2e

사용자 답: 기억은 합성 기록에서 나온 것이라 옮기지 않고 합성 데이터를 새 모양으로 다시 만든다. 합성 이야기는 「처음 이틀은 묻고 → 3일째부터 바로 치우기」다(2026-11-18 확정): 날마다 아침 커피 뒤 한 번 컵을 두고 떠나고, 1·2일째는 「사용자에게 물어보기」(답 「치워 주세요」 → 컵 치우기 실행), 둘째 밤 채택 검사를 지나 3일째부터 바로 「컵 치우기」다. 3~7일째 로봇이 바로 치운 창은 못 봄이라 셈이 늘지 않는다. 내용물은 실행 전 검사가, 시간 습관은 습관 거르기(`HabitFilter` 조건)가 맡는다. 치우기를 보는 시연·영상은 배운 뒤 기억으로 돈다(「시험·영상이 쓰는 기억」 절).

**Files:**
- Modify: `scripts/seed-history.ts:403-450,511-606` (`PAST_SEED` 지움, `SYNTH_CANDIDATES`·`weekMarks`, `memoryAfter`가 채택 검사로 정함, 합성 장면·판단 글)
- Modify: `scripts/demo-setup.ts` (`learned` 명령, `SEED_RULES` → 화살표)
- Modify: `scripts/video-check.ts` (`hasLearnedClear`, 실제 모드는 시작 때 오늘 기억 확인, `--fake`는 임시 runtime에 배운 뒤 기억, 시각표 머리에 기억 판본)
- Modify: `src/server/routes/brain.ts:54-60` (`/api/memory/day/<날>` 답 `uses.memory`)
- Modify: `scripts/twin3d/fake-run.ts` (판단 `fsm`)
- Test: `tests/seed-history.test.ts`, `tests/demo-setup.test.ts`, `tests/video-check.test.ts`, `tests/history-api.test.ts`, `tests/demo-e2e.test.ts`, `tests/fixtures/history-golden/*`(정답 다시 쓰기), `tests/goal-e2e.test.ts`

**Interfaces:**
- Consumes: Task 1 `LEARNED_FSM_MEMORY`·`saveLearned`, Task 1~8, Task 13 `checkCandidate`·`adoptedFsm`·`adoptKey`.
- Produces:
  - `SYNTH_CANDIDATES: CandidateFsm` — 합성 반성이 내는 후보 FSM(seed 모양 + 마시는 중 → `*` 컵 치우기 후보 하나(`on`은 seed 묻기 화살표와 같음) + 자리에 없음 → TV 보는 중 에어컨 켜기 후보 하나(`on`은 seed 진입 화살표 「사용자가 돌아와 TV를 본다.」와 같음)).
  - `weekMarks(n: number, which: "clear" | "aircon"): CheckDay[]` — 합성 n일치 채택 검사 입력(장면에서 바로 뽑음, 모델 안 부름).
    - `clear`: 후보 = 아침 커피 뒤 떠난 때, 행동 = 「치워 주세요」 답 때, `answered` = 1·2일째 답, 안 보인 구간 = 집에 없는 때 + 3일째부터 로봇이 치운 구간.
    - `aircon`: 후보 = 집에 돌아와 소파에 앉아 TV를 보기 시작한 때(자리에 없음에서), 행동 = 사람이 거실 에어컨을 켠 때(2·3일째), 안 보인 구간 = 집에 없는 때 + 로봇이 거실 에어컨을 켠 구간(1일째 「아 덥다」, 4일째부터 배운 화살표).
  - `memoryAfter(i, h): FsmMemory` — i번째 날(0부터) 밤 반성이 남기는 로봇 FSM = `adoptedFsm(SYNTH_CANDIDATES, 통과한 후보, CUP_FSM_MEMORY)` + 설명. 통과는 `checkCandidate(weekMarks(i + 1, …)).passed`. 컵: 1일째 seed, 2일째 `memoryAfter(0)`(묻기), 3일째부터 치우기. 에어컨: 4일째(`memoryAfter(2)`)부터 말없이 켬. `habit` 칸은 없앤다(채택 검사가 정한다).
  - `demo-setup.ts learned [--dir runtime/demo/day1]` — 서버를 끈 채 `saveLearned(db, 오늘)`(배운 뒤 기억을 오늘 판본으로, 오늘 고정을 바꿈)과 반성 줄(`data.synthetic = true`). 서버 잠금이 잡혀 있으면 멈춘다(지금 `reflect --scripted`와 같은 잠금).
  - `hasLearnedClear(memory: unknown): boolean`(`scripts/video-check.ts`) — 새 모양이고 마시는 중에서 나가는 컵 치우기 화살표가 있다.
  - `/api/memory/day/<날>` 답 `uses.memory` — 그날 쓰는 기억 JSON.

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
// tests/seed-history.test.ts (seedWeek·HOME은 이 파일의 지금 도우미·집 자료)
it("합성 일주일: 상태는 seed 넷, 떠날 때 1·2일째는 묻고 둘째 밤 채택 검사를 지나 3일째부터 치운다. 로봇이 치운 날은 못 봄이라 셈이 그대로다", () => {
  const db = seedWeek();
  for (const v of db.memoryVersions()) {
    expect(isOldFsm(v.memory)).toBe(false);
    expect((validateMemory(v.memory, "fsm") as FsmMemory).states.map((s) => s.id)).toEqual(["drinking", "watching_tv", "cooking", "away"]);
  }
  const leave = (m: FsmMemory) => m.states.find((s) => s.id === "drinking")!.next.find((e) => e.to === ANY_STATE)!.action;
  // n일째 쓰는 기억: 1일째 seed, n일째(n ≥ 2)는 (n-1)번째 밤이 남긴 memoryAfter(n - 2)
  const used = [CUP_FSM_MEMORY, ...[0, 1, 2, 3, 4, 5].map((i) => memoryAfter(i, HOME))];
  expect(used.map(leave)).toEqual(["사용자에게 물어보기", "사용자에게 물어보기", "컵 치우기", "컵 치우기", "컵 치우기", "컵 치우기", "컵 치우기"]);
  expect(memoryAfter(1, HOME).states.map((s) => s.next)).toEqual(LEARNED_FSM_MEMORY.states.map((s) => s.next));
  // 하루 한 번 떠남: 1·2일째 「치워 주세요」 답(따라옴), 3일째부터 로봇이 바로 치움(못 봄)
  const nights = [1, 2, 3, 4, 5, 6, 7].map((n) => checkCandidate(weekMarks(n)));
  expect(nights.map((r) => r.passed)).toEqual([false, true, true, true, true, true, true]);
  expect(nights.map((r) => [r.n, r.k, r.unknown])).toEqual([[1, 1, 0], [2, 2, 0], [2, 2, 1], [2, 2, 2], [2, 2, 3], [2, 2, 4], [2, 2, 5]]);
  // 합성 판단도 쓰는 기억을 따른다(날마다 마시는 중에서 떠나는 판단 하나)
  const leaves = db.list({ kinds: ["decision"], limit: 5000 }).filter((r) => (r.data as { fsm?: FsmStep | null }).fsm?.from === "drinking" && (r.data as { fsm: FsmStep }).fsm.to === ANY_STATE);
  expect(leaves.map((r) => r.text)).toEqual(["사용자에게 물어보기", "사용자에게 물어보기", "컵 치우기", "컵 치우기", "컵 치우기", "컵 치우기", "컵 치우기"]);
});
it("합성 일주일 말없이 에어컨(데모 「2-습관」): 1일째 「아 덥다」는 로봇이 켜서 못 봄, 2·3일째 사람이 켬, 셋째 밤 통과해 4일째부터 말없이 켠다. 덥다·부채질 화살표는 날마다 그대로다", () => {
  const db = seedWeek();
  const HOT = CUP_FSM_MEMORY.states.find((s) => s.id === "watching_tv")!.next[1]!;
  const tv = (m: FsmMemory) => m.states.find((s) => s.id === "watching_tv")!.next;
  const away = (m: FsmMemory) => m.states.find((s) => s.id === "away")!.next;
  const used = [CUP_FSM_MEMORY, ...[0, 1, 2, 3, 4, 5].map((i) => memoryAfter(i, HOME))];
  expect(used.map((m) => away(m).some((e) => e.to === "watching_tv" && e.on === TV_START_ON && e.action === "에어컨 켜기"))).toEqual([false, false, false, true, true, true, true]);
  expect(used.every((m) => tv(m).some((e) => e.on === HOT.on && e.action === "에어컨 켜기"))).toBe(true);
  const nights = [1, 2, 3, 4, 5, 6, 7].map((n) => checkCandidate(weekMarks(n, "aircon")));
  expect(nights.map((r) => r.passed)).toEqual([false, false, true, true, true, true, true]);
  expect(nights.map((r) => [r.n, r.k, r.unknown])).toEqual([[0, 0, 1], [1, 1, 1], [2, 2, 1], [2, 2, 2], [2, 2, 3], [2, 2, 4], [2, 2, 5]]);
  // 합성 판단: 1일째 덥다 화살표(정한 습관), 4일째부터 자리에 없음 → TV 보는 중 진입 화살표(배운 것)
  const airs = db.list({ kinds: ["decision"], limit: 5000 }).filter((r) => r.text === "에어컨 켜기").map((r) => (r.data as { fsm: FsmStep }).fsm.on);
  expect(airs).toEqual([HOT.on, TV_START_ON, TV_START_ON, TV_START_ON, TV_START_ON]);
  // 배운 뒤에도 TV 앞에서 마시다 떠나면 묻는다(사용자 답 2026-11-19)
  expect(tv(memoryAfter(5, HOME)).find((e) => e.to === ANY_STATE)!.action).toBe("사용자에게 물어보기");
});
```

```ts
// tests/demo-setup.test.ts (run·tmp 폴더는 이 파일의 지금 도우미)
it("learned는 서버를 끈 채 배운 뒤 기억을 오늘 판본으로 넣고 오늘 고정을 바꾼다", async () => {
  await run(["day1", "--dir", dir]);
  await run(["learned", "--dir", dir]);
  const db = HistoryDb.open(join(dir, "noonchi.db"), 540);
  const today = db.dayOf(Date.now());
  expect(db.memoryVersion(db.pinnedMemory(today)!)!.memory).toEqual(LEARNED_FSM_MEMORY);
  db.close();
});
```

```ts
// tests/video-check.test.ts
it("배운 컵 치우기 화살표가 있는 기억만 영상을 튼다(seed·옛 모양이면 멈춘다)", () => {
  expect(hasLearnedClear(LEARNED_FSM_MEMORY)).toBe(true);
  expect(hasLearnedClear(CUP_FSM_MEMORY)).toBe(false);
  expect(hasLearnedClear({ initial_state: "drinking", states: [{ id: "left_cup", description: "d", rules: [{ trigger: "t", action: "컵 치우기" }], next: [] }] })).toBe(false);
});
```

`tests/history-api.test.ts`: `/api/memory/day/<날>`의 `uses.memory`가 그날 판본 기억이다. `tests/demo-e2e.test.ts`:
- 장면 1은 `day1` 뒤 `learned`로 돌고 판단 사건이 `fsm: { learned: true }`, 메시지 상자 「컵을 두고 자리를 뜨면 치워도 된다고 하셨어요」 → 「…컵을 치울게요.」, 첫 명령 「식탁으로 가 주세요」.
- 새 장면 「1-묻기」(`day1`만, seed): 사람이 컵을 두고 떠나면 메시지 상자 「컵을 치울지 여쭤볼게요.」(허락 문장 없음), 폰에 「컵을 치울까요?」, 「치워 주세요」 답 뒤 첫 명령 「식탁으로 가 주세요」, 목표 기록 없음.
- 장면 4(합성 7일 반성 뒤 말없이 에어컨)는 밤마다 채택 검사를 거친다: 가짜 PAM 시각 찾기 답은 `weekMarks`와 같은 시각(시험 도우미)이고, 7일 판본에서 자리에 없음 → TV 보는 중 진입 화살표에 에어컨 켜기가 붙어 있으며, 말없이 TV를 보면 그 화살표로 켠다(`fsm: { from: "away", learned: true }`, 첫 판단은 직전 상태를 처음 상태로 본다). 덥다·부채질 화살표는 seed 그대로다.

- [ ] **Step 2: 실패 확인** — `npm run heavy -- npx vitest run tests/seed-history.test.ts tests/demo-setup.test.ts tests/video-check.test.ts`. Expected: FAIL
- [ ] **Step 3: 구현**

```ts
// scripts/seed-history.ts
const LEAVE_ON = CUP_FSM_MEMORY.states.find((s) => s.id === "drinking")!.next.find((e) => e.to === ANY_STATE)!.on;
/** 데모 「2-습관」: 말없이 TV를 보기 시작하면 에어컨(배우는 습관, 사용자 답 2026-11-19). 자리에 없음 → TV 보는 중 seed 진입 화살표의 on(「사용자가 돌아와 TV를 본다.」). */
export const TV_START_ON = CUP_FSM_MEMORY.states.find((s) => s.id === "away")!.next.find((e) => e.to === "watching_tv")!.on;
/** 합성 반성이 내는 후보 FSM: seed 모양에 마시는 중 → * 컵 치우기 후보 하나(seed 묻기 화살표와 같은 on). */
export const SYNTH_CANDIDATES: CandidateFsm = {
  initial_state: CUP_FSM_MEMORY.initial_state,
  states: CUP_FSM_MEMORY.states.map((s) => ({
    id: s.id, description: s.description, activity: [...s.activity],
    next: s.next.filter((e) => !e.action).map(({ to, on }) => ({ to, on })),
    rules: s.id === "drinking" ? [{ to: ANY_STATE, action: "컵 치우기", candidates: [{ on: LEAVE_ON }] }]
      : s.id === "away" ? [{ to: "watching_tv", action: "에어컨 켜기", candidates: [{ on: TV_START_ON }] }] : [],
  })),
};
const KEYS = { clear: adoptKey("drinking", "컵 치우기", { on: LEAVE_ON }), aircon: adoptKey("away", "에어컨 켜기", { on: TV_START_ON }) } as const;

/** i번째 날(0부터) 밤 반성이 남기는 로봇 FSM. 상태는 seed 넷 그대로이고 배우는 화살표는 채택 검사(Task 13)가 정한다:
 *  컵 치우기는 둘째 밤(i = 1)에 통과해 3일째부터, 말없이 에어컨은 셋째 밤(i = 2)에 통과해 4일째부터.
 *  시간 습관(평일 7시 커피, 밤에는 묻지 않기)은 설명에만 적는다. */
export function memoryAfter(i: number, h: Pick<HomeInfo, "table" | "side" | "livingAc">): FsmMemory {
  const passed = new Set((["clear", "aircon"] as const).filter((w) => checkCandidate(weekMarks(i + 1, w)).passed).map((w) => KEYS[w]));
  const m = adoptedFsm(SYNTH_CANDIDATES, passed, CUP_FSM_MEMORY);
  const state = (id: string) => m.states.find((s) => s.id === id)!;
  if (i >= 1) state("drinking").description += ` ${i >= 5 ? "평일 7시쯤, 주말 8시 40분쯤" : "평일 7시쯤"} 일어나 ${h.table.label}에서 커피를 마신다.`;
  if (i >= 1) state("away").description = `평일 8시 30분쯤부터 18시 30분쯤까지 사용자가 집에 없다.${i >= 4 ? " 금요일에는 21시쯤 돌아오기도 한다." : ""} 22시가 넘으면 폰으로 묻지 않기를 바란다.`;
  return validateMemory(m, "fsm") as FsmMemory;
}
```

합성 장면(`liveDay`)은 **마시는 중에서 떠나는 때가 날마다 아침 커피 뒤 한 번**이게 바꾼다(하루 두 번이면 첫 밤에 통과해 2일째부터가 된다, `weekMarks` 셈이 막는다):
- 아침(`morning`): 1일째의 첫 떠남(「거절」 뒤 돌아와 커피를 다시 따름)은 지운다(이것도 마시는 중에서 떠나는 때라 셈이 하나 더 는다). 1·2일째는 떠날 때 판단 「사용자에게 물어보기」 → 답 「치워 주세요」 → 컵 치우기 실행, 3일째부터 판단 「컵 치우기」(답 없음, 로봇이 바로 치움).
- 집 식사(`meal`, 평일 저녁·주말 점심과 저녁)는 마시는 중 상태를 거치지 않게 밖에서 먹고 들어오는 장면(`away`)으로 바꾼다.
- TV(`tv`)는 날마다 TV 보기 시작이 한 번이고 늘 집에 돌아온 바로 뒤다(자리에 없음 → TV 보는 중, 저녁은 밖에서 먹고 돌아온다, 일요일 낮 TV는 밖에 나간 장면으로 바꾼다). 1일째는 「아 덥다」 → 판단 에어컨 켜기(덥다 화살표, 정한 습관), 2·3일째는 앉은 뒤 20~60초 안에 사람이 거실 에어컨을 말없이 켜고 판단은 대기, 4일째부터 판단 에어컨 켜기(자리에 없음 → TV 보는 중 진입 화살표, 배운 것)로 로봇이 켜고 사람은 켜지 않는다.
- TV 보며 차(`tv` 차)는 TV 보는 중 상태라 컵 후보에 들지 않는다. 떠날 때 차 컵을 들고 침실로 가고(치우기 행동 아님) 판단은 대기다. 밤 23시에 컵이 남는 장면·「밤에는 묻지 마세요」 답은 지운다.
- 판단 글: 「left_cup 규칙대로」 → 「마시는 중에서 떠나는 화살표대로」, 「drinking 단계로 돌아와」 → 「마시는 중으로 돌아와」, 「watching_tv 규칙대로」 → 「TV 보는 중 화살표대로」. 그대로 두기를 고르던 판단은 대기.

`weekMarks(n, which)`는 이 장면에서 바로 뽑는다(Interfaces). `PAST_SEED`는 지운다(새 seed가 곧 배우기 전 기억이다).

데모 「2-습관」(사용자 답 2026-11-19 (나)): `seedHistory`의 `habit` 칸과 마지막 판본에 말없이 에어컨 규칙을 바로 쓰던 갈래를 지운다. 그 화살표는 위 채택 검사로만 들어간다. `DEMO_AIRCON_RULE`(`tests/helpers/pam.ts`)은 자리에 없음 상태의 화살표 `{ to: "watching_tv", on: TV_START_ON, action: "에어컨 켜기" }`로, `silentAircon`(`scripts/demo-setup.ts`)은 「자리에 없음의 `TV_START_ON` 에어컨 켜기 화살표가 있음」으로 바꾼다. `reflect --scripted`는 합성 마지막 판본(`memoryAfter(6)`, 배운 컵 치우기·배운 말없이 에어컨)을 오늘부터로 넣는다.

`scripts/demo-setup.ts`:
- `learned`: 위 Interfaces대로. 끝에 「배운 뒤 기억 <v>판을 <오늘>부터 쓰게 넣었어요」 한 줄.
- `SEED_RULES`는 `CUP_FSM_MEMORY.states.flatMap((s) => s.next.filter((e) => e.action).map((e) => ({ trigger: e.on, action: e.action! })))`, `rulesLine`은 `${x.from} → ${x.to}: ${x.on} → ${x.action}`.

`scripts/video-check.ts`:
- `hasLearnedClear(m)`: `!isOldFsm(m)`이고 `drinking` 상태에 `to: "*"`·`action: "컵 치우기"` 화살표가 있다.
- 실제 모드: 영상을 틀기 전에 `GET /api/memory/day/<오늘>`의 `uses.memory`를 본다. `hasLearnedClear`가 아니면 영상을 틀지 않고 끝 코드 1, 판정 줄 「오늘 기억에 배운 컵 치우기가 없어요. 서버를 끄고 npx tsx scripts/demo-setup.ts learned --dir <서버 RUNTIME_DIR>로 넣은 뒤 다시 켜 주세요」.
- `--fake`: 임시 runtime을 만든 뒤 서버를 띄우기 전에 `saveLearned`(오늘). 가짜 PAM은 받은 기억의 직전 상태에서 컵 치우기 화살표를 찾아 답한다(`tests/helpers/pam.ts`와 같은 규칙, 컵이 있고 사람이 안 보일 때).
- 시각표 머리에 「기억 <v>판 · <source>」 한 줄(어느 기억으로 돌았는지 남긴다).

`src/server/routes/brain.ts`: `uses`에 `memory: v.memory`를 더한다.

- [ ] **Step 4: 기록 정답·e2e** — `npm run heavy -- npx vitest run tests/demo-e2e.test.ts -u` 뒤 `git diff tests/fixtures`(판단 `fsm` 칸·반성 `learned` 모양·합성 기억만 바뀌고 메시지 상자 허락 문장·행동 줄은 그대로인지 본다), `npm run heavy -- npx vitest run tests/seed-history.test.ts tests/demo-setup.test.ts tests/video-check.test.ts tests/history-api.test.ts`, `npm run heavy -- npx vitest run tests/demo-e2e.test.ts`, `npm run heavy -- npx vitest run tests/goal-e2e.test.ts`, `npm run heavy -- npx tsx scripts/video-check.ts --fake <clip>`(배운 뒤 기억으로 통과, 시각표 머리 기억 판본). Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "chore(demo): rebuild the synthetic week on the adoption check, add the learned-memory setup and check it before video runs"`

---
### Task 10: 시간 줄 사람 줄에 사람 상태를 넘김 (화면은 `feat/fsm-card`)

대시보드 결정(2026-11-19): FSM 원 카드 대신 시간 줄(사람 · 예상 · 로봇)을 쓴다. 이 작업은 사람 줄 자료만 넘긴다. 로봇 줄 자료(로봇 실행 기계 전이, 계획 단계 구간)는 묶음 B가 넘긴다. 화면 부품·자리·글은 `feat/fsm-card`가 만든다. 그 갈래의 FSM 원 카드 자료(`HabitFsm`·`habitView`·`fsmViewOf`)는 이 계획이 바꾸지 않는다.

**Files:**
- Modify: `src/contract/events.ts`(대시보드 메시지 `person`), `src/brain/person.ts`(`PersonLane`), `src/server/home/act.ts`(판단 기록·World State 바뀜을 넘김), `ui/src/lib/messages.ts`(메시지 종류 표에 `person`)
- Test: `tests/brain-person.test.ts`, `ui/tests/messages.test.ts`

**Interfaces:**
- Consumes: Task 4 `FsmStep`·`stateOfWorld`·`isTempState`, Task 1 `FsmMemory`.
- Produces:
  - 대시보드 메시지 `{ type: "person"; state: string; name: string; since_ms: number; source: "decision" | "world"; decision_id: string | null }` — 사람 상태가 바뀔 때만 하나. `name`은 `FSM_STATE_TEXT[state]`(임시 상태는 `STATE_TEXT[값]`).
  - `class PersonLane { constructor(o: { emit: (m: PersonMessage) => void; memory: () => FsmMemory | null }); onDecision(r: DecisionRecord): void; onWorld(w: Pick<WorldView, "person">, atMs: number): void; last(): PersonMessage | null }` — 판단 기록의 `fsm.state`(PAM 답)와 판단 사이의 World State 하는 일(`stateOfWorld`)로 지금 사람 상태를 갖고, 같은 상태면 다시 내지 않는다. 늦은 답(`late`)·화살표 없는 판단의 같은 상태는 내지 않는다. 새로 붙은 대시보드에는 `last()`를 처음 메시지로 보낸다.

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
// tests/brain-person.test.ts
describe("시간 줄 사람 줄 자료", () => {
  const seen = (): PersonMessage[] => [];
  it("사람 상태가 바뀔 때만 person 메시지를 내고, 판단(PAM 답)과 World State 하는 일 둘 다에서 받는다. 늦은 답은 쓰지 않는다", () => {
    const out = seen();
    const lane = new PersonLane({ emit: (m) => out.push(m), memory: () => LEARNED_FSM_MEMORY });
    lane.onWorld(person({ facts: act("drinking") }), 1_000);
    lane.onWorld(person({ facts: act("drinking") }), 2_000);
    lane.onDecision(decisionWith({ id: "pam-1", at_ms: 3_000, fsm: { state: "away", from: "drinking", next_index: 0 } }));
    lane.onDecision(decisionWith({ id: "pam-2", at_ms: 4_000, late: true, fsm: { state: "drinking", from: null, next_index: -1 } }));
    lane.onWorld(person({ facts: act("reading") }), 5_000);
    expect(out.map((m) => [m.state, m.name, m.since_ms, m.source, m.decision_id])).toEqual([
      ["drinking", "먹거나 마시는 중", 1_000, "world", null],
      ["away", "자리에 없음", 3_000, "decision", "pam-1"],
      ["~reading", STATE_TEXT.reading, 5_000, "world", null],
    ]);
    expect(lane.last()).toMatchObject({ state: "~reading" });
  });
});
```

(`person`·`act`는 Task 4 이 파일의 도우미, `decisionWith`는 판단 기록 도우미다.)

```ts
// ui/tests/messages.test.ts
it("사람 줄 메시지도 받는다(받지 않으면 시간 줄 사람 줄이 비어 있다)", () => {
  expect(parseMessage('{"type":"person","state":"drinking","name":"먹거나 마시는 중","since_ms":1,"source":"world","decision_id":null}')?.type).toBe("person");
});
```

- [ ] **Step 2: 실패 확인** — `npm run heavy -- npx vitest run tests/brain-person.test.ts`, `npm run heavy -- npm --prefix ui test`. Expected: FAIL
- [ ] **Step 3: 구현** — `PersonLane`을 위 Interfaces대로 `src/brain/person.ts`에 두고, 서버(`src/server/home/act.ts`)는 판단 기록(`onDecision`)과 World State 바뀜(사람 사실이 바뀐 changes)을 넘기며 대시보드 묶음(`emit`)으로 보낸다. 대시보드가 새로 붙으면 `last()`를 먼저 보낸다(지금 `goal` 메시지와 같은 자리). `ui/src/lib/messages.ts`의 `KNOWN`에 `person: true`. 화면 그리기는 하지 않는다(`feat/fsm-card`).
- [ ] **Step 4: 통과 확인** — `npm run heavy -- npx tsc --noEmit -p .`, 위 두 시험, `npm run heavy -- npm --prefix ui run build`, `npm run heavy -- npm run lint`. Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(dashboard): send person-state lane data for the timeline"`

---
### Task 11: 문서·SSOT

**Files:**
- Modify: `docs/reference.md`(판단·목표·반성 줄), `docs/pam-interface.md`(`pam-predict/3`·`pam-reflect/3`, 「박석준과 맞출 것」), `src/brain/pam/README.md`(표의 기억 모양 줄)
- Modify (docs 저장소): `01_Product/구현명세서 SSOT.md` 5.9 Rule·5.10 Decision·6.3 PAM 판단·미리 세운 목표·6.12 PAM, `변경이력.md`

- [ ] **Step 1:** 이 저장소 문서 셋을 위 「새 기억 모양」·「PAM 판단 답」 절 그대로 고친다(판단 답 칸, 서버가 행동을 만든다, 거꾸로 찾기 없음, 안 하기는 화살표 없음, 옛 기억 읽기).
- [ ] **Step 2:** SSOT: 이 문서의 「사람 FSM 만드는 규칙」 절(검사 셋·흐름 포함), 「후보 FSM과 채택 검사」 절, 사용자가 정한 습관·배우는 습관(컵 치우기)·배운 뒤 기억으로 도는 시연·영상(`demo-setup.ts learned`)을 6.12 PAM 앞에 같은 글로 두고, 5.9 Rule을 「화살표(상태·트리거·조건 → 행동)」로, 5.10 Decision에 `state`·`from`·`next_index`·`fsm`(FsmStep), 6.3 PAM 판단 출력과 seed FSM 설명, 미리 세운 목표 문단(지금 상태에서 나가는 화살표), 6.12 계약 이름. 판을 1.27에서 1.28로 올리고 `변경이력.md`에 한 줄.
- [ ] **Step 3:** `npm run heavy -- npm run lint`, 전체 시험 `npm run heavy -- npx vitest run`(부하 실패는 따로 다시).
- [ ] **Step 4: 커밋** — 이 저장소 `git commit -m "docs: person-state FSM memory, pam-predict/3 and goals"`, docs 저장소 `git commit -m "docs: 구현명세서 SSOT 1.28 (사람 상태 FSM), 변경이력"`.

---

## 속도 영향 (2026-11-18 d1·59447ec 영상 기준)

| 무엇 | 지금 | 바꾼 뒤 | 까닭 |
|---|---|---|---|
| 사람 떠남 → 첫 명령 | 유리컵 3.1초·키 큰 컵 1.9초·머그 1.6초 | 같음, 묶음마다 3.3초 안·+0.3초 안 | 묶음 A: 같은 길(PAM 확인 한 번 + 미리 만든 계획). B: 토픽 내기만. C·D·E: 같은 프로세스 함수 부르기(새 기다림 없음). F: 판단 → 관리자 → 로봇 → 폰 토픽 두 번 더 지남(RedisBus 한 번 1~3ms, 예산 50ms) |
| 배우기 전(1·2일째) 떠남 → 첫 폰 출력 | (지금 seed는 바로 치우기) | 「컵을 치울까요?」 질문. 치우기 첫 명령은 「치워 주세요」 답 뒤, 미리 만든 계획 없음 | 사용자 답: 컵 치우기는 배우는 습관. 3일째부터는 지금과 같은 길(목표·미리 만든 계획) |
| 목표가 서는 때 | 4.2~4.5초 | 같음 | 상태를 World State 하는 일(마시는 중)로 바로 정한다. PAM 답만 기다리면 첫 판단(7.3·7.5·12.1초)까지 3~8초 늦다 |
| 처음 상태가 다를 때 목표 | 못 세움(직전 맞은 규칙이 `watching_tv`면) | 세움 | 상태마다 나가는 화살표를 본다 |
| PAM 판단 한 번 | 1.6~2.4초 | 약 +0.05초 안 | seed 기억 JSON 3,267 → 약 2,665바이트(물건 조건·「그대로 두기」가 빠지고 떠날 때 행동이 묻기, 배운 뒤 기억 약 2,650바이트), 바뀐 프롬프트 문장 약 +1KB, 판단 입력 약 16.3 → 16.7KB(+2%). 출력은 `state`·`from`·`next_index` 약 15토큰 늘고 `task_index`는 빠진다 |
| 밤 한 번(반성) | 하루 한 번 PAM 반성 1번 | 덩어리 기록 1번 + 반성 1번 + 뜻 검사 1번(거절이면 반성·검사 한 번 더) + 시각 찾기(지난 날 가운데 모르는 것만, 날마다 1번) + 채택 검사(계산) | 밤 한 번만 늘고 판단 속도에는 영향 없음 |
| 비상 → 로봇 멈춤 | 다음 판단이 바꿀 때까지(5초 안팎) | 한 tick(250ms) 안 | 묶음 C |
| 쓰러짐 의심 → 비상 | 바로(쓰러짐 의심 = 비상) | 말 답이 없으면 약 21초 뒤(가기 빼고), 도움 말이면 바로 | 사용자 결정: 가서 묻고 답이 없으면 올림. 그사이 하던 일은 멈춰 있다 |
| 화면 알약 | 「규칙 여럿」·「상태 모름」이 뜸 | 늘 상태 하나, 켠 화살표 하나 또는 화살표 없음 | 거꾸로 찾기를 없앤다 |
| 시간 줄 자료(대시보드 메시지 `person`·`robot`) | 없음 | 사람 상태·로봇 기계 상태가 바뀔 때만 한 줄 | 판단·명령 길에 기다림이 없다(보내기만) |

## 팀 영향: PAM을 맡은 팀원(박석준)이 보는 곳

1. 기억 모양과 코드 검사: `src/brain/decision.ts` `FsmMemory`·`validateMemory`(상태 안 `rules` 없음, `activity`, 화살표 `when`·`action`, `"*"`, 같은 (출발·사건·조건) 거절, 목록 밖·안 하기 행동 거절, 상태 12개, `away` 처음 상태). 「사람 FSM 만드는 규칙」 절이 기준이다.
2. 판단 계약 `pam-predict/3`: 요청 `last_state`, 답 `state`·`from`·`next_index`(`task_index` 칸 없음, 서버가 만든다). 답 검사 `validateFsmPrediction`.
3. 반성 계약 `pam-reflect/3`과 반성 흐름: 후보 FSM 모양(`memory_kind: "fsm_candidates"`, `validateCandidateFsm`)을 내고, 로봇 FSM은 채택 검사를 지난 후보로 서버가 만들며, 뒤에 코드 검사·뜻 검사(`PamClient.checkMemory`, `memory_check.txt`)가 붙으며, 거절이면 까닭이 피드백으로 한 번 더 온다. 프롬프트 바꿈은 `scenario.json`에만 있다.
4. 습관 거르기 자리 `HabitFilter`는 석준 님 채택 검사(`src/brain/pam/adopt.ts`)가 채운다. 시간·요일 같은 조건은 FSM `when`이 아니다.
4-1. **석준 님과 맞출 목록**(석준 님 FSM은 아직 상태 안 규칙 모양 `rules[{triggers, action}]`):
   - 후보 FSM 모양: 행동 화살표 `rules[{to, action, candidates[{on, when?}]}]` + 행동 없는 `next[{to, on}]`, 상태에 `activity`, 처음 상태 `away`.
   - 로봇 FSM 만들기: 통과 후보를 " or "로 잇지 않고 후보마다 화살표 하나(PAM 답이 화살표 번호로 가리킴). 사용자가 정한 습관 화살표는 검사 없이 늘 둠. 배우는 행동은 컵 치우기·에어컨 켜기(말없이 TV 보기 시작)이고, 통과 후보가 같은 트리거의 seed 묻기 화살표는 그 자리에서 바꾸며 정한 습관 화살표(덥다·부채질 → 에어컨 등)는 바꾸지 않음.
   - 셈하기: 행동 때에 「로봇이 물었을 때 그 일을 해 달라고 답한 때」를 더함(「두라」 답은 안 더함). 로봇이 그 일을 한 구간은 안 보인 구간에 더해 못 봄, 답이 있는 창은 본 것(`CheckDay.answered` 한 칸 더함).
   - 시각 찾기 입력: 상태 = 사람 활동 FSM 상태(판단 기록 `fsm.state`), 후보 줄 = `state | on (when)`, 기록 = 덩어리 기록 + 관찰 텍스트 줄.
   - 숫자는 그대로(75%, p < 0.001, p0 바닥 0.01, 창 300초, 같은 후보 10초 안 한 번).
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
| 합성 이야기 | 바뀐 이야기(떠나면 처음엔 묻고 → 채택 검사가 통과한 날부터 바로 치우기, 계산으로 3일째) | Task 9 |
| 안전 「의심」 | 가서 「괜찮으세요?」를 묻고 말 답이 없으면 비상으로 | 「쓰러짐 확인」, 묶음 C |
| 로봇 실행 기계 상태 화면 | 보이지 않음 → 2026-11-19 대시보드 결정으로 바뀜: 시간 줄 로봇 줄로 보임(계획 단계 구간) | 정한 것 15, 묶음 B 대시보드 `robot` 메시지, 화면은 `feat/fsm-card` |
| 묶음 F | `refactor/stage-queue` 묶음 3·4 뒤 | 작업 묶음 표 |
| 말 부탁과 손대는 단계 | 그 단계 뒤로 미룸 | 관리자 |
| 말 대화 답 | 로봇 실행 기계 밖 | 「실제 폰 명령은 로봇 실행 기계 하나만」 |
| 뜻 검사 모델 | PAM LLM 그대로 | Task 7 |

## 사용자 답 (채택·배우는 습관, 2026-11-18)

| 물음 | 답 | 계획에서 |
|---|---|---|
| 합성 이야기 날 | 「처음 이틀은 묻고 → 3일째부터 바로 치우기」(채택 검사로 센 날) | 정한 것 13, 「합성 이야기 날짜 계산」, Task 9 |
| 로봇이 습관대로 이미 한 때 | 셈에서 뺌(못 봄). 로봇이 한 일이 스스로 습관을 굳히지 않게 | 정한 것 20, 「셈하기」, Task 13·14 |
| 사용자가 정한 습관 | 물 채우기·콜라·에어컨·코치는 채택 검사 없이 늘 로봇 FSM | 정한 것 23, `adoptedFsm`, `settingsGuard` |
| 배우는 습관 | 컵 치우기 하나. seed에서 빼고 처음엔 묻기, 채택 검사를 지난 뒤에만 로봇 FSM(2026-11-19에 말없이 TV 보기 시작 → 에어컨을 더함, 아래 표) | 정한 것 24, seed, Task 1·13 |
| 화면·영상 시험 기억 | 배운 뒤(3일째 이후) 기억으로 | 「시험·영상이 쓰는 기억」, Task 3·9 |
| 목표 미리 세우기 | 배운 화살표에서만 | 정한 것 25, Task 5 |

## 사용자 답 (2026-11-19)

| 물음 | 답 | 계획에서 |
|---|---|---|
| 데모 「2-습관」 | (나) 「말없이 TV 보기 시작 → 에어컨」을 배우는 습관에 더함(채택 검사 거침). 덥다·부채질 → 에어컨은 정한 습관 그대로. 합성 일주일 셈도 시험으로 | 정한 것 24, 「말없이 에어컨 날짜 계산」(4일째부터), Task 1·6·9·13 |
| 배우기 전 떠날 때 메시지 상자 | 「컵을 치울지 여쭤볼게요」(로봇 말, 허락 문장 아님). 배운 뒤는 「컵을 두고 자리를 뜨면 치워도 된다고 하셨어요」 → 「컵을 치울게요」 | 정한 것 26, Task 4 |
| TV 보며 마시다 떠날 때 | 배운 뒤에도 물음. 식탁은 바로 치우고 TV 앞은 묻는 차이를 시험 하나로 | 정한 것 27, Task 3 시험 |
| 말없이 에어컨 시작 날 | 4일째부터(1일째 「아 덥다」는 로봇이 켜서 못 봄) | 정한 것 28, 「말없이 에어컨 날짜 계산」, Task 9 시험 |

## 남은 물음

없음.
