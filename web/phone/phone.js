// 클로이드의 눈(폰): WebXR AR로 폰 자세를 재고, 화면 가운데 조준점이 가리키는 바닥 점을 기준점·'여기'로 쓴다.
// 자세(+조준점)는 초당 10번, 카메라 화면은 기본 초당 12장(가로 촬영 가로 480px·세로 360px JPEG, ?fps=·?w=로 바꾼다) /phone/events로 보낸다.
// 인코딩은 워커 두 개로 두 장까지 겹치고(capture.js), 순서가 뒤바뀐 오래된 프레임과 와이파이에 쌓인 프레임은 건너뛴다(pipeline.js).
// 보낸 장 수·readPixels·인코딩 시간·건너뛴 이유는 위 상태 줄(fps)과 ⋯ 메뉴에 보인다. '사진 찍기'는 카메라 원본 크기로
// 한 장을 보내고, 서버가 그 순간의 눈 자세를 붙여 저장한다. 트윈 좌표 계산은 서버(src/phone)가 한다.
// 화면은 세로 촬영 기준: 가운데 조준점, 아래 큰 버튼(말하기·사진·끝내기), 위 상태 줄, 나머지(글 입력·다시 맞추기·측정)는 ⋯ 메뉴.
// 말하기: 크롬 내장 음성 인식(ko-KR, 누르고 말하기)으로 받아쓴 문장을 say로 보내고, 답은 읽어 주고 몇 초 보인다. 음성 인식이 없으면 글 입력.
// 초점: 서버가 보낸 대상(AR 좌표)을 화면에 고리로 그리고, 대시보드로 가는 화면 프레임에도 그린다(사진에는 그리지 않음).
// 엔진 프레임(서버 BRAIN=1): 서버가 상태 메시지 engine_ms로 알려 준 간격마다 분석용 JPEG을 따로 보낸다(초점 고리 없음,
// 촬영 순간 자세·투영 행렬·서버 시계 촬영 시각과 오차를 붙인다). 시계는 clock 핑(NTP식)으로 맞추고 프레임·사진에도 붙인다.
// 서버가 보내는 부탁(request)은 화면 가운데 큰 글씨로, 행동 부탁(action, 모의)은 버튼 카드로 보인다.

import { createGrabber, framePacket } from "./capture.js";
import { createDisplayEncoder } from "./display-encoder.js";
import { engineDue } from "./engine.js";
import { createFramePipeline, createSendStats, frameWidth } from "./pipeline.js";
import { focusMarks } from "./project.js";
import { floorCandidate } from "./touch.js";

const $ = (id) => document.getElementById(id);
const SEND_MS = 100;
const PARAMS = new URLSearchParams(location.search);
const clamp = (raw, lo, hi, fallback) => {
  const n = Number(raw);
  return raw !== null && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const FRAME_MS = 1000 / clamp(PARAMS.get("fps"), 1, 30, 12);
const FRAME_QUALITY = 0.55; // 장 수를 늘린 만큼 한 장 크기를 줄인다(사진은 0.9)
const ENGINE_QUALITY = 0.8; // 엔진 프레임은 YOLOX·VLM이 분석한다
const MAX_BUFFERED = 512 * 1024; // 와이파이가 느리면 프레임을 쌓지 않고 건너뛴다
const FLIP = PARAMS.get("flip") !== "0";
const IDLE_LABEL = "🎙 누르고 말하기";
const TOAST_MS = 5000;
let ws = null;
let hitPoint = null;
let lastSent = 0;
let lastFrame = 0;
let wantPhoto = false;
// 엔진 프레임 간격(ms, 서버 상태 engine_ms). 없으면 보내지 않는다
let engineMs = 0;
let lastEngine = null;
let focus = { targets: [], until: 0 };
// 벽 기준점 맞춤(touch 모드): 대시보드에서 고른 벽 지점 A·B 바로 아래 바닥을 조준점으로 맞추고 기록 → 그 바닥 점을 보낸다.
// 벽에 폰을 대면 카메라가 가려져 위치를 자주 잃어서, 서서 바닥을 비추는 조준으로 바꿨다
let alignMode = "floor";
let lastFloor = null; // 이번 프레임 조준점이 바닥 후보(floorCandidate)면 그 점
// 서버 기준점 판(status.revision). 기록을 시작한 뒤 바뀌면 그 기록은 버린다
let revision = null;
// 이 AR 세션·추적 원점의 이름. 자세·기록·사진에 붙여, 연결이 끊겨 reset을 못 보내도 서버가 이전 원점의 맞춤을 버리게 한다
let epoch = null;
const newEpoch = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let arOn = false;
let display = null; // 표시 영상(H.264, display-encoder.js). 분석용 JPEG와 따로 대시보드 화면에만 간다
// 시계 맞춤: 최근 표본 중 왕복이 가장 짧은 것으로 서버 시계와의 차(offset)를 정하고 오차는 왕복의 절반
const CLOCK_MS = 2000;
const phoneNow = () => performance.timeOrigin + performance.now();
let clockSamples = [];
let clockTimer = null;
function clockFix() {
  if (!clockSamples.length) return null;
  const best = clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  return { offset: best.offset, err: Math.ceil(best.rtt / 2) };
}
function onClock(msg) {
  const t1 = phoneNow();
  const rtt = t1 - msg.t0;
  if (!(rtt >= 0)) return;
  clockSamples = [...clockSamples, { rtt, offset: msg.server - (msg.t0 + t1) / 2 }].slice(-10);
}
/** 폰 시각(ms) → 헤더에 붙일 서버 시계 촬영 시각과 오차. 아직 표본이 없으면 빈 객체(서버가 받은 시각을 쓴다). */
function stamp(phoneMs) {
  const fix = clockFix();
  return fix ? { captured_at: Math.round(phoneMs + fix.offset), time_err_ms: fix.err } : {};
}
const brainView = { requestId: null, actionId: null, lineTimer: null };
const pipeline = createFramePipeline({ maxInFlight: 2 });
const stats = createSendStats({ windowMs: 2000 });
const view = { aligned: false, mismatch: null, anchors: "", limited: false, note: "", noteUntil: 0, size: "-", encoder: "-" };

function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/phone/events`);
  ws.addEventListener("open", () => {
    clockSamples = [];
    const ping = () => send({ type: "clock", t0: phoneNow() });
    ping();
    clearInterval(clockTimer);
    clockTimer = setInterval(ping, CLOCK_MS);
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "status") render(msg);
    else if (msg.type === "photo_saved") toast(msg.answer ? "요청한 컵 사진을 보냈어요" : msg.aligned ? "사진을 위치와 함께 보냈어요" : "위치 없이 사진을 보냈어요");
    else if (msg.type === "reply") showReply(msg);
    else if (msg.type === "focus") focus = { targets: msg.targets ?? [], until: performance.now() + (msg.ttl_ms ?? 8000) };
    else if (msg.type === "clock") onClock(msg);
    else if (msg.type === "request") showRequest(msg);
    else if (msg.type === "action") showAction(msg);
    else if (msg.type === "brain_line") showBrainLine(msg.text);
  });
  ws.addEventListener("close", () => {
    clearInterval(clockTimer);
    setTimeout(connect, 1000);
  });
}

// ── 클로이드 부탁·행동 ─────────────────────────────────
// 요청은 거둘 때까지 크게 보이고, 그동안 📷 버튼 이름이 "컵 안"으로 바뀐다. 행동 부탁은 모의(기기 명령 없음)라고 표시한다.

function showBrainLine(text) {
  const line = $("brain-line");
  line.textContent = `🤖 ${text}`;
  line.hidden = false;
  clearTimeout(brainView.lineTimer);
  brainView.lineTimer = setTimeout(() => { line.hidden = true; }, 8000);
}

function showRequest(msg) {
  if (!msg.active && msg.id !== brainView.requestId) return;
  brainView.requestId = msg.active ? msg.id : null;
  $("brain-request").textContent = `📷 ${msg.text}`;
  $("brain-request").hidden = !msg.active;
  $("photo").innerHTML = msg.active ? "📷<span>컵 안</span>" : "📷<span>사진</span>";
  if (msg.active) speak(msg.text);
}

function showAction(msg) {
  if (!msg.active) {
    if (msg.id === brainView.actionId) {
      brainView.actionId = null;
      $("brain-action").hidden = true;
    }
    return;
  }
  brainView.actionId = msg.id;
  $("brain-action-text").textContent = msg.text;
  $("brain-action-would").textContent = msg.would ? `클로이드라면: ${msg.would} · 기기 명령은 보내지 않아요` : "";
  $("brain-action-choices").replaceChildren(...(msg.choices ?? []).map((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = c.label;
    b.addEventListener("click", () => {
      if (!send({ type: "brain_reply", id: msg.id, choice: c.id })) note("서버와 연결이 끊겨 답을 보내지 못했어요");
      else if (c.id === "done") toast("고마워요. 컵이 안 보이는지 확인할게요", 3000);
    });
    return b;
  }));
  $("brain-action").hidden = false;
  speak(msg.text);
}

const send = (msg) => {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
};

// ── 상태 줄 ────────────────────────────────────────────
// 맞춤 상태·거리 차이·추적 약함을 한 줄로. 잠깐 알릴 말(note)은 4초 뒤 사라진다.

function note(text) {
  view.note = text;
  view.noteUntil = performance.now() + 4000;
  renderStatus();
}

function renderStatus() {
  const base = view.aligned
    ? `${alignMode === "touch" ? "근사 " : ""}맞춤 ✓ · 거리 차이 ${Math.round(view.mismatch * 100)}cm${view.limited ? " · 추적 약함" : ""}`
    : alignMode === "touch"
      ? `맞추기 전 · 벽 지점 ${view.anchors} 기록`
      : `맞추기 전 · 창가 기준 방향만 · 기준점 ${view.anchors} 기록`;
  $("status").textContent = performance.now() < view.noteUntil ? view.note : base;
  $("status").title = base;
}

function render(s) {
  revision = s.revision ?? null;
  if (typeof s.engine_ms === "number" && s.engine_ms > 0) engineMs = s.engine_ms;
  alignMode = s.mode ?? "floor";
  const names = s.anchors.map((a) => (alignMode === "touch" ? `${a.id} ${a.label}` : a.label)).join(", ");
  $("align-help").innerHTML = alignMode === "touch"
    ? "<span id=\"anchor-names\"></span> 바로 아래 바닥에 조준점을 맞추고 <b>기록</b>을 눌러요. 초록이면 닿은 거예요"
    : "<span id=\"anchor-names\"></span> 바닥에 차례로 조준점을 맞추고 <b>지점 기록</b>을 눌러요";
  $("anchor-names").textContent = names;
  const done = s.anchors.filter((a) => a.recorded).length;
  view.anchors = `${done}/${s.anchors.length}`;
  view.aligned = s.aligned;
  view.mismatch = s.mismatch_m;
  // 기준점 버튼은 맞추기 전에만 보인다(다시 맞추기는 ⋯ 메뉴)
  $("anchors").hidden = s.aligned;
  $("anchors").replaceChildren(...s.anchors.map((a) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = alignMode === "touch"
      ? `${a.recorded ? "✓ " : ""}${a.id} ${a.label} 아래 바닥 조준하고 기록`
      : `${a.recorded ? "✓ " : ""}${a.label} 지점 기록`;
    b.addEventListener("click", () => {
      if (alignMode === "touch") {
        aimTouch(a.id);
        return;
      }
      if (!hitPoint) {
        note("조준점이 바닥에 닿지 않았어요. 바닥을 천천히 비춰 주세요");
        return;
      }
      send({ type: "anchor", id: a.id, point: hitPoint, epoch, revision });
    });
    return b;
  }));
  if (s.error) note(s.error);
  else renderStatus();
}

// 벽 기준점 기록: 조준점이 닿은 바닥 점(벽 바로 아래)을 그 기준점으로 보낸다. 점 자체가 바닥이라 floor도 같은 점이다
function aimTouch(id) {
  if (!arOn) {
    note("AR을 먼저 시작하세요");
    return;
  }
  if (!lastFloor) {
    note(`조준점이 바닥에 닿지 않았어요. ${id} 벽 바로 아래 바닥을 천천히 비춰 주세요`);
    return;
  }
  if (send({ type: "anchor", id, point: lastFloor, floor: lastFloor, epoch, revision })) toast(`${id} 지점을 기록했어요`, 2500);
  else note("서버와 연결이 끊겨 기록하지 못했어요");
}

// ── 측정: 보낸 fps는 상태 줄, 자세한 값은 ⋯ 메뉴 ───────────

function renderPerf() {
  const s = stats.snapshot();
  const ms = (v) => (v === null ? "-" : `${v.toFixed(1)}ms`);
  $("perf").textContent = `${s.fps.toFixed(1)} fps`;
  $("perf-detail").textContent = [
    `보낸 화면 ${s.fps.toFixed(1)} / 목표 ${(1000 / FRAME_MS).toFixed(0)} fps · 장당 ${s.kbPerFrame === null ? "-" : `${s.kbPerFrame.toFixed(1)}KB`}`,
    `readPixels ${ms(s.readMs)} · 인코딩 ${ms(s.encodeMs)} (${view.encoder})`,
    `와이파이 대기 ${Math.round((ws?.bufferedAmount ?? 0) / 1024)}KB · 크기 ${view.size}`,
    `2초간 건너뜀: 인코딩 중 ${s.skipped.encoding} · 버퍼 가득 ${s.skipped.buffer} · 순서 뒤바뀜 ${s.skipped.stale}`,
    display?.describe() ?? "표시 영상 꺼짐",
  ].join("\n");
  renderStatus();
}

// ── 대화 ───────────────────────────────────────────────

let toastTimer = null;
function toast(text, ms = TOAST_MS) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function showLine(text, ms) {
  $("reply").hidden = false;
  $("reply").textContent = text;
  toast(text, ms);
}

function say(text) {
  const t = text.trim();
  if (!t) return;
  showLine(`🎙 "${t}" … 생각 중`, 15000);
  if (!send({ type: "say", text: t })) showLine("서버와 연결이 끊겼어요. 잠시 뒤 다시 말해 주세요.");
}

function speak(text) {
  if (!("speechSynthesis" in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

function showReply(msg) {
  showLine(msg.text, msg.pending?.length ? 12000 : TOAST_MS);
  speak(msg.text);
  $("pending").replaceChildren(...(msg.pending ?? []).map((p) => {
    const row = document.createElement("div");
    row.className = "ask";
    const why = document.createElement("span");
    why.textContent = `${p.deviceLabel}: ${p.reason}`;
    const yes = document.createElement("button");
    yes.type = "button";
    yes.textContent = "승인";
    yes.addEventListener("click", () => { row.remove(); send({ type: "confirm", token: p.token }); });
    const no = document.createElement("button");
    no.type = "button";
    no.textContent = "취소";
    no.addEventListener("click", () => { row.remove(); send({ type: "cancel", token: p.token }); });
    row.append(why, yes, no);
    return row;
  }));
}

/** 누르고 말하기 버튼 하나(처음 화면 버튼과 AR 오른쪽 버튼이 같이 쓴다). */
function bindTalk(btn, Recognition, idle, listening) {
  let rec = null;
  let heard = "";
  const stop = () => rec?.stop();
  btn.addEventListener("contextmenu", (event) => event.preventDefault());
  btn.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (rec) return;
    heard = "";
    rec = new Recognition();
    rec.lang = "ko-KR";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      heard = Array.from(e.results).map((r) => r[0].transcript).join("");
      showLine(`🎙 ${heard}`, 15000);
    };
    rec.onerror = (e) => showLine(e.error === "not-allowed" ? "마이크 권한이 없어요. 크롬 사이트 설정에서 마이크를 허용해 주세요." : `음성 인식 오류: ${e.error}`);
    rec.onend = () => {
      rec = null;
      btn.classList.remove("listening");
      btn.innerHTML = idle;
      if (heard.trim()) say(heard);
    };
    try {
      rec.start();
      speechSynthesis?.cancel();
      btn.classList.add("listening");
      btn.innerHTML = listening;
    } catch (error) {
      rec = null;
      showLine(`음성 인식을 시작하지 못했어요: ${error.message}`);
    }
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) btn.addEventListener(type, stop);
}

function setupTalk() {
  $("talk-form").addEventListener("submit", (event) => {
    event.preventDefault();
    say($("talk-input").value);
    $("talk-input").value = "";
  });
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    $("ar-talk").hidden = true; // 글 입력만(AR 중에는 ⋯ 메뉴)
    return;
  }
  $("talk-btn").hidden = false;
  bindTalk($("talk-btn"), Recognition, IDLE_LABEL, "듣는 중… 손을 떼면 보내요");
  bindTalk($("ar-talk"), Recognition, "🎙<span>말하기</span>", "●<span>듣는 중</span>");
}

function setupMenu() {
  const open = (on) => {
    $("menu").hidden = !on;
    $("more").setAttribute("aria-expanded", String(on));
  };
  $("more").addEventListener("click", () => open($("menu").hidden));
  $("menu-close").addEventListener("click", () => open(false));
  $("reset").addEventListener("click", () => {
    // 같은 AR 공간에서 다시 맞추기: 원점(epoch)은 그대로 두고 기록만 지운다
    send({ type: "reset", epoch });
    open(false);
  });
}

// ── 초점 고리 ──────────────────────────────────────────

function renderMarks(marks) {
  const layer = $("focus-layer");
  const keep = new Set(marks.map((m) => m.id));
  for (const node of [...layer.children]) if (!keep.has(node.dataset.id)) node.remove();
  for (const m of marks) {
    let node = layer.querySelector(`[data-id="${CSS.escape(m.id)}"]`);
    if (!node) {
      node = document.createElement("div");
      node.dataset.id = m.id;
      node.className = "focus-mark";
      node.innerHTML = '<div class="ring"></div><div class="label"></div>';
      layer.append(node);
    }
    node.classList.toggle("off", m.off);
    node.style.left = `${m.u * innerWidth}px`;
    node.style.top = `${m.v * innerHeight}px`;
    node.style.setProperty("--angle", `${m.angle}deg`);
    node.querySelector(".label").textContent = `클로이드 주목 · ${m.label}`;
  }
}

// ── AR ─────────────────────────────────────────────────

async function checkSupport() {
  if (!window.isSecureContext) {
    $("support").textContent = "보안 연결이 아니라 AR을 켤 수 없어요. https 주소로 여세요.";
    return;
  }
  if (!navigator.xr || !(await navigator.xr.isSessionSupported("immersive-ar"))) {
    $("support").textContent = "이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.";
    return;
  }
  $("support").textContent = "준비됐어요. 첫 기준점 근처에서 AR을 시작하세요.";
  $("start").disabled = false;
}

async function start() {
  // 전체 화면·가로 고정은 요청하지 않는다. DOM 오버레이도 전체 화면 기능을 써서, 같이 요청하면 AR 화면이 나오지 않았다.
  const session = await navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["local", "hit-test", "dom-overlay"],
    optionalFeatures: ["camera-access"],
    domOverlay: { root: $("overlay") },
  });
  $("overlay").hidden = false;
  // AR 중에는 DOM 오버레이 안의 것만 보인다: 글 입력은 ⋯ 메뉴로, 승인 버튼은 아래 가운데로 옮긴다
  $("menu-talk").append($("talk-form"));
  $("pending-slot").append($("pending"));
  const gl = document.createElement("canvas").getContext("webgl", { xrCompatible: true });
  session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
  const space = await session.requestReferenceSpace("local");
  // 새 AR 세션은 좌표 원점이 새로 잡힌다: 이전 맞춤·기록을 버린다. 추적이 원점을 다시 잡아도(reset) 같다
  arOn = true;
  epoch = newEpoch();
  send({ type: "reset", epoch });
  space.addEventListener?.("reset", () => {
    lastFloor = null;
    epoch = newEpoch();
    send({ type: "reset", epoch });
    note("추적 원점이 바뀌어 맞춤을 지웠어요. 기준점을 다시 기록해 주세요");
  });
  const hitSource = await session.requestHitTestSource({ space: await session.requestReferenceSpace("viewer") });
  // 카메라 접근(camera-access)이 없으면 자세만 보낸다
  const binding = typeof XRWebGLBinding === "function" ? new XRWebGLBinding(session, gl) : null;
  const grabber = binding ? createGrabber(gl, { flipY: FLIP }) : null;
  view.encoder = grabber?.encoderMode ?? "카메라 없음";
  display = grabber ? createDisplayEncoder({ gl, flipY: FLIP, socket: () => ws, params: PARAMS, onError: note }) : null;
  let cameraSeen = false;
  setTimeout(() => {
    if (!cameraSeen) note("카메라 화면을 보낼 수 없어요. 위치만 보내요");
  }, 3000);
  const perfTimer = setInterval(renderPerf, 1000);
  session.addEventListener("end", () => {
    arOn = false;
    lastFloor = null;
    display?.close();
    display = null;
    clearInterval(perfTimer);
    $("overlay").hidden = true;
    $("talk").querySelector(".talk-row").append($("talk-form"));
    $("talk").insertBefore($("pending"), $("talk").querySelector(".talk-row"));
    renderMarks([]);
  });
  $("stop").onclick = () => session.end();
  $("photo").onclick = () => { wantPhoto = true; };

  // always: 사진·엔진 프레임은 늘 보내고 표시 통계에 넣지 않는다
  const sendFrame = (pixels, header, quality, marks, readMs, always) => {
    const id = pipeline.start();
    const t0 = performance.now();
    grabber.toJpeg(pixels, header.width, header.height, quality, marks)
      .then((jpeg) => {
        const encodeMs = performance.now() - t0;
        // 사진·엔진 프레임은 늘 보낸다. 화면 프레임은 더 새 프레임이 먼저 나갔으면 버린다(순서 뒤바뀜)
        if (!pipeline.finish(id) && !always) {
          stats.skipped("stale");
          return;
        }
        if (ws?.readyState !== WebSocket.OPEN) return;
        ws.send(framePacket(header, jpeg));
        if (!always) stats.sent({ bytes: jpeg.size, readMs, encodeMs });
      })
      .catch((error) => {
        pipeline.fail(id);
        note(`화면을 보내지 못했어요: ${error.message}`);
      });
  };

  const onFrame = (time, frame) => {
    session.requestAnimationFrame(onFrame);
    // 아무것도 그리지 않는다(투명). 카메라 화면 위에 DOM 오버레이만 보인다.
    gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const hit = frame.getHitTestResults(hitSource)[0]?.getPose(space);
    hitPoint = hit ? [hit.transform.position.x, hit.transform.position.y, hit.transform.position.z] : null;
    const ho = hit?.transform.orientation;
    const hitOrientation = ho ? [ho.x, ho.y, ho.z, ho.w] : null;
    $("reticle").classList.toggle("hit", Boolean(hitPoint));

    const pose = frame.getViewerPose(space);
    if (!pose) {
      lastFloor = null;
      return;
    }
    const { position: p, orientation: o } = pose.transform;
    const position = [p.x, p.y, p.z];
    const orientation = [o.x, o.y, o.z, o.w];
    const tracking = pose.emulatedPosition ? "limited" : "ok";
    view.limited = tracking === "limited";
    lastFloor = floorCandidate(hitPoint, hitOrientation, position);
    if (time - lastSent >= SEND_MS) {
      lastSent = time;
      send({ type: "pose", position, orientation, tracking, hit: hitPoint, epoch });
    }

    const xrView = pose.views[0];
    const marks = xrView && focus.targets.length && time < focus.until
      ? focusMarks(focus.targets, xrView.projectionMatrix, xrView.transform.inverse.matrix)
      : [];
    renderMarks(marks);

    const camera = xrView?.camera;
    if (!grabber || !camera) return;
    cameraSeen = true;
    display?.frame(binding.getCameraImage(camera), camera, time);
    if (engineMs && engineDue(lastEngine, time, engineMs) && ws?.readyState === WebSocket.OPEN) {
      lastEngine = time;
      const ew = Math.min(frameWidth(PARAMS.get("w"), camera.height > camera.width), camera.width);
      const eh = Math.round((ew * camera.height) / camera.width);
      const e0 = performance.now();
      const enginePixels = grabber.grab(binding.getCameraImage(camera), ew, eh);
      const engineRead = performance.now() - e0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer.framebuffer);
      const engineHeader = {
        kind: "engine", width: ew, height: eh, position, orientation, tracking, epoch,
        projection: Array.from(xrView.projectionMatrix), ...stamp(performance.timeOrigin + time),
      };
      sendFrame(enginePixels, engineHeader, ENGINE_QUALITY, [], engineRead, true);
    }
    const photo = wantPhoto;
    if (!photo && time - lastFrame < FRAME_MS) return;
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (!photo && !pipeline.canStart()) {
      stats.skipped("encoding");
      return;
    }
    if (!photo && ws.bufferedAmount > MAX_BUFFERED) {
      stats.skipped("buffer");
      return;
    }
    wantPhoto = false;
    lastFrame = time;
    const portrait = camera.height > camera.width;
    const width = photo ? camera.width : Math.min(frameWidth(PARAMS.get("w"), portrait), camera.width);
    const height = Math.round((width * camera.height) / camera.width);
    if (!photo) view.size = `${width}×${height}`;
    const t0 = performance.now();
    const pixels = grabber.grab(binding.getCameraImage(camera), width, height);
    const readMs = performance.now() - t0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer.framebuffer);
    const header = { kind: photo ? "photo" : "frame", width, height, position, orientation, tracking, epoch, ...stamp(performance.timeOrigin + time) };
    sendFrame(pixels, header, photo ? 0.9 : FRAME_QUALITY, photo ? [] : marks, readMs, photo);
  };
  session.requestAnimationFrame(onFrame);
}

$("start").addEventListener("click", () => {
  start().catch((error) => { $("support").textContent = `AR을 시작하지 못했어요: ${error.message}`; });
});
setupTalk();
setupMenu();
connect();
checkSupport();
