# 클로이드의 눈: 폰 카메라 실시간 화면·위치 붙은 사진 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폰 AR 페이지가 카메라 화면을 초당 약 4장 JPEG로 보내 대시보드에 실시간으로 보이고, '사진 찍기'로 찍은 사진에는 그 순간의 트윈 좌표 눈 자세가 붙는다. 기준점 거리 차이가 허용값(기본 0.3m)을 넘으면 맞춤을 받지 않는다.

**Architecture:** 폰은 WebXR Raw Camera Access(`camera-access`)로 받은 카메라 텍스처를 WebGL로 줄여 JPEG로 만들고, 기존 `/phone/events` WebSocket에 바이너리 패킷(4바이트 헤더 길이 + JSON 헤더 + JPEG)으로 보낸다. 폰 서버는 프레임을 `EyeFeed`에 넘기고, 본 서버는 `/api/eye/stream`(MJPEG, `multipart/x-mixed-replace`)으로 대시보드 `<img>`에 흘린다. 사진은 `runtime/photos/`에 JPEG·JSON으로 저장하고 `/events`로 `{type:"photo"}`를 보낸다.

**Tech Stack:** Node 22 + TypeScript, ws 8(바이너리 메시지), zod 4, Vitest 5 · 브라우저 WebXR(`camera-access`, `XRWebGLBinding.getCameraImage`), WebGL1, Canvas `toBlob`

**Spec:** docs 브랜치 `proposal/dashboard-three-screens`의 구현명세서 5.7 촬영 위치(`measured_pose`, `pose_note`), 9.6(거리 차이 허용값), 12절 클로이드의 눈(실시간 화면은 '엔진 입력 아님'). 앞선 계획 `2026-10-24-phone-ar-eye.md`.

## Global Constraints

- 새 npm 의존성 없음. 웹 화면은 빌드 없는 ES 모듈.
- 실시간 화면은 표시 전용이며 판단(에이전트·정책)에 넣지 않는다. 화면에 '실시간 · 엔진 입력 아님'을 적는다.
- 프레임은 가로 최대 640px, 초당 최대 4장, JPEG 품질 0.6. 사진은 카메라 원본 크기, 품질 0.9.
- 폰 WebSocket 메시지는 최대 4MB. JPEG는 `FF D8`로 시작해야 한다.
- 거리 차이 허용값: `PHONE_MAX_MISMATCH_M`(기본 0.3).
- 사진 저장 폴더 `runtime/`는 커밋하지 않는다.
- 카메라 텍스처의 위아래 방향은 실제 폰에서만 확인할 수 있다. 기본은 뒤집어 읽고(`flipY`), 폰 페이지 `?flip=0`으로 바꿀 수 있게 한다.

## File Structure

- Modify `src/phone/session.ts`: 생성 옵션 `{ now?, maxMismatchM? }`, 허용값 초과 시 맞춤 거절, `eyeFor(position, orientation, tracking)`.
- Create `src/phone/packet.ts`: 바이너리 패킷 읽기·만들기.
- Create `src/phone/feed.ts`: 최신 프레임·MJPEG 스트림·사진 저장과 `/api/eye/*` 응답.
- Modify `src/phone/server.ts`: 바이너리 메시지 → feed, `maxPayload` 4MB, 사진 저장 응답.
- Modify `src/server/app.ts`: `AppOptions.eye`가 있으면 `/api/eye/*`를 넘기고 health에 `eye: true`.
- Modify `src/server/start.ts`: `PHONE_PORT`면 `EyeFeed`(사진 폴더 `runtime/photos`) 생성·연결, `PHONE_MAX_MISMATCH_M`.
- Create `web/phone/capture.js`: 카메라 텍스처 → 픽셀 → JPEG.
- Modify `web/phone/phone.js`, `web/phone/index.html`: `camera-access`, 프레임 전송, '사진 찍기'.
- Modify `web/index.html`, `web/app.js`, `web/style.css`: 3D 위 '클로이드의 눈' 화면, 사진 메시지.
- Modify `.gitignore`(`runtime/`), `docs/plan.md`, `docs/reference.md`.
- Tests: `tests/phone-session.test.ts`(수정), `tests/phone-packet.test.ts`, `tests/phone-feed.test.ts`, `tests/phone-server.test.ts`(추가).

---

### Task 1: 거리 차이 허용값과 `eyeFor`

**Files:** Modify `src/phone/session.ts`, `tests/phone-session.test.ts`

**Interfaces:**
- Produces: `new PhoneSession(targets, { now?: () => Date; maxMismatchM?: number })`(기본 0.3), `DEFAULT_MAX_MISMATCH_M = 0.3`, `session.eyeFor(position: Vec3, orientation: Quat, tracking: "ok"|"limited"): EyeEvent | null`

- [ ] **Step 1: Failing tests** — 기존 `new PhoneSession(TARGETS, () => …)`를 `{ now: () => … }`로 바꾸고 추가:

```ts
it("거리 차이가 허용값을 넘으면 맞추지 않고 다시 찍으라고 한다", () => {
  const s = new PhoneSession(TARGETS);
  s.handle({ type: "anchor", id: "dock", point: [3.9, 0, 5.51] });
  const far: [number, number, number] = [3.9 + (2.4 - 3.9) * 1.5, 0, 5.51 + (3.55 - 5.51) * 1.5];
  const r = s.handle({ type: "anchor", id: "door_main", point: far });
  expect(r.reply).toMatchObject({ aligned: false });
  expect(r.reply?.error).toContain("123cm");
});

it("허용값을 크게 주면 같은 기준점도 받아들인다", () => {
  const s = new PhoneSession(TARGETS, { maxMismatchM: 2 });
  s.handle({ type: "anchor", id: "dock", point: [3.9, 0, 5.51] });
  const far: [number, number, number] = [3.9 + (2.4 - 3.9) * 1.5, 0, 5.51 + (3.55 - 5.51) * 1.5];
  expect(s.handle({ type: "anchor", id: "door_main", point: far }).reply).toMatchObject({ aligned: true, mismatch_m: 1.23 });
});

it("eyeFor: 맞춘 뒤에만 눈 자세를 준다", () => {
  expect(new PhoneSession(TARGETS).eyeFor([0, 1, 0], [0, 0, 0, 1], "ok")).toBeNull();
  expect(aligned().eyeFor([3.9, 1.4, 5], [0, 0, 0, 1], "ok")).toMatchObject({ position: [3.9, 5], height_m: 1.4 });
});
```

(1.5배 거리: 트윈 2.468m, 실제 3.702m → 차이 1.234m → "123cm".)

- [ ] **Step 2:** `npx vitest run tests/phone-session.test.ts` → FAIL (`aligned: true`, `eyeFor is not a function`)
- [ ] **Step 3: Implement** — 생성자 `(targets, opts = {})`, `this.now = opts.now ?? (() => new Date())`, `this.maxMismatchM = opts.maxMismatchM ?? DEFAULT_MAX_MISMATCH_M`. `solveAlignment` 뒤:

```ts
if (al.mismatchM > this.maxMismatchM) {
  const cm = Math.round(al.mismatchM * 100);
  return { reply: this.status(`실제 거리와 트윈 거리가 ${cm}cm 달라요(허용 ${Math.round(this.maxMismatchM * 100)}cm). 기준점을 다시 찍어 주세요`) };
}
this.alignment = al;
```

`eyeFor`는 맞춤이 없으면 `null`, 있으면 `{ ...toTwin(...), tracking, at: this.now().toISOString() }`. `handle`의 pose 분기는 `eyeFor`를 쓴다.
- [ ] **Step 4:** 같은 명령 → PASS
- [ ] **Step 5: Commit** `feat(phone): 거리 차이 허용값을 넘으면 맞춤을 받지 않는다`

### Task 2: 바이너리 패킷 (`packet.ts`)

**Files:** Create `src/phone/packet.ts`, `tests/phone-packet.test.ts`

**Interfaces:**
- Produces: `FrameHeader { kind: "frame"|"photo"; width: number; height: number; position?: Vec3; orientation?: Quat; tracking?: "ok"|"limited" }`, `encodeFramePacket(header, jpeg: Uint8Array): Buffer`, `parseFramePacket(buf: Buffer): { header: FrameHeader; jpeg: Buffer } | { error: string }`, `MAX_PACKET_BYTES = 4 * 1024 * 1024`

- [ ] **Step 1: Failing tests**

```ts
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
it("헤더와 JPEG를 왕복한다", () => {
  const header = { kind: "photo" as const, width: 1920, height: 1440, position: [1, 1.4, 2] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], tracking: "ok" as const };
  const out = parseFramePacket(encodeFramePacket(header, JPEG));
  expect(out).toEqual({ header, jpeg: JPEG });
});
it("짧은 패킷·깨진 헤더·JPEG 아님·잘못된 크기는 이유를 준다", () => {
  expect(parseFramePacket(Buffer.from([0, 0]))).toEqual({ error: "패킷이 너무 짧습니다" });
  const bad = Buffer.concat([Buffer.from([0, 0, 0, 3]), Buffer.from("{x}"), JPEG]);
  expect(parseFramePacket(bad)).toEqual({ error: "헤더 JSON을 읽지 못했습니다" });
  expect(parseFramePacket(encodeFramePacket({ kind: "frame", width: 640, height: 480 }, Buffer.from([1, 2])))).toEqual({ error: "JPEG가 아닙니다" });
  expect("error" in parseFramePacket(encodeFramePacket({ kind: "frame", width: 0, height: 480 }, JPEG))).toBe(true);
});
```

- [ ] **Step 2:** `npx vitest run tests/phone-packet.test.ts` → FAIL (module missing)
- [ ] **Step 3: Implement** — 앞 4바이트 big-endian 헤더 길이(최대 4096), UTF-8 JSON, zod 검사(`width`/`height` 1~8192 정수), 나머지가 `FF D8`로 시작하는지 확인. `encodeFramePacket`은 같은 형식으로 만든다.
- [ ] **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(phone): 카메라 프레임 바이너리 패킷`

### Task 3: `EyeFeed` (최신 프레임·MJPEG·사진)

**Files:** Create `src/phone/feed.ts`, `tests/phone-feed.test.ts`

**Interfaces:**
- Consumes: `EyeEvent`
- Produces: `PhotoRecord { id; at; url; width; height; measured_pose: EyeEvent | null; pose_note?: "not_aligned" }`, `class EyeFeed({ photoDir, broadcast, now? })` with `pushFrame(jpeg, width, height)`, `savePhoto(jpeg, width, height, eye: EyeEvent | null): PhotoRecord`, `handle(req, res, path): boolean`(`GET /api/eye/frame.jpg`, `/api/eye/stream`, `/api/eye/photos/<id>.jpg`), `close()`

- [ ] **Step 1: Failing tests** — 작은 HTTP 서버에 `feed.handle`을 물려서:
  - 프레임 전 `/api/eye/frame.jpg` → 404, `pushFrame` 뒤 → 200 `image/jpeg`, 본문 = JPEG
  - `/api/eye/stream`을 열고 `pushFrame` 두 번 → 응답 본문에 `--eyeframe`과 두 JPEG가 순서대로 들어 있음, content-type `multipart/x-mixed-replace; boundary=eyeframe`
  - `savePhoto(JPEG, 1920, 1440, eye)` → `photoDir`에 `<id>.jpg`·`<id>.json`, broadcast `{type:"photo", photo}`, `photo.measured_pose === eye`; `eye`가 null이면 `pose_note: "not_aligned"`; `/api/eye/photos/<id>.jpg` → 200, `../x.jpg` 같은 id → 404
- [ ] **Step 2:** FAIL (module missing)
- [ ] **Step 3: Implement** — MJPEG 파트: `--eyeframe\r\nContent-Type: image/jpeg\r\nContent-Length: N\r\n\r\n` + JPEG + `\r\n`. 클라이언트 버퍼가 1MB를 넘으면 그 프레임은 건너뛴다. 사진 id는 `YYYYMMDDTHHMMSS-<순번>`, id 검사 `/^[\w-]+$/`.
- [ ] **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(phone): 눈 화면 MJPEG 스트림과 사진 저장`

### Task 4: 서버 연결 (폰 서버 바이너리, 본 서버 `/api/eye/*`, 시작)

**Files:** Modify `src/phone/server.ts`, `src/server/app.ts`, `src/server/start.ts`, `.gitignore`; Test `tests/phone-server.test.ts`, `tests/phone-start.test.ts`

**Interfaces:**
- Consumes: Task 1~3
- Produces: `createPhoneServer({ ..., feed?: EyeFeed, maxMismatchM? })`, 폰 응답 `{type:"photo_saved", id, aligned}`, `AppOptions.eye?: { handle(req, res, path): boolean }`, health `eye: boolean`, env `PHONE_MAX_MISMATCH_M`

- [ ] **Step 1: Failing tests** — `tests/phone-server.test.ts`에:
  - 폰 WS로 `frame` 패킷 → 본 서버 `GET /api/eye/frame.jpg` 200, 같은 JPEG
  - 맞춘 뒤 `photo` 패킷(자세 포함) → 폰이 `{type:"photo_saved", aligned:true}`를 받고 본 서버 `/events`에 `{type:"photo"}`, `measured_pose.position` = 기대 좌표
  - 깨진 바이너리 → 폰이 `status`에 `error`
  - `/api/health`에 `eye: true`
  `tests/phone-start.test.ts`에: `PHONE_MAX_MISMATCH_M: "2"`로 띄우면 1.5배 거리 기준점도 맞춤.
- [ ] **Step 2:** FAIL
- [ ] **Step 3: Implement** — 폰 서버 `ws.on("message", (data, isBinary) => …)`에서 바이너리면 `parseFramePacket` → `frame`: `feed.pushFrame`, `photo`: `eye = header.position && header.orientation ? session.eyeFor(...) : null` → `feed.savePhoto` → `photo_saved` 응답. `WebSocketServer({ maxPayload: MAX_PACKET_BYTES })`. 본 서버 `handle()`에서 `/api/` 라우팅 전에 `opts.eye?.handle(req, res, path)`(GET·HEAD만). `start.ts`는 `let app` 앞에서 `const feed = new EyeFeed({ photoDir: join(<twin-home>/runtime/photos), broadcast: (m) => app.broadcast(m) })`를 만들어 `createApp({ …, eye: feed })`와 폰 서버에 넘기고, 닫을 때 `feed.close()`.
- [ ] **Step 4:** `npx vitest run tests/phone-*.test.ts tests/server.test.ts` → PASS, `npm run typecheck` 통과
- [ ] **Step 5: Commit** `feat(phone): 프레임·사진을 본 서버 /api/eye와 /events로 잇는다`

### Task 5: 폰 페이지 카메라 캡처

**Files:** Create `web/phone/capture.js`; Modify `web/phone/phone.js`, `web/phone/index.html`, `web/phone/phone.css`

**Interfaces:**
- Produces: `createGrabber(gl, { flipY = true })` → `{ grab(texture, width, height): Uint8Array, toJpeg(pixels, width, height, quality): Promise<Blob> }`

- [ ] **Step 1:** 헤드리스 Chrome 검사 스크립트(스크래치)로, `UNPACK_FLIP_Y_WEBGL`로 올린 위·아래 두 색 텍스처를 `grab` → `toJpeg` → 디코드했을 때 위쪽이 위 색인지 확인한다. 구현 전 실행 → 모듈 없음으로 실패.
- [ ] **Step 2: Implement** — 전체 화면 삼각형으로 텍스처를 FBO(RGBA, 요청 크기)에 그리고 `readPixels`. `flipY`면 셰이더에서 `1.0 - uv.y`. `toJpeg`는 2D 캔버스 `putImageData` → `toBlob`. `phone.js`: `optionalFeatures`에 `camera-access`, `new XRWebGLBinding(session, gl)`, 프레임 콜백에서 250ms마다(또는 '사진 찍기' 직후) `getCameraImage(view.camera)` → `grab` → XR 프레임버퍼로 되돌림 → JPEG → `encodeFramePacket`과 같은 형식으로 전송. `ws.bufferedAmount`가 512KB를 넘거나 인코딩 중이면 건너뛴다. 카메라 접근이 없으면 상태 줄에 알린다. `?flip=0`이면 `flipY:false`.
- [ ] **Step 3:** 검사 스크립트 → PASS, `node --check web/phone/*.js`
- [ ] **Step 4: Commit** `feat(phone): AR 카메라 화면을 JPEG로 보내고 사진 찍기`

### Task 6: 대시보드 '클로이드의 눈'과 문서

**Files:** Modify `web/index.html`, `web/app.js`, `web/style.css`, `docs/plan.md`, `docs/reference.md`

- [ ] **Step 1:** 3D 영역 왼쪽 위에 `<figure id="eye" hidden>`(실시간 `<img src="/api/eye/stream">`, 캡션 '클로이드의 눈 · 실시간 · 엔진 입력 아님'). health `eye`가 참일 때 보이고, 스트림이 끊기면 2초 뒤 다시 붙는다. `/events`의 `photo`는 대화에 사진 메시지(썸네일 + '위치 (x, y) · 방향 N° · 높이 h m' 또는 '위치 모름(맞추기 전)').
- [ ] **Step 2:** 헤드리스 Chrome 종단 검사(스크래치): 서버 + 가짜 폰(브라우저 캔버스로 만든 JPEG 프레임·사진) → 대시보드에서 `#eye` 보임, `img.naturalWidth > 0`, 사진 메시지 1개, 콘솔 오류 0.
- [ ] **Step 3:** `docs/plan.md` "폰 AR 눈"에 패킷·`/api/eye/*`·`photo` 이벤트·허용값, `docs/reference.md`에 사용법.
- [ ] **Step 4:** 전체 `npm run typecheck && npx vitest run`, twin-studio `node --test`
- [ ] **Step 5: Commit** `feat(web): 대시보드에 클로이드의 눈 실시간 화면과 사진`
