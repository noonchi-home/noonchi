# 상위 판단 에이전트 2단계: 실시간 폰 촬영 · YOLO+VLM · PAM 연결 자리 · 모의 행동 Implementation Plan

**Goal:** 폰으로 실시간 촬영하면 클로이드 두뇌(1단계 `src/brain/`)가 돌아간다. YOLO가 매 장면 사람·컵이 있는지 보고, VLM은 마심·들고 있음·컵 안만 본다. 자리 비움 → 컵 안 사진 요청(폰 큰 글씨, 📷 답) → 판단 모델(모의 기본, PAM HTTP 자리) → 행동 직전 재확인 → 클로이드 행동(모의: 기록·폰 부탁) → 결과 확인(컵이 치워졌나)까지 대시보드 추론 과정 칸과 폰에 보인다.

**Architecture:** 판단 흐름은 지금처럼 결정론 코드(`machine.ts`)가 정한다. 새 입력 통로 하나를 더한다: YOLO 존재 판정(`observePresence`). 감지기가 있으면(감지 모드) 자리 비움 시계·행동 전 재확인·결과 확인은 YOLO 존재 판정으로, 사용 시작·컵 안·사람 손 보임은 VLM 판정으로 한다. 감지기가 없으면 1단계(VLM만) 동작 그대로다. VLM 호출은 코드가 거른다(볼 것이 없거나 바뀐 것이 없으면 부르지 않음). 행동은 모두 모의다: 실제·트윈 기기 명령, LG ThinQ 호출을 하지 않는다.

**Tech Stack:** TypeScript(Node 22), zod, vitest, onnxruntime-node 1.31.1(MIT), jpeg-js 0.4.4(BSD-3), YOLOX-Tiny ONNX(Megvii 공식 0.1.1rc0, Apache-2.0, 416×416).

**리뷰:** codex 계획 리뷰 1회차 P1 1·P2 5 → 아래 고정 규칙에 반영(시계 오차, VLM 확인, 재확인 둘 다, 마지막 검출 시각, 치워짐은 식탁 예, PAM evidence).

**근거:** 1단계 계획서 `2026-11-04-brain-cup.md`(고정 규칙·2단계 목록), 사용자 결정(YOLO와 VLM을 같이 둔다, 실제 가전은 절대 실행하지 않는다), `ai/pam/contracts.py`·`ai/pam/messages.py`(FSM 기억 모양, 예측 계약), 이 PC 측정(YOLOX-Tiny 추론 54ms·전처리 16ms, Nano 16ms·14ms, 4스레드).

## 고정 규칙

- 1단계 고정 규칙은 그대로 둔다. VLM만 쓰는 모드의 동작·테스트(57개)는 바꾸지 않는다.
- **촬영 시각(리뷰 P1 반영):** 폰이 2초마다 `{type:"clock", t0}`를 보내고 서버가 `{t0, server}`로 바로 답한다(NTP식). 폰은 최근 표본 중 왕복(RTT)이 가장 짧은 것으로 시계 차를 정하고 오차 = RTT/2로 둔다. 프레임·사진 헤더에 `captured_at`(서버 시계로 옮긴 촬영 시각)·`time_err_ms`를 붙인다. 서버는 촬영 시각 = `captured_at − time_err_ms`(가장 이른 가능 시각)로 써서 근거 나이·"판단 뒤"·"요청 뒤" 검사가 모두 보수적이 되게 한다. 받은 시각보다 늦으면 받은 시각으로 자른다. 동기 표본이 없으면 받은 시각을 쓰고 `time_source: "received"`로 표시한다.
- **YOLO 존재 판정(presence):** 프레임마다 사람(COCO person ≥ 0.5)·컵(cup·wine glass ≥ 0.4)을 본다. 놓침을 견디게 최근 `holdMs`(600ms) 안 프레임 중 하나라도 보이면 "있음", 하나도 없으면 "없음". 그 창에 프레임이 2장 미만이면 "모름". 근거 시각 = 그 프레임 촬영 시각. 창 때문에 지난 검출이 남지 않게 실제 마지막 검출 시각(`seen.person`·`seen.cup`)도 함께 준다(리뷰 P2-4).
- **식탁을 비추는가(table):** 맞춘 뒤에만 계산한다. 그 프레임 촬영 순간의 눈 자세(트윈 좌표) 카메라 앞 방향과, 트윈의 식탁·책상(type에 table/desk) 윗면 가운데·네 모서리 중 하나가 이루는 각이 30° 안이고 거리 0.3~6m면 "예", 다 벗어나면 "아니오". 맞추기 전·자세 없음은 "모름"(막지 않음, 기록함).
- **감지 모드 자리 비움:** 사용(VLM)을 본 뒤, 존재 판정이 "사람 없음 · 컵 있음 · 식탁 아니오가 아님"으로 `awayMs` 동안 이어져야 한다. 존재 판정 사이가 `staleMs`를 넘거나, 모름이거나, 조건이 깨지면 처음부터. 사람이 없어진 첫 근거 시각(`absentSince`)보다 뒤에 찍힌 VLM 판정이 사람을 예로 보면 취소한다(그보다 앞선 VLM 판정은 지난 일이라 무시). **확인에는 VLM도 필요하다(리뷰 P2-2):** 자리 비움 시작 뒤 찍힌 가장 최근 VLM 판정이 사람 없음·들고 있음 아님·마심 아님이어야 한다. 아직 없으면 YOLO 5초가 차도 기다리고, 거르기가 VLM을 간격마다 부른다(YOLO가 사람을 놓치는 장면에서 VLM이 손을 본 뒤 같은 장면을 다시 자리 비움으로 세지 않게).
- **사람 복귀(감지 모드):** 존재 판정 "사람 있음"이면 자리 비움·요청·판단·재확인·끝 단계에서 1단계와 같이 거두고 사용 중으로 돌아간다. 행동 단계(acting)에서는 사람이 컵을 치우러 오는 것이 정상이라 거두지 않는다.
- **행동 전 재확인(감지 모드, 리뷰 P2-3·P2-4):** 둘 다 판단이 끝난 뒤 찍힌 근거여야 한다. ① 존재 판정이 "사람 없음 · 컵 있음 · 식탁 아니오가 아님"이고 실제 마지막 컵 검출 시각도 판단 뒤, ② VLM 판정이 사람 없음·사용 아님. 없으면 거르기가 VLM을 부른다.
- **VLM 거르기(감지 모드):** 존재 판정이 모름이거나 사람도 컵도 없으면 부르지 않는다. 지켜보기 상태는 사람·컵이 같이 보일 때 간격마다, 요청 상태는 컵이 보일 때 간격마다, 기계가 VLM 확인을 기다릴 때(자리 비움 확인·재확인) 간격마다 부른다. 나머지는 (사람, 컵) 짝이 마지막 VLM 호출 때와 달라졌을 때 한 번만 부른다.
- **요청 답 사진:** 요청이 떠 있는 동안 폰 📷 사진은 다음 VLM 호출 한 번을 그 사진 한 장으로 한다(진행 중이면 끝난 뒤 바로). 요청 뒤에 찍힌 사진만 받는다(1단계 규칙). 사진은 판단 사진 버퍼에 넣지 않는다.
- **행동(acting, 모의):** 재확인을 통과하면 `planAction(작업)`으로 행동을 정해 `{type:"action"}`을 낸다. `dry_run: true`, 기기 명령 없음.
  - `컵 치우기`: 로봇이 없어 폰으로 사람에게 부탁한다(치웠어요 · 나중에). 결과 확인(리뷰 P2-5): 존재 판정 "컵 없음"이 `clearMs`(2초) 이어지되, 식탁 "예"(맞춘 뒤 식탁을 비춤)일 때만 저절로 "치워짐"이다. 식탁 "모름"(맞추기 전)은 사용자가 "치웠어요"를 누른 뒤의 컵 없음 2초만 센다(카메라만 돌려도 치워짐이 되지 않게). 식탁 "아니오"는 세지 않는다. "나중에"는 "미룸". `actionTimeoutMs`(120초) 안에 못 보면 "확인 못 함".
  - `사용자에게 물어보기`: 폰으로 묻는다(치워 주세요 · 그대로 둬요). 답을 기록하고 끝("치워 주세요"는 "모의: 컵 치우기를 할 일로 남김").
  - 목록에 없는 작업은 "지원하지 않는 작업"으로 기록만 한다.
  - VLM만 쓰는 모드의 결과 확인은 새 VLM 판정의 `cup_visible = no`로 같은 규칙을 쓴다.
- **판단 모델:** 기본은 모의(MockDecision). `BRAIN_DECISION=pam`이면 `PAM_URL`로 HTTP POST(계약은 `docs/pam-interface.md`). 기억은 컵 FSM(`CUP_FSM_MEMORY`, `memory_kind: "fsm"`). 장면 사진 5장 밖의 근거(요청 답 사진·VLM이 확신한 컵 안)는 `evidence` 배열로 따로 보낸다(리뷰 P2-6). 받은 답은 우리 쪽에서 다시 검사하고(parsePrediction), invalid는 대기와 구분해 판단 실패로 둔다.
- **대시보드·폰 메시지:** 대시보드 `/events`에는 `{type:"brain", event}` 하나로 보낸다(event.type = brain·perception·presence·request·action·result). 폰에는 `{type:"request"}`·`{type:"action"}`(active false로 거둠)·`{type:"brain_line"}`(작은 상태 한 줄)을 보낸다. 폰 답은 `{type:"brain_reply", id, choice}`.
- 커밋·푸시하지 않는다. 실제 VLM 호출은 이 작업 전체 30회 이하. 11-01 실험 파일·`.gitignore`·`graft/`·`.ignore`는 건드리지 않는다. 모델 파일은 `runtime/models/`(커밋 안 함), 내려받기 스크립트가 sha256을 검사한다.

## 파일

| 파일 | 맡는 일 |
|---|---|
| `src/brain/detector.ts` (새) | 감지기 인터페이스, YOLOX(onnxruntime-node·jpeg-js: 레터박스 → 격자 풀기 → 클래스별 최고 점수·NMS), 대본 감지기(시험용), 모델 정보·sha256 |
| `src/brain/presence.ts` (새) | 존재 판정(최근 600ms 창, 모름 규칙), 식탁을 비추는가(눈 자세 + 트윈 식탁) |
| `src/brain/actor.ts` (새) | 작업 → 모의 행동(폰 부탁 글·선택지·대시보드 글) |
| `src/brain/pam.ts` (새) | PAM HTTP 어댑터, 컵 FSM 기억, 요청 본문 만들기 |
| `src/brain/live.ts` (새) | 실시간 연결: 폰 프레임·사진·답 → 감지기(단일 진행·최신 우선) → 두뇌, 시계 차 보정, 틱 타이머, 메시지 나눠 보내기 |
| `src/brain/machine.ts` | 감지 모드(`observePresence`), absentSince 규칙, acting 상태·결과 확인·`actionReply` |
| `src/brain/brain.ts` | 감지 결과 → 기계, VLM 거르기, 답 사진 우선 호출, 행동 이벤트 |
| `src/brain/loop.ts` | 거르기 함수(gate)·우선 사진(priority) |
| `src/brain/config.ts` | `BRAIN_DETECTOR`·`BRAIN_DECISION`·`PAM_URL`·`BRAIN_VLM_MODEL`·`BRAIN_HOLD_MS`·`BRAIN_CLEAR_MS`·`BRAIN_ACTION_TIMEOUT_MS` |
| `src/phone/packet.ts`·`server.ts` | 헤더 `captured_at`, 프레임·사진 훅(눈 자세 포함), 폰으로 보내기, `brain_reply` |
| `src/server/start.ts` | `BRAIN=1`이면 LiveBrain을 만들고 잇는다(테스트용 주입: perceiver·detector·decision) |
| `web/phone/*` | `captured_at`, 요청 큰 글씨, 행동 부탁 카드(버튼), 상태 한 줄, 요청 중 📷 이름 바꿈 |
| `web/app.js`·`style.css` | 추론 과정 칸에 "🤖 클로이드 두뇌" 카드: 단계 줄을 쌓고, 최근 YOLO·VLM 판정은 한 줄씩 갈아 끼움 |
| `scripts/brain-yolo-fetch.ts` (새) | 모델 내려받기 + sha256 |
| `scripts/pam-mock-server.ts` (새) | 계약대로 답하는 모의 PAM 서버(시험·연동 확인용) |
| `scripts/brain-replay.ts` | `--detector` 옵션(녹화 프레임에 YOLO 같이) |
| `docs/pam-interface.md` (새) | 박석준과 맞출 입력·결과 형식(한 카메라, FSM 기억) |
| `docs/reference.md` | 실행 방법·환경 변수 |
| `tests/brain-{detector,presence,actor,pam,fusion,live}.test.ts` (새) | |

## Task 1: 감지기(detector.ts)
- 실패 시험 먼저: 합성 출력 텐서(격자 3549×85)를 풀면 알려진 상자·점수가 나온다, 레터박스 크기·패딩 114, BGR 순서, 클래스 거르기, NMS. 모델 파일이 있으면 실제 컵 영상 1장에서 사람·컵이 나온다(없으면 건너뜀).
- 구현 → 통과.

## Task 2: 존재 판정·식탁 보기(presence.ts)
- 시험: 600ms 창의 있음/없음/모름, 한 장 놓쳐도 있음, 촬영 시각 순서. 식탁 각·거리·모서리, 맞추기 전 모름.

## Task 3: 기계 감지 모드·행동(machine.ts)
- 시험: 감지 모드 자리 비움(YOLO), 공백·모름·식탁 아니오면 처음부터, absentSince 뒤 VLM 손 보임이면 취소·앞이면 무시, 재확인(YOLO), acting에서 사람 와도 안 거둠, 컵 없음 2초 → 치워짐, 나중에 → 미룸, 시간 초과, 물어보기 답. VLM 모드 결과 확인. 1단계 시험 그대로 통과.

## Task 4: 두뇌·반복(brain.ts·loop.ts·actor.ts)
- 시험: 거르기(볼 것 없음·바뀐 것 없음이면 호출 0), 요청 중 사진 한 장 우선 호출, 행동 이벤트 모양(dry_run), 대본 감지기 + 대본 VLM으로 처음부터 끝(사용 → 자리 비움 → 요청 → 사진 답 → 판단 → 재확인 → 행동 → 치워짐).

## Task 5: PAM 자리(pam.ts·docs·모의 서버)
- 시험: 요청 본문(사진 5장 base64, 시간대 시각, fsm 기억, 작업 목록), 모의 서버 valid → 예측, invalid → 판단 실패, 시간 초과, 받은 답 다시 검사.

## Task 6: 실시간 연결(live.ts·phone·start.ts·화면)
- 시험: 시계 차 보정, `startServer(BRAIN=1)` + 폰 WebSocket으로 프레임 패킷을 보내면 대시보드에 brain 이벤트, 폰에 request, 사진 답, action, brain_reply → 결과. 폰 화면·대시보드는 헤드리스 크롬으로 한 번 본다.

## Task 7: 검증
- `npx vitest run`, `npx tsc --noEmit`, 녹화 재생(`--detector`, 호출 0회 대본 + 실제 VLM 소량), YOLO ms/장 측정, 서버를 띄워 폰 없이 패킷 재생으로 끝까지 한 번.

## 2단계 결과

- **시험:** 전체 `npx vitest run` 70개 파일 973개 통과(1개 건너뜀), `npx tsc --noEmit` 통과. 새 시험은 `tests/brain-{detector,presence,fusion,gate,pam,live}.test.ts`다. 1단계 시험은 판단 할 일에 `contentsAtMs`가 더해진 것 하나만 고쳤다.
- **YOLO:** YOLOX-Tiny(Megvii 공식 ONNX, Apache-2.0). 이 PC 4스레드 기준 추론 54ms + 전처리 16ms, 워커 스레드로 재생하면 장당 78~119ms라 초당 12장 중 7~9장을 본다(단일 진행·최신 우선). Nano는 16ms + 14ms.
- **화면 확인(헤드리스 크롬, 대본 판정·대본 감지):** 폰 큰 요청 글, 행동 부탁 카드(모의 표시·버튼), 대시보드 🤖 카드(단계 글 + YOLO·VLM 한 줄). 페이지 오류는 없었다.
- **실제 VLM 재생(`--live --detector`, gpt-5.4-mini):** 이 작업 전체에서 19회·약 $0.018을 썼다. 마지막 재생은 8회·$0.0070으로 끝까지 갔다: 들고 있음 → 자리 비움(YOLO 5초 + VLM 사람 없음) → 요청 → 합성 답(빈 컵) → 판단(모의) → 재확인(YOLO + VLM) → 모의 행동. 근거 나이는 대개 1.5~2.0초였고, 첫 호출들은 3.1~3.8초라 모름 처리됐다. 다른 재생에서는 VLM이 옆모습만 보고 "음료 남음(확신)"이라 답해 판단을 다시 해 대기로 끝났다(1단계에서도 본 일, 안전한 쪽).
- **찾아 고친 것:**
  - onnxruntime-node 추론(`run`)이 부른 스레드를 막아, 같은 스레드에서 YOLO를 돌리면 VLM 판정이 1.7~1.9초에서 4초로 늘어 모두 모름이 됐다. 그래서 워커 스레드로 옮겼다(`detector-thread.ts`). 워커는 tsx 로더를 물려받지 않아 `detector-worker.mjs`가 `tsx/esm/api` `register()` 뒤 `.ts`를 불러온다(tsx·vitest 둘 다 됨).
  - 워커가 끝났다는 알림 직후 프로세스가 끝나면 프로세스가 멈췄다(재생 스크립트, 이 PC). 닫은 뒤 100ms 기다리면 멈췄고 300ms는 통과했다. 그래서 닫기는 워커에 close를 보내 세션을 놓게 하고, exit을 기다린 뒤 500ms 더 기다린다.
  - 판정 반복은 끝날 때마다 스스로 다시 부른다. 그래서 닫을 때 `CupBrain.stop()`으로 멈추지 않으면 닫은 뒤에도 VLM 비용이 나간다.
- **codex 리뷰:** 계획 1회(P1 1·P2 5), 코드 5회(1회차 P1 1·P2 5·P3 2 → 2회차 P1 1·P2 2 → 3회차 P2 2 → 4회차 P2 1 → 5회차 없음). 모두 반영했다. 고친 것: 오래된 VLM 판정으로 허가하지 않기, 시계 오차 범위(구간은 시작을 늦은 시각·끝을 이른 시각으로), 답 사진 따로 받기·나이 상한 8초·둘째 답 사진이 뒤집으면 다시 판단, 재확인 때 비춘 식탁만 치워짐으로 셈, 워커 종료 처리, 닫은 뒤 모델 호출 멈춤, 판단 근거 사진 보존.
- **합성이거나 막힌 것:** 컵 안 답(녹화 영상에는 위에서 찍은 사진이 없음), 판단 모델(모의). 실제 PAM은 박석준의 한 카메라 버전과 `OPENROUTER_API_KEY`가 있어야 한다(계약 `docs/pam-interface.md`). 실제 폰 촬영은 아직 안 했다.
