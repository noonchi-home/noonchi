// twin-home 웹 화면: 방별 기기 카드(빠른 제어, 센서 시뮬레이션) | 3D 트윈(실시간) | 에이전트 대화. 폰 너비에서는 탭.
// 빌드 없이 쓰는 ES 모듈. 상태는 WebSocket /events로 실시간 반영한다.

const $ = (sel) => document.querySelector(sel);

const KIND_LABELS = {
  light: "조명", plug: "플러그", tv: "TV", speaker: "스피커", aircon: "에어컨", purifier: "공기청정기",
  fan: "팬", hood: "후드", cooktop: "인덕션", microwave: "전자레인지", dishwasher: "식기세척기",
  washer: "세탁기", dryer: "건조기", fridge: "냉장고", vacuum: "로봇청소기", covering: "커튼·블라인드",
  lock: "도어록", contact: "문 센서", valve: "수전", thermostat: "보일러", status: "상태 표시",
};
const ATTR_TEXT = {
  power: { on: "켜짐", off: "꺼짐" },
  running: { true: "동작 중", false: "멈춤" },
  lock: { locked: "잠김", unlocked: "잠금 해제" },
  door: { open: "문 열림", closed: "문 닫힘" },
  curtain: { open: "열림", closed: "닫힘" },
  blind: { open: "열림", closed: "닫힘" },
  faucet: { on: "물 나옴", off: "물 잠김" },
  water: { on: "물 나옴", off: "물 잠김" },
  heating: { on: "난방 켜짐", off: "난방 꺼짐" },
  charging: { on: "충전 중", off: "충전 안 함" },
};
const ACTIVE = { power: "on", running: true, lock: "unlocked", door: "open", curtain: "closed", blind: "closed", faucet: "on", water: "on", heating: "on", charging: "on" };
const MODES = { cool: "냉방", heat: "난방", auto: "자동", dry: "제습", fan: "송풍" };
const FANS = { low: "약", medium: "중", high: "강", auto: "자동" };
const TOOL_LABELS = {
  list_rooms: "방 목록", list_devices: "기기 목록", find_devices: "기기 찾기", get_state: "상태", turn_on: "켜기", turn_off: "끄기",
  set_level: "밝기", set_climate: "냉난방", set_covering: "커튼", lock: "잠금", unlock: "잠금 해제", start: "시작", stop: "정지", set_valve: "수전",
};
const SUGGESTIONS = ["거실 불 켜고 TV 꺼줘", "에어컨 24도로 맞춰줘", "안방 커튼 닫아줘", "현관문 열어줘", "현관문 상태 알려줘"];

const app = {
  devices: new Map(), // id → DeviceView(spec + state)
  rooms: [],
  filter: "all",
  sim: false,
  sessionId: loadSession(),
  live: null, // 응답을 기다리는 동안 실시간 작업 표시
};

// ── 도우미 ─────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

function loadSession() {
  try {
    const saved = localStorage.getItem("twin-home.session");
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem("twin-home.session", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function saveSession(id) {
  try {
    localStorage.setItem("twin-home.session", id);
  } catch {
    // 저장소를 못 쓰면 이번 화면에서만 쓴다
  }
}

async function api(path, body) {
  const init = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  try {
    const res = await fetch(path, init);
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } catch (e) {
    return { status: 0, json: { ok: false, error: `서버에 연결하지 못했습니다: ${e.message}` } };
  }
}

// ── 기기 패널 ───────────────────────────────────────────

function isOn(d) {
  const t = d.state?.twin ?? {};
  return Object.entries(t).some(([k, v]) => !d.sensors.includes(k) && ACTIVE[k] === v && k !== "curtain" && k !== "blind");
}

function stateChips(d) {
  const chips = [];
  for (const [attr, v] of Object.entries(d.state?.twin ?? {})) {
    const sensor = d.sensors.includes(attr);
    const active = ACTIVE[attr] === v;
    const cls = ["chip", sensor ? "sensor" : "", active ? (attr === "door" || attr === "lock" ? "alert" : "on") : ""].filter(Boolean).join(" ");
    chips.push(el("span", { class: cls, title: sensor ? "센서(에이전트가 못 바꿈)" : attr }, ATTR_TEXT[attr]?.[String(v)] ?? `${attr}: ${v}`));
  }
  const m = d.state?.matter ?? {};
  if (d.kind === "light" && m.onOff && typeof m.level === "number") chips.push(el("span", { class: "chip" }, `밝기 ${m.level}%`));
  if (d.kind === "speaker" && typeof m.level === "number") chips.push(el("span", { class: "chip" }, `음량 ${m.level}%`));
  if ((d.kind === "aircon" && m.onOff) || (d.kind === "thermostat" && m.systemMode !== "off")) {
    if (d.kind === "aircon" && MODES[m.systemMode]) chips.push(el("span", { class: "chip" }, MODES[m.systemMode]));
    if (typeof m.setpointC === "number") chips.push(el("span", { class: "chip" }, `${m.setpointC}°C`));
  }
  if (["purifier", "fan", "hood"].includes(d.kind) && m.fanMode && m.fanMode !== "off") chips.push(el("span", { class: "chip" }, `바람 ${FANS[m.fanMode] ?? m.fanMode}`));
  if (d.kind === "covering" && typeof m.openPercent === "number" && m.openPercent > 0 && m.openPercent < 100) chips.push(el("span", { class: "chip" }, `${m.openPercent}% 열림`));
  if (!d.state?.online) chips.push(el("span", { class: "chip alert" }, "오프라인"));
  return chips;
}

function matterLine(d) {
  const m = d.state?.matter ?? {};
  const parts = Object.entries(m).map(([k, v]) => `${k}=${typeof v === "boolean" ? v : v}`);
  return el("div", { class: "matter", title: `Matter 기기: ${d.matterDeviceType}` }, `${d.matterDeviceType === "none" ? "Matter 아님" : d.matterDeviceType.replace(/Device$/, "")} · ${parts.join(" ")}`);
}

function controls(d) {
  const c = d.capabilities;
  const m = d.state?.matter ?? {};
  const t = d.state?.twin ?? {};
  const box = el("div", { class: "controls" });
  const cmd = (command) => sendCommand(d, command);

  if (c.includes("onoff")) {
    const on = isOn(d);
    box.append(el("button", { class: "switch", role: "switch", "aria-checked": String(on), "aria-label": `${d.label} ${on ? "끄기" : "켜기"}`, title: on ? "끄기" : "켜기", onclick: () => cmd({ type: on ? "off" : "on" }) }));
  }
  if (c.includes("level")) {
    const val = el("span", { class: "val" }, `${m.level ?? 0}%`);
    const range = el("input", { type: "range", min: 0, max: 100, step: 5, value: m.level ?? 0, "aria-label": `${d.label} ${d.kind === "speaker" ? "음량" : "밝기"}` });
    range.addEventListener("input", () => { val.textContent = `${range.value}%`; });
    range.addEventListener("change", () => cmd({ type: "level", percent: Number(range.value) }));
    box.append(range, val);
  }
  if (c.includes("climate")) {
    const sp = typeof m.setpointC === "number" ? m.setpointC : 24;
    box.append(
      el("button", { class: "small", "aria-label": "설정 온도 내리기", onclick: () => cmd({ type: "climate", setpointC: sp - 1 }) }, "−"),
      el("span", { class: "val" }, `${sp}°C`),
      el("button", { class: "small", "aria-label": "설정 온도 올리기", onclick: () => cmd({ type: "climate", setpointC: sp + 1 }) }, "+"),
    );
    if (d.kind === "aircon") {
      const sel = el("select", { "aria-label": "모드" }, ...Object.entries(MODES).map(([k, v]) => el("option", { value: k, selected: m.systemMode === k }, v)));
      sel.addEventListener("change", () => cmd({ type: "climate", mode: sel.value }));
      box.append(sel);
    }
  }
  if (c.includes("fan") && d.kind !== "aircon") {
    const off = !m.fanMode || m.fanMode === "off";
    const sel = el("select", { "aria-label": "바람 세기" },
      el("option", { value: "", selected: off, disabled: true }, "바람 -"),
      ...Object.entries(FANS).map(([k, v]) => el("option", { value: k, selected: m.fanMode === k }, `바람 ${v}`)));
    sel.addEventListener("change", () => sel.value && cmd({ type: "climate", fan: sel.value }));
    box.append(sel);
  }
  if (c.includes("covering")) {
    box.append(
      el("button", { class: "small", onclick: () => cmd({ type: "covering", openPercent: 100 }) }, "열기"),
      el("button", { class: "small", onclick: () => cmd({ type: "covering", openPercent: 0 }) }, "닫기"),
    );
    const range = el("input", { type: "range", min: 0, max: 100, step: 10, value: m.openPercent ?? 100, "aria-label": `${d.label} 열림 정도` });
    range.addEventListener("change", () => cmd({ type: "covering", openPercent: Number(range.value) }));
    box.append(range);
  }
  if (c.includes("lock")) {
    const locked = t.lock === "locked";
    box.append(
      el("button", { class: `small ${locked ? "active" : ""}`, onclick: () => cmd({ type: "lock" }) }, "잠금"),
      el("button", { class: `small ${!locked ? "active" : ""}`, onclick: () => cmd({ type: "unlock" }) }, "잠금 해제"),
    );
  }
  if (c.includes("operation")) {
    const running = m.operationalState === "running";
    box.append(
      el("button", { class: `small ${running ? "active" : ""}`, onclick: () => cmd({ type: "start" }) }, "시작"),
      el("button", { class: "small", onclick: () => cmd({ type: "stop" }) }, "정지"),
    );
  }
  if (c.includes("valve")) {
    const open = m.valveState === "open";
    box.append(el("button", { class: "switch", role: "switch", "aria-checked": String(open), "aria-label": `${d.label} 물 ${open ? "잠그기" : "틀기"}`, onclick: () => cmd({ type: "valve", open: !open }) }));
  }
  // 센서: 시뮬레이션 모드에서만 바꿀 수 있다
  if (app.sim) {
    for (const attr of d.sensors) {
      const values = d.twinAttrs[attr] ?? [];
      const cur = t[attr];
      const next = values.find((v) => v !== cur);
      if (next === undefined) continue;
      box.append(el("button", { class: "small", title: "센서 시뮬레이션", onclick: () => setSensor(d, attr, next) }, `시뮬레이션: ${ATTR_TEXT[attr]?.[String(next)] ?? `${attr}=${next}`}`));
    }
  }
  return box.childElementCount > 0 ? box : null;
}

function renderCard(d) {
  const card = el("article", { class: `card ${isOn(d) ? "is-on" : ""}`, "data-id": d.id });
  card.append(
    el("div", { class: "head" }, el("span", { class: "name" }, d.label), d.label.includes(KIND_LABELS[d.kind] ?? d.kind) ? null : el("span", { class: "kind" }, KIND_LABELS[d.kind] ?? d.kind)),
    el("div", { class: "chips" }, stateChips(d)),
    matterLine(d),
  );
  const ctl = controls(d);
  if (ctl) card.append(ctl);
  return card;
}

function updateCard(id, flash) {
  const d = app.devices.get(id);
  const old = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (!d || !old) return;
  const fresh = renderCard(d);
  old.replaceWith(fresh);
  if (flash) {
    fresh.classList.add("flash");
    requestAnimationFrame(() => requestAnimationFrame(() => fresh.classList.remove("flash")));
  }
  updateRoomCounts();
}

function updateRoomCounts() {
  for (const room of app.rooms) {
    const n = [...app.devices.values()].filter((d) => d.room === room.id && isOn(d)).length;
    const span = document.querySelector(`[data-room-count="${CSS.escape(room.id)}"]`);
    if (span) span.textContent = `${room.deviceCount}개${n ? ` · 켜짐 ${n}` : ""}`;
  }
}

function renderFilter() {
  const box = $("#room-filter");
  box.replaceChildren();
  const mk = (id, label) => el("button", { type: "button", role: "tab", "aria-selected": String(app.filter === id), class: app.filter === id ? "active" : "", onclick: () => { app.filter = id; renderFilter(); renderRooms(); } }, label);
  box.append(mk("all", "전체"), ...app.rooms.filter((r) => r.deviceCount > 0).map((r) => mk(r.id, r.label)));
}

function renderRooms() {
  const box = $("#rooms");
  box.replaceChildren();
  const rooms = app.rooms.filter((r) => r.deviceCount > 0 && (app.filter === "all" || app.filter === r.id));
  if (rooms.length === 0) box.append(el("p", { class: "empty" }, "기기가 없습니다."));
  for (const room of rooms) {
    const devices = [...app.devices.values()].filter((d) => d.room === room.id);
    box.append(el("section", { class: "room" },
      el("h3", {}, room.label, el("span", { class: "count", "data-room-count": room.id })),
      el("div", { class: "cards" }, devices.map(renderCard)),
    ));
  }
  updateRoomCounts();
}

async function sendCommand(d, command) {
  const r = await api(`/api/devices/${encodeURIComponent(d.id)}/command`, { command });
  if (r.status === 409 && r.json.needsConfirmation) {
    addConfirm({ token: r.json.needsConfirmation.token, reason: r.json.needsConfirmation.reason, deviceLabel: d.label });
  } else if (!r.json.ok) {
    addMessage("error", r.json.error ?? "명령에 실패했습니다.");
  }
}

async function setSensor(d, attr, value) {
  const r = await api(`/api/sensors/${encodeURIComponent(d.id)}`, { attr, value });
  if (!r.json.ok) addMessage("error", r.json.error ?? "센서 값을 바꾸지 못했습니다.");
}

// ── 대화 ───────────────────────────────────────────────

function scrollChat() {
  const box = $("#messages");
  box.scrollTop = box.scrollHeight;
}

function addMessage(role, text, extra) {
  const li = el("li", { class: `msg ${role}` }, el("div", { class: "bubble" }, text));
  if (extra) li.append(extra);
  $("#messages").append(li);
  scrollChat();
  return li;
}

function actionChip(a) {
  const cls = a.needsConfirmation ? "wait" : a.ok ? "ok" : "fail";
  const mark = a.needsConfirmation ? "승인 대기" : a.ok ? "완료" : "실패";
  const target = a.deviceLabel ?? a.args?.device_id ?? a.args?.query ?? "";
  return el("span", { class: `action ${cls}`, title: a.error ?? a.message ?? "" }, `${TOOL_LABELS[a.tool] ?? a.tool}${target ? ` ${target}` : ""} · ${mark}`);
}

function addConfirm(p) {
  const card = el("div", { class: "confirm", role: "group", "aria-label": "승인 요청" });
  const btns = el("div", { class: "btns" });
  const done = (text) => {
    card.classList.add("done");
    btns.replaceChildren(el("span", { class: "typing" }, text));
  };
  btns.append(
    el("button", { class: "primary small", onclick: async () => {
      done("처리 중…");
      const r = await api("/api/agent/confirm", { token: p.token });
      done(r.json.ok ? "승인함" : "실패");
      addMessage(r.json.ok ? "agent" : "error", r.json.reply ?? r.json.error ?? (r.json.ok ? "실행했어요." : "실패했어요."));
    } }, "승인"),
    el("button", { class: "small", onclick: async () => {
      const r = await api("/api/agent/cancel", { token: p.token });
      done("취소함");
      addMessage("system", r.json.reply ?? "취소했어요.");
    } }, "취소"),
  );
  card.append(el("div", { class: "why" }, p.reason), btns);
  const li = el("li", { class: "msg agent" }, card);
  $("#messages").append(li);
  scrollChat();
}

async function sendChat(message) {
  const text = message.trim();
  if (!text) return;
  addMessage("user", text);
  const input = $("#chat-input");
  input.value = "";
  $("#send").disabled = true;
  const live = el("div", { class: "actions" });
  const pending = addMessage("agent", "…", live);
  pending.querySelector(".bubble").classList.add("typing");
  app.live = live;
  const r = await api("/api/agent/chat", { message: text, sessionId: app.sessionId });
  app.live = null;
  pending.remove();
  $("#send").disabled = false;
  input.focus();
  if (!r.json.reply) {
    addMessage("error", r.json.error ?? "에이전트가 답하지 못했습니다.");
    return;
  }
  const extra = r.json.actions?.length ? el("div", { class: "actions" }, r.json.actions.map(actionChip)) : null;
  addMessage("agent", r.json.reply, extra);
  for (const p of r.json.pendingConfirmations ?? []) addConfirm(p);
}

// ── 실시간 ─────────────────────────────────────────────

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/events`);
  const conn = $("#conn");
  ws.addEventListener("open", () => {
    conn.textContent = "실시간 연결됨";
    conn.className = "badge on";
  });
  ws.addEventListener("close", () => {
    conn.textContent = "연결 끊김 · 다시 연결 중";
    conn.className = "badge off";
    setTimeout(connect, 1500);
  });
  ws.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "state") {
      const d = app.devices.get(msg.state.id);
      if (!d) return;
      const changed = JSON.stringify(d.state?.twin) !== JSON.stringify(msg.state.twin) || JSON.stringify(d.state?.matter) !== JSON.stringify(msg.state.matter);
      d.state = msg.state;
      if (changed) updateCard(d.id, true);
    } else if (msg.type === "agent" && msg.event === "action" && msg.sessionId === app.sessionId && app.live) {
      app.live.append(actionChip(msg.action));
      scrollChat();
    }
  });
}

// ── 3D 트윈 창 ─────────────────────────────────────────
// twin-studio 뷰어(/twin/viewer/)를 ?live=auto&embed=1로 넣는다. 뷰어가 같은 /events를 받아 3D에 반영하고,
// 뷰어 가전 패널에서 바꾼 상태는 POST /api/devices/:id/twin(정책 포함)으로 돌아온다.

const TWIN_SRC = "/twin/viewer/?live=auto&embed=1";
const narrow = window.matchMedia("(max-width: 860px)");
const twin = { available: false, on: loadTwinPref(), tab: "devices" };

function loadTwinPref() {
  try {
    return localStorage.getItem("twin-home.twin") !== "off";
  } catch {
    return true;
  }
}

async function checkTwin(health) {
  if (!health.json?.twin) return false;
  try {
    const res = await fetch("/twin/viewer/", { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

function applyTwin() {
  const pane = $("#twin-pane");
  const layout = $("#layout");
  const mobile = narrow.matches;
  const show = mobile ? twin.tab === "twin" : twin.available && twin.on;
  pane.hidden = !show;
  layout.classList.toggle("with-twin", !mobile && twin.available && twin.on);
  layout.dataset.tab = twin.tab;
  for (const b of document.querySelectorAll("#tabs [data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === twin.tab));
  $("#twin-toggle").setAttribute("aria-pressed", String(twin.on));
  const frame = $("#twin-frame");
  const msg = $("#twin-msg");
  if (!twin.available) {
    frame.hidden = true;
    msg.hidden = false;
    msg.textContent = "3D 트윈을 찾을 수 없어요. twin-studio의 apartment/(TWIN_STUDIO_DIR)가 있어야 /twin/viewer/가 열려요.";
    return;
  }
  if (show && !frame.getAttribute("src")) {
    msg.hidden = false;
    msg.textContent = "3D 트윈 불러오는 중…";
    frame.addEventListener("load", () => { msg.hidden = true; }, { once: true });
    frame.src = TWIN_SRC;
  } else if (show) {
    // 숨긴 동안 뷰어 캔버스가 0px로 줄었을 수 있다. iframe 창 크기는 그대로라 resize가 안 오므로 직접 알린다
    requestAnimationFrame(() => {
      try {
        frame.contentWindow?.dispatchEvent(new Event("resize"));
      } catch {
        // 다른 출처면 무시
      }
    });
  }
}

async function initTwin(health) {
  twin.available = await checkTwin(health);
  $("#twin-toggle").hidden = !twin.available;
  $("#twin-missing").hidden = twin.available;
  $("#twin-missing").title = "TWIN_STUDIO_DIR/apartment/가 없어 3D 트윈을 붙이지 못했어요.";
  $("#twin-toggle").addEventListener("click", () => {
    twin.on = !twin.on;
    try {
      localStorage.setItem("twin-home.twin", twin.on ? "on" : "off");
    } catch {
      // 저장소를 못 쓰면 이번 화면에서만
    }
    applyTwin();
  });
  for (const b of document.querySelectorAll("#tabs [data-tab]")) {
    b.addEventListener("click", () => {
      twin.tab = b.dataset.tab;
      applyTwin();
    });
  }
  narrow.addEventListener("change", applyTwin);
  window.addEventListener("resize", applyTwin);
  applyTwin();
}

// ── 시작 ───────────────────────────────────────────────

async function init() {
  const [health, rooms, devices] = await Promise.all([api("/api/health"), api("/api/rooms"), api("/api/devices")]);
  if (!Array.isArray(devices.json)) {
    $("#rooms").replaceChildren(el("p", { class: "empty" }, devices.json.error ?? "기기 목록을 불러오지 못했습니다."));
    return;
  }
  $("#hub").textContent = `허브 ${health.json.hub ?? "-"}${health.json.transport ? ` · ${health.json.transport}` : ""}`;
  $("#hub").title = health.json.hub === "matter" ? "Matter 브리지(가상 가전) ⇄ matter.js 컨트롤러" : "Matter 없이 메모리에서만";
  $("#provider").textContent = `에이전트 ${health.json.provider ?? "없음"}${health.json.model ? ` · ${health.json.model}` : ""}`;
  initTwin(health);
  app.rooms = rooms.json;
  for (const d of devices.json) app.devices.set(d.id, d);
  renderFilter();
  renderRooms();
  connect();

  $("#suggestions").append(...SUGGESTIONS.map((s) => el("button", { type: "button", onclick: () => sendChat(s) }, s)));
  $("#chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    sendChat($("#chat-input").value);
  });
  $("#sim-toggle").addEventListener("change", (e) => {
    app.sim = e.target.checked;
    renderRooms();
  });
  $("#new-session").addEventListener("click", () => {
    app.sessionId = crypto.randomUUID();
    saveSession(app.sessionId);
    $("#messages").replaceChildren();
    addMessage("system", "새 대화를 시작했어요.");
  });
  addMessage("system", "집 안 가전을 말로 제어해 보세요. 현관문 잠금 해제·인덕션 켜기·전자레인지 시작은 승인 후에만 실행돼요.");
}

init();
