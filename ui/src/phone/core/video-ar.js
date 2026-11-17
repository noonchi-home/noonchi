// 영상 입력 모드(폰 페이지 ?clip=<이름>): 실제 카메라 대신 /phone/videos/<이름> 영상을 틀고, 고정 카메라로 실제 폰과 같은 길로 보낸다.
// 시작 자세: 높이 1.4m에서 아래 25°(?h=·?pitch=, 시야각 ?fov= 기본 60°). 바닥은 AR y 0이다. 시작하면 reset → start{fixed:true}를 보내 서버가
// 시작 자리를 카메라 자리로 바로 맞춘다(src/phone/sync aligner fixStart). 서버 맞춤이 없어지면(못 보냄·다시 붙음·서버 다시 띄움) syncStatus가
// start fixed를 다시 보낸다(늘 시작 자세: AR 원점은 걸어도 그대로다). 그 뒤 자세는 초당 10번, 화면 프레임은 초당 12장(긴 변 780, 품질 0.55),
// 엔진 프레임은 서버 engine_ms마다(품질 0.8, 투영 행렬·서버 시계 촬영 시각). 표시 영상(H.264)은 만들지 않는다. 영상은 다시 틀지 않는다.
// 재생을 기다리는 동안 다시 시작하면 같은 시작을 기다리고(영상은 하나), 그 사이 끝내면 그 영상을 닫고 시작하지 않는다.
// 단계 영상(?step=<종류>:<대상 낱말>:<영상>, 여러 개): 사람 단계 명령(command)의 종류가 같고 대상 id에 낱말이 든 첫 칸이면, 그 id·step에 한 번
// ?react=초(기본 1.5) 뒤 그 영상으로 바꿔 튼다(새 영상을 깔고 튼 뒤 앞 영상을 닫는다). 영상 시각은 앞 영상들 시각에 이어 센다.
// 같은 종류·낱말 칸이 여럿이면 적은 차례대로 쓴다: 그 종류·낱말에 맞는 새 명령마다 다음 칸, 칸이 다 떨어지면 지금 영상을 둔다(칸이 하나면 맞는 새 명령마다 그 칸).
// 첫 영상도 단계 영상도 끝나면 마지막 장면을 붙잡는다: 다음 단계 영상이 오거나 끝낼 때까지 그 장면으로 프레임을 계속 보내고(시각은 흐른다,
// 엔진 프레임에 held: true), window.__noonchiVideo.hold = { clip, since: 영상 시각 }(다음 단계 영상이 시작되면 null). 실제 폰은 계속 보므로
// 판단·계획 뒤 대상 다시 확인이 영상 끝에서 끊기지 않게 한다. ended는 첫 영상이 끝났을 때만 참이다.
// 자세는 새 영상이 틀어질 때 함께 바꾼다(열지 못하거나 더 새 바꾸기가 있으면 그대로).
// go 단계면 자세가 대상 쪽으로 돌아 시작 숙인 각(?pitch=)으로 초당 0.8m 걸어(자세 타이머가 한 칸씩) 대상 0.6m 앞에서 멈춘다.
// go 명령에 near_m(가까이 가서 보기)이 있으면 min(0.6, near_m × NEAR_WALK)m 앞까지 걷는다(그 단계가 끝나는 거리 안).
// do 명령이 view above(위에서 비추기)면 폰을 대상 바로 위(지금 자리 쪽으로 수평 ABOVE.backM, 위 ABOVE.upM)로 옮겨 대상을 내려다본다(높이도 바뀐다).
// 명령이 지워지면(command_clear, commandClear) 그 명령의 예약된 단계 영상 바꾸기를 멈추고 걷기를 멈춘다(자세는 그대로). 새 명령·지우기마다 명령 세대가 올라
// 이미 재생을 기다리는 바꾸기도 재생이 끝났을 때 세대가 다르면 새 영상을 닫고 앞 영상·자세를 그대로 둔다.
// 집기·놓기 단계면 걷기를 멈추고 그 자리에서 대상(cmd.target.ar, 면이면 서버가 윗면 가운데로 준다)을 바라본다: 사람이 폰을 대상에 겨누듯
// 대상 쪽 yaw와 대상 높이까지 숙인 각(video-math lookAt)으로 돈다. 대상이 수평 1cm 안(바로 위·아래)이면 자세를 바꾸지 않는다. 높이는 늘 그대로다.
// 영상에는 위치 추적이 없어 자세를 페이지가 옮긴다. 단계를 넘기는 판단은 서버가 한다.
// 명령 대상 자리는 지금 view·투영으로 잡고(focusMarks), 화면에는 영상이 덮인 자리(coverMap)로 옮겨 넘긴다(화면 밖·칸에 가릴 때만 세모가 그려진다).
// 판정 기록 window.__noonchiVideo(t0: 재생 시작 서버 시각, commands: 받은 명령의 영상 시각, clips: 바꾼 단계 영상, sync: [서버 시각, 영상 시각] 짝)과
// console [video] 줄은 scripts/video-check.ts가 읽는다. 영상은 멈칫할 수 있어(버퍼·디코딩 밀림, 헤드리스 크롬에서 처음 몇 초) 영상 시각이 서버 시계보다
// 늦게 간다. 그래서 t0 하나로는 서버 사건을 영상 시각에 옮기지 못하고, 시계를 맞춘 뒤 프레임마다 견줘 짝을 남긴다(createSyncLog: 모든 견주기 오차 50ms 안).
// 멈칫하는 동안에는 프레임이 오지 않으므로 SYNC_EVERY_MS마다, 그리고 끝낼 때도 지금 짝을 견준다(시계를 맞춘 뒤 프레임보다 먼저면 t0도 고친다).
// 같은 직선 구간(1:1·멈춤)은 양 끝점만 둬 오래 돌아도 짝이 쌓이지 않는다. 짝 수가 상한(SYNC_MAX)에 닿으면 앞 짝을 버리지 않고 syncFull을 참으로 두고
// 더 쌓지 않는다(판정 도구가 시각표 위에 알리고 판정을 실패로 한다).
// PhoneAr(ar.d.ts)와 같은 형이라 controller·화면은 그대로 쓴다. 시험은 deps로 영상·인코딩·그림판을 바꾼다(jsdom은 영상을 틀지 못한다).

import { createEncoder, framePacket } from "./capture.js";
import { engineStep } from "./engine.js";
import { createFramePipeline, createSendStats, frameWidth } from "./pipeline.js";
import { focusMarks, toEdge } from "./project.js";
import { floorRayPoint } from "./aim.js";
import { newEpoch } from "./ar.js";
import { aboveGoal, coverMap, lookAt, pitchQuat, projectionFromFov, viewMatrix, walkGoal, yawOf, yawPitchQuat } from "./video-math.js";

const SEND_MS = 100;
const FRAME_LONG = 780;
const FRAME_QUALITY = 0.55;
const ENGINE_QUALITY = 0.8;
const MAX_BUFFERED = 512 * 1024;
const OPEN = 1; // WebSocket.OPEN
const REACT_S = 1.5;
const WALK_MPS = 0.8;
const WALK_STOP_M = 0.6;
/** 가까이 가서 보기 go(near_m)는 그 거리의 이만큼까지 걷는다(자세 흔들림 여유). */
const NEAR_WALK = 0.8;
/** 위에서 비추기 자세: 대상에서 지금 자리 쪽으로 수평(m)·대상 위(m). 크기를 모르는 좁고 깊은 컵도 입구 바로 위라 안이 보인다(src/world/place.ts topView). */
const ABOVE = { backM: 0.02, upM: 0.4 };
const STEP_KINDS = new Set(["go", "pick", "place", "do"]);
const STEP_WORD = /^[a-z_]+$/;
const CLIP_NAME = /^[A-Za-z0-9_-]{1,64}\.(?:mp4|webm)$/;
const clamp = (raw, lo, hi, fallback) => {
  const n = Number(raw);
  return raw !== null && raw !== "" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const phoneNow = () => performance.timeOrigin + performance.now();
const clipUrlOf = (clip) => `/phone/videos/${encodeURIComponent(clip)}`;
const clipNameOf = (url) => decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));

/** step 칸 하나(<종류>:<대상 낱말>:<영상>) → { kind, word, clipUrl }. 모양이 틀리면 null. */
function stepEntry(raw) {
  const parts = raw.split(":");
  if (parts.length !== 3) return null;
  const [kind, word, clip] = parts;
  if (!STEP_KINDS.has(kind) || !STEP_WORD.test(word) || !CLIP_NAME.test(clip)) return null;
  return { kind, word, clipUrl: clipUrlOf(clip) };
}

/** 페이지 주소 → 영상 모드 설정. clip이 없으면 null(실제 카메라). */
export function videoParams(params) {
  const clip = params.get("clip");
  if (!clip) return null;
  return {
    clip,
    clipUrl: clipUrlOf(clip),
    fovDeg: clamp(params.get("fov"), 20, 120, 60),
    pitchDeg: clamp(params.get("pitch"), -89, 89, -25),
    heightM: clamp(params.get("h"), 0.2, 3, 1.4),
    steps: params.getAll("step").map(stepEntry).filter(Boolean),
    reactMs: Math.round(clamp(params.get("react"), 0, 10, REACT_S) * 1000),
  };
}

/** 판정 기록(window.__noonchiVideo). 없으면 만든다. */
export function videoRecord(target = globalThis) {
  target.__noonchiVideo ??= { t0: null, ended: false, hold: null, commands: [], clips: [], sync: [], syncFull: false };
  return target.__noonchiVideo;
}

/** 서버 시각↔영상 시각 짝이 1:1로 이어 센 값에서 벗어나도 되는 폭(ms): 프레임 간격(25fps 40ms)과 시계 반올림은 넘기고 멈칫만 남긴다. */
const SYNC_SLACK_MS = 50;
/** 프레임과 따로 지금 짝을 견주는 간격(ms): 멈칫하는 동안(프레임 없음) 판정이 끝나도 멈춘 시간을 이만큼 안에서 남긴다. */
const SYNC_EVERY_MS = 250;

/** 짝 수 상한: 닿으면 「짝 넘침」을 알리고 더 쌓지 않는다(앞 짝을 버리면 처음 서버 사건을 틀린 시각으로 옮긴다). 보통은 멈칫마다 두세 개라 닿지 않는다. */
export const SYNC_MAX = 4000;

/** [서버 시각, 영상 시각] 짝 기록(sync에 쌓는다). note(at, ms)마다 견주기 하나를 받아, 마지막으로 고정한 짝(앞 끝)에서 지금 견주기까지 이은 직선이
 *  그 사이 모든 견주기에서 SYNC_SLACK_MS 안이면 마지막 짝(열린 끝)을 지금 견주기로 바꾸고, 아니면 열린 끝을 고정하고 지금 견주기를 새 끝으로 둔다.
 *  허용 기울기 범위(lo~hi)를 견주기마다 좁혀 가므로(swinging door) 지운 견주기를 두지 않고도 판정 도구가 옮길 때(짝 사이는 잇고 마지막 짝 뒤는 1:1)
 *  모든 견주기의 오차가 SYNC_SLACK_MS 안이다. 같은 직선 구간(1:1·멈춤)은 양 끝점만 남는다. 서버 시각이 앞 짝보다 늦지 않은 견주기는 버린다. */
export function createSyncLog(sync, onFull = () => {}) {
  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  let open = false; // 마지막 짝이 열린 끝인가(바꿀 수 있다)
  let full = false; // 상한에 닿아 더 쌓지 않는다
  const limit = (anchor, p) => {
    const dt = p[0] - anchor[0];
    return [(p[1] - SYNC_SLACK_MS - anchor[1]) / dt, (p[1] + SYNC_SLACK_MS - anchor[1]) / dt];
  };
  const start = (p) => {
    if (sync.length >= SYNC_MAX) {
      full = true;
      onFull();
      return;
    }
    const [l, h] = limit(sync.at(-1), p);
    sync.push(p);
    lo = l;
    hi = h;
    open = true;
  };
  return {
    note(at, ms) {
      if (full) return;
      const p = [Math.round(at), Math.round(ms)];
      const last = sync.at(-1);
      if (!last) {
        sync.push(p);
        return;
      }
      if (p[0] <= last[0]) return;
      if (!open) start(p);
      else {
        const anchor = sync.at(-2);
        const slope = (p[1] - anchor[1]) / (p[0] - anchor[0]);
        if (slope >= lo && slope <= hi) {
          sync[sync.length - 1] = p;
          const [l, h] = limit(anchor, p);
          lo = Math.max(lo, l);
          hi = Math.min(hi, h);
        } else start(p);
      }
    },
  };
}

// 0.1초로 먼저 반올림해 59.96초가 01:00.0이 된다(scripts/video-check.ts clock과 같다)
const clockText = (ms) => {
  const t = Math.round(Math.max(0, ms) / 100);
  return `${String(Math.floor(t / 600)).padStart(2, "0")}:${((t % 600) / 10).toFixed(1).padStart(4, "0")}`;
};

/** 지금 말의 at(controller가 화면이 바뀔 때마다 heardAtOf로 준다)을 기록한다. 영상 판정 --say는 이 기록만 싣는다. */
export function logVideoAt(at) {
  videoRecord().at = structuredClone(at);
}

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
    get duration() { return el.duration; },
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

/** link: link.js. params: 페이지 주소 검색값(fps). deps: clipUrl·fovDeg·pitchDeg·heightM·steps·reactMs, 시험은 영상·인코딩·그림판·화면 크기를 바꾼다. */
/** 페이지 전체 화면(영상 모드 AR). 지원하지 않거나 거절돼도 넘어간다(영상 시작은 그대로). 이 AR이 요청한 전체 화면만 끝낼 때 푼다.
 *  요청은 늦게 끝날 수 있다: 끝낸 뒤에 성공한 요청은 바로 푼다. 그 사이 다시 시작했으면(새 요청) 그 전체 화면은 둔다. */
function pageFullscreen() {
  let active = null; // 지금 AR의 요청: { doc }
  const exit = (doc) => {
    if (!doc?.fullscreenElement || typeof doc.exitFullscreen !== "function") return;
    try {
      Promise.resolve(doc.exitFullscreen()).catch(() => {});
    } catch {
      // 이미 풀렸다
    }
  };
  /** 요청이 성공했을 때: 그 요청을 건 AR이 이미 끝났고 새 AR이 없으면 푼다. */
  const settled = (ticket) => () => {
    if (active === null) exit(ticket.doc);
  };
  return {
    enter(doc) {
      const root = doc?.documentElement;
      if (typeof root?.requestFullscreen !== "function" || doc.fullscreenElement) return;
      const ticket = { doc };
      active = ticket;
      try {
        Promise.resolve(root.requestFullscreen({ navigationUI: "hide" })).then(settled(ticket), () => {});
      } catch {
        // 옵션을 받지 않는 브라우저는 옵션 없이 다시 요청한다
        try {
          Promise.resolve(root.requestFullscreen()).then(settled(ticket), () => {});
        } catch {
          // 전체 화면을 쓸 수 없다
        }
      }
    },
    leave() {
      const ticket = active;
      active = null;
      if (ticket) exit(ticket.doc);
    },
  };
}

export function createVideoAr({ link, params, hooks, deps }) {
  const d = { ...browser, ...deps };
  const FRAME_MS = 1000 / clamp(params.get("fps"), 1, 30, 12);
  const pitchDeg = d.pitchDeg ?? -25;
  const steps = d.steps ?? [];
  const reactMs = d.reactMs ?? REACT_S * 1000;
  // 시작 자세: 서버가 시작 자리로 맞추는 자세. 걸어도 start는 이 자세로 보낸다
  const startPosition = [0, d.heightM ?? 1.4, 0];
  const startOrientation = pitchQuat(pitchDeg);
  // 지금 자세(go 단계 걷기·집기·놓기 바라보기가 바꾼다): pose·프레임 머리·고리 view가 모두 이것을 쓴다
  let position = startPosition;
  let orientation = startOrientation;
  let view = viewMatrix(position, orientation);
  const pipeline = createFramePipeline({ maxInFlight: 2 });
  // 엔진 프레임은 따로 센다(한 번에 한 장, ar.js와 같다)
  const enginePipeline = createFramePipeline({ maxInFlight: 1 });
  const stats = createSendStats({ windowMs: 2000 });
  const state = { on: false, epoch: null, hitPoint: null, hitEstimated: false, limited: false, position: null, orientation: null, size: "-", encoder: "-" };
  let run = null; // 지금 재생: { videoTime, command, close }
  let opening = null; // 재생을 기다리는 중: { video, cancelled, done }
  const fullscreen = pageFullscreen();
  let startedOn = null; // start fixed를 보내고 답을 기다리는 소켓(다시 붙으면 다른 소켓이다)
  let engineMs = 0;
  let focus = { targets: [], until: 0 };
  const ws = () => link.socket();

  const sendStart = () => {
    if (link.send({ type: "start", position: startPosition, orientation: startOrientation, epoch: state.epoch, fixed: true })) startedOn = ws();
  };

  /** 자세를 바꾼다. 재생 중이면 state·조준점(시선이 바닥 AR y 0과 만나는 점)도 함께. */
  function setPose(p, q) {
    position = p;
    orientation = q;
    view = viewMatrix(p, q);
    if (!state.on) return;
    const had = state.hitPoint !== null;
    state.position = p;
    state.orientation = q;
    state.hitPoint = floorRayPoint(p, q, 0);
    state.hitEstimated = state.hitPoint !== null;
    if (had !== (state.hitPoint !== null)) hooks.onHit(Boolean(state.hitPoint), state.hitEstimated);
  }

  function start(overlay) {
    if (run) return Promise.resolve();
    // 재생을 기다리는 동안 또 누르면 같은 시작을 기다린다
    if (opening) return opening.done;
    // 영상 모드: 카메라 입력. 실제 AR(immersive-ar)은 그 자체로 전체 화면이라, 영상으로 그 화면을 흉내 낼 때도 「AR 시작」을 누른 순간
    // 전체 화면을 요청한다(사용자 제스처 안이어야 한다). 실제 모드(ar.js)는 DOM 오버레이와 겹쳐 요청하지 않는다. 방향은 고정하지 않는다
    fullscreen.enter(overlay?.ownerDocument ?? document);
    const wait = { video: null, cancelled: false, done: null };
    opening = wait;
    wait.done = open(overlay, wait)
      .catch((error) => {
        fullscreen.leave();
        throw error;
      })
      .finally(() => {
        if (opening === wait) opening = null;
      });
    return wait.done;
  }

  async function open(overlay, wait) {
    const doc = overlay?.ownerDocument ?? document;
    let video = d.createVideo(d.clipUrl);
    wait.video = video;
    // 덮개(canvas·위 줄·엄지 자리)보다 먼저 두어 그 밑에 깔린다. React 뿌리 밖(body 맨 앞)에 둔다
    if (video.element) doc.body.prepend(video.element);
    try {
      await video.play();
    } catch {
      // 기다리는 동안 끝냈으면 stop이 이미 닫았다
      if (wait.cancelled) return;
      video.close();
      throw new Error("영상을 열지 못했어요");
    }
    if (wait.cancelled) return;
    let fw = video.videoWidth;
    let fh = video.videoHeight;
    let portrait = fh > fw;
    let projection = projectionFromFov(d.fovDeg ?? 60, fw / fh);
    const encoder = d.createEncoder();
    const canvas = d.createCanvas();
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const record = videoRecord();
    record.t0 = Math.round(phoneNow() - video.currentTime * 1000);
    record.ended = false;
    record.hold = null;
    record.commands = [];
    record.clips = [];
    record.sync = [];
    record.syncFull = false;
    const syncLog = createSyncLog(record.sync, () => {
      record.syncFull = true;
      console.warn(`[video] 짝 넘침: [서버 시각, 영상 시각] 짝이 ${SYNC_MAX}개에 닿아 더 쌓지 않아요`);
    });
    let offset = 0; // 앞 영상들 시각 합(ms): 단계 영상으로 바꿔도 한 시각표로 센다
    let clockFixed = false;
    let due = 0;
    let lastEngine = null;
    let walk = null; // go 단계 걷기: { goal }
    let swapTurn = 0;
    const switched = new Set(); // 단계 영상으로 바꾸기를 끝낸 명령 id:step(예약만 하고 지운 것은 넣지 않는다)
    const used = new Map(); // 종류:낱말 → 쓴 칸 수(같은 종류·낱말 칸이 여럿일 때 차례)
    const reactTimers = new Set();
    // 명령 세대: 새 단계 영상 명령·지우기마다 오른다. 예약 타이머와 재생을 기다리는 바꾸기는 세대가 다르면 버린다
    let cmdGen = 0;
    let lastCmdId = null;
    let lastKey = null; // 마지막으로 받은 명령 id:단계(같은 명령이 다시 오면 비전 상태만 바뀐 것)
    let pendingKey = null; // 단계 영상 바꾸기를 예약한 명령 id:단계(끝나거나 지워지기 전)
    let stepClip = null; // 지금 도는 단계 영상 이름(첫 영상이면 null)
    let holdMs = 0; // 마지막 장면을 붙잡은 시간(타이머 칸을 센다): 붙잡는 동안에도 영상 시각이 흐른다
    let holdTimer = null;
    const held = () => holdMs;
    const timeline = () => offset + video.currentTime * 1000 + held();

    hooks.onStart();
    setPose(startPosition, startOrientation);
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

    /** go 단계 걷기 한 칸(자세 타이머마다 0.08m). 멈출 자리에 닿으면 끝. */
    const stepWalk = () => {
      if (!walk) return;
      const dx = walk.goal[0] - position[0];
      const dz = walk.goal[2] - position[2];
      const left = Math.hypot(dx, dz);
      const stride = (WALK_MPS * SEND_MS) / 1000;
      if (left <= stride) {
        setPose(walk.goal, orientation);
        walk = null;
        return;
      }
      setPose([position[0] + (dx / left) * stride, position[1], position[2] + (dz / left) * stride], orientation);
    };
    /** target 쪽으로 돌아 서고 stopM(기본 0.6m) 앞까지 걷기 시작한다. 숙인 각은 주소 칸 pitch. 이미 그 안이면 그대로. */
    // 영상 모드: 자세 흉내
    const startWalk = (target, stopM = WALK_STOP_M) => {
      const w = walkGoal(position, target, stopM);
      walk = w && { goal: w.goal };
      if (w) setPose(position, yawPitchQuat(w.yaw, pitchDeg));
    };
    /** 걷기를 멈추고 그 자리에서 target을 바라본다(사람이 폰을 대상에 겨눈다). 바로 위·아래면 자세는 그대로. */
    const face = (target) => {
      walk = null;
      const look = lookAt(position, target);
      if (look) setPose(position, yawPitchQuat(look.yaw, look.pitchDeg));
    };
    /** 걷기를 멈추고 폰을 target 바로 위로 옮겨 내려다본다(위에서 비추기). 이미 바로 위면 지금 보는 쪽을 써서 물러난다. */
    // 영상 모드: 자세 흉내
    const holdAbove = (target) => {
      walk = null;
      const a = aboveGoal(position, target, ABOVE.backM, ABOVE.upM, yawOf(orientation));
      if (a) setPose(a.goal, yawPitchQuat(a.yaw, a.pitchDeg));
    };

    const sendPose = () => {
      stepWalk();
      link.send({
        type: "pose", position, orientation, tracking: "ok", hit: state.hitPoint, hit_estimated: state.hitEstimated,
        floor_y: 0, epoch: state.epoch,
      });
    };
    sendPose();
    const poseTimer = setInterval(sendPose, SEND_MS);
    /** 프레임과 따로 지금 [서버 시각, 영상 시각]을 견준다. 멈칫하는 동안에는 프레임이 오지 않으므로, 시계를 맞춘 뒤 첫 견주기면 여기서 t0도 서버 시계로 고친다. */
    const syncNow = () => {
      const stamp = link.stamp(performance.timeOrigin + performance.now());
      if (stamp.captured_at === undefined) return;
      const t = timeline();
      if (!clockFixed) {
        clockFixed = true;
        record.t0 = Math.round(stamp.captured_at - t);
      }
      syncLog.note(stamp.captured_at, t);
    };
    const syncTimer = setInterval(syncNow, SYNC_EVERY_MS);
    const perfTimer = setInterval(hooks.onPerf, 1000);

    /** 영상을 width×height로 그린 RGBA 픽셀(위 줄부터). */
    const grab = (width, h) => {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== h) canvas.height = h;
      video.drawTo(ctx, width, h);
      return new Uint8Array(ctx.getImageData(0, 0, width, h).data.buffer);
    };

    // always: 엔진 프레임은 늘 보내고 표시 통계에 넣지 않는다
    const sendFrame = (pixels, header, quality, marks, readMs, always, pipe = pipeline) => {
      const id = pipe.start();
      const t0 = performance.now();
      encoder.encode(pixels, header.width, header.height, quality, marks)
        .then((jpeg) => {
          const encodeMs = performance.now() - t0;
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
          if (run === current) hooks.note(`화면을 보내지 못했어요: ${error.message}`);
        });
    };

    /** 영상 v의 프레임 한 장 보내기(엔진·표시). 다음 프레임 예약은 하지 않는다: 영상 고리(frameLoop)와 붙잡기 타이머가 같이 쓴다. */
    const frameSend = (v) => (now) => {
      if (run !== current || v !== video) return;
      const t = timeline();
      const stamp = link.stamp(performance.timeOrigin + now);
      // 시계를 맞춘 뒤 첫 프레임에서 t0를 서버 시계로 고치고, 그 뒤 프레임마다 서버 시각↔영상 시각 짝을 견준다
      if (stamp.captured_at !== undefined) {
        if (!clockFixed) {
          clockFixed = true;
          record.t0 = Math.round(stamp.captured_at - t);
        }
        syncLog.note(stamp.captured_at, t);
      }
      const marks = frameMarks();
      showMarks(marks);
      if (ws()?.readyState !== OPEN) return;
      // 엔진 프레임 차례: 앞 엔진 프레임이 인코딩 중이거나 보낼 것이 쌓였으면 건너뛴다(쌓지 않는다)
      const step = engineStep({ last: lastEngine, now: t, intervalMs: engineMs, canStart: enginePipeline.canStart(), buffered: ws().bufferedAmount, maxBuffered: MAX_BUFFERED });
      lastEngine = step.last;
      if (step.action !== "wait" && step.action !== "send") stats.skipped("engine");
      if (step.action === "send") {
        const ew = Math.min(frameWidth(params.get("w"), portrait), fw);
        const eh = Math.round((ew * fh) / fw);
        const e0 = performance.now();
        const pixels = grab(ew, eh);
        // 붙잡은 장면은 같은 사진이라 held를 붙인다: 서버가 같은 사진도 VLM 간격마다 새 관찰로 받는다
        const header = { kind: "engine", width: ew, height: eh, position, orientation, tracking: "ok", epoch: state.epoch, projection, ...stamp, ...(record.hold ? { held: true } : {}) };
        sendFrame(pixels, header, ENGINE_QUALITY, [], performance.now() - e0, true, enginePipeline);
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
    /** 영상 v의 프레임 고리: 다음 프레임을 예약하고 한 장 보낸다. 단계 영상으로 바꾸면 앞 영상 고리는 멈춘다. */
    const frameLoop = (v) => {
      const send = frameSend(v);
      const onFrame = (now) => {
        // 끝난 영상은 새 프레임이 없다: 고리를 멈추고 붙잡기 타이머가 보낸다
        if (run !== current || v !== video || v.ended) return;
        v.nextFrame(onFrame);
        send(now);
      };
      return onFrame;
    };
    const watchEnd = (v) => v.onEnded(() => {
      if (v !== video) return;
      // 첫 영상도 단계 영상처럼 마지막 장면을 붙잡는다(실제 폰은 계속 본다: 판단·계획 뒤 대상 다시 확인이 끊기지 않게). ended는 첫 영상이 끝났다는 뜻만 둔다
      const clip = stepClip ?? clipNameOf(d.clipUrl);
      if (stepClip === null) {
        record.ended = true;
        console.info(`[video] ${clockText(timeline())} 영상 끝`);
      }
      // 마지막 장면을 붙잡고 그 장면으로 프레임을 계속 보낸다(영상 프레임 알림이 없어 타이머로 돈다). 타이머는 보내기만 하고 다음 프레임을 예약하지 않는다
      const since = Math.round(timeline());
      record.hold = { clip, since };
      console.info(`[video] ${clockText(since)} ${stepClip === null ? "첫 영상" : "단계 영상"} 끝 · 마지막 장면 붙잡기 ${clip}`);
      const tick = frameSend(v);
      const every = Math.max(20, Math.floor(FRAME_MS / 2));
      holdTimer = setInterval(() => {
        holdMs += every;
        tick(performance.now());
      }, every);
    });
    const stopHold = () => {
      if (holdTimer !== null) clearInterval(holdTimer);
      holdTimer = null;
      offset += held();
      holdMs = 0;
      record.hold = null;
    };

    /** 단계 영상으로 바꾼다: 새 영상을 앞 영상 밑에 깔고 튼 뒤 앞 영상을 닫는다. 마지막에 건 바꾸기만 쓴다.
     *  pose: 새 영상으로 바꿀 때 함께 바꿀 자세(go 걷기·집기·놓기 바라보기). 열지 못하거나 더 새 바꾸기가 있으면 부르지 않는다. */
    async function swap(url, pose, gen = cmdGen, done) {
      const turn = ++swapTurn;
      const next = d.createVideo(url);
      if (next.element) doc.body.prepend(next.element);
      try {
        await next.play();
      } catch {
        next.close();
        console.warn(`[video] 단계 영상을 열지 못했어요 ${clipNameOf(url)}`);
        return;
      }
      // 끝낸 AR·더 새 바꾸기·지워진 명령(세대가 다름)이면 새 영상을 닫고 앞 영상·자세를 그대로 둔다
      if (run !== current || turn !== swapTurn || gen !== cmdGen) {
        next.close();
        return;
      }
      const old = video;
      stopHold();
      offset += old.currentTime * 1000;
      video = next;
      if (next.videoWidth !== fw || next.videoHeight !== fh) {
        fw = next.videoWidth;
        fh = next.videoHeight;
        portrait = fh > fw;
        projection = projectionFromFov(d.fovDeg ?? 60, fw / fh);
      }
      // 앞 영상 프레임 고리는 멈췄다: 새 영상 첫 프레임부터 새 자세가 실린다
      pose?.();
      done?.();
      record.ended = false;
      const ms = timeline();
      stepClip = clipNameOf(url);
      const dur = Number(next.duration);
      record.clips.push({ video_ms: Math.round(ms), clip: stepClip, ...(Number.isFinite(dur) && dur > 0 ? { duration_ms: Math.round(dur * 1000) } : {}) });
      console.info(`[video] ${clockText(ms)} 단계 영상 ${clipNameOf(url)}`);
      old.close();
      watchEnd(next);
      next.nextFrame(frameLoop(next));
    }

    const current = {
      videoTime: timeline,
      /** 사람 단계 명령: 맞는 step 칸이 있으면 그 id·step에 한 번, reactMs 뒤 단계 영상으로 바꾸고, 바뀌면 go는 걷고 집기·놓기·그 자리에서 하는 일(do)은 대상을 바라본다. */
      command(cmd) {
        const key = `${cmd.id}:${cmd.step}`;
        const fresh = key !== lastKey;
        // 같은 명령이 이어서 다시 오면(비전 상태만 바뀜) 이미 예약했거나 바꾼 것은 그대로 둔다(대상이 그제야 붙었으면 아래에서 예약한다)
        if (!fresh && (pendingKey === key || switched.has(key))) return;
        // 새 명령(다른 id·단계, 단계 영상이 없는 질문·승인도): 앞 명령의 예약된 바꾸기·재생을 기다리는 바꾸기·걷기를 먼저 멈춘다
        if (fresh) {
          lastKey = key;
          pendingKey = null;
          cmdGen++;
          for (const timer of reactTimers) clearTimeout(timer);
          reactTimers.clear();
          walk = null;
        }
        const id = cmd.target?.id;
        const first = typeof id === "string" ? steps.find((s) => s.kind === cmd.kind && id.includes(s.word)) : undefined;
        if (!first) return;
        const target = Array.isArray(cmd.target.ar) ? cmd.target.ar : null;
        const gen = cmdGen;
        lastCmdId = cmd.id;
        // go는 걷기(near_m이 있으면 그 거리 안까지), view above면 위에서 비추기, 그 밖은 그 자리에서 바라보기
        const stopM = typeof cmd.near_m === "number" ? Math.min(WALK_STOP_M, cmd.near_m * NEAR_WALK) : WALK_STOP_M;
        const pose = target && (first.kind === "go" ? () => startWalk(target, stopM) : cmd.view === "above" ? () => holdAbove(target) : () => face(target));
        const later = (fn) => {
          const timer = setTimeout(() => {
            reactTimers.delete(timer);
            if (run !== current || gen !== cmdGen) return;
            fn();
          }, reactMs);
          reactTimers.add(timer);
        };
        // 이미 그 단계 영상으로 바꾼 명령이 다시 왔다(시간 초과 질문 뒤 「계속」 등): 영상 칸을 더 쓰지 않고 자세 동작만 다시 시작한다
        if (switched.has(key)) {
          if (pose) later(pose);
          return;
        }
        // 같은 종류·낱말 칸이 여럿이면 새 명령마다 다음 칸(다 떨어지면 지금 영상을 둔다), 하나면 늘 그 칸.
        // 칸과 그 명령은 바꾸기가 끝났을 때만 쓴 것으로 센다(예약만 하고 지운 바꾸기는 칸을 쓰지 않고, 같은 명령이 다시 오면 다시 예약한다)
        const group = steps.filter((s) => s.kind === first.kind && s.word === first.word);
        const slot = `${first.kind}:${first.word}`;
        const n = used.get(slot) ?? 0;
        if (group.length > 1 && n >= group.length) return;
        const entry = group.length > 1 ? group[n] : first;
        pendingKey = key;
        later(() => void swap(entry.clipUrl, pose, gen, () => {
          used.set(slot, Math.max(used.get(slot) ?? 0, n + 1));
          switched.add(key);
        }));
      },
      /** 명령이 지워졌다(id가 없으면 무엇이든): 마지막 단계 영상 명령이면 세대를 올려 예약된 바꾸기·재생을 기다리는 바꾸기를 버리고 걷기를 멈춘다. */
      commandClear(id) {
        if (id !== undefined && id !== lastCmdId) return;
        cmdGen++;
        lastKey = null;
        pendingKey = null;
        for (const timer of reactTimers) clearTimeout(timer);
        reactTimers.clear();
        walk = null;
      },
      close() {
        // 끝낼 때 지금 짝(멈칫하는 도중이면 멈춘 시간까지)
        syncNow();
        clearInterval(syncTimer);
        clearInterval(poseTimer);
        clearInterval(perfTimer);
        if (holdTimer !== null) clearInterval(holdTimer);
        for (const timer of reactTimers) clearTimeout(timer);
        reactTimers.clear();
        walk = null;
        video.close();
        encoder.close();
      },
    };
    run = current;
    watchEnd(video);
    video.nextFrame(frameLoop(video));
  }

  function stop() {
    fullscreen.leave();
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
     *  고정 시작 자세라 언제 다시 보내도 맞다. 이 소켓으로 보낸 start의 답을 기다리는 동안(reset 답의 none)은 보내지 않는다. */
    syncStatus(sync) {
      if (!run || !sync) return;
      if (sync.state !== "none") {
        startedOn = null;
        return;
      }
      if (sync.start && startedOn !== ws()) sendStart();
    },
    /** 지금 영상 시각(ms, 앞 단계 영상들 시각에 이어 센다). 재생 전·끝낸 뒤는 0. */
    videoTime: () => run?.videoTime() ?? 0,
    /** 받은 명령(controller): 재생 중이면 단계 영상 바꾸기·go 걷기·집기·놓기 바라보기·위에서 비추기. */
    command(cmd) {
      run?.command(cmd);
    },
    /** 지운 명령(controller command_clear): 그 명령의 단계 영상 바꾸기와 걷기를 멈춘다. */
    commandClear(id) {
      run?.commandClear(id);
    },
  };
}
