# 벽 두 지점에 폰을 대서 수평 맞추기 Implementation Plan

**Goal:** 대시보드 3D 트윈에서 벽 지점 A·B를 고르고 저장하면, 폰을 실제 그 두 벽에 대고 기록해 폰 위치·방향을 트윈에 맞춘다. 높이는 재지 않고 눈 높이 1.5m로 고정한다.

**Architecture:** 11-02 설계(`docs/designs/phone-contact-calibration.md`)의 줄인 판이다. 기존 바닥 기준점 맞춤(`PhoneSession` + `solveAlignment`)을 그대로 쓰고, 기준점만 바꾼다: 저장된 A·B가 있으면 '벽 대기' 모드, 없으면 지금의 바닥 조준 모드. 폰은 벽 대기 모드에서 조준점 대신 폰 자기 위치(viewer pose)를 보낸다. 뷰어는 클릭한 벽을 평면도 벽의 방 쪽 면으로 붙여 점을 돌려준다.

**Tech Stack:** TypeScript·zod·ws·Vitest(twin-home), three.js 뷰어 ES 모듈·`node --test`(twin-studio). 새 npm 의존성 없음.

## 정한 것

- 높이: 눈 마커 높이는 그 자리 방 바닥(`floor_z`) 위 1.5m 고정(`PHONE_EYE_HEIGHT_M`로 바꿈). 초점 고리용 바닥 높이는 기록하는 순간 조준점이 닿은 바닥 높이 평균, 없으면 기록 높이 평균 − 1.5m로 어림한다(FOCUS=1일 때만 쓰임).
- 폰 대는 법: 화면이 위로 오게 눕히고 윗모서리를 벽 지점에 댄다. 보내는 위치는 카메라 위치라 몇 cm 차이 나는 근사 맞춤이다(보정 안 함).
- 기록: 버튼을 누른 뒤 0.5초 동안의 폰 위치 평균. 10개 미만, 150ms 넘는 끊김, 3cm 넘는 흔들림, 추적 약함이면 버리고 다시 누르게 한다.
- 벽 면: 평면도 `walls[].faces`(방과 맞닿은 면만)에서 고른다. 세로 면을 누르면 그 면, 윗면이면 카메라 쪽 면. 고체(샤프트·기둥)는 같은 방향 변에 붙인다.
- AR을 새로 시작하거나 추적 원점이 다시 잡히면(reference space reset) 폰이 reset을 보내 맞춤을 버린다. 폰은 한 대로 본다.
- 저장: `runtime/homes/<집>/phone-touch.json` `{version:1, points:[{id:"A",label,position},{id:"B",...}]}`. 두 점 0.5m 이상, 집 평면 범위(방 다각형 경계 상자 + 0.3m) 안.
- 거리 차이 허용은 지금처럼 `PHONE_MAX_MISMATCH_M`(기본 0.3m).
- 저장·지우기 하면 실행 중인 폰 세션의 기준점이 바로 바뀌고(기록 초기화) 폰에 상태가 간다.
- 접촉 오프셋 프로필, 점별 높이, 따로 '적용' 단계는 만들지 않는다.

## Task 1: 기준점 저장소와 세션 모드 (twin-home)

Files: `src/phone/touch.ts`(새), `src/phone/session.ts`, `src/phone/server.ts`, `tests/phone-touch.test.ts`(새), `tests/phone-session.test.ts`.

- [x] 검사·읽기·저장·지우기, A/B 대상 만들기 테스트 → 실패 확인 → 구현.
- [x] 세션: `setTargets(targets, mode)`, 상태에 `mode`, 벽 대기 모드 눈 높이 고정, 바닥 모드는 그대로. 테스트 → 구현.
- [x] 폰 서버 `setTargets`가 연결된 폰 모두에 상태를 보낸다.

## Task 2: REST와 시작 연결 (twin-home)

Files: `src/server/app.ts`, `src/server/start.ts`, `tests/phone-touch-start.test.ts`(새).

- [x] `GET /api/phone/touch-points`, `POST /api/phone/touch-points`, `POST /api/phone/touch-points/clear`. 잘못된 값은 400.
- [x] 시작할 때 저장된 A·B가 있으면 벽 대기 모드로 폰 서버를 연다. `PHONE_EYE_HEIGHT_M`.
- [x] 끝까지: 저장 → 폰 상태가 A·B/touch로 바뀜 → 두 점 기록 → 눈 이벤트 위치·높이 1.5 확인.

## Task 3: 뷰어 벽 고르기와 표시 (twin-studio)

Files: `apartment/viewer/touch.mjs`(새), `apartment/viewer/main.mjs`, `apartment/viewer/style.css`, `apartment/viewer/test/touch.test.mjs`(새).

- [x] 순수 함수: 벽 면 붙이기(세로 면은 맞은 면, 윗면은 카메라 쪽 면), 표시 사양, 수평 거리. 테스트 → 구현.
- [x] `aptViewer.startPick(fn)`·`cancelPick()`·`setTouchPoints(points)`. 고르는 중에는 물건 선택을 하지 않고 가구는 뚫고 벽만 잡는다. Esc는 취소.

## Task 4: 대시보드·폰 화면 (twin-home web)

Files: `web/index.html`, `web/app.js`, `web/style.css`, `web/phone/phone.js`, `web/phone/index.html`.

- [x] 대시보드 3D 칸 "폰 기준점" 패널(왼쪽 아래, 고르는 동안 접힘): A·B 이름 입력, 3D에서 고르기, A–B 수평 거리, 저장·지우기. 저장된 점은 3D에 표시. 대화상자(alert 등) 쓰지 않음.
- [x] 폰: 벽 대기 모드면 안내 문구와 "A … 에 폰 윗모서리 대고 기록" 버튼, 0.5초 평균 위치를 보낸다.
- [x] 헤드리스 Chrome으로 대시보드에서 벽을 고르고 저장까지 확인.

## Task 5: 검증·리뷰·문서

- [x] `npx vitest run`, `npx tsc --noEmit`, 뷰어 `node --test`.
- [x] codex reviewer(herdr w2:p3)와 계획·코드 리뷰, 지적이 "없음"이 될 때까지.
- [x] `docs/reference.md` 폰 AR 절에 벽 대기 맞춤 사용법. 커밋은 하지 않는다.

## Task 6: 리뷰 반영 (codex reviewer)

- [x] AR 원점 epoch: 폰이 AR 세션·원점 리셋마다 새로 만들어 자세·기록·사진 헤더에 붙인다. 서버는 새 epoch면 기록·맞춤을 버리고 상태를 알리며, 버린 epoch는 기억해 늦은 자세는 무시·늦은 기록은 거절, 다른 epoch로 찍은 사진에는 위치를 붙이지 않는다(reset이 끊김으로 못 와도 안전).
- [x] 기준점 revision: 상태에 넣고, 기록에 붙여 바뀐 뒤 도착한 기록은 거절. 폰은 revision이 바뀌면 진행 중 기록을 취소.
- [x] floorY는 기준점마다 (AR 바닥 y − 그 방 floor_z) 평균. 바닥 조준 모드도 같게.
- [x] touch 바닥 후보는 위를 보는 수평면(법선 y > 0.9)이고 폰보다 0.9m 이상 아래일 때만(폰·서버 둘 다 검사).
- [x] CCTV 보기에서 startPick을 켜면 위에서 보는 화면으로 돌아가 고른다. 고르는 중 CCTV를 켜면 고르기 취소.
