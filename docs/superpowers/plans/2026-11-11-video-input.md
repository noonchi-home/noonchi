# 영상 입력 모드 계획 (컵 치우기 하나)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** 폰 페이지가 실제 카메라 대신 영상을 틀고, 맞춘(동기화된) 고정 자세로 그 영상을 서버에 보낸다. 같은 화면에 서버의 단계 명령이 그 영상 위에 떠서, 지시가 맞는 때에 오는지 사람이 보고 판정한다. 컵 치우기 하나로 확인한다.

**구조:**
- 폰 페이지 `/phone/?clip=<파일>`이 영상 모드다. 서버 런타임 `runtime/videos/<파일>`을 같은 출처로 받아 `<video>`로 튼다.
- 실제 폰과 같은 길로 보낸다: 화면 프레임(JPEG 초당 12장), `engine_ms`마다 엔진 프레임, 자세.
- 위치는 설정 4단계에서 저장한 시작 자리·방향을 카메라 자리로 쓴다. 서버는 `start`의 `fixed: true`를 받으면 바로 「맞춤」(출처 `video`)으로 둔다.
- 명령 읽기(소리)와 늘 듣기는 끈다. 답은 화면의 「완료」·「승인」 단추로 한다.
- 명령이 온 영상 시각을 폰 페이지가 기록하고, 서버 기록(`/api/history`)과 합쳐 시각표를 낸다.

**같이 하는 것:**
- 대시보드 트윈의 클로이드 표시를 마스코트 인형 + 시야 원뿔(three.js)로 바꾼다. 맞춘 눈일 때만 보인다.
- 실제 폰 위 명령 줄을 상태 표시줄(배터리 줄) 아래로 내린다.

**기술:** Node 22 TypeScript 서버, React 폰·대시보드(`ui/`), three.js, ffmpeg(시험 영상 만들기만), Vitest, 헤드리스 크롬(CDP).

**출처:**
- 2026-11-09 회의 허정오 할 일: 실제 영상 입력 모드, 컵 치우기 끝까지
- 사용자 11-11 검사 의견 1~7
  1. 영상으로 시스템이 잘 도는지 확인하려는 것이다. 폰도 동기화된 상태로 같은 영상을 틀면서 맞는 때에 지시하는지 판정한다.
  2. trail을 쓴다(깔았다, 이 PC에만).
  3. 실제 모델은 1달러 안에서 돌린다.
  4. 시험 영상은 Pexels를 이어 붙인다.
  5. 마스코트 인형 + 원뿔로 동기화된 눈을 표시한다.
  6. 폰 명령 줄을 상태 표시줄 아래로 내린다.
  7. 영상 모드에서는 지시를 소리로 듣지 않는다.

## 지켜야 할 것

- 저장소 `CLAUDE.md` 규칙 표 전부.
  - 화면 부품: 21st.dev
  - 꾸밈 class 금지, 토큰 색만
  - 화면 글 규칙
  - 대시보드 입력창 없음
  - 단계 바뀜은 transform·opacity만, 그림 간격 50 ms
  - mock·live 같은 구조
  - 한 저장소
  - 무거운 일은 `npm run heavy`로 하나씩, 크롬도 하나씩
- 폰 화면(`ui/src/phone`, core 밖)에 날 `button`·`input`·`select`·`textarea`를 쓰지 않는다. `<video>`는 core 파일이 만든다.
- URL 칸 이름 `video`·`vsrc`는 이미 표시 영상 설정이라 쓰지 않는다. 영상 모드는 `clip`이다.
- 서버의 다른 맞춤 규칙(시작=어림, 물건·벽 기준)은 그대로 둔다. `fixed`일 때만 바로 맞춤이고, 그때는 물건·벽이 변환을 움직이지 않는다.
- 실제 OpenAI는 Task 8에서만 부른다(합계 1달러 안). 시험은 가짜 서버만 쓴다.
- 브랜치: `feat/video-mode`(origin/main에서). GitHub에 올리는 것은 사용자가 말할 때만.
- `.trail/`·`.claude/`는 커밋하지 않는다(`.git/info/exclude`에 넣었다).

## 시험 영상 (만들었다)

- `runtime/videos/cup-demo.mp4`
  - 76.3초, 720×1280, 25fps, 소리 없음
  - 아주 약한 잡음을 넣었다. 멈춘 화면도 프레임마다 달라 중복으로 버려지지 않는다.
- 내용
  - 0~27.8초: Pexels 4828603. 두 사람이 식탁에서 잔으로 마신다.
  - 27.8~36.3초: Pexels 4065943을 거꾸로. 손이 머그를 놓고 나간다.
  - 36.3~76.3초: 머그만 있다. 4065943 첫 1초를 왕복해 늘렸다.
- 맞는 때: 컵 치우기 첫 명령이 사람이 사라진 뒤(약 38~45초)에 오고, 그 전에는 오지 않아야 한다.
- 만든 명령은 Task 8 기록에 남긴다. `runtime/`은 커밋하지 않는다.

## 파일

| 파일 | 할 일 |
|---|---|
| `src/sync/aligner.ts` | 출처 `video`, `fixStart`, fixed면 `update` 건너뜀, `reset`·`confirmStart`가 fixed를 끔 |
| `src/phone/session.ts` | `start` 메시지 `fixed?: boolean` → `fixStart` |
| `src/server/static.ts` | `serveRange`(Range 206·416), `.mp4`·`.webm` 형식 |
| `src/phone/server.ts`, `src/server/home.ts` | `videoDir` 옵션, `GET /phone/videos/<이름>` |
| `ui/src/phone/core/video-ar.js` (+ `.d.ts`) | 영상 AR: `<video>`, 고정 자세·투영, 화면·엔진 프레임, `reset`·`start fixed`·`pose`, 명령 고리 자리 |
| `ui/src/phone/core/video-math.js` (+ `.d.ts`) | 세로 FOV·비율 → 투영 행렬, pitch → 자세, 화면 덮기(cover) 자리 바꾸기 |
| `ui/src/phone/controller.ts`, `ui/src/phone/state.ts` | `clip`이면 영상 모드: 지원 바로 됨, 소리·듣기 끔, `createVideoAr`, 명령 시각 기록. `SyncView.source`에 `video` |
| `ui/src/phone/PhoneScreen.tsx`, `ui/phone/index.html`, `ui/src/phone/layout-check.ts` | 위 줄을 상태 표시줄 아래로(`viewport-fit=cover`, 위 여백), 배치 검사에 위 여백 |
| `src/design/tokens.json` (+ `npm run tokens`) | 인형 색 토큰 `twin.cloid.doll` |
| `ui/src/twin3d/eye.ts`, `ui/src/twin3d/engine.ts`, `ui/src/dashboard/Dashboard.tsx`, `ui/src/dashboard/marks.ts` | 마스코트 인형 + 원뿔 그룹, `engine.setEye`, 맞춘 눈 연결, SVG 점·화살촉 빼기 |
| `scripts/video-check.ts` | 헤드리스 크롬으로 영상 모드를 열어 끝까지 틀고, 명령 시각·서버 기록을 합친 시각표를 찍음 |
| 시험 | `tests/video-fixed-pose.test.ts`, `tests/phone-server.test.ts`(영상 경로), `tests/video-mode-e2e.test.ts`, `ui/tests/phone-video.test.ts`, `ui/tests/phone-screen.test.tsx`(위 줄), `ui/tests/twin3d/eye.test.ts`, `ui/tests/dashboard/map-overlay.test.tsx`(인형) |
| 문서 | `README.md`, `docs/reference.md`, docs 저장소 구현명세서 SSOT 1.16·변경이력·Daily |

---

### Task 1: 고정 자세를 바로 맞춤으로 (서버)

**Files:** Modify `src/sync/aligner.ts`, `src/phone/session.ts`. Test `tests/video-fixed-pose.test.ts`

**Interfaces:**
- Produces:
  - `SyncSource = "start" | "objects" | "walls" | "video"`
  - `PoseAligner.fixStart(pose: StartPose, position: Vec3, orientation: Quat): void`
  - 폰 메시지 `{type:"start", position, orientation, epoch, fixed: true}`

- [ ] **Step 1: 실패하는 시험.** `PhoneSession`을 한양목련 평면도와 시작 자리로 만들고(`tests/phone-sync.test.ts`의 만들기 그대로), 아래를 본다.
  1. `{type:"reset", epoch:"v1"}` 뒤에 `{type:"start", fixed:true, position:[0,1.4,0], orientation: pitch −25°, epoch:"v1"}`를 보내면 `status().sync`가 `{state:"aligned", source:"video", started:true}`이고 `aligned`가 true다.
  2. `eyeAt([0,1.4,0], q, "ok", "v1")`의 평면 자리가 시작 자리이고 `yaw_deg`가 시작 방향이다.
  3. `viewAt(..., PROJECTION, "v1")`가 null이 아니다.
  4. 같은 뒤에 `landmarks`(냉장고 상자)를 여러 번 넣어도 변환이 그대로다.
  5. 새 `reset`이면 `state:"none"`이다.
  6. 시작 자리가 없는 세션에서 `start fixed`는 지금과 같은 오류 글이다.
  7. `fixed` 없는 `start`는 지금처럼 `estimated`다.
- [ ] **Step 2:** `npm run heavy -- npx vitest run tests/video-fixed-pose.test.ts` → FAIL
- [ ] **Step 3: 구현.** aligner에 아래를 넣는다.

```ts
// src/sync/aligner.ts
export type SyncSource = "start" | "objects" | "walls" | "video";
// 클래스 안
private fixed = false;
/** 영상 모드: 고정 카메라라 시작 자리가 곧 카메라 자리다. 바로 맞춤으로 두고 물건·벽으로 움직이지 않는다. */
fixStart(pose: StartPose, position: Vec3, orientation: Quat): void {
  this.confirmStart(pose, position, orientation);
  this.aligned = true; this.source = "video"; this.fixed = true; this.dirty = false;
}
// update() 맨 앞: if (this.fixed) return false;
// reset()·confirmStart() 앞부분: this.fixed = false;
```

session은 start 스키마에 `fixed: z.boolean().optional()`을 더하고(43줄 근처), 374줄 근처를 `msg.fixed ? this.sync.fixStart(...) : this.sync.confirmStart(...)`로 바꾼다. `tests/phone-sync.test.ts:61`이 status를 `toEqual`로 비교하면 그대로 통과하는지 본다(새 칸 없음).
- [ ] **Step 4:** 같은 명령과 `tests/phone-sync.test.ts`·`tests/sync-*.test.ts` → PASS
- [ ] **Step 5:** `git commit -m "feat(sync): treat a fixed start pose as aligned for the video mode"`

### Task 2: 영상 파일 내주기 (서버)

**Files:** Modify `src/server/static.ts`, `src/phone/server.ts`, `src/server/home.ts`. Test `tests/phone-server.test.ts`

**Interfaces:**
- Produces:
  - `serveRange(req: IncomingMessage, res: ServerResponse, root: string, rel: string, head: boolean): boolean`
  - `PhoneServerOptions.videoDir?: string`
  - 경로 `GET|HEAD /phone/videos/<[A-Za-z0-9_-]{1,64}.(mp4|webm)>`

- [ ] **Step 1: 실패하는 시험.** 임시 폴더에 10바이트 `a.mp4`를 두고 `videoDir`로 폰 서버를 띄운다. 아래를 본다.
  1. 그냥 받으면 200, `content-type: video/mp4`, `accept-ranges: bytes`, 본문 10바이트.
  2. `Range: bytes=2-5`면 206, `content-range: bytes 2-5/10`, 본문 4바이트.
  3. `Range: bytes=20-`면 416과 `content-range: bytes */10`.
  4. `/phone/videos/../x.mp4`, `/phone/videos/a.exe`, 없는 파일은 404.
  5. `videoDir`가 없으면 404.
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3: 구현.**
  - static.ts: 경로 안전 검사(113~121줄)를 `serveFile`과 같이 쓰고 `statSync`로 크기를 잰다. `Range` 하나(`bytes=s-e`, `bytes=s-`, `bytes=-n`)만 받는다. `createReadStream(file, {start, end})`. `TYPES`에 `.mp4: "video/mp4"`, `.webm: "video/webm"`.
  - server.ts: 130~133줄 사이에 가지를 둔다. home.ts 364줄 `createPhoneServer`에 `videoDir: join(runtimeDir, "videos")`를 넘긴다.
- [ ] **Step 4:** PASS
- [ ] **Step 5:** `git commit -m "feat(phone): serve runtime videos with range requests for the video mode"`

### Task 3: 맞춘 고정 자세로 컵 치우기 끝까지 (서버 시험)

**Files:** Test `tests/video-mode-e2e.test.ts`

**Interfaces:**
- Consumes: Task 1의 `start fixed`
- 다시 쓰는 것: `tests/mokryeon-e2e.test.ts`의 가짜 서버 준비, `PROJECTION`, `CUP_BOX`

- [ ] **Step 1: 시험.**
  - 준비
    - 한양목련(`HOME_ID: "mokryeon_180b"`)으로 띄운다.
    - `runtime/homes/mokryeon_180b/phone-start.json`에 식탁을 보는 시작 자리를 쓴다(`writeStartPose` 또는 `POST /api/phone/start-pose`).
    - `approvals.json`에 `task:컵 치우기` 승인을 쓴다.
    - 가짜 VLM은 컵을 `on_table`로, 가짜 PAM은 컵이 보이면 컵 치우기를 고른다.
    - `ScriptedDetector`: 처음 6장은 사람+컵, 그 뒤는 컵만.
  - Node 소켓 하나가 영상 폰 노릇을 한다.
    - `reset`, `start fixed`
    - 250ms마다 `pose`, `engine`. 같은 epoch·자세·`PROJECTION`
  - 본다
    1. 상태 `sync.source === "video"`, `aligned: true`
    2. 대시보드 `eye`에 `estimated`가 없다.
    3. 명령 「식탁으로 가 주세요」의 `target`이 null이 아니고, `vision`이 `식탁까지 \d+\.\dm`이다.
    4. 첫 명령은 사람이 사라진 뒤에만 온다(사람이 보이는 동안 command 없음).
    5. 「완료」 네 번이면 실행 `done`.
- [ ] **Step 2~4:** 처음부터 통과하면 Task 1 덕분이다. 실패하면 서버 쪽 원인을 고친다.
- [ ] **Step 5:** `git commit -m "test(video): run the cup task end to end from a fixed aligned pose"`

### Task 4: 폰 페이지 영상 모드

**Files:**
- Create `ui/src/phone/core/video-math.js`(+`.d.ts`), `ui/src/phone/core/video-ar.js`(+`.d.ts`)
- Modify `ui/src/phone/controller.ts`, `ui/src/phone/state.ts`
- Test `ui/tests/phone-video.test.ts`

**Interfaces:**
- Produces:
  - `projectionFromFov(vfovDeg: number, aspect: number): number[]` (16개, 열 우선, near 0.1, far 100)
  - `pitchQuat(pitchDeg: number): [number, number, number, number]`
  - `coverMap(frameW, frameH, screenW, screenH): (u: number, v: number) => [number, number]`
  - `createVideoAr(overlay, hooks: ArHooks, deps: VideoArDeps): PhoneAr`
    - `PhoneAr`(`core/ar.d.ts`)와 같은 형이라 controller·화면은 그대로 쓴다.
    - 덧붙이는 것: `videoTime(): number`(ms)
  - `VideoArDeps`
    - `clipUrl: string`
    - `fovDeg?: number`(기본 60), `pitchDeg?: number`(기본 −25), `heightM?: number`(기본 1.4)
    - `createVideo?`: 시험용. `currentTime`, `videoWidth`, `videoHeight`, `drawTo(ctx)`, `play()`, `onEnded`를 주는 대역
  - 주소 칸
    - `?clip=<이름>` (`/phone/videos/<이름>`)
    - 선택 `&fov=`, `&pitch=`, `&h=`
  - 기록 `window.__noonchiVideo = { t0, commands: [{ video_ms, id, step, text }] }`
    - `t0`: 재생 시작 순간의 서버 시계(ms)
    - console에도 `[video]` 줄을 남긴다. 화면 글이 아니라 글 규칙 밖이다.

- [ ] **Step 1: 실패하는 시험** (`ui/tests/phone-controller.test.ts`의 `make()`·`FakeSocket` 방식, 영상은 대역)
  1. `?clip=cup-demo.mp4`면 `support`가 바로 ready다(http여도).
  2. `Recognition`을 만들지 않는다.
  3. command가 와도 `speak`를 부르지 않는다.
  4. AR 시작(`startAr`)이면 보내는 순서가 `reset{epoch}` → `start{fixed:true, position:[0,1.4,0], orientation:pitchQuat(-25), epoch}`이고, 그 뒤 `pose`가 같은 자세로 온다.
  5. status `engine_ms: 2000`을 받고 대역 영상이 0.5초씩 6번 나아가면 `engine` 패킷이 1~2개다.
     - 헤더에 `projection`(16개), `position`, `orientation`, `epoch`, `captured_at`이 있다.
     - `frame` 패킷은 그보다 많다.
  6. command를 받으면 `__noonchiVideo.commands`에 그때 `videoTime()`과 글이 남는다.
  7. 서버 sync가 aligned면 「여기서 시작」 카드와 「시작 위치를 정해 주세요」 모달이 뜨지 않는다.
  8. `video-math` 표
     - `projectionFromFov(60, 9/16)`의 [5]는 `1/tan(30°)`, [0]은 그것을 비율로 나눈 값이다.
     - `coverMap(720,1280, 390,844)(0.5,0.5)`는 `[0.5,0.5]`다.
- [ ] **Step 2:** `npm run heavy -- npm --prefix ui test -- phone-video` → FAIL
- [ ] **Step 3: 구현**
  - **controller.ts**
    - `params`를 56줄 위로 옮긴다.
    - `clip`이면 다음으로 둔다.
      - `speak = (_t, done) => done()`
      - `Recognition = null`
      - `checkSupport` → ready
      - `createAr` 대신 `createVideoAr`
      - 표시 영상(H.264)은 끈다. JPEG 화면 프레임만 보낸다.
    - command를 받을 때 `ar.videoTime?.()`이 있으면 기록에 남긴다.
  - **video-ar.js**
    - `<video muted playsinline>`를 `overlay` 앞, `fixed inset-0`에 `object-fit: cover`로 둔다.
    - 영상 프레임마다(`requestVideoFrameCallback`, 없으면 rAF) 2D canvas에 그리고 기존 `createEncoder`·`framePacket`(`core/capture.js`)으로 보낸다.
      - 화면 프레임: 초당 12장, 긴 변 780, 품질 0.55
      - 엔진 프레임: `engineDue`(`core/engine.js`)일 때, 품질 0.8
    - 헤더 자세는 고정이다. `captured_at`·`time_err_ms`는 `link.stamp`를 쓴다.
    - 자세는 초당 10번 보낸다.
    - 명령 대상 고리는 고정 view 역행렬·투영으로 `focusMarks`(`core/project.js`)를 부르고, `coverMap`으로 화면 자리로 옮긴다.
    - 영상이 끝나면 프레임 보내기를 멈춘다. 반복하지 않는다.
  - **state.ts**: 28줄 `SyncView.source`에 `"video"`를 더한다.
- [ ] **Step 4:** PASS. `npm run lint`(폰 화면 규칙·글 규칙)도 통과
- [ ] **Step 5:** `git commit -m "feat(phone): play a clip as the camera with a fixed aligned pose in the video mode"`

### Task 5: 위 명령 줄을 상태 표시줄 아래로

**Files:** Modify `ui/src/phone/PhoneScreen.tsx:197`, `ui/phone/index.html:3`, `ui/src/phone/layout-check.ts`. Test `ui/tests/phone-screen.test.tsx:300`, `ui/tests/phone-app.test.tsx:176,184`

- [ ] **Step 1: 실패하는 시험**
  - 위 칸 class가 `pt-[calc(max(env(safe-area-inset-top),28px)+8px)]`를 갖는지 본다(`top-0` 그대로).
  - `layoutIssues`가 위 칸 첫 내용의 top이 36px 미만이면 「배치: 위 줄이 상태 표시줄과 겹침」을 내는지 본다.
- [ ] **Step 2:** FAIL
- [ ] **Step 3: 구현**
  - 197줄 `pt-2` → 위 class
  - index.html viewport에 `viewport-fit=cover`
  - layout-check에 그 검사
  - 엄지 자리와 세모 자리 계산은 그대로다(세모는 위 줄 아래 끝을 잰다).
- [ ] **Step 4:** PASS. `npm run capture` 폰 상태 20개 세로 크기 3개가 배치 오류 없이 찍힌다.
- [ ] **Step 5:** `git commit -m "fix(phone): keep the top command line below the status bar"`

### Task 6: 트윈의 마스코트 인형 + 시야 원뿔 (대시보드)

**Files:**
- Modify `src/design/tokens.json`(→ `npm run tokens`), `ui/src/twin3d/engine.ts`, `ui/src/dashboard/Dashboard.tsx`, `ui/src/dashboard/marks.ts`, `ui/src/dashboard/MapOverlay.tsx`
- Create `ui/src/twin3d/eye.ts`
- Test `ui/tests/twin3d/eye.test.ts`, `ui/tests/dashboard/map-overlay.test.tsx:106-123`, `ui/tests/dashboard/camera.test.ts:20`

**Interfaces:**
- Produces:
  - `createEyeDoll(): { group: THREE.Group; setEye(eye: EyeEvent | null): void }`
  - `TwinEngine.setEye(eye: EyeEvent | null): void`

- [ ] **Step 1: 실패하는 시험**
  - `setEye(null)`과 `estimated` 눈이면 그룹이 숨는다.
  - 맞춘 눈이면 보인다.
    - 인형 발이 그 방 바닥 높이, 평면 자리가 (x,y)다.
    - 원뿔 꼭짓점 높이가 `height_m`이다.
    - 원뿔 축이 `yaw_deg`·`pitch_deg` 방향이다.
  - `tracking:"limited"`면 원뿔 색이 `viz.cone.limited`다.
  - 대시보드 SVG에는 클로이드 점·화살촉이 없다. 카메라 맞춤용 `frame.robot`은 그대로다.
- [ ] **Step 2:** FAIL
- [ ] **Step 3: 구현**
  - **인형**: three.js 기본 도형 미어캣(높이 약 0.55m). 몸 캡슐, 크림색 배, 머리 구, 주둥이 원뿔, 귀 두 개, 검은 눈·코, 가슴 브랜드 색 점.
    - 색은 새 토큰 `twin.cloid.doll.{fur,belly,dark}`(`ui/public/brand/mascot.png`에서 잰 값)과 `brand`.
    - 마스코트 그림 금지 규칙(색 바꾸기·뒤집기·LG 표시 다시 그리기)은 2D 그림 규칙이고, 이 인형은 그림을 쓰지 않는다.
  - **원뿔**: `viz.cone` 토큰(길이 1.2, 면 불투명도 0.22, ok·limited 색)으로 열린 원뿔, 꼭짓점은 인형 눈높이 → `height_m`.
  - `depthTest:false`, 높은 `renderOrder`.
  - engine 생성자에서 장면에 넣는다(정적 합치기 뒤). `setEye` → `requestRender`.
  - `Dashboard.tsx` `BakedStage`가 effect로 `engine.setEye(dash.eye)`를 부른다(맞춘 눈만 오는 `reduceDash` 그대로).
  - `marks.ts`·`MapOverlay`에서 SVG 클로이드 점·화살촉을 뺀다.
  - 시험 106~123줄을 「SVG 클로이드 없음, 3D 인형이 맞춘 눈을 따름」으로 바꾼다. 「원뿔 없음」은 사용자 결정(11-11)으로 뒤집혔다.
- [ ] **Step 4:** PASS. `npm run lint`, `ui` 빌드, `ui/scripts/measure-switch.mjs --mode visible`로 가장 긴 그림 간격 50 ms 이하
- [ ] **Step 5:** `git commit -m "feat(twin): show the synced eye as a mascot doll with a view cone"`

### Task 7: 판정 도구 `scripts/video-check.ts`

**Files:** Create `scripts/video-check.ts`

**Interfaces:**
- Consumes: `scripts/twin3d/cdp.ts`의 `chromePath`·`launchChrome`·`openPage`·`closeChrome`, `scripts/twin3d/heavy.ts`의 `withHeavy`
- 명령: `npx tsx scripts/video-check.ts --clip cup-demo.mp4 [--phone http://127.0.0.1:8210] [--api http://127.0.0.1:8200] [--done-after 3] [--out runtime/videos/cup-demo.timeline.md]`

- [ ] **Step 1: 구현**
  - `withHeavy` 안에서 크롬 하나를 띄운다(390×844).
  - `<phone>/phone/?clip=<clip>`를 연다.
  - 「AR 시작」 단추를 `evaluate`로 누른다.
  - 영상이 끝날 때까지 1초마다 `window.__noonchiVideo`를 읽는다.
  - 새 명령이 뜨면 `--done-after`초 뒤 화면의 첫 답 단추(「승인」·「완료」)를 누른다. 0이면 누르지 않는다.
  - 끝나면 `GET <api>/api/history?since=<t0>&kinds=detection,decision,plan,execution&limit=5000`을 받는다. 줄마다 영상 시각 = `at_ms − t0`이다.
  - 폰이 받은 명령 시각과 합쳐 시각순 표를 찍고 `--out`에 쓴다.
    - 칸: 영상 시각, 종류, 글
    - 예: `00:41.2 · 사람 사라짐 · person_gone`, `00:44.8 · PAM · 컵 치우기`, `00:47.9 · 명령 · 식탁으로 가 주세요`
  - 마지막에 `GET <api>/api/brain` 비용(VLM)을 함께 적는다.
- [ ] **Step 2:** 가짜 서버(`scripts/twin3d/e2e-dashboard.ts`처럼 `startServer`+가짜 OpenAI·PAM)로 한 번 돌려 표가 나오는지 본다. 크롬은 하나만 띄운다.
- [ ] **Step 3:** `git commit -m "feat(video): add a checker that plays a clip on the phone page and prints the timing table"`

### Task 8: 실제 모델로 판정 (1달러 안)

- [ ] **Step 1: 띄우기**
  - PAM(`.env` 값을 넘겨 `uvicorn noonchi_pam.app:create_app --factory --port 8300`)
  - 서버(`BRAIN=1 HOME_ID=mokryeon_180b PHONE_PORT=8210 npm start`)
  - 모델: `.env` 그대로. VLM `gpt-5.4-nano`, PAM `gpt-5.4-nano`, 에이전트 `gpt-5.4-mini`
- [ ] **Step 2: 시작 자리** — 설정 4단계(`/setup/`)나 `POST /api/phone/start-pose`로 식탁 옆, 식탁을 보는 자리를 저장한다.
- [ ] **Step 3: 한 번 돌리기** — `npx tsx scripts/video-check.ts --clip cup-demo.mp4 --done-after 3`
  - 한 번 예상 비용
    - VLM 약 38장 × $0.0005 ≈ $0.02
    - PAM 약 16번
    - 계획 1~2번 ≈ $0.01~0.02
  - 합계 $0.1 안쪽. 최대 5번까지 돌리고, 누적 비용이 $0.8을 넘으면 멈춘다.
- [ ] **Step 4: 판정**
  - 첫 명령이 머그만 남은 뒤(36.3초 뒤)에 왔는지
  - 사람이 보이는 동안(0~36초)에 명령이 없었는지
  - 네 단계가 끝났는지
  - 시각표와 비용을 기록한다. 안 맞으면 원인(감지·VLM·PAM 판단·계획)을 시각표로 짚는다. 고치는 일은 사용자에게 먼저 말한다.
- [ ] **Step 5: 마무리**
  - lint, tsc, ui typecheck, 전체 시험(`npm run heavy -- npm test`), ui 빌드
  - README·`docs/reference.md`: 영상 모드 쓰는 법, 시작 자리 필요, 소리·듣기 꺼짐, 실제 폰 페이지와 같이 열지 않기
  - docs 저장소: 구현명세서 SSOT 1.16(9.6 영상 모드 고정 자세, 12 위 줄 여백·대시보드 인형), 변경이력, Daily 11-11
  - trail note: 판정에서 알게 된 것

## 범위 밖

- 영상 속 카메라가 움직이는 경우(자세 기록 파일). 오늘은 고정 카메라만이다.
- 토요일 촬영 자료(`DATASET_COLLECT`)를 다시 돌리기.
- 설정 4단계 iframe 뷰어의 원뿔(그 화면은 지울 예정인 iframe 길이다).
- 세탁물·에어컨 행동 빼기.
