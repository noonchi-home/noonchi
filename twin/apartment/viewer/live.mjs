// 실시간 연결(?live=): twin-home WebSocket(/events)의 기기 상태를 3D 트윈에 반영하고,
// 화면 가전 패널에서 바꾼 상태는 twin-home(POST /api/devices/:id/twin)으로 보낸다.
//
// - ?live=auto(또는 1): 같은 호스트의 /events(twin-home이 /twin/viewer/로 이 뷰어를 줄 때).
//   ?live=ws://127.0.0.1:8200/events: 다른 출처(예: :8100 미리보기 서버)에서 붙을 때.
// - 원격 상태를 반영하는 동안에는 되돌려 보내지 않는다(되울림 방지). 사용자가 바꾼 값은 로컬에서 바꾸지 않고
//   twin-home으로 보낸 뒤, 돌아오는 state 이벤트가 3D를 바꾼다. 승인이 필요하면(409) 알림에 승인 버튼을 띄운다.
// - twin-home이 모르는 객체·attr(장식, 월패드 등)는 로컬에서만 바뀐다.
// - ?embed=1: 다른 화면(twin-home 웹)에 iframe으로 넣을 때 오른쪽 패널·도구를 숨기고 가전 패널을 접어 둔다(버튼으로 편다).
// - {type:"eye"}: 폰 AR(클로이드의 눈) 자세. viewer.setEye로 넘겨 눈 마커를 움직인다(표시 전용).
// - {type:"layout"}: 실행 중 배치 보정(옮기기·더하기·빼기). viewer.applyLayout으로 넘긴다(layout.mjs).
// - {type:"focus"}: 클로이드가 방금 다룬 객체. viewer.setFocus로 넘겨 고리를 그린다.
//
// 이 파일의 앞부분(liveUrl, httpBase, createLiveSync)은 DOM 없이 node --test로 검사한다.

const same = (a, b) => a === b || String(a) === String(b);

/** URL 검색 문자열과 location으로 WebSocket 주소를 정한다. live가 없거나 쓸 수 없는 값이면 null. */
export function liveUrl(search, loc) {
  const raw = new URLSearchParams(search).get("live");
  if (raw === null) return null;
  const value = raw.trim();
  if (value === "" || value === "auto" || value === "1") {
    return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/events`;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (url.pathname === "/" || url.pathname === "") url.pathname = "/events";
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
  return url.toString();
}

/** ws://host/events → http://host (REST 주소). */
export function httpBase(wsUrl) {
  const url = new URL(wsUrl);
  const protocol = url.protocol === "wss:" ? "https:" : "http:";
  const path = url.pathname.replace(/\/events\/?$/, "").replace(/\/$/, "");
  return `${protocol}//${url.host}${path}`;
}

/**
 * 상태 동기화 핵심(DOM 없음).
 * viewer: { getAttrs(id) → {attr: values[]} | undefined, getState(id), setState(id, attr, value) }
 * send(id, attr, value) → Promise<{ status, json }>: twin-home으로 보낸다.
 * onNotice({ kind: "confirm" | "error", ... }): 승인 요청·오류 알림.
 * onEye(eye): 폰 AR 눈 자세(표시 전용). onLayout(msg): 배치 보정. onFocus(focus): 초점.
 */
export function createLiveSync({ viewer, send, onNotice = () => {}, onStats = () => {}, onEye = () => {}, onLayout = () => {}, onFocus = () => {} }) {
  const remote = new Map(); // twin-home이 아는 기기 id → 마지막 twin 상태
  const unknownIds = new Set();
  const unknownAttrs = new Set();
  const badValues = new Set();
  const known = new Set();
  let applied = 0;
  let applying = false;
  let connected = false;

  const stats = () => ({
    connected, applied, devices: known.size, remote: remote.size,
    unknownIds: unknownIds.size, unknownAttrs: unknownAttrs.size, badValues: badValues.size,
  });

  function applyState(state) {
    if (!state || typeof state.id !== "string" || !state.twin || typeof state.twin !== "object") return;
    const { id, twin } = state;
    // 신호 없음(twin-home 설정): 상태를 모르므로 화면 값은 그대로 두고, 이 기기 조작은 계속 twin-home으로 보낸다
    if (state.signal === "none") {
      remote.set(id, { ...viewer.getState(id) });
      return;
    }
    remote.set(id, { ...twin });
    const attrs = viewer.getAttrs(id);
    if (!attrs) {
      unknownIds.add(id);
      return;
    }
    known.add(id);
    const current = viewer.getState(id);
    for (const [attr, value] of Object.entries(twin)) {
      if (!attrs[attr]) {
        unknownAttrs.add(`${id}.${attr}`);
        continue;
      }
      if (!attrs[attr].some((v) => same(v, value))) {
        badValues.add(`${id}.${attr}=${String(value)}`);
        continue;
      }
      if (same(current[attr], value)) continue;
      applying = true;
      try {
        viewer.setState(id, attr, value);
        applied += 1;
      } catch {
        badValues.add(`${id}.${attr}=${String(value)}`);
      } finally {
        applying = false;
      }
    }
  }

  function handleMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "eye") {
      onEye(msg.eye);
      return;
    }
    if (msg.type === "layout") {
      onLayout(msg);
      return;
    }
    if (msg.type === "focus") {
      onFocus(msg.focus);
      return;
    }
    if (msg.type === "state") applyState(msg.state);
    onStats(stats());
  }

  async function forward(id, attr, value) {
    let res;
    try {
      res = await send(id, attr, value);
    } catch (error) {
      onNotice({ kind: "error", id, attr, value, message: `twin-home에 보내지 못했습니다: ${error.message}` });
      return;
    }
    const json = res?.json ?? {};
    if (res?.status === 409 && json.needsConfirmation) {
      onNotice({ kind: "confirm", id, attr, value, token: json.needsConfirmation.token, reason: json.needsConfirmation.reason });
    } else if (!res || res.status >= 400 || json.ok === false) {
      onNotice({ kind: "error", id, attr, value, message: json.error ?? `HTTP ${res?.status}` });
    }
  }

  /** main.mjs setState 앞에서 부른다. false면 로컬에서 바꾸지 않는다(twin-home으로 보냈음). */
  function userChange(id, attr, value) {
    if (applying || !connected) return undefined;
    const twin = remote.get(id);
    if (!twin || !(attr in twin)) return undefined;
    forward(id, attr, value);
    return false;
  }

  function setConnected(on) {
    connected = Boolean(on);
    onStats(stats());
  }

  return { handleMessage, userChange, setConnected, stats, remote };
}

// --- 브라우저 쪽(상태 칩, 알림, 다시 연결) -----------------------------------------------------------

const STYLE = `
.live-chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; font-size: 12px;
  border: 1px solid #e2ded7; background: #fff; color: #767b82; white-space: nowrap; }
.live-chip::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #b3423a; }
.live-chip.on { color: #3f7d4f; }
.live-chip.on::before { background: #3f7d4f; }
.live-notices { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 20; display: flex; flex-direction: column;
  gap: 8px; width: min(420px, calc(100% - 24px)); pointer-events: none; }
.live-notice { pointer-events: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 8px;
  background: #fff6e6; border: 1px solid #e0a03a; color: #34383e; box-shadow: 0 2px 8px rgb(0 0 0 / 0.12); font-size: 13px; }
.live-notice.error { background: #fdecec; border-color: #b3423a; }
.live-notice .why { flex: 1 1 200px; }
.live-notice button { font: inherit; padding: 3px 10px; border-radius: 6px; border: 1px solid #d8d2c8; background: #fff; cursor: pointer; }
.live-notice button.ok { background: #b9773f; border-color: #b9773f; color: #fff; }
.live-panel-toggle { display: none; }
body.live-embed .panel.right, body.live-embed .bar .tools, body.live-embed .bar label:has(#mode),
body.live-embed .bar label:has(#ao), body.live-embed .bar label:has(#isolate) { display: none; }
body.live-embed .bar > strong, body.live-embed .bar > #status { display: none; }
body.live-embed .bar { padding: 4px 8px; gap: 4px 10px; font-size: 12px; }
body.live-embed .live-chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
body.live-embed .panel.left { width: min(240px, calc(100% - 24px)); font-size: 12px; }
body.live-embed .live-panel-toggle { display: inline-block; font: inherit; }
body.live-embed.live-panel-hidden .panel.left { display: none; }
`;

/** ?live=가 있으면 연결을 시작한다. hook(fn): main.mjs가 사용자 setState 앞에서 fn을 부르게 한다. */
export function startLive({ viewer, hook, search = location.search, loc = location } = {}) {
  const url = liveUrl(search, loc);
  if (!url) return null;
  const base = httpBase(url);
  const params = new URLSearchParams(search);
  const embed = params.get("embed") === "1" || params.has("embed");

  const style = document.createElement("style");
  style.id = "live-style";
  style.textContent = STYLE;
  document.head.append(style);
  const chip = document.createElement("span");
  chip.className = "live-chip";
  chip.id = "live-status";
  chip.setAttribute("role", "status");
  const bar = document.querySelector(".bar");
  (bar ?? document.body).append(chip);
  const notices = document.createElement("div");
  notices.className = "live-notices";
  notices.setAttribute("aria-live", "polite");
  document.body.append(notices);
  if (embed) {
    document.body.classList.add("live-embed");
    // 넣은 쪽(twin-home)에 대화·카드가 있으므로 가전 패널은 접어 두고 3D를 넓게 쓴다. 버튼으로 편다.
    // 패널이 접히고 펴질 때마다 resize를 보내 뷰어가 집을 화면에 다시 맞추게 한다.
    document.body.classList.add("live-panel-hidden");
    dispatchEvent(new Event("resize"));
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "live-panel-toggle";
    toggle.textContent = "가전 패널";
    toggle.addEventListener("click", () => {
      document.body.classList.toggle("live-panel-hidden");
      dispatchEvent(new Event("resize"));
    });
    bar?.insertBefore(toggle, bar.children[1] ?? null);
  }

  let attrsCache = new Map();
  let readyRef = null;
  const refreshAttrs = () => {
    attrsCache = new Map(viewer.objects().filter((o) => Object.keys(o.attrs ?? {}).length).map((o) => [o.id, o.attrs]));
  };
  const adapter = {
    getAttrs: (id) => attrsCache.get(id),
    getState: (id) => viewer.getState(id),
    setState: (id, attr, value) => viewer.setState(id, attr, value),
  };

  const post = async (path, body) => {
    const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    let json = {};
    try {
      json = await res.json();
    } catch {
      // 본문이 JSON이 아니면 빈 객체
    }
    return { status: res.status, json };
  };

  let lastStats = null;
  let state = "connecting";
  let retryIn = 0;
  const host = new URL(url).host;
  function render() {
    const s = lastStats ?? sync.stats();
    const label = state === "open" ? "연결됨" : state === "connecting" ? "연결 중…" : `끊김${retryIn ? ` · ${retryIn}초 뒤 다시` : ""}`;
    const ignored = s.unknownIds + s.unknownAttrs + s.badValues;
    chip.className = state === "open" ? "live-chip on" : "live-chip";
    chip.textContent = `실시간 ${label} · twin-home ${host} · 기기 ${s.devices} · 반영 ${s.applied}${ignored ? ` · 무시 ${ignored}` : ""}`;
    chip.title = `${url}\n반영한 기기 ${s.devices}개(twin-home ${s.remote}개), 상태 변경 ${s.applied}번\n` +
      `무시: 모르는 기기 ${s.unknownIds} · 모르는 상태 ${s.unknownAttrs} · 쓸 수 없는 값 ${s.badValues}`;
    chip.dataset.state = state;
  }

  function notice(n) {
    const box = document.createElement("div");
    box.className = n.kind === "error" ? "live-notice error" : "live-notice";
    box.dataset.kind = n.kind;
    box.dataset.id = n.id;
    const why = document.createElement("span");
    why.className = "why";
    why.textContent = n.kind === "confirm" ? n.reason : n.message;
    box.append(why);
    const close = () => box.remove();
    if (n.kind === "confirm") {
      const ok = document.createElement("button");
      ok.type = "button";
      ok.className = "ok";
      ok.textContent = "승인";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "취소";
      ok.addEventListener("click", async () => {
        ok.disabled = cancel.disabled = true;
        try {
          const r = await post("/api/agent/confirm", { token: n.token });
          if (r.status >= 400 || r.json.ok === false) {
            why.textContent = r.json.reply ?? r.json.error ?? `승인하지 못했습니다(HTTP ${r.status}).`;
            box.classList.add("error");
            setTimeout(close, 6000);
          } else close();
        } catch (error) {
          why.textContent = `승인 요청 실패: ${error.message}`;
          box.classList.add("error");
        }
      });
      cancel.addEventListener("click", () => {
        post("/api/agent/cancel", { token: n.token }).catch(() => {});
        close();
      });
      box.append(ok, cancel);
      setTimeout(close, 5 * 60 * 1000); // 승인 토큰 만료(5분)
    } else {
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "닫기";
      x.addEventListener("click", close);
      box.append(x);
      setTimeout(close, 8000);
    }
    notices.append(box);
    while (notices.children.length > 4) notices.firstElementChild.remove();
  }

  const sync = createLiveSync({
    viewer: adapter,
    send: (id, attr, value) => post(`/api/devices/${encodeURIComponent(id)}/twin`, { attr, value }),
    onNotice: notice,
    onStats: (s) => { lastStats = s; render(); },
    onEye: (eye) => viewer.setEye?.(eye),
    // 더한 객체도 상태를 주고받도록 붙인 뒤 기기 목록을 다시 읽는다
    onLayout: (msg) => Promise.resolve(viewer.applyLayout?.(msg)).then(refreshAttrs).catch((error) => console.warn("[live] 배치 반영 실패", error)),
    onFocus: (focus) => viewer.setFocus?.(focus),
  });
  hook?.(sync.userChange);

  // 메시지는 순서대로, 뷰어가 다 불러온 뒤에 반영한다(불러오기 방식을 바꾸면 다시 기다린다)
  let queue = Promise.resolve();
  const enqueue = (msg) => {
    queue = queue.then(async () => {
      const r = viewer.ready;
      try {
        await r;
      } catch {
        // 불러오기 실패는 뷰어가 알린다
      }
      if (r !== readyRef) {
        readyRef = r;
        refreshAttrs();
      }
      sync.handleMessage(msg);
    }).catch((error) => console.warn("[live] 반영 실패", error));
  };

  let ws = null;
  let delay = 1000;
  let timer = null;
  let stopped = false;
  function connect() {
    state = "connecting";
    retryIn = 0;
    render();
    try {
      ws = new WebSocket(url);
    } catch (error) {
      console.warn("[live] 연결 실패", error);
      schedule();
      return;
    }
    ws.addEventListener("open", () => {
      state = "open";
      delay = 1000;
      sync.setConnected(true);
      render();
    });
    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      enqueue(msg);
    });
    ws.addEventListener("close", () => {
      sync.setConnected(false);
      schedule();
    });
    ws.addEventListener("error", () => {}); // close가 뒤따른다
  }
  function schedule() {
    if (stopped) return;
    state = "closed";
    clearTimeout(timer);
    retryIn = Math.round(delay / 1000);
    render();
    timer = setTimeout(connect, delay);
    delay = Math.min(delay * 2, 15000);
  }
  connect();

  const api = { url, base, sync, stats: () => sync.stats(), get state() { return state; }, close: () => { stopped = true; clearTimeout(timer); ws?.close(); } };
  window.aptLive = api;
  return api;
}
