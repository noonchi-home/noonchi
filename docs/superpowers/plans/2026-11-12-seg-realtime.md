# 세그멘테이션 + 촬영 속도 YOLO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** YOLO를 세그멘테이션 모델로 바꿔 화면에 네모 상자 대신 칠한 모양만 보이고, YOLO가 초당 10~12장(폰이 화면을 보내는 속도)을 따라가게 한다. VLM 호출 수와 비용은 그대로다.

**Architecture:** 감지기는 `yolo26n-seg` 하나가 상자·마스크를 함께 낸다. 폰은 분석용 사진을 100ms마다 보내고, 서버는 모든 사진에 YOLO를 돌리되 2초마다 한 장만 「VLM 프레임」으로 표시해 VLM·기록·PAM 흐름에 넣는다. 그 사이 사진(빠른 프레임)은 World State의 자리·보임만 고치고 대시보드에 마스크만 보낸다.

**Tech Stack:** onnxruntime-node 1.31(DirectML, 안 되면 CPU 8스레드), Ultralytics 8.4 ONNX 내보내기(opset 17, imgsz 640), sharp(JPEG 풀기), React + canvas(마스크 그리기), vitest.

**Spec:** 사용자 지시(2026-11-12) 「네모박스는 안쓰고 세그멘테이션만」, 「실제 촬영하는 속도를 그대로 따라가서 물체탐지」, 「그 방식으로 계획서부터」. 측정값은 아래 「근거」. 구현 뒤 `docs/` 저장소 구현명세서 SSOT 6.1·6.2·12절을 같이 고친다.

## 근거 (이 PC, Ryzen 7 7730U + 내장 Radeon, 2026-11-12 측정)

| 모델 · 입력 | CPU 4스레드 | CPU 8스레드 | DirectML |
|---|---|---|---|
| yolo26n(감지) 640 | 63ms | 44ms | 39ms |
| yolo26n-seg 640 | 98ms | 74ms | **56ms** |
| yolo26n-seg 480 | 57ms | 40ms | 35ms |
| yolo26n-seg 384 | 35ms | 28ms | 24ms |

- `jpeg-js`로 360×640 JPEG 풀기: 27ms. 지금 한 장 119ms 가운데 추론은 63ms뿐이다.
- 관절 모델: 사람이 보이는 프레임마다 80ms(CPU 4스레드).
- 측정 스크립트: 세션 스크래치패드 `closer-check/seg-bench.mts`(커밋하지 않음). Task 1에서 `scripts/brain-yolo-bench.ts`로 옮긴다.

## Global Constraints

- 브랜치: `feat/video-steps`에서 `feat/seg-realtime`을 새로 만든다. `feat/video-steps`에는 커밋하지 않는다.
- 커밋 메시지는 영어, attribution 줄 없음. `.gitignore`·`.ignore`·`ui/public/fonts/OFL-noto-sans-kr.txt`·`.trail/`은 커밋하지 않는다. 푸시는 사용자가 말할 때만.
- 시험·빌드·크롬은 `npm run heavy -- <cmd>`로만(종료 코드 3이면 기다렸다 다시). 가짜 서버 `EFAULT`는 그 시험만 다시 돌린다.
- 실제 모델 비용 한도 $1 중 약 $0.72를 썼다. 남은 실제 판정은 2번까지(판당 약 $0.03).
- VLM은 2초에 한 번 그대로다(`VLM_FRAME_MS` 기본 2000). PAM에는 사진을 넘기지 않는다(CLAUDE.md 규칙 표).
- mock과 live는 같은 구조다. 가짜 감지기는 `tests/helpers/`에만 둔다.
- 화면: 색은 토큰에서만, 화면 글은 상태만, 부품은 21st.dev 부품. 네모 상자 테두리는 화면 어디에도 그리지 않는다. 이름표(「컵 0.83」, 기존 Status 부품)는 남기고 마스크 위쪽에 붙인다.
- 안에서 쓰는 상자 숫자(`Detection.box`)는 남긴다. 마스크의 바깥 테두리에서 계산한 값이고 가까이 보기 자르기·VLM 감지 목록·같은 물체 맞추기가 쓴다. 화면에는 보내지 않는다.
- 모델 파일은 AGPL-3.0이다. `THIRD_PARTY.md` 표·`src/brain/detector.ts` sha256·`Dockerfile` 확인 줄을 같이 바꾼다.
- Docker 배포에는 DirectML이 없다. CPU로 떨어지며 그때 YOLO는 초당 약 10장이다.

## File Structure

| 파일 | 일 |
|---|---|
| `models/yolo26n-seg.onnx` (새로), `models/yolo26n.onnx` (지움) | 감지 모델 |
| `src/brain/seg.ts` (새로) | seg 출력 풀기: 마스크 만들기, 테두리 상자, 바닥 점, 화면용 압축 |
| `src/brain/detector.ts` | seg 세션, 실행 장치 고르기, 빠른 JPEG 풀기, 관절 3장에 1장 |
| `src/observe/pipeline.ts`, `src/observe/ring.ts` | 빠른 프레임과 VLM 프레임 나누기, 최신 우선 대기열 |
| `src/world/state.ts`, `src/world/place.ts` | 프레임 수 규칙 → 시간 규칙, 마스크 바닥 점으로 트윈 위치 |
| `src/contract/events.ts` | `seen` 사건(마스크), `observe.boxes` 지움 |
| `src/phone/server.ts`, `ui/src/phone/core/{ar,video-ar,engine}.js` | 분석용 사진 100ms |
| `ui/src/dashboard/{masks.ts (새로), detections.ts, PhonePane.tsx, data.ts}` | 마스크 그리기, 상자 지움 |
| `scripts/brain-yolo-bench.ts` (새로), `scripts/brain-yolo-fetch.ts` | 속도 재기, 모델 넣기 |

---

### Task 1: 속도 재는 도구와 seg 모델 넣기

**Files:**
- Create: `scripts/brain-yolo-bench.ts`, `models/yolo26n-seg.onnx`
- Modify: `src/brain/detector.ts:85`(`DETECTOR_MODEL`), `THIRD_PARTY.md`, `Dockerfile`(sha256 확인 줄), `scripts/brain-yolo-fetch.ts`
- Delete: `models/yolo26n.onnx`
- Test: `tests/brain-detector.test.ts`

**Interfaces:**
- Produces: `DETECTOR_MODEL = { file: "yolo26n-seg.onnx", sha256: <내보낸 파일 값> }`

- [ ] **Step 1: 내보내기.** 세션 스크래치패드 `vision-export/`의 venv로 `yolo export model=yolo26n-seg.pt format=onnx imgsz=640 opset=17 simplify=True`. 출력 모양을 확인한다: `output0 [1, 116, 8400]`(cx, cy, w, h, 클래스 80, 마스크 계수 32), `output1 [1, 32, 160, 160]`(프로토). 다르면 멈추고 보고한다(Task 2의 풀기 코드가 이 모양을 전제로 한다).
- [ ] **Step 2: 실패하는 시험.** `tests/brain-detector.test.ts`에 「감지 모델은 yolo26n-seg이고 파일 sha256이 표와 같다」를 넣는다. `npm run heavy -- npx vitest run tests/brain-detector.test.ts` → 파일 없음으로 실패.
- [ ] **Step 3:** `DETECTOR_MODEL`·`THIRD_PARTY.md` 표(`.pt` 주소·sha256, 내보내기 명령)·`Dockerfile` 확인 줄을 새 값으로 바꾸고 `npx tsx scripts/brain-yolo-fetch.ts --from <폴더>`로 `models/`에 넣는다. `models/yolo26n.onnx`를 `git rm` 한다.
- [ ] **Step 4:** `scripts/brain-yolo-bench.ts`: 모델 경로·크기·스레드·장치(`cpu`·`dml`)를 받아 20번 `session.run`의 중앙값(ms)을 한 줄씩 찍는다(스크래치패드 `seg-bench.mts`를 옮긴다). `tests/fixtures`의 사진으로 JPEG 풀기 시간도 찍는다.
- [ ] **Step 5:** 시험 통과 확인 후 커밋 `feat(brain): switch the detector model to yolo26n-seg and add a speed bench`. (이 커밋만으로는 `detect()`가 깨지므로 Task 2와 한 PR 안에서 이어 간다. 전체 시험은 Task 2 끝에 돌린다.)

### Task 2: seg 출력 풀기 (`src/brain/seg.ts`)

**Files:**
- Create: `src/brain/seg.ts`, `tests/brain-seg.test.ts`
- Modify: `src/brain/detector.ts`(`Detection`, `decodeYolo26All`, `OnnxDetector.run`·`detect`)

**Interfaces:**
- Produces:

```ts
/** 물체 모양: 프로토 격자(160×160, 레터박스 4px = 1칸)에서 그 물체 상자만 잘라 낸 0/1 그림. */
export interface Mask {
  /** 원본 사진 픽셀에서 이 그림이 덮는 자리 [x, y, w, h]. */
  at: [number, number, number, number];
  /** 그림 크기(칸). */
  cols: number; rows: number;
  /** 줄 순서 비트(1 = 물체), base64. 길이 ceil(cols*rows/8). */
  bits: string;
}
export interface Detection { label: DetLabel; score: number; cls: number;
  /** 마스크 바깥 테두리(원본 픽셀 [x, y, w, h]). 마스크가 비면 모델 상자. */
  box: [number, number, number, number];
  mask: Mask;
  /** 마스크 가장 아래 줄의 가운데(원본 픽셀 [x, y]). 트윈 위치 광선이 쓴다. */
  foot: [number, number];
}
export function maskOf(coeffs: Float32Array, protos: Float32Array, lbBox: Box, lb: LetterboxPlace, image: Size): { mask: Mask; box: Box; foot: [number, number] } | null;
export function maskCells(m: Mask): Uint8Array; // 비트 풀기(시험·화면 공용 규칙)
```

- [ ] **Step 1: 실패하는 시험** (`tests/brain-seg.test.ts`):
  - 프로토 32장 중 0번만 「가운데 원」 모양이고 계수 `[8, 0, …]`이면 `maskOf`가 원 안 칸만 1로 낸다(시그모이드 > 0.5).
  - 상자 밖 칸은 프로토 값이 커도 0이다(상자로 자름).
  - `box`는 1인 칸의 바깥 테두리를 원본 픽셀로 옮긴 값이고 사진 끝에서 잘린다. `foot`은 가장 아래 1인 줄의 x 가운데다.
  - 1인 칸이 4칸 미만이면 `null`(그 감지는 모델 상자와 빈 마스크로 남긴다).
  - `maskCells(maskOf(...).mask)`가 원래 0/1과 같다(base64 왕복).
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/brain-seg.test.ts` → `maskOf is not a function`으로 실패 확인.
- [ ] **Step 3: 구현.** 핵심:

```ts
const PROTO = 160, STRIDE = 4, COEFFS = 32;
export function maskOf(coeffs, protos, lbBox, lb, image) {
  // 상자를 프로토 칸으로(바깥으로 반올림), 격자 안으로 자름
  const c0 = Math.max(0, Math.floor(lbBox[0] / STRIDE)), r0 = Math.max(0, Math.floor(lbBox[1] / STRIDE));
  const c1 = Math.min(PROTO, Math.ceil((lbBox[0] + lbBox[2]) / STRIDE)), r1 = Math.min(PROTO, Math.ceil((lbBox[1] + lbBox[3]) / STRIDE));
  const cols = c1 - c0, rows = r1 - r0;
  if (cols <= 0 || rows <= 0) return null;
  const cells = new Uint8Array(cols * rows);
  let n = 0, minC = cols, maxC = -1, minR = rows, maxR = -1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const p = (r + r0) * PROTO + (c + c0);
    let v = 0;
    for (let k = 0; k < COEFFS; k++) v += coeffs[k]! * protos[k * PROTO * PROTO + p]!;
    if (v > 0) { // sigmoid(v) > 0.5
      cells[r * cols + c] = 1; n++;
      if (c < minC) minC = c; if (c > maxC) maxC = c; if (r < minR) minR = r; if (r > maxR) maxR = r;
    }
  }
  if (n < 4) return null;
  // 칸 → 원본 픽셀: (칸 * STRIDE − pad) / ratio, 사진 끝에서 자름
  ...
}
```
  `decodeYolo26All`은 NMS 뒤 남은 감지에만 `maskOf`를 부른다(8400개 전부에 하지 않는다). 계수는 `out[(84 + k) * n + i]`다. `checkShape`의 채널 수를 `4 + 80 + 32`로 바꾼다. `OnnxDetector.run`은 출력 둘(`outputNames[0]`, `[1]`)을 돌려준다. 기준점 상자(`landmarks`)는 마스크 없이 그대로다.
- [ ] **Step 4:** 기존 `tests/brain-detector.test.ts`의 출력 모양 시험을 116채널로 고치고, 실제 모델 시험(컵 사진 고정 자료)에 「컵 감지에 마스크가 있고 `foot`이 `box` 아랫변 위에 있다」를 더한다.
- [ ] **Step 5:** `npx tsc --noEmit -p .`와 `npm run heavy -- npx vitest run`(전체). `Detection`을 만드는 시험 대역(`tests/helpers/detectors.ts`)에 `mask`·`foot`을 채우는 도우미 `det(label, score, box)`를 둔다(상자를 꽉 채운 마스크, `foot` = 상자 아랫변 가운데). 통과 후 커밋 `feat(brain): decode yolo26 seg masks, tight boxes and foot points`.

### Task 3: 한 장을 빠르게 (장치·JPEG·관절)

**Files:**
- Modify: `src/brain/detector.ts`(`DetectorSpec`, `OnnxDetector.create`·`detect`), `src/observe/pipeline.ts:475-505`(감지기 만들기·시작 글), `package.json`(sharp), `Dockerfile`, `docs/reference.md`(환경 변수 표)
- Test: `tests/brain-detector.test.ts`

**Interfaces:**
- Produces: `DetectorSpec.provider?: "auto" | "dml" | "cpu"`(환경 변수 `BRAIN_YOLO_PROVIDER`, 기본 auto), `DetectorSpec.poseEvery?: number`(`BRAIN_POSE_EVERY`, 기본 3), `Detector.provider: string`(실제로 붙은 장치), `PipelineStatus.provider`.

- [ ] **Step 1: 실패하는 시험.**
  - `provider: "auto"`는 win32에서 `["dml", "cpu"]` 차례로 세션을 만들고, dml이 오류면 cpu로 만든다(가짜 `ort`를 주입해 차례를 본다). `provider: "dml"`인데 못 만들면 오류를 그대로 낸다.
  - `poseEvery: 3`이면 사람이 이어서 보이는 6장 중 관절 세션은 1·4번째에만 돈다. 사람이 안 보이다 다시 보이면 그 첫 장에 돈다.
  - JPEG 풀기 결과가 `jpeg-js`와 화소 차 평균 2 이하다(sharp, 같은 고정 사진).
- [ ] **Step 2:** 실패 확인.
- [ ] **Step 3: 구현.**
  - 세션 옵션: `{ executionProviders: [...], intraOpNumThreads: spec.threads ?? 8 }`. 기본 스레드를 4 → 8로(`BRAIN_YOLO_THREADS`).
  - JPEG: `sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })`. sharp를 못 불러오면 `jpeg-js`로 떨어진다(시작 글에 한 줄).
  - 관절: `detect()`가 사람 있는 프레임을 세어 `count % poseEvery === 0`일 때만 돌린다. 안 돌린 장은 `poses` 없음(지금 「사람 없음」과 같은 모양).
- [ ] **Step 4:** `npx tsx scripts/brain-yolo-bench.ts`로 `detect()` 한 장 전체 시간(풀기 + 레터박스 + 추론 + 마스크)을 잰다. **기준: dml 중앙값 80ms 이하, cpu 8스레드 100ms 이하.** 넘으면 어디가 느린지(레터박스 JS 루프가 후보) 재고 보고한다.
- [ ] **Step 5:** 전체 시험 통과 후 커밋 `perf(brain): run yolo on DirectML when available, decode jpeg with sharp, pose every 3rd frame`.

### Task 4: World State의 프레임 수 규칙을 시간 규칙으로

분석용 사진이 20배 자주 오면 「몇 장 이어서 보임」으로 세는 규칙이 20배 빨리 채워지거나 깨진다. 이 Task는 그 규칙을 모두 찾아 시간 기준으로 바꾼다. **Task 5보다 먼저 한다.**

**Files:**
- Modify: `src/world/state.ts`(`applyDetections`, 새 물건 「세는 중」 확인, 사람 등장·사라짐 `presence`, `judge`), 필요하면 `src/world/presence.ts`
- Test: `tests/world-state.test.ts`와 관련 world 시험

- [ ] **Step 1: 조사.** `trail grep`으로 `src/world/`에서 프레임 수를 세는 곳을 모두 적는다(확인까지 본 장 수, 안 보인 장 수, 연속 횟수, `HISTORY_MAX` 같은 개수 상한). 규칙마다 「2초 간격에서 몇 초였는지」를 표로 만든다. 이 표를 커밋 메시지 본문에 넣는다.
- [ ] **Step 2: 실패하는 시험.** 규칙마다 같은 장면을 2000ms 간격과 100ms 간격으로 넣어 **같은 영상 시각에 같은 사건**(등장·확인·사라짐·시야 밖)이 나는지 본다. 지금 코드에서는 100ms 쪽이 먼저 나거나 깜빡여서 실패해야 한다.
- [ ] **Step 3: 구현.** 장 수 N을 「처음 본 뒤 (N−1) × 2000ms가 지났고 그동안 본 프레임 비율이 절반 이상」 같은 시간 창으로 바꾼다. 「세는 중에 끊기면 잊는다」(`state.ts` `if (!seen.has(obj.id)) this.forget(obj.id)`)는 한 장 빠짐이 아니라 500ms 동안 못 봄으로 바꾼다(seg가 한 장 놓쳐도 잊지 않게). 기본 2000ms 상수는 `VLM_FRAME_MS`와 따로 `EVIDENCE_STEP_MS = 2000`으로 둔다.
- [ ] **Step 4:** 가까이 보기 규칙(`CLOSER_NEW_FRAMES` 3장, `closerSpanMs`, `closerStaleMs`)은 Task 5에서 「VLM 프레임 간격」을 쓰게 바꾸므로 여기서는 건드리지 않는다.
- [ ] **Step 5:** 전체 시험 통과 후 커밋 `refactor(world): count evidence by time instead of frame count`.

### Task 5: 빠른 프레임과 VLM 프레임 나누기

**Files:**
- Modify: `src/observe/pipeline.ts`(`ObserveConfig`, `loadObserveConfig`, `onEngine`, `analyze`, `drain`, `closer`), `src/observe/ring.ts`(`EngineFrame.vlm`, `window`), `src/contract/events.ts`, `src/server/home.ts:289·440`, `src/phone/server.ts:62-167`
- Test: `tests/observe-pipeline.test.ts`, `tests/observe-ring.test.ts`, `tests/observe-closer.test.ts`, `tests/observe-start.test.ts`

**Interfaces:**
- Produces:

```ts
interface ObserveConfig { engineMs: number;   // ENGINE_FRAME_MS, 기본 100, 50 이상
                          vlmMs: number;      // VLM_FRAME_MS, 기본 2000, engineMs 이상
                          ... }
interface EngineFrame { ...; vlm: boolean }   // 이 프레임을 VLM·기록에 쓰는가
// 대시보드로만 가는 가벼운 사건(기록 DB에 넣지 않는다)
type SeenEvent = { type: "seen"; at_ms: number; frame_id: string; captured_at_ms: number;
                   frame: { width: number; height: number };
                   shapes: { label: DetLabel; score: number; mask: Mask }[] };
```

- [ ] **Step 1: 실패하는 시험.**
  - 100ms 간격 40장(4초)을 넣으면 YOLO는 40번, VLM 제출은 2번(0초·2초 프레임)이다.
  - `observe` 기록은 VLM 프레임에만 남는다(40장에 2줄 + VLM 답 2줄). 빠른 프레임은 `seen` 사건만 낸다.
  - VLM 창(`ring.window`)은 VLM 프레임만 고른다: 5장이면 8초 폭이다.
  - 최신 우선: 감지가 밀려 대기열에 빠른 프레임이 2장 넘게 쌓이면 오래된 빠른 프레임을 조용히 버린다(`yolo_missing` 기록 없음, `status().skipped` 수만 는다). VLM 프레임은 버리지 않는다(지금처럼 상한을 넘을 때만 `cap`).
  - 가까이 보기는 VLM 프레임 간격으로 고른 최대 5장을 쓴다(`closerSpanMs(vlmMs)`·`closerStaleMs(vlmMs)`). 100ms 간격으로 들어와도 9초 폭에서 5장이다.
  - `observe` 사건에 `boxes`가 없다. 폰 서버 상태의 `engine_ms`는 `config.engineMs`(100)다.
  - `ENGINE_FRAME_MS=2000 VLM_FRAME_MS=2000`이면 지금과 같은 수의 기록이 난다(옛 동작 되돌리기 길).
- [ ] **Step 2:** 실패 확인.
- [ ] **Step 3: 구현.** `onEngine`에서 `frame.vlm = lastVlmAt === null || t.atMs - lastVlmAt >= vlmMs`. `analyze`: 모든 프레임에 `world.applyDetections`와 `seen` 사건, `frame.vlm`일 때만 `observe` 기록·`pool.submit`·`idsOf` 저장. `keepMs = max(20000, vlmWindowFrames * vlmMs)`. 고리가 100ms 프레임 20초치(200장 × 약 25KB = 5MB)를 들고 있는 것은 그대로 둔다.
- [ ] **Step 4:** `home.ts:289`의 `lastBoxes`(대시보드 첫 접속 때 마지막 상자 보내기)를 마지막 `seen`으로 바꾼다. `seen`은 `/events`로만 보내고 기록 DB·실행 기록에 넣지 않는다(초당 10줄).
- [ ] **Step 5:** 전체 시험 통과 후 커밋 `feat(observe): run yolo on every frame and send only one frame per VLM_FRAME_MS to the VLM`.

### Task 6: 마스크 바닥 점으로 트윈 위치

**Files:**
- Modify: `src/world/state.ts:403-430`(상자 아래 가운데를 쓰는 곳), `src/world/place.ts`(`placeBox` 입력), `src/observe/pipeline.ts`(가까이 보기 `toFrameBox` 옆에 `foot` 옮기기), `src/observe/crop.ts`
- Test: `tests/world-place.test.ts`, `tests/observe-crop.test.ts`

- [ ] **Step 1: 실패하는 시험.** 손이 컵 아래를 가려 상자 아랫변이 20px 아래로 늘어난 감지에서, 트윈 위치는 `foot` 광선의 자리다(상자 아래 가운데 자리와 0.1m 넘게 다른 고정 값). 잘라 본 사진의 `foot`은 `toFrameBox`와 같은 식으로 원본 픽셀로 돌아온다.
- [ ] **Step 2:** 실패 확인. **Step 3:** 광선 시작점을 `d.foot`으로 바꾼다. **Step 4:** 싱크대 프레임 19장(스크래치패드 `closer-check/frames`)으로 컵 자리의 싱크볼 점 거리 평균을 상자 기준과 견줘 보고에 적는다(비용 0). **Step 5:** 커밋 `feat(world): place objects from the mask foot point`.

### Task 7: 폰이 분석용 사진을 100ms마다 보내기

**Files:**
- Modify: `ui/src/phone/core/ar.js:185-198`, `ui/src/phone/core/video-ar.js:341`, `ui/src/phone/core/engine.js`
- Test: `ui/tests/phone-ar.test.ts`, `ui/tests/phone-video.test.ts`(기존 엔진 프레임 시험)

- [ ] **Step 1: 실패하는 시험.** `engine_ms: 100`이면 1초 동안 엔진 프레임이 9~10장 나간다. 인코딩이 밀리면(`pipeline.canStart()`가 거짓) 그 엔진 프레임은 건너뛰고 쌓지 않는다. 같은 그림 틀에서 표시용 JPEG과 엔진 프레임이 둘 다 때가 되면 `grab`은 한 번만 한다(크기가 같을 때).
- [ ] **Step 2:** 실패 확인. **Step 3:** 구현(엔진 프레임도 `canStart`·`bufferedAmount` 검사를 거친다. 지금은 2초에 한 번이라 검사 없이 보낸다).
- [ ] **Step 4: 실제 폰 재기(사람이 함께).** 실제 폰 ⋯ 메뉴의 측정 줄에서 보낸 화면 fps·장당 readPixels·인코딩 시간을 100ms와 2000ms에서 읽는다. 표시 영상이 25fps 아래로 떨어지면 엔진 간격을 150ms로 올리고 보고한다. 영상 모드는 PC 크롬이라 `npm run heavy -- npx tsx scripts/video-check.ts --clip home-idle.mp4`의 `/api/brain` `detected`·`skipped`로 본다(실제 모델 비용이 드니 Task 9의 판정과 한 번에 한다).
- [ ] **Step 5:** 커밋 `feat(phone): send engine frames at the server's fast interval without queueing`.

### Task 8: 대시보드 폰 칸에 마스크만 그리기

**Files:**
- Create: `ui/src/dashboard/masks.ts`, `ui/tests/dashboard/masks.test.ts`
- Modify: `ui/src/dashboard/detections.ts`, `ui/src/dashboard/PhonePane.tsx`, `ui/src/dashboard/data.ts`(`useDash`가 `seen`을 받음), `ui/src/dashboard/Dashboard.tsx:169·234`, `ui/src/dashboard/DashboardScreen.tsx:33·57·81`, `scripts/twin3d/fake-run.ts:118`, `src/design/tokens.json`(마스크 색·투명도 토큰이 없으면 더함)

**Interfaces:**
- Consumes: `SeenEvent`(Task 5), `Mask`(Task 2).
- Produces: `paintMasks(ctx: CanvasRenderingContext2D, shapes, image: BoxSize, size: BoxSize, ceiling: number, colors: MaskColors): void`, `placeDetections`는 그대로 이름표 자리만 돌려준다(`left/top/width/height`는 마스크 테두리, 화면에 그리지 않음).

- [ ] **Step 1: 실패하는 시험.**
  - `paintMasks`는 1인 칸만 칠하고(가짜 ctx의 `fillRect`/`putImageData` 호출 자리), 영상과 같은 contain 배율·자리다. FSM 카드 아래(`ceiling`)에만 칠한다.
  - `PhonePane`에 네모 테두리 요소가 없다(기존 상자 요소의 testid가 사라짐). 이름표는 마스크 테두리 위에 그대로다.
  - `seen`이 600ms 넘게 안 오면 마스크와 이름표를 지운다(멈춘 그림이 남지 않게).
  - 영상이 안 보이면 그리지 않는다(지금 상자 규칙과 같다).
- [ ] **Step 2:** 실패 확인.
- [ ] **Step 3: 구현.** 마스크는 영상 위 `<canvas>` 한 장에 그린다: 칸 그림을 작은 `ImageData`로 만들어 `drawImage`로 키우고(`imageSmoothingEnabled = true`) 토큰 색·투명도 0.45로 칠한다. 색은 CSS 변수에서 읽는다(날 색 금지, `lint-ui-color`). canvas는 꾸밈 class 없이 배치만 한다. 21st.dev 부품 규칙(lint-ui-parts) 때문에 canvas 래퍼가 부품이어야 하면 지금 상자를 그리는 부품 파일(`ui/src/components/ui/` 안)을 고쳐 `// 바꾼 것:` 줄에 적는다.
- [ ] **Step 4: 화면 확인.** `npm run capture`로 대시보드 폰 칸을 찍어(컵·사람이 보이는 프레임) 사용자에게 보여 준다. 색·진하기는 사용자 확인을 받고 정한다.
- [ ] **Step 5:** `npm run lint`·`npm run heavy -- npx vitest run`·`ui` 시험 통과 후 커밋 `feat(dashboard): draw segmentation masks instead of boxes in the phone pane`.

### Task 9: 전체 확인

- [ ] **Step 1:** `npx tsc --noEmit -p .`, `npm run lint`, `npm run heavy -- npx vitest run`, ui 시험, `npm run heavy -- npm run build`(ui).
- [ ] **Step 2: 그림 간격.** `ui/scripts/measure-switch.mjs --mode visible`로 대시보드 가장 긴 그림 간격이 50ms 이하인지 본다(마스크를 초당 10번 그려도, CLAUDE.md 규칙).
- [ ] **Step 3: 실제 판정 1번(약 $0.03).** PAM과 서버를 새로 띄우고 `--record`로 사용자 영상 네 단계 판정을 돌린다. **기준:** 4/4·누른 단추 0번·27.8초 전 명령 없음, `/api/brain`의 `detected / 영상 길이`가 초당 8장 이상, `vlm.sent`가 지난 판(42~49장)과 같은 수준, 비용이 $0.04 이하. 명령 없음이면 한 번만 더 돌린다(모델 흔들림, 12번 중 3번).
- [ ] **Step 4:** 녹화 mp4에서 마스크가 물체를 따라가는지 프레임 4장을 뽑아 본다.
- [ ] **Step 5: 문서.** `docs` 저장소 구현명세서 SSOT(6.1 감지기·간격·호출량, 6.2 트윈 위치, 12절 폰 카메라 칸, 환경 변수), 변경이력, HJO 티켓·Daily. noonchi `docs/reference.md`·`CLAUDE.md` 규칙 표에 「화면에 네모 상자를 그리지 않는다 | `ui/tests/dashboard/…`」 한 줄.
- [ ] **Step 6:** Codex reviewer(herdr `w2:p5`)에게 브랜치 전체를 리뷰받고 지적을 고친다. `trail note`로 버린 길을 남긴다(커밋하지 않음).

## 정해야 할 것 (사용자)

1. **sharp 추가: 정함(2026-11-12, 추가한다).** JPEG 풀기 27ms → 약 3ms는 예상값이다. Task 3 Step 4에서 재고, 10ms를 넘으면 보고한다.
2. **마스크 색: 정함(2026-11-12, 종류마다 다른 색).** 사람·물건 종류·가전 설비마다 토큰 색 하나. 색약 모의 기준(`tests/design-contrast.test.ts`)을 넘는 조합으로 `src/design/tokens.json`에 넣고, Task 8 Step 4에서 그림을 보여 준다.
3. **실제 폰 부담.** 폰이 초당 10장을 더 인코딩한다. Task 7 Step 4에서 재 보고 표시 영상이 느려지면 간격을 올린다.

## Self-Review

- 요구 1(상자 없이 세그멘테이션만): Task 1·2(모델·풀기), Task 5(`observe.boxes` 지움), Task 8(화면).
- 요구 2(촬영 속도를 따라감): Task 3(한 장 80ms 이하), Task 5(모든 프레임 YOLO), Task 7(폰 100ms), Task 9 Step 3(초당 8장 이상 확인).
- 관절 모델 유지·3장에 1장: Task 3.
- 비용 그대로: Task 5 시험(VLM 제출 수), Task 9 Step 3.
- 위험: Task 4의 규칙 조사는 구현 전에 범위가 정해지지 않았다. 조사 표가 나오면 Task 4를 둘로 나눌 수 있다.
