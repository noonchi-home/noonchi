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
  - 대시보드에 새 화면 칸을 만들지 않는다(생각 말풍선을 그대로 쓴다). 실제 폰의 안전 안내 자리(Task 11d)는 새 배치라 구조만 그린 HTML 스케치를 먼저 보여 주고 확인을 받는다. 부품은 21st.dev 부품, 색은 토큰, 글은 상태만(60자 아래, 화살표·괄호 없음), 글 크기는 부품 원래 크기.
  - 가전 종류별 값(이름·Matter·트윈 type·위험 동작·손 조작·카메라 낱말·selfStop)은 Task 11r-1 뒤로 `src/model/kinds.ts` 등록부 칸에만 둔다. 승인 판정은 Task 11r-2 뒤로 `needsConfirm` 하나다(위험 켜기 종류는 끄기 말고 상태를 바꾸는 명령 전부). 다른 파일에 종류별 표를 새로 두지 않는다.
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
| `src/model/kinds.ts`(새로), `src/hub/types.ts`, `src/model/mapping.ts`, `src/agent/{search,policy,planTools}.ts`, `src/plan/labels.ts`, `src/thinq/appliance.ts`(짝짓기 파생만), `src/world/{vocab,sight,state,relations}.ts`, `tests/kinds-registry.test.ts`, `scripts/kinds-snapshot.ts` | 가전 종류 등록부: 등록부·파생·구조 검사·같은 결과(Task 11r-1) |
| `src/model/kinds-check.ts`(새로), `src/agent/{policy,planTools,planInput,prompts}.ts`, `src/thinq/{appliance,link}.ts`, `src/server/start.ts`, `tests/kinds-behavior.test.ts` | 가전 종류 등록부: 승인 판정 `needsConfirm`·ThinQ 어댑터·`checkKinds`(Task 11r-2) |
| `src/world/{sight.ts,state.ts,vocab.ts,conditions.ts}`, `src/observe/pipeline.ts`, `src/hub/{types.ts,signals.ts}`, `src/act/track.ts` | 가전 이력 촬영 시각(Task 11a), 인덕션 자리 oven만 인덕션으로(Task 11b), 끄기 추적은 확인된 꺼짐으로만(Task 11c-1·11c-2) |
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
  - `--approve <초>`(기본 0 = 안 누름): 단계 id가 `:approve`(처음 하는 계획)나 `:hand`(손으로 켜는 위험 가전)로 끝나는 질문 명령에만, 그 초 뒤 「승인」 단추를 누른다.
  - `--done-on <초>:<명령 글>`(여러 번): 위 줄이 그 글과 똑같은 명령에만(서버 글이라 정해져 있다), 그 초 뒤 「완료」 단추를 누른다.
  - 예약할 때 그 명령의 계획 id(`cmd.id`)·단계 id(`cmd.step`)·글을 함께 잡고, 누를 때 페이지에 떠 있는 지금 명령(`__noonchiVideo.commands`의 마지막)의 셋이 모두 같을 때만 누른다. 취소된 뒤 같은 글로 나온 새 단계·새 승인 질문(계획 id나 단계 id가 다름)은 앞 예약이 누르지 않는다.
  - 그 밖의 명령(가기·열기·닫기·켜기 등)은 누르지 않는다(`--done-after`를 따로 주지 않으면). 누른 것은 시각표에 `누름 · <단추> · <명령 글>`로 남는다.

```ts
export interface ClickRule { approveAfterMs: number; doneOn: { afterMs: number; text: string }[]; doneAfterMs: number }
/** 새 명령 하나에 예약할 누르기(없으면 빈 목록). 단추 글로 고른다: 승인 질문이면 「승인」, done-on 글이면 「완료」, done-after면 첫 단추(지금 동작). */
export interface PlannedClick { at: number; label: string | null; id: string; step: string; text: string }
export function plannedClicks(cmd: VideoCommand, rule: ClickRule, now: number): PlannedClick[];
/** 페이지의 지금 명령(__noonchiVideo.commands 마지막)의 계획 id·단계 id와 위 줄 글이 모두 c와 같을 때만 label 글의 엄지 자리 단추(null이면 첫 단추)를 누르고 그 글을 돌려준다. */
const clickChoice = (c: Pick<PlannedClick, "id" | "step" | "text" | "label">) => string; // 크롬에서 돌리는 식(지금 clickAnswer를 넓힘)
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

- [ ] **Step 1: 실패하는 시험.** 「`--say 5:아 덥다`를 `{ atMs: 5000, text: "아 덥다" }`로 받는다」, 「틀린 `--say`·`--tail 5`·`--max 0`은 쓰는 법 글」, 「시각표에 말 줄이 그 시각에 있다」, 「`--start-at microwave`면 페이지를 열기 전에 시작 위치를 보내고, 지금 집이 다르면 판정을 시작하지 않는다」, `plannedClicks` 표: 「`--approve 2`면 단계 id `plan:pam-3:5:hand` 질문에 2초 뒤 「승인」 하나, `plan:pam-3:2` 명령(전자레인지 문을 열어 주세요)에는 없음」, 「`--done-on 8:그릇을 전자레인지에 넣어 주세요`면 그 글 명령에만 8초 뒤 「완료」, 「그릇을 꺼내 주세요」에는 없음」, 「`--step`이 있고 `--done-after`가 없으면 승인·done-on 밖 명령에는 아무것도 예약하지 않는다」, 「`--done-on 8:` (빈 글)·`--approve -1`은 쓰는 법 글」, 「누를 때 위 줄이 다른 명령으로 바뀌었으면 누르지 않는다(가짜 페이지)」, 「예약한 단계가 취소되고 같은 글의 새 단계(다른 계획 id)가 떠 있으면 누르지 않는다」, 「같은 계획에서 같은 글이 다른 단계 id로 다시 나오면 앞 예약은 누르지 않고 새 명령의 예약만 누른다」, 「취소 뒤 새 승인 질문(다른 계획 id, 같은 글)은 앞 「승인」 예약이 누르지 않는다」, `judgeState` 표: 「붙잡는 중 + 계획 열림 + 멈춘 지 100초, tail 300 → watch」, 「붙잡는 중 + 멈춘 지 301초 → tail_over」, 「영상 도는 중 + 계획 done + 답 없음 → done」, 「단계 영상이 20초짜리면 80초 넘게 돌 때 clip_over, 첫 영상 길이와 상관없음」, 「전체 1801초 → max_over」.
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

### Task 11r-1: 가전 종류 등록부 — 등록부·파생·구조 검사·같은 결과

사용자 결정(2026-11-15): 가전 종류는 앞으로 사용자가 직접 늘려 간다. 지금은 새 종류 하나를 넣으려면 여러 파일의 종류별 표를 따로 고쳐야 한다. 가전 종류마다 이름·Matter 연결·트윈 type·카메라 낱말·위험 동작·손 조작을 **한 곳(등록부)** 에 적고, 흩어진 곳은 등록부에서 파생해 읽게 바꾼다. 새 종류는 등록부 한 줄 + 집 파일(`added_devices.json`) 한 줄로 끝난다. 전자레인지가 첫 사용 예다.

코디네이터 결정(2026-11-15): 이 일은 둘로 나눈다. **이 Task(11r-1)는 결과가 바뀌지 않는 옮기기만 한다**(지금 21종의 값과 동작이 전과 똑같다, 넓어짐도 없음). 결과가 바뀌는 승인 판정·ThinQ 어댑터·등록부 검증은 Task 11r-2가 한다. Task 11 바로 뒤에 하고, 차례는 11r-1 → 11r-2 → 11a다(11a~12는 종류별 값을 등록부 칸으로 더한다).

**지금 흩어진 종류별 표(f0ace1f, `grep`·`trail grep`로 찾음)와 맡는 Task:**

| 자리 | 무엇 | 등록부 칸 | Task |
|---|---|---|---|
| `src/hub/types.ts` `DeviceKind` | 종류 21개 유니언 | 등록부 키에서 파생(`keyof typeof KINDS`) | 11r-1 |
| `src/model/mapping.ts` `KIND_PROFILES` | Matter 모델·기기 종류·기능·제어 속성·센서·기본값 | `profile` | 11r-1 |
| `src/model/mapping.ts` `KIND_LABELS` | 종류 이름(인덕션·전자레인지…) | `label` | 11r-1 |
| `src/model/mapping.ts` `TYPE_RULES` | 트윈 type·접두어 → 종류(+ Matter 기기 종류·기능 덮어쓰기), 위에서 처음 맞는 것 | `twinTypes`(종류 줄들). 종류 없는 줄(`wall_pad`·`robot` 트윈 전용)은 mapping.ts에 남긴다 | 11r-1 |
| `src/agent/search.ts` `KIND_SYNONYMS` | 사람들이 부르는 말 | `synonyms` | 11r-1 |
| `src/agent/policy.ts` `CONFIRM_RULES` | 승인이 필요한 명령과 까닭 글(현관 잠금 해제·인덕션 켜기·전자레인지 시작) | 11r-1: `confirm`(지금 뜻 그대로 옮김) → 11r-2: 위험 켜기 종류는 `riskyReason`, `confirm`은 잠금 해제만 | 11r-1·11r-2 |
| `src/agent/policy.ts` `RISKY_ON_NAMES` | 위험 가전 이름·별명·오타 | `riskyOn.names` | 11r-1 |
| `src/plan/labels.ts` `CAUTION_LINE` | 켜기 전 안전 문구 | `riskyOn.caution` | 11r-1 |
| `src/agent/planTools.ts` `DEVICE_ACTS` | 손 조작 동작(켜기·끄기·열기·닫기) | `hand` | 11r-1 |
| `src/thinq/appliance.ts` `PAIRABLE_KINDS`·`TYPE_FIT` | ThinQ와 짝지을 수 있는 종류와 ThinQ 기기 종류 | `thinq.type` | 11r-1 |
| `src/thinq/appliance.ts` `readAppliance`(73·84행)·`thinqSteps`(99행)·`mirrorPlan`(116·127행)의 `kind === "aircon"`·`"fridge"` 갈래, 부르는 곳 `src/thinq/link.ts` 104·171·183행 | ThinQ 읽기·제어·트윈 반영 | `thinq.adapter`(어댑터 이름으로 가른다) | 11r-2 |
| `src/agent/policy.ts` `requiresConfirmation`(127행, 명령 이름을 정규화해 `CONFIRM_RULES`와 견줌), `src/agent/planTools.ts` `riskyHand`(152행) | 승인 대상 명령 | `needsConfirm` 하나 | 11r-2 |
| `src/world/vocab.ts` `DEVICE_LONG[*].kinds` | 오래 이어지면 사건이 되는 종류(냉장고·현관 문 1분 넘게 열림) | `longEvents` | 11r-1 |
| `src/model/mapping.ts` `twinChange` 324·325행(`kind === "lock"`·`"covering"`), `heatingSetpoint` 482행(`kind === "thermostat"`) | 종류 이름으로 제어 명령을 가름 | 갈래를 프로필(`profile.model`)로 바꾼다. 지금 21종은 종류와 모델이 하나씩 맞아 결과가 같다 | 11r-1 |
| `src/world/vocab.ts` `DEVICE_TEXT` | 종류마다 바꿔 쓰는 상태 글(세탁 멈춤…) | `stateText` | 11r-1 |
| `src/world/vocab.ts` `CLASSES[*].deviceKind`, `SIGHT` | 카메라 설비 종류 → 트윈 가전 종류, 카메라로 맞추는 속성 규칙 | `camera: { fixture, sight }` | 11r-1 |
| `src/agent/planTools.ts` `handUntil`(355행) | 문 상태 없는 가전의 카메라 설비 찾기(CLASSES deviceKind로) | `camera.fixture`를 읽음 | 11r-1 |
| `src/world/sight.ts` `linkDevice`·`rulesOf` | 위 카메라 낱말을 읽음 | 등록부를 읽음 | 11r-1 |
| `src/plan/names.ts`, `src/agent/{tools,prompts,planInput}.ts`, `src/server/start.ts` | `KIND_LABELS`를 읽음 | 그대로(파생된 `KIND_LABELS`) | 11r-1 |

**등록부 밖에 두는 것(종류별 표가 아님):** `src/world/relations.ts` `RELATIONS`(물건 종류 → 관련 가전 종류, 물건 기준 표), `src/world/vocab.ts` `DEVICE_LONG`의 상태·시간·글(종류 목록은 등록부 `longEvents`로), `ATTR_DEFAULTS`·`SENSOR_ATTRS`(속성 기준), `src/matter/deviceTypes.ts`(Matter 기기 종류 이름 → 엔드포인트, 기기 종류 이름 기준), `src/agent/phrases.ts`·`ui/src/bubbles/summary.ts`의 종류별 말 꾸밈 갈래(밝기·음량·냉방 모드 글, 제어·승인 길이 아니다). 대시보드 `KIND_ICON`(`ui/src/dashboard/steps.tsx`)은 가전 종류가 아니라 계획 단계 종류 표라 상관없다. 코치 행동 체계(`TaskSpec`)는 이미 행동 한 덩어리라 이번 범위 밖이다. `added_devices.json` 항목의 `landmark`(AR 위치 맞추기 기준점으로 쓰는가, 기본 빼기·`true`일 때만)는 물건마다 정하는 칸이라 등록부 칸이 아니다(`src/sync/landmarks.ts` `twinLandmarks`가 `landmark: false` 물건을 뺀다).

**Files:**
- Create: `src/model/kinds.ts`(등록부), `tests/kinds-registry.test.ts`(같은 결과 시험·구조 검사·프로필로 가르기 시험), `tests/fixtures/kind-tables/`(구조 검사 금지·허용 예제 파일), `scripts/kinds-snapshot.ts`(바꾸기 전 값을 뽑는 한 번 쓰는 명령), `tests/fixtures/kinds-before.json`
- Modify: `src/hub/types.ts`(`DeviceKind`를 등록부에서), `src/model/mapping.ts`(`KIND_PROFILES`·`KIND_LABELS`·`TYPE_RULES`를 파생으로, 프로필 타입은 kinds.ts로, `twinChange`·`heatingSetpoint`를 프로필로 가름), `src/agent/search.ts`(`KIND_SYNONYMS` 파생), `src/agent/policy.ts`(`CONFIRM_RULES`·`RISKY_ON_NAMES` 파생, 판정은 지금 그대로), `src/plan/labels.ts`(`CAUTION_LINE` 파생), `src/agent/planTools.ts`(`DEVICE_ACTS` 파생·`handUntil`), `src/thinq/appliance.ts`(`PAIRABLE_KINDS`·`TYPE_FIT` 파생만), `src/world/vocab.ts`(`CLASSES[*].deviceKind`·`SIGHT`·`DEVICE_TEXT`·`DEVICE_LONG[*].kinds` 지움), `src/world/sight.ts`·`src/world/state.ts`·`src/world/relations.ts`(등록부를 읽음), `docs/world-vocabulary.md`(생성 글), `Dockerfile`(ui 단계 COPY), `CLAUDE.md`(규칙 표 한 줄), `docs/reference.md`(새 종류 추가하는 법 1~4·6)
- Test: `tests/kinds-registry.test.ts`, 기존 시험 전체(`npm run heavy -- npx vitest run`, ui 시험), `tests/docker-ui-stage.test.ts`

**Interfaces:**
- Consumes: Task 11(`added_devices.json`으로 더한 `microwave_kitchen`).
- Produces(11r-2·11a·11b·12가 쓴다): `KINDS`, `KindEntry`, `KindProfile`, `HandAct`, `DeviceKind`, `KIND_ORDER`, `kindLabel`, `isRiskyKind`, `cameraKindOf`, `findKindTables`, `tests/fixtures/kinds-before.json`(승인 표 포함).

```ts
// src/model/kinds.ts: 가전 종류 등록부. 하나뿐인 원본. 런타임 import 없음(type import만: ../hub/types.js, ../world/vocab.js).
// ui 타입 검사가 hub/types.ts를 거쳐 읽으므로 Dockerfile ui 단계가 이 파일과 vocab.ts를 COPY한다.
export type HandAct = "켜기" | "끄기" | "열기" | "닫기";
export interface KindProfile { model: Model; matterDeviceType: string; capabilities: Capability[]; control?: Control; sensors: string[]; defaults?: …; setpoint?: …; modes?: …; fanOn?: …; levelTurnsOn?: true } // 지금 mapping.ts 타입 그대로 옮김
export interface KindEntry {
  label: string;                                          // 화면·에이전트 이름
  synonyms: readonly string[];                            // 찾기 말(소문자, 띄어쓰기 없음)
  profile: KindProfile;                                   // Matter 연결
  twinTypes: readonly { types?: readonly string[]; prefixes?: readonly string[]; matterDeviceType?: string; capabilities?: Capability[] }[]; // 트윈 type → 이 종류
  confirm?: { command: CommandType; reason: (label: string) => string };      // 지금 CONFIRM_RULES 그대로(lock unlock, cooktop on, microwave start)
  riskyOn?: { names: readonly string[]; caution: string };                    // 위험 가전(이름 기본 거부, 켜기 전 안전 문구)
  hand?: readonly HandAct[];                              // 사람이 손으로 하는 동작
  selfStop?: true;                                        // 다 되면 스스로 멈춤(Task 12가 더한다)
  camera?: { fixture: FixtureClass; sight: readonly SightRule[] };            // 카메라 설비 종류와 맞추는 규칙(Task 11a·11b가 값을 더한다)
  thinq?: { type: RegExp };                               // ThinQ 짝짓기(11r-2가 adapter 칸을 더한다)
  longEvents?: readonly DeviceLongKey[];                  // 오래 이어지면 나는 사건(냉장고·현관 문 1분 넘게 열림)
  stateText?: Partial<Record<DeviceStateKey, { label?: string; became?: string }>>;
}
/** 순서가 곧 TYPE_RULES 순서·도구 enum 순서다(지금 DeviceKind 순서 그대로). */
export const KINDS = { light: {…}, plug: {…}, …, status: {…} } as const satisfies Record<string, KindEntry>;
export type DeviceKind = keyof typeof KINDS;
// 파생(각 쓰는 곳은 이것만 읽는다)
export const KIND_ORDER: readonly DeviceKind[];
export const kindLabel: (k: DeviceKind) => string;
export const isRiskyKind: (k: string | null | undefined) => k is DeviceKind;   // riskyOn 있는 종류
export const cameraKindOf: (fixture: FixtureClass) => DeviceKind | null;       // camera.fixture로 거꾸로
// src/hub/types.ts: export type { DeviceKind } from "../model/kinds.js";
// src/model/mapping.ts: KIND_PROFILES = mapEntries(KINDS, (e) => e.profile), KIND_LABELS = mapEntries(KINDS, (e) => e.label),
//   TYPE_RULES = [...KIND_ORDER.flatMap((k) => KINDS[k].twinTypes.map((t) => ({ ...t, kind: k }))), { types: ["wall_pad", "robot"], twinOnly: true }]
//   twinChange·heatingSetpoint: profile.model === "lock" → lock/unlock, profile.model === "covering" → covering, 그 밖 → on/off.
//   heatingSetpoint: profile.model === "thermostat" || systemMode === "heat"(뒤 조건은 지금 그대로 둔다).
// src/agent/policy.ts: CONFIRM_RULES = KIND_ORDER.flatMap((k) => KINDS[k].confirm ? [{ kind: k, ...KINDS[k].confirm }] : []), RISKY_ON_NAMES는 riskyOn.names에서. requiresConfirmation은 지금 그대로.
// src/plan/labels.ts: CAUTION_LINE은 riskyOn.caution에서. src/agent/planTools.ts: DEVICE_ACTS는 hand에서.
// src/thinq/appliance.ts: PAIRABLE_KINDS = KIND_ORDER.filter((k) => KINDS[k].thinq), fitsKind는 KINDS[k].thinq?.type으로. 읽기·제어·반영 갈래는 그대로(11r-2).
```
- 칸 이름·모양을 틀리거나 필수 칸(`label`·`synonyms`·`profile`·`twinTypes`)을 빼면 `satisfies Record<string, KindEntry>`가 타입 오류를 낸다. 손으로 맞추던 목록(`DeviceKind` 유니언, `KIND_LABELS` 등 위 표에서 11r-1이 맡는 원본)은 지운다.
- 전자레인지 항목이 첫 사용 예다: `label: "전자레인지"`, `twinTypes: [{ types: ["microwave"] }]`, `confirm: { command: "start", … }`(지금 그대로, 11r-2가 `riskyReason`으로 바꾼다), `riskyOn: { names: [...], caution: "그릇이 뜨거워져요." }`, `hand: ["열기", "닫기", "켜기", "끄기"]`, `camera: { fixture: "microwave", sight: [...] }`. Task 11a가 sight에 명시 꺼짐 값을, Task 12가 `selfStop: true`를 더한다.

**구조 검사(`tests/kinds-registry.test.ts`, `npm test`·CI):** `src/`·`ui/src/`·`scripts/`의 TypeScript를 TypeScript 프로그램(구문 트리 + 타입 검사기)으로 읽어, `src/model/kinds.ts` 밖에서 아래가 나오면 실패한다. 까닭 글: 「가전 종류별 값은 src/model/kinds.ts 등록부 칸으로 둔다(새 종류는 등록부 한 줄 + added_devices.json 한 줄)」. 「종류 이름」은 등록부 키, 「카메라 설비 이름」은 등록부 `camera.fixture`에 나오는 이름이다.
- 타입에 `Record<DeviceKind, …>`·`Partial<Record<DeviceKind, …>>`·`DeviceKind[]` 값 목록을 직접 쓴 상수 선언(오른쪽이 `KINDS`·`KIND_ORDER`에서 만든 식이면 통과).
- 객체 리터럴에서 종류 이름이나 카메라 설비 이름인 키가 둘 이상(지금 `SIGHT`처럼 `tv`·`refrigerator`·`microwave`·`sink`가 섞인 표 포함). 계산 키(`["aircon"]`, 문자열 상수)도 그 값으로 본다.
- 계산 키의 식 타입이 `DeviceKind`(또는 그 일부 유니언)인 객체 리터럴(`{ [k]: v }`), 오른쪽이 `KINDS`·`KIND_ORDER`에서 만든 식이면 통과.
- `Object.fromEntries(…)` 호출의 인자에 종류 이름 문자열이 둘 이상 나오거나, 인자가 `DeviceKind`를 키로 하는 쌍 목록이면서 `KINDS`·`KIND_ORDER`에서 만든 것이 아닌 것.
- 배열 리터럴 안에 종류 이름 문자열이 둘 이상(`["aircon", "fridge"]`, `PAIRABLE_KINDS`·`DEVICE_LONG` kinds 같은 목록).
- 속성 `deviceKind`에 문자열 값(리터럴·종류 이름 상수)을 저장하는 자리(`deviceKind: "fridge"`). 이름 조회 콜백처럼 값이 함수인 자리(`deviceKind: (id) => …`, 인터페이스의 `deviceKind?: (id: string) => string`, `src/act/track.ts` 1047행·`src/agent/planTools.ts` 325행)는 허용.
- 종류 이름 문자열과 견주는 비교: `===`·`!==`·`switch`의 `case "<종류 이름>"`에서 다른 쪽 식의 타입이 `DeviceKind`(또는 그 일부 유니언)이거나 이름이 `kind`인 지역 변수·매개변수·`.kind` 속성인 것. 범위는 `src/`·`ui/src/`·`scripts/` 전체(`src/thinq/` 포함)이고, 허용은 말 꾸밈 두 파일(`src/agent/phrases.ts`·`ui/src/bubbles/summary.ts`)뿐이다. 계획 단계 종류(`step.kind === "go"` 등)는 다른 쪽 타입이 `DeviceKind`가 아니라 걸리지 않는다.
- **잠시 허용(11r-1에서만):** `src/thinq/appliance.ts`의 ThinQ 읽기·제어·반영 갈래(73·84·99·116·127행)는 허용 목록 `TEMP_ALLOW`에 그 파일·줄 내용으로 적고 까닭 「Task 11r-2에서 어댑터로 옮기며 지움」을 단다. 11r-2의 시험 「kinds registry: TEMP_ALLOW is empty」가 이 목록이 빈 것을 강제한다.
- 문자열 리터럴 `kind: "<종류 이름>"`가 든 배열 리터럴(규칙 목록).
- 시험 파일(`tests/`, 예제 폴더 제외)과 등록부는 검사하지 않는다.
- 검사 함수 `findKindTables(program, file): { line: number; rule: string }[]`를 따로 내보내 예제 파일로 시험한다.

**구조 검사 예제(`tests/fixtures/kind-tables/`):**
- 금지(하나씩 실패해야 한다): `Record<DeviceKind, string>` 상수, `{ aircon: 1, fridge: 2 }`, `{ tv: [...], refrigerator: [...] }`(지금 SIGHT 꼴), `{ ["aircon"]: 1, ["fridge"]: 2 }`, `const k: DeviceKind = …; ({ [k]: 1 })`, `Object.fromEntries([["aircon", 1], ["fridge", 2]])`, `Object.fromEntries(kinds.map((k) => [k, 1]))`(kinds: `DeviceKind[]` 리터럴), `["aircon", "fridge"]`, `{ deviceKind: "fridge" }`, `[{ kind: "light" }, { kind: "tv" }]`, `src/model/` 안의 `spec.kind === "lock"`, `src/thinq/` 안의 지역 변수 `if (kind === "aircon")`(잠시 허용 목록에 없는 줄), `switch (kind) { case "fridge": … }`.
- 허용(통과해야 한다): `{ deviceKind: (id: string) => lookup(id) }`, `interface X { deviceKind?: (id: string) => string | undefined }`, `const L: Record<DeviceKind, string> = mapEntries(KINDS, (e) => e.label)`, `Object.fromEntries(KIND_ORDER.map((k) => [k, KINDS[k].label]))`, TaskSpec의 `devices: { kinds: ["aircon"] }`(하나), `ui/src/bubbles/summary.ts` 꼴의 `d.kind === "aircon"` 말 꾸밈, 계획 단계 종류 비교 `step.kind === "go"`, 어댑터 이름 비교 `adapter === "air_conditioner"`.

**같은 결과 시험(21종 값이 전과 똑같다, 넓어짐도 없음):** 바꾸기 전 커밋에서 `scripts/kinds-snapshot.ts`로 지금 21종의 값을 `tests/fixtures/kinds-before.json`에 뽑아 둔다: 라벨, Matter 프로필 전체, 카탈로그의 모든 트윈 type에 대한 `findTypeRule` 결과, `CONFIRM_RULES`, **승인 표**(종류마다 기본 사양과 twinTypes 덮어쓴 사양에 표본 명령 on·off·start·stop·level·climate·lock·unlock·covering·valve를 보냈을 때 `requiresConfirmation` 결과), `RISKY_ON_NAMES`·`NOT_RISKY`로 본 `riskyNames` 표본 글 결과, `CAUTION_LINE`, `DEVICE_ACTS`, `KIND_SYNONYMS`, `PAIRABLE_KINDS`·`fitsKind` 표본, ThinQ 읽기·제어·트윈 반영 표본(aircon·fridge 원본 값 → `readAppliance`·`thinqSteps`·`mirrorPlan`), `DEVICE_TEXT`, `DEVICE_LONG` 사건, 카메라 설비 → 종류와 SIGHT 규칙, 종류마다 `twinChange` 결과. 바꾼 뒤 파생 값이 이것과 **모두 똑같은지** 본다(승인 표 포함, 한 칸도 달라지면 실패).
- 시험은 두 묶음으로 나눠 둔다: 「kinds same: non-approval」(라벨·Matter 프로필·트윈 type·별명·위험 이름·안전 문구·손 조작·ThinQ 짝짓기·사건·상태 글·카메라·`twinChange`)과 「kinds same: approval」(`CONFIRM_RULES`·승인 표). 11r-2는 뒤 묶음만 차이표 검사로 바꾸고, 앞 묶음은 11r-2 뒤에도 완전 일치로 남는다.
- 원본 스냅샷 `tests/fixtures/kinds-before.json`은 11r-2 뒤에도 고치지 않고 그대로 둔다(차이표의 기준이다). ThinQ 읽기·제어·반영 표본도 이 파일에서 읽어 11r-2 뒤에 완전 일치로 본다.

**프로필로 가르기 시험:** 「lock 프로필을 다시 쓰는 새 종류(시험 전용 등록부 확장)의 트윈 제어 attr을 바꾸면 lock/unlock 명령이 나간다(on/off가 아니다)」, 「covering 프로필을 다시 쓰는 새 종류면 covering 0·100%」, 「thermostat 프로필을 다시 쓰는 새 종류도 난방 설정점을 쓴다」, 「지금 21종의 `twinChange` 결과는 같은 결과 시험과 같다」.

- [ ] **Step 1: 실패하는 시험과 바꾸기 전 값.** 지금 코드(f0ace1f 위)에서 `npx tsx scripts/kinds-snapshot.ts > tests/fixtures/kinds-before.json`. `tests/kinds-registry.test.ts`에 같은 결과 시험(`src/model/kinds.ts`가 없어 실패), 구조 검사, 예제 시험, 프로필로 가르기 시험을 쓴다.
- [ ] **Step 2: 검사가 지금 코드에서 실제로 실패하는지 확인.** `npm run heavy -- npx vitest run tests/kinds-registry.test.ts` → 구조 검사가 11r-1이 맡는 흩어진 표 전부(`KIND_PROFILES`·`KIND_LABELS`·`TYPE_RULES`·`KIND_SYNONYMS`·`CONFIRM_RULES`·`RISKY_ON_NAMES`·`CAUTION_LINE`·`DEVICE_ACTS`·`PAIRABLE_KINDS`·`TYPE_FIT`·`DEVICE_TEXT`·`DEVICE_LONG` kinds·`CLASSES[*].deviceKind`·`SIGHT`·mapping.ts 324·325·482행)를 하나씩 이름과 줄로 짚고, 잠시 허용 목록의 thinq 줄과 이름 조회 콜백(track.ts 1047행·planTools.ts 325행)은 짚지 않는지 본다. 예제 파일의 금지·허용도 기대대로인지 본다. 하나라도 어긋나면 검사를 고친다. 프로필로 가르기 시험은 등록부가 없어 실패하는 것을 본다.
- [ ] **Step 3: 구현.** 등록부를 만들고 위 표에서 11r-1이 맡는 자리를 파생으로 바꾼다. `Dockerfile` ui 단계에 `src/model/kinds.ts`·`src/world/vocab.ts` COPY(`tests/docker-ui-stage.test.ts`가 본다). 낱말 표 문서를 다시 만든다.
- [ ] **Step 4: 통과 확인.** `npx tsc --noEmit -p .`, ui 타입 검사, `npm run lint`, `npm run heavy -- npx vitest run`(기존 시험 전체), ui 시험. 같은 결과 시험이 21종·승인 표 모두 똑같다고 보고, 프로필로 가르기 시험이 통과한다. 시험 하나 더: 「`added_devices.json`에 카탈로그도 3D 모델도 없는 새 type으로 등록부 새 종류 한 줄(시험 전용 등록부 확장) + 집 파일 한 줄이면 기기 목록에 그 종류로 생기고, 속성은 프로필 제어·센서 속성의 기본값(ATTR_DEFAULTS)이며, 대시보드 트윈에는 회색 상자(바닥 넓이·높이)로 그려진다」. 이 시험이 지금 코드로 안 되면 그 부분을 같은 Task에서 맞춘다.
- [ ] **Step 5: 문서와 규칙.** `docs/reference.md`에 아래 「새 종류 추가하는 법」 1~4·6. `CLAUDE.md` 규칙 표에 한 줄: 「가전 종류별 값(이름·Matter·트윈 type·위험 동작·손 조작·카메라 낱말)은 `src/model/kinds.ts` 등록부에만 둔다 | `tests/kinds-registry.test.ts`(등록부 밖 종류별 표를 찾으면 실패, 바꾸기 전 21종과 같은 결과)」.
- [ ] **Step 6:** 커밋 `refactor(model): move appliance kind tables into one registry and derive the rest without changing behavior`.

### Task 11r-2: 가전 종류 등록부 — 승인 판정 needsConfirm·ThinQ 어댑터·checkKinds

결과가 바뀌는 부분이다. 위험 켜기 종류(인덕션·전자레인지)의 승인 대상이 넓어지고(끄기 말고 상태를 바꾸는 명령 전부), ThinQ 읽기·제어·트윈 반영이 종류 이름 대신 어댑터로 가르며, 등록부가 틀린 조합을 시작 때 거절한다. 11r-1 다음, 11a 앞에 한다.

**Files:**
- Create: `src/model/kinds-check.ts`(등록부 검증 `checkKinds`), `tests/kinds-behavior.test.ts`(승인 차이표·승인 대상·ThinQ 어댑터·등록부 검증 시험)
- Modify: `src/model/kinds.ts`(위험 켜기 종류의 `confirm` → `riskyReason`, `thinq.adapter`), `src/agent/policy.ts`(`needsConfirm`, `requiresConfirmation`이 그것을 씀), `src/agent/planTools.ts`(`riskyHand`가 `needsConfirm`을 씀), `src/agent/planInput.ts`(계획 입력의 위험 목록 글을 등록부에서), `src/agent/prompts.ts`(에이전트 지시문의 승인 규칙 글을 등록부에서), `src/thinq/appliance.ts`(`THINQ_ADAPTERS`, 읽기·제어·반영을 어댑터로), `src/thinq/link.ts`(어댑터로 부름), `src/server/start.ts`(시작 때 `checkKinds`), `tests/kinds-registry.test.ts`(잠시 허용 목록 `TEMP_ALLOW`를 비움, 「kinds same: approval」 묶음을 지움), `docs/reference.md`(새 종류 추가하는 법 5), `CLAUDE.md`(승인 규칙 줄의 위험 목록 글)
- Test: `tests/kinds-behavior.test.ts`, `tests/kinds-registry.test.ts`, `tests/policy.test.ts`, `tests/approval.test.ts`, `tests/agent.test.ts`, `tests/agent-planner.test.ts`, `tests/act-track.test.ts`, `tests/thinq-appliance.test.ts`, `tests/thinq-link.test.ts`, 기존 시험 전체

**Interfaces:**
- Consumes: 11r-1의 `KINDS`·`KindEntry`·`DeviceKind`·`KIND_ORDER`·`isRiskyKind`·`findKindTables`·`tests/fixtures/kinds-before.json`(승인 표).
- Produces(11a·11c-2·12가 쓴다): `KindEntry.riskyReason`, `KindEntry.thinq.adapter`, `ThinqAdapter`, `THINQ_ADAPTERS`, `needsConfirm`, `checkKinds`.

```ts
// src/model/kinds.ts KindEntry에 더하고 바꾸는 칸
  confirm?: { command: CommandType; reason: (label: string) => string };      // 그 명령 하나를 늘 승인(잠금 해제처럼 프로필 모델이 내는 이름이 하나뿐인 명령). 위험 켜기 종류에는 쓰지 않는다
  riskyReason?: (label: string) => string;                // riskyOn 종류의 승인 까닭 글(켜기는 화재 위험…)
  thinq?: { type: RegExp; adapter: ThinqAdapter };       // 11r-1의 type에 어댑터를 더함(type import: ../thinq/appliance.js)
// 전자레인지·인덕션: confirm을 지우고 riskyReason: (l) => `${l} 시작은 사용자 승인이 필요합니다.`(인덕션은 「켜기는 화재 위험이 있어…」). lock은 confirm unlock 그대로.
// src/agent/policy.ts: 승인 대상 판정(하나뿐). 명령 이름 정규화나 capabilities 덮어쓰기와 상관없이 기본 거부다.
export function needsConfirm(device: Pick<DeviceSpec, "kind" | "capabilities">, cmd: Command): boolean;
//   riskyOn 종류: 그 기기 사양으로 정규화한 명령이 끄기(off·stop)가 아니면 모두 승인 대상(on·start와, 그 사양이 받는 다른 상태 바꾸기 명령: level·climate 등 켜짐으로 갈 수 있는 것 전부).
//   confirm이 있는 종류: 정규화한 명령 이름이 confirm.command일 때. 그 밖: 승인 없음.
//   requiresConfirmation·riskyHand·실행 추적의 손 조작 켜기 질문이 모두 이것을 쓴다. 계획 입력 「위험 목록」 글과 에이전트 지시문 승인 규칙 글은 riskyOn 종류(「켜기·시작 등」)와 confirm 명령에서 만든다.
//   더 단순한 길을 고른 까닭: 「켜지게 하는 명령」을 사양마다 하나하나 찾아 목록으로 맞추는 길은 사양·명령이 늘 때마다 빠뜨릴 수 있다. 위험 켜기 종류는 「끄기 말고 전부」로 두면
//   목록이 필요 없고, 덮어쓴 capabilities·새 명령 종류가 생겨도 기본으로 묻는다(끄기를 묻지 않는 것만 예외라 안전 쪽으로 틀린다).
// src/thinq/appliance.ts: 종류 이름이 아니라 어댑터 이름으로 가른다(어댑터 이름은 가전 종류 이름과 다르게 짓는다)
export type ThinqAdapter = "air_conditioner" | "refrigerator";
export const THINQ_ADAPTERS: Record<ThinqAdapter, {
  read: (raw: Record<string, unknown>) => Reading;
  /** 받는 명령 종류(정규화한 이름). 빈 목록이면 읽기만. */
  commands: readonly CommandType[];
  steps: (cmd: Command) => ThinqStep[] | null;
  /** 읽은 값을 트윈(안쪽 허브)에 비추는 명령·센서 값(지금 mirrorPlan의 갈래). */
  mirror: (r: Reading, world: Pick<DeviceState, "twin" | "matter">) => { commands: Command[]; sensors: [string, unknown][] };
}>;
//   air_conditioner: 지금 readAppliance·thinqSteps·mirrorPlan의 aircon 갈래, commands ["on", "off", "climate"]. refrigerator: fridge 갈래, commands [](읽기만), mirror는 문 센서.
//   readAppliance·thinqSteps·mirrorPlan은 어댑터를 받고(src/thinq/link.ts가 등록부 thinq.adapter로 고른다) 종류 이름으로 가르지 않는다.
// src/model/kinds-check.ts: 등록부 검증(런타임). 시험과 서버 시작(src/server/start.ts)이 부르고, 틀리면 까닭 목록으로 시작을 막는다.
export function checkKinds(kinds: Readonly<Record<string, KindEntry>>): string[];
//   1) confirm.command는 그 종류의 모든 실제 사양(기본 프로필, twinTypes마다 capabilities·matterDeviceType를 덮어쓴 것)에서 정규화해도 같은 이름이고 그 사양이 받는 명령이어야 한다
//      (checkCommand). 정규화로 이름이 바뀌는 명령(on·off처럼 동작형에서 start·stop이 되는 것)은 confirm에 쓰지 않는다.
//   2) riskyOn 종류에는 confirm을 쓰지 않고 riskyReason을 둔다.
//   3) thinq가 있으면: 그 종류의 모든 실제 사양이 낼 수 있는 명령(capabilities를 정규화한 이름: onoff → on·off, operation만 → start·stop, climate → climate, level → level, covering → covering, lock → lock·unlock, valve → valve)이
//      모두 adapter.commands 안이어야 한다. 읽기만 하는 어댑터(commands [])에는 제어 없는 프로필만 붙인다. 어긋나면 「ThinQ 어댑터 air_conditioner는 start를 받지 않는다」처럼 거절.
//   4) hand의 켜기·끄기는 프로필 제어가 있을 때만, 열기·닫기는 문 센서(door)가 있거나 그 종류 camera 설비가 열림(open) 면을 볼 때만.
```

**승인 차이표 시험(`tests/kinds-behavior.test.ts`):** 11r-1이 뽑은 승인 표(`kinds-before.json`)와 지금 `needsConfirm` 결과를 같은 칸(종류 × 사양 × 표본 명령)마다 견준다. **전에 승인이던 칸은 모두 지금도 승인(좁아진 것 없음)**이고, 새로 승인이 된 칸은 모두 위험 켜기 종류(`riskyOn`)의 끄기 아닌 명령이어야 한다(넓어진 것만). 넓어진 칸의 목록을 시험 출력에 찍는다.

**승인 대상 시험:** **「twin type이 capabilities를 `["onoff", "operation"]`으로 덮은 전자레인지에 `on`을 보내도 승인 질문이 나온다(이름이 start로 정규화되지 않아도)」**, 「같은 기기의 `start`·level 같은 다른 바꾸기 명령도 승인」, 「`off`·`stop`은 승인 없이 간다」, 「cooktop `on`은 승인」, 「lock `unlock`은 승인, `lock`은 승인 없음」, 「위험 종류가 아닌 에어컨 `on`은 승인 없음(말로 시킨 명령)」, 「실행 추적의 손 조작 켜기 질문도 같은 판정으로 나온다」.

**ThinQ 어댑터 시험:** **「시험 전용 새 종류(refrigerator 어댑터, 문 센서 프로필)를 짝지어 ThinQ 원본 값을 읽으면 어댑터 read → mirror를 거쳐 트윈 문 센서가 바뀐다」**, 「air_conditioner 어댑터로 짝지은 시험 전용 새 종류가 climate 명령을 ThinQ 단계로 바꾸고, 읽은 전원·모드가 트윈에 비친다」, 「`readAppliance`·`thinqSteps`·`mirrorPlan`이 종류 이름을 받지 않는다(타입)」, 「aircon·fridge의 ThinQ 읽기·제어·반영 표본은 11r-1 같은 결과 시험과 같다」.

**등록부 검증(`checkKinds`) 시험:** 「lock의 `confirm.command: "unlock"`은 통과」, 「operation 종류에 `confirm.command: "on"`(정규화로 이름이 바뀜)이면 거절」, 「riskyOn 종류에 confirm을 두면 거절(riskyReason을 쓴다)」, 「operation 프로필에 air_conditioner 어댑터를 붙이면 「start를 받지 않는다」로 거절」, 「twinTypes가 capabilities를 덮어 operation을 더한 사양도 어댑터 명령 검사에 들어간다」, 「제어가 있는 프로필에 refrigerator 어댑터를 붙이면 거절」, 「지금 21종 등록부는 까닭 없음」, 「서버 시작이 틀린 등록부에서 까닭과 함께 멈춘다」.

**ThinQ: 어댑터를 고른 까닭.** 「지원하지 않는 조합을 검증에서 거절」만 하려면 지원 종류 목록(`["aircon", "fridge"]`)이 등록부 밖에 또 생겨 11r-1의 구조 검사와 부딪친다. 어댑터 이름을 등록부 칸으로 고르게 하면 지원 여부가 타입(`ThinqAdapter`)으로 바로 정해지고, 지금 코드의 두 갈래를 어댑터 둘로 옮기기만 하면 돼 바꿀 양도 더 작다. 제어가 없는 어댑터에 제어 프로필을 붙이는 조합과 받는 명령이 맞지 않는 조합만 `checkKinds`가 거절한다.

- [ ] **Step 1: 실패하는 시험.**
  - `tests/kinds-registry.test.ts`의 「kinds same: approval」(승인 표·`CONFIRM_RULES` 완전 일치) 묶음을 지우고, 그 자리를 `tests/kinds-behavior.test.ts`의 「approval diff: only widened, never narrowed」(위 승인 차이표, 기준은 그대로 둔 `kinds-before.json`)로 바꾼다. 「kinds same: non-approval」 묶음은 그대로 둔다.
  - `tests/kinds-registry.test.ts`에 「kinds registry: TEMP_ALLOW is empty」를 더한다(허용 목록에 줄이 하나라도 있으면 실패, 까닭 글 「ThinQ 갈래를 어댑터로 옮기고 TEMP_ALLOW를 비운다」).
  - `tests/kinds-behavior.test.ts`에 승인 대상·ThinQ 어댑터·등록부 검증 시험을 쓴다.
- [ ] **Step 2: 실패 확인.** `npm run heavy -- npx vitest run tests/kinds-behavior.test.ts tests/kinds-registry.test.ts` → 「kinds registry: TEMP_ALLOW is empty」가 지금 허용 목록(thinq 다섯 줄) 때문에 실패하고, 승인 대상 시험(덮은 전자레인지 `on`이 지금은 승인 없이 감)·ThinQ 어댑터·`checkKinds` 없음으로 실패하는 것을 본다. 「approval diff」는 아직 넓어진 칸이 없어 통과하고, 「kinds same: non-approval」도 통과한다.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** 두 시험 파일과 기존 시험 전체, ui 시험. 「kinds same: non-approval」은 완전 일치, 「approval diff」는 넓어진 칸만(위험 켜기 종류의 끄기 아닌 명령), 「TEMP_ALLOW is empty」는 통과. 기존 승인 시험(`tests/policy.test.ts`·`tests/approval.test.ts`·`tests/agent.test.ts`·`tests/act-track.test.ts`)에서 위험 켜기 종류의 끄기 아닌 명령을 승인 없이 기대하던 곳이 있으면 승인 차이표와 같게 고친다(좁히는 쪽으로는 고치지 않는다).
- [ ] **Step 5: 문서와 규칙.** `docs/reference.md` 「새 종류 추가하는 법」 5. `CLAUDE.md` 승인 규칙 줄의 위험 목록 글을 「현관 잠금 해제, 인덕션·전자레인지는 끄기 말고 상태를 바꾸는 명령 전부」로 고치고 막는 장치에 `tests/kinds-behavior.test.ts`를 더한다.
- [ ] **Step 6:** 커밋 `feat(policy): confirm every non-off command on risky kinds, route ThinQ through adapters and validate the kind registry`.

**새 종류 추가하는 법(`docs/reference.md`에 넣을 단락, 1~4·6은 11r-1, 5는 11r-2가 쓴다):**
1. `src/model/kinds.ts`의 `KINDS`에 항목 하나를 더한다: `label`(이름), `synonyms`(찾기 말), `profile`(Matter 기기 종류·기능·제어 속성·센서), `twinTypes`(트윈 type 이름). 사람이 손으로 조작하면 `hand`, 다 되면 스스로 멈추면 `selfStop`, ThinQ와 짝지으면 `thinq`. 필수 칸을 빼면 타입 오류가 난다.
2. 집 파일 `twin/data/homes/<집>/added_devices.json`에 한 줄을 더한다: `id`·`type`(1번 `twinTypes`의 이름)·`label`·`room`·`position`·`facing_deg`·`elevation`.
3. 카메라로 볼 수 있으면: YOLO(COCO)에 그 종류가 있으면 `src/world/vocab.ts` `CLASSES`에 설비 종류(role fixture)를 두고, 없으면 `from`(다른 감지에서 바꾸기)을 둔 설비 종류를 둔다. 그리고 등록부 항목에 `camera: { fixture, sight }`를 적는다.
4. 3D 모델이 없으면: 카탈로그(`twin/data/catalog/<type>.json`)나 모델 파일이 없어도 기기는 생기고, 대시보드 트윈에는 그 자리의 회색 상자로 보인다. 모양을 넣으려면 카탈로그와 `twin/library/assets/`의 모델을 더한다.
5. (11r-2) 불·열이 나는 가전은 `riskyOn`과 `riskyReason`을 둔다(끄기 말고 상태를 바꾸는 명령은 전부 승인 질문). 잠금 해제처럼 명령 하나만 승인하려면 `confirm`에 그 명령 이름을 적는다(정규화로 이름이 바뀌는 on·off는 쓰지 않는다). ThinQ로 짝지으려면 이미 있는 어댑터(`air_conditioner`·`refrigerator`) 가운데 받는 명령이 맞는 것을 `thinq.adapter`로 고르고, 맞는 어댑터가 없으면 `src/thinq/appliance.ts`에 어댑터를 먼저 더한다. 틀린 조합은 서버 시작 때 `checkKinds`가 까닭과 함께 막는다.
6. `npm run heavy -- npx vitest run tests/kinds-registry.test.ts`(11r-2 뒤로는 `tests/kinds-behavior.test.ts`도)로 확인한다.

### Task 11a: 가전 이력에 근거의 촬영 시각과 종류(명시·추정) 남기기

카메라로 맞춘 가전 상태(SIGHT)는 VLM 답이 도착한 시각으로 이력에 쌓인다(`src/observe/pipeline.ts` `onDevice` → `world.applyDevice(s, this.clock.now())`). 켜라고 하기 전(또는 단계 시작 전)에 찍은 사진의 답이 늦게 오면 그 뒤의 바뀜으로 보여 세 곳이 뚫린다: 끄기 안내를 지우는 `offSince`(fec2e7d), Task 12의 꺼짐 기다리기, 단계 끝 조건 `became`(`src/world/conditions.ts`, `h.at_ms >= sinceMs`, 끄기 do가 끝나 hot이 풀림). 이 Task는 근거 사진의 촬영 시각을 남기고 세 곳이 그것을 보게 한다.

또 지금 SIGHT는 VLM 답에 「쓰는 중」이 없으면 꺼짐으로 만든다(`absent: "off"`, `src/world/sight.ts` 59행). 가전이 크게 보여도 전원 표시를 못 본 답만으로 꺼짐이 되어, 가열 중인데 안전 추적이 풀릴 수 있다. 그래서 VLM이 꺼짐을 직접 답한 「명시 꺼짐」과 답이 없어 넣은 「추정 꺼짐」을 나눠 남긴다. 추정 꺼짐은 지금처럼 트윈 상태에는 쓰고, 안전 해제(Task 11c-1 `cycleEnded`)에는 쓰지 않는다. Task 11c-1·12보다 먼저 한다.

**Files:**
- Modify: `src/world/vocab.ts`(`STATES.not_in_use`), `src/model/kinds.ts`(등록부 `microwave.camera.sight`의 values, Task 11r-1), `docs/world-vocabulary.md`(낱말 표 생성 글), `src/world/sight.ts`(안정 셈의 첫 프레임 촬영 시각, 값마다 명시·추정), `src/observe/pipeline.ts`(카메라로 바꾼 가전 상태에 촬영 시각을 실어 보냄), `src/hub/types.ts`·`src/hub/signals.ts`(가전 상태 알림에 `seenAt` 칸), `src/contract/world.ts`(이력 칸), `src/world/state.ts`(`applyDevice`), `src/world/conditions.ts`(`became`), `src/act/track.ts`(`offSince`)
- Test: `tests/vision-devices.test.ts`, `tests/world-state.test.ts`, `tests/world-conditions.test.ts`, `tests/act-track.test.ts`, `tests/world-vocab.test.ts`, `tests/observe-scene.test.ts`

**Interfaces:**
- Consumes: Task 11r-1의 `KINDS`(`microwave.camera.sight`에 값을 더함)·`cameraKindOf`, Task 11r-2 뒤에 한다(등록부 칸과 승인 판정이 굳은 뒤).
- Produces(11c-1·11b·12가 쓴다): 이력 `seen_ms`·`explicit`, `sight_last`(속성마다 `{ value, seen_ms, explicit }`, 11c-1이 `close`를 더함), `offSince`, 명시 꺼짐 값 `not_in_use`.

```ts
// src/contract/world.ts WorldDevice.history 한 줄
{ attr: string; from: unknown; to: unknown; at_ms: number; /** 카메라로 본 바뀜이면 그 근거 사진의 촬영 시각(안정 셈을 채운 연속 프레임 가운데 가장 이른 것). 허브·실제 가전 신호면 없음. */ seen_ms?: number;
  /** 카메라로 본 바뀜이면 VLM이 그 값을 직접 답했는가(true 명시, false 답이 없어 넣은 추정). 허브·실제 가전 신호면 없음(명시로 본다). */ explicit?: boolean }
// src/contract/world.ts WorldDevice.sight_last: 속성마다 카메라가 마지막으로 이어 본 값·촬영 시각·근거 종류(상태가 바뀌지 않아도 남는다)
sight_last?: Record<string, { value: unknown; seen_ms: number; explicit: boolean }>;
// src/world/vocab.ts STATES에 더함(VLM 스키마 enum·프롬프트 값 목록이 여기서 나온다, src/observe/scene.ts)
not_in_use: { facet: "use", label: "꺼져 있음", for: ["fixture"], hint: "appliance clearly switched off: no light, display, flame or heat visible" },
// 등록부(src/model/kinds.ts, Task 11r-1) KINDS.microwave.camera.sight: 명시 꺼짐 값을 더한다(absent는 그대로 두어 트윈 상태는 지금처럼 바뀐다)
sight: [{ facet: "use", attr: "power", values: { in_use: "on", not_in_use: "off" }, absent: "off" }, /* open 규칙 그대로 */],
// Task 11b의 KINDS.cooktop.camera.sight도 같은 values({ in_use: "on", not_in_use: "off" })로 만든다.
// src/world/sight.ts: 값마다 명시(values에서 옴)·추정(absent에서 옴)을 함께 낸다
export function sightValues(...): Record<string, { value: unknown; explicit: boolean }>;
// src/world/state.ts
applyDevice(s: DeviceState, atMs: number, evidence?: { seenMs: number; explicit: boolean }): WorldChange[];
// src/act/track.ts
/** 켜라고 한 시각 뒤에 꺼졌다고 새로 보였는가. 근거 시각은 seen_ms(카메라), 없으면 at_ms(허브 신호 도착). 근거 시각이 onAt보다 뒤여야 한다. */
function offSince(d: WorldView["devices"][number] | undefined, onAt: number): boolean; // h.from !== off && h.to === off && (h.seen_ms ?? h.at_ms) > onAt
// src/world/conditions.ts became: 근거 시각이 단계 시작 시각 뒤여야 한다
//   d.history.some((h) => (h.seen_ms ?? h.at_ms) >= x.sinceMs && h.attr === s.attr && h.to === s.value && h.from !== null && h.from !== s.value)
```
- 같은 값 생략은 값과 근거 종류가 모두 같을 때만 한다. 값이 같아도 근거 종류가 바뀌면(추정 꺼짐 → 명시 꺼짐, 그 반대) 이력 줄 `{ from: 꺼짐, to: 꺼짐, seen_ms, explicit }`을 남기고 World State 변화(판단 계기 아님)로 알린다. 같은 값·같은 종류의 새 촬영은 이력 줄 대신 `sight_last`의 촬영 시각만 새로 쓴다(사진마다 줄이 늘지 않게).
- Task 11c-1의 `cycleEnded`가 이 `offSince`를 감싸 쓰고(명시 근거만), 단계 끝 조건 `became`도 같은 근거 시각을 쓴다. `became`은 추정 근거도 지금처럼 받는다(단계 진행용, 안전 해제는 `cycleEnded`만).

- [ ] **Step 1: 실패하는 시험.** 「SIGHT로 꺼짐이 된 이력 줄에 근거 사진들 가운데 가장 이른 촬영 시각이 `seen_ms`로 남는다」, 「VLM이 「꺼져 있음」을 답한 꺼짐은 `explicit: true`, 「쓰는 중」을 말하지 않아 넣은 꺼짐은 `explicit: false`이고 둘 다 트윈 상태는 꺼짐」, 「VLM 스키마 enum과 프롬프트 값 목록에 `not_in_use`가 있다」, 「추정 꺼짐 뒤 명시 꺼짐이 오면 값이 같아도 명시 이력 줄이 생긴다」, 「같은 값·같은 종류가 이어지면 줄이 늘지 않고 `sight_last` 촬영 시각만 바뀐다」, 「허브로 바뀐 이력 줄에는 `seen_ms`가 없다」, 「켜라고 한 뒤(onAt) 도착했지만 onAt 전에 찍은 꺼짐 사진 답이면 `offSince`가 거짓: 끄기 안내가 그대로 떠 있고 hot도 그대로」, 「onAt 뒤에 찍은 꺼짐 사진이면 참」, 「끄기 do 단계가 시작되기 전에 찍힌 꺼짐 사진의 답이 단계 시작 뒤 도착하면 `became: off`가 거짓이라 그 단계가 끝나지 않고 hot이 남는다」, 「단계 시작 뒤 찍힌 꺼짐이면 끝난다」, 「허브 신호(`seen_ms` 없음)는 지금처럼 도착 시각으로 본다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/vision-devices.test.ts tests/world-state.test.ts tests/act-track.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `fix(world): keep capture time and explicit-or-inferred kind of camera evidence in device history`.

### Task 11b: 인덕션 전원을 카메라로 보기(인덕션 자리와 겹치는 oven만)

인덕션 전원은 카메라로 맞추는 표(`SIGHT`)에 없고, 손으로 켜라는 명령은 허브 상태를 바꾸지 않는다. 그래서 라면 7번 켜기(`became on`)와 12번 끄기(`became off`)가 영상으로는 끝나지 않는다. COCO에는 인덕션 종류가 없고 `oven`(69)이 상판을 잡을 때가 있다. 감지 종류(oven)와 확인된 설비(인덕션)를 나눈다: 그 방 트윈 인덕션 자리와 겹치는 oven 감지만 인덕션 설비로 바꾸고, 관찰 텍스트·이름표·기록에는 「인덕션」으로 낸다. 겹치지 않는 oven은 지금처럼 「오븐」이고 트윈 가전에 맞추지 않는다. 안전 규칙은 그대로다.

**Files:**
- Modify: `src/world/vocab.ts`(`CLASSES.cooktop` 새 카메라 설비 종류), `src/model/kinds.ts`(등록부 `cooktop.camera`, Task 11r-1), `src/world/sight.ts`(`refineFixture`), `src/observe/pipeline.ts`(VLM 감지 목록·World State에 넣기 전에 바꿈), `docs/world-vocabulary.md`(낱말 표 생성 글), `tests/fixtures/`(인덕션 사진 고정 자료)
- Test: `tests/vision-devices.test.ts`, `tests/world-vocab.test.ts`, `tests/brain-detector.test.ts`, `tests/observe-pipeline.test.ts`, `tests/act-track.test.ts`

**Interfaces:**
- Consumes: Task 11a의 명시 꺼짐(`not_in_use`)·`sightValues`, Task 11c-1의 `cycleEnded`·`releaseIfOff`. 11c-1 다음에 하므로 인덕션 카메라 근거로 추적이 풀리는 시험은 여기서 더한다.

```ts
// src/world/vocab.ts: COCO에 바로 없는 설비 종류. from은 이 종류로 바꿀 수 있는 감지 종류와 그 자리의 평면도 종류.
cooktop: { label: "인덕션", role: "fixture", coco: {}, from: { cls: "oven", place: "induction_counter" }, minScore: 0.5, facets: ["use"] },
// oven은 그대로(등록부 어느 종류의 camera.fixture도 아님, 「오븐」).
// 등록부(src/model/kinds.ts) KINDS.cooktop에 더함: 카메라 설비 종류 cooktop을 트윈 인덕션(cooktop)에 잇는다
camera: { fixture: "cooktop", sight: [{ facet: "use", attr: "power", values: { in_use: "on", not_in_use: "off" }, absent: "off" }] },   // 명시 꺼짐(not_in_use)은 Task 11a
// src/world/sight.ts
/** 인덕션 상판 확인. 아래 셋을 모두 지나야 cooktop으로 바꾼 감지를 내고, 하나라도 못 보거나 어긋나면 그대로(oven) 둔다(확실하지 않으면 바꾸지 않는다).
 *  1) 같은 방에 from.place(induction_counter) 평면도 물건이 있다.
 *  2) 상판 높이 평면 교차: 마스크 윗줄 가운데·아랫줄 가운데 화소(원본 사진 좌표, frame 크기로 카메라 광선을 만든다)의 광선을 그 물건 윗면 높이(topY, 장면 높이 값) 평면과 만나게 해,
 *     두 점이 모두 그 물건 바닥 넓이(+0.15m) 안이다. 바닥 평면으로 투영하지 않는다(상판보다 뒤로 밀려 정상 감지가 떨어진다).
 *  3) 위아래 범위: 그 물건 윗면 다각형(바닥 넓이 네 모서리를 topY 높이에 둔 것)을 사진에 투영해 가장 낮은 화소 줄(가장 큰 y)을 구하고,
 *     마스크 맨 아랫줄이 그 줄보다 사진 높이의 4% 넘게 아래로 내려가지 않는다(빌트인 오븐 문처럼 상판 아래로 길게 내려간 감지는 아니다).
 *     가까운 변의 가운데가 아니라 다각형 전체의 가장 낮은 줄이라 비스듬히 본 상판 모서리도 기준 안에 든다. */
export function refineFixture(d: Detection, o: {
  view: CameraView | null; frame: { width: number; height: number }; room: string | null;
  places: readonly { id: string; type: string; room: string | null; footprint: [number, number][]; topY: number }[];
}): Detection;
```
- 바꾼 감지는 VLM 감지 목록에도 cooktop(「인덕션」)으로 간다. 그래서 관찰 텍스트·대시보드 이름표·기록 줄에 「인덕션」으로 나오고, `linkDevice`가 같은 방 트윈 인덕션(cooktop)에 맞춘다(같은 방, 시야 안, 각도, 안정 셈 그대로).
- 낱말 표 검사(`tests/world-vocab.test.ts`)는 `coco`가 빈 종류를 `from`이 있을 때만 받게 고친다.

- [ ] **Step 0: 재기(비용 0).** 코치 계획의 `turn-on.mp4`·`turn-off.mp4`(아래 「찍을 영상」에서 바꾼 것)에서 프레임 8장을 뽑아 이 저장소 감지기로 인덕션 상판이 `oven` 0.5 이상으로 잡히는지 본다. 4장 아래면 이 Task를 멈추고 아래 「비전으로 못 볼 때」로 가고 사용자에게 보고한다(감지 기준을 낮추지 않는다).
- [ ] **Step 1: 실패하는 시험.**
  - 「주방 눈에서 인덕션 자리와 겹치는 oven 감지 + VLM 쓰는 중이 두 프레임 이어지면 트윈 인덕션 power on」, 「쓰는 중을 말하지 않는 답이 두 프레임 이어지면 off」.
  - 「인덕션 자리와 겹치지 않는 oven(같은 방 다른 자리)은 `refineFixture`가 바꾸지 않고, 쓰는 중이어도 트윈 인덕션 상태가 바뀌지 않는다」, 「다른 방의 oven도 그대로」.
  - 「겹치는 oven이 들어간 관찰 텍스트·World State 설비 이름·기록 줄에 「인덕션」이 있고 「오븐」이 없다」, 「겹치지 않는 oven은 지금처럼 「오븐」」.
  - 상판 높이: 「마스크 아랫줄을 바닥 평면으로 투영하면 인덕션 바닥 넓이 밖(뒤)이지만 상판 높이(0.9m) 평면과 만나면 안인 감지는 cooktop으로 바뀐다」(고정 카메라 자세·사진 크기로 만든 사례).
  - 비스듬히 본 상판: 「인덕션을 45도 옆에서 가까이 본 정상 상판(마스크 맨 아랫줄이 가까운 변 가운데 줄보다 낮지만 투영한 상판 다각형의 가장 낮은 줄 안)은 cooktop으로 바뀐다」.
  - 빌트인 오븐: 「인덕션 바로 아래 오븐 문(마스크가 투영한 상판 다각형의 가장 낮은 줄보다 사진 높이 10% 아래까지 내려감)은 평면 자리가 같아도, 비스듬히 봐도 cooktop이 안 된다」, 「그 오븐이 쓰는 중 → 아님으로 바뀌어도 트윈 인덕션 상태·hot·끄기 안내가 바뀌지 않는다」.
  - 「눈 자세(view)를 모르거나 사진 크기를 모르면 바꾸지 않는다」.
  - 추적 풀기(Task 11c-1 판정): 「인덕션 카메라로 켜짐 → 명시 꺼짐(「꺼져 있음」)을 보면 `cycleEnded.switch`가 서고 라면 12번 hot과 끄기 안내가 풀린다」, 「추정 꺼짐만 이어지면 풀리지 않는다」.
  - 「`turn-on.mp4` 고정 사진에서 감지기가 oven을 내고, 그 자리가 인덕션과 겹친다」, 낱말 표 문서가 새 표와 같다.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/vision-devices.test.ts tests/world-vocab.test.ts tests/brain-detector.test.ts tests/observe-pipeline.test.ts tests/act-track.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현. 낱말 표 문서를 다시 만든다.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(world): read induction power from oven detections that overlap the induction counter`.

**비전으로 못 볼 때(Step 0에서 안 잡힐 때):** 켜기 단계(7번)는 「완료」로 넘길 수 있다(`--done-on <초>:인덕션을 켜 주세요`). 끄기는 「완료」로 인정하지 않는다(Task 11c-1): 12번을 「완료」로 넘겨도 hot이 남고 끄기 안내가 계속 간다. **라면 시연이 깨끗하게 끝나지 않는다.** 이때는 사용자 결정이 필요하다(「남은 결정」 5).

### Task 11c-1: 끄기 추적은 확인된 꺼짐으로만 풀기 — 판정·풀기·다시 걸기(명령 줄 안내)

코디네이터 결정(2026-11-15): 11c는 아직 없는 11d(안전 안내 자리)와 Task 12(전자레인지 7번)에 기대는 부분이 있어 둘로 나눈다. **11c-1**은 지금 있는 것만으로 할 수 있는 핵심(판정·풀기·다시 걸기, 지금 명령 줄에 뜨는 끄기 안내의 동작)이고, **11c-2**는 11d 뒤에 안내를 안전 안내 자리로 옮기는 일이다. 7번 「다 되기 기다리기」가 `cycleEnded`로 끝나는 시험은 Task 12로 옮긴다. 차례: 11c-1 → 11d → 11c-2 → 12.

지금 코드에는 실제로 끄지 않아도 켠 위험 가전 추적(실행 중 hot, 닫힌 뒤 끄기 안내)을 푸는 길이 있다. `src/act/track.ts`(79ff269)에서 찾은 지우는 자리 전부:

| 자리 | 하는 일 | 새로 본 꺼짐인가 | 맡는 Task |
|---|---|---|---|
| `onAnswer` 326행 | 끄기 안내에 「완료」 단추 → `clearReminder()` | 아님 | 11c-1 |
| `onHeard` 369~372행 | 끄기 안내가 떠 있을 때 말 「완료」·「다 했어」 → `clearReminder()` | 아님 | 11c-1 |
| `reminderTick` 640행 | `offSince`이면 지움(앞 값 null도 참), **`offHoldMs`(120초) 지나면 지움** | 만료는 아님 | 11c-1 |
| `nextReminder` 618행 | 줄에서 꺼낼 때 `offSince`인 가전은 건너뜀 | 앞 값 null도 참 | 11c-1(한 판정으로 옮김) |
| `advance` 800행 | 끄기 do 단계가 끝나면(「완료」 포함) `r.hot.delete` | 아님 | 11c-1 |
| `finish` 1089행 | 닫힐 때 hot을 끄기 안내 줄로 옮긴 뒤 `r.hot.clear()` | 옮기기(풀기 아님) | 11c-1(옮기기 함수로) |
| `stop` 553행 | 집을 닫거나 서버를 끌 때 추적이 메모리와 함께 사라짐 | 아님 | 이 계획 밖(「그 뒤」) |

단계 진행과 안전 추적을 나눈다. 「작동 한 번 끝남」은 한 함수(`cycleEnded`)만 판정하고, 추적을 푸는 것은 한 함수(`releaseIfOff`)만 한다. 끄기 do 단계의 hot 풀기·끄기 안내 지우기가 이 둘을 쓰고, Task 12의 7번 꺼짐 기다리기도 쓴다. 11c-1에서 끄기 안내는 지금처럼 명령 줄에 뜬다.

**Files:**
- Modify: `src/act/track.ts`(`Run.onAt`, `cycleEnded`, `releaseIfOff`, `rearmIfOn`, `handOver`, `askToShow`, `onAnswer`, `onHeard`, `reminderTick`, `nextReminder`, `advance`, `tick`, `finish`), `src/contract/world.ts`·`src/world/state.ts`·`src/world/sight.ts`(`sight_last` 속성마다 `close` 칸), `src/plan/labels.ts`(`SAY_TEXT.offWait`, `EXEC_TEXT.deferred`), `src/act/say.ts`, `CLAUDE.md`(규칙 표 한 줄)
- Create: `tests/act-track-release.test.ts`
- Test: `tests/act-track.test.ts`, `tests/act-track-release.test.ts`, `tests/vision-devices.test.ts`, `tests/act-say.test.ts`, `tests/coach-e2e.test.ts`, `tests/agent-planner.test.ts`

**Interfaces:**
- Consumes: Task 11a의 이력 `seen_ms`·`explicit`과 `sight_last`(속성마다 `{ value, seen_ms, explicit }`), Task 11(전자레인지 기기, 시험용).
- Produces(11d·11c-2·12가 쓴다): `Run.onAt`(회차), `cycleEnded`, `releaseIfOff`, `rearmIfOn`, `handOver`, `askToShow`, `sight_last[attr].close`, `TRACK_DEFAULTS.rearmMs`·`showAskMs`, `SAY_TEXT.offWait`, `EXEC_TEXT.deferred`.

```ts
// src/contract/world.ts WorldDevice.sight_last: Task 11a가 만든 모양(속성마다 마지막 카메라 관측)에 close 칸을 더한다. SIGHT 안정 셈을 채운 관측일 때만 쓴다.
sight_last?: Record<string /* 트윈 속성(power 등) */, {
  value: unknown; seen_ms: number; /** VLM이 그 값을 직접 답했는가(Task 11a). */ explicit: boolean;
  /** 가까이 본 관측: 맞춘 감지 마스크가 사진 넓이의 10% 이상이거나 가까이 보기(look_closer) 잘라 본 사진에서 나옴(11c-1). */ close: boolean;
}>;

interface Run { /* … */
  /** 켜라고 한 가전과 지금 켜기 회차: 회차 번호, 그 회차의 시작 시각(켜기 명령을 보낸 시각, 다시 걸면 그 켜짐의 촬영 시각), 그 회차에 보낸 부탁 시각.
   *  추적을 풀어도 지우지 않는다(꺼짐 기다리기가 읽는다). 다시 걸면 cycle을 올리고 onAt을 바꾸며 askedAt을 null로 버린다. */
  onAt: Map<string, { cycle: number; onAt: number; askedAt: number | null }>;
  /** 아직 작동 한 번 끝남을 확인하지 못한 켠 가전(안전 추적). */
  hot: Set<string>;
}
/** 작동 한 번 끝남 판정(하나뿐, 지금 켜기 회차에 대해). 아니면 null. 근거 시각은 모두 촬영 시각, 근거는 모두 명시 꺼짐(explicit, Task 11a)만 쓴다.
 *  switch: 회차 onAt 뒤에 촬영된 근거로 아는 켜짐 값(on·running)에서 꺼짐으로 바뀌었고(앞 값이 모름·null이면 아님), 그 바뀜이 명시이거나 그 뒤(켜짐 없이) 같은 꺼짐 값의 명시 근거 줄이 있다. 허브 바뀜은 명시로 본다.
 *  confirmed: 이 회차에 보낸 부탁(askedAt) 뒤이고 회차 onAt 뒤에 촬영된, 가까이 본(close) 명시 꺼짐 관측(sight_last[제어 속성])이 있다(켜짐을 놓쳤을 때의 복구).
 *  둘 다 마지막으로: 그 가전의 지금 상태(허브·실제 가전 신호·카메라 명시 값 가운데 가장 새것)가 켜짐을 말하면 null. */
private cycleEnded(deviceId: string): { via: "switch" | "confirmed"; evidenceAt: number; cycle: number } | null;
/** 추적을 푸는 하나뿐인 자리. 그 가전의 켜기 단계가 끝났고(실행 중 계획이면 그 손 조작 on do가 advance를 지남, 승인 대기·켜기 단계 진행 중이면 아님)
 *  cycleEnded가 null이 아니면 hot·떠 있는 끄기 안내·줄의 끄기 안내에서 그 가전을 지우고 released에 { planId, evidenceAt }을 남긴 뒤 true. 아니면 false. */
private releaseIfOff(deviceId: string): boolean;
/** 다시 걸기: released 가전의 새 켜짐(근거 촬영 시각이 풀린 근거의 촬영 시각 evidenceAt 뒤)을 보면 추적을 다시 건다. 풀린 처리 시각이 아니라 근거 촬영 시각과 견준다.
 *  켜기 회차를 올리고(cycle + 1) onAt을 그 켜짐 촬영 시각으로, 옛 부탁(askedAt)을 버린다. 옛 회차의 부탁·카메라 꺼짐 기록은 새 회차 판정에 쓰이지 않는다(onAt 뒤 촬영만).
 *  같은 계획이 돌고 있으면 hot에 다시 넣고, 닫혔으면 끄기 안내 줄에 넣는다. evidenceAt 뒤 rearmMs(기본 10분) 안의 켜짐만 본다. 켜짐 근거는 명시·추정 모두 받는다(다시 거는 쪽은 안전). */
private rearmIfOn(deviceId: string): boolean;
// TRACK_DEFAULTS.rearmMs = 600_000, TRACK_DEFAULTS.showAskMs = 20_000
/** 닫히는 계획의 hot을 끄기 안내 줄로 옮긴다(푸는 것이 아니다). 그 가전 상태가 이미 꺼짐인데 작동 끝남을 확인하지 못했으면 줄에는 「끄라는 안내」 대신 보이게 해 달라는 부탁으로 넣는다. */
private handOver(r: Run): void;
/** 보이게 해 달라는 부탁(CLOSER_TEXT(placeName(가전)), 답 단추 없음)을 보내고 지금 회차의 askedAt을 남긴다. 이름이 없으면 보내지 않는다. 11c-1에서는 명령 줄에 보낸다. */
private askToShow(deviceId: string): void;
// src/plan/labels.ts
// SAY_TEXT.offWait = (device) => `${device} 꺼짐을 기다리고 있어요.`   EXEC_TEXT.deferred = (device) => `${device} 꺼짐 확인 전이라 새 일을 미룸`
```

**추적을 푸는 길(하나):** `releaseIfOff` → `cycleEnded`(switch 또는 confirmed). 「완료」·말·만료·끄기 do 단계 넘김은 풀지 않는다. 11c-1에서 끄기 안내는 지금 명령 줄에 뜬다.
- 명령 줄 끄기 안내의 「완료」 단추(`onAnswer`): `releaseIfOff`가 참이면 지우고, 거짓이면 그 안내를 `askToShow`(보이게 해 달라는 부탁, 답 단추 없음)로 바꾼다.
- 말 「완료」·「다 했어」(`onHeard`)는 끄기 안내를 풀지도 바꾸지도 않는다(지금 `onHeard` 369~372행의 끄기 안내 답 길을 지운다).
- 120초 만료(`offHoldMs`): 풀지 않는다. 같은 안내(부탁이면 부탁)를 명령 줄에 다시 소리로 보낸다. 줄에 다른 가전 안내가 기다리면 지금 것을 줄 끝으로 돌리고 다음 것을 띄운다(돌리기는 `nextReminder` 안에서, 하나가 다른 것을 막지 않게).
- 끄기 do 단계를 「완료」로 넘기면 단계는 넘어가지만 hot은 `releaseIfOff`가 참일 때만 풀린다. 계획이 끝날 때 남은 hot은 `handOver`가 줄로 옮긴다.
- `tick`(실행 중)과 `reminderTick`(닫힌 뒤, 실행 추적이 쉬는 동안에도 돈다)이 hot·안내에 남은 가전마다 `releaseIfOff`를, released 가전마다 `rearmIfOn`을 부른다.
- 새 계획은 지금처럼(fec2e7d) 끄기 안내가 남아 있는 동안 미룬다. 미루는 동안 실행 기록에 `EXEC_TEXT.deferred(가전)`, 대시보드 말풍선 카드에 `SAY_TEXT.offWait(가전)`(서버 글)을 보인다.
- 11c-1 동안 계획 B가 도는 중에 A의 가전이 다시 걸리면, A의 안내는 줄에서 기다리고 B는 막지 않는다(명령 줄은 B 것). B가 끝나면 안내가 뜬다. 따로 보이게 하는 것은 11c-2다.

**켜짐을 놓쳤을 때(확인 불가 복구):** 켜기 단계를 「완료」로 넘겼거나 켜짐을 못 봐 「아는 켜짐 → 꺼짐」 이력이 생기지 않으면 switch로는 끝나지 않는다. 그때는
- 실행 중: 끄기 do 단계(라면 12번)가 `showAskMs`(20초) 넘게 끝나지 않고 그 가전 상태가 이미 꺼짐이면 `askToShow`를 한 번 보낸다(그 단계 명령 줄에 그 단계 id로, 답 단추 없음). 꺼짐 기다리기(7번)의 부탁은 Task 12가 이 함수로 한다.
- 닫힌 뒤: `handOver`가 그 가전을 부탁으로 줄에 넣는다(상태가 꺼짐일 때). 시간 초과 질문에서 「그만」을 골라도 hot은 확인된 꺼짐 전까지 남고, 안내는 부탁 하나로 120초마다 되풀이된다.
- 부탁 뒤에 촬영된 가까이 본 명시 꺼짐이면 `cycleEnded`가 confirmed를 내고, 켜기 단계가 끝난 뒤일 때만 풀린다. 풀린 뒤에는 `rearmIfOn`이 지킨다.

- 구조 검사(`tests/act-track-release.test.ts`): `src/act/track.ts`에서 `hot.delete(`·`hot.clear(`·`this.reminder = null`·`offQueue.splice(`·`offQueue.shift(`이 `releaseIfOff`·`handOver`·`nextReminder` 몸통 밖에 나오면, 또 `offSince(`·`history.some(`이 `cycleEnded` 몸통 밖에 나오면 실패하고, 그 까닭 글에 「추적은 releaseIfOff로만 풀고, 작동 끝남은 cycleEnded로만 본다」를 쓴다. 과거 실수(79ff269의 `onAnswer`·`onHeard`·`reminderTick`·`advance`)에서 실패하는지 먼저 본다.
- 시험 근거: 라면 12번은 **허브 근거**로 본다(시험 모드에서 말 요청 에이전트나 시험 허브가 트윈 인덕션을 켜짐 → 꺼짐으로 바꿈, 허브 바뀜은 명시). 전자레인지는 **카메라 근거**로 본다(SIGHT `microwave.camera.sight`, 명시 `not_in_use`). 인덕션 카메라 근거 시험은 Task 11b 뒤 11b가 더한다.

- [ ] **Step 1: 실패하는 시험.**
  - 명령 줄 끄기 안내: 「「완료」 단추 → 안내·hot이 남고 부탁으로 바뀜(답 단추 없음)」, **「말 「다 했어」·「완료」는 끄기 안내를 풀지도 바꾸지도 않는다」**, 「120초가 지나도 남고 같은 안내가 다시 소리로 간다」, 「두 가전이 켜진 채 닫히면 120초마다 줄에서 차례로 돌아가며 뜬다」, 「이름 없는 가전이면 부탁을 보내지 않고 안내 그대로」, 각각 「그 뒤 switch 근거(라면: 허브 꺼짐)가 오면 지움」.
  - 끄기 do 「완료」(라면 12번, 허브 근거): 「다음 단계로 가지만 hot이 남고 계획이 끝나면 안내가 간다」, 「허브가 켜짐 → 꺼짐으로 바뀌어 끝나면 hot이 풀리고 안내가 없다」, 「12번이 20초 넘게 안 끝나고 상태가 이미 꺼짐이면 부탁이 그 단계 명령 줄에 한 번 뜬다」.
  - 한 판정: 「전원 모름 → 켜기 지시 → 첫 관측이 꺼짐(모름 → 꺼짐) → `cycleEnded` null」, 「켜기 단계 진행 중에 켜짐 → 꺼짐을 봐도 그 단계가 끝나기 전에는 풀리지 않는다」, 「hot이 풀려도 `onAt`은 남는다」.
  - 명시·추정(전자레인지, 카메라 근거): **「전자레인지가 크게 보이지만 VLM이 전원을 말하지 않은 답(추정 꺼짐)만 이어지면 트윈은 꺼짐이 되어도 풀리지 않는다」**, **「VLM이 「꺼져 있음」을 답하면(명시) 풀린다」**, **「켜짐 → 추정 꺼짐 → (같은 꺼짐 값의) 명시 꺼짐 순서면 `cycleEnded.switch`가 선다」**.
  - 다시 걸기: **「꺼짐 촬영 → 다시 켜짐 촬영 → 꺼짐 답 도착·해제 → 켜짐 답 도착 순서면 다시 건다」**, 「같은 계획 hot에 다시 걸리고 onAt이 그 켜짐 촬영 시각이 된다」, 「계획 취소 뒤 10분 안 켜짐이면 끄기 안내」, 「해제 근거보다 먼저 찍힌 켜짐이 늦게 와도 다시 걸지 않는다」, 「10분 뒤 켜짐은 다시 걸지 않는다」, 「B가 도는 중 A가 다시 걸리면 B 명령이 명령 줄에 그대로이고 A 안내는 B가 끝난 뒤 뜬다」.
  - 회차: **「다시 걸린 뒤, 옛 회차의 부탁 뒤에 찍혔던 가까이 본 꺼짐 기록이 남아 있어도 풀리지 않는다」**, 「다시 걸릴 때 회차 번호가 오르고 askedAt이 비워진다」, 「카메라는 꺼짐을 말해도 허브 신호가 지금 켜짐이면 풀리지 않는다」.
  - 확인 불가 복구(전자레인지, 닫힌 뒤): **「켜짐을 놓친 뒤 부탁 → 부탁 뒤 촬영된 가까이 본 명시 꺼짐 → 풀림」**, **「부탁 전에 찍힌 가까이 본 꺼짐 → 안 풀림」**, **「켜기 단계 진행 중 가까이 본 꺼짐 → 안 풀림」**, 「멀리서 본 꺼짐(close 거짓) → 안 풀림」, 「시간 초과 질문에서 「그만」이면 hot이 남고 안내는 부탁 하나로 120초마다 되풀이」.
  - 미룸: 「끄기 안내가 남은 동안 실행 기록 「인덕션 꺼짐 확인 전이라 새 일을 미룸」과 말풍선 카드 「인덕션 꺼짐을 기다리고 있어요.」」.
  - `sight_last`: 「속성마다 `close`가 남고, 마스크가 사진 넓이 10% 미만이면 거짓, 가까이 보기 결과면 참」.
  - 구조 검사가 79ff269의 `track.ts`에서 실패하고, 고친 뒤 통과한다.
  - 지금 시험 `tests/act-track.test.ts` 「켠 뒤 「그만」이면 … 「완료」면 지운다」는 「「완료」면 부탁으로 바뀌고 확인된 꺼짐을 보면 지운다」로 고친다.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/act-track.test.ts tests/act-track-release.test.ts tests/vision-devices.test.ts tests/act-say.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인. 이어서 영향을 받는 시험을 돌려 고친다: `tests/coach-e2e.test.ts`(라면 끝까지 가는 판에서 12번을 「완료」·「다 했어」로 넘겼다면 허브 꺼짐을 내게 하거나, 끝난 뒤 부탁이 남는 것을 기대값으로 바꾼다), `tests/agent-planner.test.ts`(코치 실행 추적 시험 중 끄기 단계 「완료」 판). 컵 시험(`noonchi-e2e`·`cup-branches-e2e`)과 승인 시험은 손 조작 가전이 없어 그대로다.
- [ ] **Step 5:** 커밋 `fix(act): release switch-off tracking only through releaseIfOff on a confirmed end of the appliance cycle`. CLAUDE.md 규칙 표에 한 줄: 「켠 위험 가전 추적(hot·끄기 안내)은 확인된 꺼짐(cycleEnded)으로만 푼다(완료·말·만료로 풀지 않음) | `tests/act-track-release.test.ts`·`tests/act-track.test.ts`」.

### Task 11d: 폰 안전 안내 자리와 답이 그 명령에만 가게

끄기 안내·확인 불가 부탁을 명령 줄과 따로 보이는 안전 안내 자리를 만들고(Task 11c-2가 옮겨 쓴다), 답이 다른 명령에 가는 두 구멍을 막는다: 음성 답은 글만 보내 계획·단계 id가 없다(`ui/src/phone/controller.ts` 205행 `say`), 명령 단추는 id·step을 보내지만 같은 DOM(`key` 답 id)을 다시 써 누르는 중 명령이 바뀌면 새 명령 처리기가 돌 수 있다(`ui/src/phone/PhoneScreen.tsx` `ChoiceButtons`).

**Files:**
- Create: `src/contract/phone-version.ts`(`PHONE_PROTOCOL`)
- Modify: `src/contract/phone.ts`(`PhoneSafety`, `PhoneSafetyAnswer`, `PhoneTalk` say의 `at`, `PhoneStatus.protocol`), `src/phone/server.ts`(안전 안내 보내기·받기, say `at` 넘기기, 상태에 판본), `src/server/home.ts`(`onAnswer`·`onSay` 연결: 버린 답은 에이전트로 보내지 않음, 판본이 맞는 폰이 없으면 새 계획을 미룸), `src/act/track.ts`(`onHeard(text, at)` → `HeardResult`), `src/agent/agent.ts`(들은 말의 승인은 `answerToken` 하나만, 들은 말로 `answerAll` 하지 않음), `ui/src/phone/core/link.js`(연결 때 판본 알리기, 다시 붙을 때 판본 확인), `ui/src/phone/core/talk.js`·`talk.d.ts`(말 시작 알림), `ui/src/phone/controller.ts`(`say`, `safetyAnswer`), `ui/src/phone/state.ts`, `ui/src/phone/PhoneScreen.tsx`(안전 안내 자리, 명령 단추 key)
- Modify: `scripts/video-check.ts`(`--say`가 보내는 말에 `at` 싣기)
- Test: `tests/phone-server.test.ts`, `tests/act-track.test.ts`, `tests/agent.test.ts`, `tests/phone-talk.test.ts`, `ui/tests/phone-screen.test.tsx`, `ui/tests/phone-controller.test.ts`, `tests/phone-link.test.ts`(link.js 시험이 있는 곳), `tests/video-check.test.ts`

**Interfaces:**
- Consumes: Task 11c-1의 `handOver`(폰이 모두 끊겨 계획을 닫을 때 hot을 넘김), 지금 실행 추적의 `openCommand`·`r.sent`.
- Produces(11c-2가 쓴다): `PhoneSafety`·`PhoneSafetyAnswer`, 안전 안내 자리(`data-phone-zone=safety`, 엄지 영역 밖), 폰 서버의 `safety` 보내기·`safety_answer` 받는 자리(실행 추적의 `onSafetyAnswer`는 11c-2), `HeardAt`·`HeardResult`(말 답은 명령 줄에만), `PHONE_PROTOCOL`, `needsPhone`.

```ts
// src/contract/phone.ts
/** 서버 → 실제 폰: 안전 안내 목록(끄기 안내·보이게 해 달라는 부탁). 바뀔 때마다 통째로. 비면 자리를 숨긴다. 명령 줄과 따로다. */
export interface PhoneSafety { type: "safety"; items: { id: string; text: string; choices: PhoneChoice[]; speak: boolean }[] }
/** 실제 폰 → 서버: 안전 안내 자리 단추 답(그 자리 단추로만, 말 답은 없다). */
export interface PhoneSafetyAnswer { type: "safety_answer"; id: string; choice: string }
/** 말하기 시작할 때 폰에 떠 있던 것: 명령 줄(명령의 계획 id·단계 id, 없으면 none)과 승인 대기 목록에 보인 token들. 새 폰은 늘 싣는다. 칸이 없으면 옛 탭이다. */
export type HeardAt = ({ kind: "command"; id: string; step: string } | { kind: "none" }) & { pending: string[] };
export type PhoneTalk = { type: "say"; text: string; at?: HeardAt } | /* confirm·cancel 그대로 */;
/** 서버 → 실제 폰 상태(첫 메시지): protocol은 서버가 쓰는 폰 계약 판본. */
export interface PhoneStatus { /* … */ protocol: number }
// src/contract/phone-version.ts(값 하나, ui와 서버가 같이 읽는다)
export const PHONE_PROTOCOL = 2;
// src/act/track.ts
/** 들은 말의 결과: 답으로 받음, 오래되거나 어디에 한 답인지 모르는 답이라 버림(stale), 답이 아님(null). */
export type HeardResult = { kind: "answer"; choice: ActionChoice } | { kind: "stale" } | null;
onHeard(text: string, at?: HeardAt): HeardResult;
// 「그만」은 at과 상관없이 늘 답으로 받는다.
// 명령에 대한 답 말(지금 명령의 답 단추 글·말: 완료·다 했어·질문 답, 승인 질문의 승인·거절)이면:
//   at이 command이고 지금 명령의 계획 id·단계 id와 같으면 answer.
//   at이 command인데 다르거나, at 칸이 없으면(옛 탭) stale.
//   at이 none인데 지금 명령이 떠 있으면(말하는 사이 새 명령이 뜸) stale.
// 지금 명령이 없고 at이 none이면 null(들은 말로 남기고 아래 승인 대기 규칙으로 간다).
// 에이전트 승인 대기(위험 가전, 폰의 승인 대기 목록)를 말로 답하기: 말 전체가 승인·거절 답일 때만(지금 규칙) 그리고
//   at.pending이 정확히 token 하나이고 그 token이 지금도 대기 중이면 그 token 하나만 답한다(agent.answerToken(token, 답)). 지금 대기가 여럿이어도 다른 token은 건드리지 않는다.
//   at.pending이 비었거나 둘 이상이거나 그 token이 이미 없으면 stale(에이전트로 넘기지 않음, 폰 답 글 없음, 기록에 「늦은 답이라 쓰지 않음」). 둘 이상이면 승인 대기 목록 단추로만 답한다.
//   들은 말(heard)로는 answerAll(src/agent/agent.ts 332행)을 부르지 않는다. 글로 한 요청(heard 아님)은 지금처럼.
// src/server/home.ts onAnswer·onSay: stale이면 들은 말로 기록만 하고(heardSpeech) { handled: true, reply: "" }를 돌려 에이전트 대화로 넘기지 않는다.
// src/agent/agent.ts
/** 승인 대기 token 하나만 답한다(지금 대기가 아니면 false). 다른 대기는 그대로. */
answerToken(token: string, answer: ApprovalAnswer): Promise<{ ok: boolean; reply: string }>;
// scripts/video-check.ts --say: 폰 컨트롤러와 같은 길로 보낸다. 보내는 그 순간 명령 줄의 지금 명령(__noonchiVideo.commands 마지막의 계획 id·단계 id, 없으면 none)과 승인 대기 목록에 보인 token들을 at으로 싣는다(at 없이 보내면 「완료」·「승인」이 stale로 버려진다).
// ui/src/phone/core/talk.js createListener hooks에 onSpeechStart() 더함(인식 speechstart). controller가 그때 명령 줄의 지금 명령(없으면 none)과 승인 대기 목록에 보인 token들을 잡아 두고 그 말을 보낼 때 at으로 싣는다.
// ui/src/phone/core/link.js: 소켓이 열리면 바로 { type: "hello", protocol: PHONE_PROTOCOL }를 보낸다. 연결·다시 붙음마다 상태의 protocol이 폰 빌드의 PHONE_PROTOCOL과 다르면 페이지를 다시 읽는다(location.reload).
//   같은 탭에서 60초 안에 두 번 다시 읽지 않는다(sessionStorage, 막히면 다시 읽지 않고 화면에 「새로 고침이 필요해요」 상태 한 줄).
// 이미 열린 옛 탭에는 이 검사가 없다. 그래서 서버가 막는다(src/phone/server.ts):
export interface PhoneHello { type: "hello"; protocol: number }
//   연결마다 판본을 기다린다. 열린 뒤 2초 안에 hello가 없거나 protocol이 PHONE_PROTOCOL과 다르면 그 연결은 옛 탭으로 둔다.
//   옛 탭으로 둔 뒤라도(2초가 지나도) 판본이 맞는 hello가 오면 그 연결을 정상으로 바꾼다: 새로 고침 안내를 지우고(command_clear id "refresh") 지금 안전 안내 목록·승인 대기 목록과 지금 명령을 다시 보내며, 그 뒤 답을 받는다.
//   지금 명령은 openCommand()(id·step·글·답만, src/act/track.ts 258행)가 아니라 폰 서버가 기억한 처음 보낸 명령 전체(PlannedCommand: kind·target·vision·choices 포함, 실행 추적 r.sent와 같음)를
//   지금 맞춘 AR 좌표로 바꿔(wire) speak: false로 보낸다. 그래야 영상 폰의 단계 영상 바꾸기·걷기가 돈다. 폰 서버는 이미 지금 명령을 기억해 새로 붙은 폰에 보낸다(src/phone/server.ts current)는 길을 그대로 쓴다.
//   옛 탭에는 옛 탭도 그리는 기존 메시지로 새로 고침 안내를 보낸다: PhoneCommand { id: "refresh", step: "refresh", text: REFRESH_TEXT, choices: [], vision: null, target: null, speak: true }
//   (REFRESH_TEXT = "화면을 새로 고쳐 주세요", src/plan/labels.ts). 옛 탭에는 계획 명령·안전 안내를 보내지 않고, 그 탭의 answer·confirm·cancel·say 답은 받지 않는다(관찰 사진은 받는다).
//   판본이 맞는 폰이 하나도 없으면 실행 추적은 **폰이 필요한 계획만** 시작하지 않는다(실행 기록 EXEC_TEXT.phoneOld = "폰 화면 새로 고침 전이라 새 일을 미룸"). 도는 중이던 계획은 그 단계 명령을 맞는 폰이 붙을 때 다시 보낸다.
//   폰이 필요한 계획(needsPhone): 사람 단계(go·pick·place·do)나 ask가 있거나, 처음 하는 일이라 승인 질문이 필요하거나(approvalNeed), 위험 목록 가전 단계(승인 질문)가 있거나,
//   어떤 단계든 on_timeout이 "ask"(시간 초과 때 계속·그만을 폰에 묻는다, device·wait 포함)인 계획.
//   가전 단계·기다리기·say만 있고 이미 승인되고 on_timeout이 모두 "fail"인 계획(에어컨 켜기 등)은 폰 없이 시작한다(say 글은 붙은 맞는 폰이 없으면 보내지 않는다).
//   계획 도중 맞는 폰이 모두 끊겨 폰에 물어야 할 때(시간 초과의 계속·그만 질문, 승인 질문)가 오면 askMs(120초)를 기다리지 않고 그 계획을 바로 실패로 닫는다(실행 기록 EXEC_TEXT.phoneGone = "폰이 없어 물을 수 없어 그만둠").
//   그래서 행동 중 기다리기·기기 단계로 멈춰 있던 PAM 판단(src/act/track.ts waiting, 925행 근처)이 곧 풀린다. 켠 위험 가전 추적(hot)은 그대로 handOver로 끄기 안내 줄에 넘긴다(Task 11c-1).
/** 폰 답·폰 안내가 꼭 필요한 계획인가. */
export function needsPhone(plan: AgentPlan, approval: ApprovalWhy | null, devices: readonly { id: string; kind: string }[]): boolean;
//   hello가 판본이 맞게 오기 전(2초 안)에는 그 연결에 계획 명령을 보내지 않는다.
```
- 명령 단추: `ChoiceButtons`를 감싼 명령 줄 묶음의 `key`를 `${id}:${step}`로 둔다(명령이 바뀌면 새로 그린다). 단추는 누르기 시작(pointerdown) 때의 계획 id·단계 id를 잡고, 손을 뗄 때 지금 명령과 다르면 보내지 않는다(누르는 중 명령이 바뀌면 그 누르기는 취소).
- 안전 안내 자리 화면은 저장소 `ui/src/components/ui` 안의 21st.dev 부품만 쓴다(지금 승인 대기 목록 `PendingList`와 같은 `Card`·`Item`·`ItemContent`·`ItemTitle`·`ItemActions`·`Button`). 새 부품·손으로 만든 꾸밈은 쓰지 않는다. 글은 서버 글(`CAUTION_TEXT.off`, `CLOSER_TEXT`)만.
- 안전 안내 자리는 명령 줄 엄지 영역(`[data-phone-zone=thumb]`) **밖**에 둔다(자기 영역 `data-phone-zone=safety`). 영상 판정(Task 9)은 그 엄지 영역 안 단추만 누르므로 안전 안내 단추를 누르지 않는다.

- [ ] **Step 0: 배치 스케치(사용자 확인).** 안전 안내 자리가 들어간 실제 폰 화면(세로·가로)의 구조만 보이는 HTML 스케치를 만들어 사용자에게 보이고, 자리(명령 줄 위·아래, 승인 대기 목록과의 관계)를 확인받은 뒤 Step 1로 간다. 확인 전에는 화면 코드를 쓰지 않는다.
- [ ] **Step 1: 실패하는 시험.**
  - 안전 안내 자리: 「`safety` 메시지가 오면 명령 줄과 따로 안내마다 Item 하나와 「완료」 단추가 보이고, 누르면 `safety_answer`(그 안내 id)를 보낸다」, 「명령 줄의 명령·단추는 그대로다」, 「안전 안내 자리 단추에 날 button이 없다(부품 lint)」, 「말 「완료」는 `safety_answer`를 보내지 않는다」.
  - 음성 id: **「A 명령이 떠 있을 때 말하기 시작해 B 명령으로 바뀐 뒤 「완료」가 도착하면(at = A) B 단계가 넘어가지 않고 에이전트 대화로도 가지 않는다」**, **「at이 다른 「승인」(B의 승인 질문이 떠 있음)은 B 승인도 안 되고 에이전트로도 가지 않으며, 에이전트의 다른 승인 대기도 그대로다」**, **「at 칸이 없는 「완료」(옛 탭)는 넘어가지 않고 에이전트로도 가지 않는다」**, 「at이 none인데 명령이 떠 있으면 「완료」는 버린다」, 「at이 지금 명령과 같으면 넘어간다」, 「「그만」은 at과 상관없이(칸이 없어도) 받는다」, **「A 승인 대기에 대한 「승인」이 늦게 도착(at.pending = [A])했는데 그사이 A는 끝나고 B가 대기 중이면 B는 확정되지 않고 에이전트로도 가지 않는다」**(시험 이름 「들은 승인은 말할 때 보인 대기 token 하나만 답한다」), 「at.pending = [A]이고 A가 아직 대기면 A만 확정되고 같이 대기 중인 B는 그대로다」, 「at.pending이 둘 이상이거나 비었으면 버린다」, 「들은 말로는 answerAll이 불리지 않는다」, 「버린 말은 기록에 들은 말로 남는다」.
  - 옛 탭: **「hello를 보내지 않는 탭(판본 없음)이 붙으면 「화면을 새로 고쳐 주세요」 명령이 가고, 그 탭의 「완료」 answer·confirm은 받지 않으며, 그 탭만 붙어 있으면 컵 치우기(사람 단계) 계획이 시작되지 않고 실행 기록에 「폰 화면 새로 고침 전이라 새 일을 미룸」」**(시험 이름 「판본 없는 폰 탭은 실행을 막고 새로 고침을 안내한다」), **「같은 때 이미 승인된 에어컨 켜기(가전 단계만) 계획은 폰 없이 시작해 트윈 에어컨이 켜진다」**(시험 이름 「가전만 쓰는 계획은 맞는 폰 없이도 시작한다」), 「처음 하는 일(승인 질문이 필요한) 가전 계획은 미룬다」, **「wait나 device 단계에 on_timeout "ask"가 있는 가전 계획은 미룬다」**(시험 이름 「시간 초과 질문이 있는 계획은 폰이 필요하다」), **「맞는 폰이 붙어 시작한 계획이 기다리기 중 폰이 끊긴 뒤 시간 초과에 닿으면 질문을 보내지 않고 바로 실패로 닫히며 PAM 판단이 다시 돈다. 그 계획이 켠 위험 가전은 끄기 안내 줄에 남는다」**(시험 이름 「폰이 끊긴 뒤 물을 일이 생기면 바로 그만둔다」), **「hello가 2초 뒤에 오면 처음엔 새로 고침 안내가 가고, hello를 받은 뒤 새로 고침 안내가 지워지며 지금 명령·안전 안내가 다시 오고 그 뒤 「완료」 답을 받는다」**(시험 이름 「늦은 hello는 연결을 정상으로 되돌린다」), **「hello가 늦은 영상 폰이 다시 받은 명령에 kind·target(AR 좌표)·vision이 있고, 그 명령으로 단계 영상이 바뀐다」**(시험 이름 「다시 보낸 명령은 처음 명령 전체다」, `tests/phone-server.test.ts`·`ui/tests/phone-video.test.ts`), 「protocol이 다른 hello도 같다」, 「옛 탭에는 safety·계획 명령을 보내지 않는다」, 「맞는 판본 탭이 붙으면 미뤘던 계획이 시작되고 명령이 그 탭에 간다」.
  - 판본: 「폰 상태의 protocol이 폰 빌드와 다르면 다시 붙을 때 페이지를 다시 읽는다」, 「새 폰은 열리자마자 hello를 보낸다」, 「같으면 다시 읽지 않는다」, 「60초 안에 두 번 다시 읽지 않는다」, 「안전 안내 자리 요소가 `[data-phone-zone=thumb]` 밖에 있다」.
  - 단추 key: **「A 명령 「완료」를 누르는 중(pointerdown 뒤) B 명령으로 바뀌면 손을 떼도 아무 답도 보내지 않는다」**, **「명령이 바뀌면 단추 묶음이 새로 그려진다(key = 계획 id:단계 id)」**.
  - 폰 서버: 「`safety_answer`를 받아 실행 추적에 넘기고, 모르는 id는 무시한다」, 「새로 붙은 폰은 지금 안전 안내 목록을 받는다」.
  - 영상 판정: 「`--say 완료`가 떠 있는 명령에 받힌다(보낸 say의 at이 그 명령의 계획 id·단계 id)」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/phone-server.test.ts tests/act-track.test.ts`, `npm run heavy -- npm test --prefix ui -- phone-screen phone-controller` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인, `npm run lint`(부품·색·화면 글 검사). 이어서 폰 소켓을 직접 여는 기존 시험이 옛 탭으로 막히지 않게 고친다: 시험 대역 `tests/helpers/ws.ts`에 판본 hello를 보내는 `openPhone`을 두고 `tests/{noonchi-e2e,cup-branches-e2e,coach-e2e,mokryeon-e2e,video-mode-e2e,vision-e2e,phone-server,phone-voice,phone-start,phone-start-api,plan-server,observe-start,focus,no-frames-on-disk,setup-server,phone-link}.test.ts`의 폰 연결을 그것으로 바꾼다(옛 탭 동작을 보는 시험만 hello 없이 연다). 영상 판정(`scripts/video-check.ts`)은 이 저장소 빌드의 폰 페이지를 열어 hello를 보내므로 `--approve`·`--done-on`이 이 조건에 막히지 않는다.
- [ ] **Step 5:** 커밋 `feat(phone): show safety reminders apart from the command line and bind voice and button answers to the shown command`.

### Task 11c-2: 끄기 안내를 안전 안내 자리로

11d가 만든 실제 폰 안전 안내 자리(`data-phone-zone=safety`)로 닫힌 계획의 끄기 안내와 확인 불가 부탁을 옮긴다. 명령 줄은 돌고 있는 계획의 것만 남아 다른 계획을 막지 않는다. 11d 다음, Task 12 앞에 한다.

**Files:**
- Modify: `src/act/track.ts`(`onSafetyAnswer`, 안전 안내 목록 내기 `safetyItems`, `handOver`·`askToShow`·`reminderTick`·`rearmIfOn`이 안전 안내 자리로 보냄, 승인 막기), `src/server/home.ts`(목록을 폰 서버로), `src/phone/server.ts`(11d의 `safety` 메시지로 보냄)
- Test: `tests/act-track.test.ts`, `tests/act-track-release.test.ts`, `tests/phone-server.test.ts`, `tests/video-check.test.ts`, `tests/coach-e2e.test.ts`

**Interfaces:**
- Consumes: Task 11c-1의 `releaseIfOff`·`cycleEnded`·`handOver`·`askToShow`·`rearmIfOn`·`Run.onAt`, Task 11d의 `PhoneSafety`·`PhoneSafetyAnswer`·안전 안내 자리(엄지 영역 밖), `HeardAt`(말 답은 안전 안내에 가지 않음), Task 11r-2의 `needsConfirm`(B 승인이 안내 중 가전을 켜는지 보기).
- Produces(Task 12가 쓴다): `ExecutionTracker.safetyItems(): PhoneSafety["items"]`, `onSafetyAnswer(id: string, choice: string): boolean`.

```ts
/** 안전 안내 목록: 닫힌 계획의 끄기 안내·확인 불가 부탁. 안내마다 id `off:<계획 id>:<가전 id>:<회차>`, 글은 CAUTION_TEXT.off 또는 CLOSER_TEXT, 답은 「완료」 하나(부탁은 답 없음). */
safetyItems(): { id: string; text: string; choices: PhoneChoice[]; speak: boolean }[];
/** 안전 안내 자리 단추 답: releaseIfOff가 참이면 그 안내를 지우고, 거짓이면 그 안내를 askToShow 부탁으로 바꾼다. 모르는 id는 false. */
onSafetyAnswer(id: string, choice: string): boolean;
```
- 닫힌 계획의 끄기 안내·부탁은 명령 줄이 아니라 안전 안내 자리에 목록으로 뜬다(가전마다 Item 하나). 120초 만료는 그 자리에서 그 안내를 다시 소리로 읽는다. 목록이라 줄을 돌리지 않는다.
- 실행 중 계획 안의 부탁(12번, Task 12의 7번)은 그 계획의 단계라서 명령 줄에 그 단계 id로 남는다.
- 다른 계획과 겹칠 때: 이미 돌고 있는 계획 B는 멈추지 않는다. B의 명령은 명령 줄에 그대로이고 시간 한도·조건·`cycleEnded`도 그대로다. A의 다시 건 안내는 B가 끝나기를 기다리지 않고 안전 안내 자리에 바로 뜬다.
- B가 안전 안내에 남은 가전(같은 id)을 켜는 승인 질문에 답하면 그 승인은 받지 않는다(켜진 채로 또 켜라는 지시 방지, 질문은 남고 안내가 풀리면 다시 받는다).
- 말 「완료」·「다 했어」는 안전 안내 자리로 가지 않는다(명령 줄의 지금 명령 답으로만, Task 11d `HeardAt`).
- 새 계획은 지금처럼 안전 안내가 남아 있는 동안 미룬다(11c-1의 미룸 글 그대로).

- [ ] **Step 1: 실패하는 시험.**
  - 「두 가전이 켜진 채 닫히면 안전 안내 자리에 둘 다 목록으로 뜨고 명령 줄은 비어 있다」, 「안전 안내 자리 「완료」 → 그 안내만 부탁으로 바뀌고 hot은 남는다」, 「120초가 지나면 그 자리에서 같은 안내가 다시 소리로 간다」, 「switch 근거가 오면 그 안내만 목록에서 빠진다」.
  - 다른 계획과 겹침: **「B가 인덕션을 켜고 수납장으로 가는 단계 중에 A의 다시 건 안내가 생기면 B 명령은 명령 줄에 그대로이고 B 단계 시간·끄기 단계가 막히지 않으며, A 안내는 안전 안내 자리에 바로 뜬다」**, 「B가 익기를 기다리는 중 A 안내가 와도 익기 시간이 그대로 흐른다」, 「안전 안내 자리 「완료」는 B 단계에 가지 않는다」, 「말 「완료」는 B의 지금 명령 답으로만 쓰이고 A 안내를 바꾸지 않는다」, 「B의 승인이 안전 안내에 남은 가전(같은 id)을 켜는 것이면 그 답을 받지 않고 질문이 남는다」.
  - 영상 판정(Task 9 `plannedClicks`·`clickChoice`): 「안전 안내 자리가 떠 있어도 명령 줄의 B 명령에 예약한 「완료」는 B에 가고, 판정기는 안전 안내 자리 버튼을 누르지 않는다(명령 줄 `[data-phone-zone=thumb]` 단추만)」.
  - 폰 서버: 「`safety` 메시지가 목록이 바뀔 때마다 가고, 새로 붙은 맞는 판본 폰도 지금 목록을 받는다」.
  - 11c-1 시험 가운데 「명령 줄 끄기 안내」·「A 안내는 B가 끝난 뒤 뜬다」는 안전 안내 자리 기대로 고친다.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/act-track.test.ts tests/act-track-release.test.ts tests/phone-server.test.ts tests/video-check.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인, `tests/coach-e2e.test.ts`도. 구조 검사(`tests/act-track-release.test.ts`)는 그대로 통과해야 한다(안내를 지우는 곳이 `releaseIfOff`뿐).
- [ ] **Step 5:** 커밋 `feat(act): move closed-plan off reminders to the phone safety slot and keep running plans unblocked`.

**시연 흐름에 주는 영향:** 노인 장면(전자레인지)은 끄기 do가 없고 7번이 `cycleEnded`(switch)로 끝나 그대로다(Task 12). 켜짐을 놓치면 7번 동안 부탁이 떠 가까이 비추면 끝난다. 라면 장면 12번은 카메라 켜짐 → 꺼짐(Task 11b)으로 넘어가야 hot이 풀린다. 「완료」·「다 했어」로 넘기면 끝난 뒤 부탁이 안전 안내 자리에 남는다(그래서 시연 순서 7의 `--done-on`에는 12번 글을 넣지 않는다). 한 장면 안에서는 다른 계획과 겹치지 않는다.

### Task 12: 코치 행동 「전자레인지로 데우기 알려 주기」

**Files:**
- Modify: `src/act/tasks.ts`, `services/pam/scenarios/noonchi/tasks.json`, `services/pam/scenarios/noonchi/scenario.json`(Task 4 행동 이름 줄·코치 행동 줄에 새 이름), `src/brain/decision.ts`(`cooking` 상태), `src/world/labels.ts`(`FSM_STATE_TEXT.cooking` → `"주방에서 할 일을 찾음"`), `src/model/kinds.ts`(등록부 `microwave.selfStop`, Task 11r-1), `src/agent/planTools.ts`(끄기 검사), `src/agent/planInput.ts`(지시문 한 줄), `src/act/track.ts`(켠 가전 추적), `tests/helpers/planner.ts`(`microwaveSteps`, 대본 표)
- Test: `tests/act-tasks.test.ts`, `tests/agent-planner.test.ts`, `tests/act-track.test.ts`, `tests/phone-lines.test.ts`, `tests/brain-decision.test.ts`, `tests/pam-scenario.test.ts`

**먼저:** Task 11·11a·11c-1·11d·11c-2. 전자레인지가 기기이자 평면도 물건이어야 대상이 되고 이름이 붙는다(기기 id와 평면도 id가 같은 `microwave_kitchen`, 방 `kitchen`, 평면도 종류 `microwave` → 이름 「전자레인지」).

**글과 끝 조건은 서버가 만든다(T1~T4):** 대본은 `{kind, target, act, item, hand_device, notice}`만 고른다. 폰 글은 `STEP_TEXT`·`NOTICES`가 내고, 손 조작 동작의 끝 조건은 `handUntil`이 낸다.

**저절로 꺼지는 가전:** 전자레인지는 다 되면 스스로 멈춘다. 지금 검사는 켠 위험 가전 뒤에 끄기 do(hand_device off)를 꼭 두게 해, 이미 꺼진 뒤에 「전자레인지를 꺼 주세요」를 보내게 된다. 또 기다리는 동안 꺼지면 끄기 do의 `became: off`는 단계 시작 전 사건이라 끝나지 않는다. 그래서 저절로 꺼지는 가전(등록부 `selfStop`)만 「꺼짐을 기다리는 wait」를 끄는 단계로 인정한다. 이 wait는 notice 「다 되기」(이름 「다 되기 기다리기」, 폰 글 없음)와 모델이 쓰는 until `{"device": id, "state": "off"}`(wait until은 모델 것을 그대로 받는다)로 표시만 한다. **끝나는 기준은 실행 추적이 따로 본다**: 지금 상태가 꺼짐인 것만으로는 끝나지 않고, 작동 한 번 끝남(`cycleEnded(가전)`, Task 11c-1, 명시 꺼짐만)이 있어야 끝난다: 켜라고 한 시각(`onAt`, 추적이 풀려도 남는다) 뒤에 촬영된 근거로 아는 켜짐에서 꺼짐으로 바뀌었거나(switch), 켜짐을 놓쳐 보이게 해 달라고 부탁한 뒤 가까이 본 관측이 꺼짐이다(confirmed). hot을 푸는 `releaseIfOff`도 같은 판정을 쓰고, 5번 켜기 단계가 끝난 뒤에만 푼다. 그래서 켜기 단계를 사람이 「완료」로 넘겼는데 가전이 옛 꺼짐 그대로이면(켜짐을 한 번도 못 봄) 기다리기가 끝나지 않고 hot이 남으며, 시간 초과 질문에서 그만두거나 계획이 닫히면 끄기 안내가 간다. 그릇 꺼내기는 따로 pick으로 둔다.

**Interfaces:**
- Consumes: Task 11c-1의 `cycleEnded`·`releaseIfOff`·`askToShow`·`Run.onAt`·`TRACK_DEFAULTS.showAskMs`, Task 11c-2의 안전 안내 자리 끄기 안내, Task 11r-1 등록부(`selfStop` 칸), Task 11r-2 `needsConfirm`(5번 승인).

```ts
"전자레인지로 데우기 알려 주기": {
  name: "전자레인지로 데우기 알려 주기", coach: true, maxSteps: 12,
  description: "사람이 전자레인지 앞에서 쓰는 법을 묻거나 막히면 문 열기부터 꺼내기까지 사람이 할 일을 단계마다 천천히 알려 준다. 클로이드는 가전을 조작하지 않는다.",
  allow: { kinds: ["go", "pick", "place", "do", "wait", "say"], need: ["do", "wait"] },
},
// cooking 상태 description: "사용자가 주방에서 음식을 만들거나 데우려 한다. 방법을 묻거나 무엇을 할지 몰라 멈춰 있으면 단계마다 알려 준다."
// cooking rules에 더함: { trigger: "사용자가 전자레인지 앞에서 쓰는 법을 묻거나 이거 어떻게 하냐고 말한다.", action: "전자레인지로 데우기 알려 주기" }
// src/model/kinds.ts KINDS.microwave에 selfStop: true를 더한다(다 되면 스스로 멈추는 위험 가전. 켠 뒤 그 가전이 꺼짐을 기다리는 wait를 끄는 단계로 인정한다).
/** 등록부에서 파생. 종류별 표를 따로 두지 않는다(Task 11r-1 구조 검사). 켜기 승인은 Task 11r-2 needsConfirm을 그대로 쓴다. */
export const isSelfStop = (k: DeviceKind): boolean => (KINDS[k] as KindEntry).selfStop === true;
// src/agent/planTools.ts finish(): 켠 위험 가전(riskyHand) 뒤에 (a) 같은 가전 hand_device off do 또는
//   (b) 그 가전 종류가 등록부 selfStop이고 until이 정확히 {"device": 그 가전, "state": "off"}인 wait 가 있어야 끝낸다.
// src/act/track.ts: (b) 모양 wait는 ConditionWatch 결과를 쓰지 않는다. look()에서 그 단계는 cycleEnded(그 가전)(지금 회차) 가 null이 아닐 때만 넘긴다
//   (지금 상태 꺼짐만·앞 값 모름인 꺼짐으로는 넘기지 않음, onAt이 없으면 넘기지 않음). hot이 6번 동안 이미 풀렸어도 onAt은 남아 있어 끝난다(Task 11c-1).
//   20초 넘게 안 끝나고 상태가 이미 꺼짐이면 askToShow를 한 번 보낸다(명령 줄에 그 단계 id로, 답 단추 없음). hot은 releaseIfOff(그 가전)로만 푼다.
//   그 전에 계획이 닫히면 handOver가 끄기 안내(「전자레인지를 꺼 주세요」)를 안전 안내 자리로 옮긴다(Task 11c-2). 안내는 releaseIfOff(확인된 꺼짐)로만 지운다: 그 자리 「완료」는 보이게 해 달라는 부탁으로 바꾸고, 말 「완료」·「다 했어」는 안내를 바꾸지 않으며, 120초 만료는 같은 안내를 다시 읽는다.
/** 저절로 꺼지는 가전의 꺼짐 기다리기(등록부 selfStop 가전, until이 정확히 {device, state: "off"}인 wait)인가. */
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
| 7 | `{kind: "wait", notice: "다 되기", until: {"device": mw, "state": "off"}, timeout_s: 300, on_timeout: "ask"}` | 다 되기 기다리기 / 폰 글 없음 | 표시는 `{"device": mw, "state": "off"}`, 실제로는 `cycleEnded(mw)`(지금 회차 onAt 뒤 촬영된 아는 켜짐 → 명시 꺼짐, 또는 이 회차 부탁 뒤 가까이 본 명시 꺼짐) | 비전(쓰는 중 → 켜짐 → 쓰는 중이 아님 → 꺼짐 바뀜). 6번 동안 그렇게 꺼졌으면 바로 넘어감. 켜짐을 못 봤으면 20초 뒤 「전자레인지가 보이게 폰을 가까이 대 주세요」를 띄우고 가까이 본 꺼짐으로 넘어감. hot은 5번 켜기 단계가 끝난 뒤에만 풀린다 |
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
  - 「7번 wait를 빼면 `켠 가전은 계획 안에서 끕니다`로 버린다. 7번 until이 `{"device": mw, "state": "off"}`면 받는다. 같은 wait를 인덕션 켜기 뒤에 두면 버린다(등록부 selfStop 아님). notice가 「끝」이면 wait로 받지 않는다(지금 검사)」.
  - 실행 추적: 「5번 명령 전에 승인 질문, 승인 뒤 VLM 쓰는 중이면 넘어감」, 「켜라고 한 뒤 켜짐을 보고 6번 동안 꺼짐을 보면 `tick`이 hot을 풀고, 7번은 `onAt`으로 바로 끝나며, 계획이 끝나도 끄기 안내가 없다」, 「5번을 「완료」로 넘기고 첫 관측이 꺼짐이면 7번이 끝나지 않고 20초 뒤 부탁이 뜨며, 가까이 본 꺼짐이면 끝난다」, 「7번 전에 그만두면 안전 안내 자리에 끄기 안내(「전자레인지를 꺼 주세요」)가 뜬다」, **「5번을 「완료」로 넘겼고 전자레인지가 옛 꺼짐 그대로면(켜짐 이력 없음) 7번이 끝나지 않고 hot이 남으며, 시간 초과 질문에 「그만」이면 끄기 안내가 간다」**, 「켜라고 하기 전에 있던 켜짐 → 꺼짐 이력으로는 7번이 끝나지 않는다」, **「켜라고 하기 전에 찍은 꺼짐 사진의 답이 켜라고 한 뒤 늦게 도착해도 7번이 끝나지 않고 hot·끄기 안내가 그대로다」**, 「`selfStopWait`는 인덕션 wait·until이 다른 wait에는 null」.
  - 7번과 안전 추적이 같은 판정(Task 11c-1에서 옮김): **「5번을 「완료」로 넘긴 뒤 첫 관측이 꺼짐이면 7번이 끝나지 않고 hot도 남는다(7번과 `releaseIfOff`가 같은 `cycleEnded`)」**, **「추정 꺼짐(VLM이 전원을 말하지 않음)만 이어지면 트윈이 꺼짐이 되어도 7번이 끝나지 않고 hot도 남는다」**, **「명시 꺼짐(「꺼져 있음」)이면 7번이 끝나고 hot이 풀린다」**, **「켜짐을 놓친 뒤 7번이 20초 넘게 안 끝나면 명령 줄에 그 단계 id로 부탁 「전자레인지가 보이게 폰을 가까이 대 주세요」(답 단추 없음)가 한 번 뜨고, 부탁 뒤 촬영된 가까이 본 명시 꺼짐이면 7번이 끝나고 hot이 풀린다」**, 「부탁 전에 찍힌 가까이 본 꺼짐·멀리서 본 꺼짐(close 거짓)으로는 7번이 끝나지 않는다」, 「6번에 풀린 뒤 다시 켜져 회차가 오르면 7번은 새 회차의 꺼짐으로만 끝난다」, 「안전 안내 자리에 다른 계획의 안내가 떠 있어도 7번 부탁은 명령 줄에 뜬다」.
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
  6. `say` 「라면 끓이는 법 알려 줘」(가짜 감지기가 인덕션 자리와 겹치는 oven을 내고 가짜 VLM이 7번 뒤 쓰는 중, 11번 뒤 쓰는 중 아님을 냄) → 첫 명령 `수납장으로 가 주세요`, 12번은 꺼짐으로 끝나 끄기 안내 없음, 판단 사건 `assist: "coach"`, 6번 명령 `냄비를 인덕션에 올려 주세요`, 7번 전에 승인 질문.
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
  - 장면 7(장애인): 코치 계획 기준(첫 명령 30초 안, 인덕션 질문 1번, done, `--tail 600`). 누른 단추는 「승인」 1번과 라면 대본 4·6·10번 「완료」뿐. 7번 켜기·12번 끄기는 카메라(Task 11b)로 넘어간다. 못 넘어가면 「남은 결정」 5.
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
| 7 | 단계 `turn-on.mp4`(코치 계획 표를 바꿈) | 15초 | 0~3초 손이 인덕션 단추를 누름, 3~15초 상판의 켜짐 표시(화력 숫자·불빛)와 냄비가 화면 가운데에 보임 |
| 7 | 단계 `turn-off.mp4`(코치 계획 표를 바꿈) | 10초 | 0~3초 손이 끔, 3~10초 켜짐 표시가 꺼진 상판이 화면 가운데에 보임 |
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
- 켠 위험 가전 추적(hot·끄기 안내)을 파일에 남겨 서버를 다시 띄워도 이어 가기(지금은 집을 닫거나 서버를 끄면 사라진다).
- 반성 결과를 하루하루 비교해 보이는 화면.

## 남은 결정 (기본 「가」로 진행)

1. **비용 한도: 정함.** $2.20(사용자 승인).
2. **문 열기·닫기 끝 조건: 가로 진행.** 서버가 만드는 값이 그대로 「가」다: 문 상태가 없는 전자레인지는 단계가 시작된 뒤 본 설비 열림 사실의 지금 값(이미 열려 있으면 바로 넘어감). 「나」(바뀐 것만, `seq`)는 쓰지 않는다.
3. **서버 글의 물건 이름: 가로 진행.** 새 글 틀(c22ca2b)이 item을 넣어 「그릇을 전자레인지에 넣어 주세요」, 「냄비를 인덕션에 올려 주세요」처럼 나온다. 따로 할 일은 없다. 이름이 빠지는 곳은 do 넣기(「면과 스프를 넣어 주세요」, 자리 이름 없음)와 pick 꺼내기(「그릇을 꺼내 주세요」, 자리 이름 없음)다.
4. **전자레인지 끄기는 기다리기로 인정: 가로 진행.** Task 12의 등록부 `selfStop`.
5. **(Task 11b Step 0에서 인덕션이 카메라로 안 잡힐 때만) 라면 시연의 끄기.** 「완료」로 끄기를 인정하지 않으므로(Task 11c-1) 12번을 「완료」로 넘겨도 hot과 끄기 안내가 남는다. 가: 인덕션 켜짐 표시가 크게 보이게 `turn-on.mp4`·`turn-off.mp4`를 다시 찍고 Step 0을 다시 잰다(추천). 나: 라면 장면을 11번(익기 기다리기)까지만 쓰고 끄기는 영상에서 뺀다. 다: 12번만 「완료」로 넘기게 허용한다(안전 규칙을 느슨하게 하는 것이라 이 계획은 하지 않는다. 고르면 따로 정한다).
6. **풀린 추적을 다시 거는 기간: 가로 진행(10분).** 풀린 근거의 촬영 시각 뒤 10분 안에 그 가전의 새 켜짐을 보면 다시 건다(Task 11c-1 `rearmMs`). 나: 계획이 닫힌 뒤에는 다시 걸지 않는다(라면·전자레인지를 코치 밖에서 다시 쓸 때 안내가 뜨지 않지만, 취소 뒤 켠 불을 놓친다). 다: 집을 닫을 때까지 늘 다시 건다(코치 밖 평소 사용에도 끄기 안내가 뜬다).
7. **사용자 결정: 가전 종류 등록부 먼저(2026-11-15).** 가전 종류마다 이름·Matter 연결·트윈 type·카메라 낱말·위험 동작·손 조작을 `src/model/kinds.ts` 한 곳에 적고 흩어진 곳은 거기서 파생한다(Task 11 바로 뒤, Task 11r-1 결과가 같은 옮기기 → Task 11r-2 승인 판정·ThinQ 어댑터·등록부 검증). 새 종류는 등록부 한 줄 + `added_devices.json` 한 줄이다.

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
- 코디네이터 결정: Task 11c를 둘로 나눔(2026-11-15): Task 11c-1(track.ts 핵심: 회차 `onAt`·`cycleEnded`·`releaseIfOff`·`rearmIfOn`·`handOver`·`askToShow`, `sight_last`는 구현된 11a 모양(속성마다 `{ value, seen_ms, explicit }`)에 `close`를 더함, 끄기 안내는 지금 명령 줄에서 「완료」는 부탁으로·말로는 안 풀림·120초 만료는 다시 보냄·끄기 do 「완료」 뒤 hot 남음, 구조 검사·CLAUDE.md 한 줄, 시험은 라면 12번 허브 근거·전자레인지 카메라, 인덕션 카메라 근거 시험은 Task 11b로)와 Task 11c-2(11d 뒤: 안전 안내 자리로 옮김·두 가전 목록·120초 다시 읽기·B 명령 줄 안 막음·안내 중 가전을 켜는 B 승인 안 받음·영상 판정기는 안전 안내 단추를 안 누름). 7번 「다 되기 기다리기」 `cycleEnded` 시험은 Task 12로. 차례 11c-1 → 11d → 11c-2 → 12.
- Codex 27차 지적 2개: P2 11r-1 같은 결과 시험을 「kinds same: non-approval」·「kinds same: approval」 두 묶음으로 나누고 11r-2 Step 1에서 승인 묶음만 「approval diff: only widened, never narrowed」로 바꿈(`kinds-before.json`은 그대로, 승인 아닌 부분은 계속 완전 일치), P3 11r-2에 「kinds registry: TEMP_ALLOW is empty」 실패 시험. 기록 바로잡음: Task 11r 나누기는 코디네이터 결정.
- 코디네이터 결정: Task 11r을 둘로 나눔(2026-11-15): Task 11r-1(등록부·파생·구조 검사·같은 결과, 21종 값과 승인 표가 전과 똑같음, ThinQ 갈래는 잠시 허용 목록)과 Task 11r-2(승인 판정 `needsConfirm`·ThinQ 어댑터·`checkKinds`, 승인 차이표는 넓어진 것만·좁아진 것 없음). 11r-1 → 11r-2 → 11a 차례를 Consumes·Produces로 이음.
- Codex 26차 지적 5개: P1 Task 11r 위험 켜기 종류는 끄기 말고 상태를 바꾸는 명령 전부를 승인 대상으로(`needsConfirm`, 이름 정규화·capabilities 덮어쓰기와 무관), 등록부 검증은 덮어쓴 실제 사양까지, P2 ThinQ 트윈 반영(`mirrorPlan`)도 어댑터로, P2 어댑터가 받는 명령과 프로필이 내는 명령이 맞는지 검증, P3 `heatingSetpoint`의 `|| systemMode === "heat"`는 그대로, P3 구조 검사가 지역 변수 `kind`·`switch`·`src/thinq/`까지.
- Codex 25차(재부팅 뒤 첫 리뷰) 지적 5개: P1 Task 11r 등록부 검증 `checkKinds`(승인 명령은 프로필로 정규화한 명령과 같아야 함 등), P2 `deviceKind` 금지는 문자열 값을 저장하는 자리만(이름 조회 콜백 허용), P2 `twinChange`·`heatingSetpoint`를 종류 이름 대신 프로필로 가름, P2 ThinQ 읽기·제어는 등록부 `thinq.adapter`로 고른 어댑터(지원 목록을 따로 두지 않음), P3 구조 검사에 SIGHT 꼴·계산 키·`Object.fromEntries`·종류 이름 배열 금지 예제.
- 사용자 결정: 가전 종류 등록부 먼저(2026-11-15): Task 11r(등록부 `src/model/kinds.ts`, 흩어진 종류별 표 파생, 등록부 밖 종류별 표를 찾는 구조 검사, 바꾸기 전 21종과 같은 결과 시험, 새 종류 추가하는 법), Task 11a·11b·12의 종류별 값(카메라 규칙·selfStop)을 등록부 칸으로.
- Codex 16차 지적 2개: P2 Task 11d 늦은 hello 뒤에는 처음 보낸 명령 전체(kind·target·vision)를 지금 AR 좌표로 다시 보냄, P2 on_timeout "ask"가 있는 계획은 needsPhone, 계획 도중 물을 폰이 없으면 바로 실패로 닫아 PAM을 풀고 위험 가전 추적은 남김.
- Codex 15차 지적 2개: P2 Task 11d 2초 뒤라도 맞는 hello가 오면 연결을 정상으로 되돌리고 지금 명령·안전 안내를 다시 보냄, P2 맞는 폰이 없을 때 폰이 필요한 계획만 미루고(`needsPhone`) 가전만 쓰는 승인된 계획은 시작, 기존 시험의 폰 연결은 hello를 보내는 `openPhone`으로.
- Codex 14차 지적 2개: P1 Task 11d 들은 승인은 말할 때 보인 승인 대기 token 하나만 답하고(`answerToken`) 없거나 다르면 버림, 들은 말로 `answerAll` 안 함, P2 폰이 연결 때 판본(hello)을 알리고 판본 없거나 다른 옛 탭은 서버가 새로 고침 명령만 보내고 실행·답을 막음.
- Codex 13차 지적 2개: P1 Task 11d `onHeard` 결과에 「버림」(stale)을 두고 에이전트로 넘기지 않음, P2 명령 답 말에는 `at`이 꼭 있어야 하고(옛 탭은 버림, 「그만」만 늘 받음) 계약 판본(`PHONE_PROTOCOL`)이 다르면 폰이 다시 읽음, 안전 안내 자리는 엄지 영역 밖.
- Codex 12차 지적 4개: 1·2·3 멈춤·번갈아 보이기를 빼고 닫힌 계획의 안내는 폰 안전 안내 자리(Task 11d, 자기 id·단추 답만, 스케치 확인 먼저)로, 음성 답은 말 시작 때 명령 id를 실어 다르면 버림, 명령 단추 key·누르는 중 바뀌면 취소, 4 Task 11a 같은 값이라도 근거 종류가 바뀌면 이력 줄.
- Codex 11차 지적 3개: P1 Task 11a 명시 꺼짐(`not_in_use`)·추정 꺼짐을 나누고 안전 해제는 명시만, P1 Task 11c B의 켜진 가전 관련 단계는 멈추지 않고 A 안내와 10초마다 번갈아 보임, P1 Task 11c 켜기 회차(cycle)로 옛 부탁·근거 버림과 지금 켜짐 신호면 풀지 않음.
- Codex 10차 지적 4개: P1 Task 11c `rearmIfOn`은 해제 근거의 촬영 시각과 견줌, P2 다른 계획과 겹칠 때(안내가 앞서고 B는 멈춤·같은 id로 다시, 승인 질문은 덮지 않고 같은 가전 켜기 승인은 받지 않음, Task 9 누르기 시험), P2 7번과 `releaseIfOff`가 같은 `cycleEnded`, P2 확인 불가 복구(부탁 뒤 가까이 본 꺼짐 confirmed, 미루는 까닭 화면 글).
- Codex 9차 지적 3개: P1 Task 11c `releaseIfOff` 세 조건(켜기 단계 끝남·촬영 근거 꺼짐·앞 값이 아는 켜짐)과 `rearmIfOn`(풀린 뒤 10분 안 새 켜짐이면 다시 걸기), P2 Task 11b 투영한 상판 다각형의 가장 낮은 줄, P3 Task 12 옛 지우기 문장을 Task 11c 원칙으로.
- Codex 8차 지적 4개: P1 Task 11c에 말 「다 했어」 경로와 지우는 자리 전부의 표·`releaseIfOff` 하나·구조 검사, P2 Task 12 꺼짐 기다리기는 hot이 아니라 `onAt`으로, P2 Task 11b 상판 높이 평면 교차, P2 Task 11b 마스크 위아래 범위로 빌트인 오븐 거르기.
- Codex 7차 지적 3개: P1 Task 11c 「완료」·만료·끄기 do 「완료」로 추적을 풀지 않음과 기존 시험·시연 영향, P1 Task 11a에 `became` 근거 촬영 시각, P2 Task 11b 인덕션 자리와 겹치는 oven만 「인덕션」 설비로.
- Codex 6차 지적 3개: P1 Task 11a 근거 촬영 시각(`seen_ms`)으로 `offSince`(끄기 안내·꺼짐 기다리기 같이), P2 Task 11b 인덕션 전원 카메라 보기와 못 볼 때 대안·남은 결정 5, P2 Task 9 예약을 계획 id·단계 id·글 셋으로.
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
