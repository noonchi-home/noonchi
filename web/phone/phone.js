// 클로이드의 눈(폰): WebXR AR로 폰 자세를 재고, 화면 가운데 조준점이 가리키는 바닥 점을 기준점·'여기'로 쓴다.
// 자세(+조준점)는 초당 10번, 카메라 화면은 기본 초당 12장(가로 촬영 가로 480px·세로 360px JPEG, ?fps=·?w=로 바꾼다) /phone/events로 보낸다.
// 인코딩은 워커 두 개로 두 장까지 겹치고(capture.js), 순서가 뒤바뀐 오래된 프레임과 와이파이에 쌓인 프레임은 건너뛴다(pipeline.js).
// 보낸 장 수·readPixels·인코딩 시간·건너뛴 이유는 위 상태 줄(fps)과 ⋯ 메뉴에 보인다. '사진 찍기'는 카메라 원본 크기로
// 한 장을 보내고, 서버가 그 순간의 눈 자세를 붙여 저장한다. 트윈 좌표 계산은 서버(src/phone)가 한다.
// 화면은 가로 촬영용: 가운데 조준점, 오른쪽 큰 버튼(말하기·사진·끝내기), 위 상태 줄, 나머지(글 입력·다시 맞추기·측정)는 ⋯ 메뉴.
// 말하기: 크롬 내장 음성 인식(ko-KR, 누르고 말하기)으로 받아쓴 문장을 say로 보내고, 답은 읽어 주고 몇 초 보인다. 음성 인식이 없으면 글 입력.
// 초점: 서버가 보낸 대상(AR 좌표)을 화면에 고리로 그리고, 대시보드로 가는 화면 프레임에도 그린다(사진에는 그리지 않음).

import { createGrabber, framePacket } from "./capture.js";
import { createFramePipeline, createSendStats, frameWidth } from "./pipeline.js";
import { focusMarks } from "./project.js";

const $ = (id) => document.getElementById(id);
const SEND_MS = 100;
const PARAMS = new URLSearchParams(location.search);
const clamp = (raw, lo, hi, fallback) => {
  const n = Number(raw);
  return raw !== null && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const FRAME_MS = 1000 / clamp(PARAMS.get("fps"), 1, 30, 12);
const FRAME_QUALITY = 0.55; // 장 수를 늘린 만큼 한 장 크기를 줄인다(사진은 0.9)
const MAX_BUFFERED = 512 * 1024; // 와이파이가 느리면 프레임을 쌓지 않고 건너뛴다
const FLIP = PARAMS.get("flip") !== "0";
const IDLE_LABEL = "🎙 누르고 말하기";
const TOAST_MS = 5000;
let ws = null;
let hitPoint = null;
let lastSent = 0;
let lastFrame = 0;
let wantPhoto = false;
let focus = { targets: [], until: 0 };
const pipeline = createFramePipeline({ maxInFlight: 2 });
const stats = createSendStats({ windowMs: 2000 });
const view = { aligned: false, mismatch: null, anchors: "", limited: false, note: "", noteUntil: 0, lock: "시도 안 함", size: "-", encoder: "-" };

function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/phone/events`);
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "status") render(msg);
    else if (msg.type === "photo_saved") toast(msg.aligned ? "사진을 보냈어요(찍은 위치 포함)" : "사진을 보냈어요. 아직 맞추기 전이라 위치는 없어요");
    else if (msg.type === "reply") showReply(msg);
    else if (msg.type === "focus") focus = { targets: msg.targets ?? [], until: performance.now() + (msg.ttl_ms ?? 8000) };
  });
  ws.addEventListener("close", () => setTimeout(connect, 1000));
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
    ? `맞춤 ✓ · 거리 차이 ${Math.round(view.mismatch * 100)}cm${view.limited ? " · 추적 약함" : ""}`
    : `기준점 ${view.anchors}을 기록해 주세요`;
  $("status").textContent = performance.now() < view.noteUntil ? view.note : base;
  $("status").title = base;
}

function render(s) {
  $("anchor-names").textContent = s.anchors.map((a) => a.label).join(", ");
  const done = s.anchors.filter((a) => a.recorded).length;
  view.anchors = `${done}/${s.anchors.length}`;
  view.aligned = s.aligned;
  view.mismatch = s.mismatch_m;
  // 기준점 버튼은 맞추기 전에만 보인다(다시 맞추기는 ⋯ 메뉴)
  $("anchors").hidden = s.aligned;
  $("anchors").replaceChildren(...s.anchors.map((a) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `${a.recorded ? "✓ " : ""}${a.label} 지점 기록`;
    b.addEventListener("click", () => {
      if (!hitPoint) {
        note("조준점이 바닥에 닿지 않았어요. 바닥을 천천히 비춰 주세요");
        return;
      }
      send({ type: "anchor", id: a.id, point: hitPoint });
    });
    return b;
  }));
  if (s.error) note(s.error);
  else renderStatus();
}

// ── 측정: 보낸 fps는 상태 줄, 자세한 값은 ⋯ 메뉴 ───────────

function renderPerf() {
  const s = stats.snapshot();
  const ms = (v) => (v === null ? "-" : `${v.toFixed(1)}ms`);
  $("perf").textContent = `${s.fps.toFixed(1)} fps`;
  $("perf-detail").textContent = [
    `보낸 화면 ${s.fps.toFixed(1)} fps (목표 ${(1000 / FRAME_MS).toFixed(0)}) · 장당 ${s.kbPerFrame === null ? "-" : `${s.kbPerFrame.toFixed(1)}KB`}`,
    `readPixels ${ms(s.readMs)} · 인코딩 ${ms(s.encodeMs)} (${view.encoder})`,
    `와이파이 대기 ${Math.round((ws?.bufferedAmount ?? 0) / 1024)}KB · 크기 ${view.size}`,
    `건너뜀(2초): 인코딩 중 ${s.skipped.encoding} · 버퍼 가득 ${s.skipped.buffer} · 순서 뒤바뀜 ${s.skipped.stale}`,
    `가로 고정: ${view.lock}`,
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
    send({ type: "reset" });
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
    $("support").textContent = `보안 연결이 아니라 AR을 켤 수 없어요. 크롬 chrome://flags 'Insecure origins treated as secure'에 ${location.origin}을 넣고 크롬을 다시 시작하세요.`;
    return;
  }
  if (!navigator.xr || !(await navigator.xr.isSessionSupported("immersive-ar"))) {
    $("support").textContent = "이 브라우저는 WebXR AR을 지원하지 않아요. 안드로이드 크롬이 필요해요. 아래에서 글로 말할 수는 있어요.";
    return;
  }
  $("support").textContent = "준비됐어요. 폰을 가로로 들고 첫 기준점 근처에서 AR을 시작하세요.";
  $("start").disabled = false;
}

/** 가로 고정은 지원하지 않는 경우가 많다. 실패해도 AR은 계속한다(세로면 "가로로 돌려 주세요" 안내). */
function tryLandscape() {
  const lock = () => screen.orientation?.lock?.("landscape")
    .then(() => { view.lock = "됨"; })
    .catch((e) => { view.lock = `안 됨(${e?.name ?? "지원 안 함"})`; });
  try {
    const fs = document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
    if (fs) fs.then(lock, () => { view.lock = "안 됨(전체 화면 거절)"; lock(); });
    else lock();
  } catch {
    view.lock = "안 됨";
  }
}

async function start() {
  // AR 세션을 먼저 요청한다(사용자 터치 직후여야 한다). 가로 고정은 그다음에 시도만 한다.
  const requested = navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["local", "hit-test", "dom-overlay"],
    optionalFeatures: ["camera-access"],
    domOverlay: { root: $("overlay") },
  });
  tryLandscape();
  const session = await requested;
  $("overlay").hidden = false;
  // AR 중에는 DOM 오버레이 안의 것만 보인다: 글 입력은 ⋯ 메뉴로, 승인 버튼은 아래 가운데로 옮긴다
  $("menu-talk").append($("talk-form"));
  $("pending-slot").append($("pending"));
  const gl = document.createElement("canvas").getContext("webgl", { xrCompatible: true });
  session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
  const space = await session.requestReferenceSpace("local");
  const hitSource = await session.requestHitTestSource({ space: await session.requestReferenceSpace("viewer") });
  // 카메라 접근(camera-access)이 없으면 자세만 보낸다
  const binding = typeof XRWebGLBinding === "function" ? new XRWebGLBinding(session, gl) : null;
  const grabber = binding ? createGrabber(gl, { flipY: FLIP }) : null;
  view.encoder = grabber?.encoderMode ?? "카메라 없음";
  let cameraSeen = false;
  setTimeout(() => {
    if (!cameraSeen) note("카메라 화면을 보낼 수 없어요(크롬이 AR 카메라 접근을 지원하지 않거나 거절됨). 위치만 보내요");
  }, 3000);
  const perfTimer = setInterval(renderPerf, 1000);
  session.addEventListener("end", () => {
    clearInterval(perfTimer);
    $("overlay").hidden = true;
    $("talk").querySelector(".talk-row").append($("talk-form"));
    $("talk").insertBefore($("pending"), $("talk").querySelector(".talk-row"));
    renderMarks([]);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  });
  $("stop").onclick = () => session.end();
  $("photo").onclick = () => { wantPhoto = true; };

  const sendFrame = (pixels, header, quality, marks, readMs, photo) => {
    const id = pipeline.start();
    const t0 = performance.now();
    grabber.toJpeg(pixels, header.width, header.height, quality, marks)
      .then((jpeg) => {
        const encodeMs = performance.now() - t0;
        // 사진은 늘 보낸다. 화면 프레임은 더 새 프레임이 먼저 나갔으면 버린다(순서 뒤바뀜)
        if (!pipeline.finish(id) && !photo) {
          stats.skipped("stale");
          return;
        }
        if (ws?.readyState !== WebSocket.OPEN) return;
        ws.send(framePacket(header, jpeg));
        if (!photo) stats.sent({ bytes: jpeg.size, readMs, encodeMs });
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
    $("reticle").classList.toggle("hit", Boolean(hitPoint));

    const pose = frame.getViewerPose(space);
    if (!pose) return;
    const { position: p, orientation: o } = pose.transform;
    const position = [p.x, p.y, p.z];
    const orientation = [o.x, o.y, o.z, o.w];
    const tracking = pose.emulatedPosition ? "limited" : "ok";
    view.limited = tracking === "limited";
    if (time - lastSent >= SEND_MS) {
      lastSent = time;
      send({ type: "pose", position, orientation, tracking, hit: hitPoint });
    }

    const xrView = pose.views[0];
    const marks = xrView && focus.targets.length && time < focus.until
      ? focusMarks(focus.targets, xrView.projectionMatrix, xrView.transform.inverse.matrix)
      : [];
    renderMarks(marks);

    const camera = xrView?.camera;
    if (!grabber || !camera) return;
    cameraSeen = true;
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
    const header = { kind: photo ? "photo" : "frame", width, height, position, orientation, tracking };
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
