// main.cjs 시험(node --test): 가짜 Electron·가짜 hub로 창·트레이·종료 흐름을 본다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const hubLib = require("./hub.cjs");
const { createMain } = require("./main.cjs");

const flush = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 10; i++) await flush(); };

function fakeElectron(events) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "hub-ud-"));
  const envFile = path.join(userData, "noonchi.env");
  fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ envFile, tailscale: false }));
  const windows = [];
  const trays = [];
  const app = Object.assign(new EventEmitter(), {
    lock: true,
    requestSingleInstanceLock() { return this.lock; },
    whenReady: () => Promise.resolve(),
    quit() { events.push("app.quit"); },
    exit(code) { events.push(`exit ${code}`); },
    getPath: () => userData,
  });
  class BrowserWindow extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; this.shows = 0; this.webContents = { setWindowOpenHandler() {} }; windows.push(this); }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    show() { this.shows += 1; events.push("show"); }
    hide() { events.push("hide"); }
    focus() {}
    maximize() {}
    restore() {}
    isMinimized() { return false; }
    isDestroyed() { return false; }
  }
  class Tray extends EventEmitter {
    constructor() { super(); this.tips = []; trays.push(this); }
    setToolTip(tip) { this.tips.push(tip); }
    setContextMenu(menu) { this.menu = menu; }
    isDestroyed() { return false; }
  }
  const dialog = {
    showErrorBox: (title, message) => events.push(`error ${message}`),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  };
  return { electron: { app, BrowserWindow, Tray, Menu: { buildFromTemplate: (t) => t }, dialog, shell: { openExternal: async () => {} } }, windows, trays };
}

// 가짜 hub: 설정 읽기는 진짜, 시작은 바로 준비, 종료는 release()까지 기다린다
function fakeHub(events) {
  const state = { deps: null, release: null };
  const hub = {
    ...hubLib,
    realDeps: () => ({}),
    createHub: (_config, deps) => {
      state.deps = deps;
      return {
        start: async () => ({ ok: true, url: "http://127.0.0.1:8300/", logPath: "C:/logs/server.log" }),
        stop: () => {
          events.push("stop");
          return new Promise((r) => { state.release = r; });
        },
      };
    },
  };
  return { hub, state };
}

async function boot() {
  const events = [];
  const { electron, windows, trays } = fakeElectron(events);
  const { hub, state } = fakeHub(events);
  const main = createMain(electron, hub, __dirname);
  await main.ready;
  return { events, electron, windows, trays, state, main };
}

test("준비되면 창을 열고, 두 번째 실행은 그 창을 앞으로 가져온다", async () => {
  const { events, electron, windows } = await boot();
  assert.equal(windows.length, 1);
  assert.equal(windows[0].url, "http://127.0.0.1:8300/");
  windows[0].emit("ready-to-show");
  assert.equal(windows[0].shows, 1);
  electron.app.emit("second-instance");
  assert.equal(windows[0].shows, 2);
  assert.equal(events.includes("stop"), false);
});

test("준비 뒤 서버가 혼자 끝나면 오류 창 → 연 경로 닫기(stop) → 앱 종료", async () => {
  const { events, state } = await boot();
  state.deps.onServerExit("서버가 끝났어요(코드 3). 로그: C:/logs/server.log");
  await settle();
  state.release();
  await settle();
  assert.deepEqual(events.filter((e) => e !== "hide"), ["error 서버가 끝났어요(코드 3). 로그: C:/logs/server.log", "stop", "exit 1"]);
});

test("종료하는 중에는 창을 다시 띄우지 않고, 두 번째 실행은 툴팁에 「종료하는 중」", async () => {
  const { events, electron, windows, trays, state } = await boot();
  windows[0].emit("close", { preventDefault() {} });
  await settle();
  assert.ok(events.includes("stop"));
  const shows = windows[0].shows;
  windows[0].emit("ready-to-show");
  trays[0].tips.length = 0;
  electron.app.emit("second-instance");
  trays[0].emit("click");
  assert.equal(windows[0].shows, shows);
  assert.deepEqual(trays[0].tips, ["NOONCHI 허브 · 종료하는 중"]);
  // 종료 중에 서버가 끝나도 오류 창을 띄우지 않는다
  state.deps.onServerExit("서버가 끝났어요(코드 0)");
  state.release();
  await settle();
  assert.equal(events.some((e) => e.startsWith("error")), false);
  assert.deepEqual(events.filter((e) => e.startsWith("exit")), ["exit 0"]);
});

test("이미 떠 있으면 두 번째 실행은 바로 끝난다", async () => {
  const events = [];
  const { electron, windows } = fakeElectron(events);
  electron.app.lock = false;
  const { hub } = fakeHub(events);
  createMain(electron, hub, __dirname);
  await settle();
  assert.deepEqual(events, ["app.quit"]);
  assert.equal(windows.length, 0);
});
