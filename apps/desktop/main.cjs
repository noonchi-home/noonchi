"use strict";
// NOONCHI 허브 데스크톱 앱(Electron 메인 프로세스). 시작·종료 흐름과 명령은 hub.cjs, 여기는 창·트레이·OS 창만 다룬다.
// 준비 전에는 창 없이 트레이 툴팁으로 상태를 보이고, 실패는 OS 오류 창(showErrorBox)으로 알린다. 화면은 대시보드 그대로다.
const path = require("node:path");
const { app, BrowserWindow, Menu, Tray, dialog, shell } = require("electron");
const hub = require("./hub.cjs");

const TITLE = "NOONCHI 허브";
let win = null;
let tray = null;
let running = null;
let quitting = false;

function setTip(state) {
  if (tray && !tray.isDestroyed()) tray.setToolTip(`${TITLE} · ${state}`);
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// 창 닫기·트레이 「종료」: 서버 정상 종료(20초 넘으면 강제) → 연 Tailscale 경로 닫기 → 앱 끝
async function quit() {
  if (quitting) return;
  quitting = true;
  setTip("종료하는 중");
  if (win && !win.isDestroyed()) win.hide();
  try {
    if (running) await running.stop();
  } finally {
    app.exit(0);
  }
}

function openWindow(url) {
  win = new BrowserWindow({
    width: 1600, height: 1000, show: false, title: TITLE, icon: path.join(__dirname, "icon.ico"), autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.on("page-title-updated", (e) => e.preventDefault());
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    void quit();
  });
  // 대시보드의 새 창 링크는 기본 브라우저로 연다
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });
  void win.loadURL(url);
}

async function boot() {
  tray = new Tray(path.join(__dirname, "icon.ico"));
  tray.setContextMenu(Menu.buildFromTemplate([{ label: "종료", click: () => void quit() }]));
  tray.on("click", showWindow);
  setTip("시작하는 중");

  const file = path.join(app.getPath("userData"), "config.json");
  let { config } = hub.readConfig(file, __dirname);
  if (!config.envFile) {
    // 첫 실행: 서버 env 파일의 경로만 받는다. 앱은 이 파일을 읽지 않고 --env-file로 넘긴다
    const picked = await dialog.showOpenDialog({ title: "서버 env 파일 고르기", defaultPath: config.repoDir, properties: ["openFile"] });
    if (picked.canceled || !picked.filePaths[0]) return quit();
    hub.writeConfig(file, { envFile: picked.filePaths[0] });
    ({ config } = hub.readConfig(file, __dirname));
  }

  running = hub.createHub(config, hub.realDeps());
  setTip(`서버 시작하는 중 (포트 ${config.port}·${config.phonePort})`);
  const result = await running.start();
  if (!result.ok) {
    if (result.kind !== "stopped") dialog.showErrorBox(`${TITLE}를 시작하지 못했어요`, result.message);
    return quit();
  }
  if (quitting) return;
  setTip(`실행 중 · ${result.url}`);
  openWindow(result.url);
}

if (!app.requestSingleInstanceLock()) {
  // 두 번째 실행: 이미 뜬 앱이 second-instance로 창을 앞으로 가져온다
  app.quit();
} else {
  app.on("second-instance", showWindow);
  // 창이 다 닫혀도 저절로 끝나지 않는다: 끝내기는 quit()만 한다(서버·경로를 먼저 정리)
  app.on("window-all-closed", () => {});
  app.on("before-quit", (e) => {
    if (quitting) return;
    e.preventDefault();
    void quit();
  });
  app.whenReady().then(boot).catch((e) => {
    dialog.showErrorBox(`${TITLE}를 시작하지 못했어요`, e && e.message ? e.message : String(e));
    void quit();
  });
}
