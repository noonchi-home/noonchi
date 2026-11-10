// 영상 입력 모드(폰 페이지 ?clip=<이름>): 실제 카메라 대신 /phone/videos/<이름> 영상을 틀고, 고정 카메라로 실제 폰과 같은 길로 보낸다.
// 자세: 높이 1.4m에서 아래 25°(?h=·?pitch=, 시야각 ?fov= 기본 60°). 바닥은 AR y 0이다. 시작하면 reset → start{fixed:true}를 보내 서버가
// 시작 자리를 카메라 자리로 바로 맞춘다(src/sync aligner fixStart). 서버 맞춤이 없어지면(못 보냄·다시 붙음·서버 다시 띄움) syncStatus가
// start fixed를 다시 보낸다. 그 뒤 자세는 초당 10번, 화면 프레임은 초당 12장(긴 변 780, 품질 0.55), 엔진 프레임은 서버
// engine_ms마다(품질 0.8, 고정 투영 행렬·서버 시계 촬영 시각). 표시 영상(H.264)은 만들지 않는다. 영상이 끝나면 프레임을 멈추고 다시 틀지 않는다.
// 재생을 기다리는 동안 다시 시작하면 같은 시작을 기다리고(영상은 하나), 그 사이 끝내면 그 영상을 닫고 시작하지 않는다.
// 명령 대상 고리는 고정 view·투영으로 잡고(focusMarks), 화면에는 영상이 덮인 자리(coverMap)로 옮겨 그린다.
// 판정 기록 window.__noonchiVideo(t0: 재생 시작 서버 시각, commands: 받은 명령의 영상 시각)과 console [video] 줄은 scripts/video-check.ts가 읽는다.
// PhoneAr(ar.d.ts)와 같은 형이라 controller·화면은 그대로 쓴다. 시험은 deps로 영상·인코딩·그림판을 바꾼다(jsdom은 영상을 틀지 못한다).

import { createEncoder, framePacket } from "./capture.js";
import { engineDue } from "./engine.js";
import { createFramePipeline, createSendStats, frameWidth } from "./pipeline.js";
import { focusMarks, toEdge } from "./project.js";
import { floorRayPoint } from "./aim.js";
import { newEpoch } from "./ar.js";
import { coverMap, pitchQuat, projectionFromFov, viewMatrix } from "./video-math.js";

const SEND_MS = 100;
const FRAME_LONG = 780;
const FRAME_QUALITY = 0.55;
const ENGINE_QUALITY = 0.8;
const MAX_BUFFERED = 512 * 1024;
const OPEN = 1; // WebSocket.OPEN
const clamp = (raw, lo, hi, fallback) => {
  const n = Number(raw);
  return raw !== null && raw !== "" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const phoneNow = () => performance.timeOrigin + performance.now();

/** 페이지 주소 → 영상 모드 설정. clip이 없으면 null(실제 카메라). */
export function videoParams(params) {
  const clip = params.get("clip");
  if (!clip) return null;
  return {
    clipUrl: `/phone/videos/${encodeURIComponent(clip)}`,
    fovDeg: clamp(params.get("fov"), 20, 120, 60),
    pitchDeg: clamp(params.get("pitch"), -89, 89, -25),
    heightM: clamp(params.get("h"), 0.2, 3, 1.4),
  };
}

/** 판정 기록(window.__noonchiVideo). 없으면 만든다. */
export function videoRecord(target = globalThis) {
  target.__noonchiVideo ??= { t0: null, ended: false, commands: [] };
  return target.__noonchiVideo;
}

const clockText = (ms) => {
  const s = Math.max(0, ms) / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

/** 받은 명령을 그 영상 시각으로 기록한다. 같은 단계·글(비전 상태만 바뀐 것)은 한 번만. */
export function logVideoCommand(videoMs, { id, step, text }) {
  const record = videoRecord();
  const last = record.commands.at(-1);
  if (last && last.id === id && last.step === step && last.text === text) return;
  record.commands.push({ video_ms: Math.round(videoMs), id, step, text });
  console.info(`[video] ${clockText(videoMs)} 명령 ${text} (${step})`);
}

/** 브라우저 영상: <video muted playsinline>, 화면 전체를 덮는다(object-fit cover). 프레임마다 requestVideoFrameCallback, 없으면 rAF. */
function browserVideo(url) {
  const el = document.createElement("video");
  el.muted = true;
  el.playsInline = true;
  el.preload = "auto";
  el.setAttribute("muted", "");
  el.setAttribute("playsinline", "");
  el.setAttribute("aria-hidden", "true");
  el.dataset.phoneVideo = "";
  el.style.position = "fixed";
  el.style.inset = "0";
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.objectFit = "cover";
  el.style.pointerEvents = "none";
  el.src = url;
  return {
    element: el,
    get currentTime() { return el.currentTime; },
    get videoWidth() { return el.videoWidth; },
    get videoHeight() { return el.videoHeight; },
    get ended() { return el.ended; },
    drawTo(ctx, width, height) { ctx.drawImage(el, 0, 0, width, height); },
    play: () => el.play(),
    nextFrame(cb) {
      if (typeof el.requestVideoFrameCallback === "function") el.requestVideoFrameCallback((now) => cb(now));
      else requestAnimationFrame((now) => cb(now));
    },
    onEnded(cb) { el.addEventListener("ended", cb, { once: true }); },
    close() {
      el.pause();
      el.removeAttribute("src");
      el.load();
      el.remove();
    },
  };
}

const browser = {
  createVideo: browserVideo,
  createEncoder: () => createEncoder(),
  createCanvas: () => document.createElement("canvas"),
  screen: () => ({ width: innerWidth, height: innerHeight }),
};

/** link: link.js. params: 페이지 주소 검색값(fps). deps: clipUrl·fovDeg·pitchDeg·heightM, 시험은 영상·인코딩·그림판·화면 크기를 바꾼다. */
export function createVideoAr({ link, params, hooks, deps }) {
  const d = { ...browser, ...deps };
  const FRAME_MS = 1000 / clamp(params.get("fps"), 1, 30, 12);
  const height = d.heightM ?? 1.4;
  const position = [0, height, 0];
  const orientation = pitchQuat(d.pitchDeg ?? -25);
  const view = viewMatrix(position, orientation);
  const pipeline = createFramePipeline({ maxInFlight: 2 });
  const stats = createSendStats({ windowMs: 2000 });
  const state = { on: false, epoch: null, hitPoint: null, hitEstimated: false, limited: false, position: null, orientation: null, size: "-", encoder: "-" };
  let run = null; // 지금 재생: { video, videoTime, close }
  let opening = null; // 재생을 기다리는 중: { video, cancelled, done }
  let startedOn = null; // start fixed를 보내고 답을 기다리는 소켓(다시 붙으면 다른 소켓이다)
  let engineMs = 0;
  let focus = { targets: [], until: 0 };
  const ws = () => link.socket();

  const sendStart = () => {
    if (link.send({ type: "start", position, orientation, epoch: state.epoch, fixed: true })) startedOn = ws();
  };

  function start(overlay) {
    if (run) return Promise.resolve();
    // 재생을 기다리는 동안 또 누르면 같은 시작을 기다린다
    if (opening) return opening.done;
    const wait = { video: null, cancelled: false, done: null };
    opening = wait;
    wait.done = open(overlay, wait).finally(() => {
      if (opening === wait) opening = null;
    });
    return wait.done;
  }

  async function open(overlay, wait) {
    const video = d.createVideo(d.clipUrl);
    wait.video = video;
    // 덮개(canvas·위 줄·엄지 자리)보다 먼저 두어 그 밑에 깔린다. React 뿌리 밖(body 맨 앞)에 둔다
    if (video.element) (overlay?.ownerDocument ?? document).body.prepend(video.element);
    try {
      await video.play();
    } catch {
      // 기다리는 동안 끝냈으면 stop이 이미 닫았다
      if (wait.cancelled) return;
      video.close();
      throw new Error("영상을 열지 못했어요");
    }
    if (wait.cancelled) return;
    const fw = video.videoWidth;
    const fh = video.videoHeight;
    const portrait = fh > fw;
    const projection = projectionFromFov(d.fovDeg ?? 60, fw / fh);
    const encoder = d.createEncoder();
    const canvas = d.createCanvas();
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const record = videoRecord();
    record.t0 = Math.round(phoneNow() - video.currentTime * 1000);
    record.ended = false;
    record.commands = [];
    let clockFixed = false;
    let ended = false;
    let due = 0;
    let lastEngine = null;

    hooks.onStart();
    state.on = true;
    state.epoch = newEpoch();
    state.position = position;
    state.orientation = orientation;
    state.encoder = encoder.mode;
    startedOn = null;
    link.send({ type: "reset", epoch: state.epoch });
    sendStart();
    console.info(`[video] 재생 시작 ${d.clipUrl} ${fw}×${fh} t0=${record.t0}`);

    // 조준점: 시선이 바닥(AR y 0)과 만나는 점. 높이를 알아 어림 바닥(floorPlaneY)을 쓰지 않는다
    state.hitPoint = floorRayPoint(position, orientation, 0);
    state.hitEstimated = state.hitPoint !== null;
    hooks.onHit(Boolean(state.hitPoint), state.hitEstimated);

    // 화면 고리: 영상 자리를 화면 덮기 자리로. 잘려서 화면 밖이면 가장자리 세모
    const toScreen = (m) => {
      const s = d.screen();
      const [u, v] = coverMap(fw, fh, s.width, s.height)(m.u, m.v);
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return { ...m, u, v };
      const e = toEdge({ u, v });
      return { ...m, u: e.u, v: e.v, off: true, angle: e.angle };
    };
    const frameMarks = () => (focus.targets.length && performance.now() < focus.until ? focusMarks(focus.targets, projection, view) : []);
    const showMarks = (marks) => hooks.onMarks(marks.map(toScreen));

    const sendPose = () => {
      link.send({
        type: "pose", position, orientation, tracking: "ok", hit: state.hitPoint, hit_estimated: state.hitEstimated,
        floor_y: 0, epoch: state.epoch,
      });
      // 영상이 끝난 뒤에도 명령 고리는 고친다(프레임 고리가 멈춘다)
      if (ended) showMarks(frameMarks());
    };
    sendPose();
    const poseTimer = setInterval(sendPose, SEND_MS);
    const perfTimer = setInterval(hooks.onPerf, 1000);

    /** 영상을 width×height로 그린 RGBA 픽셀(위 줄부터). */
    const grab = (width, h) => {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== h) canvas.height = h;
      video.drawTo(ctx, width, h);
      return new Uint8Array(ctx.getImageData(0, 0, width, h).data.buffer);
    };

    // always: 엔진 프레임은 늘 보내고 표시 통계에 넣지 않는다
    const sendFrame = (pixels, header, quality, marks, readMs, always) => {
      const id = pipeline.start();
      const t0 = performance.now();
      encoder.encode(pixels, header.width, header.height, quality, marks)
        .then((jpeg) => {
          const encodeMs = performance.now() - t0;
          if (!pipeline.finish(id) && !always) {
            stats.skipped("stale");
            return;
          }
          if (ws()?.readyState !== OPEN) return;
          ws().send(framePacket(header, jpeg));
          if (!always) stats.sent({ bytes: jpeg.size, readMs, encodeMs });
        })
        .catch((error) => {
          pipeline.fail(id);
          if (run === current) hooks.note(`화면을 보내지 못했어요: ${error.message}`);
        });
    };

    const onFrame = (now) => {
      if (run !== current || ended) return;
      video.nextFrame(onFrame);
      const t = video.currentTime * 1000;
      const stamp = link.stamp(performance.timeOrigin + now);
      // 시계를 맞춘 뒤 첫 프레임에서 t0를 서버 시계로 고친다
      if (!clockFixed && stamp.captured_at !== undefined) {
        clockFixed = true;
        record.t0 = Math.round(stamp.captured_at - t);
      }
      const marks = frameMarks();
      showMarks(marks);
      if (ws()?.readyState !== OPEN) return;
      if (engineMs && engineDue(lastEngine, t, engineMs)) {
        lastEngine = t;
        const ew = Math.min(frameWidth(params.get("w"), portrait), fw);
        const eh = Math.round((ew * fh) / fw);
        const e0 = performance.now();
        const pixels = grab(ew, eh);
        const header = { kind: "engine", width: ew, height: eh, position, orientation, tracking: "ok", epoch: state.epoch, projection, ...stamp };
        sendFrame(pixels, header, ENGINE_QUALITY, [], performance.now() - e0, true);
      }
      if (t < due) return;
      if (!pipeline.canStart()) {
        stats.skipped("encoding");
        return;
      }
      if (ws().bufferedAmount > MAX_BUFFERED) {
        stats.skipped("buffer");
        return;
      }
      due = Math.max(due + FRAME_MS, t + FRAME_MS / 2);
      const long = Math.min(FRAME_LONG, Math.max(fw, fh));
      const width = portrait ? Math.round((long * fw) / fh) : long;
      const h = portrait ? long : Math.round((long * fh) / fw);
      state.size = `${width}×${h}`;
      const r0 = performance.now();
      const pixels = grab(width, h);
      const header = { kind: "frame", width, height: h, position, orientation, tracking: "ok", epoch: state.epoch, ...stamp };
      sendFrame(pixels, header, FRAME_QUALITY, marks, performance.now() - r0, false);
    };

    const current = {
      video,
      videoTime: () => video.currentTime * 1000,
      close() {
        clearInterval(poseTimer);
        clearInterval(perfTimer);
        video.close();
        encoder.close();
      },
    };
    run = current;
    video.onEnded(() => {
      ended = true;
      record.ended = true;
      console.info(`[video] ${clockText(video.currentTime * 1000)} 영상 끝`);
    });
    video.nextFrame(onFrame);
  }

  function stop() {
    // 재생을 기다리는 중이면 그 영상을 닫는다(play가 끝나도 시작하지 않는다)
    if (opening) {
      opening.cancelled = true;
      opening.video?.close();
      opening = null;
    }
    const r = run;
    if (!r) return;
    run = null;
    startedOn = null;
    r.close();
    state.on = false;
    state.hitPoint = null;
    state.hitEstimated = false;
    state.position = null;
    state.orientation = null;
    hooks.onMarks([]);
    hooks.onEnd();
  }

  function perf() {
    const s = stats.snapshot();
    const ms = (v) => (v === null ? "-" : `${v.toFixed(1)}ms`);
    return {
      fps: `${s.fps.toFixed(1)} fps`,
      detail: [
        `보낸 화면 ${s.fps.toFixed(1)} / 목표 ${(1000 / FRAME_MS).toFixed(0)} fps · 장당 ${s.kbPerFrame === null ? "-" : `${s.kbPerFrame.toFixed(1)}KB`}`,
        `읽기 ${ms(s.readMs)} · 인코딩 ${ms(s.encodeMs)} · 크기 ${state.size}`,
        "표시 영상 꺼짐",
      ].join("\n"),
    };
  }

  return {
    state,
    start,
    stop,
    requestPhoto: () => {},
    /** 서버 상태 engine_ms. 0보다 큰 숫자일 때만 바꾼다. */
    setEngineMs(ms) {
      if (typeof ms === "number" && ms > 0) engineMs = ms;
    },
    setFocus(targets, ttlMs) {
      focus = { targets: targets ?? [], until: performance.now() + (ttlMs ?? 8000) };
    },
    perf,
    /** 서버 상태 sync마다(controller): 재생 중 서버 맞춤이 없고(none) 시작 자리가 있으면 start fixed를 다시 보낸다.
     *  고정 카메라라 언제 다시 보내도 맞다. 이 소켓으로 보낸 start의 답을 기다리는 동안(reset 답의 none)은 보내지 않는다. */
    syncStatus(sync) {
      if (!run || !sync) return;
      if (sync.state !== "none") {
        startedOn = null;
        return;
      }
      if (sync.start && startedOn !== ws()) sendStart();
    },
    /** 지금 영상 시각(ms). 재생 전·끝낸 뒤는 0. */
    videoTime: () => run?.videoTime() ?? 0,
  };
}
