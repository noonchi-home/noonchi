// twin-home 설정 화면: 1 집 고르기 → 2 가전 선택(기기별 신호 출처) → 3 위치 동기화(폰 기준점 A·B, 배치 보정) → 대시보드.
// 서버가 판단·검사를 하고(/api/setup*), 여기서는 고른 것을 보내고 결과를 그린다. 빌드 없는 ES 모듈.

import { searchDevices } from "./device-search.js";

const $ = (sel) => document.querySelector(sel);
const STEPS = ["home", "devices", "position"];

const setup = {
  view: null, // GET /api/setup
  step: "home",
  pickedHome: null,
  sources: new Map(), // 기기 id → "virtual" | "none"
  switching: false, // 이 화면이 집을 바꾸는 중(그동안 오는 hello는 내 것)
};

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

async function api(path, body) {
  const init = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  try {
    const res = await fetch(path, init);
    return { status: res.status, json: await res.json().catch(() => ({ ok: false, error: `응답을 읽지 못했어요(${res.status}).` })) };
  } catch (e) {
    return { status: 0, json: { ok: false, error: `서버에 닿지 못했어요: ${e.message}` } };
  }
}

function notice(text, kind = "") {
  const n = $("#notice");
  n.hidden = !text;
  n.textContent = text ?? "";
  n.className = `notice ${kind}`;
}

async function load() {
  const r = await api("/api/setup");
  if (!r.json.ok) {
    notice(r.json.error ?? "설정을 불러오지 못했어요.", "error");
    return false;
  }
  setup.view = r.json;
  setup.pickedHome ??= r.json.home?.id ?? r.json.homes[0]?.id ?? null;
  setup.sources = sourcesFrom(r.json);
  if (r.json.error) notice(`지난번 집 바꾸기가 실패했어요: ${r.json.error}`, "error");
  return true;
}

function go(step) {
  setup.step = STEPS.includes(step) ? step : "home";
  if (!setup.view?.home && setup.step !== "home") setup.step = "home";
  for (const s of STEPS) $(`#step-${s}`).hidden = s !== setup.step;
  const at = STEPS.indexOf(setup.step);
  for (const li of document.querySelectorAll("#steps li")) {
    const i = STEPS.indexOf(li.dataset.step);
    li.className = i === at ? "now" : i < at ? "past" : "";
    if (i === at) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  }
  if (location.hash !== `#${setup.step}`) history.replaceState(null, "", `#${setup.step}`);
  if (setup.step === "home") renderHomes();
  if (setup.step === "devices") renderDevices();
  if (setup.step === "position") position.enter();
}

// ── 1 집 고르기 ─────────────────────────────────────────

function renderHomes() {
  const box = $("#home-list");
  box.replaceChildren(...setup.view.homes.map((h) => {
    const input = el("input", { type: "radio", name: "home", value: h.id, checked: h.id === setup.pickedHome, onchange: () => { setup.pickedHome = h.id; } });
    return el("label", { class: "home-item" }, input, el("span", { class: "name" }, h.name), h.id === setup.view.home?.id ? el("span", { class: "badge on" }, "지금 띄운 집") : null);
  }));
}

async function chooseHome() {
  const id = setup.pickedHome;
  if (!id) return;
  const btn = $("#home-next");
  const changing = id !== setup.view.home?.id;
  btn.disabled = true;
  if (changing) notice("집을 바꾸는 중이에요. 수십 초 걸릴 수 있어요…");
  setup.switching = true;
  const r = await api("/api/setup/home", { home: id });
  setup.switching = false;
  btn.disabled = false;
  if (r.status !== 200 || !r.json.ok) {
    notice(r.json.error ?? "집을 바꾸지 못했어요.", "error");
    await load();
    renderHomes();
    return;
  }
  setup.view = r.json;
  setup.sources = sourcesFrom(r.json);
  $("#device-search").value = "";
  notice(changing ? `${r.json.home.name}(으)로 바꿨어요.` : "");
  go("devices");
}

// ── 2 가전 선택 ─────────────────────────────────────────
// 검색해서 추가한 가전만 가상, 나머지는 신호 없음. 이 집 가전을 고른 적이 없으면 모두 신호 없음으로 시작한다.

function sourcesFrom(view) {
  return new Map(view.devices.map((d) => [d.id, view.devices_saved ? d.source.kind : "none"]));
}

const isPicked = (id) => setup.sources.get(id) === "virtual";
const deviceName = (d) => (d.label.includes(d.kindLabel) ? d.label : `${d.label} · ${d.kindLabel}`);

function setSource(id, kind) {
  setup.sources.set(id, kind);
  renderDevices();
}

function renderDevices() {
  const devices = setup.view.devices;
  const picked = devices.filter((d) => isPicked(d.id));
  $("#device-count").textContent = `추가 ${picked.length} · 신호 없음 ${devices.length - picked.length}`;
  $("#all-none").hidden = picked.length === 0;
  const rooms = [...new Map(devices.map((d) => [d.room, d.roomLabel])).values()];
  $("#room-chips").replaceChildren(...rooms.map((label) => el("button", {
    type: "button", class: "small ghost", onclick: () => { $("#device-search").value = label; $("#device-search").focus(); renderResults(); },
  }, label)));
  const box = $("#device-list");
  if (devices.length === 0) box.replaceChildren(el("p", { class: "empty" }, "이 집 배치에 가전이 없어요."));
  else if (picked.length === 0) box.replaceChildren(el("p", { class: "empty" }, "아직 추가한 가전이 없어요. 위에서 검색해서 추가하세요."));
  else box.replaceChildren(el("ul", { class: "chips" }, picked.map((d) => el("li", { class: "chip", "data-id": d.id },
    d.label.includes(d.roomLabel) ? null : el("span", { class: "room" }, d.roomLabel), el("span", { class: "name" }, deviceName(d)),
    el("button", { type: "button", class: "chip-x", "aria-label": `${d.roomLabel} ${d.label} 빼기`, onclick: () => setSource(d.id, "none") }, "×"),
  ))));
  renderResults();
}

function renderResults() {
  const list = $("#device-results");
  const query = $("#device-search").value;
  list.hidden = !query.trim();
  if (list.hidden) return list.replaceChildren();
  const hits = searchDevices(setup.view.devices, query);
  if (!hits.length) return list.replaceChildren(el("li", { class: "empty" }, "맞는 가전이 없어요."));
  const rest = hits.filter((d) => !isPicked(d.id));
  list.replaceChildren(
    el("li", { class: "results-head" }, `${hits.length}개`, rest.length > 1 ? el("button", {
      type: "button", class: "small ghost", onclick: () => { for (const d of rest) setup.sources.set(d.id, "virtual"); renderDevices(); },
    }, `모두 추가 (${rest.length})`) : null),
    ...hits.map((d) => el("li", {}, el("button", {
      type: "button", class: `result${isPicked(d.id) ? " on" : ""}`, "aria-pressed": String(isPicked(d.id)), "data-id": d.id,
      onclick: () => { setSource(d.id, isPicked(d.id) ? "none" : "virtual"); list.querySelector(`[data-id="${d.id}"]`)?.focus(); },
    }, el("span", { class: "room" }, d.roomLabel), el("span", { class: "name" }, deviceName(d)), el("span", { class: "act" }, isPicked(d.id) ? "추가됨 ✓" : "추가")))),
  );
}

function onSearchKey(e) {
  if (e.key === "Escape") {
    e.target.value = "";
    renderResults();
  } else if (e.key === "Enter") {
    // 엔터: 아직 안 넣은 첫 결과를 추가한다
    const first = searchDevices(setup.view.devices, e.target.value).find((d) => !isPicked(d.id));
    if (first) setSource(first.id, "virtual");
  }
}

function setAll(kind) {
  for (const id of setup.sources.keys()) setup.sources.set(id, kind);
  renderDevices();
}

async function saveDevices() {
  const btn = $("#devices-next");
  btn.disabled = true;
  const r = await api("/api/setup/devices", { home: setup.view.home.id, sources: Object.fromEntries(setup.sources) });
  btn.disabled = false;
  if (r.status !== 200 || !r.json.ok) {
    notice(r.json.error ?? "저장하지 못했어요.", "error");
    return;
  }
  setup.view = r.json;
  notice("");
  go("position");
}

// ── 3 위치 동기화 ───────────────────────────────────────
// 폰 기준점: 3D 트윈에서 벽 두 곳(A·B)을 골라 저장하면 폰이 실제 그 벽 바로 아래 바닥을 조준해 수평을 맞춘다(높이는 눈높이 고정).
// 고르기는 같은 출처 iframe의 뷰어 API(aptViewer.startPick)를 쓰고, 저장된 점은 3D에 핀으로 보인다.

const TWIN_SRC = "/twin/viewer/?live=auto&embed=1";

const touch = {
  points: { A: null, B: null }, // {position}
  saved: false,
  ready: false,
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
    position.renderDone();
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
    this.info(`3D 트윈에서 ${id} 지점의 벽을 누르세요.`);
  },
  async save() {
    const [a, b] = this.list();
    const r = await api("/api/phone/touch-points", { home: setup.view.home.id, points: [a, b].map((p) => ({ label: p.label, position: p.position })) });
    if (r.status !== 200 || !r.json.ok) {
      this.info(r.json.error ?? "저장하지 못했어요.", true);
      return;
    }
    this.apply(r.json);
    this.info(`저장했어요. A–B ${r.json.distance_m.toFixed(2)}m. 폰 화면에 A·B 기록 버튼이 떠요.`);
  },
  async clear() {
    const r = await api("/api/phone/touch-points/clear", { home: setup.view.home.id });
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
    this.render();
    this.showMarkers();
  },
  picking(on) {
    $("#touch-panel").classList.toggle("picking", on);
    $("#touch-cancel").hidden = !on;
  },
  init() {
    for (const id of ["A", "B"]) {
      $(`#touch-pick-${id}`).addEventListener("click", () => this.pick(id));
      $(`#touch-label-${id}`).addEventListener("input", () => this.showMarkers());
    }
    $("#touch-save").addEventListener("click", () => this.save());
    $("#touch-cancel").addEventListener("click", () => this.viewer()?.cancelPick?.());
    $("#touch-clear").addEventListener("click", () => this.clear());
    // 뷰어가 늦게 뜨면 핀을 다시 그린다
    $("#twin-frame").addEventListener("load", () => setTimeout(() => this.showMarkers(), 500));
  },
  async load() {
    const r = await api("/api/phone/touch-points");
    $("#touch-panel").hidden = r.status !== 200 || !r.json.ok; // 집 scene.json이 없으면 쓰지 않는다
    if (!$("#touch-panel").hidden) this.apply(r.json);
  },
};

// 배치 보정: 폰 AR("냉장고 위치 여기로 맞춰줘")·채팅으로 바꾼 가구·가전 자리. 저장 파일은 twin-studio apply-edits로 원본에 반영한다.
const layout = {
  async load() {
    const r = await api("/api/layout");
    const on = r.status === 200 && r.json.ok;
    $("#layout-box").hidden = !on;
    if (!on) return;
    const st = $("#layout-state");
    st.textContent = r.json.edits === 0 ? "보정 없음" : `보정 ${r.json.edits}건${r.json.dirty ? " · 저장 안 함" : " · 저장됨"}`;
    st.className = `badge${r.json.dirty ? " off" : ""}`;
    $("#layout-save").disabled = r.json.edits === 0 && !r.json.dirty;
    $("#layout-reset").disabled = r.json.edits === 0;
  },
  init() {
    $("#layout-save").addEventListener("click", async () => {
      const r = await api("/api/layout/save", { home: setup.view.home.id });
      notice(r.json.ok ? `배치 보정 ${r.json.count}건을 저장했어요: ${r.json.path}` : r.json.error, r.json.ok ? "" : "error");
      this.load();
    });
    $("#layout-reset").addEventListener("click", async () => {
      const r = await api("/api/layout/reset", { home: setup.view.home.id });
      notice(r.json.ok ? `배치 보정 ${r.json.reverted}곳을 되돌렸어요.` : r.json.error, r.json.ok ? "" : "error");
      this.load();
    });
  },
};

// 실시간: 폰·대화로 배치를 바꾸면 보정 상태를 다시 읽고, 다른 곳에서 집을 바꿨으면 알린다
const events = {
  ws: null,
  connect() {
    if (this.ws) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/events`);
    this.ws = ws;
    ws.addEventListener("close", () => {
      this.ws = null;
      setTimeout(() => this.connect(), 1500);
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "hello" && !setup.switching && setup.view?.home && msg.home && msg.home !== setup.view.home.id) {
        notice("다른 화면에서 집을 바꿨어요. 처음 단계부터 다시 볼게요.", "error");
        setup.pickedHome = null;
        load().then((ok) => ok && go("home"));
      } else if (msg.type === "layout" || (msg.type === "agent" && msg.event === "reply")) {
        if (setup.step === "position") layout.load();
      }
    });
  },
};

const position = {
  frameHome: null, // iframe에 띄운 집(집을 바꾸면 다시 띄운다)
  async enter() {
    const home = setup.view.home?.id;
    const frame = $("#twin-frame");
    if (this.frameHome !== home) {
      this.frameHome = home;
      const ok = await fetch("/twin/viewer/", { method: "HEAD" }).then((r) => r.ok).catch(() => false);
      $("#twin-msg").hidden = false;
      if (!ok) {
        frame.hidden = true;
        $("#twin-msg").textContent = "3D 트윈을 찾을 수 없어요.";
      } else {
        frame.hidden = false;
        frame.addEventListener("load", () => { $("#twin-msg").hidden = true; }, { once: true });
        frame.src = `${TWIN_SRC}&home=${encodeURIComponent(home)}`;
      }
    }
    const urls = setup.view.position.phone_urls;
    $("#phone-help").textContent = urls.length > 0
      ? "폰 크롬에서 이 주소를 열고 기준점을 조준해 기록하세요."
      : "폰 서버가 꺼져 있어요.";
    $("#phone-urls").replaceChildren(...urls.map((u) => el("li", {}, el("code", {}, u))));
    await Promise.all([touch.load(), layout.load()]);
    this.renderDone();
  },
  renderDone() {
    $("#position-done").textContent = touch.saved ? "완료하고 대시보드로" : "건너뛰고 대시보드로";
  },
  async finish() {
    const r = await api("/api/setup/done", { home: setup.view.home.id });
    if (r.status !== 200 || !r.json.ok) {
      notice(r.json.error ?? "끝내지 못했어요.", "error");
      return;
    }
    location.href = "/";
  },
};

// ── 시작 ───────────────────────────────────────────────

async function init() {
  $("#home-next").addEventListener("click", chooseHome);
  $("#devices-back").addEventListener("click", () => go("home"));
  $("#devices-next").addEventListener("click", saveDevices);
  $("#all-none").addEventListener("click", () => setAll("none"));
  $("#device-search").addEventListener("input", renderResults);
  $("#device-search").addEventListener("keydown", onSearchKey);
  $("#position-back").addEventListener("click", () => go("devices"));
  $("#position-done").addEventListener("click", () => position.finish());
  touch.init();
  layout.init();
  if (!(await load())) return;
  go(location.hash.slice(1) || "home");
  events.connect();
  window.addEventListener("hashchange", () => go(location.hash.slice(1)));
}

init();
