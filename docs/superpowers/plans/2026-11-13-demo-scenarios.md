# 시연 시나리오 넷과 눈치·코치 자동 판단 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발표 영상 하나로 네 장면을 잇는다. 눈치 모드 ① 첫날: 상황 파악(빈 컵 치우기·남은 컵 그대로 두기)과 의도 파악(「아 덥다」 → 에어컨 켜기), ② 일주일 뒤: 일주일 기록을 날마다 반성해 배운 습관으로 말하기 전에 에어컨 켜기. 코치 모드 ③ 노인 전자레인지 쓰는 법 가이드, ④ 탈시설 장애인 라면 끓이기 가이드. 돕는 방식은 「자동」으로 두고, 판단마다 눈치인지 코치인지가 생각 말풍선 칩에 보인다.

**Architecture:** 구조는 그대로다. 「자동」이면 PAM에 눈치·코치 행동을 모두 보내고 FSM 기억이 고른다. 화면의 「눈치·코치」 칩은 고른 행동의 종류(`TaskSpec.coach`)를 그대로 보일 뿐 판단하지 않는다. 일주일은 합성 관찰 기록(`scripts/seed-history.ts`)으로 만들고, 반성은 실제 PAM으로 하루씩 일곱 번 이어 돌린다(1~6일은 녹화 전에, 7일은 녹화 중에). 새 기억은 다음 날부터 쓰는 규칙 그대로다. 반성 뒤에는 거르기 자리 둘을 둔다: 코치 규칙을 seed 그대로 지키는 검사(이 계획), 박석준의 p값 습관 후보정(자리만).

**Tech Stack:** Node 22 TypeScript 서버, SQLite 기록 DB, PAM 서비스(Python FastAPI, `services/pam/`), zod, Vitest, React(`ui/`), 가짜 OpenAI 호환 서버·시험용 PAM 자리, 영상 판정(`scripts/video-check.ts`).

**Spec:** 허정오 시연 시나리오(2026-11-13): 「[눈치 모드] 1. 첫 일주일: 상황 파악 후 작업 처리, 의도 파악 후 작업 처리 2. 일주일 후: 사용자의 습관과 학습한 선제적 행동 [코치모드] 3. 탈시설 장애인을 위한 가이드 모드 4. 가정 내 노인분들 위한 뭔가?」, 「눈치모드로 동작할지 코치모드로 동작할지 알아서 판단하는 것도 의미가 있을듯」, 「일주일 뒤에도 습관 기반 행동하는 것도 눈치 모드야」, 「3번 4번 순서를 바꿔줘」(코치 모드는 3. 노인, 4. 탈시설 장애인 순서). 아래 「정한 것」은 사용자가 모두 추천안으로 정했다(2026-11-13). 회의록 2026-11-12(눈치코치, PAM 매일 반성 후 다음 날 적용, p값 후보정, 기본 동작, ThinQ 사용설명서), 2026-11-09(가이드 모드). 구현 뒤 `docs` 저장소 `01_Product/구현명세서 SSOT.md`(돕는 방식·반성·시연)와 `변경이력.md`를 고친다.

**먼저 된 것:** 같은 브랜치의 `2026-11-13-cup-branches.md` Task 1~10, `2026-11-13-coach-mode.md` Task 1~13과 Codex 고침(`c224568`·`fec2e7d`·`cc3cc17`·`f267e6c`·`f83b0b0`·`b723636`)과 서버 글 구조 T1~T4(`c22ca2b`·`f7814fa`·`c6740e6`·`79ff269`). 코치 계획 Task 14 Step 1(영상 판정에 말 넣기 `--say`)은 아직 없어 이 계획 Task 9로 옮겼다.

## 정한 것 (사용자, 2026-11-13)

1. 의도 파악 장면은 「아 덥다」 → 에어컨 켜기.
2. 배울 습관은 TV를 보러 소파에 앉으면 거실 에어컨 켜기.
3. 일주일 반성은 실제 PAM으로 돌리고, 에어컨 습관이 안 나오면 대본 판본으로 찍고 영상 자막에 「합성 기록으로 만든 습관」을 단다.
4. 반성 지시문은 지금 우리 행동 이름·가전 습관에 맞게 바꾼다. 박석준에게 바꾼 내용을 알린다.
5. 새 설정의 돕는 방식 기본값은 「자동」. 옛 설정 파일은 그대로 눈치.
6. 노인 시나리오는 전자레인지로 데우기 알려 주기.
7. 전자레인지는 이 저장소 `added_devices.json`을 장면을 읽을 때 더한다.
8. 습관 거르기 자리는 TS 함수(`HabitFilter`)로 두고 박석준이 채운다.
9. 「습관」 칩은 그 행동에 seed에 없는 규칙이 하나라도 있으면 붙는다(Task 2: 행동 이름만으로는 어느 규칙인지 못 가려 행동 단위로 본다).
10. 시연 폴더에 첫 승인을 미리 넣는다.

## 조사한 사실 (2026-11-13, `feat/coach-cup` 79ff269)

**돕는 방식**
- `AssistMode = "noonchi" | "coach"`, 설정 3단계 「돕는 방식」에서 고른다(`ui/src/setup/ModeStep.tsx`). PAM에 보내는 목록은 `tasksFor(assist)`(`src/act/tasks.ts`).
- 판단 기록에는 그때 보낸 목록(`d.tasks`)이 남고, 계획 전·실행 전 검사가 그 목록을 쓴다. 코치 계획이 열려 있으면 PAM을 쉰다(`tracker.coaching()`).

**반성과 기억 판본**
- 반성은 `REFLECT_AT` 또는 `POST /api/reflection/run {day}`로 돈다. 그날 하루 요약(`daySummary(day)`) + 그날 기억 + 피드백 → `pam-reflect/2` → 새 판본, **다음 날부터** 쓴다. 다음 날이 이미 판본을 고정했으면 그다음 날로 밀린다(`src/history/reflect.ts`).
- 그날 기억은 판단 호출이 처음 부를 때 고정된다(`memoryForDay` → `pinMemory`). 판단 호출은 폰 사진이 올 때만 돈다. 그래서 폰을 켜기 전에 어제를 반성하면 새 판본이 오늘 판단에 쓰인다. 고정 상태를 밖에서 읽는 API는 없다.
- `scripts/seed-history.ts`는 PAM 없이 7일치 합성 기록과 대본 기억 판본(`memoryAfter`, `source: "synthetic"`)을 넣는다. `memoryAfter`는 옛 컵 FSM 기준이라 컵 갈래·요리 상태가 빠져 있다. 저녁마다 사람이 TV를 보며 거실 에어컨을 스스로 켜는 기록은 이미 있다.
- **논문 반성 지시문은 집기·놓기만 배우게 한다.** 행동 형식 `Pick up <object> and place it <location>.`(`reflector_fsm_update.txt` 82~85행), 목표 줄(10~12행), 「사람이 한 집기·놓기를 먼저 다시 적고 그것으로 규칙을 만든다」(46~50행), 「집기·놓기를 보면 규칙을 더한다」(61~63행). `scenario.json`은 이 줄들을 바꾸지 않는다. `pam-reflect/2`에는 행동 목록 칸이 없다.
- 반성 사건은 `start.ts`가 바로 방송하고, 새로 붙은 대시보드에는 다시 보내지 않는다. 대시보드에 반성 결과를 보이는 자리가 없다.
- 생각 말풍선 칩 「상태 · …」는 `decision.fsm`(`fsmRuleOf`)에서 온다. **같은 행동이 규칙 여러 개에 있으면 `fsmRuleOf`가 null을 돌려준다**(`src/brain/decision.ts`). seed 「덥다 → 에어컨」과 배운 「TV 보러 앉음 → 에어컨」이 함께 있으면 상태 칩이 사라진다. PAM 답에는 어느 규칙인지가 없다.

**사람 단계 글은 서버가 만든다(T1~T4: c22ca2b·f7814fa·c6740e6·79ff269)**
- 사람 단계(go·pick·place·do)는 모델이 `{kind, target, act, item?}`만 고른다. 단계 이름·폰 명령은 서버 글 틀 `STEP_TEXT`(`src/plan/labels.ts`)가 `${kind}:${act}`와 대상 이름(평면도 종류 짧은 이름, 없으면 낱말 표 이름·가전 종류 이름)·물건 이름(item)으로 만든다. 모델이 쓴 문장은 폰으로 나가지 않는다.
- 동작(`STEP_ACTS`): go 가기 / pick 들기·꺼내기·내리기 / place 넣기·올리기·놓기 / do 따르기·물 받기·넣기·젓기·열기·닫기·켜기·끄기. item은 낱말 표 물건 이름과 `EXTRA_ITEMS`(냄비·면과 스프·물·물병·콜라·라면·세탁물). 집고 놓는 물건이 보이는 World State 물건이면 item 대신 그 종류 이름을 쓴다.
- 손 조작 동작(켜기·끄기·열기·닫기)은 가전 대상에만, 같은 id·같은 동작의 `hand_device`와 함께만 받는다. 가전마다 허용 동작(`DEVICE_ACTS`): 인덕션 켜기·끄기, 전자레인지 열기·닫기·켜기·끄기, 냉장고 열기·닫기. 그 밖(에어컨을 손으로 켜기 등)은 버린다.
- 손 조작 동작의 끝 조건은 서버가 만든다(모델 until은 보지 않는다): 켜기·끄기는 `{"device": id, "became": "on" | "off"}`, 문 상태가 있는 가전(냉장고)의 열기·닫기는 `became: door_open | door_closed`, 문 상태가 없는 가전(전자레인지)은 그 가전 설비의 열림 사실 지금 값 `{"fixture": "microwave", "room": <그 가전 방>, "facts": {"open": "open" | "closed"}}`.
- 켜기에는 서버 안전 문구(`CAUTION_LINE`: 인덕션 「냄비와 상판이 뜨거워져요.」, 전자레인지 「그릇이 뜨거워져요.」)가 붙고 실행 추적이 명령 전에 묻는다. 켠 위험 가전 뒤에는 같은 가전 끄기(hand_device off) do가 꼭 있어야 계획을 받는다.
- say·wait는 닫힌 목록(`NOTICES`)의 열쇠만 고른다: 물 끓기·익기·다 되기·세탁·끝(끝은 say만). say 글·wait 이름은 서버가 정한다(예: 다 되기 → say 「다 될 때까지 기다려요.」, wait 이름 「다 되기 기다리기」, say 이름 「다 되기 알림」). ask 답은 묶음 `clear_keep | yes_no`, 질문 글에 위험 가전 이름이 나오면 버린다.
- 관찰 모드: `tell_person {mode: repeat | earlier, reason}`(글은 지금 명령, earlier는 「먼저 …」), `ask_person {target, reason}`(글은 「<곳>이 보이게 폰을 가까이 대 주세요」).
- 위험 가전 이름 표는 별칭·오타·영어 이름까지 잡는다(79ff269). 이름 없이 위험 가전을 가리키는 답은 못 잡는다(문서에 적힌 한계).

**의도·노인·트윈·영상**
- 들은 말은 관찰 텍스트에 `사람이 말함: 「…」` 줄로 들어간다. 「에어컨 켜기」는 이미 행동 목록에 있다.
- 한양목련 트윈에는 전자레인지가 없다. 카탈로그(`twin/data/catalog/microwave.json`, 속성 power)와 모델(`twin/library/assets/appliances/microwave.glb`)은 있다. 기기는 `scene.json`에서만 만든다(`loadTwin`).
- 대시보드 3D는 구운 장면(`/twin/bake/`)과 `/api/scene`을 쓰고, 구운 장면에 없는 물건은 배치 메시지(`layout` add)로만 그린다(`ui/src/twin3d/live.ts`). 연결 때 보내는 `syncMessages()`는 원래 장면(base)에 없는 물건만 add로 보낸다(`src/layout/editor.ts`). 장면에 합쳐 넣은 물건은 base라 add가 나가지 않는다.
- 전자레인지는 YOLO가 보고, VLM 사실 열림·닫힘·쓰는 중이 붙는다. 쓰는 중 → 트윈 켜짐, 답에 없으면 꺼짐(`SIGHT.microwave`). 위험 목록에 「전자레인지 시작」이 있다.
- 영상 모드 폰 페이지는 명령이 오면 `--step <종류>:<낱말>:<영상>` 가운데 **종류가 같고 대상 id에 낱말이 든 첫 칸**으로 단계 영상을 바꾼다(`ui/src/phone/core/video-ar.js`). 같은 전자레인지를 대상으로 한 do 단계 넷은 모두 같은 영상이 된다.
- 영상이 끝나면 판정기는 계획이 열려 있어도 최대 30초만 더 본다(`TAIL_MS`, `scripts/video-check.ts`). 기다리기 단계 동안은 폰 명령이 없어 단계 영상이 바뀌지 않는다.
- 폰 AR 시작(영상 모드 `start {fixed: true}` 포함)은 그 집 폴더에 저장된 시작 위치(`runtime/homes/<집>/phone-start.json`)가 없으면 거절된다(`src/phone/session.ts`). 실제 판정은 시작 위치를 넣어 주지 않는다(가짜 판정만 넣는다).
- 영상 판정에 말을 넣는 `--say`는 아직 없다.

## 네 시나리오

| # | 모드 | 장면 | 보이는 판단 | 지금 되는가 · 모자란 것 |
|---|---|---|---|---|
| 1-상황 | 눈치 | 사람이 빈 컵을 두고 떠남 | 컵 치우기(네 단계) | 됨. 영상·시작 위치 |
| 1-상황 | 눈치 | 음료가 남은 컵을 두고 떠남 | 컵 그대로 두기 | 됨. 영상·시작 위치 |
| 1-의도 | 눈치 | 소파에서 TV 보다 「아 덥다」 | 에어컨 켜기 | seed 규칙(Task 3), 말 넣기(Task 9) |
| 2-습관 | 눈치 | 일주일 뒤, 말없이 소파에 앉아 TV를 켬 | 에어컨 켜기(배운 습관) | 반성 지시문(Task 4), 반성 뒤 검사(Task 5), 기억 상태 API·보이기(Task 6), 합성 관찰(Task 7), 이어 반성(Task 8) |
| 3-노인 | 코치 | 전자레인지 앞에서 「이거 어떻게 하지」 | 전자레인지로 데우기 알려 주기 | 트윈 기기·뷰어(Task 11), 행동(Task 12), 단계 영상 고르기·붙잡기(Task 10) |
| 4-장애인 | 코치 | 「라면 끓이는 법 알려 줘」 | 라면 끓이기 알려 주기 | 가짜 서버 흐름까지 됨. 수업 기록 씨앗(Task 8), 단계 영상 붙잡기(Task 10), 실제 판정 |

**습관은 눈치다.** 일주일 뒤 습관으로 미리 하는 행동은 눈치 행동(에어컨 켜기)이다. 코치 행동은 사람이 묻거나 막혔을 때만 고르게 하고, 코치 규칙은 반성이 고치지 못하게 seed 그대로 지킨다(Task 4·5).

## 노인 후보

| 후보 | 모드 | 비전·가전으로 확인 | 노인에게 맞는 점 | 크기 |
|---|---|---|---|---|
| **전자레인지로 데우기 알려 주기(정함)** | 코치 | 문 열림·닫힘, 켜짐·꺼짐(VLM 쓰는 중), 시작은 위험 목록이라 묻기 | 가전 사용법, 회의의 「사용설명서를 쉽게 풀기」로 이어짐 | 트윈 기기 하나 + 행동 하나 |
| 약 먹을 때 챙기기 | 눈치 | 「약 먹는 중」(VLM)만. 약통은 COCO에 없음 | 건강, 잊음 | 안 먹었음을 보는 근거가 약함 |
| 냉장고 문 열림 알리고 닫게 하기 | 눈치 | 문 열림(트윈 센서·VLM), 1분 넘게 열림 사건 | 잊음, 기본 동작 | 가장 작음. 코치 장면은 아님 |

## 자동 판단 설계

| 안 | 어떻게 | 좋은 점 | 걸리는 점 |
|---|---|---|---|
| **가: 두 모드 행동을 모두 PAM에 보내고 FSM이 고름(정함)** | `assist: "auto"`면 행동 전부. FSM `cooking` 상태 규칙(묻기·막힘)이 코치 행동을, 나머지 상태 규칙이 눈치 행동을 고른다. 칩은 고른 행동의 `coach` 표시 | 「기존 FSM 그대로」, PAM 계약 그대로, 판단 길 하나 | 사람이 누구인지는 FSM 글에만 있다 |
| 나: 사람 프로필(일반·발달장애·노인)을 설정에 두고 그 안에서 PAM이 고름 | 프로필마다 seed FSM, 관찰 텍스트에 `[사람]` 한 줄 | 같은 장면에서 사람마다 다른 모드 | seed FSM 셋 |
| 다: 에이전트가 「도울지 가르칠지」를 따로 판단 | PAM이 고른 뒤 LLM 한 번 더 | 모드 판단이 따로 보임 | PAM 일과 겹침, 비용·지연 |

습관이 코치로 가는 길은 셋으로 막는다: (1) 칩은 행동 종류로만 정해진다(Task 2), (2) 반성 지시문에 「코치 행동은 요청·막힘에만, 습관·시간 규칙으로 만들지 않는다」(Task 4), (3) 반성 뒤 검사가 seed 코치 규칙만 남긴다(Task 5). 설정은 「자동 / 눈치 / 코치」 셋.

## 일주일을 시연 안에서 보이는 길

일주일 근거를 PAM에 넘기는 길은 둘이었다. 하루씩 실제 반성을 일곱 번 이어 돌리는 길을 고른다.

| 길 | 계약 | 까닭 |
|---|---|---|
| **하루씩 일곱 번 이어 반성(고름)** | 그대로 | 논문과 회의에서 정한 「매일 반성, 다음 날 적용」 그대로다. 7일의 근거가 날마다 고친 기억을 거쳐 실제로 이어진다. 날마다 판본이 남아 언제 에어컨 규칙이 생겼는지 보인다. 반복 횟수 검사는 박석준 거르기 자리(지난 30일 기록을 받음)가 맡는다 |
| 7일 요약을 한 번에 넘김 | `pam-reflect/2` 모양은 그대로지만 `observation_text`의 뜻(그날 하루)이 바뀌고 지시문의 「Today's observations」와 어긋난다. 바이트 한도(`reflect_input_bytes`) 안에 7일을 넣으려면 날마다 7분의 1로 줄여야 한다 | 쓰지 않음 |

1. `npx tsx scripts/demo-setup.ts week --end <어제>`: `runtime/demo/week`에 합성 7일 **관찰만**(대본 기억 판본 없음, seed 판본 하나), 승인, 시작 위치.
2. 그 폴더로 서버를 띄운다. 폰은 켜지 않는다.
3. 녹화 전: `npx tsx scripts/demo-setup.ts reflect --chain`: 1~6일을 차례로 실제 반성한다. 날마다 돌려받은 `appliesDay`가 다음 날인지, 그날 판본이 고정됐는지 확인하고 아니면 멈춘다. 약 10~25분.
4. 녹화 중: `npx tsx scripts/demo-setup.ts reflect`: 7일(어제)을 반성한다. 전후로 오늘 고정 상태(`GET /api/memory/day/<오늘>`)를 보고, 돌려받은 `appliesDay`가 오늘이 아니거나 오늘이 다른 판본으로 고정됐으면 멈춘다. 대시보드 생각 말풍선에 배운 규칙이 뜬다.
5. 폰 영상 `tv-sit.mp4` → PAM이 말없이 에어컨 켜기, 칩 「습관 · …」, 「눈치 · 에어컨 켜기」.
6. 7일 판본에 말없이 에어컨을 켜는 규칙이 없으면 `reflect --scripted`(서버를 끈 채 대본 판본을 오늘부터로 넣음)로 찍고 자막에 「합성 기록으로 만든 습관」.
7. 에어컨 습관을 1~6일에 이미 배웠으면 4번 화면은 「배운 습관을 쓰고 있어요」 쪽이다(Task 6 `active`).
8. 지시문을 고쳐 다시 반성할 때는 한 폴더 안에서 판본·고정을 지우지 않고, 서버를 끄고 `week --fresh`로 새 폴더부터 다시 한다(Task 8).

## 습관 거르기 자리(박석준, 구현은 하지 않음)

반성이 낸 기억을 저장하기 전에 `coachGuard` 다음 `HabitFilter` 하나를 부른다. 이 계획은 모든 규칙을 그대로 두는 기본값(`keepAll`)만 둔다.

```ts
// src/history/habits.ts
/** 거르기 입력: 반성한 날, 그날 쓴 기억, 반성이 낸 기억(coachGuard 뒤), 지난 windowDays일 기록(world·device·decision·execution·feedback, 시각 순), 기록 시간대(분). */
export interface HabitInput {
  day: string; windowDays: number; offsetMinutes: number;
  previous: FsmMemory; proposed: FsmMemory; rows: HistoryRow[];
}
/** 규칙 하나의 결과. seen: 그 트리거를 본 횟수, fired: 그때 그 행동이 나온 횟수, p: 우연일 확률, conditions: 붙인 조건(요일·평일 주말·30분 시간대·날씨·실내 온도·함께 있는 사람, 둘까지). */
export interface HabitRuleNote {
  state: string; trigger: string; action: string; kept: boolean;
  reason: "habit" | "chance" | "too_few" | "coach" | "unchanged";
  seen?: number; fired?: number; p?: number; conditions?: string[];
}
export interface HabitOutput { memory: FsmMemory; notes: HabitRuleNote[] }
export type HabitFilter = (i: HabitInput) => HabitOutput | Promise<HabitOutput>;
export const keepAll: HabitFilter;   // proposed 그대로, 새 규칙마다 { kept: true, reason: "habit" }
```
- 박석준 기준(4번 이상·80% 이상·p값)은 이 함수 하나를 바꿔 끼운다. Python으로 짜면 PAM 서비스에 새 주소 `POST /habits`(새 계약 `pam-habits/1`, 본문 `HabitInput`, 답 `HabitOutput`)를 더한다. `pam-predict/2`·`pam-reflect/2`는 바꾸지 않는다.
- `HabitFilter`는 코치 규칙을 다시 넣거나 지울 수 없다: 거르기 뒤에 `coachGuard`를 한 번 더 돌린다.

## PAM 계약

`pam-predict/2`·`pam-reflect/2`는 바꾸지 않는다. 바뀌는 것은 (1) `services/pam/scenarios/noonchi/tasks.json`(행동 하나 더함), (2) `scenario.json` 지시문 바꾸기(Task 4의 다섯). 습관 거르기를 Python으로 하면 그때 새 계약 `pam-habits/1`을 더한다(이 계획 밖).

## Global Constraints

- 브랜치 `feat/coach-cup`(worktree `C:\Users\ABC\Desktop\소웨공\twin-home-coach`). 다른 worktree는 건드리지 않는다. 구현 전에 `npm ci`.
- 저장소 `CLAUDE.md` 규칙 표 전부. 특히:
  - 규칙 코드로 계획·행동을 정하지 않는다. 판단은 PAM, 단계는 에이전트 계획 모드다. 칩은 고른 행동과 기억을 그대로 보이는 표시다. `coachGuard`는 기억 모양 검사다(행동을 고르지 않는다).
  - mock과 live는 같은 구조. 가짜 PAM·가짜 모델·대본 감지기는 `tests/helpers/`에만. 합성 기록 대본은 `scripts/`에만.
  - PAM에 사진을 넘기지 않는다.
  - 대시보드에 입력창·단추를 더하지 않는다. 반성은 명령줄(`scripts/demo-setup.ts`)이 API로 부른다.
  - 새 화면 칸을 만들지 않는다(생각 말풍선을 그대로 쓴다). 새 칸이 필요해지면 구조만 그린 HTML 스케치를 먼저 보여 주고 확인을 받는다. 부품은 21st.dev 부품, 색은 토큰, 글은 상태만(60자 아래, 화살표·괄호 없음), 글 크기는 부품 원래 크기.
  - 사람 단계·say·wait·관찰 모드 글은 서버가 만든다(T1~T4). 대본과 지시문은 `{kind, target, act, item}`·`notice`·`mode`만 고르고 문장을 쓰지 않는다. 손 조작은 `DEVICE_ACTS` 안에서만, 같은 `hand_device`와 함께.
  - 승인 규칙 그대로. 위험 목록(인덕션 켜기·전자레인지 시작)은 늘 묻는다.
- 시험·빌드·크롬은 `npm run heavy -- <cmd>`로만, 한 번에 하나. 크롬·dev3d는 PC에 하나만.
- 이 PC 메모리는 13.8GB다. 녹화(`--record`)할 때는 `BRAIN_YOLO_PROVIDER=cpu`로 띄우고, PAM 서비스·서버·크롬 하나 밖의 무거운 프로그램은 끈다.
- 실제 모델 비용(추정, VLM 한 장 약 $0.0008·판정 한 번 약 $0.03~0.05에서 셈):
  - 컵·TV 장면 한 판 $0.03~0.05, 대조 한 판 $0.03.
  - 반성 한 번 $0.01~0.05(첫 판에 OpenRouter 사용 기록으로 잰다), 일곱 번 $0.07~0.35, 한 번에 1~4분.
  - 전자레인지 한 판 $0.06~0.10(기다리기는 `start-microwave.mp4` 안에서 꺼짐까지 보여 짧다).
  - 라면 한 판 $0.20~0.32(기다리기 두 번, 계획 모델이 고른 시간만큼 VLM이 더 돈다. 4분씩이면 약 $0.19 더).
  - 한 바퀴(장면 일곱 + 대조 + 반성 일곱) 약 $0.50~0.90. 지시문을 고쳐 일주일을 새로 반성하면 한 번에 $0.07~0.35 더. 이 계획 한도 $2.20(사용자 승인, 두 바퀴 + 다시 돌리기). 넘기 전에 멈추고 보고한다.
- 시연 집 폴더는 `runtime/demo/day1`·`runtime/demo/week`다(`runtime/`은 이미 `.gitignore`에 있다). 그 안의 기록 DB·`setup.json`·`approvals.json`·`lessons.json`·`phone-start.json`과 영상(`runtime/videos/`)은 커밋하지 않는다.
- 커밋 메시지는 영어, attribution 줄 없음. `.gitignore`·`.ignore`·`ui/public/fonts/OFL-noto-sans-kr.txt`·`.trail/`은 커밋하지 않는다. 푸시는 사용자가 말할 때만.

## File Structure

| 파일 | 일 |
|---|---|
| `src/contract/setup.ts`, `src/setup/store.ts`, `src/server/start.ts`, `src/act/tasks.ts`, `ui/src/setup/ModeStep.tsx` | 돕는 방식 「자동」 |
| `src/brain/decision.ts`(`FsmRuleAt`, `fsmRuleOf`, `CUP_FSM_MEMORY`), `src/world/decide.ts`, `src/contract/events.ts`, `ui/src/dashboard/{data.ts,ThoughtCard.tsx,words.ts}` | 칩: 눈치·코치, 습관 |
| `src/agent/prompts.ts` | 바라는 것을 돌려 말한 혼잣말은 `leave_it` |
| `services/pam/scenarios/noonchi/scenario.json`, `tasks.json` | 반성 지시문 바꾸기, 행동 목록 |
| `src/history/habits.ts`(새로), `src/history/reflect.ts`, `src/history/labels.ts` | 코치 규칙 지키기, 거르기 자리, 배운 규칙 |
| `src/server/app.ts`, `src/server/home.ts`, `src/server/start.ts`, `src/history/db.ts` | 기억 상태 API, 마지막 반성 다시 보내기 |
| `scripts/seed-history.ts`, `scripts/demo-setup.ts`(새로), `scripts/demo-start.ts`(새로) | 합성 관찰, 시연 준비, 장면 시작 위치 |
| `scripts/video-check.ts`, `ui/src/phone/core/video-ar.js` | `--say`·`--start-at`·`--tail`, 단계 영상 차례·붙잡기 |
| `twin/data/homes/mokryeon_180b/added_devices.json`(새로), `src/model/scene.ts`, `src/model/devices.ts`, `src/layout/{editor.ts,load.ts}` | 트윈에 전자레인지, 뷰어 add |
| `src/act/tasks.ts`, `src/brain/decision.ts`, `tests/helpers/planner.ts` | 「전자레인지로 데우기 알려 주기」 |
| `tests/demo-e2e.test.ts`(새로) | 네 장면 가짜 서버 흐름 |

---

### Task 1: 돕는 방식 「자동」

**Files:**
- Modify: `src/contract/setup.ts`(`AssistMode`), `src/setup/store.ts`(`assist`, 읽기), `src/server/start.ts`·`src/server/shell.ts`(`/api/setup/assist` 값 검사), `src/act/tasks.ts`(`tasksFor`), `ui/src/setup/ModeStep.tsx`(`ASSISTS`)
- Test: `tests/setup-store.test.ts`, `tests/setup-server.test.ts`, `tests/act-tasks.test.ts`, `ui/tests/mode-step.test.tsx`

**Interfaces:**

```ts
/** 돕는 방식. auto: 상황마다 PAM이 눈치·코치 행동 가운데 고른다. noonchi: 눈치 행동만. coach: 코치 행동과 묻기만. */
export type AssistMode = "auto" | "noonchi" | "coach";
// setup.json assist: 없으면(옛 파일) "noonchi", 새로 만드는 파일은 "auto". 틀린 값은 "noonchi".
// tasksFor("auto") = [...TASK_NAMES] (순서 그대로라 task_index가 같다)
// ModeStep ASSISTS 맨 앞: { id: "auto", name: "자동", line: "상황마다 알아서 골라요" }
```

- [ ] **Step 1: 실패하는 시험.** 「`tasksFor("auto")`는 `TASK_NAMES`와 같다」, 「`assist`가 없는 옛 `setup.json`은 noonchi, 파일이 없을 때 새로 쓰면 auto」, 「`POST /api/setup/assist {assist: "auto"}`가 받히고 `"robot"`은 400」, 「설정 화면 돕는 방식 칸이 셋이고 자동을 고르면 `auto`를 보낸다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/setup-store.test.ts tests/setup-server.test.ts tests/act-tasks.test.ts`, `npm run heavy -- npm test --prefix ui -- mode-step` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인, `npm run lint`.
- [ ] **Step 5:** 커밋 `feat(setup): add the auto assist mode that sends both noonchi and coach actions`.

### Task 2: 생각 말풍선 칩에 눈치·코치와 습관 보이기

**Files:**
- Modify: `src/brain/decision.ts`(`FsmRuleAt`, `fsmRuleOf`), `src/contract/events.ts`(decision 사건 `fsm`, `assist`), `src/world/decide.ts`(`finish`), `ui/src/dashboard/data.ts`(`Thought`, `thoughtOf`), `ui/src/dashboard/ThoughtCard.tsx`, `ui/src/dashboard/words.ts`
- Test: `tests/brain-decision.test.ts`, `tests/world-decide.test.ts`, `ui/tests/dashboard/data.test.ts`, `ui/tests/dashboard/wording.test.ts`

PAM 답에는 어느 규칙이 불렸는지가 없다. 계약을 바꾸지 않고 행동 단위로 본다.

**Interfaces:**

```ts
/** 고른 행동의 FSM 자리(행동 단위).
 *  state: 그 행동의 규칙이 모두 한 상태에 있으면 그 상태 id, 여러 상태에 흩어졌으면 null.
 *  trigger: 그 행동의 규칙이 하나면 그 트리거, 둘 이상이면 null.
 *  learned: 그 행동의 규칙 가운데 seed 기억(CUP_FSM_MEMORY)에 없는 트리거·행동 쌍이 하나라도 있다. */
export interface FsmRuleAt { state: string | null; trigger: string | null; learned: boolean }
/** 대기(null)·list 기억·기억에 없는 행동이면 null. */
export function fsmRuleOf(memory: PamMemory, kind: "list" | "fsm", action: string | null): FsmRuleAt | null;
// decision 사건: fsm: FsmRuleAt | null, assist: "noonchi" | "coach" | null (고른 행동의 TaskSpec.coach, 대기·실패는 null)
// ui
export interface Thought { reasoning: string; state: string | null; habit: boolean; assist: "noonchi" | "coach"; action: string }
// state: fsm.state가 있으면 FSM_STATE_TEXT[state] ?? fsm.trigger ?? null. fsm.state가 null이면 null.
// WORDS: noonchi "눈치", coach "코치", habit "습관", state "상태", learnedRule "배운 규칙". judge "판단"은 지운다.
// 앞 칩: habit이면 `습관 · ${state ?? WORDS.learnedRule}`, 아니면 state가 있을 때만 `상태 · ${state}`.
// 뒤 칩: `${WORDS[assist]} · ${action}`. 칩 두 개와 줄 높이는 그대로다.
```

- [ ] **Step 1: 실패하는 시험.**
  - 「seed만 있는 기억에서 컵 치우기는 `{ state: "left_cup", trigger: <seed 트리거>, learned: false }`」.
  - 「seed 덥다 규칙과 배운 TV 규칙이 둘 다 `watching_tv`에 있으면 에어컨 켜기는 `{ state: "watching_tv", trigger: null, learned: true }`」.
  - 「배운 규칙이 다른 상태(evening_tv)에 있으면 `{ state: null, trigger: null, learned: true }`이고 앞 칩은 `습관 · 배운 규칙`」.
  - 「라면 끓이기 알려 주기 판단 사건은 `assist: "coach"`, 에어컨 켜기는 `"noonchi"`」.
  - 「칩 글 `눈치 · 에어컨 켜기`·`코치 · 라면 끓이기 알려 주기`, 칩 칸 class·높이가 지금과 같다」.
  - 기존 「같은 행동이 규칙 여러 개에 있으면 null」 시험은 위 모양으로 고친다.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/brain-decision.test.ts tests/world-decide.test.ts`, ui 시험 → 실패 확인.
- [ ] **Step 3:** 구현. `assist`는 서버가 `taskOf(action)?.coach ? "coach" : "noonchi"`로 붙인다(표시용).
- [ ] **Step 4:** 통과 확인, `npm run lint`, `ui/tests/dashboard/steps.test.tsx`.
- [ ] **Step 5:** 커밋 `feat(dashboard): label each decision as noonchi or coach and mark actions with learned rules`.

### Task 3: 의도 파악 seed 규칙과 에이전트가 끼어들지 않기

**Files:**
- Modify: `src/brain/decision.ts`(`CUP_FSM_MEMORY` `watching_tv` 규칙 하나), `src/agent/prompts.ts`(규칙 줄 하나)
- Test: `tests/brain-decision.test.ts`, `tests/agent.test.ts`

**Interfaces:**
- `watching_tv.rules`에 더함: `{ trigger: "사용자가 덥다고 말하거나 더워서 부채질을 한다.", action: "에어컨 켜기" }`.
- 에이전트 시스템 프롬프트에 더함: `- 「아 덥다」처럼 바라는 것을 직접 시키지 않은 혼잣말은 가전 요청이 아니다. leave_it만 부른다. 「에어컨 켜 줘」처럼 시킨 말만 가전 도구를 부른다.`

- [ ] **Step 1: 실패하는 시험.** 「`fsmRuleOf(CUP_FSM_MEMORY, "fsm", "에어컨 켜기")`가 `{ state: "watching_tv", learned: false }`」, 「기억이 계약 검사를 통과하고 규칙 행동이 모두 `TASK_NAMES` 안」, 「시스템 프롬프트에 그 줄이 있다」, 「가짜 모델이 `아 덥다`에 `leave_it`만 부르면 폰 답은 빈 글이고 관찰 텍스트에 그 말 줄이 들어간다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/brain-decision.test.ts tests/agent.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현(seed 판본 올리기가 새 seed를 넣는다).
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(brain): add a spoken heat rule to the seed FSM and keep the agent out of indirect wishes`.

### Task 4: 반성 지시문을 우리 행동과 가전 습관에 맞추기

**Files:**
- Modify: `services/pam/scenarios/noonchi/scenario.json`(`prompt_replacements` 맨 앞에 다섯)
- Test: `services/pam/tests/test_prompts.py`, `tests/pam-scenario.test.ts`(새로)

바꾸기는 차례대로 적용된다(`adapt_prompt`). 새 다섯은 목록 **맨 앞**에 두어 논문 원문 그대로를 맞춘다(뒤의 「this video and summary → these observations and summary」 바꾸기가 그 뒤에 새 글에도 적용된다). 논문 파일은 그대로다.

**Interfaces:**
1. 목표(판단·반성 지시문 둘 다):
   - old: `- etc. –- any helpful pick-and-place action that is grounded in observed behavior.`
   - new: `- operating home appliances the person habitually operates by hand, such as turning on the living-room air conditioner when they sit down to watch TV.\n- etc. –- any helpful action that is grounded in observed behavior.`
2. 반성 46~50행(먼저 다시 적을 행동):
   - old: `- First, explicitly RE-STATE the pick-and-place actions that the human performed in\nthis video and summary. Then, for EACH of those human actions, think concretely\nabout HOW the robot could have taken that action over on the person's behalf. Your\nrules should be built around these take-over opportunities –- do NOT invent rules\nfor objects or actions the human did not interact with.`
   - new: `- First, explicitly RE-STATE the actions that the human performed in\nthis video and summary: pick-and-place actions and appliance operations (turning an appliance on or off by hand). Then, for EACH of those human actions, think concretely\nabout HOW the robot could have taken that action over on the person's behalf, by guiding the person through the phone or by operating the appliance. Your\nrules should be built around these take-over opportunities –- do NOT invent rules\nfor objects, appliances or actions the human did not interact with.`
3. 반성 51~52행(행동은 우리 이름):
   - old: `- Each rule's action MUST literally mirror an action the human performed in this\nvideo and summary. Do NOT invent hypothetical actions.`
   - new: `- Each rule's action MUST be one task name whose effect mirrors an action the human performed in this\nvideo and summary. Do NOT invent hypothetical actions.`
4. 반성 61~63행(더할 때):
   - old: `- Default to ADDING a new rule whenever the summary mentions a human pick-and-place\naction that the robot could plausibly take over and that is not yet covered by the\ncurrent memory. Err on the side of MORE rules, not fewer.`
   - new: `- Default to ADDING a new rule whenever the summary mentions a human pick-and-place\naction or appliance operation that the robot could plausibly take over and that is not yet covered by the\ncurrent memory. Err on the side of MORE rules, not fewer.`
5. 반성 82~85행(행동 형식):
   - old: ``- action: a NATURAL LANGUAGE description of how the robot should help, written in\nthe canonical form `Pick up <object> and place it <location>.` Valid `<location>`\nvalues are exactly one of: `next to the person`, `in the designated storage area`, `\nin the trash can`.``
   - new: `- action: exactly one of these task names, copied character for character: 컵 치우기, 사용자에게 물어보기, 세탁물 건조기로 옮기기, 에어컨 켜기, 컵 그대로 두기, 컵에 물 채워 주기, 컵에 콜라 따라 주기, 라면 끓이기 알려 주기. Write state descriptions and triggers in Korean.\n- Coaching tasks (라면 끓이기 알려 주기) fire only when the person asks how to do it or says they are stuck. Never add, move, rewrite or remove rules for them.` (Task 12가 두 목록에 「전자레인지로 데우기 알려 주기」를 더한다)
- old 글은 Step 3에서 `reflector_fsm_update.txt`를 바이트 그대로 읽어 맞춘다(줄바꿈·백틱·대시 글자 포함).

- [ ] **Step 1: 실패하는 시험.**
  - Python: 「반성 메시지 시스템 글에 `Pick up <object>`·`RE-STATE the pick-and-place actions`가 없고 `appliance operations`·행동 이름 줄이 있다」, 「판단 메시지에 가전 목표 줄이 있다」, 「새 다섯이 반성 지시문에서 한 번씩 맞고(`adaptation.applied_changes`의 `occurrences` 1), 옛 바꾸기도 그대로 맞는다」.
  - TS(`tests/pam-scenario.test.ts`): 「행동 이름 줄이 `TASK_NAMES` 전부를 그 순서로 담는다」, 「코치 행동 줄이 `coach: true`인 행동 전부를 담는다」.
- [ ] **Step 2:** `services/pam`에서 `python -m pytest tests/test_prompts.py`, `npm run heavy -- npx vitest run tests/pam-scenario.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 두 시험 통과 확인.
- [ ] **Step 5:** 커밋 `feat(pam): let reflection learn appliance habits and write our task names`. 박석준에게 바꾼 다섯 줄을 알린다(사용자에게 보고).

### Task 5: 반성 뒤 검사 — 코치 규칙 지키기와 습관 거르기 자리

**Files:**
- Create: `src/history/habits.ts`, `tests/history-habits.test.ts`
- Modify: `src/history/reflect.ts`(`runReflection`, `ReflectResult`), `src/history/labels.ts`(`REFLECT_TEXT.learned`), `src/contract/events.ts`(reflection 사건)
- Test: `tests/history-habits.test.ts`, `tests/history-reflect.test.ts`

**「코치 규칙」의 범위:** 행동이 코치 행동(`TaskSpec.coach`)인 규칙 전부다. 상태·트리거와 상관없다. 코치 규칙은 seed 것만 쓴다: 반성이 낸 코치 규칙은 모두 빼고, seed 코치 규칙을 seed 자리에 그대로 되돌린다. 반성이 요청 규칙을 다듬거나 다른 상태로 옮겨도 seed 글로 돌아오고, 습관·시간 코치 규칙은 남지 않는다.

**Interfaces:**

```ts
/** proposed에만 있는 규칙(상태·트리거·행동). */
export function learnedRules(previous: FsmMemory, proposed: FsmMemory): { state: string; trigger: string; action: string }[];
/**
 * 코치 규칙을 seed 그대로 지킨다.
 * 1) proposed의 모든 상태에서 행동이 코치 행동인 규칙을 뺀다. seed 코치 규칙과 상태·트리거가 같은 것은 notes에 reason "unchanged", 다른 것은 kept false·reason "coach".
 * 2) seed의 코치 규칙마다: 같은 id 상태가 proposed에 있으면 그 상태 rules 끝에 되돌리고, 없으면 seed 상태(description·rules는 seed 코치 규칙만, next는 proposed에 있는 상태 id로 가는 것만)를 states 끝에 더한다.
 * initial_state는 바꾸지 않는다. 결과는 validateMemory를 지난다.
 */
export function coachGuard(seed: FsmMemory, proposed: FsmMemory): HabitOutput;
export const keepAll: HabitFilter;
// runReflection(db, pam, day, { now?, emit?, filter?: HabitFilter, windowDays?: number /* 기본 30 */ })
// 순서: pam.reflect → validateMemory → coachGuard(CUP_FSM_MEMORY, …) → filter(기본 keepAll) → coachGuard(다시) → validateMemory → saveMemory
// ReflectResult ok에 learned: { state; trigger; action }[](코치 행동 빼고), dropped: HabitRuleNote[]
// reflection 사건·기록 줄 data에 learned·dropped. 글: REFLECT_TEXT.learned(n) = `새 규칙 ${n}개를 배웠어요`
```
- list 기억은 검사 없이 지금처럼 저장한다(시연은 fsm).

- [ ] **Step 1: 실패하는 시험.**
  - 「반성이 `라면 끓이기 알려 주기` 습관 규칙(저녁 19시마다)을 `drinking`에 더하면 그 규칙은 빠지고 dropped에 reason coach로 남는다」.
  - 「반성이 seed 요리 규칙 트리거를 다듬으면(`…또는 라면 봉지를 든다` 덧붙임) seed 트리거로 돌아간다」.
  - 「반성이 `cooking` 상태를 지우면 seed `cooking` 상태가 그 코치 규칙과 함께 돌아오고, next는 있는 상태로 가는 것만 남는다」.
  - 「반성이 `cooking`을 `kitchen`으로 이름을 바꾸고 요리 규칙을 옮기면 `kitchen`의 요리 규칙은 빠지고 seed `cooking`이 돌아온다」.
  - 「에어컨 습관 규칙은 그대로 남고 learned에 있다」.
  - 「`filter`가 받은 `rows`가 지난 30일 world·device·decision·execution·feedback 줄이고, 그 함수가 뺀 규칙은 저장되지 않는다. 그 함수가 코치 규칙을 더해도 저장된 판본에는 seed 코치 규칙만 있다」.
  - 「거르기 결과가 기억 모양 검사에 걸리면 반성은 실패로 남고 판본은 늘지 않는다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/history-habits.test.ts tests/history-reflect.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(history): keep coach rules as seeded and add a habit filter slot after reflection`.

### Task 6: 기억 상태 API와 배운 규칙 보이기

**Files:**
- Modify: `src/server/app.ts`(`GET /api/memory/day/:day`), `src/history/db.ts`(필요하면 판본 조회 칸), `src/history/reflect.ts`(`active`), `src/contract/events.ts`, `src/server/start.ts`(반성 사건을 집 묶음에도 넘김), `src/server/home.ts`(`brainLast`에 오늘 마지막 반성), `ui/src/dashboard/data.ts`(`thoughtOf`), `ui/src/dashboard/use-dash.ts`, `src/act/say.ts`, `src/plan/labels.ts`
- Test: `tests/history-api.test.ts`, `tests/server-events-backlog.test.ts`, `ui/tests/dashboard/data.test.ts`, `tests/act-say.test.ts`

이어 반성에서 에어컨 습관을 1~6일에 이미 배웠으면 7일 반성의 「이번에 새로 더한 규칙」은 빈다. 그래서 둘을 나눠 보낸다: `learned`(이번 반성이 새로 더한 규칙), `active`(새 판본에서 지금 적용 중인, seed에 없는 눈치 규칙).

**Interfaces:**

```ts
// GET /api/memory/day/:day → 그날 고정 상태(읽기만, 고정하지 않는다)
interface MemoryDayView {
  ok: true; day: string;
  /** 그날 판단이 이미 고정한 판본(없으면 null). */
  pinned: number | null;
  /** 지금 판단이 부르면 쓸 판본(pinned, 없으면 memoryFor(day)). */
  uses: { version: number; source: "seed" | "reflection" | "synthetic"; appliesDay: string | null; day: string | null } | null;
  latest: number | null;
}
// reflection 사건·기록 줄 data: learned(이번에 새로 더한 규칙, 코치 행동 빼고), active(새 판본의 규칙 가운데 seed에 없는 것, 코치 행동 빼고), dropped
type RuleLine = { state: string; trigger: string; action: string };
// SAY_TEXT.learned = (n) => `어제 기록으로 새 습관 ${n}개를 배웠어요.`
// SAY_TEXT.using = (n) => `배운 습관 ${n}개를 쓰고 있어요.`
// sayLine의 reflected?: { atMs: number; learned: number; active: number } (20초)
// WORDS.learnedNow = "새로 배움", WORDS.learnedRule = "배운 규칙"
```
- 새로 붙은 대시보드는 마지막 판단과 함께 오늘(기록 시간대) 마지막 반성 사건을 `replay: true`로 받는다(기록 DB `reflection` 줄에서 읽는다. 합성 판본도 같다).
- `thoughtOf`: 반성 사건이 마지막 유효 판단보다 새로우면
  - `learned`가 있으면 첫 규칙: `reasoning` = 트리거, 앞 칩 `습관 · 새로 배움`, 뒤 칩 `눈치 · 행동`.
  - `learned`가 비고 `active`가 있으면 첫 규칙: 앞 칩 `습관 · 배운 규칙`, 뒤 칩 `눈치 · 행동`.
  - 둘 다 비면 바꾸지 않는다. 다음 유효 판단이 오면 그 판단으로 바뀐다.
- 말풍선 카드: `learned`가 있으면 `SAY_TEXT.learned`, 없고 `active`가 있으면 `SAY_TEXT.using`.

- [ ] **Step 1: 실패하는 시험.** 「`/api/memory/day/<오늘>`이 판단 전에는 `pinned: null`, 첫 판단 뒤에는 그 판본」, 「이 API를 불러도 고정되지 않는다」, 「반성 사건에 learned·active가 있고, 앞 판본에 이미 있던 에어컨 습관은 learned가 아니라 active에만 있다」, 「반성 뒤 붙은 대시보드가 반성 사건을 다시 받는다」, 「learned가 있으면 `습관 · 새로 배움`, learned가 비고 active가 있으면 `습관 · 배운 규칙`과 「배운 습관 1개를 쓰고 있어요.」」, 「다음 판단이 오면 바뀐다」, 「둘 다 비면 그대로」.
- [ ] **Step 2:** 시험 실행 → 실패 확인.
- [ ] **Step 3:** 구현(새 칸 없음, 칸 크기 그대로).
- [ ] **Step 4:** 통과 확인, `npm run lint`.
- [ ] **Step 5:** 커밋 `feat(server): expose the day's memory pin and show learned and active habits after reflection`.

### Task 7: 합성 일주일을 지금 FSM과 실제 반성에 맞추기

**Files:**
- Modify: `scripts/seed-history.ts`(`SeedOptions`, `memoryAfter`, `tv`, `liveDay`, `seedHistory`)
- Test: `tests/seed-history.test.ts`

**Interfaces:**

```ts
export interface SeedOptions { /* … */
  /** scripted: 지금처럼 날마다 대본 판본과 반성 줄을 넣는다. none: seed 판본 하나만 넣고 날마다 판본·반성 줄·날 고정을 넣지 않는다(실제 반성을 이어 돌릴 때). 기본 scripted. */
  memories?: "scripted" | "none";
  /** scripted에서 참이면 마지막 판본에 말없이 에어컨을 켜는 규칙을 더한다(reflect --scripted). */
  habit?: boolean;
}
```
- `memoryAfter(i, h)`: `CUP_FSM_MEMORY`를 바탕으로 하루마다 상태를 더한다(morning_coffee·away·night). seed 규칙(컵 갈래·묻기·덥다·요리)은 모두 남긴다. 에어컨 습관 규칙은 `habit`일 때 마지막 판본에만 `watching_tv`(없으면 `evening_tv`)에 `{ trigger: "사용자가 소파에 앉아 TV를 보기 시작한다.", action: "에어컨 켜기" }`.
- `tv()`: 사람이 소파에 앉은 뒤 20~60초 안에 스스로 거실 에어컨을 켠다. 1일차는 「아 덥다」(heard 줄)와 판단 에어컨 켜기, 2~7일차는 말없이 사람이 켠다. 주말 오후 TV도 같다.
- `memories: "none"`에서 합성 판단 기록의 `memory_version`은 seed 판본이다. 판단 대본은 그대로 둔다(하루 행동 요약에 들어간다).

- [ ] **Step 1: 실패하는 시험.** 「scripted 판본마다 seed 규칙이 남아 있다」, 「`habit` 없이는 어느 판본에도 말없는 에어컨 규칙이 없고, `habit: true`면 마지막 판본에만」, 「7일 중 6일 이상 TV 장면 뒤 1분 안에 거실 에어컨 켜짐 기록」, 「1일차에 `사람이 말함` 줄과 에어컨 켜기 판단」, 「`memories: "none"`이면 판본은 seed 하나, 반성 줄 0, 2~7일 날 고정 없음」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/seed-history.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(seed): build the synthetic week on the current FSM and allow observation-only weeks`.

### Task 8: 시연 준비 명령 (폴더·시작 위치·이어 반성·다시 시작)

**Files:**
- Create: `scripts/demo-setup.ts`, `scripts/demo-start.ts`, `tests/demo-setup.test.ts`

**Interfaces:**

```
npx tsx scripts/demo-setup.ts day1  [--dir runtime/demo/day1] [--fresh]
  빈 기록 DB, setup.json { version: 1, home: "mokryeon_180b", done: true, mode: "test", assist: "auto" },
  homes/mokryeon_180b/approvals.json(컵 치우기·컵에 물 채워 주기·에어컨 켜기·라면 끓이기 알려 주기·전자레인지로 데우기 알려 주기),
  homes/mokryeon_180b/lessons.json(라면 끓이기 알려 주기 두 판: 이동 넷·냄비 꺼내기 alone 2),
  homes/mokryeon_180b/phone-start.json(첫 장면 cup의 시작 위치)
npx tsx scripts/demo-setup.ts week  [--dir runtime/demo/week] [--end YYYY-MM-DD(기본 어제)] [--fresh]
  day1과 같은 파일(phone-start는 tv) + seedHistory({ memories: "none" })
  폴더에 기록 DB가 이미 있으면 멈추고 「--fresh로 새로 시작하세요」.
  --fresh는 그 폴더를 <dir>.old-<시각>으로 옮기고 새로 만든다. 서버가 켜져 있으면(GET /api/health 응답) 「서버를 먼저 끄세요」로 멈춘다.
npx tsx scripts/demo-setup.ts start <cup|tv|microwave|kitchen> [--api http://127.0.0.1:8200]
  서버의 지금 집이 mokryeon_180b인지 GET /api/homes로 보고 아니면 멈춘다. 그 장면 시작 위치를 POST /api/phone/start-pose.
npx tsx scripts/demo-setup.ts reflect --chain [--api …] [--from 1일차] [--to 6일차]
  날마다 차례로(그날 d, 다음 날 d+1):
   - 이미 됨: 반성 판본 가운데 day = d이고 appliesDay = d+1이며 GET /api/memory/day/<d+1>의 uses가 그 판본이면 건너뛴다(다시 실행).
   - 막힘: d+1이 다른 판본으로 고정돼 있으면 멈추고 「앞 판의 고정이 남아 있어요. 서버를 끄고 week --fresh로 다시 시작하세요」.
   - 할 일: POST /api/reflection/run {day: d} → appliesDay가 d+1인지 → uses.version이 새 판본인지. 아니면 그 날짜와 까닭을 찍고 멈춘다.
  날마다 learned·active를 찍는다.
npx tsx scripts/demo-setup.ts reflect [--api …] [--day 어제]
  전: GET /api/memory/day/<오늘> pinned가 null이 아니면 「폰을 켜기 전에 반성하세요」로 멈춘다.
  POST /api/reflection/run → appliesDay가 오늘이 아니면 멈춘다.
  후: pinned가 null 또는 새 판본, uses.version이 새 판본이어야 한다. 아니면 「반성 중에 판단이 오늘 기억을 고정했어요」로 멈춘다.
  끝에 learned·active와 「말없이 에어컨을 켜는 규칙」이 active에 있는지 찍는다(없으면 reflect --scripted를 권한다).
npx tsx scripts/demo-setup.ts reflect --scripted [--dir runtime/demo/week]
  서버를 끈 채: 합성 판본(seedHistory scripted + habit)을 오늘부터로 넣고, 반성 줄 data.synthetic = true.
```
- 다시 반성하는 절차(지시문을 고친 뒤 등)는 하나뿐이다: 서버를 끈다 → `week --fresh` → 서버를 띄운다 → `reflect --chain` → `reflect`. 한 폴더 안에서 판본·날 고정을 지우거나 덮지 않는다. 같은 판을 이어서 다시 돌릴 때(중간에 멈춘 뒤)는 `reflect --chain`을 그대로 다시 부르면 된 날은 건너뛴다.
- `scripts/demo-start.ts`: `export const DEMO_STARTS: Record<"cup" | "tv" | "microwave" | "kitchen", { target: string; distanceM: number }>` (cup: `dining_table_978b20c7` 1.5m, tv: 거실 소파 1.8m, microwave: `microwave_kitchen` 1.2m, kitchen: `induction_counter_5641ccf0` 1.5m)와 `export function startFor(scene: SceneJson, target: string, distanceM: number): { position: [number, number]; yaw_deg: number }`(대상 가운데에서 그 방 다각형 가운데 쪽으로 distanceM, 대상을 보는 방향). 소파 id는 Step 3에서 `twin/homes/mokryeon_180b/scene.json`에서 읽어 넣는다.

- [ ] **Step 1: 실패하는 시험.** 「day1이 다섯 파일을 쓰고 기록 DB가 비어 있다」, 「기록 DB가 있는 폴더에 week를 다시 하면 멈추고, `--fresh`는 옛 폴더를 옮기고 새로 만든다」, 「`startFor`가 식탁 앞 1.5m·식탁을 보는 방향을 내고 그 자리가 방 안이다」, 「start가 지금 집이 원룸이면 시작 위치를 보내지 않고 멈춘다」, 「reflect --chain이 가짜 서버로 1~6일을 차례로 부르고, 3일차 appliesDay가 어긋나면 3일차에서 멈춘다」, 「1~3일이 이미 된 폴더에서 다시 돌리면 1~3일은 건너뛰고 4일부터 부른다」, 「4일차 다음 날이 다른 판본으로 고정돼 있으면 부르지 않고 멈춘다」, 「reflect가 오늘 pinned가 있으면 부르지 않는다」, 「반성 뒤 오늘이 다른 판본으로 고정돼 있으면 멈춘다」, 「`--scripted`는 서버 없이 오늘부터 쓰는 판본에 에어컨 습관이 있고 반성 줄에 합성 표시」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/demo-setup.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현. 기록 DB·합성 대본은 `scripts/seed-history.ts`의 함수, 시작 위치 모양은 `src/sync/start.ts`의 검사를 쓴다.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(scripts): add demo-setup for folders, scene start poses and resumable chained reflection`.

### Task 9: 영상 판정 — 말 넣기, 시작 위치, 붙잡기를 아는 끝내기

**Files:**
- Modify: `scripts/video-check.ts`(`Args`, 인자 읽기, 실제 판정의 시작 위치, 끝내기 조건 `watchAfterEnd` → `judgeState`, 영상 시간 한도)
- Test: `tests/video-check.test.ts`

**Interfaces:**
- `--say <초>:<글>` 여러 번: 그 영상 시각에 폰 페이지 안에서 폰 소켓으로 `{ type: "say", text }`를 보낸다(CDP `Runtime.evaluate`). 시각표에 `말 · <글>`. 틀린 값(초가 숫자가 아님, 글이 빔, 60자 넘음)은 쓰는 법 글.
- `--start-at <cup|tv|microwave|kitchen>`: 폰 페이지를 열기 전에 `demo-start.ts`로 그 장면 시작 위치를 보낸다(지금 집이 `--home`, 기본 mokryeon_180b가 아니면 멈춤). 없으면 지금처럼 저장된 시작 위치를 쓴다.
- `--tail <초>`(기본 30, 10~900): 영상이 「멈춘」 뒤(첫 영상이 끝났거나 단계 영상 마지막 장면을 붙잡는 중) 계획이 열려 있으면 더 보는 시간.
- `--max <초>`(기본 1800, 60~3600): 판 전체 한도. 넘으면 `unfinished`에 남기고 끝낸다.
- 골라서 답하기. 지금 `--done-after`는 새 명령마다 첫 답 단추를 누르고 `--step`이 있으면 기본 0(안 누름)이다. 이것은 그대로 두고, 고른 명령에만 누르는 길 둘을 더한다:
  - `--approve <초>`(기본 0 = 안 누름): 단계 id가 `:approve`(처음 하는 계획)나 `:hand`(손으로 켜는 위험 가전)로 끝나는 질문 명령에만, 그 초 뒤 위 줄이 아직 그 질문이면 「승인」 단추를 누른다.
  - `--done-on <초>:<명령 글>`(여러 번): 위 줄이 그 글과 똑같은 명령에만(서버 글이라 정해져 있다), 그 초 뒤 위 줄이 아직 그 글이면 「완료」 단추를 누른다.
  - 그 밖의 명령(가기·열기·닫기·켜기 등)은 누르지 않는다(`--done-after`를 따로 주지 않으면). 누른 것은 시각표에 `누름 · <단추> · <명령 글>`로 남는다.

```ts
export interface ClickRule { approveAfterMs: number; doneOn: { afterMs: number; text: string }[]; doneAfterMs: number }
/** 새 명령 하나에 예약할 누르기(없으면 빈 목록). 단추 글로 고른다: 승인 질문이면 「승인」, done-on 글이면 「완료」, done-after면 첫 단추(지금 동작). */
export function plannedClicks(cmd: VideoCommand, rule: ClickRule, now: number): { at: number; label: string | null; cmd: VideoCommand }[];
/** 위 줄이 text일 때만 label 글의 엄지 자리 단추(label이 null이면 첫 단추)를 누르고 그 글을 돌려준다. */
const clickChoice = (text: string, label: string | null) => string; // 크롬에서 돌리는 식(지금 clickAnswer를 넓힘)
```
- 끝내기는 한 함수가 정한다:

```ts
export function judgeState(o: {
  /** 영상이 멈춘 지(첫 영상 끝 __noonchiVideo.ended, 또는 붙잡는 중 __noonchiVideo.hold) ms. 도는 중이면 null. */
  stillForMs: number | null;
  /** 지금 도는 영상(첫 영상이나 바꾼 단계 영상)이 시작된 뒤 ms와 그 영상 길이 ms. */
  clipPlayedMs: number; clipDurationMs: number | null;
  due: number; planStatus: string | undefined; tailMs: number; totalMs: number; maxMs: number;
}): "watch" | "done" | "tail_over" | "clip_over" | "max_over";
```
  - 계획이 닫혔고(done·failed·cancelled) 누를 답이 없으면 `done`(영상이 돌고 있어도 끝낸다).
  - 영상이 멈춘 지 `tailMs`가 지났으면 `tail_over`.
  - 영상이 도는 중이면 「지금 영상 길이 + 60초」를 넘을 때만 `clip_over`. 단계 영상이 바뀌면 그 영상 길이(`clips[].duration_ms`, Task 10)로 다시 잰다.
  - 판 전체가 `maxMs`를 넘으면 `max_over`.

- [ ] **Step 1: 실패하는 시험.** 「`--say 5:아 덥다`를 `{ atMs: 5000, text: "아 덥다" }`로 받는다」, 「틀린 `--say`·`--tail 5`·`--max 0`은 쓰는 법 글」, 「시각표에 말 줄이 그 시각에 있다」, 「`--start-at microwave`면 페이지를 열기 전에 시작 위치를 보내고, 지금 집이 다르면 판정을 시작하지 않는다」, `plannedClicks` 표: 「`--approve 2`면 단계 id `plan:pam-3:5:hand` 질문에 2초 뒤 「승인」 하나, `plan:pam-3:2` 명령(전자레인지 문을 열어 주세요)에는 없음」, 「`--done-on 8:그릇을 전자레인지에 넣어 주세요`면 그 글 명령에만 8초 뒤 「완료」, 「그릇을 꺼내 주세요」에는 없음」, 「`--step`이 있고 `--done-after`가 없으면 승인·done-on 밖 명령에는 아무것도 예약하지 않는다」, 「`--done-on 8:` (빈 글)·`--approve -1`은 쓰는 법 글」, 「누를 때 위 줄이 다른 명령으로 바뀌었으면 누르지 않는다(가짜 페이지)」, `judgeState` 표: 「붙잡는 중 + 계획 열림 + 멈춘 지 100초, tail 300 → watch」, 「붙잡는 중 + 멈춘 지 301초 → tail_over」, 「영상 도는 중 + 계획 done + 답 없음 → done」, 「단계 영상이 20초짜리면 80초 넘게 돌 때 clip_over, 첫 영상 길이와 상관없음」, 「전체 1801초 → max_over」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/video-check.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인. `--fake`로 `cup-empty-leave.mp4`에 말을 넣어 한 번 돌려 본다(비용 0).
- [ ] **Step 5:** 커밋 `feat(video): inject spoken lines, set scene start poses, answer chosen prompts and end runs on plan close or still-frame tail`.

### Task 10: 영상 페이지 — 같은 대상 단계 영상을 차례로, 마지막 장면 붙잡기

**Files:**
- Modify: `ui/src/phone/core/video-ar.js`(`current.command`, 단계 영상 끝 처리, `record`), `ui/src/phone/core/video-ar.d.ts`
- Test: `ui/tests/phone-video.test.ts`

**Interfaces:**
- `--step` 형식은 그대로(`<종류>:<낱말>:<영상>`). **같은 종류·낱말 칸이 여럿이면 적은 차례대로 쓴다**: 그 종류·낱말에 맞는 새 명령(계획 id·단계 id가 처음인 것)이 올 때마다 다음 칸. 칸이 다 떨어지면 지금 영상을 둔다. 칸이 하나인 지금 쓰임은 그대로다.
- 단계 영상이 끝나면 마지막 장면을 붙잡는다: 다음 단계 영상이 오거나 페이지가 닫힐 때까지 그 장면으로 엔진 프레임을 계속 보낸다(표시도 그 장면).
- 판정기에 알리는 칸: `__noonchiVideo.hold: { clip: string; since: number /* 영상 시각 ms */ } | null`. 붙잡는 동안 값이 있고, 다음 단계 영상이 시작되면 null. `ended`는 첫 영상이 끝났을 때만 참이다(지금과 같다). 단계 영상마다 `clips[]`에 `{ video_ms, clip, duration_ms }`를 남긴다.

- [ ] **Step 1: 실패하는 시험.** 「`do:microwave:a.mp4`·`do:microwave:b.mp4`·`do:microwave:c.mp4`가 있으면 전자레인지 대상 do 명령 셋에 a·b·c를 차례로 튼다」, 「같은 명령이 다시 와도(비전 상태만 바뀜) 다음 칸으로 넘기지 않는다」, 「칸이 하나면 지금처럼」, 「단계 영상이 끝나면 `hold`가 그 영상·시각이 되고 5초 동안 엔진 프레임이 계속 나가며 화소가 마지막 장면과 같다」, 「다음 단계 영상이 오면 `hold`가 null」, 「`clips`에 `duration_ms`가 있다」.
- [ ] **Step 2:** `npm run heavy -- npm test --prefix ui -- phone-video` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(video): use repeated step clips in order and report a held last frame`.

### Task 11: 한양목련 트윈에 전자레인지(기기와 3D)

**Files:**
- Create: `twin/data/homes/mokryeon_180b/added_devices.json`, `tests/added-devices.test.ts`
- Modify: `src/model/scene.ts`(`loadScene`), `src/model/devices.ts`(`loadFromScene`), `src/layout/editor.ts`(`unbaked`, `syncMessages`, `reset`), `src/layout/load.ts`, `CLAUDE.md`(규칙 표 한 줄)
- Test: `tests/added-devices.test.ts`, `tests/layout-editor.test.ts`, `tests/drawn-fixtures.test.ts`, `tests/mokryeon-cup.test.ts`

**Interfaces:**
- 파일: `{ "source": "noonchi 시연(2026-11-13)", "items": [{ "id": "microwave_kitchen", "type": "microwave", "label": "주방 전자레인지", "room": "kitchen", "position": [7.66, -0.05], "facing_deg": 90, "elevation": 0.9 }] }`(자리는 조리대 `counter_kitchen_e` 윗면, Step 3에서 그 조리대 자리·높이로 맞춘다).
- `loadScene`은 이 파일 물건을 장면에 더하고(같은 id가 있으면 더하지 않는다), 더한 id 목록을 함께 준다: `loadScene(home): (SceneJson & { added?: string[] }) | null`. `loadFromScene`은 합친 장면으로 기기를 만든다(kind `microwave`, 속성 power).
- `LayoutEditor` 옵션 `unbaked?: readonly string[]`: 구운 장면에 없는 기본 물건. `syncMessages()`는 그 물건을 지금 자리로 `add`로 보낸다(지운 것이면 보내지 않음). `reset()`은 그 물건을 지우지 않는다. `load.ts`가 `scene.added`를 넘긴다.

- [ ] **Step 1: 실패하는 시험.** 「한양목련 기기 목록에 `microwave_kitchen`(전자레인지, 주방)」, 「평면도·`/api/scene`에 같은 물건」, 「새 편집기의 `syncMessages()`에 `microwave_kitchen` add가 있고, 대시보드 연결 때 그 메시지가 간다」, 「`reset()` 뒤에도 남는다」, 「파일이 없는 집은 그대로」, 「같은 id가 scene.json에 있으면 하나만, add 메시지도 없음」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/added-devices.test.ts tests/layout-editor.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현. 대시보드 3D에 모델이 보이는지 `npm run capture`로 한 장 찍는다(크롬 하나).
- [ ] **Step 4:** 통과 확인, `tests/drawn-fixtures.test.ts`·`tests/mokryeon-cup.test.ts`·`ui/tests/twin3d/`도.
- [ ] **Step 5:** 커밋 `feat(twin): add a kitchen microwave to the Mokryeon home and draw it in the live twin`. CLAUDE.md 규칙 표에 한 줄: 「시연용으로 더하는 가전은 `twin/data/homes/<집>/added_devices.json`에 두고 장면을 읽을 때 더하며, 뷰어에는 연결 때 add로 보낸다 | `tests/added-devices.test.ts`」.

### Task 12: 코치 행동 「전자레인지로 데우기 알려 주기」

**Files:**
- Modify: `src/act/tasks.ts`, `services/pam/scenarios/noonchi/tasks.json`, `services/pam/scenarios/noonchi/scenario.json`(Task 4 행동 이름 줄·코치 행동 줄에 새 이름), `src/brain/decision.ts`(`cooking` 상태), `src/world/labels.ts`(`FSM_STATE_TEXT.cooking` → `"주방에서 할 일을 찾음"`), `src/agent/policy.ts`(`SELF_STOP`), `src/agent/planTools.ts`(끄기 검사), `src/agent/planInput.ts`(지시문 한 줄), `src/act/track.ts`(켠 가전 추적), `tests/helpers/planner.ts`(`microwaveSteps`, 대본 표)
- Test: `tests/act-tasks.test.ts`, `tests/agent-planner.test.ts`, `tests/act-track.test.ts`, `tests/phone-lines.test.ts`, `tests/brain-decision.test.ts`, `tests/pam-scenario.test.ts`

**먼저:** Task 11. 전자레인지가 기기이자 평면도 물건이어야 대상이 되고 이름이 붙는다(기기 id와 평면도 id가 같은 `microwave_kitchen`, 방 `kitchen`, 평면도 종류 `microwave` → 이름 「전자레인지」).

**글과 끝 조건은 서버가 만든다(T1~T4):** 대본은 `{kind, target, act, item, hand_device, notice}`만 고른다. 폰 글은 `STEP_TEXT`·`NOTICES`가 내고, 손 조작 동작의 끝 조건은 `handUntil`이 낸다.

**저절로 꺼지는 가전:** 전자레인지는 다 되면 스스로 멈춘다. 지금 검사는 켠 위험 가전 뒤에 끄기 do(hand_device off)를 꼭 두게 해, 이미 꺼진 뒤에 「전자레인지를 꺼 주세요」를 보내게 된다. 또 기다리는 동안 꺼지면 끄기 do의 `became: off`는 단계 시작 전 사건이라 끝나지 않는다. 그래서 저절로 꺼지는 가전(`SELF_STOP`)만 「꺼짐을 기다리는 wait」를 끄는 단계로 인정한다. 이 wait는 notice 「다 되기」(이름 「다 되기 기다리기」, 폰 글 없음)와 모델이 쓰는 until `{"device": id, "state": "off"}`(wait until은 모델 것을 그대로 받는다)로 표시만 한다. **끝나는 기준은 실행 추적이 따로 본다**: 지금 상태가 꺼짐인 것만으로는 끝나지 않고, 켜라고 한 시각(hot의 onAt) 뒤에 새로 본 꺼짐(가전 이력에 켜짐이 아닌 값 → 꺼짐 바뀜, `offSince`)이 있어야 끝난다. 이것은 끄기 안내를 지우는 지금 기준(fec2e7d, `offSince(d, onAt)`)과 같다. 그래서 켜기 단계를 사람이 「완료」로 넘겼는데 가전이 옛 꺼짐 그대로이면(켜짐을 한 번도 못 봄) 기다리기가 끝나지 않고 hot이 남으며, 시간 초과 질문에서 그만두거나 계획이 닫히면 끄기 안내가 간다. 그릇 꺼내기는 따로 pick으로 둔다.

**Interfaces:**

```ts
"전자레인지로 데우기 알려 주기": {
  name: "전자레인지로 데우기 알려 주기", coach: true, maxSteps: 12,
  description: "사람이 전자레인지 앞에서 쓰는 법을 묻거나 막히면 문 열기부터 꺼내기까지 사람이 할 일을 단계마다 천천히 알려 준다. 클로이드는 가전을 조작하지 않는다.",
  allow: { kinds: ["go", "pick", "place", "do", "wait", "say"], need: ["do", "wait"] },
},
// cooking 상태 description: "사용자가 주방에서 음식을 만들거나 데우려 한다. 방법을 묻거나 무엇을 할지 몰라 멈춰 있으면 단계마다 알려 준다."
// cooking rules에 더함: { trigger: "사용자가 전자레인지 앞에서 쓰는 법을 묻거나 이거 어떻게 하냐고 말한다.", action: "전자레인지로 데우기 알려 주기" }
// src/agent/policy.ts
/** 다 되면 스스로 멈추는 위험 가전. 켠 뒤 그 가전이 꺼짐을 기다리는 wait를 끄는 단계로 인정한다. */
export const SELF_STOP: Partial<Record<DeviceKind, true>> = { microwave: true };
// src/agent/planTools.ts finish(): 켠 위험 가전(riskyHand) 뒤에 (a) 같은 가전 hand_device off do 또는
//   (b) 그 가전 종류가 SELF_STOP이고 until이 정확히 {"device": 그 가전, "state": "off"}인 wait 가 있어야 끝낸다.
// src/act/track.ts: (b) 모양 wait는 ConditionWatch 결과를 쓰지 않는다. look()에서 그 단계는 offSince(그 가전, r.hot.get(그 가전)) 가 참일 때만 넘긴다
//   (지금 상태 꺼짐만으로는 넘기지 않음, hot에 그 가전이 없으면 넘기지 않음). 넘기면(advance) hot에서 그 가전을 지운다.
//   그 전에 계획이 닫히면 지금처럼 끄기 안내(「전자레인지를 꺼 주세요」)를 보내고, 안내는 지금처럼 새로 본 꺼짐·「완료」·offHoldMs로만 지운다.
/** 저절로 꺼지는 가전의 꺼짐 기다리기(SELF_STOP 가전, until이 정확히 {device, state: "off"}인 wait)인가. */
export function selfStopWait(step: AgentStep, devices: readonly { id: string; kind: string }[]): string | null; // 그 가전 id, 아니면 null
// 지시문(planInput) 한 줄: "- 다 되면 스스로 멈추는 가전(전자레인지)은 켠 뒤 끄기 do 대신 notice 다 되기, until {\"device\": id, \"state\": \"off\"}인 wait를 둔다. 꺼낼 때는 pick(act 꺼내기, target 그 가전)을 따로 둔다."
export function microwaveSteps(ids: { microwave: string; waitS?: number /* wait timeout_s, 기본 300 */ }): Record<string, unknown>[];
```

- 시험 대본 9단계. 「폰 글」은 `STEP_TEXT`·`NOTICES`가 실제로 내는 글이고, 「끝 조건」의 2·4·5·8번은 `handUntil`이 만든 값이다(대본에 until을 써도 쓰이지 않는다):

| # | 대본 | 폰 글(이름 / 명령) | 끝 조건 | 넘김 |
|---|---|---|---|---|
| 1 | `{kind: "go", act: "가기", target: mw}` | 전자레인지로 가기 / 전자레인지로 가 주세요 | `{"phone_near": mw}` | 폰 위치 |
| 2 | `{kind: "do", act: "열기", target: mw, hand_device: {id: mw, to: "open"}}` | 전자레인지 문 열기 / 전자레인지 문을 열어 주세요 | `{"fixture": "microwave", "room": "kitchen", "facts": {"open": "open"}}` | 비전 |
| 3 | `{kind: "place", act: "넣기", target: mw, item: "그릇"}` | 그릇 내려놓기 / 그릇을 전자레인지에 넣어 주세요 | 없음 | 「완료」·「다 했어」 |
| 4 | `{kind: "do", act: "닫기", target: mw, hand_device: {id: mw, to: "close"}}` | 전자레인지 문 닫기 / 전자레인지 문을 닫아 주세요 | `{"fixture": "microwave", "room": "kitchen", "facts": {"open": "closed"}}` | 비전 |
| 5 | `{kind: "do", act: "켜기", target: mw, hand_device: {id: mw, to: "on"}}` | 전자레인지 켜기 / 전자레인지를 켜 주세요 (안전 문구 「그릇이 뜨거워져요.」, 명령 전에 승인 질문 「그릇이 뜨거워져요. 전자레인지를 켤까요?」) | `{"device": mw, "became": "on"}` | 비전(쓰는 중 → 켜짐) |
| 6 | `{kind: "say", notice: "다 되기"}` | 다 되기 알림 / 다 될 때까지 기다려요. | 4초 | 시간 |
| 7 | `{kind: "wait", notice: "다 되기", until: {"device": mw, "state": "off"}, timeout_s: 300, on_timeout: "ask"}` | 다 되기 기다리기 / 폰 글 없음 | 표시는 `{"device": mw, "state": "off"}`, 실제로는 켜라고 한 뒤 새로 본 꺼짐(`offSince`) | 비전(쓰는 중 → 켜짐 → 쓰는 중이 아님 → 꺼짐 바뀜). 6번 동안 그렇게 꺼졌으면 바로 넘어감. 켜짐을 못 봤으면 넘어가지 않음 |
| 8 | 2번과 같음 | 전자레인지 문 열기 / 전자레인지 문을 열어 주세요 | 2번과 같음 | 비전 |
| 9 | `{kind: "pick", act: "꺼내기", target: mw, item: "그릇"}` | 그릇 꺼내기 / 그릇을 꺼내 주세요 | 없음 | 「완료」·「다 했어」 |

- 3·9번은 1인칭 영상에서 사람이 보이지 않아 「들고 있음」을 볼 수 없어 「완료」로 넘긴다. 그릇이 World State 물건으로 보이고 대본이 그 id를 `object`로 주면 item 대신 그 종류 이름(「그릇」)이 들어간다.
- 2·4·8번 끝 조건은 단계가 시작된 뒤 본 VLM 사실의 지금 값이다(이미 열려 있으면 바로 넘어간다, 남은 결정 2 「가」). 방이 `kitchen`이라 World State 눈이 주방이 아니면 모름이 되어 「완료」로 넘어간다.
- 5번 승인 질문은 `CAUTION_TEXT.ask(안전 문구, handLabel)`이라 가전 이름이 들어간다: 「그릇이 뜨거워져요. 전자레인지를 켤까요?」. 켠 채 닫히면 끄기 안내 「전자레인지를 꺼 주세요」.

- [ ] **Step 1: 실패하는 시험.**
  - 「행동 목록 아홉, 앞 여덟 순서 그대로, 새 행동은 `coach`」, 「`tasksFor("noonchi")`에 없고 `coach`·`auto`에 있다」, 「`tasks.json`·`scenario.json` 이름 줄이 맞다」, 「`fsmRuleOf`가 `cooking`」.
  - 「가짜 모델의 전자레인지 계획이 계획 검사를 지나고, 단계마다 이름·명령·끝 조건이 위 표와 같으며 5번만 안전 문구가 있다」.
  - 「대본 6번 say에 모델 글(text)을 넣어도 쓰이지 않고 서버 글 「다 될 때까지 기다려요.」만 나간다」.
  - 「5번 대본에 until `{"device": mw, "state": "on"}`을 써도 버리지 않고 서버가 `{"device": mw, "became": "on"}`으로 바꾼다」.
  - 「2번에 hand_device가 없거나 `to`가 다르면 버린다」, 「냉장고에 켜기, 에어컨에 켜기(손 조작)는 버린다」.
  - 「7번 wait를 빼면 `켠 가전은 계획 안에서 끕니다`로 버린다. 7번 until이 `{"device": mw, "state": "off"}`면 받는다. 같은 wait를 인덕션 켜기 뒤에 두면 버린다(SELF_STOP 아님). notice가 「끝」이면 wait로 받지 않는다(지금 검사)」.
  - 실행 추적: 「5번 명령 전에 승인 질문, 승인 뒤 VLM 쓰는 중이면 넘어감」, 「켜라고 한 뒤 켜짐을 보고 6번 동안 꺼짐을 보면 7번이 바로 끝나고 hot에서 빠져 계획이 끝나도 끄기 안내가 없다」, 「7번 전에 그만두면 끄기 안내(「전자레인지를 꺼 주세요」)가 간다」, **「5번을 「완료」로 넘겼고 전자레인지가 옛 꺼짐 그대로면(켜짐 이력 없음) 7번이 끝나지 않고 hot이 남으며, 시간 초과 질문에 「그만」이면 끄기 안내가 간다」**, 「켜라고 하기 전에 있던 켜짐 → 꺼짐 이력으로는 7번이 끝나지 않는다」, 「`selfStopWait`는 인덕션 wait·until이 다른 wait에는 null」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/act-tasks.test.ts tests/agent-planner.test.ts tests/act-track.test.ts tests/phone-lines.test.ts tests/brain-decision.test.ts tests/pam-scenario.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(act): add microwave coaching for older people and accept waiting for a self-stopping appliance`.

### Task 13: 네 장면 가짜 서버 흐름 시험

**Files:**
- Create: `tests/demo-e2e.test.ts`
- Modify: `tests/helpers/pam.ts`(`demoPredict`, `demoReflect`)

**Interfaces:**
- `demoPredict(body)`: 시험용 PAM 답(대역). 사람 안 보임 + 빈 컵 → 컵 치우기, 사람 안 보임 + 내용물 → 그대로 두기, `사람이 말함: 「아 덥다」` → 에어컨 켜기, 기억에 「소파에 앉아 TV를 보기 시작」 에어컨 규칙이 있고 TV 보는 중 → 에어컨 켜기, `이거 어떻게` 말 + 전자레인지 보임 → 전자레인지, `라면` 말 → 라면, 그 밖 -1. 번호는 요청 `tasks`에서 이름으로 찾는다.
- `demoReflect(body)`: 받은 기억의 `watching_tv`에 에어컨 습관 규칙을 더하고, `drinking`에 라면 습관 규칙(코치)을 더하고, seed 요리 규칙 트리거에 덧붙임을 단 기억을 돌려준다.

- [ ] **Step 1: 실패하는 시험.** 모두 `assist: "auto"`, 한양목련, 승인·시작 위치는 미리 둠:
  1. 빈 컵 → 첫 명령 `식탁으로 가 주세요`, 판단 사건 `assist: "noonchi"`, `fsm.learned: false`.
  2. TV 보는 사람 + `say` 「아 덥다」 → 폰 답 빈 글, 말 요청 에이전트 도구 호출 없음, 거실 에어컨 켜짐.
  3. 같은 장면에서 말이 없으면 에어컨을 켜지 않는다(대조).
  4. 관찰만 넣은 합성 7일(`memories: "none"`)에서 1~7일을 차례로 `POST /api/reflection/run` → 날마다 `appliesDay`가 다음 날, 7일 판본은 오늘부터, `/api/memory/day/<오늘>`의 uses가 그 판본, 저장된 판본에 라면 습관 없음·요리 규칙은 seed 글, dropped에 라면 습관(coach) → 말없는 TV 장면 → 에어컨 켜짐, 판단 사건 `assist: "noonchi"`, `fsm.learned: true`.
  5. 전자레인지 감지 + `say` 「이거 어떻게 하지」 → 명령이 Task 12 표의 서버 글 차례대로(첫 명령 `전자레인지로 가 주세요`), 판단 사건 `assist: "coach"`, 5번 단계에서 승인 질문이 먼저 오고 승인 뒤 VLM이 전자레인지 쓰는 중을 내면 넘어가며, 6번 동안 쓰는 중이 사라지면 7번 기다리기가 바로 끝나고 8·9번 뒤 done, 끄기 안내 없음. 폰으로 나간 모든 글이 서버 글 틀이거나 위험 가전 이름이 없다.
  6. `say` 「라면 끓이는 법 알려 줘」 → 첫 명령 `수납장으로 가 주세요`, 판단 사건 `assist: "coach"`, 6번 명령 `냄비를 인덕션에 올려 주세요`, 7번 전에 승인 질문.
  7. 모든 PAM 요청에 사진 칸이 없고 `contract`가 `pam-predict/2`·`pam-reflect/2`.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/demo-e2e.test.ts` → 실패 확인.
- [ ] **Step 3:** 빠진 연결을 고친다.
- [ ] **Step 4:** 통과 확인(시험 시간 한도 120초). 가짜 서버 `EFAULT`면 그 시험만 다시.
- [ ] **Step 5:** 커밋 `test(e2e): demo scenarios in auto mode from day one to coaching`.

### Task 14: 실제 판정·녹화·문서

- [ ] **Step 1:** `npx tsc --noEmit -p .`, `npm run lint`, `npm run heavy -- npx vitest run`, ui 시험, `services/pam`의 `python -m pytest`, `npm run heavy -- npm run build --prefix ui`.
- [ ] **Step 2: 가짜 판정.** 아래 「시연 순서」의 장면마다 `--fake`로 시각표가 나오는지 본다(비용 0).
- [ ] **Step 3: 이어 반성(녹화 전, $0.06~0.30).** `demo-setup week --fresh` → 서버 → `demo-setup reflect --chain`. 날마다 learned·active를 적는다(언제 에어컨 규칙이 처음 생겼는지, 코치 규칙이 빠진 날). 중간에 멈추면 원인을 고치고 `reflect --chain`을 다시 부른다(된 날은 건너뛴다).
- [ ] **Step 4: 실제 판정(한 바퀴 약 $0.50~0.95).** 장면마다 한 판. **기준:**
  - 장면 1·2: 컵 갈래 계획 기준.
  - 장면 3: 말 뒤 15초 안에 에어컨 켜기·칩 `눈치 · 에어컨 켜기`. 대조(day1 폴더에서 `tv-sit.mp4`)는 에어컨을 켜지 않음.
  - 장면 4: 7일 반성이 `appliesDay` 오늘, 말없이 에어컨을 켜는 규칙이 active에 있다(행동 이름 그대로, 한국어 트리거). learned면 `습관 · 새로 배움`, 앞서 배웠으면 `습관 · 배운 규칙`.
  - 장면 5: 말없이 에어컨 켜기·칩 `습관 · …`.
  - 장면 6(노인): 말 뒤 30초 안에 첫 명령, 폰 글이 Task 12 표의 서버 글, 문 열기·닫기·켜짐·꺼짐은 비전으로 넘어감, 시작 전 질문 1번, 누른 단추는 「승인」 1번과 3·9번 「완료」뿐, 끄기 안내 없음, 끝까지 done(`--tail 120`).
  - 장면 7(장애인): 코치 계획 기준(첫 명령 30초 안, 인덕션 질문 1번, done, `--tail 600`). 누른 단추는 「승인」 1번과 라면 대본 4·6·10번 「완료」뿐.
  - 반성이 규칙을 못 내면 `raw_response`를 보고 Task 4 지시문을 한 번 고친 뒤, 서버를 끄고 `week --fresh` → 서버 → `reflect --chain` → `reflect`로 새로 돈다(옛 폴더는 `.old-<시각>`으로 남는다). 그래도 안 되면 `reflect --scripted`로 찍고 자막.
- [ ] **Step 5: 녹화.** 장면마다 `--record`(`BRAIN_YOLO_PROVIDER=cpu`). 프레임 4장씩 뽑아 칩·말풍선 카드·트윈 에어컨·전자레인지를 본다. 기다리기·반성 대기는 편집에서 줄인다.
- [ ] **Step 6: 문서.** `docs` 저장소 `01_Product/구현명세서 SSOT.md`(돕는 방식 자동, 판단 칩, 반성 지시문 바꾸기, 반성 뒤 검사·거르기 자리, 기억 상태 API, 마지막 반성 다시 보내기, 시연 준비 명령, 더한 가전 파일, 전자레인지 코치, 영상 판정 인자), `변경이력.md`.
- [ ] **Step 7:** Codex reviewer(herdr `w2:p5`)에게 브랜치 전체를 리뷰받고 지적을 고친다. `trail note`로 반성 지시문을 바꾼 까닭과 이어 반성을 고른 까닭을 남긴다.

## 라면 대본 (시나리오 4, 코치 계획 그대로)

`tests/helpers/planner.ts` `ramenSteps`(c22ca2b 뒤)와 서버 글 틀이 내는 글이다. Task 13 시험 6과 Task 14 실제 판정이 이 글을 기준으로 본다. 수납장·싱크대·인덕션은 평면도 id, 인덕션 켜기·끄기는 인덕션 가전 id다.

| # | 대본 | 폰 글(이름 / 명령) | 끝 조건 |
|---|---|---|---|
| 1 | `{go, 가기, 수납장}` | 수납장으로 가기 / 수납장으로 가 주세요 | phone_near |
| 2 | `{pick, 꺼내기, 수납장, item 냄비}` | 냄비 꺼내기 / 냄비를 꺼내 주세요 | 사람이 물건을 들고 있음 |
| 3 | `{go, 가기, 싱크대}` | 싱크대로 가기 / 싱크대로 가 주세요 | phone_near |
| 4 | `{do, 물 받기, 싱크대, item 냄비}` | 물 받기 / 냄비에 물을 받아 주세요 | 없음(「완료」) |
| 5 | `{go, 가기, 인덕션}` | 인덕션으로 가기 / 인덕션으로 가 주세요 | phone_near |
| 6 | `{place, 올리기, 인덕션, item 냄비}` | 냄비 올리기 / 냄비를 인덕션에 올려 주세요 | 없음(「완료」) |
| 7 | `{do, 켜기, 인덕션 가전, hand_device on}` | 인덕션 켜기 / 인덕션을 켜 주세요 (안전 문구 「냄비와 상판이 뜨거워져요.」, 먼저 승인 질문) | became on |
| 8 | `{say, notice 물 끓기}` | 물 끓기 알림 / 물이 끓을 때까지 기다려요. | 4초 |
| 9 | `{wait, notice 물 끓기, elapsed_s}` | 물 끓기 기다리기 / 폰 글 없음 | 시간 |
| 10 | `{do, 넣기, 인덕션, item 면과 스프}` | 면과 스프 넣기 / 면과 스프를 넣어 주세요 | 없음(「완료」) |
| 11 | `{wait, notice 익기, elapsed_s}` | 익기 기다리기 / 폰 글 없음 | 시간 |
| 12 | `{do, 끄기, 인덕션 가전, hand_device off}` | 인덕션 끄기 / 인덕션을 꺼 주세요 | became off |
| 13 | `{say, notice 끝, item 라면}` | 끝 알림 / 라면이 다 됐어요. | 4초 |

- 10번 대상은 인덕션(평면도 id)이다. 동작 넣기의 글 틀에는 자리 이름이 없어 「면과 스프를 넣어 주세요」로 나간다.

## 시연 순서 (발표 영상, 약 7분)

| 순서 | 모드 · 장면 | 집 폴더 | 명령 | 보여 줄 것 |
|---|---|---|---|---|
| 0 | 설정 | day1 | 없음 | 설정 3단계 돕는 방식 「자동」 (3초) |
| 1 | 눈치 · 1일차 상황 | day1 | `video-check --start-at cup --clip cup-empty-leave.mp4` + 치우기 단계 영상 | `상태 · 컵을 두고 자리를 뜸`·`눈치 · 컵 치우기`, 네 명령 |
| 2 | 눈치 · 1일차 상황 | day1 | `--start-at cup --clip cup-full-leave.mp4` | `눈치 · 컵 그대로 두기`, 「컵을 그대로 두기로 했어요.」 |
| 3 | 눈치 · 1일차 의도 | day1 | `--start-at tv --clip tv-hot-say.mp4 --say 15:아 덥다` | `눈치 · 에어컨 켜기`, 트윈 거실 에어컨 켜짐 |
| 4 | 눈치 · 일주일 | week | (녹화 전 `reflect --chain`) `demo-setup reflect` | 이번에 배웠으면 `습관 · 새로 배움`·「어제 기록으로 새 습관 1개를 배웠어요.」, 앞서 배웠으면 `습관 · 배운 규칙`·「배운 습관 1개를 쓰고 있어요.」 |
| 5 | 눈치 · 8일차 선제 | week | `--start-at tv --clip tv-sit.mp4` | 말없이 `습관 · …`·`눈치 · 에어컨 켜기` |
| 6 | 코치 · 노인 | day1 | `--start-at microwave --clip microwave-start.mp4 --say 4:이거 어떻게 하지 --tail 120 --approve 2 --done-on 8:그릇을 전자레인지에 넣어 주세요 --done-on 6:그릇을 꺼내 주세요` + `go:microwave:go-microwave.mp4`, `do:microwave:open-microwave.mp4`, `place:microwave:put-bowl.mp4`, `do:microwave:close-microwave.mp4`, `do:microwave:start-microwave.mp4`, `do:microwave:open-microwave.mp4`, `pick:microwave:take-bowl.mp4` | `코치 · 전자레인지로 데우기 알려 주기`, 서버 글 명령, 문 열림·닫힘을 비전으로 넘김, 시작 전 질문, 트윈 전자레인지 켜짐·꺼짐, 기다리기가 꺼짐으로 끝남 |
| 7 | 코치 · 탈시설 장애인 | day1 | `--start-at kitchen --clip kitchen-start.mp4 --say 5:라면 끓이는 법 알려 줘 --tail 600 --approve 2 --done-on 15:냄비에 물을 받아 주세요 --done-on 8:냄비를 인덕션에 올려 주세요 --done-on 10:면과 스프를 넣어 주세요` + 라면 단계 영상, 물 받기에 `wrong-fridge.mp4`, 면 넣기 때 `--say <초>:어 뭐 해야 되지` | `코치 · 라면 끓이기 알려 주기`, 인덕션 켜기 전 질문, 바로잡기, 조용한 단계(수업 기록 씨앗) |

- 장면 6의 do 칸 넷은 적은 차례(열기·닫기·켜기·다시 열기)대로 쓰인다(Task 10). 기다리기(7번) 동안은 `start-microwave.mp4` 마지막 장면(불 꺼짐)을 붙잡는다. 계획 모델이 다른 순서로 do를 내면 그 판은 다시 돌린다.
- 장면 6·7은 1일차 폴더를 그대로 쓴다(코치 행동은 습관과 상관없다). 폴더를 바꿀 때는 서버를 다시 띄운다(PAM 서비스는 그대로). 장면마다 `--start-at`이 시작 위치를 다시 넣는다.

## 찍을 영상 (사용자, 가로 1280×720, 폰을 가로로 고정)

이미 정한 영상은 다시 적지 않는다: 장면 1·2는 `2026-11-13-cup-branches.md` 「찍을 영상」의 `cup-empty-leave.mp4`·`cup-full-leave.mp4`와 치우기 단계 영상, 장면 7은 `2026-11-13-coach-mode.md` 「찍을 영상」 전부. 새로 찍을 것(장면 순서대로):

| 장면 | 영상 | 길이 | 보여야 하는 것 |
|---|---|---|---|
| 3 | `tv-hot-say.mp4` | 40초 | 소파와 켜진 TV 화면이 함께 보임. 0~8초 사람이 들어와 앉음, 10~40초 TV를 보며 손으로 부채질. 소리는 필요 없다 |
| 5 | `tv-sit.mp4` | 40초 | 같은 자리. 0~10초 들어와 리모컨으로 TV를 켜고 앉음, 10~40초 TV만 봄. 부채질·말 없음 |
| 6 | `microwave-start.mp4` | 20초 | 전자레인지 앞에 선 사람(어르신 역)이 그릇을 들고 전자레인지를 봄. 문과 단추가 화면 가운데 |
| 6 | 단계 `go-microwave.mp4` | 10초 | 1인칭으로 전자레인지 앞까지 |
| 6 | 단계 `open-microwave.mp4` | 10초 | 문을 열고 안이 5초 보임 |
| 6 | 단계 `put-bowl.mp4` | 10초 | 그릇을 넣고 손을 뺌 |
| 6 | 단계 `close-microwave.mp4` | 10초 | 문을 닫고 닫힌 문이 5초 보임 |
| 6 | 단계 `start-microwave.mp4` | 30초 | 0~3초 단추를 누름, 3~20초 안의 불이 켜져 접시가 돎, 20~30초 불이 꺼지고 문은 닫힌 채(이 마지막 장면을 기다리기 동안 붙잡는다) |
| 6 | 단계 `take-bowl.mp4` | 10초 | 열린 전자레인지에서 그릇을 꺼내 손에 든 채 3초 |

- 다시 열기(8번)는 `open-microwave.mp4`를 한 번 더 쓴다. `microwave-done.mp4`는 찍지 않는다.

김준형 집 촬영(11-13 금 수업 뒤 ~ 11-14 토 낮)에 같이 찍는다. 전자레인지가 없으면 다른 집에서 찍는다.

## 그 뒤 (이 계획에 넣지 않음)

- 사람 프로필(일반·발달장애·노인)과 프로필마다 seed FSM(자동 판단 안 나).
- 박석준 습관 후보정을 `HabitFilter`에 끼우기(Python이면 `pam-habits/1`).
- 약 먹을 때 챙기기, 냉장고 문 열림 알리고 닫게 하기.
- ThinQ 사용설명서를 읽어 가전 쓰는 법을 쉽게 풀기.
- 노인용 천천히 읽기(소리 속도), 한 번 더 읽기. 글 키우기는 CLAUDE.md 글 크기 규칙을 바꿔야 한다.
- 기다리기 동안 같은 장면이면 VLM을 쉬어 비용 줄이기.
- 반성 결과를 하루하루 비교해 보이는 화면.

## 남은 결정 (기본 「가」로 진행)

1. **비용 한도: 정함.** $2.20(사용자 승인).
2. **문 열기·닫기 끝 조건: 가로 진행.** 서버가 만드는 값이 그대로 「가」다: 문 상태가 없는 전자레인지는 단계가 시작된 뒤 본 설비 열림 사실의 지금 값(이미 열려 있으면 바로 넘어감). 「나」(바뀐 것만, `seq`)는 쓰지 않는다.
3. **서버 글의 물건 이름: 가로 진행.** 새 글 틀(c22ca2b)이 item을 넣어 「그릇을 전자레인지에 넣어 주세요」, 「냄비를 인덕션에 올려 주세요」처럼 나온다. 따로 할 일은 없다. 이름이 빠지는 곳은 do 넣기(「면과 스프를 넣어 주세요」, 자리 이름 없음)와 pick 꺼내기(「그릇을 꺼내 주세요」, 자리 이름 없음)다.
4. **전자레인지 끄기는 기다리기로 인정: 가로 진행.** Task 12의 `SELF_STOP`.

## Self-Review

- 시나리오 1(상황·의도): 시연 순서 1~3, Task 3·8·9·13.
- 시나리오 2(일주일 뒤 습관, 눈치): Task 4~8·13, 「일주일을 시연 안에서 보이는 길」. 반성 규칙(그날 고정·다음 날 적용)은 바꾸지 않는다. 7일 근거는 날마다 이어 반성으로 넘기고, 고정 상태를 API로 확인한다(Task 6·8).
- p값 후보정 자리: 「습관 거르기 자리」, Task 5.
- 시나리오 3(노인): Task 10·11·12, 시연 순서 6. 대본은 `{kind, target, act, item, hand_device, notice}`만, 폰 글은 `STEP_TEXT`·`NOTICES`, 손 조작 끝 조건은 서버(`became on`, 문은 설비 열림 사실 + room), 다 된 것은 기다리기의 `state: off`, 꺼내기는 따로 pick.
- 시나리오 4(탈시설 장애인): 코치 계획 그대로 + 수업 기록 씨앗(Task 8) + 말 넣기(Task 9) + 붙잡기·`--tail`(Task 9·10).
- 자동 판단: 설계 표, Task 1·2. 습관이 코치로 가는 길 셋을 막음: Task 2, Task 4(5번 바꾸기), Task 5(`coachGuard` 앞뒤 두 번), Task 13 시험 4.
- 규칙 코드로 행동 안 정함: 칩·검사만, 판단은 PAM. `demoPredict`·`demoReflect`는 `tests/helpers/` 대역.
- PAM 계약 그대로: 「PAM 계약」 절, Task 13 시험 7.
- Codex 1차 지적 9개: 1 Task 4 바꾸기 2·4, 2 「일주일을 시연 안에서 보이는 길」·Task 7·8, 3 Task 5 범위, 4 Task 2 행동 단위, 5 Task 6 API·Task 8 확인, 6 Task 8 `start`·Task 9 `--start-at`, 7 Task 11 `unbaked`, 8 Task 10 차례 쓰기, 9 Task 10 붙잡기·Task 9 `--tail`.
- 서버 글 구조(T1~T4)에 맞춤: 「조사한 사실」 사람 단계 글 절, Task 12 표(글·끝 조건을 코드가 내는 값으로), 「라면 대본」 절, Task 13 시험 5·6.
- Codex 3차 지적 2개: P1 Task 12 꺼짐 기다리기는 켜라고 한 뒤 새로 본 꺼짐(`offSince`)으로만 끝남과 그 시험, P2 Task 9 `--approve`·`--done-on`(`plannedClicks`)과 시연 순서 6·7 명령.
- Codex 2차 지적 5개: 1 Task 10 `hold`·Task 9 `judgeState`(계획 닫힘·멈춘 장면 tail·영상마다 길이·`--max`), 2 Task 12 서버 글 틀 대본, 3 Task 12 7번 기다리기 `state: off`·`SELF_STOP`·9번 pick, 4 Task 6 `learned`·`active`, 5 Task 8 `--fresh`·이어 실행 건너뛰기·막힘 멈춤.
- 위험: 실제 PAM 반성이 바꾼 지시문을 따라 에어컨 습관을 낼지, 16k 토큰 상한 안에 들지 모른다(Task 14 Step 3, 안 되면 대본).
- 위험: 이어 반성은 하루만 보고 규칙을 더하는 논문 성질 그대로라 1일차에 바로 생길 수 있다. 「일주일 반복」을 따지는 것은 박석준 거르기가 붙은 뒤다. 영상에서는 날마다 판본 변화를 그대로 보인다.
- 위험: 1일차 대조 판에서 PAM이 말 없는 TV 장면에도 에어컨을 켤 수 있다. Task 14에서 대조 판을 꼭 돌린다.
- 위험: 실제 에이전트가 「아 덥다」를 가전 요청으로 보고 바로 켤 수 있다(Task 3 지시문 줄은 강제하지 못한다).
- 위험: 영상 모드는 실제 시각을 쓴다. 배운 규칙에 「저녁」이 붙으면 낮에 찍은 장면 5에서 안 나올 수 있다. 그러면 19~22시에 찍는다.
- 위험: VLM이 전자레인지 문 열림·쓰는 중을 실제 영상에서 얼마나 맞히는지, 영상 모드 자세로 트윈 전자레인지와 맞춰지는지(`SIGHT_MATCH`) 재지 않았다. 못 맞히면 그 단계는 「완료」로 넘어가고, 시작·꺼내기 단계는 시간 초과가 날 수 있다.
- 위험: 계획 모델이 전자레인지 do를 대본과 다른 수·순서로 내면 단계 영상 차례가 어긋난다(그 판은 다시 돌린다).
- 위험: 전자레인지 카탈로그에는 문 속성이 없어 문 열림·닫힘은 트윈에 보이지 않고 VLM 설비 사실로만 넘어간다(서버 끝 조건이 그 모양을 낸다). 그 사실은 방마다 하나라 World State 눈이 주방일 때만 참이 된다.
- 위험: 같은 이름의 단계(「전자레인지 문 열기」 두 번)는 수업 기록(`lessons.json`, 단계 이름 열쇠)에서 한 칸으로 합쳐진다.
