# 렌더링 조사와 추천안 (rendering-research)

기준일 2026-11-06. 숫자는 별도 표시가 없으면 실측 전 초기값이에요. 실측은 이 PC의 실제 Chrome(GPU)에서 해요.

## 0. 결론

| 항목 | 추천 |
|---|---|
| three.js | **0.187.0 (r187, 2026-10-30)**. 지금 뷰어는 0.186.1. r187에서 정사영 GTAO 버그가 고쳐졌어요(#35073). |
| React 통합 | **(a) React 안에서 three를 직접 쓰는 방식.** 엔진(TS 클래스) + 얇은 `<canvas>` 컴포넌트. R3F는 안 써요. |
| 후처리 | three 기본 `EffectComposer`: `RenderPass → GTAOPass → (오버레이 RenderPass) → OutlinePass(선택 시) → SMAAPass → OutputPass`. Performance만 `RenderPass → OutputPass → FXAAPass`. |
| 색공간 순서 | **SMAA는 OutputPass 앞**(r187 SMAAPass 문서: linear-srgb에서 동작). **FXAA는 OutputPass 뒤**(sRGB 입력 필요). |
| 렌더러 | `antialias:false`(합성기를 쓰면 화면 MSAA는 낭비), DPR ≤ 2, `SRGBColorSpace`, **NeutralToneMapping**, exposure 1.0, **PCFShadowMap**(PCFSoftShadowMap은 r186에서 없어짐), `shadowMap.autoUpdate=false`. |
| 톤매핑 | **Neutral 기본, AgX와 같은 시점 A/B 뒤 확정.** ACESFilmic은 안 써요. |
| 환경광 | HDRI(`HDRLoader`, 1K~2K) → `PMREMGenerator.fromEquirectangular` → `scene.environment`만. 배경은 단색. Performance는 `RoomEnvironment`. |
| AO | High·Balanced는 `GTAOPass`(정사영 지원). 대안: N8AO(반해상·알파·자르기 자동 처리, 대신 `postprocessing` 의존). |
| AA | 기본 SMAA. TAA는 넣지 않아요(이유 5절). MSAA 렌더 타깃도 안 써요. |
| 카메라 | **camera-controls 3.1.2**(정사영 줌·커서 줌·부드러운 전환·회전 제한). 단 `fitToBox`는 회전을 축으로 돌려 버려서 **맞춤 계산은 직접** 만들어요. |
| 아웃라인 | 물체 선택: `OutlinePass`(선택 중에만 켬). 방 선택: 바닥 강조 판 + 경계선. Performance: 약한 발광 + 바닥 링. |
| 벽 절개 | **아래·위로 나눈 벽 메시 숨기기(cutaway)**. clipping·투명은 기본으로 안 써요. |
| 미니맵 | **2D SVG**(평면도 JSON 그대로). 별도 정사영 카메라 렌더는 안 써요. |
| 렌더 루프 | **바뀔 때만 그림**(카메라 이동·전환·CLOiD 이동·상태 변화). 멈추면 GPU 0. |

## 1. three.js 버전

- npm 최신 안정: `three` 0.187.0(2026-10-30), `@types/three` 0.187.0. twin-home ui에는 `@types/three` 0.187.0만 있고 `three` 본체는 없어요(지금은 iframe 뷰어가 CDN 0.186.1을 씀).
- r187에서 이 작업에 걸리는 변화:
  - GTAO 정사영 시선 방향 수정(#35073, `GTAOShader.js`도 같이 고침). 0.186.1은 정사영에서 화면 가장자리 평면이 과하게 어두워져요(PR 측정: 16.0% → 2.8%).
  - `PCFSoftShadowMap` 제거(r186 deprecated, r187 경고 후 `PCFShadowMap`으로 바꿈). `PCFShadowMap`이 하드웨어 비교 + Vogel 5탭 + 픽셀별 회전 노이즈로 `shadow.radius`만큼 부드러워요.
  - 그림자 레이어: `shadow.camera.layers`에 0 말고 다른 레이어를 켜면 그 레이어로 그림자를 그려요(#34670). 기본은 지금처럼 메인 카메라 레이어 기준.
  - `RGBELoader`는 r180부터 `HDRLoader` 별칭(경고 출력). `HDRLoader` 사용.
  - ACES Filmic 계산식 수정(#35110): ACES 결과가 버전마다 달라짐.
  - 새 API `WebGLRenderer({ outputBufferType: HalfFloatType })` + `renderer.setEffects([...])`: HDR 내부 타깃(antialias면 MSAA 4) 뒤에 패스를 돌리고 톤매핑·sRGB를 자동 적용. 2026-04 ~ 10 사이 계속 바뀌는 중(#33446, #34030, #34858)이고 공식 예제는 TAA·Bloom·XR 몇 개뿐이라 **지금은 안 써요**. 나중에 GTAO·SMAA와 함께 쓸 수 있는지 다시 봐요.
- WebGPURenderer(TSL의 GTAONode·SMAANode·TRAANode)는 스펙대로 WebGL 우선이라 이번에는 안 써요.

## 2. 렌더러 설정

```ts
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: false, powerPreference: "high-performance", stencil: false,
});
renderer.setPixelRatio(preset.dpr);              // composer.setPixelRatio도 같이
renderer.outputColorSpace = THREE.SRGBColorSpace; // 기본값. OutputPass가 읽음
renderer.toneMapping = THREE.NeutralToneMapping;  // OutputPass가 적용(RenderPass 단계에서는 안 씀)
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;            // 바뀔 때만 renderer.shadowMap.needsUpdate = true
```

- `antialias:false`: 합성기를 쓰면 장면은 MSAA 없는 HalfFloat 타깃에 그려지고, 화면(MSAA)에는 전체 화면 사각형 하나만 그려져 MSAA가 하는 일이 없어요. 메모리만 써요(1080p MSAA4 색+깊이 약 66MB). **지금 뷰어가 이 상태라 실제 AA가 없어요.**
- `powerPreference`: 이 PC처럼 내장 GPU 하나면 차이 없음. 넣어 둬도 손해 없어요.
- 리사이즈 동기화(ResizeObserver 하나에서 한 번에):
  1. `renderer.setSize(w, h, false)`
  2. `composer.setPixelRatio(dpr)` → `composer.setSize(w, h)` (합성기는 만들 때의 DPR을 기억하므로 DPR이 바뀌면 꼭 같이 바꿈. 패스 크기는 합성기가 `w*dpr`로 넘김)
  3. 정사영 `left/right/top/bottom`을 화면비로 다시 계산 → `updateProjectionMatrix()`
  4. 「맞춤 상태」면 맞춤 다시 계산, 아니면 줌 유지
  5. 한 프레임 다시 그림
  - 모니터를 옮겨 DPR이 바뀌는 경우: `matchMedia(\`(resolution: ${dpr}dppx)\`)` 변화도 같은 함수로 처리.
- 정사영 카메라 거리 고정(예: 40m), `near 1`, `far 100`. 집 11.6 × 11 m, 높이 2.3 m라 이 범위면 어디를 보든 잘리지 않아요.

## 3. 후처리 파이프라인

### 순서(공식 근거)

- r187 `SMAAPass.js` 문서: "Unlike FXAAPass, SMAAPass operates in linear-srgb so this pass must be executed before OutputPass." 공식 예제 `webgl_postprocessing_smaa.html`도 `RenderPass → SMAAPass → OutputPass`.
- r187 `OutputPass.js` 문서: 톤매핑과 색공간 변환을 하는 패스로 보통 마지막. "If a pass requires sRGB input (e.g. like FXAA), the pass must follow OutputPass."
- 공식 `webgl_postprocessing_fxaa.html`: `RenderPass → OutputPass → FXAAPass`.
- 공식 `webgl_postprocessing_gtao.html`: `RenderPass → GTAOPass → OutputPass`.
- `EffectComposer` 기본 타깃은 HalfFloat(선형 HDR). RenderPass 결과는 톤매핑 전 값이고 OutputPass에서 한 번만 톤매핑·sRGB 변환해요.

### 최종 순서

```
High·Balanced: RenderPass → GTAOPass → OverlayPass → OutlinePass(선택 중) → SMAAPass → OutputPass
Performance  : RenderPass → OverlayPass → OutputPass → FXAAPass
```

- **OverlayPass** = `RenderPass(overlayScene, camera)`, `clear=false`, `clearDepth=true`. 에이전트 경로·목표 링·마커 같은 표시를 따로 그려 AO가 안 묻고 SMAA는 받아요. 합성기 버퍼는 프레임마다 번갈아 쓰여 본 장면 깊이가 없으므로 오버레이는 늘 장면 위에 보여요(표시용으로는 이게 더 잘 보임). CLOiD 몸체처럼 그림자·AO가 필요한 것은 본 장면에 둬요.
- 오버레이 색도 OutputPass의 톤매핑을 받아요. Neutral은 0.76 아래 값은 거의 그대로라 상태 색(대기·실행·성공·실패·재계획)이 덜 바래요.
- 화면 UI(React DOM 말풍선·패널)는 캔버스 밖이라 후처리 영향이 없어요.
- 배경색도 톤매핑을 받아요. `scene.background`는 캡처를 보며 값 조정(목표: stage.background `#DCDAD6`).
- **패스 순서는 순수 함수 `buildPipeline(preset)`이 패스 이름 목록을 돌려주게 하고 시험으로 고정**해요: 「SMAA는 OutputPass 앞」, 「FXAA는 OutputPass 뒤」, 「SMAA·FXAA·TAA 중 하나만」.
- 1080p 기준 후처리 버퍼 메모리 추정: 합성기 2장 약 50MB, GTAO 약 58MB, SMAA 약 33MB, Outline 약 35MB, 합 약 175MB. 그림자 4096이면 +64MB. 전용 2GB 안에서 괜찮지만 DPR 2(4K급)면 두 배예요.

## 4. AO

### GTAOPass(r187)

- 정사영 지원: 만들 때 `PERSPECTIVE_CAMERA = camera.isPerspectiveCamera ? 1 : 0`. **카메라 종류는 만들 때 고정**이라 원근 카메라(CCTV 보기)는 합성기를 따로 둬요(지금 뷰어도 그렇게 함).
- `near/far/투영 행렬`은 매 프레임 카메라에서 다시 읽어요. 줌 바꿔도 문제없음.
- 동작: ① `MeshNormalMaterial` 덮어쓰기로 법선·깊이 G-buffer를 그림(**장면을 한 번 더 그림 = 드로콜 두 배**) ② AO ③ Poisson 디노이즈 ④ 결과를 색에 곱함(`blendIntensity`).
- 함정:
  - 덮어쓰기 재질이라 **재질별 clipping plane·alphaTest가 빠져요.** 잘린 문·커튼 윗부분이 AO에 유령 테두리로 남고, 잎이 알파 카드인 식물은 네모 AO가 생겨요. → 벽·문·창을 나눈 메시로 만들어 clipping을 없애고, 알파 카드 식물은 잎을 메시로 바꾸거나 AO에서 빼요.
  - AO를 직접광·반사까지 포함한 최종 색에 곱해서 과하면 햇빛 든 바닥도 어두워져요 → `blendIntensity` 0.75~0.85.
  - `setGBuffer(depthTexture)`로 본 장면 깊이를 넘기면 법선 패스를 건너뛰고 깊이에서 법선을 복원해요(문서). 그런데 합성기 두 버퍼가 프레임마다 번갈아 쓰이고 `DepthTexture`는 한 타깃에만 붙어서 바로는 어려워요. **확인 필요**(성능이 모자랄 때 검토).
  - `setSceneClipBox(집 Box3)`로 집 밖 픽셀의 AO 계산을 줄여요.
  - 반해상: `setSize`를 덮어써 절반 크기로 돌리면 되지만 올릴 때 깊이를 안 봐서 가장자리 번짐이 생길 수 있어요. **확인 필요**.
- 값(미터 단위 장면): `radius 0.3`, `distanceExponent 1`, `thickness 1`, `distanceFallOff 1`, `scale 1`, `samples` 프리셋별, 디노이즈 `lumaPhi 10, depthPhi 2, normalPhi 3, radius 8, rings 2`.

### 대안 N8AO 2.0.1

- 장점: 정사영·로그 깊이·알파 클립 자동 지원. 본 렌더 깊이를 써서 **clipping도 자동 반영, 법선 패스 없음.** `halfRes` + 깊이 고려 업샘플(고정 약 1ms), 품질 모드(Performance~Ultra, Neural), 정지 시 누적(`accumulate`). three 기본 `EffectComposer`에서 `N8AOPass`로 씀(RenderPass 대신).
- 단점: `postprocessing`을 같이 설치해야 해요(dist가 `postprocessing`의 `Pass`를 가져옴). 그 패키지의 peer가 `three >=0.168 <0.188`이라 three 올릴 때마다 막힐 수 있어요. 번들 약 84KB gzip.
- 판단: 스펙대로 GTAOPass로 시작. 이 PC에서 Balanced 목표를 못 맞추거나 clipping·식물 문제가 남으면 N8AO(halfRes, "Low"/"Medium")로 바꿔 비교해요.

## 5. 안티에일리어싱

- **SMAA(기본)**: `SMAAPass()` 인자 없음. 내부 값 고정(`SMAA_THRESHOLD 0.1`, `MAX_SEARCH_STEPS 8`). 선형 HDR에서 가장자리를 찾아서 아주 어두운 곳 가장자리는 덜 잡힐 수 있어요(밝은 장면이라 문제 작음).
- **FXAA(Performance)**: 패스 하나라 가장 쌈. OutputPass 뒤.
- **MSAA 타깃**(`WebGLRenderTarget({samples:4})`): AO G-buffer는 MSAA가 아니라 가장자리 AO가 어긋나고 HalfFloat × 4 메모리. 안 써요.
- **TAA**: 기본에서 뺌.
  - `TAARenderPass` 문서: "This effect uses no reprojection so it is no TRAA implementation." 정지했을 때만 누적.
  - 에이전트 상태가 자주 바뀌어 누적이 자주 초기화돼요.
  - GTAO는 흔들지 않은 카메라로 G-buffer를 그려 AO 가장자리는 계단이 남아요.
  - 누적 중에는 매 프레임 장면을 그려 「멈추면 GPU 0」이 깨져요.
  - 나중에 High의 「정지 시 고품질」 실험으로만: 1초 이상 정지 + 상태 변화 없음 → RenderPass를 `TAARenderPass(sampleLevel 2~3)`로 바꾸고 SMAA 끔 → 무엇이든 바뀌면 즉시 원래대로. SMAA와 같은 시점 캡처·GPU 시간 비교 뒤 결정.

## 6. 환경광·조명·그림자

### 환경광

```ts
const pmrem = new THREE.PMREMGenerator(renderer);
const hdr = await new HDRLoader().loadAsync(url);         // 1K~2K .hdr (Poly Haven CC0 실내·스튜디오)
scene.environment = pmrem.fromEquirectangular(hdr).texture;
hdr.dispose(); pmrem.dispose();
scene.environmentIntensity = 0.8;                          // 캡처 보며 0.6~1.0
scene.environmentRotation.y = 해 방향에 맞춤;
scene.background = new THREE.Color(배경색);               // HDRI를 배경으로 쓰지 않음
```

- PMREM 큐브 기본 크기 256이라 원본은 1K면 충분하고, 2K는 금속·유리 반사가 조금 선명해지는 정도예요.
- 용량을 줄이려면 UltraHDR(JPEG + 게인맵) + `UltraHDRLoader().setDataType(HalfFloatType)`. 변환 품질은 **확인 필요**.
- Performance·대체: `pmrem.fromScene(new RoomEnvironment(), 0.04)`. 내려받을 것 없음. 지금 뷰어 방식.

### 조명

- 주광 `DirectionalLight` 하나만 그림자. 방향은 `scene.json stage.sun`(고도 35°). 세기 2.0~2.5(Neutral 기준 초기값).
- `HemisphereLight` 0.3 정도(하늘 흰색, 땅 따뜻한 회색). 환경광이 충분하면 끔.
- 점광원 그림자는 안 써요(큐브 6면 렌더). 실내 조명은 발광 재질 + 그림자 없는 `RectAreaLight` 1~2개까지.

### 그림자(PCFShadowMap)

- 그림자 카메라: 빛 공간에서 집 AABB에 딱 맞춘 정사영 상자 + 0.5m 여유. 집 대각 약 16m.
  - 4096 → 약 3.9mm/텍셀, 2048 → 7.8mm, 1024 → 15.6mm. 전체 보기 화면은 픽셀당 약 9mm라 2048이면 충분하고, 4096은 확대 때 이득.
- `bias -0.0003 ~ -0.0005`, `normalBias 0.02`(미터), `radius` 프리셋별(5탭이라 4를 넘으면 노이즈가 보임).
- **정적 그림자**: `autoUpdate=false`. 다시 그리는 때: 처음 불러올 때, 숨긴 벽 묶음이 바뀔 때(카메라 정지 시), 문·가구 상태가 바뀔 때.
- CLOiD는 `castShadow=false` + 흐린 원형 바닥 그림자 판. 로봇이 움직여도 그림자 맵을 다시 그리지 않아요.
- 작은 소품(컵·책)은 `castShadow=false`로 그림자 패스 드로콜을 줄여요.
- 숨긴 벽은 기본으로 그림자도 안 드리워요(메인 카메라 레이어 기준). 숨긴 벽도 그림자를 남기려면 r187에서 `sun.shadow.camera.layers.enable(HIDDEN)`. 실내가 어두워져서 기본은 끔.
- 집 바깥 접지 그림자: 흐린 그림자 텍스처를 바닥 판에 한 번 구워 씀.

## 7. 톤매핑

- **추천: `NeutralToneMapping`**, exposure 1.0.
  - Khronos PBR Neutral은 정해진 밝기(약 0.76)까지 바탕색을 거의 1:1로 유지하고 그 위만 눌러요. 흰 벽·목재·가전 색이 지정한 대로 나오고, 3D 위 상태 색도 안 바래요.
- AgX: 지금 뷰어와 Blender(`AgX - Base Contrast`)가 쓰는 방식. 밝은 부분이 자연스럽지만 채도 높은 색을 많이 빼서 상태 색과 목재가 탁해질 수 있어요. Blender 굽기 결과는 선형으로 내보내므로 렌더러 톤매핑과 상관없어요.
- ACESFilmic(스펙 초안): 색이 노랗게 틀어지고 대비·채도가 커져 흰 벽이 누래지고, r187에서 식이 바뀌어 결과도 달라졌어요. 안 써요.
- 확정 방법: 같은 시점(전체·방·물체 3장)을 Neutral·AgX로 캡처해 레퍼런스와 비교. 기준은 흰 벽 밝기, 목재 채도, 상태 색 구분.

## 8. React 통합

### 추천: (a) 직접 쓰는 방식

```
ui/src/twin3d/
  engine/TwinEngine.ts       renderer·scene·바뀔 때만 그리는 루프·리사이즈·dispose
  engine/pipeline.ts         buildPipeline(preset) → 패스 목록 (순수, 순서 시험)
  engine/presets.ts          프리셋 값 (순수)
  engine/adaptiveDpr.ts      프레임 시간 → DPR (순수)
  camera/fit.ts              fitOrtho(points, 카메라 방향, 화면, 가림 여백) → {target, zoom, offset} (순수)
  camera/CameraController.ts camera-controls 감싸기, 자동/수동 모드
  TwinCanvas.tsx             <canvas> + useEffect로 엔진 만들고 지움
```

- React → 엔진: 명령(`focusRoom`, `focusObject`, `setPreset`, `setAgentView`)만. 엔진은 React 상태를 직접 읽지 않아요.
- 엔진 → React: 느린 스냅숏(집중 방, 줌 수준, 미니맵용 카메라 영역)은 `useSyncExternalStore`로 최대 15Hz. 말풍선 위치처럼 매 프레임 바뀌는 것은 엔진의 렌더 후 콜백에서 DOM `style.transform`을 직접 써요(setState 금지).
- React 19 StrictMode는 개발 중 effect를 두 번 실행해요. 엔진은 만들기·지우기를 짝으로 두고, 지울 때 패스·PMREM·텍스처·지오메트리를 모두 `dispose()`.

### 고른 이유

| 기준 | (a) 직접 | (b) R3F + drei + pmndrs postprocessing |
|---|---|---|
| 지금 코드 재사용 | twin-studio 뷰어의 순수 모듈(`plan`·`walls`·`layout`·`cctv`·`touch`)을 TS로 거의 그대로 옮김 | 컴포넌트·훅 구조로 다시 짜야 함 |
| 렌더 루프와 재렌더 분리 | 엔진이 루프를 가짐, React는 HUD만 | `useFrame` + `frameloop="demand"`로 가능하지만 장면이 React 트리라 실수로 재렌더가 장면을 건드릴 수 있음 |
| 시험 | 맞춤·벽·프리셋·DPR·패스 순서가 순수 함수라 vitest(jsdom)로 바로 시험 | `@react-three/test-renderer` 필요. 어느 쪽이든 실제 GL 시험은 브라우저 |
| 의존성 고정 | three 하나 + camera-controls | R3F 9.8.2 peer `react >=19 <19.4`(React 19.4로 못 올림), `postprocessing` peer `three <0.188` |
| 번들(gzip) | three 약 186KB + addon + camera-controls 약 10KB | + R3F 약 58KB + postprocessing 약 113KB(전체 기준) + drei 일부 (+ N8AO 84KB) |
| 성능 | 같음(렌더 비용은 three가 결정) | pmndrs가 효과를 한 셰이더로 합쳐 패스 수가 줄어드는 이점은 있음 |

- (a)의 단점은 리사이즈·dispose·포인터 레이캐스트를 직접 써야 하는 것(200~300줄). 위 구조에 이미 넣어 둠.
- (b)를 고른다면: `<Canvas frameloop="demand" gl={{antialias:false}}>`, `<EffectComposer multisampling={0} frameBufferType={HalfFloatType}>`(기본 multisampling이 4라 SMAA와 겹침), `renderer.toneMapping=NoToneMapping` + 마지막에 `<ToneMapping>`(pmndrs 규칙), N8AO + SMAA, drei `<CameraControls>`.

## 9. 카메라

### camera-controls 3.1.2(vanilla) 사용, 맞춤은 직접

- 되는 것:
  - 정사영에서 휠·핀치가 `ZOOM`(투영 확대)
  - `dollyToCursor=true`면 정사영에서도 커서 쪽으로 확대(소스의 `isOrthographicCamera` 분기 확인)
  - `min/maxPolarAngle`, `min/maxAzimuthAngle`, `minZoom/maxZoom`
  - `setBoundary(Box3)`: 중심점이 집 밖으로 못 나감
  - `setFocalOffset`: UI 가림 여백만큼 화면을 밀기, 정사영에서 x·y 동작
  - `smoothTime` 전환: 전환 중에 새 목표를 주면 속도를 이어받아 자연스럽게 바뀜
  - 메서드마다 Promise
  - `controlstart`, `rest`, `sleep` 이벤트, `stop()`
  - 터치: 한 손가락 회전, 두 손가락 `TOUCH_ZOOM_TRUCK`
- 안 맞는 것과 해결:
  - `fitToBox`는 방위·고도를 **가장 가까운 90° 축으로 돌려요**(소스 `roundToStep(theta, PI/2)`). 아이소 시점이 깨져서 안 써요. 직접 `fitOrtho`를 만들어요:
    1. 대상의 실제 점(방 폴리곤 × 바닥~보이는 높이, 물체 메시 AABB 8꼭짓점)을 지금 카메라 회전으로 뷰 공간에 투영
    2. x·y 범위 계산
    3. 쓸 수 있는 화면(캔버스 − 패널·막대 여백, px)에 맞춰 zoom = min(가로비, 세로비) × (1 − 여백)
    4. 중심 → `moveTo`/`setLookAt`, 여백 비대칭 → `setFocalOffset`, `zoomTo(zoom, true)`
    5. zoom을 `[전체 맞춤 × 0.9, 물체 상한]`으로 자름(극단 확대 금지)
  - 휠은 `controlstart`를 안 냄(문서). 수동 전환은 캔버스의 `pointerdown`·`wheel`·`touchstart`를 직접 들어요.
  - 전환이 고정 시간 ease-in-out이 아니라 smoothDamp(감쇠 스프링)예요. 고정 시간이 꼭 필요하면 자체 tween에서 매 프레임 `setLookAt(..., false)`·`zoomTo(..., false)`.
- 초기값:
  - `minPolarAngle 30°`, `maxPolarAngle 60°`: 지면에서 30~60° 위, 바닥 아래 금지. 기본 고도는 stage 50°.
  - 방위: 기본 45° 대각 ± 60°, 또는 자유 + 벽 다시 계산.
  - `smoothTime 0.35`, `draggingSmoothTime 0.12`, `dollyToCursor true`
  - 마우스: 왼쪽 회전, 오른쪽 이동, 휠 줌
- OrbitControls와 비교: 정사영 `zoomToCursor`·감쇠·회전 제한은 있지만 전환 API·focal offset·경계·rest 이벤트가 없어 지금처럼 전환을 직접 짜야 해요. 번들 이득(약 10KB)보다 직접 짤 코드가 커서 camera-controls가 나아요.

## 10. 아웃라인·강조

- **물체 선택(Object Focus)**: `OutlinePass(resolution, scene, camera)`. 정사영 지원(깊이 변환 분기 있음).
  - `selectedObjects=[가전 루트]`, `edgeStrength 3`, `edgeThickness 1`, `edgeGlow 0`, `pulsePeriod 0`, `downSampleRatio 2`, 가려진 가장자리 색 = 보이는 색 × 0.35.
  - **선택 중에만 `enabled=true`**. 켜져 있는 동안 비용: 장면 깊이 1번 + 선택 물체 마스크 1번 + 흐림 4~6패스.
  - 덮어쓰기 재질이라 clipping은 무시돼요(벽을 나눈 메시로 만들면 문제없음).
  - 더해서 약한 발광 `emissiveIntensity 0.1~0.15`(재질 복제) + 바닥 링(오버레이).
- **방 선택(Room Focus)**: 방은 메시가 많아 아웃라인이 지저분해요. 대신:
  - 방 폴리곤 바닥 판(MeshBasic, 불투명도 0.12~0.18, `depthWrite false`, `polygonOffset`)
  - 경계선(`Line2` 2px, 오버레이)
  - 다른 방 명도 낮춤(0.8배). 재질 공유 때문에 구현 방식은 **확인 필요**: 방별 재질 복제 또는 `onBeforeCompile` uniform.
- 뒤집은 껍데기(inverted hull, drei `<Outlines>`)는 열린 메시·각진 법선 가전에서 틈이 생겨 안 써요.
- Performance: OutlinePass 없음. 발광 + 바닥 링만.

## 11. 벽 절개

- **기본: 나눈 메시 숨기기(cutaway).** `walls.glb`가 이미 `wall_<id>_lower`(−0.112~1.05)·`_upper`(1.05~2.30)로 나뉘어 있어요.
  - 카메라 쪽 벽과 집중 방 앞 벽은 upper를 숨겨요. 판정은 지금 `walls.mjs`의 `wallVisibility`를 옮겨요.
  - 숨긴 판정은 카메라 `rest`와 방위가 기준을 넘을 때만 다시 계산해요. 히스테리시스는 숨김 dot > 0.15, 보임 < 0.05.
  - 위 단면에 짙은 회색 캡(레퍼런스 모양)을 둬요.
  - 장점: AO·아웃라인·그림자가 모두 일관되고, 정렬 문제와 셰이더 변형이 없어요.
- **문·창·커튼**도 Blender에서 1.05m로 나눠 내보내면 clipping plane이 필요 없어요(twin-studio 작업, studio-data 분석과 맞춤).
- clipping plane: 재질마다 셰이더 변형, GTAO·Outline 덮어쓰기 재질이 무시, 잘린 면이 비어 안쪽이 보임(캡 따로 필요), 그림자는 `clipShadows` 따로. 기본으로 안 써요. 자르는 높이를 실시간으로 바꿔야 할 때만 써요.
- 투명: 정렬 문제, AO·아웃라인 어긋남, 겹쳐 그리기 비용. 멈춘 상태에서는 안 써요. 숨김 전환 순간(150~200ms)만 `material.alphaHash=true`로 흐리게 하거나 바로 바꿔요.

## 12. 미니맵

- **2D SVG**:
  - 내용: 같은 평면도 JSON(`plan.rooms` 폴리곤, `plan.walls`)으로 집 윤곽·방 경계·집중 방·CLOiD 위치·카메라 영역.
  - 카메라 영역: 메인 화면 네 모서리를 바닥면(높이 0)에 투영한 사각형(정사영이라 평행사변형).
  - 갱신: 카메라가 움직이는 동안만 최대 15Hz, DOM 속성 직접 갱신.
- 별도 정사영 카메라 렌더는 장면을 한 번 더 그려 내장 GPU에 부담이고, 글씨·선이 DPR에 따라 흐려지고, 클릭 판정을 따로 만들어야 해요. 안 써요.
- SVG는 GPU 비용 0, 어느 DPR에서도 선명, 클릭은 DOM 이벤트, jsdom 시험 가능.

## 13. 품질 프리셋

| 항목 | High | Balanced(이 PC 기본) | Performance |
|---|---|---|---|
| DPR | `min(dpr, 2)` 고정 | `min(dpr, 1.5)`에서 시작, 1.0~1.5 사이 0.25 단위 자동 | `min(dpr, 1.0)` 고정 |
| 그림자 맵 | 4096, radius 3 | 2048, radius 2 | 1024, radius 1 (또는 끔 + 구운 접지 그림자) |
| 그림자 갱신 | 바뀔 때만 | 바뀔 때만 | 바뀔 때만 |
| AO | GTAOPass 전체 해상도, samples 16, 디노이즈 16, radius 0.3m, blend 0.85 | GTAOPass samples 8, 디노이즈 8, radius 0.3m, blend 0.75. **카메라가 움직이는 동안 끄고 멈추면 150ms 동안 0 → 0.75로 켬** | 끔(GLB에 구운 aoMap이 있으면 그것만, 있는지 **확인 필요**) |
| AA | SMAA | SMAA | FXAA(OutputPass 뒤) |
| 아웃라인 | OutlinePass(선택 중) | OutlinePass `downSampleRatio 2`(선택 중) | 없음, 발광 + 바닥 링 |
| 환경광 | HDRI 2K → PMREM, intensity 0.8 | HDRI 1K → PMREM, 0.8 | RoomEnvironment, 0.45 |
| 텍스처 | KTX2 2K, anisotropy 8 | KTX2 1K, anisotropy 4 | KTX2 512~1K, anisotropy 2 |
| 소품 그림자 | 큰 가구·가전·소품 | 큰 가구·가전 | 바닥에 닿는 큰 가구만 |
| 루프 | 바뀔 때만 | 바뀔 때만 | 바뀔 때만, 상태 애니메이션 30fps 상한 |
| 대상 | 전용 GPU·데스크톱 | 노트북·내장 GPU | 저사양·배터리 |

- 자동 DPR(Balanced): 연속으로 그리는 동안의 rAF 간격만 셈(정지 프레임 제외).
  - 1초 동안 중앙값 > 22ms → DPR −0.25
  - 5초 동안 < 12ms → +0.25
  - 바꾸는 것은 카메라 `rest` 때만(움직이는 중 화질이 튀지 않게)
- 처음 실행은 Balanced. 사용자가 고른 값은 `localStorage`(try/catch)에 저장.
- KTX2는 도구(`toktx`·gltf-transform)가 아직 없어요(studio-data 분석). 설치 전까지는 1K PNG/JPG로 시작하고 2K는 KTX2 뒤에 넣어요.

## 14. 측정 방법

- **성능 수치는 이 PC의 실제 Chrome(GPU) 탭 하나에서만.** 헤드리스 Chrome은 SwiftShader(CPU)라 수치가 의미 없어요. 화면 확인 캡처만 800×500, DPR 1, 한 번에 하나.
- 고정 카메라 경로(전체 → 방 → 물체 → 전체, 10초)를 프리셋마다 재생해 기록:
  - rAF 간격 p50·p95
  - `renderer.info.render.calls`·`triangles`, `info.memory.textures`·`geometries`
- 패스별 GPU 시간은 `EXT_disjoint_timer_query_webgl2`가 열려 있을 때만. Windows Chrome 노출 여부 **확인 필요**.
- 목표:
  - Balanced 이동 중 p95 ≤ 20ms(50fps 이상), 가능하면 16.7ms
  - 정지 시 프레임 0
  - 붙였다 뗐다 10번 뒤 `info.memory` 원래대로(누수 없음)
- 이 PC의 실제 해상도·devicePixelRatio **확인 필요**(1080p·125~150%면 DPR 상한 2는 의미 없고 실제 픽셀 수가 기준).
- 지금 GLB: 프리미티브 859개, 약 30만 삼각형(studio-data). GTAOPass는 법선 패스로 드로콜이 두 배라 정적 가구를 방·재질별로 합쳐 드로콜을 300 아래로 줄이는 것이 AO보다 먼저예요.

## 15. 지금 뷰어에서 찾은 것(새 렌더러에서 고칠 것)

1. `antialias:true` + EffectComposer: MSAA 메모리만 쓰고 실제 AA 없음 → `antialias:false` + SMAA.
2. three 0.186.1 GTAO 정사영 버그 → r187.
3. GTAO 덮어쓰기 재질로 clipping이 빠지는 문제를 `ClippedGTAOPass`로 우회 중 → 나눈 메시로 clipping 자체를 없앰.
4. 원근(CCTV)용 합성기를 따로 두는 구조는 그대로 맞음(GTAO 카메라 종류 고정).
5. 톤매핑 AgX → Neutral A/B.

## 출처

- three 0.187.0 npm: https://www.npmjs.com/package/three , 릴리스 노트: https://github.com/mrdoob/three.js/releases/tag/r187
- SMAAPass(r187, OutputPass 앞): https://github.com/mrdoob/three.js/blob/r187/examples/jsm/postprocessing/SMAAPass.js
- OutputPass(r187): https://github.com/mrdoob/three.js/blob/r187/examples/jsm/postprocessing/OutputPass.js
- 공식 예제 SMAA·FXAA·GTAO: https://github.com/mrdoob/three.js/blob/r187/examples/webgl_postprocessing_smaa.html , https://github.com/mrdoob/three.js/blob/r187/examples/webgl_postprocessing_fxaa.html , https://github.com/mrdoob/three.js/blob/r187/examples/webgl_postprocessing_gtao.html
- GTAOPass(r187): https://github.com/mrdoob/three.js/blob/r187/examples/jsm/postprocessing/GTAOPass.js , 정사영 수정 PR: https://github.com/mrdoob/three.js/pull/35073
- EffectComposer(r187): https://github.com/mrdoob/three.js/blob/r187/examples/jsm/postprocessing/EffectComposer.js
- TAARenderPass(재투영 없음): https://github.com/mrdoob/three.js/blob/r187/examples/jsm/postprocessing/TAARenderPass.js
- OutlinePass: https://github.com/mrdoob/three.js/blob/r187/examples/jsm/postprocessing/OutlinePass.js
- PCFSoftShadowMap 제거: https://github.com/mrdoob/three.js/blob/r187/src/constants.js , https://github.com/mrdoob/three.js/pull/33987 , PCF 셰이더: https://github.com/mrdoob/three.js/blob/r187/src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js
- 그림자 레이어: https://github.com/mrdoob/three.js/pull/34670
- RGBELoader → HDRLoader: https://github.com/mrdoob/three.js/blob/r187/examples/jsm/loaders/RGBELoader.js , UltraHDRLoader: https://github.com/mrdoob/three.js/blob/r187/examples/jsm/loaders/UltraHDRLoader.js
- PMREMGenerator: https://github.com/mrdoob/three.js/blob/r187/src/extras/PMREMGenerator.js
- WebGLRenderer `outputBufferType`·`setEffects`: https://threejs.org/docs/pages/WebGLRenderer.html , https://github.com/mrdoob/three.js/pull/33446 , https://github.com/mrdoob/three.js/pull/34030 , https://github.com/mrdoob/three.js/pull/34858 , 예제: https://github.com/mrdoob/three.js/blob/r187/examples/webgl_watch.html
- camera-controls: https://github.com/yomotsu/camera-controls , 소스(fitToBox 축 맞춤, 정사영 커서 줌): https://cdn.jsdelivr.net/npm/camera-controls@3.1.2/dist/camera-controls.module.js
- N8AO: https://github.com/N8python/n8ao
- pmndrs postprocessing(톤매핑 규칙): https://github.com/pmndrs/postprocessing , React postprocessing EffectComposer: https://react-postprocessing.docs.pmnd.rs/effect-composer
- R3F peer 범위: https://www.npmjs.com/package/@react-three/fiber , postprocessing peer 범위: https://www.npmjs.com/package/postprocessing
- 번들 크기: https://bundlephobia.com/package/three@0.187.0 , https://bundlephobia.com/package/@react-three/fiber@9.8.2 , https://bundlephobia.com/package/postprocessing@6.39.6 , https://bundlephobia.com/package/n8ao@2.0.1 , https://bundlephobia.com/package/camera-controls@3.1.2
- 톤매핑: https://www.khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products , https://discourse.threejs.org/t/tone-mapping-overview/75204 , https://devtalk.blender.org/t/adding-pbr-neutral-tone-mapper/33602
