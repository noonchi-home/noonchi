# 시연 시나리오 넷과 눈치·코치 자동 판단 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발표 영상 하나로 네 장면을 잇는다. 눈치 모드 ① 첫날: 상황 파악(빈 컵 치우기·남은 컵 그대로 두기)과 의도 파악(「아 덥다」 → 에어컨 켜기), ② 일주일 뒤: 일주일 기록을 날마다 반성해 배운 습관으로 말하기 전에 에어컨 켜기. 코치 모드 ③ 노인 전자레인지 쓰는 법 가이드, ④ 탈시설 장애인 라면 끓이기 가이드. 돕는 방식은 「자동」으로 두고, 판단마다 눈치인지 코치인지가 생각 말풍선 칩에 보인다.

**Architecture:** 구조는 그대로다. 「자동」이면 PAM에 눈치·코치 행동을 모두 보내고 FSM 기억이 고른다. 화면의 「눈치·코치」 칩은 고른 행동의 종류(`TaskSpec.coach`)를 그대로 보일 뿐 판단하지 않는다. 일주일은 합성 관찰 기록(`scripts/seed-history.ts`)으로 만들고, 반성은 실제 PAM으로 하루씩 일곱 번 이어 돌린다(1~6일은 녹화 전에, 7일은 녹화 중에). 새 기억은 다음 날부터 쓰는 규칙 그대로다. 반성 뒤에는 거르기 자리 둘을 둔다: 코치 규칙을 seed 그대로 지키는 검사(이 계획), 박석준의 p값 습관 후보정(자리만).

**Tech Stack:** Node 22 TypeScript 서버, SQLite 기록 DB, PAM 서비스(Python FastAPI, `services/pam/`), zod, Vitest, React(`ui/`), 가짜 OpenAI 호환 서버·시험용 PAM 자리, 영상 판정(`scripts/video-check.ts`).

**Spec:** 허정오 시연 시나리오(2026-11-13): 「[눈치 모드] 1. 첫 일주일: 상황 파악 후 작업 처리, 의도 파악 후 작업 처리 2. 일주일 후: 사용자의 습관과 학습한 선제적 행동 [코치모드] 3. 탈시설 장애인을 위한 가이드 모드 4. 가정 내 노인분들 위한 뭔가?」, 「눈치모드로 동작할지 코치모드로 동작할지 알아서 판단하는 것도 의미가 있을듯」, 「일주일 뒤에도 습관 기반 행동하는 것도 눈치 모드야」, 「3번 4번 순서를 바꿔줘」(코치 모드는 3. 노인, 4. 탈시설 장애인 순서). 아래 「정한 것」은 사용자가 모두 추천안으로 정했다(2026-11-13). 회의록 2026-11-12(눈치코치, PAM 매일 반성 후 다음 날 적용, p값 후보정, 기본 동작, ThinQ 사용설명서), 2026-11-09(가이드 모드). 구현 뒤 `docs` 저장소 `01_Product/구현명세서 SSOT.md`(돕는 방식·반성·시연)와 `변경이력.md`를 고친다.

**먼저 된 것:** 같은 브랜치의 `2026-11-13-cup-branches.md` Task 1~10, `2026-11-13-coach-mode.md` Task 1~13과 Codex 고침(`c224568`·`fec2e7d`·`cc3cc17`·`f267e6c`·`f83b0b0`). 코치 계획 Task 14 Step 1(영상 판정에 말 넣기 `--say`)은 아직 없어 이 계획 Task 9로 옮겼다.

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

## 조사한 사실 (2026-11-13, `feat/coach-cup` f83b0b0)

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

**폰 글 거르기(f83b0b0)**
- 폰으로 나가는 모든 사람용 글(단계 이름·명령·안전 문구·알림·질문·답·다시 알리기·사람 부탁·에이전트 답)은 `phoneLineProblem`(`src/agent/policy.ts`)이 거른다. 위험 가전(인덕션·전자레인지) 이름이 나오거나 대상이 위험 가전인 글은 허용 낱말(가 주세요·열어·닫아·넣어·꺼내·기다려·조심·뜨거워 …)이나 끄는 말만 통과하고, 켜는 말·조작하는 말(누르·눌러·버튼·작동·돌려·돌리·시작해 주 …)이나 모르는 말은 그 가전의 hand_device(to on) do 단계에서만 쓸 수 있다.
- hand_device가 있는 do의 끝 조건은 그 단계가 시작된 뒤에 바뀐 것 `{"device": id, "became": "on" | "off"}` 하나다.

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
  - 폰으로 나가는 사람용 글은 `phoneLineProblem`을 지난다. 위험 가전 단계 글은 허용 낱말로 쓰고, 켜는·누르는 말은 hand_device(to on) do 단계에만 둔다.
  - 승인 규칙 그대로. 위험 목록(인덕션 켜기·전자레인지 시작)은 늘 묻는다.
- 시험·빌드·크롬은 `npm run heavy -- <cmd>`로만, 한 번에 하나. 크롬·dev3d는 PC에 하나만.
- 이 PC 메모리는 13.8GB다. 녹화(`--record`)할 때는 `BRAIN_YOLO_PROVIDER=cpu`로 띄우고, PAM 서비스·서버·크롬 하나 밖의 무거운 프로그램은 끈다.
- 실제 모델 비용(추정, VLM 한 장 약 $0.0008·판정 한 번 약 $0.03~0.05에서 셈):
  - 컵·TV 장면 한 판 $0.03~0.05, 대조 한 판 $0.03.
  - 반성 한 번 $0.01~0.05(첫 판에 OpenRouter 사용 기록으로 잰다), 일곱 번 $0.07~0.35, 한 번에 1~4분.
  - 전자레인지 한 판 $0.08~0.13(기다리기 동안 붙잡은 장면도 VLM이 2초마다 본다).
  - 라면 한 판 $0.20~0.32(기다리기 두 번, 계획 모델이 고른 시간만큼 VLM이 더 돈다. 4분씩이면 약 $0.19 더).
  - 한 바퀴(장면 일곱 + 대조 + 반성 일곱) 약 $0.50~0.95. 이 계획 한도 $2.20(두 바퀴 + 다시 돌리기). 넘기 전에 멈추고 보고한다.
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
- Modify: `src/server/app.ts`(`GET /api/memory/day/:day`), `src/history/db.ts`(필요하면 판본 조회 칸), `src/server/start.ts`(반성 사건을 집 묶음에도 넘김), `src/server/home.ts`(`brainLast`에 오늘 마지막 반성), `ui/src/dashboard/data.ts`(`thoughtOf`), `ui/src/dashboard/use-dash.ts`, `src/act/say.ts`, `src/plan/labels.ts`
- Test: `tests/history-api.test.ts`, `tests/server-events-backlog.test.ts`, `ui/tests/dashboard/data.test.ts`, `tests/act-say.test.ts`

**Interfaces:**

```ts
// GET /api/memory/day/:day → 그날 고정 상태(읽기만, 고정하지 않는다)
interface MemoryDayView {
  ok: true; day: string;
  /** 그날 판단이 이미 고정한 판본(없으면 null). */
  pinned: number | null;
  /** 지금 판단이 부르면 쓸 판본(pinned, 없으면 memoryFor(day)). */
  uses: { version: number; source: "seed" | "reflection" | "synthetic"; appliesDay: string | null } | null;
  latest: number | null;
}
// SAY_TEXT.learned = (n: number) => `어제 기록으로 새 습관 ${n}개를 배웠어요.` (sayLine의 reflected?: { atMs: number; n: number }, 20초)
// WORDS.learnedNow = "새로 배움"
```
- 새로 붙은 대시보드는 마지막 판단과 함께 오늘(기록 시간대) 마지막 반성 사건을 `replay: true`로 받는다(기록 DB `reflection` 줄에서 읽는다. 합성 판본도 같다).
- `thoughtOf`: 반성 사건이 마지막 유효 판단보다 새롭고 `learned`가 있으면 첫 배운 규칙을 보인다: `reasoning` = 트리거 글, 앞 칩 `습관 · 새로 배움`, 뒤 칩 `눈치 · 행동`. 다음 유효 판단이 오면 그 판단으로 바뀐다.

- [ ] **Step 1: 실패하는 시험.** 「`/api/memory/day/<오늘>`이 판단 전에는 `pinned: null`, 첫 판단 뒤에는 그 판본」, 「이 API를 불러도 고정되지 않는다」, 「반성 뒤 붙은 대시보드가 반성 사건을 다시 받는다」, 「배운 규칙이 생각 말풍선에 뜨고 칩이 `습관 · 새로 배움`, `눈치 · 에어컨 켜기`」, 「다음 판단이 오면 바뀐다」, 「learned가 비면 그대로」, 말풍선 카드 글.
- [ ] **Step 2:** 시험 실행 → 실패 확인.
- [ ] **Step 3:** 구현(새 칸 없음, 칸 크기 그대로).
- [ ] **Step 4:** 통과 확인, `npm run lint`.
- [ ] **Step 5:** 커밋 `feat(server): expose the day's memory pin and show what reflection learned`.

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

### Task 8: 시연 준비 명령 (폴더·시작 위치·이어 반성)

**Files:**
- Create: `scripts/demo-setup.ts`, `scripts/demo-start.ts`, `tests/demo-setup.test.ts`

**Interfaces:**

```
npx tsx scripts/demo-setup.ts day1  [--dir runtime/demo/day1]
  빈 기록 DB, setup.json { version: 1, home: "mokryeon_180b", done: true, mode: "test", assist: "auto" },
  homes/mokryeon_180b/approvals.json(컵 치우기·컵에 물 채워 주기·에어컨 켜기·라면 끓이기 알려 주기·전자레인지로 데우기 알려 주기),
  homes/mokryeon_180b/lessons.json(라면 끓이기 알려 주기 두 판: 이동 넷·냄비 꺼내기 alone 2),
  homes/mokryeon_180b/phone-start.json(첫 장면 cup의 시작 위치)
npx tsx scripts/demo-setup.ts week  [--dir runtime/demo/week] [--end YYYY-MM-DD(기본 어제)]
  day1과 같은 파일(phone-start는 tv) + seedHistory({ memories: "none" })
npx tsx scripts/demo-setup.ts start <cup|tv|microwave|kitchen> [--api http://127.0.0.1:8200]
  서버의 지금 집이 mokryeon_180b인지 GET /api/homes로 보고 아니면 멈춘다. 그 장면 시작 위치를 POST /api/phone/start-pose.
npx tsx scripts/demo-setup.ts reflect --chain [--api …] [--from 1일차] [--to 6일차]
  날마다 차례로: GET /api/memory/day/<그날+1>로 pinned가 null인지 → POST /api/reflection/run {day} → appliesDay가 그날+1인지 →
  GET /api/memory/day/<그날+1>의 uses.version이 새 판본인지. 하나라도 아니면 그 날짜와 까닭을 찍고 멈춘다. 날마다 배운 규칙을 찍는다.
npx tsx scripts/demo-setup.ts reflect [--api …] [--day 어제]
  전: GET /api/memory/day/<오늘> pinned가 null이 아니면 「폰을 켜기 전에 반성하세요」로 멈춘다.
  POST /api/reflection/run → appliesDay가 오늘이 아니면 멈춘다.
  후: GET /api/memory/day/<오늘>의 pinned가 null 또는 새 판본, uses.version이 새 판본이어야 한다. 아니면 「반성 중에 판단이 오늘 기억을 고정했어요」로 멈춘다.
  끝에 배운 규칙과 「말없이 에어컨을 켜는 규칙」이 있는지 찍는다(없으면 reflect --scripted를 권한다).
npx tsx scripts/demo-setup.ts reflect --scripted [--dir runtime/demo/week]
  서버를 끈 채: 합성 판본(seedHistory scripted + habit)을 오늘부터로 넣고, 반성 줄 data.synthetic = true.
```
- `scripts/demo-start.ts`: `export const DEMO_STARTS: Record<"cup" | "tv" | "microwave" | "kitchen", { target: string; distanceM: number }>` (cup: `dining_table_978b20c7` 1.5m, tv: 거실 소파 1.8m, microwave: `microwave_kitchen` 1.2m, kitchen: `induction_counter_5641ccf0` 1.5m)와 `export function startFor(scene: SceneJson, target: string, distanceM: number): { position: [number, number]; yaw_deg: number }`(대상 가운데에서 그 방 다각형 가운데 쪽으로 distanceM, 대상을 보는 방향). 소파 id는 Step 3에서 `twin/homes/mokryeon_180b/scene.json`에서 읽어 넣는다.

- [ ] **Step 1: 실패하는 시험.** 「day1이 다섯 파일을 쓰고 기록 DB가 비어 있다」, 「`startFor`가 식탁 앞 1.5m·식탁을 보는 방향을 내고 그 자리가 방 안이다」, 「start가 지금 집이 원룸이면 시작 위치를 보내지 않고 멈춘다」, 「reflect --chain이 가짜 서버로 1~6일을 차례로 부르고, 3일차 appliesDay가 어긋나면 3일차에서 멈춘다」, 「reflect가 오늘 pinned가 있으면 부르지 않는다」, 「반성 뒤 오늘이 다른 판본으로 고정돼 있으면 멈춘다」, 「`--scripted`는 서버 없이 오늘부터 쓰는 판본에 에어컨 습관이 있고 반성 줄에 합성 표시」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/demo-setup.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현. 기록 DB·합성 대본은 `scripts/seed-history.ts`의 함수, 시작 위치 모양은 `src/sync/start.ts`의 검사를 쓴다.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(scripts): add demo-setup for folders, scene start poses and chained reflection`.

### Task 9: 영상 판정 — 말 넣기, 시작 위치, 끝난 뒤 기다림

**Files:**
- Modify: `scripts/video-check.ts`(`Args`, 인자 읽기, 실제 판정의 시작 위치, `TAIL_MS` → 인자)
- Test: `tests/video-check.test.ts`

**Interfaces:**
- `--say <초>:<글>` 여러 번: 그 영상 시각에 폰 페이지 안에서 폰 소켓으로 `{ type: "say", text }`를 보낸다(CDP `Runtime.evaluate`). 시각표에 `말 · <글>`. 틀린 값(초가 숫자가 아님, 글이 빔, 60자 넘음)은 쓰는 법 글.
- `--start-at <cup|tv|microwave|kitchen>`: 폰 페이지를 열기 전에 `demo-start.ts`로 그 장면 시작 위치를 보낸다(지금 집이 `--home`, 기본 mokryeon_180b가 아니면 멈춤). 없으면 지금처럼 저장된 시작 위치를 쓴다.
- `--tail <초>`(기본 30, 10~900): 영상이 끝난 뒤 계획이 열려 있으면 더 보는 시간. `Args.tailMs`.

- [ ] **Step 1: 실패하는 시험.** 「`--say 5:아 덥다`를 `{ atMs: 5000, text: "아 덥다" }`로 받는다」, 「틀린 `--say`·`--tail 5`는 쓰는 법 글」, 「시각표에 말 줄이 그 시각에 있다」, 「`--start-at microwave`면 페이지를 열기 전에 시작 위치를 보내고, 지금 집이 다르면 판정을 시작하지 않는다」, 「`--tail 300`이면 끝난 뒤 300초까지 본다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/video-check.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인. `--fake`로 `cup-empty-leave.mp4`에 말을 넣어 한 번 돌려 본다(비용 0).
- [ ] **Step 5:** 커밋 `feat(video): inject spoken lines, set scene start poses and extend the tail wait`.

### Task 10: 영상 페이지 — 같은 대상 단계 영상을 차례로, 마지막 장면 붙잡기

**Files:**
- Modify: `ui/src/phone/core/video-ar.js`(`current.command`, 단계 영상 끝 처리), `ui/src/phone/core/video-ar.d.ts`
- Test: `ui/tests/phone-video.test.ts`

**Interfaces:**
- `--step` 형식은 그대로(`<종류>:<낱말>:<영상>`). **같은 종류·낱말 칸이 여럿이면 적은 차례대로 쓴다**: 그 종류·낱말에 맞는 새 명령(계획 id·단계 id가 처음인 것)이 올 때마다 다음 칸. 칸이 다 떨어지면 마지막 칸을 다시 쓰지 않고 지금 영상을 둔다. 칸이 하나인 지금 쓰임은 그대로다.
- 단계 영상이 끝나면 마지막 장면을 붙잡는다: 다음 단계 영상이 오거나 판정이 끝날 때까지 그 장면으로 엔진 프레임을 계속 보낸다(표시도 그 장면). 붙잡은 동안 `__noonchiVideo.ended`는 거짓이다. 첫 영상(`clip`)이 끝났을 때는 지금처럼 끝으로 본다.

- [ ] **Step 1: 실패하는 시험.** 「`do:microwave:a.mp4`·`do:microwave:b.mp4`·`do:microwave:c.mp4`가 있으면 전자레인지 대상 do 명령 셋에 a·b·c를 차례로 튼다」, 「같은 명령이 다시 와도(비전 상태만 바뀜) 다음 칸으로 넘기지 않는다」, 「칸이 하나면 지금처럼」, 「단계 영상이 끝난 뒤 5초 동안 엔진 프레임이 계속 나가고 그 화소가 마지막 장면과 같다」, 「다음 단계 영상이 오면 붙잡기를 푼다」.
- [ ] **Step 2:** `npm run heavy -- npm test --prefix ui -- phone-video` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(video): use repeated step clips in order and hold the last frame of a step clip`.

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
- Modify: `src/act/tasks.ts`, `services/pam/scenarios/noonchi/tasks.json`, `services/pam/scenarios/noonchi/scenario.json`(Task 4 행동 이름 줄·코치 행동 줄에 새 이름), `src/brain/decision.ts`(`cooking` 상태), `src/world/labels.ts`(`FSM_STATE_TEXT.cooking` → `"주방에서 할 일을 찾음"`), `tests/helpers/planner.ts`(`microwaveSteps`, 대본 표)
- Test: `tests/act-tasks.test.ts`, `tests/agent-planner.test.ts`, `tests/phone-lines.test.ts`, `tests/brain-decision.test.ts`, `tests/pam-scenario.test.ts`

**Interfaces:**

```ts
"전자레인지로 데우기 알려 주기": {
  name: "전자레인지로 데우기 알려 주기", coach: true, maxSteps: 12,
  description: "사람이 전자레인지 앞에서 쓰는 법을 묻거나 막히면 문 열기부터 꺼내기까지 사람이 할 일을 단계마다 천천히 알려 준다. 클로이드는 가전을 조작하지 않는다.",
  allow: { kinds: ["go", "pick", "place", "do", "wait", "say"], need: ["do"] },
},
// cooking 상태 description: "사용자가 주방에서 음식을 만들거나 데우려 한다. 방법을 묻거나 무엇을 할지 몰라 멈춰 있으면 단계마다 알려 준다."
// cooking rules에 더함: { trigger: "사용자가 전자레인지 앞에서 쓰는 법을 묻거나 이거 어떻게 하냐고 말한다.", action: "전자레인지로 데우기 알려 주기" }
export function microwaveSteps(ids: { microwave: string; waitS?: number }): Record<string, unknown>[];
```
- 시험 대본 8단계(글은 모두 `phoneLineProblem` 허용 낱말로 쓴다. 켜는 말은 시작 단계에만):

| # | kind | label | command / text | 그 밖 | until |
|---|---|---|---|---|---|
| 1 | go | 전자레인지로 가기 | 전자레인지 앞으로 가 주세요 | target 전자레인지 | phone_near |
| 2 | do | 문 열기 | 전자레인지 문을 열어 주세요 | target 전자레인지 | `{"fixture": "microwave", "facts": {"open": "open"}}` |
| 3 | place | 그릇 넣기 | 그릇을 안에 넣어 주세요 | target 전자레인지 | 없음(「완료」) |
| 4 | do | 문 닫기 | 문을 닫아 주세요 | target 전자레인지 | `{"fixture": "microwave", "facts": {"open": "closed"}}` |
| 5 | do | 시작 단추 누르기 | 시작 단추를 눌러 주세요 | hand_device on, caution `그릇이 뜨거워져요.` | `{"device": 전자레인지, "became": "on"}` |
| 6 | say | 데워지는 중 | 다 될 때까지 기다려요. | | elapsed 4초 |
| 7 | wait | 다 될 때까지 기다리기 | | | `{"elapsed_s": waitS(기본 60)}` |
| 8 | do | 꺼내기 | 다 되면 문을 열고 그릇을 꺼내 주세요 | hand_device off | `{"device": 전자레인지, "became": "off"}` |

- 전자레인지 시작은 위험 목록이라 실행 추적이 5번 명령 전에 묻는다(코치 계획 Task 9). 끄기 단계(8번)는 hand_device off라 「켠 가전은 계획 안에서 끈다」 검사를 지난다. 「돌아가는」·「돌려」처럼 켜는 말로 걸리는 낱말은 쓰지 않는다.

- [ ] **Step 1: 실패하는 시험.** 「행동 목록 아홉, 앞 여덟 순서 그대로, 새 행동은 `coach`」, 「`tasksFor("noonchi")`에 없고 `coach`·`auto`에 있다」, 「`tasks.json`·`scenario.json` 이름 줄이 맞다」, 「가짜 모델의 전자레인지 계획이 계획 검사를 지나고 5번이 `riskyHand`」, 「대본의 모든 label·command·caution·text가 그 단계 자리에서 `phoneLineProblem` null」, 「5번 command를 2번(hand 없음)에 두면 계획 검사가 버린다」, 「5번 until을 `state`로 쓰면 버린다」, 「`fsmRuleOf`가 `cooking`」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/act-tasks.test.ts tests/agent-planner.test.ts tests/phone-lines.test.ts tests/brain-decision.test.ts tests/pam-scenario.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(act): add microwave coaching for older people`.

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
  5. 전자레인지 감지 + `say` 「이거 어떻게 하지」 → 첫 명령, 판단 사건 `assist: "coach"`, 5번 단계에서 승인 질문이 먼저 오고 승인 뒤 VLM이 전자레인지 쓰는 중을 내면 넘어간다.
  6. `say` 「라면 끓이는 법 알려 줘」 → 첫 명령 `수납장으로 가 주세요`, 판단 사건 `assist: "coach"`.
  7. 모든 PAM 요청에 사진 칸이 없고 `contract`가 `pam-predict/2`·`pam-reflect/2`.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/demo-e2e.test.ts` → 실패 확인.
- [ ] **Step 3:** 빠진 연결을 고친다.
- [ ] **Step 4:** 통과 확인(시험 시간 한도 120초). 가짜 서버 `EFAULT`면 그 시험만 다시.
- [ ] **Step 5:** 커밋 `test(e2e): demo scenarios in auto mode from day one to coaching`.

### Task 14: 실제 판정·녹화·문서

- [ ] **Step 1:** `npx tsc --noEmit -p .`, `npm run lint`, `npm run heavy -- npx vitest run`, ui 시험, `services/pam`의 `python -m pytest`, `npm run heavy -- npm run build --prefix ui`.
- [ ] **Step 2: 가짜 판정.** 아래 「시연 순서」의 장면마다 `--fake`로 시각표가 나오는지 본다(비용 0).
- [ ] **Step 3: 이어 반성(녹화 전, $0.06~0.30).** `demo-setup week` → 서버 → `demo-setup reflect --chain`. 날마다 배운 규칙을 적는다(언제 에어컨 규칙이 처음 생겼는지, 코치 규칙이 빠진 날).
- [ ] **Step 4: 실제 판정(한 바퀴 약 $0.50~0.95).** 장면마다 한 판. **기준:**
  - 장면 1·2: 컵 갈래 계획 기준.
  - 장면 3: 말 뒤 15초 안에 에어컨 켜기·칩 `눈치 · 에어컨 켜기`. 대조(day1 폴더에서 `tv-sit.mp4`)는 에어컨을 켜지 않음.
  - 장면 4: 7일 반성이 `appliesDay` 오늘, 말없이 에어컨을 켜는 규칙(행동 이름 그대로, 한국어 트리거).
  - 장면 5: 말없이 에어컨 켜기·칩 `습관 · …`.
  - 장면 6(노인): 말 뒤 30초 안에 첫 명령, 문 열기·닫기는 비전으로 넘어감, 시작 전 질문 1번, 끝까지 done(`--tail 180`).
  - 장면 7(장애인): 코치 계획 기준(첫 명령 30초 안, 인덕션 질문 1번, done, `--tail 600`).
  - 반성이 규칙을 못 내면 `raw_response`를 보고 Task 4 지시문을 한 번 고쳐 1~7일을 다시 이어 돈다. 그래도 안 되면 `reflect --scripted`로 찍고 자막.
- [ ] **Step 5: 녹화.** 장면마다 `--record`(`BRAIN_YOLO_PROVIDER=cpu`). 프레임 4장씩 뽑아 칩·말풍선 카드·트윈 에어컨·전자레인지를 본다. 기다리기·반성 대기는 편집에서 줄인다.
- [ ] **Step 6: 문서.** `docs` 저장소 `01_Product/구현명세서 SSOT.md`(돕는 방식 자동, 판단 칩, 반성 지시문 바꾸기, 반성 뒤 검사·거르기 자리, 기억 상태 API, 마지막 반성 다시 보내기, 시연 준비 명령, 더한 가전 파일, 전자레인지 코치, 영상 판정 인자), `변경이력.md`.
- [ ] **Step 7:** Codex reviewer(herdr `w2:p5`)에게 브랜치 전체를 리뷰받고 지적을 고친다. `trail note`로 반성 지시문을 바꾼 까닭과 이어 반성을 고른 까닭을 남긴다.

## 시연 순서 (발표 영상, 약 7분)

| 순서 | 모드 · 장면 | 집 폴더 | 명령 | 보여 줄 것 |
|---|---|---|---|---|
| 0 | 설정 | day1 | 없음 | 설정 3단계 돕는 방식 「자동」 (3초) |
| 1 | 눈치 · 1일차 상황 | day1 | `video-check --start-at cup --clip cup-empty-leave.mp4` + 치우기 단계 영상 | `상태 · 컵을 두고 자리를 뜸`·`눈치 · 컵 치우기`, 네 명령 |
| 2 | 눈치 · 1일차 상황 | day1 | `--start-at cup --clip cup-full-leave.mp4` | `눈치 · 컵 그대로 두기`, 「컵을 그대로 두기로 했어요.」 |
| 3 | 눈치 · 1일차 의도 | day1 | `--start-at tv --clip tv-hot-say.mp4 --say 15:아 덥다` | `눈치 · 에어컨 켜기`, 트윈 거실 에어컨 켜짐 |
| 4 | 눈치 · 일주일 | week | (녹화 전 `reflect --chain`) `demo-setup reflect` | `습관 · 새로 배움`, 「어제 기록으로 새 습관 1개를 배웠어요.」 |
| 5 | 눈치 · 8일차 선제 | week | `--start-at tv --clip tv-sit.mp4` | 말없이 `습관 · …`·`눈치 · 에어컨 켜기` |
| 6 | 코치 · 노인 | day1 | `--start-at microwave --clip microwave-start.mp4 --say 4:이거 어떻게 하지 --tail 180` + `go:microwave:go-microwave.mp4`, `do:microwave:open-microwave.mp4`, `place:microwave:put-bowl.mp4`, `do:microwave:close-microwave.mp4`, `do:microwave:start-microwave.mp4`, `do:microwave:microwave-done.mp4` | `코치 · 전자레인지로 데우기 알려 주기`, 문 열림·닫힘을 비전으로 넘김, 시작 전 질문, 트윈 전자레인지 켜짐·꺼짐 |
| 7 | 코치 · 탈시설 장애인 | day1 | `--start-at kitchen --clip kitchen-start.mp4 --say 5:라면 끓이는 법 알려 줘 --tail 600` + 라면 단계 영상, 물 받기에 `wrong-fridge.mp4`, 면 넣기 때 `--say <초>:어 뭐 해야 되지` | `코치 · 라면 끓이기 알려 주기`, 인덕션 켜기 전 질문, 바로잡기, 조용한 단계(수업 기록 씨앗) |

- 장면 6의 do 칸 넷은 적은 차례(열기·닫기·시작·꺼내기)대로 쓰인다(Task 10). 계획 모델이 다른 순서로 do를 내면 그 판은 다시 돌린다.
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
| 6 | 단계 `start-microwave.mp4` | 15초 | 단추를 누르고 안의 불이 켜져 접시가 도는 것이 10초 보임(끝 장면을 기다리기 동안 붙잡는다) |
| 6 | 단계 `microwave-done.mp4` | 15초 | 불이 꺼진 것이 3초 보이고 문을 열어 그릇을 꺼냄 |

김준형 집 촬영(11-13 금 수업 뒤 ~ 11-14 토 낮)에 같이 찍는다. 전자레인지가 없으면 다른 집에서 찍는다.

## 그 뒤 (이 계획에 넣지 않음)

- 사람 프로필(일반·발달장애·노인)과 프로필마다 seed FSM(자동 판단 안 나).
- 박석준 습관 후보정을 `HabitFilter`에 끼우기(Python이면 `pam-habits/1`).
- 약 먹을 때 챙기기, 냉장고 문 열림 알리고 닫게 하기.
- ThinQ 사용설명서를 읽어 가전 쓰는 법을 쉽게 풀기.
- 노인용 천천히 읽기(소리 속도), 한 번 더 읽기. 글 키우기는 CLAUDE.md 글 크기 규칙을 바꿔야 한다.
- 기다리기 동안 같은 장면이면 VLM을 쉬어 비용 줄이기.
- 반성 결과를 하루하루 비교해 보이는 화면.

## 새로 정해야 할 것 (사용자)

1. **비용 한도.** 이어 반성 일곱 번과 기다리기 동안 붙잡은 장면 때문에 한 바퀴가 약 $0.45 → $0.50~0.95로 늘었다. 한도를 $1.20 → $2.20으로 올릴지(추천: 올린다. 안 올리면 라면 장면 실제 판정을 한 판만 하고 이어 반성은 한 번만 돌린다).

## Self-Review

- 시나리오 1(상황·의도): 시연 순서 1~3, Task 3·8·9·13.
- 시나리오 2(일주일 뒤 습관, 눈치): Task 4~8·13, 「일주일을 시연 안에서 보이는 길」. 반성 규칙(그날 고정·다음 날 적용)은 바꾸지 않는다. 7일 근거는 날마다 이어 반성으로 넘기고, 고정 상태를 API로 확인한다(Task 6·8).
- p값 후보정 자리: 「습관 거르기 자리」, Task 5.
- 시나리오 3(노인): Task 10·11·12, 시연 순서 6. 단계 글은 `phoneLineProblem` 허용 낱말, hand_device 끝 조건은 `became`.
- 시나리오 4(탈시설 장애인): 코치 계획 그대로 + 수업 기록 씨앗(Task 8) + 말 넣기(Task 9) + 붙잡기·`--tail`(Task 9·10).
- 자동 판단: 설계 표, Task 1·2. 습관이 코치로 가는 길 셋을 막음: Task 2, Task 4(5번 바꾸기), Task 5(`coachGuard` 앞뒤 두 번), Task 13 시험 4.
- 규칙 코드로 행동 안 정함: 칩·검사만, 판단은 PAM. `demoPredict`·`demoReflect`는 `tests/helpers/` 대역.
- PAM 계약 그대로: 「PAM 계약」 절, Task 13 시험 7.
- Codex 지적 9개: 1 Task 4 바꾸기 2·4, 2 「일주일을 시연 안에서 보이는 길」·Task 7·8, 3 Task 5 범위, 4 Task 2 행동 단위, 5 Task 6 API·Task 8 확인, 6 Task 8 `start`·Task 9 `--start-at`, 7 Task 11 `unbaked`, 8 Task 10 차례 쓰기, 9 Task 10 붙잡기·Task 9 `--tail`.
- 위험: 실제 PAM 반성이 바꾼 지시문을 따라 에어컨 습관을 낼지, 16k 토큰 상한 안에 들지 모른다(Task 14 Step 3, 안 되면 대본).
- 위험: 이어 반성은 하루만 보고 규칙을 더하는 논문 성질 그대로라 1일차에 바로 생길 수 있다. 「일주일 반복」을 따지는 것은 박석준 거르기가 붙은 뒤다. 영상에서는 날마다 판본 변화를 그대로 보인다.
- 위험: 1일차 대조 판에서 PAM이 말 없는 TV 장면에도 에어컨을 켤 수 있다. Task 14에서 대조 판을 꼭 돌린다.
- 위험: 실제 에이전트가 「아 덥다」를 가전 요청으로 보고 바로 켤 수 있다(Task 3 지시문 줄은 강제하지 못한다).
- 위험: 영상 모드는 실제 시각을 쓴다. 배운 규칙에 「저녁」이 붙으면 낮에 찍은 장면 5에서 안 나올 수 있다. 그러면 19~22시에 찍는다.
- 위험: VLM이 전자레인지 문 열림·쓰는 중을 실제 영상에서 얼마나 맞히는지, 영상 모드 자세로 트윈 전자레인지와 맞춰지는지(`SIGHT_MATCH`) 재지 않았다. 못 맞히면 그 단계는 「완료」로 넘어가고, 시작·꺼내기 단계는 시간 초과가 날 수 있다.
- 위험: 계획 모델이 전자레인지 do를 대본과 다른 수·순서로 내면 단계 영상 차례가 어긋난다(그 판은 다시 돌린다).
