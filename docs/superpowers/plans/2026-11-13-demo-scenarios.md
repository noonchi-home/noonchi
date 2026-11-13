# 시연 시나리오 넷과 눈치·코치 자동 판단 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발표 영상 하나로 네 장면을 잇는다. 눈치 모드 ① 첫날: 상황 파악(빈 컵 치우기·남은 컵 그대로 두기)과 의도 파악(「아 덥다」 → 에어컨 켜기), ② 일주일 뒤: 일주일 기록을 반성해 배운 습관으로 말하기 전에 에어컨 켜기. 코치 모드 ③ 노인 전자레인지 쓰는 법 가이드, ④ 탈시설 장애인 라면 끓이기 가이드. 돕는 방식은 「자동」으로 두고, 판단마다 눈치인지 코치인지가 생각 말풍선 칩에 보인다.

**Architecture:** 구조는 그대로다. 「자동」이면 PAM에 눈치·코치 행동을 모두 보내고 FSM 기억이 고른다. 화면의 「눈치·코치」 칩은 고른 행동의 종류(`TaskSpec.coach`)를 그대로 보일 뿐 판단하지 않는다. 일주일은 합성 기록(`scripts/seed-history.ts`)으로 만들고, 마지막 날 반성은 시연 중에 실제 PAM으로 한 번 돌려(`POST /api/reflection/run`) 새 기억이 그날부터 쓰이게 한다. 반성 뒤에는 거르기 자리 둘을 둔다: 코치 행동을 습관 규칙으로 배우지 않게 막는 검사(이 계획), 박석준의 p값 습관 후보정(자리만).

**Tech Stack:** Node 22 TypeScript 서버, SQLite 기록 DB, PAM 서비스(Python FastAPI, `services/pam/`), zod, Vitest, React(`ui/`), 가짜 OpenAI 호환 서버·시험용 PAM 자리, 영상 판정(`scripts/video-check.ts`).

**Spec:** 허정오 시연 시나리오(2026-11-13): 「[눈치 모드] 1. 첫 일주일: 상황 파악 후 작업 처리, 의도 파악 후 작업 처리 2. 일주일 후: 사용자의 습관과 학습한 선제적 행동 [코치모드] 3. 탈시설 장애인을 위한 가이드 모드 4. 가정 내 노인분들 위한 뭔가?」, 「눈치모드로 동작할지 코치모드로 동작할지 알아서 판단하는 것도 의미가 있을듯」, 「일주일 뒤에도 습관 기반 행동하는 것도 눈치 모드야」, 「3번 4번 순서를 바꿔줘」(코치 모드는 3. 노인, 4. 탈시설 장애인 순서). 회의록 2026-11-12(눈치코치, PAM 매일 반성 후 다음 날 적용, p값 후보정, 기본 동작, ThinQ 사용설명서), 2026-11-09(가이드 모드). 구현 뒤 `docs` 저장소 `01_Product/구현명세서 SSOT.md`(돕는 방식·반성·시연)와 `변경이력.md`를 고친다.

**먼저 된 것:** 같은 브랜치의 `2026-11-13-cup-branches.md` Task 1~10, `2026-11-13-coach-mode.md` Task 1~13과 Codex 고침(`c224568`·`fec2e7d`·`cc3cc17`·`f267e6c`). 코치 계획 Task 14 Step 1(영상 판정에 말 넣기 `--say`)은 아직 없어 이 계획 Task 9로 옮겼다.

## 조사한 사실 (2026-11-13, `feat/coach-cup` f267e6c)

**돕는 방식**
- `AssistMode = "noonchi" | "coach"`, 설정 3단계 「돕는 방식」에서 고른다(`ui/src/setup/ModeStep.tsx`). PAM에 보내는 목록은 `tasksFor(assist)`: noonchi는 코치 아닌 행동 일곱, coach는 「라면 끓이기 알려 주기」와 「사용자에게 물어보기」(`src/act/tasks.ts`).
- 판단 기록에는 그때 보낸 목록(`d.tasks`)이 남고, 계획 전·실행 전 검사가 그 목록을 쓴다(`src/server/home.ts`). 코치 계획이 열려 있으면 PAM을 쉰다(`tracker.coaching()`).

**반성과 기억 판본**
- 반성은 `REFLECT_AT`(기본 23:30) 또는 `POST /api/reflection/run {day}`로 돈다. 그날 기록 요약 + 그날 기억 + 피드백 → `pam-reflect/2` → 새 판본, **다음 날부터** 쓴다. 다음 날이 이미 판본을 고정했으면 그다음 날로 밀린다(`src/history/reflect.ts`).
- 그날 기억은 판단 호출이 처음 부를 때 고정된다(`memoryForDay` → `pinMemory`). 판단 호출은 폰 사진이 올 때만 돈다(`Trigger` liveMs). 그래서 **폰을 켜기 전에 어제 기록을 반성하면 새 판본이 바로 오늘 판단에 쓰인다.** 시연 안에서 반성을 돌릴 수 있고, 반성 규칙(그날 고정·다음 날 적용)은 바꾸지 않아도 된다.
- `scripts/seed-history.ts`는 PAM·OpenAI 없이 7일치 합성 기록을 넣는다. 기억 판본은 대본(`memoryAfter`)이 만든 것이고 `source: "synthetic"`이다. **지금 `memoryAfter`는 옛 컵 FSM(치우기·묻기·밤) 기준이라 컵 갈래(그대로 두기·채워 주기)와 요리 상태가 빠져 있다.** 이대로 넣으면 그 갈래가 사라진다.
- 합성 일주일에는 저녁마다 사람이 TV를 보며 거실 에어컨을 스스로 켜는 기록이 이미 있다(`tv()`). 기억에는 에어컨 규칙이 없다.
- **논문 반성 지시문은 행동을 `Pick up <object> and place it <location>.` 영어 형식으로만 쓰게 한다**(`services/pam/prompts/paper/reflector_fsm_update.txt` 82~85줄), 목표도 집기·놓기뿐이다. `scenario.json`은 이 줄을 바꾸지 않는다. 지금대로 실제 반성을 돌리면 컵 규칙 행동이 영어 집기·놓기 문장으로 바뀌고, 에어컨 같은 가전 습관은 배우지 못한다. `pam-reflect/2` 요청에는 행동 목록 칸이 없다.
- 대시보드에는 반성 결과를 보이는 자리가 없다. 반성 사건(`type: "reflection"`)은 `start.ts`가 바로 방송하고, 새로 붙은 대시보드에는 다시 보내지 않는다(`brainLast`는 마지막 판단만).
- 생각 말풍선 칩은 「상태 · FSM 상태 이름표」와 「판단 · 행동」이다. 이름표는 `FSM_STATE_TEXT`(drinking·watching_tv·left_cup·cooking)에만 있어, 반성·합성 기억의 새 상태(evening_tv 등)는 상태 칩이 숨는다.

**의도·노인·트윈**
- 들은 말은 관찰 텍스트에 `사람이 말함: 「…」` 줄로 들어간다(눈치 모드 포함). 말 요청 에이전트는 요청 아닌 말에 `leave_it`만 부르게 돼 있다. 「아 덥다」를 에이전트가 가전 요청으로 보고 바로 켤지는 모델에 달렸다.
- 「에어컨 켜기」는 이미 행동 목록에 있다(가전 단계 `turn_on`, 처음이면 승인을 묻는다).
- 한양목련 트윈에는 **전자레인지가 없다.** 카탈로그(`twin/data/catalog/microwave.json`, 속성 power)와 모델(`twin/library/assets/appliances/microwave.glb`)은 있다. 기기는 `scene.json`에서만 만든다(`loadTwin`). 배치 보정 `edits.json`으로 더한 물건은 평면도에는 보이지만 기기가 되지 않는다.
- 전자레인지는 YOLO(COCO microwave)가 보고, VLM 사실 열림·닫힘(`open`·`closed`)과 쓰는 중(`in_use`)이 붙는다. 카메라로 맞추는 트윈 상태는 쓰는 중 → 켜짐이다(`SIGHT.microwave`). 위험 목록에 「전자레인지 시작」이 있고, 손으로 켜는 do 단계 검사(`riskyHand`)가 `start` 규칙도 위험으로 본다.
- 실제 폰 소리 속도는 1.05로 정해져 있다(`ui/src/phone/core/talk.js`). 화면 글은 21st.dev 부품 원래 크기만 쓴다(CLAUDE.md). 노인용으로 글을 키우는 것은 규칙을 바꿔야 한다.
- 영상 판정에 말을 넣는 `--say`는 아직 없다.

## 네 시나리오 정의

| # | 모드 | 장면 | 보이는 판단 | 지금 되는가 · 모자란 것 |
|---|---|---|---|---|
| 1-상황 | 눈치 | 사람이 빈 컵을 두고 떠남 | 컵 치우기(네 단계) | 됨(seed FSM `left_cup`). 영상만 |
| 1-상황 | 눈치 | 음료가 남은 컵을 두고 떠남 | 컵 그대로 두기 | 됨. 영상만 |
| 1-의도 | 눈치 | 소파에서 TV 보다 「아 덥다」 | 에어컨 켜기 | seed FSM에 규칙 없음(Task 3), 영상에 말 넣기 없음(Task 9) |
| 2-습관 | 눈치 | 일주일 뒤, 말없이 소파에 앉아 TV를 켬 | 에어컨 켜기(배운 습관) | 반성 지시문이 가전 습관을 못 배움(Task 4), 합성 일주일이 옛 FSM(Task 7), 배운 것을 보일 자리 없음(Task 2·6) |
| 3-노인 | 코치 | 전자레인지 앞에서 「이거 어떻게 하지」 | 전자레인지로 데우기 알려 주기 | 트윈에 전자레인지 없음(Task 10), 행동·FSM 없음(Task 11) |
| 4-장애인 | 코치 | 「라면 끓이는 법 알려 줘」 | 라면 끓이기 알려 주기 | 됨(가짜 서버 흐름 시험까지). 실제 판정 안 함, 영상, 말 줄이기를 보이려면 수업 기록 씨앗(Task 8) |

**습관은 눈치다.** 일주일 뒤 습관으로 미리 하는 행동은 눈치 행동(에어컨 켜기)이다. 코치 행동은 사람이 묻거나 막혔을 때만 고르게 하고, 반성이 코치 행동을 습관 규칙으로 배우면 반성 뒤 검사가 그 규칙을 뺀다(Task 4·5).

## 노인 후보

| 후보 | 모드 | 비전·가전으로 확인 | 노인에게 맞는 점 | 크기 |
|---|---|---|---|---|
| **전자레인지로 데우기 알려 주기(추천)** | 코치 | 문 열림·닫힘, 돌아감(VLM), 시작은 위험 목록이라 묻기 | 가전 사용법, 회의의 「사용설명서를 쉽게 풀기」로 이어짐 | 트윈 기기 하나 + 행동 하나 |
| 약 먹을 때 챙기기 | 눈치 | 「약 먹는 중」(VLM)만. 약통은 COCO에 없음 | 건강, 잊음 | 시간 조건 규칙, 안 먹었음을 보는 근거가 약함 |
| 냉장고 문 열림 알리고 닫게 하기 | 눈치 | 문 열림(트윈 센서·VLM), 1분 넘게 열림 사건 있음 | 잊음, 회의의 기본 동작 | 가장 작음. 코치 장면은 아님 |

추천 까닭: 시나리오 3은 코치 쪽이고, 라면보다 비전으로 확인되는 단계가 많다(문 열기·닫기·돌아감). 라면과 같은 코치 뼈대를 그대로 쓴다.

## 자동 판단 설계

| 안 | 어떻게 | 좋은 점 | 걸리는 점 |
|---|---|---|---|
| **가: 두 모드 행동을 모두 PAM에 보내고 FSM이 고름(추천)** | `assist: "auto"`면 행동 전부. FSM `cooking` 상태 규칙(「알려 달라고 말함」, 「뭐 해야 할지 모르겠다고 말함」)이 코치 행동을, 나머지 상태 규칙이 눈치 행동을 고른다. 칩은 고른 행동의 `coach` 표시로 「눈치」·「코치」 | 「기존 FSM 그대로」, PAM 계약 그대로, 판단 길 하나, 생각 말풍선에 까닭이 그대로 보임 | 사람이 누구인지는 FSM 글에만 있다 |
| 나: 사람 프로필(일반·발달장애·노인)을 설정에 두고 그 안에서 PAM이 고름 | 프로필마다 seed FSM, 관찰 텍스트에 `[사람]` 한 줄 | 같은 장면에서 사람마다 다른 모드 | seed FSM 셋, 시연 시간 늘어남 |
| 다: 에이전트가 「도울지 가르칠지」를 따로 판단 | PAM이 고른 뒤 LLM 한 번 더 | 모드 판단이 따로 보임 | PAM 일과 겹침, 판단마다 비용·지연 |

가를 고르고 나는 「그 뒤」로 둔다. 습관이 코치로 가는 길은 셋으로 막는다: (1) 칩은 행동 종류로만 정해진다, (2) 반성 지시문에 「코치 행동은 요청·막힘에만, 습관·시간 규칙으로 만들지 않는다」 한 줄(Task 4), (3) 반성 뒤 검사가 새로 생긴 코치 행동 규칙을 뺀다(Task 5). 설정은 「자동 / 눈치 / 코치」 셋으로 남긴다.

## 일주일을 시연 안에서 보이는 길

1. 시연용 집 폴더 `runtime/demo/week`에 `npx tsx scripts/demo-setup.ts week --end <어제>`: 합성 7일(지금 FSM 기준, 에어컨 규칙 없음, 저녁·주말 오후마다 사람이 TV를 보며 에어컨을 켬)과 승인을 넣는다.
2. 그 폴더로 서버를 띄우고 대시보드만 연다(폰은 아직 안 켬 → 오늘 기억이 고정되지 않음).
3. `npx tsx scripts/demo-setup.ts reflect`: 어제 반성을 실제 PAM으로 돌린다. 반성 뒤 검사(코치 규칙 빼기 → 습관 거르기 자리)를 거쳐 새 판본이 오늘부터 쓰인다. 대시보드 생각 말풍선에 배운 규칙이 뜬다(「습관 · 새로 배움」, 「눈치 · 에어컨 켜기」).
4. 폰 영상 `tv-sit.mp4`를 튼다 → PAM이 말없이 에어컨 켜기를 고르고, 칩은 「습관 · …」, 「눈치 · 에어컨 켜기」.
5. 실제 반성이 에어컨 규칙을 만들지 못하면 `reflect --scripted`가 대본 판본(`source: "synthetic"`)으로 같은 화면을 만든다. 그 판은 기록에 합성 표시가 남는다.

## 습관 거르기 자리(박석준, 구현은 하지 않음)

반성이 낸 기억을 저장하기 전에 `HabitFilter` 하나를 부른다. 이 계획은 모든 규칙을 그대로 두는 기본값(`keepAll`)만 둔다.

```ts
// src/history/habits.ts
/** 거르기 입력: 반성한 날, 그날 쓴 기억, 반성이 낸 기억, 지난 windowDays일 기록(world·device·decision·execution·feedback, 시각 순), 기록 시간대(분). */
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
- 박석준 기준(4번 이상·80% 이상·p값)은 이 함수 하나를 바꿔 끼운다. Python으로 짜면 PAM 서비스에 새 주소 `POST /habits`(새 계약 `pam-habits/1`, 본문은 위 `HabitInput`과 같은 JSON, 답은 `HabitOutput`)를 더하고 TS 쪽은 그 주소를 부르는 `HabitFilter`를 둔다. `pam-predict/2`·`pam-reflect/2`는 바꾸지 않는다.
- 코치 규칙 빼기(Task 5 `coachGuard`)는 거르기 앞에 늘 돈다.

## PAM 계약

`pam-predict/2`·`pam-reflect/2`는 바꾸지 않는다. 바뀌는 것은 (1) `services/pam/scenarios/noonchi/tasks.json`(행동 하나 더함), (2) `scenario.json` 지시문 바꾸기(목표 줄, 반성 행동 형식 줄, 코치 행동 줄). 습관 거르기를 Python으로 하면 그때 새 계약 `pam-habits/1`을 더한다(이 계획 밖).

## Global Constraints

- 브랜치 `feat/coach-cup`(worktree `C:\Users\ABC\Desktop\소웨공\twin-home-coach`). 다른 worktree는 건드리지 않는다. 구현 전에 `npm ci`.
- 저장소 `CLAUDE.md` 규칙 표 전부. 특히:
  - 규칙 코드로 계획·행동을 정하지 않는다. 판단은 PAM, 단계는 에이전트 계획 모드다. 「눈치·코치」 칩·「습관」 칩은 고른 행동과 기억을 그대로 보이는 표시다. 코치 규칙 빼기는 기억 모양 검사다(행동을 고르지 않는다).
  - mock과 live는 같은 구조. 가짜 PAM·가짜 모델·대본 감지기는 `tests/helpers/`에만. 합성 기록 대본은 `scripts/`(지금 `seed-history.ts`와 같은 자리)에만 두고 `src/`에 넣지 않는다.
  - PAM에 사진을 넘기지 않는다.
  - 대시보드에 입력창·단추를 더하지 않는다. 반성은 명령줄(`scripts/demo-setup.ts`)이 API로 부른다.
  - 새 화면 칸을 만들지 않는다(생각 말풍선을 그대로 쓴다). 새 칸이 필요해지면 구조만 그린 HTML 스케치를 먼저 보여 주고 확인을 받는다. 부품은 21st.dev 부품, 색은 토큰, 글은 상태만(60자 아래, 화살표·괄호 없음), 글 크기는 부품 원래 크기.
  - 승인 규칙 그대로. 위험 목록(인덕션 켜기·전자레인지 시작)은 늘 묻는다.
- 시험·빌드·크롬은 `npm run heavy -- <cmd>`로만, 한 번에 하나. 크롬·dev3d는 PC에 하나만.
- 이 PC 메모리는 13.8GB다. 녹화(`--record`)할 때는 `BRAIN_YOLO_PROVIDER=cpu`로 띄우고, PAM 서비스·서버·크롬 하나 밖의 무거운 프로그램은 끈다.
- 실제 모델 비용(추정): 컵·TV 장면 한 판 약 $0.03~0.05, 반성 한 번 약 $0.01~0.05(첫 판에 OpenRouter 사용 기록으로 잰다), 라면 한 판 약 $0.08~0.12, 전자레인지 한 판 약 $0.06~0.10. 한 바퀴(장면 일곱 + 대조 한 판 + 반성) 약 $0.45. 이 계획 한도 $1.20(두 바퀴 + 다시 돌리기). 넘기 전에 멈추고 보고한다.
- 시연 집 폴더는 `runtime/demo/day1`·`runtime/demo/week`다(`runtime/`은 이미 `.gitignore`에 있다). 그 안의 기록 DB·`approvals.json`·`lessons.json`과 영상(`runtime/videos/`)은 커밋하지 않는다.
- 커밋 메시지는 영어, attribution 줄 없음. `.gitignore`·`.ignore`·`ui/public/fonts/OFL-noto-sans-kr.txt`·`.trail/`은 커밋하지 않는다. 푸시는 사용자가 말할 때만.

## File Structure

| 파일 | 일 |
|---|---|
| `src/contract/setup.ts`, `src/setup/store.ts`, `src/server/start.ts`, `src/act/tasks.ts`, `ui/src/setup/ModeStep.tsx` | 돕는 방식 「자동」 |
| `src/brain/decision.ts`(`FsmRuleAt`, `CUP_FSM_MEMORY`), `src/world/decide.ts`, `src/contract/events.ts`, `ui/src/dashboard/{data.ts,ThoughtCard.tsx,words.ts}` | 칩: 눈치·코치, 습관, 상태 이름표 없을 때 |
| `src/agent/prompts.ts` | 바라는 것을 돌려 말한 혼잣말은 `leave_it` |
| `services/pam/scenarios/noonchi/scenario.json`, `tasks.json` | 반성 지시문 바꾸기, 행동 목록 |
| `src/history/habits.ts`(새로), `src/history/reflect.ts`, `src/history/labels.ts` | 코치 규칙 빼기, 거르기 자리, 배운 규칙 |
| `src/server/home.ts`, `src/server/start.ts` | 마지막 반성 다시 보내기 |
| `scripts/seed-history.ts`, `scripts/demo-setup.ts`(새로) | 합성 일주일, 시연 준비 |
| `scripts/video-check.ts` | `--say` |
| `twin/data/homes/mokryeon_180b/added_devices.json`(새로), `src/model/scene.ts`, `src/model/devices.ts` | 트윈에 전자레인지 |
| `src/act/tasks.ts`, `tests/helpers/planner.ts` | 「전자레인지로 데우기 알려 주기」 |
| `tests/demo-e2e.test.ts`(새로) | 네 장면 가짜 서버 흐름 |

---

### Task 1: 돕는 방식 「자동」

**Files:**
- Modify: `src/contract/setup.ts`(`AssistMode`), `src/setup/store.ts`(`assist`, 읽기), `src/server/start.ts`·`src/server/shell.ts`(`/api/setup/assist` 값 검사), `src/act/tasks.ts`(`tasksFor`), `ui/src/setup/ModeStep.tsx`(`ASSISTS`)
- Test: `tests/setup-store.test.ts`, `tests/setup-server.test.ts`, `tests/act-tasks.test.ts`, `ui/tests/mode-step.test.tsx`

**Interfaces:**
- Produces:

```ts
/** 돕는 방식. auto: 상황마다 PAM이 눈치·코치 행동 가운데 고른다. noonchi: 눈치 행동만. coach: 코치 행동과 묻기만. */
export type AssistMode = "auto" | "noonchi" | "coach";
// setup.json assist: 없으면(옛 파일) "noonchi", 새로 만드는 파일은 "auto". 틀린 값은 "noonchi".
// tasksFor("auto") = [...TASK_NAMES] (순서 그대로라 task_index가 같다)
// ModeStep ASSISTS: { id: "auto", name: "자동", line: "상황마다 알아서 골라요" } 를 맨 앞에. 눈치·코치 줄은 그대로.
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

**Interfaces:**
- Produces:

```ts
/** learned: 그 규칙(트리거·행동 쌍)이 seed 기억(CUP_FSM_MEMORY)에 없다(반성·합성 기억이 만들거나 고친 규칙). */
export interface FsmRuleAt { state: string; trigger: string; learned: boolean }
// decision 사건: fsm: FsmRuleAt | null, assist: "noonchi" | "coach" | null (고른 행동의 TaskSpec.coach, 대기·실패는 null)
// ui
export interface Thought { reasoning: string; state: string | null; habit: boolean; assist: "noonchi" | "coach"; action: string }
// state: FSM_STATE_TEXT[state] ?? 트리거 글(이름표 없는 새 상태). fsm이 없으면 null.
// WORDS: noonchi "눈치", coach "코치", habit "습관", state "상태"(그대로). judge "판단"은 지운다.
// 칩: 앞 칩 `${habit ? WORDS.habit : WORDS.state} · ${state}`, 뒤 칩 `${WORDS[assist]} · ${action}`. 칩 두 개와 줄 높이는 그대로다.
```

- [ ] **Step 1: 실패하는 시험.** 「seed 규칙으로 고른 컵 치우기는 `learned: false`」, 「seed에 없는 트리거의 에어컨 규칙은 `learned: true`」, 「라면 끓이기 알려 주기 판단 사건은 `assist: "coach"`, 에어컨 켜기는 `"noonchi"`」, 「이름표 없는 상태(evening_tv)는 상태 칩에 트리거 글」, 「칩 글이 `습관 · …`·`눈치 · 에어컨 켜기`·`코치 · 라면 끓이기 알려 주기`」, 「칩 칸 class·높이가 지금과 같다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/brain-decision.test.ts tests/world-decide.test.ts`, ui 시험 → 실패 확인.
- [ ] **Step 3:** 구현. `assist`는 `taskOf(action)?.coach ? "coach" : "noonchi"`(서버, 표시용). 화면 글 검사(`npm run lint`)를 지난다.
- [ ] **Step 4:** 통과 확인, `npm run lint`, `ui/tests/dashboard/steps.test.tsx`.
- [ ] **Step 5:** 커밋 `feat(dashboard): label each decision as noonchi or coach and mark learned rules as habits`.

### Task 3: 의도 파악 seed 규칙과 에이전트가 끼어들지 않기

**Files:**
- Modify: `src/brain/decision.ts`(`CUP_FSM_MEMORY` `watching_tv` 규칙 하나), `src/agent/prompts.ts`(규칙 줄 하나)
- Test: `tests/brain-decision.test.ts`, `tests/agent.test.ts`

**Interfaces:**
- `watching_tv.rules`에 더함: `{ trigger: "사용자가 덥다고 말하거나 더워서 부채질을 한다.", action: "에어컨 켜기" }`.
- 에이전트 시스템 프롬프트에 더함: `- 「아 덥다」처럼 바라는 것을 직접 시키지 않은 혼잣말은 가전 요청이 아니다. leave_it만 부른다. 「에어컨 켜 줘」처럼 시킨 말만 가전 도구를 부른다.`

- [ ] **Step 1: 실패하는 시험.** 「`fsmRuleOf(CUP_FSM_MEMORY, "fsm", "에어컨 켜기")`가 `watching_tv`」, 「기억이 계약 검사를 통과하고 규칙 행동이 모두 `TASK_NAMES` 안」, 「시스템 프롬프트에 그 줄이 있다」, 「가짜 모델이 `아 덥다`에 `leave_it`만 부르면 폰 답은 빈 글이고 관찰 텍스트에 그 말 줄이 들어간다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/brain-decision.test.ts tests/agent.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현(컵 갈래 계획 Task 6의 seed 판본 올리기가 새 seed를 넣는다).
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(brain): add a spoken heat rule to the seed FSM and keep the agent out of indirect wishes`.

### Task 4: 반성 지시문을 우리 행동에 맞추기

**Files:**
- Modify: `services/pam/scenarios/noonchi/scenario.json`(`prompt_replacements` 셋)
- Test: `services/pam/tests/test_prompts.py`, `tests/pam-scenario.test.ts`(새로)

**Interfaces:**
- 바꾸는 셋(논문 파일은 그대로, 바꾼 기록이 `adaptation`에 남는다):
  1. 목표 줄 `- etc. –- any helpful pick-and-place action that is grounded in observed behavior.` → `- operating home appliances the person habitually operates by hand, such as turning on the living-room air conditioner when they sit down to watch TV.\n- etc. –- any helpful action that is grounded in observed behavior.`(판단·반성 두 지시문에 다 있다)
  2. 반성 행동 형식 줄 `- action: a NATURAL LANGUAGE description of how the robot should help, written in\nthe canonical form ``Pick up <object> and place it <location>.`` Valid ``<location>``\nvalues are exactly one of: ``next to the person``, ``in the designated storage area``, ``\nin the trash can``.` → `- action: exactly one of these task names, copied character for character: 컵 치우기, 사용자에게 물어보기, 세탁물 건조기로 옮기기, 에어컨 켜기, 컵 그대로 두기, 컵에 물 채워 주기, 컵에 콜라 따라 주기, 라면 끓이기 알려 주기. Write state descriptions and triggers in Korean.\n- Coaching tasks (라면 끓이기 알려 주기) fire only when the person asks how to do it or says they are stuck. Never add habit-based or time-based rules for them.` (Task 11이 두 목록에 「전자레인지로 데우기 알려 주기」를 더한다)
  3. 반성 지시문의 `Each rule's action MUST literally mirror an action the human performed in this\nvideo and summary.`(입력 이름 바꾸기 뒤 글) → `Each rule's action MUST be a task name whose effect mirrors an action the human performed in these\nobservations and summary.`
- 실제 바꿀 글은 Step 1에서 지시문 파일과 지금 바꾸기 적용 뒤 글을 읽어 글자 그대로 맞춘다(줄바꿈·백틱 포함).

- [ ] **Step 1: 실패하는 시험.**
  - Python: 「반성 메시지 시스템 글에 `Pick up <object>`가 없고 행동 이름 줄이 있다」, 「판단 메시지에 가전 목표 줄이 있다」, 「바꾸기 셋이 반성 지시문에서 한 번씩 맞는다(`adaptation.applied_changes`)」.
  - TS(`tests/pam-scenario.test.ts`): 「`scenario.json` 행동 이름 줄이 `TASK_NAMES` 전부를 그 순서로 담는다」, 「코치 행동 줄이 `coach: true`인 행동 전부를 담는다」(행동을 더하고 지시문을 안 고치면 실패한다).
- [ ] **Step 2:** `services/pam`에서 `python -m pytest tests/test_prompts.py`, `npm run heavy -- npx vitest run tests/pam-scenario.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 두 시험 통과 확인.
- [ ] **Step 5:** 커밋 `feat(pam): let reflection write our task names and appliance habits`.

### Task 5: 반성 뒤 검사 — 코치 규칙 빼기와 습관 거르기 자리

**Files:**
- Create: `src/history/habits.ts`, `tests/history-habits.test.ts`
- Modify: `src/history/reflect.ts`(`runReflection`, `ReflectResult`), `src/history/labels.ts`(`REFLECT_TEXT.learned`·`dropped`), `src/contract/events.ts`(reflection 사건)
- Test: `tests/history-habits.test.ts`, `tests/history-reflect.test.ts`

**Interfaces:**
- Produces(위 「습관 거르기 자리」의 타입 + 아래):

```ts
/** proposed에만 있는 규칙(상태·트리거·행동). */
export function learnedRules(previous: FsmMemory, proposed: FsmMemory): { state: string; trigger: string; action: string }[];
/** 새로 생긴 규칙 가운데 행동이 코치 행동(TaskSpec.coach)이면 뺀다. 빠진 것은 reason "coach". previous에 있던 코치 규칙은 그대로 둔다. */
export function coachGuard(previous: FsmMemory, proposed: FsmMemory): HabitOutput;
export const keepAll: HabitFilter;
// runReflection(db, pam, day, { now?, emit?, filter?: HabitFilter, windowDays?: number /* 기본 30 */ })
// 순서: pam.reflect → validateMemory → coachGuard → filter(기본 keepAll) → validateMemory → saveMemory
// ReflectResult ok에 learned: { state; trigger; action }[], dropped: HabitRuleNote[] 를 더한다.
// reflection 사건·기록 줄 data에 learned·dropped(트리거·행동 글) 를 더한다. 글: REFLECT_TEXT.learned(n) = `새 규칙 ${n}개를 배웠어요`
```
- list 기억(`memory_kind: "list"`)은 검사 없이 지금처럼 저장한다(시연은 fsm).

- [ ] **Step 1: 실패하는 시험.**
  - 「가짜 PAM 반성이 에어컨 습관 규칙과 `라면 끓이기 알려 주기` 습관 규칙(저녁 19시마다)을 더하면 저장된 판본에 에어컨 규칙만 있고 `dropped`에 코치 규칙이 reason coach로 있다」.
  - 「seed의 `cooking` 코치 규칙은 반성 뒤에도 남는다」.
  - 「`filter`로 넘긴 함수가 받은 `rows`가 지난 30일 world·device·decision·execution·feedback 줄이고, 그 함수가 뺀 규칙은 저장되지 않는다」.
  - 「거르기 결과가 기억 모양 검사에 걸리면 반성은 실패로 남고 판본은 늘지 않는다」.
  - 「reflection 사건에 `learned`가 있다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/history-habits.test.ts tests/history-reflect.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(history): drop learned coach rules and add a habit filter slot after reflection`.

### Task 6: 배운 규칙을 대시보드에 보이기

**Files:**
- Modify: `src/server/start.ts`(반성 사건을 집 묶음에도 넘김), `src/server/home.ts`(`brainLast`에 오늘 마지막 반성), `ui/src/dashboard/data.ts`(`thoughtOf`), `ui/src/dashboard/use-dash.ts`
- Test: `tests/server-events-backlog.test.ts`, `ui/tests/dashboard/data.test.ts`

**Interfaces:**
- 새로 붙은 대시보드는 마지막 판단과 함께 오늘(기록 시간대) 마지막 반성 사건을 `replay: true`로 받는다(기록 DB `reflection` 줄에서 읽는다. 합성 판본도 같다).
- `thoughtOf`: 반성 사건이 마지막 유효 판단보다 새롭고 `learned`가 있으면 첫 배운 규칙을 생각 말풍선에 보인다: `reasoning` = 트리거 글, 앞 칩 `습관 · 새로 배움`(`WORDS.learnedNow = "새로 배움"`), 뒤 칩 `눈치 · 행동` 또는 `코치 · 행동`. 다음 유효 판단이 오면 그 판단으로 바뀐다.
- 말풍선 카드: 반성 사건 뒤 20초 동안 `SAY_TEXT.learned = (n) => `어제 기록으로 새 습관 ${n}개를 배웠어요.``(`src/act/say.ts`, `sayLine`의 `reflected?: { atMs: number; n: number }`).

- [ ] **Step 1: 실패하는 시험.** 「반성 뒤 붙은 대시보드가 반성 사건을 다시 받는다」, 「배운 규칙이 생각 말풍선에 뜨고 칩이 `습관 · 새로 배움`, `눈치 · 에어컨 켜기`다」, 「다음 판단이 오면 그 판단으로 바뀐다」, 「`learned`가 비면 말풍선을 바꾸지 않는다」, 말풍선 카드 글.
- [ ] **Step 2:** 시험 실행 → 실패 확인.
- [ ] **Step 3:** 구현(새 칸 없음, 칸 크기 그대로).
- [ ] **Step 4:** 통과 확인, `npm run lint`.
- [ ] **Step 5:** 커밋 `feat(dashboard): show what reflection learned in the thought bubble`.

### Task 7: 합성 일주일을 지금 FSM에 맞추기

**Files:**
- Modify: `scripts/seed-history.ts`(`memoryAfter`, `tv`, `liveDay`, `SeedOptions`)
- Test: `tests/seed-history.test.ts`

**Interfaces:**
- `memoryAfter(i, h)`: `CUP_FSM_MEMORY`를 바탕으로 하루마다 상태를 더한다(morning_coffee·away·night, 지금처럼). seed의 규칙(컵 갈래·묻기·덥다·요리)은 모두 남긴다. **에어컨 습관 규칙은 넣지 않는다.**
- `tv()`: 사람이 소파에 앉은 뒤 20~60초 안에 스스로 거실 에어컨을 켠다(지금처럼). 1일차 TV 장면은 사람이 「아 덥다」라고 말하고(`heard` 변화 줄) 판단이 에어컨 켜기를 고르는 기록, 2~7일차는 말없이 사람이 켠다. 주말 오후 TV도 같다.
- `SeedOptions.habit?: boolean`: 참이면 마지막 날 반성 판본의 `watching_tv`(없으면 `evening_tv`)에 `{ trigger: "사용자가 소파에 앉아 TV를 보기 시작한다.", action: "에어컨 켜기" }`를 더한다(`reflect --scripted`가 쓴다).
- 넣는 기억 판본은 모두 `validateMemory`를 지나고 규칙 행동이 `TASK_NAMES` 안이다.

- [ ] **Step 1: 실패하는 시험.** 「합성 판본마다 seed 규칙(컵 그대로 두기·채워 주기·덥다·요리)이 남아 있다」, 「`habit` 없이는 어느 판본에도 말없이 에어컨을 켜는 규칙이 없고, `habit: true`면 마지막 판본에만 있다」, 「7일 중 6일 이상 TV 장면 뒤 1분 안에 거실 에어컨 켜짐 기록이 있다」, 「1일차에 `사람이 말함` 줄과 에어컨 켜기 판단이 있다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/seed-history.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(seed): build the synthetic week on the current FSM with a daily TV and air-con habit`.

### Task 8: 시연 준비 명령

**Files:**
- Create: `scripts/demo-setup.ts`, `tests/demo-setup.test.ts`

**Interfaces:**

```
npx tsx scripts/demo-setup.ts day1   [--dir runtime/demo/day1]  : 빈 기록 DB, setup.json { home: mokryeon_180b, done: true, mode: test, assist: auto },
                                                                  approvals.json(컵 치우기·컵에 물 채워 주기·에어컨 켜기·라면 끓이기 알려 주기·전자레인지로 데우기 알려 주기 승인),
                                                                  lessons.json(라면 끓이기 알려 주기 두 판: 이동 넷·냄비 꺼내기 alone 2)
npx tsx scripts/demo-setup.ts week   [--dir runtime/demo/week] [--end YYYY-MM-DD(기본 어제)] : day1과 같은 파일 + 합성 7일(seedHistory, habit 없음)
npx tsx scripts/demo-setup.ts reflect [--api http://127.0.0.1:8200] [--day 어제] : POST /api/reflection/run, 배운 규칙·뺀 규칙을 찍는다
npx tsx scripts/demo-setup.ts reflect --scripted [--dir runtime/demo/week] : PAM 없이 seedHistory(habit: true)로 마지막 판본을 다시 넣는다(서버를 끈 채)
```
- 각 명령은 끝에 다음에 칠 명령(서버 띄우기 `RUNTIME_DIR=… npm start`, 판정 명령)을 찍는다.
- `reflect`는 서버가 오늘 기억을 이미 고정했으면(`GET /api/decisions`에 오늘 판단이 있음) 멈추고 `폰을 켜기 전에 반성하세요`를 찍는다.

- [ ] **Step 1: 실패하는 시험.** 「day1이 네 파일을 쓰고 기록 DB가 비어 있다」, 「week 뒤 내일 판단 판본이 합성 마지막 판본이다」, 「reflect가 가짜 서버(`/api/reflection/run`)를 부르고 결과를 찍는다」, 「오늘 판단이 있으면 reflect가 부르지 않는다」, 「`--scripted`는 서버 없이 마지막 판본에 에어컨 습관이 있다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/demo-setup.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현. 기록 DB·합성 대본은 `scripts/seed-history.ts`의 함수를 쓴다.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(scripts): add demo-setup for day-one, one-week and reflection runs`.

### Task 9: 영상 판정에 말 넣기 (`--say`)

**Files:**
- Modify: `scripts/video-check.ts`(`Args.says`, 인자 읽기, 폰 페이지에서 `say` 보내기, 시각표 `말` 줄)
- Test: `tests/video-check.test.ts`

**Interfaces:**
- `--say <초>:<글>` 여러 번. 그 영상 시각이 되면 폰 페이지 안에서 폰 소켓으로 `{ type: "say", text }`를 보낸다(CDP `Runtime.evaluate`, 실제 폰이 들은 말과 같은 길). 시각표에 `말 · <글>`. `--fake`에서도 같다.
- 틀린 값(초가 숫자가 아님, 글이 빔, 60자 넘음)은 쓰는 법 글.

- [ ] **Step 1: 실패하는 시험.** 「인자 읽기가 `--say 5:아 덥다`를 `{ atMs: 5000, text: "아 덥다" }`로 받는다」, 「틀린 값이면 쓰는 법 글」, 「시각표에 말 줄이 그 시각에 있다」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/video-check.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인. `--fake`로 `cup-empty-leave.mp4`에 말을 넣어 한 번 돌려 본다(비용 0).
- [ ] **Step 5:** 커밋 `feat(video): inject spoken lines at given clip times`.

### Task 10: 한양목련 트윈에 전자레인지

**Files:**
- Create: `twin/data/homes/mokryeon_180b/added_devices.json`
- Modify: `src/model/scene.ts`(`loadScene`), `src/model/devices.ts`(`loadFromScene`), `tests/drawn-fixtures.test.ts`
- Test: `tests/added-devices.test.ts`(새로), `tests/mokryeon-cup.test.ts`

**Interfaces:**
- 파일: `{ "source": "noonchi 시연(2026-11-13)", "items": [{ "id": "microwave_kitchen", "type": "microwave", "label": "주방 전자레인지", "room": "kitchen", "position": [7.66, -0.05], "facing_deg": 90, "elevation": 0.9 }] }`(자리는 조리대 `counter_kitchen_e` 윗면, Step 3에서 그 조리대 자리·높이로 맞춘다).
- `loadScene`은 도면 설비처럼 이 파일 물건을 장면에 더하고(같은 id가 있으면 더하지 않는다), `loadFromScene`은 그 장면으로 기기를 만든다(kind `microwave`, 속성 power).

- [ ] **Step 1: 실패하는 시험.** 「한양목련 기기 목록에 `microwave_kitchen`(전자레인지, 주방)이 있다」, 「평면도·`/api/scene`에 같은 물건이 있다」, 「파일이 없는 집은 그대로다」, 「같은 id가 scene.json에 있으면 하나만」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/added-devices.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현. 3D 대시보드에 모델이 보이는지 `npm run capture`로 한 장 찍어 본다(크롬 하나).
- [ ] **Step 4:** 통과 확인, `tests/drawn-fixtures.test.ts`·`tests/mokryeon-cup.test.ts`도.
- [ ] **Step 5:** 커밋 `feat(twin): add a kitchen microwave to the Mokryeon home from a merged devices file`. CLAUDE.md 규칙 표에 한 줄 더한다: 「시연용으로 더하는 가전은 `twin/data/homes/<집>/added_devices.json`에 두고 장면을 읽을 때 더한다 | `tests/added-devices.test.ts`」.

### Task 11: 코치 행동 「전자레인지로 데우기 알려 주기」

**Files:**
- Modify: `src/act/tasks.ts`, `services/pam/scenarios/noonchi/tasks.json`, `services/pam/scenarios/noonchi/scenario.json`(Task 4 행동 이름 줄·코치 행동 줄에 새 이름), `src/brain/decision.ts`(`cooking` 상태), `src/world/labels.ts`(`FSM_STATE_TEXT.cooking` → `"주방에서 할 일을 찾음"`), `tests/helpers/planner.ts`(`microwaveSteps`, 대본 표)
- Test: `tests/act-tasks.test.ts`, `tests/agent-planner.test.ts`, `tests/brain-decision.test.ts`, `tests/pam-scenario.test.ts`

**Interfaces:**
- Produces:

```ts
"전자레인지로 데우기 알려 주기": {
  name: "전자레인지로 데우기 알려 주기", coach: true, maxSteps: 12,
  description: "사람이 전자레인지 앞에서 쓰는 법을 묻거나 막히면 문 열기부터 꺼내기까지 사람이 할 일을 단계마다 천천히 알려 준다. 클로이드는 가전을 조작하지 않는다.",
  allow: { kinds: ["go", "pick", "place", "do", "wait", "say"], need: ["do"] },
},
// cooking 상태: description "사용자가 주방에서 음식을 만들거나 데우려 한다. 방법을 묻거나 무엇을 할지 몰라 멈춰 있으면 단계마다 알려 준다."
// rules에 더함: { trigger: "사용자가 전자레인지 앞에서 쓰는 법을 묻거나 이거 어떻게 하냐고 말한다.", action: "전자레인지로 데우기 알려 주기" }
// tests/helpers/planner.ts
export function microwaveSteps(ids: { microwave: string; bowl: string | null; waitS?: number }): Record<string, unknown>[];
// 대본 8단계: go 전자레인지 · do 문 열기(until {"fixture": "microwave", "facts": {"open": "open"}}) · place 그릇 넣기(until 없음) ·
// do 문 닫기(until {"fixture": "microwave", "facts": {"open": "closed"}}) · do 시작 단추 누르기(hand_device on, caution "그릇이 뜨거워져요.",
// until {"device": microwave, "state": "on"}) · wait 60초 · do 다 되면 문 열기(hand_device off, until {"device": microwave, "state": "off"}) · pick 그릇 꺼내기
```
- 전자레인지 시작은 위험 목록이라 실행 추적이 명령 전에 묻는다(코치 계획 Task 9 그대로).

- [ ] **Step 1: 실패하는 시험.** 「행동 목록 아홉, 앞 여덟 순서 그대로, 새 행동은 `coach`」, 「`tasksFor("noonchi")`에 없고 `coach`·`auto`에 있다」, 「`tasks.json`·`scenario.json` 이름 줄이 맞다(Task 4 TS 시험)」, 「가짜 모델의 전자레인지 계획이 계획 검사를 지나고 시작 단계가 위험(`riskyHand`)이다」, 「`fsmRuleOf`가 `cooking`」.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/act-tasks.test.ts tests/agent-planner.test.ts tests/brain-decision.test.ts tests/pam-scenario.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat(act): add microwave coaching for older people`.

### Task 12: 네 장면 가짜 서버 흐름 시험

**Files:**
- Create: `tests/demo-e2e.test.ts`
- Modify: `tests/helpers/pam.ts`(`demoPredict`, `demoReflect`)

**Interfaces:**
- `demoPredict(body)`: 시험용 PAM 답(대역). 관찰 텍스트와 기억으로 고른다: 사람 안 보임 + 빈 컵 → 컵 치우기, 사람 안 보임 + 내용물 → 그대로 두기, `사람이 말함: 「아 덥다」` → 에어컨 켜기, 기억에 「소파에 앉아 TV를 보기 시작」 에어컨 규칙이 있고 TV 보는 중 → 에어컨 켜기, `라면` 말 → 라면, `이거 어떻게` 말 + 전자레인지 보임 → 전자레인지, 그 밖 -1. 번호는 요청 `tasks`에서 이름으로 찾는다.
- `demoReflect(body)`: 받은 기억에 에어컨 습관 규칙과 라면 습관 규칙(코치)을 더해 돌려준다.

- [ ] **Step 1: 실패하는 시험.** 모두 `assist: "auto"`, 한양목련, 승인은 미리 둠:
  1. 빈 컵 → 첫 명령 `식탁으로 가 주세요`, 판단 사건 `assist: "noonchi"`, `fsm.learned: false`.
  2. TV 보는 사람 + `say` 「아 덥다」 → 폰 답 빈 글, 말 요청 에이전트 도구 호출 없음(가짜 모델이 `leave_it`), 거실 에어컨 켜짐.
  3. 같은 장면에서 말이 없으면 에어컨을 켜지 않는다(대조).
  4. 합성 7일 기록을 넣은 집에서 `POST /api/reflection/run`(어제) → 새 판본에 에어컨 습관만, `dropped`에 라면 습관(coach), 대시보드 반성 사건 `learned` 하나 → 이어서 말없는 TV 장면 → 에어컨 켜짐, 판단 사건 `assist: "noonchi"`, `fsm.learned: true`.
  5. 전자레인지 감지 + `say` 「이거 어떻게 하지」 → 첫 명령이 오고, 판단 사건 `assist: "coach"`, 시작 단계에서 승인 질문이 먼저 온다.
  6. `say` 「라면 끓이는 법 알려 줘」 → 첫 명령 `수납장으로 가 주세요`, 판단 사건 `assist: "coach"`.
  7. 모든 PAM 요청에 사진 칸이 없고 `contract`가 `pam-predict/2`·`pam-reflect/2`다.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/demo-e2e.test.ts` → 실패 확인(Task 1 전 커밋에서 한 번).
- [ ] **Step 3:** 빠진 연결을 고친다.
- [ ] **Step 4:** 통과 확인(시험 시간 한도 90초). 가짜 서버 `EFAULT`면 그 시험만 다시.
- [ ] **Step 5:** 커밋 `test(e2e): demo scenarios in auto mode from day one to coaching`.

### Task 13: 실제 판정·녹화·문서

- [ ] **Step 1:** `npx tsc --noEmit -p .`, `npm run lint`, `npm run heavy -- npx vitest run`, ui 시험, `services/pam`의 `python -m pytest`, `npm run heavy -- npm run build --prefix ui`.
- [ ] **Step 2: 가짜 판정.** 아래 「시연 순서」의 장면마다 `--fake`로 시각표가 나오는지 본다(비용 0).
- [ ] **Step 3: 실제 판정(한 바퀴 약 $0.45).** 서버·PAM을 새로 띄워 장면마다 한 판. **기준:** 장면 1·2는 컵 갈래 계획 기준 그대로, 장면 3은 말 뒤 15초 안에 에어컨 켜기·생각 말풍선 `눈치 · 에어컨 켜기`, 대조(day1 폴더에서 `tv-sit.mp4`)는 에어컨을 켜지 않음, 장면 4 실제 반성이 에어컨 습관 규칙을 낸다(행동 이름이 `에어컨 켜기` 그대로, 트리거가 한국어), 장면 5 말없이 에어컨 켜기·칩 `습관 · …`, 장면 6·7은 코치 계획 기준(첫 명령 30초 안, 위험 단계 질문 1번, 계획 done). 반성이 규칙을 못 내면 반성 원문(`raw_response`)을 보고 Task 4 지시문을 한 번 고쳐 다시 돌린다. 그래도 안 되면 `reflect --scripted`로 찍고 영상 자막에 「합성 기록으로 만든 습관」을 단다.
- [ ] **Step 4: 녹화.** 장면마다 `--record`(`BRAIN_YOLO_PROVIDER=cpu`)로 찍는다. 프레임 4장씩 뽑아 칩·말풍선 카드·트윈 에어컨·전자레인지가 맞는지 본다.
- [ ] **Step 5: 문서.** `docs` 저장소 `01_Product/구현명세서 SSOT.md`(돕는 방식 자동, 판단 칩, 반성 지시문 바꾸기, 반성 뒤 검사·거르기 자리, 마지막 반성 다시 보내기, 시연 준비 명령, 더한 가전 파일, 전자레인지 코치), `변경이력.md`. CLAUDE.md 규칙 표에 Task 10 줄.
- [ ] **Step 6:** Codex reviewer(herdr `w2:p5`)에게 브랜치 전체를 리뷰받고 지적을 고친다. `trail note`로 반성 지시문을 바꾼 까닭(논문 형식이 집기·놓기 영어 문장뿐이라 가전 습관을 못 배움)을 남긴다.

## 시연 순서 (발표 영상, 약 7분)

| 순서 | 모드 · 장면 | 집 폴더 | 판정 명령에 넣는 것 | 보여 줄 것 |
|---|---|---|---|---|
| 0 | 설정 | day1 | 없음 | 설정 3단계 돕는 방식 「자동」 (3초) |
| 1 | 눈치 · 1일차 상황 | day1 | `--clip cup-empty-leave.mp4` + 치우기 단계 영상 | 생각 말풍선 `상태 · 컵을 두고 자리를 뜸`·`눈치 · 컵 치우기`, 네 명령 |
| 2 | 눈치 · 1일차 상황 | day1 | `--clip cup-full-leave.mp4` | `눈치 · 컵 그대로 두기`, 말풍선 카드 「컵을 그대로 두기로 했어요.」 |
| 3 | 눈치 · 1일차 의도 | day1 | `--clip tv-hot-say.mp4 --say 15:아 덥다` | `눈치 · 에어컨 켜기`, 트윈 거실 에어컨 켜짐 |
| 4 | 눈치 · 일주일 | week | `demo-setup reflect` | 대시보드 생각 말풍선 `습관 · 새로 배움`, 말풍선 카드 「어제 기록으로 새 습관 1개를 배웠어요.」 |
| 5 | 눈치 · 8일차 선제 | week | `--clip tv-sit.mp4` | 말없이 `습관 · …`·`눈치 · 에어컨 켜기` |
| 6 | 코치 · 노인 | day1 | `--clip microwave-start.mp4 --say 4:이거 어떻게 하지` + 전자레인지 단계 영상 | `코치 · 전자레인지로 데우기 알려 주기`, 문 열림·닫힘을 비전으로 넘김, 시작 전 질문, 트윈 전자레인지 켜짐 |
| 7 | 코치 · 탈시설 장애인 | day1 | `--clip kitchen-start.mp4 --say 5:라면 끓이는 법 알려 줘` + 라면 단계 영상, 물 받기에 `wrong-fridge.mp4`, 면 넣기 때 `--say <초>:어 뭐 해야 되지` | `코치 · 라면 끓이기 알려 주기`, 인덕션 켜기 전 질문, 바로잡기, 조용한 단계(수업 기록 씨앗) |

장면 6·7은 1일차 집 폴더를 그대로 쓴다(코치 행동은 습관과 상관없다). 폴더를 바꿀 때는 서버를 다시 띄운다(PAM 서비스는 그대로).

## 찍을 영상 (사용자, 가로 1280×720, 폰을 가로로 고정)

이미 정한 영상은 다시 적지 않는다: 장면 1·2는 `2026-11-13-cup-branches.md` 「찍을 영상」의 `cup-empty-leave.mp4`·`cup-full-leave.mp4`와 치우기 단계 영상, 장면 7은 `2026-11-13-coach-mode.md` 「찍을 영상」 전부. 새로 찍을 것(장면 순서대로):

| 영상 | 길이 | 보여야 하는 것 |
|---|---|---|
| `tv-hot-say.mp4` | 40초 | 소파와 켜진 TV 화면이 함께 보임. 0~8초 사람이 들어와 앉음, 10~40초 TV를 보며 손으로 부채질. 소리는 필요 없다(말은 판정 명령이 넣는다) |
| `tv-sit.mp4` | 40초 | 같은 자리. 0~10초 들어와 리모컨으로 TV를 켜고 앉음, 10~40초 TV만 봄. 부채질·말 없음 |
| `microwave-start.mp4` | 20초 | 전자레인지 앞에 선 사람(어르신 역)이 그릇을 들고 전자레인지를 봄. 전자레인지 문과 단추가 화면 가운데 |
| 단계 `go-microwave.mp4` | 10초 | 1인칭으로 전자레인지 앞까지 |
| 단계 `open-microwave.mp4` | 10초 | 문을 열고 안이 5초 보임 |
| 단계 `put-bowl.mp4` | 10초 | 그릇을 넣고 손을 뺌 |
| 단계 `close-microwave.mp4` | 10초 | 문을 닫고 닫힌 문이 5초 보임 |
| 단계 `start-microwave.mp4` | 20초 | 단추를 누르고 안의 불이 켜져 접시가 도는 것이 15초 보임 |
| 단계 `microwave-done.mp4` | 15초 | 불이 꺼지고 문을 열어 그릇을 꺼냄 |

김준형 집 촬영(11-13 금 수업 뒤 ~ 11-14 토 낮)에 같이 찍으면 된다. 전자레인지가 없으면 다른 집에서 찍는다.

## 그 뒤 (이 계획에 넣지 않음)

- 사람 프로필(일반·발달장애·노인)과 프로필마다 seed FSM(자동 판단 안 나).
- 박석준 습관 후보정을 `HabitFilter`에 끼우기(Python이면 `pam-habits/1`).
- 약 먹을 때 챙기기, 냉장고 문 열림 알리고 닫게 하기(기본 동작).
- ThinQ 사용설명서를 읽어 가전 쓰는 법을 쉽게 풀기.
- 노인용으로 천천히 읽기(소리 속도), 같은 말 한 번 더 읽기. 글 키우기는 CLAUDE.md 글 크기 규칙을 바꿔야 한다.
- 반성 결과를 하루하루 비교해 보이는 화면.

## 정해야 할 것 (사용자)

1. **의도 파악 장면.** 가: 「아 덥다」 → 에어컨 켜기(추천. 상황 파악과 다른 단서(말)이고, 8일차 「말없이 에어컨」과 이어져 「의도 → 습관 → 선제」 이야기가 된다). 나: 남은 컵을 두고 갔다 돌아와 다 마시고 떠나면 치우기(`cup-full-return.mp4`, 컵 하나로 깊게).
2. **배울 습관.** 가: TV를 보러 소파에 앉으면 거실 에어컨 켜기(추천. 합성 일주일에 이미 있는 습관, 트윈에서 가전이 켜져 잘 보인다). 나: 물 대신 콜라로 바꿔 따라 주기(회의의 「물 → 콜라」 개인화, 피드백 기록을 더 넣어야 한다).
3. **일주일 반성.** 가: 시연 중 실제 PAM 반성 한 번, 안 되면 대본 판본으로 찍고 자막에 「합성」(추천). 나: 처음부터 대본 판본.
4. **반성 지시문 바꾸기.** 논문 반성은 행동을 영어 집기·놓기 문장으로만 쓴다. 가: 우리 행동 이름만 쓰게 바꾼다(추천. 안 바꾸면 반성 뒤 컵 규칙 행동이 영어 문장으로 바뀌고 에어컨 습관은 못 배운다). 나: 바꾸지 않고 박석준 FSM 작업(11-14)과 맞춘 뒤 정한다. 어느 쪽이든 박석준에게 알린다.
5. **자동의 기본값.** 가: 새 설정은 자동(추천). 나: 눈치. 옛 설정 파일은 그대로 눈치.
6. **노인 후보.** 가: 전자레인지로 데우기 알려 주기(추천). 나: 약 먹을 때 챙기기. 다: 냉장고 문 열림 알리고 닫게 하기.
7. **트윈에 전자레인지 더하는 길.** 가: 이 저장소 `added_devices.json`을 장면을 읽을 때 더함(추천, 저장소 하나로). 나: twin-studio에서 배치에 더해 다시 내보내고 복사.
8. **습관 거르기 자리 언어.** 가: TS 함수 자리(`HabitFilter`)를 두고 박석준이 고른다(추천). 나: 처음부터 PAM 새 주소 `pam-habits/1`.
9. **「습관」 칩 기준.** 가: seed에 없는 규칙이면 모두 습관(추천, 반성이 고친 컵 규칙도 습관으로 보인다). 나: 반성이 새로 더한 규칙만.
10. **처음 승인.** 시연 폴더에 승인을 미리 넣는다(추천, 영상이 짧다). 한 번은 「처음 하는 일은 묻는다」를 보일지.

## Self-Review

- 시나리오 1(상황·의도): 시연 순서 1~3, Task 3·9·12.
- 시나리오 2(일주일 뒤 습관, 눈치): Task 4·5·6·7·8·12, 「일주일을 시연 안에서 보이는 길」. 반성 규칙(그날 고정·다음 날 적용)은 바꾸지 않는다: 폰을 켜기 전에 어제를 반성한다(Task 8 `reflect`가 확인).
- p값 후보정 자리: 「습관 거르기 자리」, Task 5(`HabitFilter`, `keepAll`).
- 시나리오 3(노인): 후보 표, Task 10·11.
- 시나리오 4(탈시설 장애인): 코치 계획 그대로 + 수업 기록 씨앗(Task 8) + 영상 말 넣기(Task 9).
- 자동 판단: 설계 표, Task 1·2. 습관이 코치로 가는 길 셋을 막음: Task 2(칩은 행동 종류), Task 4(지시문 줄), Task 5(`coachGuard`), Task 12 시험 4.
- 규칙 코드로 행동 안 정함: 칩·검사만, 판단은 PAM. `demoPredict`·`demoReflect`는 `tests/helpers/` 대역.
- PAM 계약 그대로: 「PAM 계약」 절, Task 12 시험 7.
- 시연 순서와 영상: 위 두 표.
- 위험: 실제 PAM 반성이 바꾼 지시문을 따라 에어컨 습관을 낼지 모른다(Task 13 Step 3, 실패하면 대본 판본). 반성 출력이 16k 토큰 상한에 걸리는지도 모른다.
- 위험: 1일차 대조 판에서 PAM이 「말 없는 TV 장면」에도 에어컨을 켤 수 있다(논문 지시문이 기억을 「참고」로 보라고 한다). 그러면 장면 3·5의 차이가 흐려진다. Task 13에서 대조 판을 꼭 돌린다.
- 위험: 실제 에이전트가 「아 덥다」를 가전 요청으로 보고 바로 켤 수 있다(Task 3 지시문 줄은 강제하지 못한다).
- 위험: 영상 모드는 실제 시각을 쓴다. 배운 규칙에 「저녁」이 붙으면 낮에 찍은 장면 5에서 안 나올 수 있다. 합성 일주일에 주말 오후 TV도 넣었고, 그래도 시간이 붙으면 19~22시에 찍는다.
- 위험: VLM이 전자레인지 문 열림·쓰는 중을 실제 영상에서 얼마나 맞히는지 재지 않았다. 못 맞히면 그 단계는 「완료」로 넘어간다.
