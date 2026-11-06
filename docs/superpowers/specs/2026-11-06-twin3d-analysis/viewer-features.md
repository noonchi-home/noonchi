# viewer-features: twin-studio 뷰어 기능과 React 렌더러로 옮기는 방법

대상: `twin-studio/apartment/viewer/`(브랜치 feat/viewer-wall-touch, 최근 커밋 41f9589). 사용처: `twin-home-glass`(feat/glass-ui), `twin-home-mode`(feat/control-mode).

## 0. 결론

- 뷰어 코드 3,452줄 중 **순수 모듈 8개(states·walls·plan·layout·cctv·eye·touch·scene + live.mjs의 createLiveSync)는 TS로 그대로 옮긴다.** three·DOM을 안 쓰고 node 시험 102개가 있다(GLB 계약 검사 6개는 따로). 시험도 같이 vitest로 옮긴다.
- **main.mjs(1,587줄)는 다시 만든다.** 렌더러·카메라·벽 보이기 적용·빛 풀·CCTV·마커·벽 고르기 레이캐스트가 한 파일에 섞여 있어 스펙 11절 책임 분리와 맞지 않는다. 규칙은 순수 모듈에 있으니 새 렌더러는 그 규칙을 부르는 얇은 층이 된다.
- **twin-home이 지금 실제로 부르는 aptViewer 멤버는 16개**(타입에만 적힌 scene·setFocus·renderNow 빼고). 대시보드(React)는 iframe 안 뷰어에서 카메라·노드·보기 상태만 읽어 말풍선 자리를 잡고, 설정(옛 `web/setup/setup.js`)은 `startPick`·`cancelPick`·`setTouchPoints` 세 개만 쓴다. 상태·눈·배치·초점은 iframe 안 `live.mjs`가 따로 WebSocket을 열어 처리한다.
- **새 렌더러에서는 WebSocket을 하나로 합친다.** 지금은 대시보드 `useEvents`와 iframe `live.mjs`가 `/events`에 따로 붙는다. `live.mjs`의 메시지 규칙(되울림 방지, 신호 없음, 모르는 id·값 무시, 불러오기 끝난 뒤 순서대로 반영)은 그대로 지킨다.
- **twin-studio 뷰어는 지우지 않고 스튜디오 검사 도구로 남긴다.** 가구 옮기기(TransformControls)·배치 내보내기·`apartment_complete.glb` 대조·검사 칸·`browser-check.mjs`는 React로 옮기지 않는다.
- **새 고품질 모델(GLB)은 부품 이름 계약을 지켜야 한다.** 상태 효과는 GLB 노드의 `extras.part`·`extras.light`로 대상을 찾는다. Sketchfab·Poly Haven 모델을 그대로 넣으면 문·불빛·바람이 안 움직인다. 모델마다 `part` 이름을 붙이는 단계(twin-studio 쪽)가 필요하다.
- 계약 구멍: `{type:"layout"}`은 서버가 보내지만 `src/contract/events.ts`의 `ServerMessage`와 `ui/src/lib/messages.ts`의 KNOWN에 없다. 새 렌더러가 배치 보정을 받으려면 계약에 넣어야 한다.

분류 표기
- **옮김**: 순수 함수. TS로 그대로 옮기고 시험도 옮긴다.
- **다시**: 규칙·계약은 지키고 three.js/React로 새로 만든다.
- **대체**: React 화면이 이미 하거나 대신한다.
- **남김**: 새 렌더러로 안 옮긴다. twin-studio 뷰어에 그대로 둔다.
- **버림**: 어디에도 안 옮긴다.

## 1. 지금 twin-home에서 뷰어가 놓이는 곳

| 화면 | 넣는 방법 | 사용자에게 보이는 뷰어 UI |
|---|---|---|
| 대시보드(React, `ui/src/twin/TwinStage.tsx`) | iframe `/twin/viewer/?live=auto&embed=1`. 뜨면 `hideViewerBar`로 위 막대를 숨기고 `setBadges(false)`, `setWallMode("low")` | 캔버스만. 막대·가전 패널·오른쪽 패널·CCTV 버튼에 닿을 수 없다. 클릭하면 가구에 이동 손잡이가 붙는다(아래 2.9, 버림) |
| 설정 3단계 위치 맞추기(옛 `web/setup/setup.js`, 두 브랜치 같음) | iframe `/twin/viewer/?live=auto&embed=1&home=<id>` (`home`은 뷰어가 읽지 않음. 집을 바꿀 때 다시 띄우는 용도) | 막대가 보인다(embed라 도구·불러오기·AO·초점 방만은 숨김). 벽·방·CCTV·천장 보기·상태 배지·가전 패널 버튼에 닿는다 |
| 옛 대시보드(`web/app.js`) | 같은 iframe + 「새 창」 링크(`/twin/viewer/?live=auto`) | 새 창에서는 뷰어 전체 UI |

- 뷰어는 `/twin/viewer/`(공용 폴더)에서 `../scene.json` = `/twin/scene.json`(고른 집 산출물)을 읽는다. GLB는 `/twin/assets/…`, 실행 중 더한 객체는 `/twin/lib/assets/…`.
- three.js는 jsDelivr `three@0.186.1`(importmap). twin-home `ui`에는 `three` 의존성이 없고 `@types/three@0.187`만 있다. 새 렌더러는 `three`를 `ui` 의존성으로 넣고 판 하나로 맞춘다.
- 설정 React 이전(`twin-home-mode` control-mode Task 7 `PositionStep.tsx`)은 아직 계획 단계다. 새 렌더러가 먼저 들어가면 PositionStep은 iframe 대신 새 렌더러의 고르기 API를 쓴다.

## 2. 기능 목록과 분류

### 2.1 장면 불러오기·배치

| 기능 | 하는 일 | 데이터 | 분류 | 방법·근거 |
|---|---|---|---|---|
| scene.json + 개별 GLB(`fromScene`) | 종류마다 GLB 한 번 받고 배치마다 `clone(true)`, Group(이름 = id)에 scene.json 변환 한 번 | `objects[].asset/position/rotation/scale`, GLB 최상위 노드 이름 = 파일 이름, 항등 변환 | 다시 | 같은 규칙. 새 렌더러는 `GLTFLoader` 캐시 + 인스턴싱(같은 종류 여러 개) 검토. `assetRoot`·`applyTransform`·`indexNodes`·`uniqueAssets`는 옮김 |
| `apartment_complete.glb` 방식·위치 대조(`deviation`) | 전체 GLB 인스턴스 행렬 = scene.json인지 검사 | complete GLB | 남김 | 스튜디오 빌드 검사. 화면에 필요 없음 |
| `prepare` | 투명 재질은 그림자 안 던짐, 투명 양면은 `forceSinglePass` | 재질 | 다시 | 투명 양면이 셰이더 변형을 따로 만들어 처음 켤 때 멈추는 문제를 막는다. 같은 처리 유지 |
| `compileAsync` 미리 만들기 | 꺼진 효과 부품 셰이더까지 미리 컴파일 | - | 다시 | 처음 켤 때 몇 초 멈춤을 막는다. 유지 |
| 바닥판·배경 | 집 크기 8배 바닥판(그림자 받음), `stage.background` | `stage` | 다시 | 스펙 4.4 접지 그림자로 바꾼다 |
| `?scene=` | 다른 scene.json 열기 | URL | 다시 | 개발용 옵션으로만 |

### 2.2 가전 상태 → 3D (states.mjs, 꼭 지킴)

| 기능 | 분류 | 비고 |
|---|---|---|
| 효과 적용 `applyAttr`·`applyState`·`createContext` | 옮김 | 규칙은 3.1절 |
| 대상 찾기 `collectTargets`·`missingTargets`·`wiringStatus` | 옮김 | 연결 누락은 개발 콘솔·시험에서 보인다 |
| 라벨 `attrLabel`·`valueLabel`·`stateText`·`changeTone`·`activeDevices`·`nonDefault`·`powerValues` | 옮김 | React 말풍선·L3/L4 상세에서 그대로 쓴다 |
| 빛 풀(`buildLightPool`·`makeLight`·`placeLight`·`releaseLight`, 상한 spot 11·area 6·point 6, 동시 16) | 다시 | 빛 개수가 바뀌면 모든 재질 셰이더를 다시 만들어 10초 넘게 멈춘다. 풀 방식 유지 |
| 회전 효과 `tickSpins`(세탁기·건조기 드럼) | 옮김 | 매 프레임 dt로 부른다. 돌 때는 render-on-demand여도 계속 그려야 한다 |
| 상태 배지(CSS2D `makeBadge`·`updateBadge`) | 대체 | twin-home은 `setBadges(false)` 뒤 React `BubbleLayer`를 쓴다 |
| 바뀐 기기 말풍선(`popBubble`, 6개 넘으면 「가전 N개의 상태가 바뀌었어요」 토스트) | 대체 | 배지가 꺼지면 안 뜬다. React 말풍선 규칙(「확인한 기기에만」, twin-home CLAUDE.md 규칙 표)을 따른다 |
| 가전 패널(왼쪽)·가전 상태 패널(오른쪽)·모두 켜기/끄기 | 버림 | 대시보드에서 숨겨져 닿지 않는다. 대시보드에는 입력이 없다(스펙). 모두 켜기/끄기는 스튜디오 뷰어에 남김 |

### 2.3 실시간 동기화 (live.mjs, 꼭 지킴)

| 기능 | 분류 | 비고 |
|---|---|---|
| `createLiveSync`(state 반영·되울림 방지·신호 없음·통계) | 옮김 | 규칙은 3.2절. `viewer` 어댑터(getAttrs·getState·setState)만 새 장면에 연결 |
| `liveUrl`·`httpBase` | 버림 | 같은 출처 React라 주소 계산이 필요 없다 |
| WebSocket 연결·다시 연결(1초부터 2배, 최대 15초) | 대체 | twin-home `ui/src/lib/use-events`가 이미 연결한다. 두 번째 연결은 없앤다 |
| 메시지 줄 세우기(불러오기 끝난 뒤 순서대로) | 다시 | 연결 직후 스냅숏(hello → 모든 state → layout syncMessages)이 장면 준비 전에 온다. 버리지 말고 쌓았다가 준비되면 순서대로 반영 |
| 연결 칩·승인 알림(409 → 승인/취소 버튼, `/api/agent/confirm`·`/api/agent/cancel`, 5분) | 대체 | 대시보드에는 상태 칩(StatusPill)이 있다. 3D에서 기기를 바꾸는 입력이 없으면 승인 알림도 필요 없다. 3D 조작을 넣을 때만 같은 API로 만든다 |
| embed 스타일·가전 패널 접기·resize 보내기 | 버림 | iframe을 안 쓰면 필요 없다 |

### 2.4 폰 눈 마커 (eye.mjs)

| 기능 | 분류 | 비고 |
|---|---|---|
| `eyeTransform`(평면 → three 위치·방향, limited 판정) | 옮김 | 3.3절 |
| 원뿔 + 구 마커(깊이 검사 끔, ok 0xb9773f / limited 0x5f6368) | 다시 | Agent Visualization의 Observation 표시(스펙 9.1)로 키운다. 실제 FOV가 없으니 원뿔 폭은 「대략 방향」으로만 그린다 |

### 2.5 폰 기준점 벽 고르기 (touch.mjs + main.mjs, 꼭 지킴)

| 기능 | 분류 | 비고 |
|---|---|---|
| `planWallOf`·`wallHint`·`snapToWall`·`snapToSolid`·`touchMarkers`·`planDistance` | 옮김 | 3.4절 |
| `startPick(fn)`·`cancelPick`·`finishPick`·`pickWall`(레이캐스트) | 다시 | 레이캐스트로 벽 id를 찾는 부분만 새 장면 구조에 맞춘다 |
| A·B 핀(1.5 m 기둥 + 머리 + 이름표, A 0xe8590c, B 0x1c7ed6) | 다시 | React 이름표 + three 기둥 |

### 2.6 배치 보정 (layout.mjs, 꼭 지킴)

| 기능 | 분류 | 비고 |
|---|---|---|
| `routeLayout`·`movePatch`·`normalizeObject`·`boxSpec` | 옮김 | 3.5절 |
| `moveObject`·`addObject`·`removeObject`(빛 풀 반납 포함) | 다시 | 같은 동작. 회색 상자는 「임시 모델」로 분명히 다르게 그린다(스펙 2절) |

### 2.7 초점 고리 (setFocus)

| 기능 | 분류 | 비고 |
|---|---|---|
| `focusTargets`·`focusExpiry` | 옮김 | 받은 시각부터 `ttl_ms`(기본 8초). 컴퓨터 시계 차이를 무시하려고 `at`은 안 쓴다 |
| 파란 고리(반지름 0.42, 맥동 ±12%)·「클로이드 주목 · 이름」 | 다시 | Agent Focus Controller의 Object Focus 강조(스펙 8.3)로 합친다. 서버는 `FOCUS=1`일 때만 보낸다 |

### 2.8 카메라·방 초점·벽·천장

| 기능 | 하는 일 | 분류 | 방법·근거 |
|---|---|---|---|
| 정사영 카메라 + OrbitControls(damping) | `stage.camera.direction`(목련 [0.4545, 0.766, 0.4545], 고도 50°, 남동)으로 40 m 떨어져 봄 | 다시 | 회전 범위 제한·바닥 아래 금지·zoom to cursor가 없다(스펙 5.1·5.4) |
| 전체 맞추기(`resize` 안 `fitOrtho(home.box, margin 1.06)`) | 집 상자 8개 꼭짓점을 카메라 축에 투영해 세로 길이 결정 | 옮김(`fitOrtho`) + 다시 | 이미 「카메라 방향 + 화면 비율」 방식이라 스펙 5.2와 맞는다. 집 상자는 방 다각형 외곽 + 천장 높이. 가려지는 화면(패널)은 지금 `.panel` 폭으로 빼는데, 새로는 React가 「쓸 수 있는 화면 영역」 사각형을 넘긴다 |
| `focusRoom(id)` | 방 상자(`roomBox`, margin 1.25)로 target·zoom 계산, 650 ms easeInOutQuad로 target·zoom만 보간, 새 명령이 오면 앞 것을 끝냄 | 다시 | 회전 보간·전환 중 대상 변경 매끄럽게·사용자 조작과 충돌 처리가 없다(스펙 5.3). 방 id·`plan.rooms` 기반은 유지 |
| 초점 방만(`isolate`, `focusVisible`) | 초점이 있으면 다른 방 물건 숨김. 구조·초점 방과 맞닿은 문·창(`openingRooms`)은 남김 | 옮김 | Semantic Zoom L2 「다른 공간은 맥락만」에 쓴다. 완전 숨김 대신 흐리게 할지는 설계에서 정함 |
| 벽 모드(`full`·`auto`·`low`, `wallVisibility`·`upperVisible`) | 벽을 1.05 m 아래(lower)·위(upper)로 나눠 위쪽만 숨김. auto는 카메라를 향한 바깥벽과 초점 방 뒤쪽 벽만 세움. 카메라가 돌면 다시 계산 | 옮김 + 다시 | 규칙이 스펙 5.5 Dynamic wall hiding의 「절개(cutaway)」 방식 그대로다. 숨긴 메시는 레이어 1로 옮겨 그 안 빛은 계속 비춘다 |
| 벽에 딸린 물건(`cutAction`) | 위쪽이 숨은 벽의 높은 장식은 숨김, 문·창·커튼은 1.05 m 자르기 평면으로 자름, 가전·상태 있는 것은 그대로 | 옮김 + 다시 | 자르기 평면이 GTAO와 충돌한다(3.8절) |
| 천장(`ceilingVisible`, `setCeiling`) | `mount=ceiling` 물건은 그 방 초점이나 「천장 보기」일 때만 보임 | 옮김 | 한양목련은 천장 물건이 0개다. 다른 집(apartment)에는 천장 조명이 있다. 숨겨도 빛은 남는다 |
| CCTV(`cctvView`·`exitCctv`·`cctvPose`, 115° 원근, 끌어 돌리기·휠 확대, ◀▶, REC 화면) | 방 천장 모서리 카메라 | 옮김(`cctvPose`) + 다시(나중) | 대시보드에서는 닿지 않고 설정 화면 막대에서만 닿는다. 스펙 필수 기능이 아니라 P4 이후. 원근 카메라라 GTAO 패스를 따로 둬야 한다 |
| 화면 크기(`resize`) | 렌더러·합성기·라벨·투영 다시 맞춤 | 다시 | ResizeObserver로 캔버스 크기 기준. iframe용 resize 보내기(`hideViewerBar`·`nudgeTwin`)는 버림 |

### 2.9 렌더링

| 기능 | 지금 값 | 분류 | 비고 |
|---|---|---|---|
| 렌더러 | antialias, DPR ≤ 2, AgX, exposure 1.0, PCFShadowMap, localClipping | 다시 | 스펙 4.1은 ACESFilmic·PCFSoft. 합성기(EffectComposer) 기본 타깃은 MSAA가 없어 지금 화면에는 안티에일리어싱이 사실상 없다(three 소스 기준, 화면 확인 필요). SMAA를 넣는다 |
| 빛 | RoomEnvironment PMREM(세기 0.45), Hemisphere 0.5, 해 2.6(그림자 4096, bias −0.0004, normalBias 0.02), 채움 1.1 | 다시 | HDRI로 바꾼다(스펙 4.4). 해 방향은 `stage.sun.direction` 유지 |
| GTAO(`ClippedGTAOPass`, radius 0.35) | 자르기 평면 메시만 자르기 평면 있는 법선 재질로 다시 그림 | 다시 | 3.8절 |
| 렌더 루프 | `setAnimationLoop` 매 프레임 그림, 프레임 시간 60장 평균 | 다시 | 스펙 12절 「React 렌더 루프와 재렌더 분리」. 움직임·회전 효과·전환이 없으면 쉬는 방식 검토 |

### 2.10 고르기·편집·검사

| 기능 | 분류 | 근거 |
|---|---|---|
| 클릭 고르기(`findPickable`, interactive만) | 다시 | 클릭 → 방(Room Focus)·가전(Object Focus)으로 바꾼다(스펙 7절). 4 px 넘게 끌면 클릭 아님 규칙 유지 |
| TransformControls 이동·회전(W·E), 원래 자리, 배치 내보내기(`placementExport`) | 남김 | 스튜디오 편집 도구. 대시보드에서 지금 클릭하면 손잡이가 붙어 가구가 끌린다(저장은 안 됨). 실제 배치 보정은 폰·채팅 → 서버 편집기 → `apply-edits` 경로다 |
| Esc(고르기 취소 → CCTV 나가기 → 고른 것 해제) | 다시 | Esc = 고르기 취소 / 전체 보기로 |
| 검사 칸(객체 수·텍스처·위치 오차·독립 이동·상태 연결·프레임 시간), `?debug=1` | 남김 + 일부 다시 | 상태 연결 누락·프레임 시간·삼각형 수는 새 렌더러 개발 표시(품질 프리셋 측정)로 다시 만든다 |
| `browser-check.mjs`(CDP, 상태 값마다 화면 차이: 평균 ≥ 4 또는 바뀐 픽셀 ≥ 3% 또는 ≥ 2,000 px) | 다시 | 새 렌더러용 화면 시험의 기준으로 쓴다. 헤드리스 크롬 하나씩만(이 PC) |

## 3. 꼭 지킬 규칙

### 3.1 상태 효과 규칙 (states.mjs)

- 상태 정의: scene.json 객체 `states`가 먼저, 없으면 GLB 노드 `extras.states_json`. 값 목록은 `attrs[attr]`가 먼저, 없으면 효과 키. 기본값은 `states[attr].default`, 없으면 첫 값.
- 효과 키: 문자열은 그대로, 나머지는 JSON 문자열(`true` → `"true"`). `running`만 불리언.
- 대상: `part` → GLB 노드 `extras.part`(three `userData.part`), `light` → `extras.light`(JSON 문자열: kind spot·area·point, color, direction, angle_deg(원뿔 전체 각), distance, size, watts, three_intensity)가 있는 기준점.
- 효과 종류: `emissive`(그 부품과 아래 메시 전체 발광 배수), `visible`(아래 전체), `rotate`(도, Euler XYZ)·`translate`(m)·`scale`(그 노드만, 로컬 축), `spin`(초당 회전수), `light`+`intensity`(빛 세기 배수).
- 늘 「쉴 때 모습」(GLB 그대로: 최대 발광, 모두 보임, 빛 꺼짐)에서 시작해 모든 상태의 기여를 쌓는다. 이동은 더하고, 회전·크기·발광·빛 세기는 곱하고, 보이기는 모두 참일 때만 보인다. 그래서 같은 값을 두 번 넣어도 같고, A → B → A는 정확히 A로 돌아온다.
- 효과 목록에 없는 대상은 기본값의 효과, 그것도 없으면 쉴 때 모습.
- 발광을 바꾸는 메시는 재질을 인스턴스 전용으로 한 번만 복제한다(같은 종류가 재질을 공유하므로).
- 빛 자리 우선순위: 천장 조명(+10⁴) → 와트 큰 순. 꽉 차면 큰 빛이 작은 표시등 자리를 가져가고, 밀린 빛은 자리가 나면 센 것부터 켠다.
- 효과 부품(`extras.effect`)·`extras.no_bounds`는 크기 재기(말풍선 자리·CCTV 장애물)에서 뺀다. 회색 상자는 `extras.placeholder`.
- Blender 빌더(`blender/apartment/framework.py`)와 같은 규칙이다. 한쪽만 바꾸지 않는다.

한양목련에서 상태가 보이는 방식(21개)
- 에어컨 2대: 표시창·LED 발광, 바람 부품 보임, 셔터·루버 회전.
- 냉장고: 양문 ±100° 회전, 안쪽 발광 + 빛.
- 인덕션: 화구·터치창 발광 + 열빛.
- 세탁기: 동작 = 표시창·링·드럼빛·상태줄 발광 + 빛 + 드럼 회전(0.8회/초), 문 열림 = 문 −100° + 문 램프 + 빛. 건조기: 동작만(드럼 0.5회/초).
- 현관문: 열림 = 문짝 −95° + 문간 빛 보임, 잠금 풀림 = 빨강 → 초록 발광, 키패드 바뀜, 안팎 빛 + 바닥 빛 웅덩이.
- 여닫이문 9개: 문짝 ±95°. 미닫이문 5개(붙박이장·발코니): 패널 −0.96 ~ −2.68 m 이동.
- 한양목련에는 조명·커튼·블라인드·TV가 없다. 다른 집(apartment)에는 있으므로 규칙은 그대로 일반으로 둔다.

### 3.2 실시간 동기화 (live.mjs)

받는 메시지(`/events`)
- `{type:"state", state:{id, twin, signal?}}`: twin-home이 아는 기기의 twin 값. 기기 id = scene.json 객체 id.
  - `signal:"none"`: 상태를 모른다. 화면 값은 그대로 두고, 이 기기 조작은 twin-home으로 보낸다.
  - 장면에 없는 id → 무시(모르는 기기 수 셈), 없는 attr → 무시, 값 목록에 없는 값 → 무시. 같은 것은 한 번만 센다.
  - 지금 값과 같으면 건너뛴다. 반영하는 동안은 되돌려 보내지 않는다(`applying`).
- `{type:"eye", eye}`: 3.3절. 상태는 건드리지 않는다.
- `{type:"layout", op, …}`: 3.5절. 반영한 뒤 기기 목록(attrs)을 다시 읽어 더한 객체도 상태를 주고받게 한다.
- `{type:"focus", focus:{targets, at, ttl_ms}}`: 2.7절.
- 연결 직후 서버는 hello → 모든 기기 state → layout syncMessages(지금까지의 보정 다시 보내기)를 보낸다.

보내는 것
- 사용자가 3D에서 기기 값을 바꾸면 로컬은 안 바꾸고 `POST /api/devices/:id/twin {attr, value}`. 돌아오는 state 이벤트가 3D를 바꾼다.
- 응답 409 + `needsConfirmation{token, reason}` → 승인 알림(승인 `POST /api/agent/confirm {token}`, 취소 `/api/agent/cancel`). 400 이상 또는 `ok:false` → 오류 알림.
- 연결이 없거나 twin-home이 모르는 기기·attr이면 로컬에서만 바꾼다.

새 렌더러에서
- `createLiveSync`는 그대로 옮기고, 메시지는 대시보드 `useEvents`에서 받아 넘긴다. 장면 준비 전 메시지는 쌓았다가 순서대로 반영한다(지금 `enqueue`가 `viewer.ready`를 기다리는 것과 같음).
- 계약에 `layout`을 넣는다(`ServerMessage`, `parseMessage` KNOWN). 앞으로 올 `{type:"plan"}`(twin-home `2026-11-06-agent-on-twin.md`)도 같은 길로 받는다.

### 3.3 폰 눈 마커 (eye.mjs)

- 입력 `EyeEvent`: `position:[x, y]`(평면, m), `height_m`, `yaw_deg`(0 = +x, 90 = +y = three +z), `pitch_deg`(아래가 음수), `tracking:"ok"|"limited"`, `estimated?`.
- three 위치 `[x, h, y]`, 방향 `[cos yaw·cos pitch, sin pitch, sin yaw·cos pitch]`. 숫자가 하나라도 아니면 무시.
- `limited`면 회색. `estimated`(맞추기 전 추정)는 지금 뷰어가 구별하지 않는다. 새로는 「추정」 표시를 달리 하는 것을 검토(스펙 9.1 「실제 자세가 있을 때만 정확한 시야」).
- 눈 = 폰 카메라 = 클로이드가 보는 곳. 로봇 위치(앞으로 올 `PlanView.robot.position`)와 섞지 않는다.

### 3.4 벽 고르기 (startPick, setTouchPoints)

- `startPick(fn)`: 고르는 중이면 앞 것을 먼저 `fn(null)`로 끝낸다. CCTV면 위에서 보는 화면으로 돌아간다. 고른 물건 해제, 커서 십자.
- 클릭(4 px 이내) → 레이캐스트 결과를 앞에서부터 보며, 보이는 메시 중 벽 노드(`wall_<id>`/`extras.wall`) 또는 문·창(`mount=opening` → `plan.wall`)에 닿은 첫 점을 쓴다. 가구·바닥은 뚫고 지나간다. 레이어 1(숨긴 위쪽 벽)은 안 맞는다.
- 벽 id → `plan.walls`(조각 이름 `I05_0`, `I05-a`도 원래 벽으로). 바깥벽 18·사이벽 21·고체 4(샤프트·기둥, `polygon`).
- 면 고르기: 누른 면의 월드 법선(세로 면) 또는 카메라 방향(윗면 = 1.05 m 단면)과 가장 같은 쪽 `faces[]`. `faces`에는 방과 맞닿은 면만 있어 바깥벽 바깥 면은 못 고른다.
- 점: 벽 중심선 a→b에 투영(끝 밖이면 끝) + 법선 × 두께/2 → 방 쪽 면 위 점(소수 셋째 자리). 고체는 법선이 같은 변 위로.
- 돌려주는 값 `{position:[x, y], room, normal, wall, height_m}`. 설정 화면은 `position`만 저장(`POST /api/phone/touch-points {home, points:[{label, position}]}`).
- `setTouchPoints([{id, label, position}])`: A·B 핀을 다시 그린다. 쓸 수 없는 점은 뺀다. 글은 `A · 라벨`.
- `cancelPick()` = `fn(null)`. Esc도 같다.

### 3.5 배치 보정 (applyLayout)

- `move {id, room, plan:{position, facing_deg, elevation}, position:[x, h, y], rotation:[0, ry, 0]}`: 위치가 숫자 3개가 아니면 무시. scene 객체와 노드를 함께 바꾼다.
- `add {object}`: 같은 id가 있으면 move. 빠진 값은 기본(category props, mount floor, interactive true, …). `asset`이 없거나 못 읽으면 `footprint`·`height` 크기 회색 상자(원점: 바닥 가운데 / 벽은 접촉면 아래 가운데, 앞으로 깊이만큼 / 천장은 윗면 가운데). 받는 동안 같은 id가 생겼거나 다시 불러왔으면 버린다.
- `remove {id}`: 상태를 기본값으로 그려 빛을 풀에 돌려준 뒤 뺀다.
- 화면 반영만 한다. 확정은 twin-studio `apply-edits`.

### 3.6 좌표계

- 평면 `(x, y)` m → three `(x, 높이, y)`. Y-up. 평면도 이미지처럼 위에서 보면 x 오른쪽, y(three z) 아래쪽.
- `facing_deg`: 0 = 동(+x), 90 = 남(+y). three `rotation.y = (90 − facing)°`. 에셋 로컬 정면 = +Z. scene.json 회전은 Euler XYZ 라디안.
- 벽 면 법선은 평면 `[nx, ny]`(방 안쪽), three `(nx, 0, ny)`.
- 초점 대상 `position`과 layout `position`은 이미 three 좌표, 눈·기준점은 평면 좌표. 받는 쪽에서 섞지 않는다.
- 한양목련: 방 15개, 천장 2.3 m, 잘라 보기 1.05 m, `z_min` −0.112(현관 바닥 −0.1).

### 3.7 방 초점·벽 모드가 함께 도는 방식

- 보기 상태 하나(`view`: wallMode, focus, showCeiling, isolate, cctv)가 바뀌거나 카메라 수평 방향이 1e-3 넘게 돌면 다시 계산한다.
- 계산 순서: 벽 위쪽 보이기(`wallVisibility`) → 물건마다 `cutAction`(숨김·자름) + `ceilingVisible` + `focusVisible` → 바뀐 것만 레이어·자르기 적용(캐시).
- CCTV 중에는 벽 모두 세움, 옆방·천장 그대로.
- 새 렌더러에서도 이 계산은 순수 함수 하나(「보기 상태 → 객체별 hidden/clipped/wallUpper」)로 두고, React 말풍선 숨김(`hiddenByFocus`)도 같은 결과를 읽게 한다. 지금은 말풍선이 매 프레임 메시 레이어를 훑어 숨김을 알아낸다.

### 3.8 다시 만들 때 함정 (코드 주석으로 확인된 것)

- 빛 개수가 바뀌면 셰이더 전부 다시 컴파일 → 10초 넘게 멈춤(실제 GPU에서도). 빛은 미리 만든 풀에서 세기만 바꾼다.
- GTAOPass는 법선·깊이를 `scene.overrideMaterial` 하나로 그려 재질별 자르기 평면이 빠진다 → 잘린 문·커튼 윗부분이 AO에 유령 테두리. 지금은 잘린 메시만 자르기 평면 있는 법선 재질로 바꿔 그린다. 새 벽·문을 아래·위로 나눈 메시로 만들면 자르기 평면 없이 해결된다.
- GTAOPass는 정사영·원근을 만들 때 정한다 → CCTV 같은 원근 카메라는 패스를 따로 둔다.
- 조작 손잡이(TransformControls)는 그리는 중 자기 재질을 읽으므로 AO 패스에서는 감추기만 한다.
- CSS2D 요소는 객체를 지워도 DOM에 남는다 → 직접 지운다. 새로는 React 덮개 하나로 그린다.
- 투명 양면 재질은 셰이더 변형이 따로 생겨 미리 컴파일을 비켜 간다 → `forceSinglePass`.
- 숨김은 `visible=false`가 아니라 레이어 1. 상태 효과의 `visible`과 섞이지 않고, 숨긴 천장 조명의 빛은 계속 비춘다.

## 4. window.aptViewer 대응표

사용처: G = twin-home-glass, M = twin-home-mode(두 곳 같은 코드), 뷰어 = 뷰어 자신의 live.mjs, 검사 = `test/browser-check.mjs`.

| 멤버 | 지금 쓰는 곳 | 새 React 렌더러 대응 |
|---|---|---|
| `THREE` | G·M `ui/src/twin/anchors.ts`(Box3·Vector3), `use-anchors.ts`(Matrix4), 검사 | `three`를 `ui` 의존성으로 직접 import(판 하나). 「뷰어 THREE로만 만든다」 규칙은 없어진다 |
| `camera` | `use-anchors.ts`(투영 행렬로 말풍선 자리) | CameraController가 지금 카메라를 준다. 같은 React 트리라 iframe 오프셋이 필요 없다 |
| `cctvCamera` | `use-anchors.ts`(view.cctv일 때) | CCTV를 다시 만들면 「지금 그리는 카메라」 하나로 합친다 |
| `renderer` | `use-anchors.ts`(`domElement.getBoundingClientRect()`) | 캔버스 사각형(ResizeObserver) |
| `scene` | 타입만(`viewer.ts`). agent-on-twin 계획의 PathLayer가 경로 띠를 넣을 예정 | TwinScene의 표시 층(경로·고리·핀)을 컴포넌트로 |
| `ready`·`loading`·`results` | `viewer.ts` `waitForViewer`(불러오기 끝·실패 판정), 검사 | 장면 상태 `loading → ready / error`를 store로 |
| `view` | `use-anchors.ts`, `visibility.ts` `hiddenByFocus`(focus·isolate·cctv) | 보기 store(외부 store + `useSyncExternalStore`). 렌더 루프와 React 재렌더 분리 |
| `objects()` | `use-anchors.ts`(id → room·category), 뷰어(attrs 읽기), 검사 | scene.json 모델을 직접 읽는다(부를 때마다 만들지 않음) |
| `node(id)` | `anchors.ts` `deviceAnchor`(상자 윗면 + 0.08 m), 검사 | 객체 등록부 `getNode(id)`·미리 잰 상자(효과 부품 뺀 `solidBox`) |
| `hidden(id)` | `use-anchors.ts`(다른 방 물건일 때만), 검사 | 3.7절 보기 계산 결과를 그대로 읽는다 |
| `setBadges(on)` | `TwinStage.tsx`(false) | 버림(배지 없음) |
| `setWallMode(m)` | `TwinStage.tsx`("low"), 검사 | 보기 store `wallMode`. 기본은 새 cutaway(auto 계열) |
| `setFocus(focus)` | 타입만. 실제는 뷰어 live.mjs가 `focus` 메시지로 부름 | Agent Focus Controller가 `useEvents`의 `focus`로 |
| `renderNow()` | 타입만, 검사 | `invalidate()`(한 장 다시 그리기) |
| `startPick(fn)` | G·M `web/setup/setup.js` `touch.pick` | `usePicker().start(): Promise<WallHit \| null>` 또는 같은 콜백. PositionStep(control-mode Task 7)이 쓴다 |
| `cancelPick()` | `setup.js` 취소 버튼 | `picker.cancel()` |
| `setTouchPoints(points)` | `setup.js` `showMarkers`(고른 뒤·라벨 입력·불러오기 뒤·iframe load 500 ms 뒤) | `<TouchPins points>` prop. iframe load 지연 처리는 필요 없다 |
| `picking()` | 안 씀 | 상태 값 |
| `setEye`·`eye()` | 뷰어 live.mjs(`eye` 메시지) | `useEvents` → 눈 store → `<EyeMarker>` |
| `applyLayout`·`moveObject`·`addObject`·`removeObject` | 뷰어 live.mjs(`layout`) | `useEvents` → 장면 편집 함수. 계약에 `layout` 추가 |
| `getState`·`setState` | 뷰어 live.mjs, 검사 | 상태 store + `createLiveSync` 어댑터 |
| `setAllPower` | 검사, 뷰어 버튼 | 버림(스튜디오 뷰어에 남김) |
| `focusRoom(id)` | 검사, 뷰어 방 선택·기기 줄·상태 줄 | CameraController `focusRoom(id)`(Room Focus) |
| `setCeiling`·`setIsolate` | 뷰어 막대(설정 화면에서 닿음) | 보기 store |
| `cctv`·`exitCctv`·`cctvPose` | 뷰어 막대(설정 화면에서 닿음) | 나중에 다시(2.8절) |
| `activeDevices()` | 안 씀(뷰어 오른쪽 패널) | 순수 함수 그대로 쓸 수 있음 |
| `select`·`selected`·`transform`·`orbit`·`exportPlacement` | 검사, 뷰어 편집 | 남김(스튜디오) |
| `show`·`mode`·`content`·`wallsShown`·`lights`·`setPaused`·`touchPoints`·`focus()` | 검사·없음 | 필요한 것만 개발용 디버그 객체로 |

twin-home 쪽 시험 중 뷰어 API에 묶인 것: `ui/tests/viewer.test.tsx`, `use-anchors.test.tsx`, `visibility.test.ts`, `project.test.ts`(투영 수식은 그대로 쓸 수 있음). 렌더러를 바꿀 때 같이 고친다.

## 5. 순수 모듈 옮기기

| 원본 | 줄 | 시험 | 옮길 내용 |
|---|---|---|---|
| `states.mjs` | 381 | 25 | 전부 |
| `walls.mjs` | 148 | 16 | 전부(`collectWalls`·`findWallParts`는 GLB 벽을 쓸 때만) |
| `scene.mjs` | 153 | 14 | `applyTransform`·`assetRoot`·`parseProp`·`statesOf`·`isPlaceholder`·`indexNodes`·`findPickable`·`groupByRoom`. `composeMatrix`·`maxDeviation`·`isIdentity`는 남김 |
| `plan.mjs` | 90 | 9 | `fitOrtho`·`roomBox`·`polygonBounds`·좌표 변환. `placementExport`는 남김 |
| `live.mjs` | 157(앞부분) | 10 | `createLiveSync`. `liveUrl`·`httpBase`는 버림 |
| `layout.mjs` | 79 | 8 | 전부 |
| `cctv.mjs` | 161 | 9 | 전부(CCTV를 다시 만들 때) |
| `touch.mjs` | 81 | 8 | 전부 |
| `eye.mjs` | 20 | 3 | 전부 |

- 두 저장소에 같은 규칙이 생기므로, twin-studio 시험 자료(`test/fixtures/scene.json`·GLB)로 두 쪽 결과가 같은지 보는 시험 하나를 둔다. 원본 커밋(41f9589)을 TS 파일 머리에 적는다.
- `fixture.test.mjs`(6개)는 GLB 계약 검사라 twin-studio에 남긴다.

## 6. 확인 필요

- EffectComposer 경로에서 지금 화면에 MSAA가 정말 빠졌는지(three r186 기본 타깃 samples 0 기준 추정). 새 SMAA 결정에는 영향 없음.
- 새 고품질 모델에 `part`·`light` 이름을 어떻게 붙일지(twin-studio에서 GLB 후처리 vs 빌더에서 감싸기). 다른 분석(모델·에셋)과 맞춰 정한다.
- 벽을 지금처럼 `walls.glb`(lower/upper 조각)로 받을지, React에서 `plan.walls`로 직접 만들지. 직접 만들면 벽 고르기 레이캐스트는 메시 → 벽 id를 바로 알 수 있다.
- 대시보드 3D에서 기기 값을 바꾸는 입력을 둘지(없으면 승인 알림·`POST …/twin` 보내기는 설정·개발용만).
- CCTV를 새 렌더러에 다시 둘지, 스튜디오 뷰어에만 남길지(지금 대시보드에서는 닿지 않음).
