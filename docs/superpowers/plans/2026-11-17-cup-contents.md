# 컵 내용물: 확인 규칙 · 마시기 사건 · 불투명 컵 · 가까이 가서 보기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 컵 안 내용물을 사진 한 장으로 바꾸지 않는다. 새 값은 서로 다른 VLM 사진이 이어질 때만 정하고(옆 사진 3장·4초, 위에서 본 사진 2장·1.5초), 확인된 값은 마시기·따르기 같은 행동으로만 다시 연다. 불투명 컵은 옆 사진의 내용물 답을 쓰지 않는다. 컵이 비었는지는 사용자에게 묻지 않는다. 비전으로 모르면 폰(로봇의 몸)을 든 사람에게 「컵 가까이 가 주세요」·「컵 안이 보이게 위에서 비춰 주세요」를 보내 위에서 본 사진으로 정하고, 그래도 모르면 실행하지 않고 기록만 한다.

**Architecture:** World State 내용물 갱신기 `ContentsBook`(`src/world/state/contents.ts`) 하나가 전체 사진·잘라 본 사진·위에서 본 사진의 VLM 답, 마시기·따르기 사건, 계획의 따르기 창을 받아 `facts.contents`와 `contents_gen`을 쓴다. 실행 쪽은 확인된 값만 쓴다. 실행 전 검사가 내용물을 몰라 막은 계획은 `ContentsHold`(`src/act/track/contents.ts`)가 붙잡아 잘라 보기 → 사진 기다리기 → 가까이 가서 보기(peek) 차례로 푼다. 계획이 없을 때는 판단 전 보기 B 뒤에도 모르거나 불투명한 컵을 같은 가까이 가서 보기로 본다(`TrackCore.idlePeek`). 가까이 가기의 끝은 맞춘 폰 눈 자리로, 위에서 비추기의 끝은 엔진 프레임 카메라로 정한다. 위에서 본 VLM 프레임 두 장은 관찰 흐름의 위에서 보기(`ObservePipeline.topLook`)가 VLM으로 보고 그 컵 내용물만 넣는다.

**Tech Stack:** Node 22 TypeScript, zod, Vitest, 가짜 OpenAI 호환 서버(`scripts/fake-openai.ts`), 시험용 PAM 자리(`tests/helpers/pam.ts`).

**Spec:** 사용자가 정한 것(2026-11-17)과 Codex 설계 검토. 구현명세서 `docs` 저장소 `01_Product/구현명세서 SSOT.md` 6.1·6.2·6.3·6.6·6.12절. 저장소 설명 `docs/reference.md` 「관찰 흐름」.

## 정한 것 (2026-11-17)

1. **보이는 사실은 사용자에게 묻지 않는다.** 컵이 비었는지는 비전으로 정한다. 비전으로 모르면 로봇(폰을 든 사람)이 가까이 가서 위에서 본다. 사용자에게는 선택(「치울까요」·「물 채워 드릴까요」)만 묻고 말로 받는다.
2. **가까이 가서 보기(peek)는 명령 두 개다.** 둘 다 사람에게 하는 명령이고 「주세요」로 끝나며 단추가 없다(`choices: []`, 비전으로만 넘긴다). 「그만」은 받는다.
   - 「컵 가까이 가 주세요」(종류 go, `near_m: 0.5`): 맞춘 폰 눈이 컵과 수평 0.5m 안이면 끝. 처음부터 안이면 보내지 않는다.
   - 「컵 안이 보이게 위에서 비춰 주세요」(종류 do, `view: "above"`): 컵 안을 내려다본 VLM 프레임 쌍(정한 것 5의 시간 조건)이 모이면 끝.
   - 끝나면 명령을 지우고 그 두 장을 위에서 보기로 VLM에 보낸다.
   - 그래도 모르면 묻지 않는다. 계획은 실행하지 않고 「대상 물건 안을 몰라 실행하지 않아요」로 닫힌다. 계획 밖이면 보기 기록만 남는다. 같은 컵·세대는 60초 동안 다시 가지 않는다.
   - 가까이 가서 보는 동안 컵이 옮겨지면(트윈 자리가 0.1m 넘게 바뀜, 옮김 표시, 사라짐) 그 차례를 거두고 처음부터 한다.
3. **컵 안이 보임 판정**(엔진 프레임 하나, 카메라가 있을 때만, `topView`):
   - 컵 모양은 안 반지름 r = 3.5cm, 깊이 h = 10cm 원통으로 본다(`TOP_CUP_M`). 컵 자리는 바닥 가운데다.
   - 카메라와 컵 자리의 수평 거리 d, 카메라의 컵 바닥 위 높이 H로 본다.
   - 카메라가 테두리보다 높다(H > h). 그리고 d ≤ r(카메라가 입구 바로 위)이거나, 먼 쪽 안벽 바닥 모서리로 가는 선이 가까운 테두리 위로 지난다(H·2r ≥ h·(d + r)).
   - 컵 자리가 화면 가운데 절반 안이다(NDC |x|·|y| ≤ 0.5).
   - 근거: 먼 쪽 안벽 바닥 모서리가 보이면 바닥이 보인다. 조금만 담겨도 그 모서리를 수면이 덮으므로 빈 컵과 갈린다.
   - 근거: 모양은 머그(안지름 7.5cm·깊이 9.5cm)와 종이컵(7cm·9cm)보다 좁고 깊게 잡았다. 그래서 두 컵 모두 이 판정이 통과하면 안이 보인다. 키 큰 유리잔은 속이 비쳐 옆 사진으로 본다.
   - 예: 수평 8cm·바닥 위 13.9cm는 안 된다(필요 높이 16.4cm). 테두리가 바닥을 가린다. 바닥 위 35cm면 수평 21cm 안이어야 한다. 영상 모드 자세(수평 15cm·위 40cm)는 된다.
   - 근거: 잘라 보기는 컵 자리를 가운데로 프레임 절반 크기를 자른다(`cropBox`). 컵이 가운데 절반 안이면 잘라 낸 칸이 화면 밖으로 밀리지 않고 가장자리 왜곡·잘림이 없다.
4. **가까이 가기 0.5m 근거:** 식탁 가에 선 사람이 팔을 뻗어 폰을 컵 위에 둘 수 있는 거리다(팔 길이 약 0.6m, 폰은 몸 앞 0.2~0.4m).
5. **위에서 본 사진 시간 조건(한곳 `TOP_CONFIRM`, 준비 판정과 확인 판정이 같이 쓴다): 서로 다른 원본 프레임 2장, 처음과 마지막 촬영 1.5초 이상, 이웃 공백 6초 이하.**
   - 위에서 비추기의 끝(`topReady`)과 내용물 확인(`ContentsBook`)이 같은 함수 `topPairOf`로 쌍을 고른다. 준비가 됐는데 확인이 못 되는 일이 없다.
   - 위에서는 바닥이 바로 보여 옆 사진의 모호함(비침·반사·불투명 몸통)이 없다.
   - 남은 잘못은 한 장의 흐림·움직임이라 서로 다른 순간 두 장이면 막는다.
   - 1.5초는 VLM 프레임 2초 간격의 이웃 두 장이다(촬영 시각 흔들림 여유 0.5초). 사람이 폰을 컵 위에 드는 시간이 2~4초로 줄어든다.
6. **위에서 본 확인이 옆 사진 근거를 대신한다.**
   - 위에서 본 쌍이 확인되면, 확인 값이 옆 사진으로 정한 것일 때 창과 상관없이 그 값을 거두고 위 값으로 바꾼다(이전 값 보관, 세대 +1, 판단 계기 줄).
   - 확인 값이 위에서 정한 것이면 반대 쌍은 지금 규칙(후보 충돌로 짐작, 창 안에서만 바꿈)을 따른다.
   - 위에서 확인한 값은 `sure.top`으로 표시한다.
   - 불투명이 확인되면 옆 사진으로 정한 확인 값은 거둔다(보관, 세대 +1). 그 뒤 옆 사진은 버리고 위에서 본 사진만 받는다.
7. **위에서 보기는 대상 확인을 거친 장의 답만 넣는다.**
   - VLM에는 그 컵 하나만 감지 번호 d1로 준다. 상자는 트윈 컵 자리를 그 장 카메라로 찍은 것이다(지름 10cm·높이 12cm 원기둥의 꼭짓점).
   - VLM 글에 「d1에 컵이 없으면 not_visible로 답하라」를 둔다(`TOP_NOTE`).
   - 장마다 차례대로 본다.
     1. d1 답에 not_visible이 있으면 그 장을 버린다.
     2. 내용물 값(비어 있음·내용물 있음)이 없으면 그 장을 버린다.
     3. 같은 잘라 본 사진의 YOLO 그릇 감지(컵·와인잔·그릇 종류) 가운데 상자 가운데가 d1 상자 안인 것이 없으면 그 장을 버린다(그 자리에 그릇이 있음).
     4. 트윈에서 같은 종류 다른 물건이 컵 자리 0.1m 안에 있으면 버린다(어느 컵인지 모름).
   - VLM 답이 왔을 때 컵이 사라졌거나, 옮김 표시가 붙었거나, 트윈 자리가 위에서 보기를 시작한 때보다 0.1m 넘게 바뀌었으면 답을 넣지 않는다(`moved`).
   - YOLO 감지는 대상 확인에만 쓰고 물건 합치기(`applyCloser`)에는 넣지 않는다. 위에서 본 그릇은 YOLO가 종류를 바꿔 볼 수 있어서다.
   - 대상 확인을 거친 장은 그 컵을 본 것으로 센다(정한 것 14). 내용물 말고 다른 면은 넣지 않는다.
8. **걷게 하지 않는 때:** 폰 대화(말 요청 처리 중·끝난 뒤 10초)·끄기 안내·승인 대기·승인이나 다시 묻기 질문 중에는 명령을 보내지 않는다. 이미 떠 있으면 거둔다(지우기). 풀리면 새 번호의 단계 id로 다시 보낸다. 계획 밖이면 열린·만드는 계획(코치 포함)도 막는다.
   - 보류에서 풀려 첫 명령을 보낼 때도 같다. 폰 대화·승인 대기가 있으면 첫 명령을 미루고 tick마다 다시 본다. 미룬 지 30초(`holdMs`)가 지나면 「폰을 쓰는 중이라 실행하지 않아요」로 닫는다.
9. **계획 밖 가까이 가서 보기 때(모두):**
   - 막는 것이 없다. 위치를 맞췄다. 사람이 보인다. 행동 목록에 내용물 행동(`want`)이 있다.
   - 그 컵이 보이고 자리를 알며, 치운 것·손에 든 것이 아니고, 볼 면을 모른다.
   - 불투명이 확인됐거나, B가 그 세대에 잘라 본 지 4초가 지났다.
   - 명령 id는 `peek:<번호>`다.
10. **영상 모드도 같은 명령을 받는다.**
    - 영상 페이지가 명령의 `near_m`(go)·`view: "above"`(do)를 따라 자세를 옮긴다. go는 `near_m`×0.8(0.4m)까지 걷는다. above는 컵에서 0.15m 떨어진 0.4m 위로 폰을 옮겨 컵을 바라본다(정한 것 3이 통과하는 자세).
    - 명령이 지워지면(`command_clear`) 영상 페이지는 그 명령의 예약된 영상 바꾸기와 걷기를 멈춘다(`PhoneAr.commandClear`).
    - 새 칸 때문에 폰 계약 판본을 3에서 4로 올린다. 판본 3으로 열린 탭은 옛 탭으로 새로 고침 안내를 받는다.
    - 단계 영상 `step=go:cup:…`·`step=do:cup:…`이 그 사진을 대신한다.
    - 실행 추적·폰 서버에는 영상 갈래가 없다.
11. **실행 전 검사:**
    - 계획이 다루는 컵마다 있음·치움·낡음·들고 있음을 먼저 본다.
    - 그 뒤 내용물을 본다. 하나라도 확인된 반대 값이면 막고, 모르면 그 컵을 붙잡는다.
    - 보류하는 동안 컵이 낡으면 보류를 이어 간다.
12. **계획 전 검사:**
    - 내용물 후보는 지금 보이는(10초 안에 본) 컵만이다.
    - 맞는 컵이 하나라도 있으면 통과한다.
    - 모르는 컵이 있으면 계획으로 넘긴다. 단, 계획 없는 행동(「컵 그대로 두기」)은 막는다.
    - 다 확인된 반대 값이면 막는다.
13. **따르기 사건은 감지 마스크로 본다:** 병 마스크 긴 축(주성분)과 중력 방향의 각, 「컵 위」는 두 마스크를 중력 좌표에 비춘 범위로 본다. 마스크가 없거나 작거나 둥글거나 카메라 자세가 없으면 보지 않는다.
14. **위에서 볼 때 컵의 보임:**
    - 위에서는 YOLO가 컵을 못 잡아 사라짐으로 셀 수 있다. 그래서 위에서 비추기 명령을 보낼 때 그 컵에 지킴(가까이 보기 지킴과 같은 칸 `closerAt`, 30초)을 건다(`WorldState.guard`). 지킴 동안은 전체 사진에서 못 봐도 사라짐으로 세지 않는다. 같은 종류 새 물건이 다른 자리에 생기면 지금처럼 지킴이 풀리고 옮김 표시가 붙는다.
    - 대상 확인을 거친 위 사진은 그 컵의 마지막 본 때·시야 안 때를 그 촬영 시각으로 올리고 지킴을 다시 건다.
    - 위에서 본 뒤 실행 전 검사가 낡음(3초 넘게 못 봄)으로 막으면, 보류가 30초(`holdMs`) 동안 기다린다. 사람이 폰을 내리면 옆 사진이 컵을 다시 보고 시작한다. 30초가 지나도 못 보면 낡음으로 닫는다.

## 조사한 사실 (2026-11-17, `refactor/domain-split` bee7c2e)

- 엔진 프레임은 100ms, VLM 프레임은 2초마다다(`loadObserveConfig` `ENGINE_FRAME_MS`·`VLM_FRAME_MS`). 고리에는 둘 다 있고 `vlm === false`가 빠른 프레임이다.
- 가까이 보기(`ObservePipeline.closer`)는 VLM 프레임 중 대상이 사진 안인 최근 5장을 잘라 YOLO로 보고, 물건 감지가 있는 가장 새 장 하나만 VLM에 보낸다. VLM 답은 감지 번호(d1…)마다 붙으므로 감지가 없으면 컵에 붙일 답이 없다.
- 카메라 기하는 `src/world/place.ts`(`ndc`·`pixelOf`·`inView`)에 있다. 프레임 카메라는 `CameraView`(origin·orientation·theta·projection)다.
- 실행 추적의 폰 눈은 맞춘 눈만이다(`TrackCore.eye`, 평면 XZ). 컵 자리는 트윈 좌표 `[x, 높이, z]`다.
- 영상 페이지(`ui/src/phone/core/video-ar.js`)는 go면 대상 0.6m 앞까지 걷고, 집기·놓기·do면 그 자리에서 대상을 바라본다. 높이는 바꾸지 않는다. 시작 높이 1.4m에서 0.6m 앞 식탁 위 컵을 보면 내려다보는 각은 약 47°다.
- 폰 명령의 `kind`는 영상 페이지가 단계 영상을 고를 때 쓴다(`PhoneCommand.kind`).
- PAM 시나리오 지시문은 「(짐작)·모름 값이면 규칙을 쓰지 않는다」라 불투명 머그는 PAM이 물·콜라를 고르지 않고 대기한다.
- 보기 담당 E(`Looker.contents`)는 관찰 모드 없이 바로 가까이 본다. 같은 물건은 30초(`objectGapMs`)에 한 번이다.
- 폰 대화 세기(`HomeCore.talk`, `TALK_QUIET_MS` 10초)와 승인 대기(`approvalsWaiting`)가 실행 추적 옵션으로 와 있다.

## Global Constraints

- worktree `C:\Users\ABC\Desktop\소웨공\twin-home-split`, 브랜치 `refactor/domain-split`. 다른 에이전트가 `twin/` 데이터와 그 시험을 고친다. `twin/`과 그 시험 파일은 건드리지 않는다.
- 커밋은 내 파일만 경로를 적어 `git add <파일…>`로 한다(`git add -A` 금지). `.gitignore`·`.ignore`는 커밋하지 않는다. 커밋 메시지는 영어로 쓰고 attribution 줄을 넣지 않는다. 묶음마다 커밋하고 `git push origin refactor/domain-split`(force·amend 금지).
- 시험·빌드는 `npm run heavy -- <명령>`으로 하나씩 돌린다.
  - 작은 시험 파일 하나는 남은 메모리 2.6GB까지 된다.
  - 큰 것(act-track 전체·e2e·전체·typecheck)은 3GB가 넘거나 조정자가 「돌려도 돼요」라고 할 때만 돌린다.
- 서버(8200·8210)·PAM(8300)은 띄우지 않는다. 실제 모델은 부르지 않는다. `.env`는 읽지 않는다.
- 저장소 `CLAUDE.md` 규칙 표를 모두 따른다. 특히 다음을 지킨다.
  - mock·live 같은 구조: 새 길에 모드 갈래를 두지 않는다. 가짜는 `tests/helpers/`에만 둔다.
  - 도메인 경계(`scripts/lint-domains.ts`): world는 act를 가져오지 않는다. 행동 조건은 공용 표 `src/act/tasks.ts`에 둔다.
  - 실제 폰 명령은 사람에게 하는 말이고 「주세요」로 끝난다.
  - 영상 모드 같은 구조: 갈래는 영상 페이지의 자세 흉내·단계 영상에만 둔다(`tests/video-mode-parity.test.ts`).
  - 새 화면 자리를 만들지 않는다. 가까이 가서 보기는 지금 명령 줄(`r.sent`·계획 밖이면 `idlePeek.sent`)로만 보낸다.
  - 화면 글 규칙: 서버 글은 60자 아래로, 화살표·괄호 없이, 상태와 할 일만 쓴다.
  - 바깥 글은 `headWithin`으로만 자른다.
  - 승인 규칙은 그대로다. 가까이 가서 보기는 승인 질문을 덮지 않는다.
- PAM 지시문(논문 프롬프트·시나리오)은 바꾸지 않는다.

## 정한 값

| 이름 | 값 | 자리 |
|---|---|---|
| 확인 사진 수 | 서로 다른 원본 프레임 3장 | `CONTENTS_CONFIRM.photos` |
| 확인 시간 | 첫 사진과 마지막 사진 촬영 4초 이상 | `CONTENTS_CONFIRM.spanMs` |
| 최대 관측 공백 | 이웃 사진 사이 6초 넘으면 처음부터 | `CONTENTS_CONFIRM.gapMs` |
| 후보 충돌 | 확인 값과 반대 값이 최신 사진에서 2장 이어짐 | `CONTENTS_CONFIRM.conflict` |
| 위에서 본 확인·준비 | 서로 다른 원본 프레임 2장, 1.5초 이상, 이웃 공백 6초 이하 | `TOP_CONFIRM`·`topPairOf` |
| 위에서 보기 대상 | 컵 자리 0.1m 안 같은 종류 다른 물건 없음, 자리 바뀜 0.1m 안 | `TOP_SAME_M` |
| 컵 안이 보임 | 안 반지름 3.5cm·깊이 10cm 컵의 먼 쪽 안벽 바닥 모서리가 가까운 테두리 위로 보임, 컵 NDC \|x\|·\|y\| ≤ 0.5 | `TOP_CUP_M`·`TOP_VIEW` |
| 위에서 보기 상자 | 지름 0.1m·높이 0.12m 원기둥 | `TOP_BOX_M` |
| 가까이 가기 끝 | 폰 눈과 컵 수평 0.5m 안 | `PEEK.nearM` |
| 가까이 가서 보기 명령 한도 | 명령마다 30초 | `PEEK.stepMs` |
| 같은 컵 다시 가기 | 같은 세대면 60초 뒤 | `PEEK.retryMs` |
| 입에 댐 | 든 컵 상자와 얼굴 점 거리 ≤ scale × 0.5 | `MOUTH_NEAR` |
| 기운 병 | 마스크 긴 축과 중력 각 35° 이상 | `POUR_TILT_DEG` |
| 보류: 잘라 보기 기다림 | 3초 | `CONTENTS_HOLD.lookWaitMs` |
| 보류: 사진 기다림 | 잘라 본 뒤·위에서 본 뒤 4초 | `CONTENTS_HOLD.settleMs` |
| 보류 한도(가까이 가서 보기를 시작하지 못할 때, 위에서 본 뒤 다시 보기, 보류에서 풀려 첫 명령을 미룰 때) | 30초 | `CONTENTS_HOLD.holdMs` |
| 영상: 가까이 걷기 | `near_m`×0.8 | `video-ar.js` `NEAR_WALK` |
| 영상: 위에서 비추기 | 컵에서 수평 0.15m, 위로 0.4m | `video-ar.js` `ABOVE` |

## 끝낸 묶음 (1~7·9·10, 남는 것)

- **Task 1 말 답 맞추기(59a7e5e, 58246d8):**
  - `matchChoice`의 `whole`은 말 전체로 견준다. 「네」「응」 하나만 말해도 답이다.
  - `QUESTION_CHOICES`(물어보기·승인·다시 묻기)와 `tests/voice-answers.test.ts`.
  - 규칙 표 「실제 폰 질문은 말로 답할 수 있다」.
- **Task 2 몸통 면(c7cb958):** 면 `body`(속이 비침·불투명), VLM 프롬프트 줄, 낱말 문서.
- **Task 3 내용물 갱신기(ab3f618, d1ccae2):**
  - `ContentsBook`의 확인 규칙(3장·4초·6초)을 둔다.
  - 같은 원본 프레임은 한 장으로 센다. 잘라 본 답이 앞선다.
  - 후보 충돌 기억, 받치던 사진이 바뀌면 다시 세기, 몸통 다음 내용물, `closer_ms` 남김을 둔다.
  - 다시 열기·따르기 창·세대·이전 값 보관을 둔다.
- **Task 4 마시기·따르기 사건(42505f8, 4ef0db4, 3a8a024):** 얼굴 점과 든 컵, 병 마스크 긴 축과 중력. 사건은 다시 열기만 한다.
- **Task 5 조건(e61108b):** `factIs`는 확인된 내용물만 받는다. 관찰 텍스트에 확인·짐작을 표기한다.
- **Task 6 검사·B(a9e2eb1, 6ec580a, bee7c2e):**
  - 행동 조건 `want`를 둔다(그대로 두기는 내용물 있음, 채우기·콜라는 비어 있음).
  - 계획 전·실행 전 내용물 검사, 이유 `unknown_contents`·`contents_mismatch`.
  - B는 짐작을 모름으로 본다.
- **Task 7 보류(51efc9a):** `ContentsHold`가 잘라 보기 → 사진 기다리기를 한다. 낡아도 보류를 이어 가고 `holdMs`가 지나면 닫는다.
- **Task 9 따르기 창(1620be1):**
  - 끝 조건에 내용물이 있는 do 단계는 그 컵의 창을 연다(`contentsAction`). 따라가는 id가 바뀌면 창을 옮긴다.
  - 폰 대화 세기를 둔다(`HomeCore.talk`).
- **Task 10 문서(c055e6f):** `docs/reference.md`. 질문 문장은 Task 18에서 고친다.

## File Structure (남은 묶음)

| 파일 | 일 |
|---|---|
| `src/act/prompts.ts`, `src/act/ask-step.ts`, `src/act/talk-grade.ts`, `src/act/say.ts`, `src/act/labels.ts`, `src/act/track/{contents,core,start,approval,answers,tracker}.ts`, `src/server/home/act.ts`, `src/observe/pipeline.ts`, `src/world/state/{contents,world}.ts`, `src/world/{labels,text}.ts`, `src/contract/{world,phone}.ts`, `CLAUDE.md` | Task 12 질문 걷어 내기 |
| `src/act/check.ts`, `src/act/tasks.ts` | Task 13 검사 고침 |
| `src/world/place.ts`(`topView`·`topBox`), `src/world/state/contents.ts`(`TOP_CONFIRM`·`topPairOf`, 위에서 본 사진, 옆 확인 거둠), `src/world/state/world.ts`(`applyTop`·`guard`) | Task 14 위에서 본 사진 |
| `src/observe/pipeline.ts`(`topReady`·`topLook`), `src/observe/scene.ts`(`TOP_NOTE`), `src/observe/crop.ts`, `src/act/look.ts`(E 위에서 보기) | Task 15 위에서 보기 |
| `src/act/track/contents.ts`(peek), `src/act/track/{core,start,tracker,answers}.ts`, `src/act/labels.ts`(`PEEK_TEXT`), `src/contract/phone.ts`(`near_m`·`view`), `src/contract/phone-version.ts`·`src/phone/protocol.ts`·`ui/src/phone/protocol.ts`(판본 4), `src/server/home/act.ts` | Task 16 보류의 가까이 가서 보기 |
| `src/act/track/contents.ts`(idle peek), `src/act/track/{core,tracker,answers}.ts`, `src/act/look.ts`(`looked`) | Task 17 계획 밖 가까이 가서 보기 |
| `ui/src/phone/core/video-ar.js`, `ui/src/phone/core/video-math.js`, `ui/src/phone/core/ar.d.ts`(`commandClear`), `ui/src/phone/controller.ts`(지우기를 AR에 넘김), `ui/tests/…video…` | Task 18 영상 모드 자세 |
| `docs/reference.md`, `docs/world-vocabulary.md`(바뀌면) | Task 19 문서와 전체 검증 |

---

### Task 12: 질문 걷어 내기 · 규칙 표 한 줄

**Files:**
- Modify: `src/act/prompts.ts`
  - 뺀다: `ContentsChoice`, `EMPTY_SAID`·`HAS_SAID`, `CONTENTS_CHOICES`, `contentsAnswer`, `QUESTION_CHOICES.contents`
  - 남긴다: `QUESTION_CHOICES`의 다른 묶음, `matchChoice` 가져오기가 쓰이면 둔다
- Delete: `tests/contents-answer.test.ts`
- Modify: `tests/voice-answers.test.ts`(묶음 목록에서 내용물만 뺀다)
- Modify: `src/act/ask-step.ts`(`contentsStep`·`isContentsStep` 뺌), `src/act/talk-grade.ts`·`src/act/say.ts`(그 쓰임 뺌), `src/act/labels.ts`(`CONTENTS_TEXT`, `EXEC_TEXT.contentsAsked`, 쓰지 않는 `SAY_TEXT` 줄 뺌)
- Modify: `src/act/track/approval.ts`(`Asking` contents), `answers.ts`(contents·idle 답), `core.ts`(`idleAsk`, `choicesOf` contents), `start.ts`(질문 때문에 넣은 `if (r.asking) return;`), `tracker.ts`(`answerContents` 옵션·질문 tick 갈래·`dropIdle`)
- Modify: `src/act/track/contents.ts`
  - 뺀다: `ask`·`answered`·`lapsed`·`noAnswer`·`idle`·`idleAnswered`·`dropIdle`·`idleTarget`·`idleBlocked`·`wanting`·`lookedIdle`, 칸 `asked`·`quietUntil`·`askSeq`·`lookedB`
  - `ask` 차례를 `wait` 차례로 바꾼다(잘라 보고 사진을 기다린 뒤에도 모르면 `holdMs`까지 기다리다 닫는다). Task 16이 이 자리에 peek를 넣는다.
- Modify: `src/act/look.ts`(`looked` 옵션과 그 부름 뺌. Task 17이 다시 넣는다), `tests/act-look.test.ts`
- Modify: `src/server/home/act.ts`(`answerContents`·`looked` 배선 뺌), `src/observe/pipeline.ts`(`publish`를 다시 private으로)
- Modify: `src/world/state/contents.ts`
  - 뺀다: `answer`, `by: "person"` 갈래(`see`의 사람 답 앞서기, `effective`의 사람 답)
  - `sure.by`를 뺀다(늘 VLM)
- Modify: `src/world/state/world.ts`(`answerContents` 뺌), `src/contract/world.ts`(`WorldFact.by` 뺌), `src/world/labels.ts`(`ANSWERED`, `CHANGE_TEXT.contentsAnswered` 뺌), `src/world/text.ts`(사람 답 꼬리 뺌)
- Modify: `src/contract/phone.ts`(내용물 질문 설명 줄을 옛 글로)
- Modify: `tests/world-contents.test.ts`(사람 답 묶음 뺌), `tests/world-text.test.ts`, `tests/act-track.test.ts`(내용물 질문 시험 뺌), `tests/talk-grade.test.ts`, `tests/act-say.test.ts`
- Modify: `CLAUDE.md`
  - 「실제 폰 질문은 말로 답할 수 있다」 줄의 막는 장치에서 `tests/contents-answer.test.ts`를 뺀다.
  - 새 줄을 넣는다.

남기는 것: 말 답 고침(`whole` 말 전체, 「네」「응」 하나), 지금 질문의 말 답 시험, 폰 대화 세기(`HomeCore.talk`·`talking` 옵션), 승인 대기 옵션(`approvalsWaiting`), 행동 목록 옵션(`tasks`), 확인 규칙·사건·불투명 면·조건·검사·따르기 창.

- [ ] **Step 1: 질문이 없음을 보는 시험을 먼저 쓴다** (`tests/act-track.test.ts`)

```ts
it("내용물을 몰라 붙잡은 계획은 사용자에게 묻지 않는다: 잘라 본 뒤에도 모르면 기다리다 「안을 몰라」로 닫고, 보낸 글에 「?」가 없다", async () => {
  const s = setupHeld({ cup: unknownCup(), lookContents: (h) => { h.done(); return true; } });
  await s.decide("fill_water");
  s.advance(CONTENTS_HOLD.holdMs + 1000);
  expect(s.sent().filter((c) => c.type === "command").every((c) => !c.text.endsWith("?"))).toBe(true);
  expect(s.executions().at(-1)).toMatchObject({ state: "failed", text: CHECK_TEXT.unknown_contents });
});
```

- [ ] **Step 2: 실패를 본다** — `npm run heavy -- npx vitest run tests/act-track.test.ts -t "묻지 않는다"` → FAIL(지금은 「컵 비었어요?」를 보냄)
- [ ] **Step 3: 위 목록대로 걷어 낸다.** 실행 추적 `TrackCore.contents` 옵션 이름과 보류의 잘라 보기 차례는 그대로 둔다.
- [ ] **Step 4: 규칙 표에 줄을 넣는다** (`CLAUDE.md` 표 끝)

```
| 보이는 사실(컵 내용물 등)은 사용자에게 묻지 않고 비전으로 정하며, 모르면 가까이 가서 본다. 사용자에게는 선택만 묻는다 | 없음 |
```

- [ ] **Step 5: 시험을 돌린다** — `tests/act-track.test.ts`·`tests/voice-answers.test.ts`·`tests/world-contents.test.ts`·`tests/world-text.test.ts`·`tests/talk-grade.test.ts`·`tests/act-say.test.ts`·`tests/act-look.test.ts`를 하나씩 돌린다. 모두 PASS여야 한다. 그 뒤 `npm run heavy -- npm run typecheck`, `npm run heavy -- npm run lint`
- [ ] **Step 6: 커밋·푸시**

```bash
git add src/act/prompts.ts src/act/ask-step.ts src/act/talk-grade.ts src/act/say.ts src/act/labels.ts src/act/track/approval.ts src/act/track/answers.ts src/act/track/core.ts src/act/track/start.ts src/act/track/tracker.ts src/act/track/contents.ts src/act/look.ts src/server/home/act.ts src/observe/pipeline.ts src/world/state/contents.ts src/world/state/world.ts src/contract/world.ts src/contract/phone.ts src/world/labels.ts src/world/text.ts tests/contents-answer.test.ts tests/voice-answers.test.ts tests/world-contents.test.ts tests/world-text.test.ts tests/act-track.test.ts tests/talk-grade.test.ts tests/act-say.test.ts tests/act-look.test.ts CLAUDE.md
git commit -m "refactor(act,world): stop asking the user whether a cup is empty and drop the spoken contents answer path"
git push origin refactor/domain-split
```

### Task 13: 검사 고침 둘 (Codex check.ts:82·:54)

**Files:**
- Modify: `src/act/tasks.ts` `planObjectsOf`: 계획에 적힌 `${cls}_N` id는 World State에 없어도 넣는다(없는 컵을 「없음」으로 막으려고).
- Modify: `src/act/check.ts`
  - `checkPlan`: 계획이 다루는 컵마다 없음(`no_target`)·치움(`in_sink`)·낡음(`stale`)·들고 있음(`in_hand`)을 본 뒤 내용물을 본다.
  - `checkDecision`: `want` 후보를 `o.status === "present" && fresh(o)`로 좁힌다.
- Test: `tests/act-check.test.ts`(이미 써 둔 두 시험, 커밋 안 함)

- [ ] **Step 1: 실패를 본다** — `npm run heavy -- npx vitest run tests/act-check.test.ts` → 두 시험 FAIL(둘째 컵 검사 없음, 오래된 시야 밖 빈 컵으로 통과)
- [ ] **Step 2: 고친다.** 컵마다 도는 검사는 첫 컵과 같은 함수 하나로 묶는다. 들고 있음의 `carried` 갈래는 첫 컵 그대로 둔다.
- [ ] **Step 3: PASS를 본다** — `tests/act-check.test.ts`, `tests/act-track.test.ts`
- [ ] **Step 4: 커밋·푸시**

```bash
git add src/act/tasks.ts src/act/check.ts tests/act-check.test.ts
git commit -m "fix(act): check presence, put-away, staleness and hands on every cup a plan pours into, and take only present fresh cups as pre-plan contents candidates"
git push origin refactor/domain-split
```

### Task 14: 위에서 본 사진 (World State)

**Files:**
- Modify: `src/world/place.ts`

```ts
/** 컵 안이 보임 판정의 컵 모양(안 반지름·깊이 m). 정한 것 3의 근거. */
export const TOP_CUP_M = { radius: 0.035, depth: 0.1 } as const;
/** 컵 자리가 화면 가운데(NDC |x|·|y| ≤ center)여야 한다. */
export const TOP_VIEW = { center: 0.5 } as const;
/** 위에서 보기 상자: 컵 자리(바닥 가운데)에 세운 원기둥(반지름·높이 m). */
export const TOP_BOX_M = { radius: 0.05, height: 0.12 } as const;
/** 이 카메라가 point(컵 바닥 가운데)에 놓인 TOP_CUP_M 컵의 안을 보는가: 테두리보다 높고, 입구 바로 위이거나 먼 쪽 안벽 바닥 모서리가
 *  가까운 테두리 위로 보이고, 컵 자리가 화면 가운데다. 카메라 뒤면 false. */
export function topView(view: CameraView, point: V3): boolean;
/** point에 세운 TOP_BOX_M 원기둥 꼭짓점 16개를 찍은 엔진 프레임 픽셀 상자 [x, y, w, h]. 하나라도 카메라 뒤면 null. */
export function topBox(view: CameraView, point: V3, size: { width: number; height: number }): [number, number, number, number] | null;
```

  - d = 카메라 origin과 point의 수평 거리, H = origin 높이 − point 높이(트윈 y가 높이), r·h = `TOP_CUP_M`.
  - 판정: `H > h && (d <= r || H * 2 * r >= h * (d + r))`, 그리고 NDC 가운데.
- Modify: `src/world/state/contents.ts`

```ts
/** 위에서 본 사진의 시간 조건: 서로 다른 원본 프레임 2장, 처음과 마지막 1.5초 이상, 이웃 공백 6초 이하. 준비 판정(관찰 흐름 topReady)과
 *  확인 판정(ContentsBook)이 이것 하나를 쓴다. 정한 것 5의 근거. */
export const TOP_CONFIRM = { photos: 2, spanMs: 1500, gapMs: 6000 } as const;
/** 촬영 시각 목록(아무 차례)에서 TOP_CONFIRM을 채우는 쌍: 가장 새 것과, 그보다 spanMs 이상·gapMs 이하로 앞선 것 중 가장 새 것. 없으면 null. */
export function topPairOf<T extends { at: number }>(xs: readonly T[]): [T, T] | null;
```

  - `Photo`에 `top: boolean`을 둔다. `sure`에는 `top: boolean`(위에서 본 쌍으로 확인했는가)을 둔다.
  - `see(obj, frameId, atMs, value, crop, top = false)`:
    - 불투명이 확인된 컵은 `top`이 아니면 버린다. `top` 답은 늘 `crop`이다.
    - 옆·위 사진 전체의 최신 묶음이 `CONTENTS_CONFIRM`를 채우면 지금 규칙대로다.
    - 같은 값의 최신 위 사진 쌍(`topPairOf`)이 있으면:
      - 확인 값이 없거나, 옆 사진으로 정한 것이면(창과 상관없이) 그 값으로 확인한다(`top: true`, 이전 값 보관, 세대 +1, 판단 계기 줄).
      - 확인 값이 위에서 정한 것이면 지금 규칙(같으면 이어 감, 반대면 후보 충돌, 창 안이면 바꿈)이다.
  - 불투명이 확인되면(`settle` 때 몸통 면을 봄) 옆 사진으로 정한 확인 값을 거둔다(보관, 세대 +1).
  - `effective`: 불투명이 확인됐고 확인 값이 없으면 「안이 안 보임」(확인됨)이다. 위에서 확인한 값이 있으면 그 값이다.
- Modify: `src/world/state/world.ts`
  - `applyTop(objectId, frameId, capturedAtMs, value)`:
    - 대상 확인을 거친 장의 내용물 값 하나를 `see(..., crop: true, top: true)`로 넣는다.
    - 그 컵의 마지막 본 때·시야 안 때를 `capturedAtMs`로 올리고(더 새 것만), 지킴(`closerAt`)을 다시 건다.
    - 물건이 없거나 사라졌으면 빈 목록을 돌려준다. 다른 면은 넣지 않는다.
  - `guard(objectId, atMs)`: 그 컵에 지킴(`closerAt`)을 건다. 물건이 없으면 아무것도 하지 않는다.
- Modify: `src/world/index.ts`(`topView`·`topBox`·`TOP_CUP_M`·`TOP_VIEW`·`TOP_CONFIRM`·`topPairOf` 내보냄)
- Test: `tests/world-top.test.ts`(새로), `tests/world-contents.test.ts`

- [ ] **Step 1: 실패하는 시험**
  - `topView`:
    - 바닥 위 40cm·수평 15cm에서 컵을 바라보면 참이다.
    - 수평 8cm·바닥 위 13.9cm면 거짓이다(Codex 반례, 내려다보는 각 60°지만 테두리가 가림).
    - 바닥 위 35cm면 수평 20cm는 참, 25cm는 거짓이다.
    - 입구 바로 위(수평 2cm·위 30cm)는 참이고, 테두리보다 낮으면 거짓이다.
    - 컵이 NDC 0.6이거나 카메라 뒤면 거짓이다.
  - `topBox`: 바로 위에서 본 상자는 가운데를 감싼다. 카메라 뒤면 null이다.
  - `topPairOf`:
    - 0초·2초면 쌍이다. 0초·1초는 아니다.
    - 0초·10초도 아니다(공백 6초 넘음).
    - 0초·7초·9초면 7초·9초 쌍이다.
  - 불투명이 확인된 컵:
    - 옆 사진 3장·4초는 버린다(「안이 안 보임」 확인됨).
    - `applyTop` 0초·2초 「비어 있음」이면 확인됨이다(세대 +1, 판단 계기 줄).
    - 한 장, 1초 간격, 10초 간격은 확인이 아니다.
  - 속이 비치는 컵: 위 두 장으로도 확인된다. 옆 3장·4초 규칙도 그대로다.
  - 옆 사진으로 「내용물 있음」이 확인된 컵:
    - 창 밖에서도 위 두 장 「비어 있음」이면 비어 있음으로 바뀐다(이전 값 보관, 세대 +1).
    - 그 뒤 옆 사진 「내용물 있음」 3장·4초는 바꾸지 않는다(후보 충돌로 짐작).
  - 옆 사진으로 확인된 값은 불투명이 확인되면 거둬진다(세대 +1, 보관).
  - 마시기 사건은 위에서 확인한 값도 다시 연다.
  - `applyTop`은 마지막 본 때를 올리고 지킴을 건다. 자리·다른 면은 바꾸지 않는다.
  - `guard` 뒤 전체 사진에서 6초 넘게 못 봐도 사라지지 않는다.
- [ ] **Step 2: FAIL을 본다** — `tests/world-top.test.ts`, `tests/world-contents.test.ts`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: PASS를 본다** — 두 파일, 이어서 `tests/world-state.test.ts`·`tests/world-closer.test.ts`
- [ ] **Step 5: 커밋·푸시** — `feat(world): judge whether a camera sees inside a cup, confirm contents from two top-down photos over side photos and guard the cup while it is viewed from above`

### Task 15: 위에서 보기 (관찰 흐름 · 보기 담당)

**Files:**
- Modify: `src/observe/pipeline.ts`

```ts
/** 위에서 본 VLM 프레임 쌍: sinceMs 뒤에 찍혀 카메라가 있고 position의 컵 안을 보는(topView) VLM 프레임 중 topPairOf(TOP_CONFIRM 시간 조건). 없으면 null. */
private topPair(position: V3, sinceMs: number): [EngineFrame, EngineFrame] | null;
/** 위에서 비추기 단계가 끝났는가(실행 추적이 본다): 쌍이 있다. */
topReady(position: V3, sinceMs: number): boolean;
/** 위에서 보기 한 번(정한 것 7). 결과는 CloserResult(found는 그 컵 하나, frames 2). */
async topLook(spot: LookSpot, sinceMs: number, signal?: AbortSignal): Promise<CloserResult>;
```

  - `topLook` 차례:
    1. 쌍이 없거나 가장 새 장이 closerStaleMs보다 낡았으면 `no_fresh_frames`다.
    2. 시작 때 컵의 트윈 자리를 적는다.
    3. 쌍의 두 장을 촬영 순으로 본다. 장마다:
       - 컵 자리를 가운데로 잘라(`cropBox`) YOLO로 본다.
       - VLM 가까이 보기 자리에 보낸다(감지는 d1 하나, `topBox`를 잘라 낸 칸 픽셀로 옮긴 상자, 종류는 그 물건 종류, 글은 `TOP_NOTE`).
       - 답이 오면 정한 것 7의 차례로 거른다.
       - 컵이 옮겨졌으면(`moved`) 그 뒤 장도 넣지 않고 끝낸다.
       - 거른 답의 내용물 값을 `world.applyTop`으로 넣고 방송한다.
  - 기록·결과에는 장마다 넣었는지, 버렸으면 그 까닭(not_visible·값 없음·그릇 없음·다른 물건·옮겨짐)을 싣는다.
- Modify: `src/observe/scene.ts`(`TOP_NOTE`: 「This photo is the cup seen from above, cut out and enlarged 2x. d1 is where the cup should be. If d1 holds no cup, answer not_visible for d1.」), 가까이 보기 자리 풀(`pool.submitCloser`)이 글을 받게 한다.
- Modify: `src/observe/crop.ts`(`toCropBox(box, crop, out)`: 엔진 프레임 상자를 잘라 키운 사진 픽셀로, `toFrameBox`의 거꾸로)
- Modify: `src/contract/events.ts`(`CloserMiss`에 `moved`, 결과에 장마다 버린 까닭)
- Modify: `src/act/look.ts`
  - `LookerOptions.topLook`을 둔다.
  - `ContentsLook.top?: { sinceMs: number }`를 받는다.
  - `contents(h)`에 `h.top`이 있으면 `objectGapMs`를 보지 않고 `topLook`을 부른다. B가 관찰 모드를 부르는 중이면 A처럼 끊고 먼저 돈다.
  - 기록은 look 하나다(계기 `unknown_fact`, 목표 `LOOK_TEXT.above(이름)` 「컵 안을 위에서 봄」, 결과 글은 가까이 보기와 같다).
- Modify: `src/act/labels.ts`(`LOOK_TEXT.above`, `LOOK_TEXT.miss.moved`)
- Test: `tests/observe-pipeline.test.ts`(또는 가까이 보기 시험 파일), `tests/act-look.test.ts`

- [ ] **Step 1: 실패하는 시험**
  - `topReady`:
    - 컵 안을 보는 VLM 프레임 0초·2초면 참이다.
    - 0초·1초, 0초·10초는 거짓이다(`topPairOf`와 같은 답).
    - 빠른 프레임(`vlm: false`)만이면 거짓이다. sinceMs 앞 프레임은 세지 않는다.
  - `topLook`:
    - 가짜 VLM에 두 번 보낸다. 요청의 감지는 d1 하나이고 상자가 잘라 낸 사진 안이며 글이 `TOP_NOTE`다.
    - 두 답이 들어가 불투명 컵이 확인되고, 컵의 마지막 본 때가 둘째 장 촬영 시각이다.
    - 걸러지는 장:
      - d1에 not_visible이 있으면 내용물 값이 같이 와도 버린다.
      - 내용물 값이 없으면 버린다.
      - 잘라 본 사진에 그릇 감지가 없거나 상자 밖이면 버린다.
      - 0.1m 안에 다른 컵이 있으면 버린다.
      - 첫 답 뒤 컵 자리가 0.2m 옮겨졌으면 둘째 장을 넣지 않고 `moved`다.
    - YOLO 감지로 새 물건을 만들지 않는다(그릇으로 잡혀도).
    - 쌍이 없으면 `no_fresh_frames`다.
  - `Looker.contents({ top })`:
    - 30초 안에 본 컵도 본다.
    - B 관찰 모드 호출을 끊는다.
    - look 기록 하나를 남긴다.
- [ ] **Step 2: FAIL을 본다**
- [ ] **Step 3: 구현한다.** VLM 자리 경쟁은 `pool.submitCloser` 하나로 한다.
- [ ] **Step 4: PASS를 본다** — 두 파일
- [ ] **Step 5: 커밋·푸시** — `feat(observe,act): look at a cup from above with two checked top-down frames and only the target box`

### Task 16: 보류의 가까이 가서 보기

**Files:**
- Modify: `src/contract/phone-version.ts`(`PhoneProtocol = 4`, 판본 줄 「4: 명령에 near_m·view를 싣는다」), `src/phone/protocol.ts`·`ui/src/phone/protocol.ts`(4), 판본을 보는 시험
- Modify: `src/contract/phone.ts`

```ts
/** go 명령이 끝나는 폰-대상 수평 거리(m, 가까이 가서 보기). 영상 모드는 그 안까지 걷는다. 없으면 보통 go. */
near_m?: number;
/** above: 대상을 위에서 내려다보는 do 명령. 영상 모드는 폰을 대상 위로 옮긴다. */
view?: "above";
```

- Modify: `src/act/labels.ts`

```ts
/** 가까이 가서 보기 명령(사람에게 하는 말, 「주세요」로 끝남). */
export const PEEK_TEXT = {
  go: (name: string) => `${name} 가까이 가 주세요`,
  above: (name: string) => `${name} 안이 보이게 위에서 비춰 주세요`,
} as const;
```

- Modify: `src/act/track/contents.ts`
  - 차례는 `look → looking → settle → peek → seeing → after → over`다.
  - 불투명 컵은 `look`·`settle` 없이 `peek`로 간다.
  - `PEEK = { nearM: 0.5, stepMs: 30_000, retryMs: 60_000 }`.
  - `Peek { part: "go" | "above"; seq: number; since: number; sent: PlannedCommand }`(`Hold.peek`).
  - `peekStep(objectId, gen, part, seq)` = `peek:<컵>:<세대>:<part>:<번호>`.
  - **peek 차례(tick마다):**
    - 막히면 명령을 보내지 않는다. 떠 있으면 `steps.clear(r)` 뒤 `command_clear`(계획 id)로 거둔다.
      - 막는 것: 위치 전·판본이 맞는 폰 없음·끄기 안내·승인 대기·폰 대화·`r.asking`.
      - 컵이 사라짐·자리 모름·손에 있음·사람이 그 종류를 듦도 막는다.
    - 막힌 채 `holdMs`가 지나면 `over`다.
    - 컵이 보이고 그 컵·세대를 `retryMs` 안에 본 적이 있으면 바로 `over`다.
    - 폰 눈과 컵 수평 거리가 `nearM` 밖이면 go 명령을 보낸다(종류 go, `near_m`, 대상 그 컵, 단추 없음, 소리로 읽기).
    - 안이면 above 명령을 보낸다(종류 do, `view: "above"`).
    - 비전 줄은 go면 `VISION_TEXT.distance(이름, m)`, above면 `이름 · 지금 내용물 값 글`이다.
    - go가 끝나면(안으로 들어옴) 새 번호로 above를 보낸다. above를 보낼 때 `guardObject(컵)`(World State `guard`)를 부른다.
    - 컵이 옮겨지면(트윈 자리가 peek를 시작한 때보다 0.1m 넘게 바뀜, 옮김 표시, 사라짐) 떠 있는 명령을 거두고 처음부터 한다.
    - above가 끝나면(`topReady(컵 자리, above 보낸 때)`) 명령을 거두고 `seeing`으로 가서 `lookContents({ ..., top: { sinceMs } })`를 부른다(받지 않으면 다음 tick). `done`이면 `after`로 간다.
    - 명령마다 `stepMs`가 지나면 거두고 `over`다.
    - `repeatMs`마다 소리로 다시 읽는다.
  - **after:**
    - `settleMs` 뒤에도 실행 전 검사가 `unknown_contents`면 `over`다(계획은 「대상 물건 안을 몰라 실행하지 않아요」로 닫힘). 그 컵·세대를 기억한다(`retryMs`).
    - 검사가 낡음(`stale`)이면 위에서 본 때부터 `holdMs` 동안 기다린다. 사람이 폰을 내려 컵이 다시 보이면 시작하고, 지나면 낡음으로 닫는다.
  - 확인되면 `tryStart`가 `release`하고 첫 단계 명령이 그 명령 줄을 덮는다(지우기를 보내지 않는다).
  - 보류에서 풀린 계획은 폰 대화·승인 대기가 없을 때만 첫 명령을 보낸다(`start.ts`). 있으면 tick마다 다시 보고, 미룬 지 `holdMs`가 지나면 `EXEC_TEXT.phoneBusy` 「폰을 쓰는 중이라 실행하지 않아요」로 닫는다.
  - 세대가 바뀌면 처음부터 한다.
- Modify: `src/act/track/tracker.ts`
  - 옵션 `topReady?: (position: V3, sinceMs: number) => boolean`을 둔다. 없으면 above가 끝나지 않는다.
  - 옵션 `guardObject?: (objectId: string) => void`를 둔다.
  - `lookContents`의 `top`을 넘긴다.
- Modify: `src/act/track/answers.ts`
  - peek 명령은 「완료」를 받지 않는다(단추 없음).
  - 「그만」은 지금처럼 계획을 그만둔다.
- Modify: `src/server/home/act.ts`(`topReady: (p, t) => observe.topReady(p, t)`, `guardObject: (id) => world.guard(id, now())`)
- Test: `tests/act-track.test.ts`

- [ ] **Step 1: 실패하는 시험**(가짜 World State·가짜 `topReady`)
  - 불투명 컵·물 채우기:
    - 붙잡은 뒤 첫 명령이 「컵 가까이 가 주세요」다(종류 go, `near_m` 0.5, `choices` [], 대상 컵).
    - 폰 눈이 0.6m면 그대로다. 0.4m면 「컵 안이 보이게 위에서 비춰 주세요」(종류 do, `view` above)다.
    - `topReady`가 참이 되면 명령을 거두고 `lookContents`가 `top.sinceMs`(above 보낸 때)로 불린다.
    - World State가 확인되면 첫 계획 단계 명령이다.
  - 처음부터 0.5m 안이면 go 없이 above부터 보낸다.
  - 위에서 본 뒤에도 모르면:
    - `settleMs` 뒤 계획이 실패로 닫힌다(`unknown_contents`).
    - 보낸 명령 어디에도 「?」가 없다.
    - 같은 컵·세대의 새 계획은 60초 안에 가까이 가지 않고 바로 닫힌다.
  - 폰 대화가 시작되면 떠 있는 go를 거둔다(`command_clear`). 끝나고 10초 뒤 새 번호의 step으로 다시 보낸다.
  - 승인 대기·끄기 안내 중에는 보내지 않는다.
  - go 명령이 30초 안에 끝나지 않으면 닫힌다.
  - above를 보낸 뒤 컵이 0.2m 옮겨지면 명령을 거두고 go부터 다시 한다.
  - above를 보낼 때 `guardObject`가 그 컵으로 불린다.
  - 위에서 본 뒤 확인됐지만 낡음이면 기다린다. 컵이 다시 보이면 첫 명령이다. 30초가 지나면 낡음으로 닫는다.
  - 확인 뒤 폰 대화 중이면 첫 명령을 미룬다. 대화가 끝나고 10초 뒤 보낸다. 30초 넘게 막히면 「폰을 쓰는 중이라 실행하지 않아요」로 닫는다.
  - 보내는 peek 명령에 `near_m`·`view`가 실리고, 폰 판본이 4다.
  - 명령 글이 모두 「주세요」로 끝난다.
- [ ] **Step 2: FAIL을 본다** — `tests/act-track.test.ts -t "가까이 가서"`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: PASS를 본다** — `tests/act-track.test.ts`(조정자 허락 또는 3GB), `tests/talk-grade.test.ts`, `tests/act-say.test.ts`
- [ ] **Step 5: 커밋·푸시** — `feat(act): send the phone closer to an unknown cup and over it, then look from above before giving up on a held plan`

### Task 17: 계획 밖 가까이 가서 보기

**Files:**
- Modify: `src/act/track/contents.ts`
  - `idlePeek()`(tick)를 둔다. 정한 것 9의 때에 Task 16과 같은 차례(go → above → seeing → after)를 계획 밖 칸 `TrackCore.idlePeek`(명령 id `peek:<번호>`)로 돈다.
  - 막는 것이 생기면 거둔다. 막는 것: 계획 시작·만드는 계획·코치·대화·끄기 안내·승인 대기·사람 안 보임·컵 사라짐·확인됨·세대 바뀜.
  - 계획 명령이 그 자리를 덮었으면 지우기를 보내지 않는다.
  - after 뒤에는 칸을 비운다. 모르면 그 컵·세대를 `retryMs` 동안 다시 가지 않는다(보기 기록만 남음).
  - 확인되면 World State 변화가 다음 PAM 판단의 계기다.
- Modify: `src/act/look.ts`(`looked` 옵션: B가 잘라 본 컵, 자원 사정으로 못 본 것은 빼고), `src/act/track/tracker.ts`(`lookedIdle`, stop 때 비움)
- Modify: `src/act/track/answers.ts`(계획이 없고 `idlePeek`가 떠 있으면 「그만」이 그것을 거두고 그 컵을 `retryMs` 동안 쉰다)
- Modify: `src/server/home/act.ts`(`looked` 배선)
- Test: `tests/act-track.test.ts`, `tests/act-look.test.ts`

- [ ] **Step 1: 실패하는 시험**
  - 불투명 컵이 보이고 행동 목록에 물 채우기가 있으면, 계획 없이 「컵 가까이 가 주세요」(id `peek:1`)를 보낸다.
  - 사람이 안 보이거나, 위치 전이거나, 행동 목록에 내용물 행동이 없으면 보내지 않는다.
  - 속이 비치는 컵은 B가 그 세대에 잘라 본 지 4초 뒤에만 보낸다.
  - 계획이 열리면 거둔다(계획 명령이 덮었으면 지우기 없음). 대화가 시작되면 거둔다(지우기).
  - 위에서 본 뒤 확인되면 칸이 비고, 다음 tick에 다시 보내지 않는다.
  - 모르면 60초 동안 다시 보내지 않는다.
  - 「그만」이면 거둔다.
- [ ] **Step 2~4: FAIL → 구현 → PASS**
- [ ] **Step 5: 커밋·푸시** — `feat(act): go closer and look from above at an unknown cup when no plan is open instead of waiting`

### Task 18: 영상 모드 자세

**Files:**
- Modify: `ui/src/phone/core/video-math.js`

```js
/** 위에서 비추기 자세: target에서 지금 자리 쪽으로 수평 backM, 높이 target + upM. 그 자리와 target을 바라보는 yaw·숙인 각. */
export function aboveGoal(position, target, backM, upM) { /* { goal, yaw, pitchDeg } */ }
```

- Modify: `ui/src/phone/core/video-ar.js`
  - `NEAR_WALK = 0.8`, `ABOVE = { backM: 0.15, upM: 0.4 }`.
  - 단계 영상으로 바꿀 때 go면 `cmd.near_m`이 있을 때 `min(WALK_STOP_M, near_m × NEAR_WALK)`까지 걷는다. do면 `cmd.view === "above"`일 때 `aboveGoal` 자세로 옮긴다.
  - `commandClear(id)`: 그 명령(id가 없으면 모두)의 예약된 영상 바꾸기 타이머를 지우고 걷기를 멈춘다. 자세는 그대로 둔다.
  - 머리 설명 줄과 갈래 줄에 `영상 모드: 자세 흉내`를 단다.
- Modify: `ui/src/phone/core/ar.d.ts`(`PhoneAr.commandClear?(id?: string): void`), `ui/src/phone/controller.ts`(`command_clear`를 받으면 `ar.commandClear?.(m.id)`, 영상 갈래 없이)
- Test: `ui/tests/video-math.test.ts`(또는 있는 영상 수학 시험), `ui/tests/video-ar.test.ts`
  - `aboveGoal`: 수평 0.15m·위 0.4m, 숙인 각 69°다.
  - go `near_m` 0.5면 0.4m 앞에서 멈춘다. 없으면 0.6m다.
  - do `view` above면 그 자세다. 없으면 그 자리에서 바라본다.
  - 단계 영상 `step=go:cup:a.mp4`·`step=do:cup:b.mp4`가 두 명령에 하나씩 바뀐다.
  - go 명령을 받고 반응 시간 전에 `command_clear`가 오면 영상을 바꾸지 않고 걷지 않는다. 걷는 중에 오면 그 자리에 멈춘다.
  - controller가 `command_clear`를 AR에 넘긴다(`ui/tests/phone-mode-parity.test.ts`·`tests/video-mode-parity.test.ts` PASS).


- [ ] **Step 1~4: FAIL → 구현 → PASS**
- [ ] **Step 5: 커밋·푸시** — `feat(phone): walk to the go command's near distance and hold the phone over the target for an above command in video mode`

### Task 19: 문서와 전체 검증

- [ ] **Step 1: `docs/reference.md`를 고친다**
  - 내용물 질문 문장을 뺀다.
  - 넣는 것:
    - 가까이 가서 보기(두 명령, 끝 판정, 위에서 보기, 모르면 닫거나 기록)
    - 위에서 본 확인 기준과 불투명 컵 규칙
    - 계획 밖 가까이 가서 보기 때
    - 영상 모드 `near_m`·`view`
- [ ] **Step 2: 데모 e2e 네 개를 하나씩 돌린다** — `tests/demo-e2e.test.ts`, `tests/noonchi-e2e.test.ts`, `tests/coach-e2e.test.ts`, `tests/cup-branches-e2e.test.ts`. 모두 PASS여야 한다.
- [ ] **Step 3: 전체 검증** — `npm run heavy -- npm run typecheck`, `npm run heavy -- npm run lint`, `npm run heavy -- npm test`(3GB 넘을 때). 실패는 원인을 확인한다. 흔들리는 시험은 다시 돌려 본다.
- [ ] **Step 4: 커밋·푸시** — `docs: describe going closer and looking from above at a cup whose contents are unknown`
- [ ] **Step 5: 구현명세서 바꿀 곳 목록을 보고한다**(고치지 않는다)

## Self-Review

- 정한 것 1(묻지 않음): Task 12(걷어 냄, 「?」 없음 시험), Task 16·17(모르면 닫거나 기록).
- 정한 것 2·3·4(두 명령·안이 보임·0.5m): Task 14(`topView`), 15(`topReady`), 16(명령·끝·옮겨지면 다시).
- 정한 것 5·6(시간 조건 한곳·옆 확인을 대신함·불투명): Task 14.
- 정한 것 7(대상 확인·not_visible 먼저 거절·옮겨지면 취소): Task 15.
- 정한 것 8(걷게 하지 않는 때·보류에서 풀린 첫 명령): Task 16·17.
- 정한 것 14(위에서 볼 때 보임·지킴·다시 보기): Task 14·16.
- Codex 설계 검토(3e64006, P2 여덟):
  1. 합성 상자 대상 확인 → 정한 것 7, Task 15.
  2. 위 관측의 보임·재검사 → 정한 것 14, Task 14·16.
  3. 옆 확인을 위 확인이 대신함 → 정한 것 6, Task 14.
  4. 테두리를 본 시야 조건 → 정한 것 3, Task 14.
  5. 확인 뒤 첫 명령의 대화 사용권 → 정한 것 8, Task 16.
  6. 준비·확인 시간 조건 한곳 → 정한 것 5, Task 14·15.
  7. 폰 판본 4 → 정한 것 10, Task 16.
  8. 지우기 때 영상 전환·걷기 취소 → 정한 것 10, Task 18.
- 정한 것 9(계획 밖): Task 17.
- 정한 것 10(영상 모드): Task 16(`near_m`·`view`), 18.
- 정한 것 11·12(검사): Task 13.
- 남기는 것(말 답 고침·말 답 시험·규칙 표 줄·대화 세기·확인 규칙·사건·불투명 면·조건·검사·따르기 창): Task 12 목록.
- 규칙 표 새 줄(처음 바로잡힘, 막는 장치 없음): Task 12.
