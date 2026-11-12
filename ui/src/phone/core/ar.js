// 클로이드의 눈 AR(phone.js에서 옮겼다): WebXR AR로 폰 자세를 재고, 화면 가운데 조준점이 가리키는 바닥 점을 '여기'로 쓴다.
// 조준점은 hit-test 점이고, 없으면 시선이 어림 바닥(local-floor, 없으면 폰 1.5m 아래)과 만나는 점이다(aim.js aimPoint, hitEstimated).
// 자세(+조준점, 실제 hit이면 면 법선 hit_normal, 어림 바닥 높이 floor_y)는 초당 10번(서버 위치 맞추기가 벽 점·바닥 높이로 쓴다), 카메라 화면은 기본 초당 12장(가로 촬영 가로 480px·세로 360px JPEG, ?fps=·?w=로 바꾼다) /phone/events로 보낸다.
// 인코딩은 워커 두 개로 두 장까지 겹치고(capture.js), 순서가 뒤바뀐 오래된 프레임과 와이파이에 쌓인 프레임은 건너뛴다(pipeline.js).
// '사진 찍기'는 카메라 원본 크기로 한 장을 보내고, 서버가 그 순간의 눈 자세를 붙여 저장한다. 트윈 좌표 계산은 서버(src/phone)가 한다.
// 초점: 서버가 보낸 대상(AR 좌표)을 화면 표시(hooks.onMarks)와 대시보드로 가는 화면 프레임에 그린다(사진·엔진 프레임에는 그리지 않음).
// 엔진 프레임(서버 BRAIN=1): 서버가 상태 메시지 engine_ms로 알려 준 간격마다 분석용 JPEG을 따로 보낸다(촬영 순간 자세·투영 행렬·서버 시계 촬영 시각과 오차).
// 화면은 hooks로만 바꾼다: onStart·onEnd(덮개), onHit(조준점이 바닥에 닿음, 어림인지), onMarks(초점 표시), onPerf(1초마다 측정), note(잠깐 알릴 말).
// 끝나면 세션마다 만든 인코딩 워커·WebGL 컨텍스트·타이머를 놓는다.

import { createGrabber, framePacket } from "./capture.js";
import { createDisplayEncoder } from "./display-encoder.js";
import { engineStep, grabOnce } from "./engine.js";
import { createFramePipeline, createSendStats, frameWidth } from "./pipeline.js";
import { focusMarks } from "./project.js";
import { aimPoint, floorPlaneY, planeNormal } from "./aim.js";

const SEND_MS = 100;
const FRAME_QUALITY = 0.55; // 장 수를 늘린 만큼 한 장 크기를 줄인다(사진은 0.9)
const ENGINE_QUALITY = 0.8; // 엔진 프레임은 YOLO·VLM이 분석한다
const MAX_BUFFERED = 512 * 1024; // 와이파이가 느리면 프레임을 쌓지 않고 건너뛴다
const OPEN = 1; // WebSocket.OPEN
const clamp = (raw, lo, hi, fallback) => {
  const n = Number(raw);
  return raw !== null && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
// 이 AR 세션·추적 원점의 이름. 자세·기록·사진에 붙여, 연결이 끊겨 reset을 못 보내도 서버가 이전 원점의 맞춤을 버리게 한다
export const newEpoch = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const browser = {
  xr: () => navigator.xr,
  gl: () => document.createElement("canvas").getContext("webgl", { xrCompatible: true }),
  layer: (session, gl) => new XRWebGLLayer(session, gl),
  // 카메라 접근(camera-access)이 없으면 자세만 보낸다
  binding: (session, gl) => (typeof XRWebGLBinding === "function" ? new XRWebGLBinding(session, gl) : null),
  createGrabber,
  createDisplayEncoder,
};

/** link: link.js. params: 페이지 주소 검색값(fps·w·flip, 표시 영상 v*). deps: 시험이 XR·GL·카메라 잡기·표시 영상을 바꾼다. */
export function createAr({ link, params, hooks, deps = {} }) {
  const d = { ...browser, ...deps };
  const FRAME_MS = 1000 / clamp(params.get("fps"), 1, 30, 12);
  const FLIP = params.get("flip") !== "0";
  const pipeline = createFramePipeline({ maxInFlight: 2 });
  // 엔진 프레임은 따로 센다(한 번에 한 장): 표시 프레임과 번호를 섞으면 늦게 끝난 표시 프레임이 「순서 뒤바뀜」으로 버려진다
  const enginePipeline = createFramePipeline({ maxInFlight: 1 });
  const stats = createSendStats({ windowMs: 2000 });
  /** on(AR 중), epoch(원점 이름), hitPoint(조준점 바닥 점), hitEstimated(조준점이 어림 바닥), limited(추적 약함),
   *  position·orientation(마지막 폰 자세, 「여기서 시작」에 쓴다), size·encoder(측정 글). */
  const state = { on: false, epoch: null, hitPoint: null, hitEstimated: false, limited: false, position: null, orientation: null, size: "-", encoder: "-" };
  let session = null;
  let display = null; // 표시 영상(H.264, display-encoder.js). 분석용 JPEG와 따로 대시보드 화면에만 간다
  let wantPhoto = false;
  let engineMs = 0;
  let lastEngine = null;
  let lastSent = 0;
  let lastFrame = 0;
  let focus = { targets: [], until: 0 };
  const ws = () => link.socket();

  async function start(overlay) {
    // 전체 화면·가로 고정은 요청하지 않는다. DOM 오버레이도 전체 화면 기능을 써서, 같이 요청하면 AR 화면이 나오지 않았다.
    const xrSession = await d.xr().requestSession("immersive-ar", {
      requiredFeatures: ["local", "hit-test", "dom-overlay"],
      optionalFeatures: ["camera-access", "local-floor"],
      domOverlay: { root: overlay },
    });
    session = xrSession;
    hooks.onStart();
    const gl = d.gl();
    xrSession.updateRenderState({ baseLayer: d.layer(xrSession, gl) });
    const space = await xrSession.requestReferenceSpace("local");
    // 새 AR 세션은 좌표 원점이 새로 잡힌다: 이전 맞춤·기록을 버린다. 추적이 원점을 다시 잡아도(reset) 같다
    state.on = true;
    state.epoch = newEpoch();
    link.send({ type: "reset", epoch: state.epoch });
    space.addEventListener?.("reset", () => {
      state.epoch = newEpoch();
      link.send({ type: "reset", epoch: state.epoch });
      hooks.note("추적 원점이 바뀌어 맞춤을 지웠어요. 시작 위치에서 다시 맞춰 주세요");
    });
    const hitSource = await xrSession.requestHitTestSource({ space: await xrSession.requestReferenceSpace("viewer") });
    // 어림 바닥 높이: 크롬이 local-floor를 주면 그 원점의 local 높이를 프레임마다 읽는다
    const floorSpace = await xrSession.requestReferenceSpace("local-floor").catch(() => null);
    const binding = d.binding(xrSession, gl);
    const grabber = binding ? d.createGrabber(gl, { flipY: FLIP }) : null;
    state.encoder = grabber?.encoderMode ?? "카메라 없음";
    display = grabber ? d.createDisplayEncoder({ gl, flipY: FLIP, socket: ws, params, onError: hooks.note }) : null;
    let cameraSeen = false;
    const cameraTimer = setTimeout(() => {
      if (!cameraSeen) hooks.note("카메라 화면을 보낼 수 없어요. 위치만 보내요");
    }, 3000);
    const perfTimer = setInterval(hooks.onPerf, 1000);
    xrSession.addEventListener("end", () => {
      state.on = false;
      state.hitPoint = null;
      state.hitEstimated = false;
      state.position = null;
      state.orientation = null;
      display?.close();
      display = null;
      // 세션마다 새로 만드는 인코딩 워커·WebGL 컨텍스트를 놓는다(다시 시작할 때 쌓이지 않게)
      grabber?.close();
      gl.getExtension?.("WEBGL_lose_context")?.loseContext();
      clearTimeout(cameraTimer);
      clearInterval(perfTimer);
      session = null;
      hooks.onMarks([]);
      hooks.onEnd();
    });

    // always: 사진·엔진 프레임은 늘 보내고 표시 통계에 넣지 않는다. pipe: 인코딩 중인 장 수를 세는 곳(엔진 프레임은 enginePipeline)
    const sendFrame = (pixels, header, quality, marks, readMs, always, pipe = pipeline) => {
      const id = pipe.start();
      const t0 = performance.now();
      grabber.toJpeg(pixels, header.width, header.height, quality, marks)
        .then((jpeg) => {
          const encodeMs = performance.now() - t0;
          // 사진·엔진 프레임은 늘 보낸다. 화면 프레임은 더 새 프레임이 먼저 나갔으면 버린다(순서 뒤바뀜)
          if (!pipe.finish(id) && !always) {
            stats.skipped("stale");
            return;
          }
          if (ws()?.readyState !== OPEN) return;
          ws().send(framePacket(header, jpeg));
          if (!always) stats.sent({ bytes: jpeg.size, readMs, encodeMs });
        })
        .catch((error) => {
          pipe.fail(id);
          // 끝내면서 거절된 인코딩은 알리지 않는다
          if (session === xrSession) hooks.note(`화면을 보내지 못했어요: ${error.message}`);
        });
    };

    const onFrame = (time, frame) => {
      xrSession.requestAnimationFrame(onFrame);
      // 아무것도 그리지 않는다(투명). 카메라 화면 위에 DOM 오버레이만 보인다.
      gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const hit = frame.getHitTestResults(hitSource)[0]?.getPose(space);
      const ho = hit?.transform.orientation;
      const pose = frame.getViewerPose(space);
      const p = pose?.transform.position;
      const o = pose?.transform.orientation;
      const position = p ? [p.x, p.y, p.z] : null;
      const orientation = o ? [o.x, o.y, o.z, o.w] : null;
      const localFloorY = floorSpace ? frame.getPose?.(floorSpace, space)?.transform.position.y : null;
      const aim = aimPoint({
        hit: hit ? [hit.transform.position.x, hit.transform.position.y, hit.transform.position.z] : null,
        hitOrientation: ho ? [ho.x, ho.y, ho.z, ho.w] : null,
        viewer: position,
        viewerOrientation: orientation,
        localFloorY,
      });
      state.hitPoint = aim?.point ?? null;
      state.hitEstimated = aim?.estimated ?? false;
      hooks.onHit(Boolean(state.hitPoint), state.hitEstimated);

      if (!pose) return;
      const tracking = pose.emulatedPosition ? "limited" : "ok";
      state.limited = tracking === "limited";
      state.position = position;
      state.orientation = orientation;
      if (time - lastSent >= SEND_MS) {
        lastSent = time;
        // 실제 hit-test 점이면 그 면 법선(벽·바닥 가르기), 어림 바닥 점이면 법선 없음
        const normal = aim && !aim.estimated && aim.orientation ? planeNormal(aim.orientation) : null;
        link.send({
          type: "pose", position, orientation, tracking, hit: state.hitPoint, hit_estimated: state.hitEstimated,
          ...(normal ? { hit_normal: normal } : {}), floor_y: floorPlaneY(position[1], localFloorY), epoch: state.epoch,
        });
      }

      const xrView = pose.views[0];
      const marks = xrView && focus.targets.length && time < focus.until
        ? focusMarks(focus.targets, xrView.projectionMatrix, xrView.transform.inverse.matrix)
        : [];
      hooks.onMarks(marks);

      const camera = xrView?.camera;
      if (!grabber || !camera) return;
      cameraSeen = true;
      display?.frame(binding.getCameraImage(camera), camera, time);
      if (ws()?.readyState !== OPEN) return;
      const portrait = camera.height > camera.width;
      // 엔진 프레임 차례: 앞 엔진 프레임이 인코딩 중이거나 보낼 것이 쌓였으면 건너뛴다(쌓지 않는다)
      let engineSize = null;
      const step = engineStep({ last: lastEngine, now: time, intervalMs: engineMs, canStart: enginePipeline.canStart(), buffered: ws().bufferedAmount, maxBuffered: MAX_BUFFERED });
      lastEngine = step.last;
      if (step.action === "send") {
        const ew = Math.min(frameWidth(params.get("w"), portrait), camera.width);
        engineSize = { width: ew, height: Math.round((ew * camera.height) / camera.width) };
      } else if (step.action !== "wait") stats.skipped("engine");
      // 표시 프레임·사진 차례
      const photo = wantPhoto;
      let frameSize = null;
      if (photo || time - lastFrame >= FRAME_MS) {
        if (!photo && !pipeline.canStart()) stats.skipped("encoding");
        else if (!photo && ws().bufferedAmount > MAX_BUFFERED) stats.skipped("buffer");
        else {
          wantPhoto = false;
          lastFrame = time;
          const width = photo ? camera.width : Math.min(frameWidth(params.get("w"), portrait), camera.width);
          frameSize = { width, height: Math.round((width * camera.height) / camera.width) };
          if (!photo) state.size = `${frameSize.width}×${frameSize.height}`;
        }
      }
      if (!engineSize && !frameSize) return;
      // 둘 다 때가 됐고 크기가 같으면 카메라 그림은 한 번만 읽는다
      const image = binding.getCameraImage(camera);
      const [engineShot, frameShot] = grabOnce((w, h) => grabber.grab(image, w, h), [engineSize, frameSize]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
      const stamp = link.stamp(performance.timeOrigin + time);
      if (engineShot) {
        const engineHeader = { kind: "engine", ...engineSize, position, orientation, tracking, epoch: state.epoch, projection: Array.from(xrView.projectionMatrix), ...stamp };
        sendFrame(engineShot.pixels, engineHeader, ENGINE_QUALITY, [], engineShot.readMs, true, enginePipeline);
      }
      if (frameShot) {
        const header = { kind: photo ? "photo" : "frame", ...frameSize, position, orientation, tracking, epoch: state.epoch, ...stamp };
        sendFrame(frameShot.pixels, header, photo ? 0.9 : FRAME_QUALITY, photo ? [] : marks, frameShot.readMs, photo);
      }
    };
    xrSession.requestAnimationFrame(onFrame);
  }

  /** 측정: 위 상태 줄의 보낸 fps와 ⋯ 메뉴의 자세한 줄. */
  function perf() {
    const s = stats.snapshot();
    const ms = (v) => (v === null ? "-" : `${v.toFixed(1)}ms`);
    return {
      fps: `${s.fps.toFixed(1)} fps`,
      detail: [
        `보낸 화면 ${s.fps.toFixed(1)} / 목표 ${(1000 / FRAME_MS).toFixed(0)} fps · 장당 ${s.kbPerFrame === null ? "-" : `${s.kbPerFrame.toFixed(1)}KB`}`,
        `readPixels ${ms(s.readMs)} · 인코딩 ${ms(s.encodeMs)} (${state.encoder})`,
        `와이파이 대기 ${Math.round((ws()?.bufferedAmount ?? 0) / 1024)}KB · 크기 ${state.size}`,
        `2초간 건너뜀: 인코딩 중 ${s.skipped.encoding} · 버퍼 가득 ${s.skipped.buffer} · 순서 뒤바뀜 ${s.skipped.stale} · 분석용 사진 ${s.skipped.engine}`,
        display?.describe() ?? "표시 영상 꺼짐",
      ].join("\n"),
    };
  }

  return {
    state,
    start,
    stop: () => session?.end(),
    requestPhoto: () => { wantPhoto = true; },
    /** 서버 상태 engine_ms. 0보다 큰 숫자일 때만 바꾼다. */
    setEngineMs(ms) {
      if (typeof ms === "number" && ms > 0) engineMs = ms;
    },
    setFocus(targets, ttlMs) {
      focus = { targets: targets ?? [], until: performance.now() + (ttlMs ?? 8000) };
    },
    perf,
  };
}
