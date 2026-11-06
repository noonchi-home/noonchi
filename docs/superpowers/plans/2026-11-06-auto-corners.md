# 벽 하나로 A·B 구석 자동 채우기 Implementation Plan

**Goal:** 폰 기준점 설정에서 벽 하나만 누르면 A(그 벽의 가까운 구석)와 B(맞은편 벽의 대각선 구석)를 채운다. 저장은 지금처럼 `POST /api/phone/touch-points`.

**Architecture:** 구석 계산은 서버 순수 함수 하나(`src/phone/corners.ts`)가 맡는다. 서버는 집 `scene.json`의 `plan.rooms`·`plan.walls`를 한 번 읽고, `POST /api/phone/touch-points/auto`가 저장 없이 A·B를 돌려준다. 화면은 버튼 하나로 뷰어 `startPick` 결과를 보내고 받은 점을 핀·거리로 보인다.

**Tech Stack:** TypeScript·zod·Vitest(루트), React·Testing Library(ui). 새 의존성 없음.

**Spec:** 이 문서. 벽 대기 맞춤은 `2026-11-04-phone-wall-touch.md`.

## 정한 것

- 방 다각형은 벽 중심선이다(목련 `ar_anchors` alpha_corner `[0.1, 6.066]` = 중심선 구석 + 두께 절반). 구석은 방 쪽 면끼리 만나는 점이다. 면은 뷰어 `snapToWall`과 같다: 벽은 중심선 + 법선 × 두께/2, 고체(샤프트·기둥)는 법선이 같은 다각형 변.
- A: 고른 면(같은 줄에 이어진 같은 방 면 포함)을 따라 양쪽으로 가다 처음 만나는 같은 방의 다른 면과의 교점. 면이 끝날 때까지 못 만나면(열린 경계) 그쪽은 구석이 없다. 두 쪽 중 P에 가까운 것.
- 뷰어는 점을 벽 중심선 끝까지 붙이므로 P가 구석을 지나 옆 벽 두께 속일 수 있다. 그러면 그 구석이 A다. 맞은편을 찾는 선은 A에서 구석 사이 쪽으로 5cm 들어간 곳에서 쏜다. 그래야 구석 가까이 눌러도 B가 옆 구석이 아니라 대각선 구석이 된다.
- B: P에서 안쪽 법선으로 쏜 선이 방 다각형을 나가기 전에 처음 닿는, 이쪽을 보는 같은 방 면이 맞은편 벽이다. 그 면의 구석(A와 같은 방법) 중 A에서 먼 것.
- A를 못 찾거나 A가 집 범위 밖이면 점 없음: 화면은 그대로 두고 다른 벽이나 손으로 고르라고 알린다.
- 맞은편 벽이 없거나, A–B가 0.5m 미만이거나, `parseTouchPoints`(집 범위)가 거절하면 A만 준다. B는 비우고 손으로 고르게 한다.
- 고른 결과에 방·법선이 없으면 P에 가장 가까운 면에서 정한다. 뷰어 좌표는 mm 반올림이라 면 맞춤은 1cm까지 본다.
- 방은 힌트로만 쓴다. 여러 방이 같은 쪽을 쓰는 벽(목련 E10은 네 방)에서 뷰어는 첫 방을 보내므로, 누른 점 바로 안쪽이 든 방으로 정한다. 두 방 경계 위(열린 경계, 사이 벽 속)라 둘 다 들면 보낸 방을 따른다.
- 이름: A "<방 이름> 구석", B "<방 이름> 맞은편 구석". 40자를 넘으면 방 이름을 자른다. 방 이름이 없으면 비워 둔다(저장하면 "A 지점").
- 화면: "벽 하나로 A·B 고르기" 버튼 하나를 더한다. A·B 줄의 "3D에서 고르기"는 지금처럼 손으로 고른다(가구가 구석을 가릴 때).

## Task 1: 구석 계산 (`src/phone/corners.ts`)

Files: `src/phone/corners.ts`(새), `tests/phone-corners.test.ts`(새).

- [x] 작은 가짜 평면도로 시험: 네모 방 A·B, 구석 가까이·옆 벽 속을 눌러도 대각선, 열린 경계 쪽 구석 없음, 고체가 막은 구석, 두 방 경계 위는 보낸 방, 맞은편 없음 → A만, 0.5m 미만 → A만, 방·법선 없이도 같음, 이름 40자. 실패 확인 → 구현.
- [x] 실제 집 파일 시험(`../twin-studio` 세 집): 정해 둔 벽(네모 방·L자·기둥·샤프트·비스듬한 벽)에서 손으로 셈한 구석과 같은지. 모든 방의 모든 면 가운데와 양 끝을 눌러 나온 A·B가 같은 방 면 두 개가 만나는 점이고, B는 맞은편 면 위, A–B ≥ 0.5m, `parseTouchPoints` 통과.

## Task 2: REST와 시작 연결

Files: `src/server/app.ts`, `src/server/home.ts`, `tests/phone-touch-start.test.ts`.

- [ ] `POST /api/phone/touch-points/auto {home, position, room?, normal?}` → `{ok, points, distance_m}`. 저장하지 않는다. 잘못된 값 400, 다른 집 409. 실제 oneroom 집으로 시험 → 구현.
- [ ] `home.ts`는 `scene.json` plan을 한 번 읽어 범위·바닥 높이·구석에 같이 쓴다.

## Task 3: 설정 화면 버튼

Files: `ui/src/setup/PositionStep.tsx`, `ui/tests/setup-app.test.tsx`.

- [ ] 버튼을 누르고 벽을 고르면 auto를 부르고 A·B·이름·거리를 채운다. A만 오면 B를 비우고 B를 고르라고 알린다. 점이 없으면 그대로 두고 알린다. 가짜 뷰어로 시험 → 구현. `npm run lint`.

## Task 4: 검증·문서

- [ ] `npm run heavy --` 로 루트·ui 전체 시험, 루트·ui `npx tsc --noEmit`, `npm run lint`, ui 빌드.
- [ ] `docs/reference.md` 벽 대기 맞춤 사용법에 한두 줄.
