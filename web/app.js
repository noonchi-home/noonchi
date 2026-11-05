// twin-home 웹 화면: 왼쪽 3D 트윈(결과) | 오른쪽 위 클로이드의 눈(폰 카메라) · 오른쪽 아래 추론 과정(요청마다 단계 카드).
// 기기 카드(Matter 속성·센서 시뮬레이션)는 결과 전용 화면이라 헤더 버튼으로 여는 서랍이다. 좁은 화면에서는 탭.
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
  list_rooms: "방 목록 보기", list_devices: "기기 목록 보기", find_devices: "기기 찾기", get_state: "상태 확인", turn_on: "켜기", turn_off: "끄기",
  set_level: "밝기·음량 맞추기", set_climate: "냉난방 맞추기", set_covering: "커튼 맞추기", lock: "잠그기", unlock: "잠금 해제", start: "시작", stop: "정지",
  set_valve: "물 틀기·잠그기", find_objects: "물건 찾기", move_object: "물건 옮기기", add_object: "물건 더하기", remove_object: "물건 빼기",
  find_object_types: "종류 찾기", save_layout: "배치 저장", confirm: "승인 실행",
};
const PHONE_SESSION = "phone"; // 폰(클로이드의 눈)에서 말한 대화의 세션 id(서버 start.ts와 같음)

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

// ── 추론 과정 ─────────────────────────────────────────
// 요청마다 카드 하나: 접으면 요청과 답 한 줄, 펴면 단계마다 💭 생각(모델이 쓴 reason, 판단 근거 아님) → 🔧 행동(도구·대상)
// → 👁 관찰(도구 결과로 만든 문장), 끝에 💬 답과 🎯 초점. 승인 버튼은 그 카드 안에 있다. 폰 대화(🎙)·사진도 같은 흐름에 쌓인다.

const turns = { last: null, byToken: new Map() };

function scrollChat() {
  const box = $("#messages");
  box.scrollTop = box.scrollHeight;
}

/** 알림 한 줄(시스템·오류). */
function addMessage(role, text, extra) {
  const li = el("li", { class: `msg ${role}` }, el("div", { class: "bubble" }, text));
  if (extra) li.append(extra);
  $("#messages").append(li);
  scrollChat();
  return li;
}

function stateText(kind) {
  return { ok: "완료", wait: "승인 대기", fail: "실패", busy: "생각 중" }[kind] ?? kind;
}

function newTurn(source, text) {
  const state = el("span", { class: "state busy" }, stateText("busy"));
  const answer = el("span", { class: "answer" }, "…");
  const steps = el("ol", { class: "steps" });
  const details = el("details", { class: "turn" },
    el("summary", {}, el("span", { class: "src", title: source === "phone" ? "폰에서 말함" : "대시보드에서 보냄" }, source === "phone" ? "🎙" : "💬"),
      el("span", { class: "ask" }, text), state, answer),
    steps);
  const li = el("li", { class: "msg turn-item" }, details);
  $("#messages").append(li);
  scrollChat();
  const turn = { li, details, steps, state, answer, count: 0, actions: [] };
  turns.last = turn;
  return turn;
}

function resultOf(a) {
  if (a.needsConfirmation) return ["wait", "승인 대기"];
  if (!a.ok) return ["fail", "실패"];
  return ["ok", "완료"];
}

function targetOf(a) {
  if (a.deviceLabel) return a.deviceLabel;
  if (a.args?.query) return `"${a.args.query}"`;
  return a.args?.object_id ?? a.args?.type ?? a.args?.device_id ?? "";
}

const THINK_NOTE = "모델이 쓴 설명이에요. 판단 근거가 아니에요(근거는 행동과 관찰).";

function addStep(turn, a) {
  turn.count += 1;
  turn.actions.push(a);
  const [cls, label] = resultOf(a);
  const observed = a.observation ?? (a.ok ? a.message : a.error) ?? label;
  turn.steps.append(el("li", { class: "step" },
    el("span", { class: "no" }, `${turn.count}`),
    el("div", { class: "react" },
      el("div", { class: "think", title: THINK_NOTE }, "💭 ", el("i", {}, a.reason ?? "(생각을 남기지 않음)"), el("span", { class: "tag" }, "모델의 설명")),
      el("div", { class: "act" }, "🔧 ", el("b", {}, TOOL_LABELS[a.tool] ?? a.tool), targetOf(a) ? ` · ${targetOf(a)}` : ""),
      el("div", { class: `obs ${cls}` }, "👁 ", observed))));
}

const LINE_ICON = { 답: "💬", 초점: "🎯", 취소: "↩", "승인 → 실행": "✅", "승인 실패": "⚠", "찍은 자리": "📍" };

function addLine(turn, label, text, cls = "") {
  const li = el("li", { class: `step final ${cls}` }, el("span", { class: "no" }, LINE_ICON[label] ?? "·"), el("span", { class: "what" }, el("b", {}, label), ` ${text}`));
  turn.steps.append(li);
  return li;
}

function finishTurn(turn, reply, actions, pending, error) {
  if (turn.count === 0) for (const a of actions ?? []) addStep(turn, a);
  turn.answer.textContent = reply ?? error ?? "";
  const kind = error ? "fail" : pending?.length ? "wait" : (actions ?? []).some((a) => !a.ok && !a.needsConfirmation) && !(actions ?? []).some((a) => a.ok) ? "fail" : "ok";
  turn.state.className = `state ${kind}`;
  turn.state.textContent = error ? "오류" : stateText(kind);
  // 초점 이벤트가 답보다 먼저 올 수 있다: 답을 초점 줄 앞에 둔다(💬 답 → 🎯 초점)
  const answer = addLine(turn, "답", reply ?? error ?? "");
  if (turn.focusLine) turn.steps.insertBefore(answer, turn.focusLine);
  for (const p of pending ?? []) addConfirm(p, turn);
  scrollChat();
}

function addConfirm(p, turn) {
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
      settle(p.token, r.json.ok, r.json.reply ?? r.json.error);
    } }, "승인"),
    el("button", { class: "small", onclick: async () => {
      const r = await api("/api/agent/cancel", { token: p.token });
      done("취소함");
      settle(p.token, false, r.json.reply ?? "취소했어요.", true);
    } }, "취소"),
  );
  card.append(el("div", { class: "why" }, `${p.deviceLabel ? `${p.deviceLabel}: ` : ""}${p.reason}`), btns);
  const host = turn ?? newTurn("dashboard", `${p.deviceLabel ?? "기기"} 직접 조작`);
  if (!turn) {
    host.state.className = "state wait";
    host.state.textContent = stateText("wait");
    host.answer.textContent = "승인을 기다려요";
  }
  host.details.open = true;
  host.details.append(card);
  turns.byToken.set(p.token, { turn: host, card, done });
  scrollChat();
}

/** 승인·취소 결과를 그 카드에 남긴다(대시보드 버튼, 폰 버튼, "응" 어디서 했든). */
function settle(token, ok, reply, cancelled = false) {
  const t = turns.byToken.get(token);
  if (!t) return;
  turns.byToken.delete(token);
  t.done(cancelled ? "취소함" : ok ? "승인함" : "실패");
  addLine(t.turn, cancelled ? "취소" : ok ? "승인 → 실행" : "승인 실패", reply ?? "", ok ? "" : "fail");
  t.turn.state.className = `state ${ok ? "ok" : cancelled ? "" : "fail"}`;
  t.turn.state.textContent = cancelled ? "취소" : ok ? "완료" : "실패";
  t.turn.answer.textContent = reply ?? "";
  scrollChat();
}

async function sendChat(message) {
  const text = message.trim();
  if (!text) return;
  const input = $("#chat-input");
  input.value = "";
  $("#send").disabled = true;
  const turn = newTurn("dashboard", text);
  turn.details.open = true;
  app.live = turn;
  const r = await api("/api/agent/chat", { message: text, sessionId: app.sessionId });
  app.live = null;
  $("#send").disabled = false;
  input.focus();
  if (!r.json.reply) {
    finishTurn(turn, null, [], [], r.json.error ?? "에이전트가 답하지 못했습니다.");
    return;
  }
  finishTurn(turn, r.json.reply, r.json.actions, r.json.pendingConfirmations);
}

// ── 실시간 ─────────────────────────────────────────────

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/events`);
  const conn = $("#conn");
  ws.addEventListener("open", () => {
    conn.textContent = "실시간 연결됨";
    conn.className = "badge on";
    eye.attach?.(); // 서버가 다시 떴으면 끊긴 MJPEG 스트림도 다시 붙인다
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
      addStep(app.live, msg.action);
      scrollChat();
    } else if (msg.type === "agent" && msg.event === "reply" && msg.sessionId === PHONE_SESSION) {
      const turn = newTurn("phone", msg.message);
      finishTurn(turn, msg.reply, msg.actions, msg.pendingConfirmations);
    } else if (msg.type === "agent" && msg.event === "confirmed") {
      settle(msg.token, msg.ok, msg.reply);
    } else if (msg.type === "agent" && msg.event === "cancelled") {
      settle(msg.token, false, "취소했어요.", true);
    } else if (msg.type === "photo") {
      addPhoto(msg.photo);
    } else if (msg.type === "layout") {
      layout.refresh();
    } else if (msg.type === "focus") {
      showFocus(msg.focus);
    } else if (msg.type === "brain") {
      onBrain(msg.event);
    }
    // 에이전트 도구(save_layout 등)로 저장하면 layout 메시지가 없으므로 답마다 보정 상태를 다시 읽는다
    if (msg.type === "agent" && msg.event === "reply") layout.refresh();
  });
}

// ── 클로이드 두뇌(BRAIN=1) ─────────────────────────────
// 폰 카메라로 도는 상위 판단. 흐름마다 카드 하나: 단계 글(사용 중 → 자리 비움 → 요청 → 판단 → 재확인 → 모의 행동 → 결과)을
// 쌓고, 최근 YOLO 존재 판정과 VLM 판정은 카드 위 두 줄에서 갈아 끼운다(장마다 쌓으면 읽을 수 없어서). 행동은 모두 모의다.

const BRAIN_STATE = { watching: "지켜봄", in_use: "사용 중", away_check: "자리 비움 확인", requesting: "사진 요청", deciding: "판단 중", confirming: "재확인", acting: "모의 행동", done: "끝" };
const BRAIN_ICON = { use: "☕", away: "🚶", request: "📷", answer: "👁", decide: "🧠", confirm: "🔍", act: "🤖", result: "✅", wait: "⏸", cancel: "↩", stale: "⌛", error: "⚠" };
const brainView = { turn: null };

function brainTurn() {
  if (brainView.turn && !brainView.turn.ended) return brainView.turn;
  const state = el("span", { class: "state busy" }, BRAIN_STATE.watching);
  const answer = el("span", { class: "answer" }, "폰 카메라로 컵을 지켜봐요");
  const yolo = el("div", { class: "brain-now" }, "YOLO: -");
  const vlm = el("div", { class: "brain-now" }, "VLM: -");
  const steps = el("ol", { class: "steps" });
  const details = el("details", { class: "turn brain-turn", open: true },
    el("summary", {}, el("span", { class: "src", title: "클로이드 두뇌(폰 카메라)" }, "🤖"), el("span", { class: "ask" }, "컵 지켜보기"), state, answer),
    el("div", { class: "brain-nows" }, yolo, vlm), steps);
  $("#messages").append(el("li", { class: "msg turn-item" }, details));
  brainView.turn = { details, state, answer, yolo, vlm, steps, ended: false };
  scrollChat();
  return brainView.turn;
}

function brainStep(turn, icon, text, cls = "") {
  turn.steps.append(el("li", { class: `step final ${cls}` }, el("span", { class: "no" }, icon), el("span", { class: "what" }, text)));
  turn.answer.textContent = text;
  scrollChat();
}

const ago = (ms) => (ms === null || ms === undefined ? "" : ` · 근거 ${(ms / 1000).toFixed(1)}초 전`);

function onBrain(e) {
  const turn = brainTurn();
  if (e.type === "presence") {
    turn.yolo.textContent = `${e.summary} (사람 ${e.scores.person.toFixed(2)} · 컵 ${e.scores.cup.toFixed(2)})`;
  } else if (e.type === "perception") {
    turn.vlm.textContent = `VLM${e.answer ? "(요청 답 사진)" : ""}: ${e.error ? `실패 ${e.error}` : e.summary}${ago(e.evidence_age_ms)}`;
  } else if (e.type === "brain") {
    turn.state.textContent = BRAIN_STATE[e.state] ?? e.state;
    brainStep(turn, BRAIN_ICON[e.stage] ?? "·", `${e.text}${ago(e.evidence_age_ms)}`, e.stage === "error" ? "fail" : "");
    // 흐름이 끝 상태로 가면(대기·실패·결과) 이 카드는 끝. 다음 이벤트는 새 카드
    if (e.state === "done" && ["wait", "error", "act", "result"].includes(e.stage)) {
      endBrainTurn(turn, e.stage === "error" ? "fail" : turn.outcome && !["cleared", "answered"].includes(turn.outcome) ? "wait" : "ok");
    }
  } else if (e.type === "request") {
    brainStep(turn, "📱", e.active ? `폰에 요청: ${e.text}` : "폰 요청 거둠");
  } else if (e.type === "action") {
    if (e.active) brainStep(turn, "📱", `폰에 부탁(모의): ${e.plan.prompt?.text ?? e.plan.dashboard} · 클로이드라면 "${e.plan.would}"`, "wait");
  } else if (e.type === "result") {
    turn.outcome = e.outcome; // 바로 뒤 result 단계 글이 카드를 닫는다
  }
}

function endBrainTurn(turn, kind) {
  turn.ended = true;
  turn.state.className = `state ${kind}`;
  turn.state.textContent = BRAIN_STATE.done;
}

// ── 배치 보정 ──────────────────────────────────────────
// 폰 AR("냉장고 위치 여기로 맞춰줘")·채팅으로 바꾼 가구·가전 자리. 3D 트윈은 /events layout 메시지로 바로 바뀌고,
// 여기서는 보정 건수·저장 여부만 보인다. 저장 파일은 twin-studio apply-edits로 원본에 반영한다.

const layout = {
  timer: null,
  refresh() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 200);
  },
  async load() {
    const r = await api("/api/layout");
    const on = r.status === 200 && r.json.ok;
    for (const id of ["#layout-state", "#layout-save", "#layout-reset"]) $(id).hidden = !on;
    if (!on) return;
    const st = $("#layout-state");
    st.textContent = r.json.edits === 0 ? "보정 없음" : `보정 ${r.json.edits}건${r.json.dirty ? " · 저장 안 함" : " · 저장됨"}`;
    st.className = `badge${r.json.dirty ? " off" : ""}`;
    $("#layout-save").disabled = r.json.edits === 0 && !r.json.dirty;
    $("#layout-reset").disabled = r.json.edits === 0;
  },
  init() {
    $("#layout-save").addEventListener("click", async () => {
      const r = await api("/api/layout/save", {});
      addMessage(r.json.ok ? "system" : "error", r.json.ok ? `배치 보정 ${r.json.count}건을 저장했어요: ${r.json.path}` : r.json.error);
      this.load();
    });
    $("#layout-reset").addEventListener("click", async () => {
      const r = await api("/api/layout/reset", {});
      addMessage(r.json.ok ? "system" : "error", r.json.ok ? `배치 보정을 되돌렸어요(${r.json.reverted}곳).` : r.json.error);
      this.load();
    });
    this.load();
  },
};

// ── 폰 기준점(벽 대기 맞춤) ──────────────────────────────
// 3D 트윈에서 벽 두 곳(A·B)을 골라 저장하면 폰이 실제 그 벽 바로 아래 바닥을 조준해 수평을 맞춘다(높이는 눈높이 고정).
// 고르기는 같은 출처 iframe의 뷰어 API(aptViewer.startPick)를 쓰고, 저장된 점은 3D에 핀으로 보인다.

const touch = {
  points: { A: null, B: null }, // {position}
  saved: false,
  viewer() {
    try {
      return $("#twin-frame").contentWindow?.aptViewer ?? null;
    } catch {
      return null;
    }
  },
  info(text, error = false) {
    $("#touch-info").textContent = text;
    $("#touch-info").classList.toggle("error", error);
  },
  list() {
    return ["A", "B"].map((id) => ({ id, label: $(`#touch-label-${id}`).value.trim(), position: this.points[id]?.position ?? null }));
  },
  render() {
    for (const p of this.list()) {
      $(`#touch-pos-${p.id}`).textContent = p.position ? `벽 위치 (${p.position[0].toFixed(2)}, ${p.position[1].toFixed(2)})m` : "미지정";
    }
    const [a, b] = this.list();
    $("#touch-save").disabled = !(a.position && b.position);
    $("#touch-clear").disabled = !a.position && !b.position && !this.saved;
  },
  distance() {
    const [a, b] = this.list();
    return a.position && b.position ? Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1]) : null;
  },
  showMarkers() {
    const v = this.viewer();
    if (!v?.setTouchPoints) return false;
    v.setTouchPoints(this.list().filter((p) => p.position).map((p) => ({ ...p, label: p.label || `${p.id} 지점` })));
    return true;
  },
  pick(id) {
    const v = this.viewer();
    if (!v?.startPick) {
      this.info("3D 트윈이 아직 준비되지 않았어요. 잠시 뒤 다시 눌러 주세요.", true);
      return;
    }
    // 이미 고르는 중이면 startPick이 이전 것을 먼저 취소(콜백 null)하므로 접기는 그 뒤에 한다
    v.startPick((hit) => {
      this.picking(false);
      if (!hit) {
        this.info("고르기를 취소했어요.");
        return;
      }
      this.points[id] = { position: hit.position };
      this.render();
      this.showMarkers();
      const d = this.distance();
      this.info(d === null ? `${id} 지점을 골랐어요. 다른 지점도 고르세요.` : `A–B 수평 거리 ${d.toFixed(2)}m. 저장하면 폰이 이 두 벽으로 맞춰요.`);
    });
    this.picking(true);
    this.info(`3D 트윈에서 ${id} 지점의 벽을 누르세요(가구는 뚫고 벽을 잡아요).`);
  },
  async save() {
    const [a, b] = this.list();
    const r = await api("/api/phone/touch-points", { points: [a, b].map((p) => ({ label: p.label, position: p.position })) });
    if (r.status !== 200 || !r.json.ok) {
      this.info(r.json.error ?? "저장하지 못했어요.", true);
      return;
    }
    this.apply(r.json);
    this.info(`저장했어요. A–B ${r.json.distance_m.toFixed(2)}m. 폰 화면에 A·B 기록 버튼이 떠요.`);
    addMessage("system", `폰 기준점을 저장했어요: A ${r.json.points[0].label}, B ${r.json.points[1].label} (거리 ${r.json.distance_m.toFixed(2)}m).`);
  },
  async clear() {
    const r = await api("/api/phone/touch-points/clear", {});
    if (r.status !== 200 || !r.json.ok) {
      this.info(r.json.error ?? "지우지 못했어요.", true);
      return;
    }
    this.apply(r.json);
    this.info("지웠어요. 폰은 평면도 바닥 기준점으로 맞춰요.");
  },
  apply(view) {
    this.saved = Boolean(view.points);
    for (const id of ["A", "B"]) {
      const p = view.points?.find((x) => x.id === id) ?? null;
      this.points[id] = p ? { position: p.position } : null;
      $(`#touch-label-${id}`).value = p?.label ?? "";
    }
    if (typeof view.eye_height_m === "number") $("#touch-eye").textContent = String(view.eye_height_m);
    this.render();
    this.showMarkers();
  },
  picking(on) {
    $("#touch-panel").classList.toggle("picking", on);
    $("#touch-cancel").hidden = !on;
  },
  open(on) {
    $("#touch-panel").hidden = !on;
    $("#touch-toggle").setAttribute("aria-expanded", String(on));
    if (!on) this.viewer()?.cancelPick?.();
  },
  async init() {
    const r = await api("/api/phone/touch-points");
    if (r.status !== 200 || !r.json.ok) return; // 집 scene.json이 없으면 쓰지 않는다
    $("#touch-toggle").hidden = false;
    $("#touch-toggle").addEventListener("click", () => this.open($("#touch-panel").hidden));
    for (const id of ["A", "B"]) {
      $(`#touch-pick-${id}`).addEventListener("click", () => this.pick(id));
      $(`#touch-label-${id}`).addEventListener("input", () => this.showMarkers());
    }
    $("#touch-save").addEventListener("click", () => this.save());
    $("#touch-cancel").addEventListener("click", () => this.viewer()?.cancelPick?.());
    $("#touch-clear").addEventListener("click", () => this.clear());
    this.apply(r.json);
    // 뷰어가 늦게 뜨면 핀을 다시 그린다
    $("#twin-frame").addEventListener("load", () => setTimeout(() => this.showMarkers(), 500));
  },
};

// 초점: 클로이드가 방금 다룬 물건. 3D 트윈(뷰어 고리)과 폰 화면에 표시되고, 눈 캡션과 마지막 과정 카드에 남는다.
let focusTimer = null;
let focusing = false;
let eyeCaption = "클로이드의 눈 · 실시간 · 엔진 입력 아님"; // 받은 fps가 들어간 평소 캡션
function showFocus(focus) {
  if (!focus?.targets?.length) return;
  const names = focus.targets.map((t) => t.label).join(", ");
  if (turns.last) {
    const li = addLine(turns.last, "초점", names);
    turns.last.focusLine ??= li;
  }
  const cap = $("#eye-caption");
  if (!cap) return;
  cap.textContent = `클로이드 주목 · ${names} · 엔진 입력 아님`;
  focusing = true;
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => {
    focusing = false;
    cap.textContent = eyeCaption;
  }, focus.ttl_ms ?? 8000);
}

// ── 클로이드의 눈 ──────────────────────────────────────
// 폰 AR 서버(PHONE_PORT)가 있으면 오른쪽 위 칸에 폰 카메라 실시간 화면(MJPEG)을 띄운다. 표시 전용이며 엔진 입력이 아니다.
// 첫 프레임이 오기 전에는 안내를 보인다. '사진 찍기' 사진은 찍은 순간의 트윈 좌표 눈 자세와 함께 과정에 남긴다.

const eye = { attach: null };

function initEye(health) {
  const empty = $("#eye-empty");
  if (!health.json?.eye) {
    empty.textContent = "폰 AR 서버가 꺼져 있어요. PHONE_PORT를 주고 서버를 켜면 폰 카메라 화면이 여기에 보여요.";
    return;
  }
  // 서버가 아는 와이파이 주소 중 집 공유기 대역(192.168.x)을 먼저 보인다(WSL·VPN 가상 어댑터 주소는 뒤로)
  const urls = health.json.phone_urls ?? [];
  const rank = (u) => (u.includes("//192.168.") ? 0 : u.includes("//10.") ? 1 : 2);
  const best = [...urls].sort((a, b) => rank(a) - rank(b))[0];
  empty.textContent = best
    ? `폰이 연결되지 않았어요. 같은 와이파이의 안드로이드 크롬에서 ${best} 을 열고 AR을 시작하세요.`
    : "폰이 연결되지 않았어요. 같은 와이파이의 안드로이드 크롬에서 서버 로그의 '폰 AR' 주소를 열고 AR을 시작하세요.";
  if (urls.length > 1) empty.title = `다른 주소: ${urls.filter((u) => u !== best).join(", ")}`;
  const img = $("#eye-live");
  const shown = () => {
    $("#eye").hidden = false;
    empty.hidden = true;
  };
  eye.attach = () => { img.src = `/api/eye/stream?t=${Date.now()}`; };
  img.addEventListener("load", shown);
  img.addEventListener("error", () => setTimeout(() => eye.attach(), 2000));
  // 스트림은 첫 프레임이 와야 크기가 생긴다(브라우저마다 load가 늦을 수 있어 크기로도 본다)
  setInterval(() => { if (img.naturalWidth > 0) shown(); }, 1000);
  // 서버가 폰에서 받은 화면 장 수(최근 2초)를 캡션에 보인다(느릴 때 원인을 숫자로 보려고)
  setInterval(async () => {
    const r = await api("/api/eye/stats");
    if (!r.json?.ok) return;
    eyeCaption = `클로이드의 눈 · 실시간 ${r.json.fps} fps${r.json.kb_per_frame ? ` · ${r.json.kb_per_frame}KB` : ""} · 엔진 입력 아님`;
    if (!focusing) $("#eye-caption").textContent = eyeCaption;
  }, 2000);
  eye.attach();
}

function addPhoto(p) {
  const pose = p.measured_pose;
  const where = pose
    ? `위치 (${pose.position[0].toFixed(2)}, ${pose.position[1].toFixed(2)}) · 방향 ${Math.round(pose.yaw_deg)}° · 높이 ${pose.height_m.toFixed(2)}m`
    : "위치 모름(맞추기 전)";
  const turn = newTurn("phone", "📷 사진 찍기");
  turn.state.className = "state ok";
  turn.state.textContent = "저장";
  turn.answer.textContent = where;
  addLine(turn, "찍은 자리", where);
  turn.details.append(el("a", { href: p.url, target: "_blank", rel: "noopener" }, el("img", { class: "photo", src: p.url, alt: "클로이드의 눈 사진" })));
}

// ── 추천 요청: 고른 집의 기기 이름으로 만든다 ─────────────
function suggestions() {
  const devices = [...app.devices.values()];
  const pick = (kind) => devices.find((d) => d.kind === kind);
  const out = [];
  const light = pick("light");
  if (light) out.push(`${light.label} 켜줘`);
  const tv = pick("tv");
  if (tv) out.push(`${tv.label} 켜줘`);
  const ac = pick("aircon");
  if (ac) out.push(`${ac.label} 24도로 맞춰줘`);
  const lock = pick("lock");
  if (lock) out.push(`${lock.label} 상태 알려줘`);
  const vacuum = pick("vacuum");
  if (vacuum && out.length < 4) out.push(`${vacuum.label} 시작해줘`);
  return out.slice(0, 4);
}

// ── 3D 트윈 · 탭 · 기기 카드 서랍 ───────────────────────
// twin-studio 뷰어(/twin/viewer/)를 ?live=auto&embed=1로 넣는다. 뷰어가 같은 /events를 받아 3D에 반영하고,
// 뷰어 가전 패널에서 바꾼 상태는 POST /api/devices/:id/twin(정책 포함)으로 돌아온다.

const TWIN_SRC = "/twin/viewer/?live=auto&embed=1";
const narrow = window.matchMedia("(max-width: 860px)");
const view = { tab: "twin", twin: false };

async function checkTwin(health) {
  if (!health.json?.twin) return false;
  try {
    const res = await fetch("/twin/viewer/", { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

function nudgeTwin() {
  // 숨긴 동안 뷰어 캔버스가 0px로 줄었을 수 있다. iframe 창 크기는 그대로라 resize가 안 오므로 직접 알린다
  requestAnimationFrame(() => {
    try {
      $("#twin-frame").contentWindow?.dispatchEvent(new Event("resize"));
    } catch {
      // 다른 출처면 무시
    }
  });
}

function applyTabs() {
  $("#layout").dataset.tab = view.tab;
  for (const b of document.querySelectorAll("#tabs [data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === view.tab));
  nudgeTwin();
}

function setCards(on) {
  $("#devices-pane").hidden = !on;
  $("#cards-toggle").setAttribute("aria-pressed", String(on));
}

async function initTwin(health) {
  view.twin = await checkTwin(health);
  $("#twin-missing").hidden = view.twin;
  $("#twin-missing").title = "고른 집의 twin-studio 산출물(scene.json)이 없어 3D 트윈을 붙이지 못했어요. twin-studio에서 먼저 빌드하세요.";
  const frame = $("#twin-frame");
  const msg = $("#twin-msg");
  if (!view.twin) {
    frame.hidden = true;
    msg.textContent = "3D 트윈을 찾을 수 없어요. 고른 집의 twin-studio 산출물이 있어야 /twin/viewer/가 열려요(twin-studio에서 먼저 빌드).";
  } else {
    frame.addEventListener("load", () => { msg.hidden = true; }, { once: true });
    frame.src = TWIN_SRC;
  }
  for (const b of document.querySelectorAll("#tabs [data-tab]")) {
    b.addEventListener("click", () => {
      view.tab = b.dataset.tab;
      applyTabs();
    });
  }
  $("#cards-toggle").addEventListener("click", () => setCards($("#devices-pane").hidden));
  $("#cards-close").addEventListener("click", () => setCards(false));
  narrow.addEventListener("change", applyTabs);
  applyTabs();
}

// ── 시작 ───────────────────────────────────────────────

async function init() {
  const [health, rooms, devices] = await Promise.all([api("/api/health"), api("/api/rooms"), api("/api/devices")]);
  if (!Array.isArray(devices.json)) {
    addMessage("error", devices.json.error ?? "기기 목록을 불러오지 못했습니다.");
    return;
  }
  $("#hub").textContent = `허브 ${health.json.hub ?? "-"}${health.json.transport ? ` · ${health.json.transport}` : ""}`;
  $("#hub").title = health.json.hub === "matter" ? "Matter 브리지(가상 가전) ⇄ matter.js 컨트롤러" : "Matter 없이 메모리에서만";
  $("#provider").textContent = `에이전트 ${health.json.provider ?? "없음"}${health.json.model ? ` · ${health.json.model}` : ""}`;
  $("#home").textContent = `집 ${health.json.home?.name ?? "-"}`;
  initTwin(health);
  initEye(health);
  layout.init();
  touch.init();
  app.rooms = rooms.json;
  for (const d of devices.json) app.devices.set(d.id, d);
  renderFilter();
  renderRooms();
  connect();

  $("#suggestions").append(...suggestions().map((s) => el("button", { type: "button", onclick: () => sendChat(s) }, s)));
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
    turns.last = null;
    addMessage("system", "새 대화를 시작했어요.");
  });
  addMessage("system", "클로이드에게 말로 요청해 보세요. 요청마다 거친 단계가 카드로 남고, 결과는 왼쪽 3D 트윈에서 보여요. 현관문 잠금 해제·인덕션 켜기·전자레인지 시작은 승인 후에만 실행돼요.");
}

init();
