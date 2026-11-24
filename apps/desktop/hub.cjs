"use strict";
// 허브 데스크톱 앱의 순수 로직: 설정, 서버 실행 명령·환경 변수, Tailscale 명령, 포트 확인, 시작·종료 흐름.
// main.cjs(Electron)는 이 함수들을 부르기만 한다. 실행기(spawn·run·fetch)는 deps로 받아 node --test로 시험한다.
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const NODE_RANGE = "22.15 이상 23 미만";
const TAILSCALE_DEFAULTS = Object.freeze({ enabled: true, hubHttpsPort: 8444, phoneHttpsPort: 443 });
const DEFAULT_TIMEOUTS = Object.freeze({ readyMs: 90_000, pollMs: 500, stopMs: 20_000 });
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const int = (v, fallback) => (Number.isInteger(Number(v)) && v !== null && v !== "" && v !== undefined ? Number(v) : fallback);
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** config.json 값 → 기본값을 채우고 경로를 절대 경로로 바꾼 설정. 상대 경로 repoDir는 앱 폴더, runtimeDir·envFile은 repoDir 기준.
 *  "tailscale": false는 끔, true나 객체는 기본값에 칸별로 합친다. */
function normalizeConfig(raw = {}, appDir) {
  const repoDir = path.resolve(appDir, raw.repoDir || "../..");
  const ts = raw.tailscale === false ? { ...TAILSCALE_DEFAULTS, enabled: false } : { ...TAILSCALE_DEFAULTS, ...(isRecord(raw.tailscale) ? raw.tailscale : {}) };
  return {
    repoDir,
    envFile: raw.envFile ? path.resolve(repoDir, raw.envFile) : null,
    runtimeDir: path.resolve(repoDir, raw.runtimeDir || "runtime/hub"),
    port: int(raw.port, 8200),
    phonePort: int(raw.phonePort, 8210),
    tailscale: { enabled: ts.enabled !== false, hubHttpsPort: int(ts.hubHttpsPort, 8444), phoneHttpsPort: int(ts.phoneHttpsPort, 443) },
    twaFingerprints: typeof raw.twaFingerprints === "string" && raw.twaFingerprints.trim() ? raw.twaFingerprints.trim() : null,
    nodePath: typeof raw.nodePath === "string" && raw.nodePath.trim() ? raw.nodePath.trim() : "node",
  };
}

/** 시작 전에 막을 설정 문제(없으면 null). nodePath는 PATH에서 찾는 이름(node)이거나 절대 경로여야 한다. */
function configProblem(config) {
  const p = config.nodePath;
  if (/[\\/]/.test(p) && !path.isAbsolute(p)) return `설정 nodePath는 절대 경로로 넣으세요(예: C:\\...\\node.exe). 지금: ${p}`;
  return null;
}

function readRaw(file) {
  if (!fs.existsSync(file)) return null;
  try {
    // 메모장 등이 앞에 붙이는 BOM은 JSON.parse가 못 읽는다
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new Error(`설정 파일을 읽지 못했어요: ${file} (${e.message})`);
  }
}

/** userData/config.json을 읽는다. 없으면 기본값(saved: false). */
function readConfig(file, appDir) {
  const raw = readRaw(file);
  return { config: normalizeConfig(raw || {}, appDir), saved: raw !== null };
}

/** config.json에 patch 키만 덮어 쓴다(나머지 키는 그대로). */
function writeConfig(file, patch) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...(readRaw(file) || {}), ...patch }, null, 2) + "\n");
}

/** node --version 출력이 22.15 이상 23 미만인지(네이티브 모듈이 Node 22 ABI로 빌드됨). */
function nodeVersionOk(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version).trim());
  return !!m && Number(m[1]) === 22 && Number(m[2]) >= 15;
}

/** 서버 실행 명령. env 파일은 경로만 --env-file로 넘긴다(앱은 읽지 않는다). 실행기 env가 파일보다 앞선다(Node --env-file 규칙).
 *  허브·폰 서버는 늘 127.0.0.1에만 연다: 폰은 Tailscale HTTPS로만 붙는다(와이파이 직접 연결 없음). */
function serverLaunch(config, baseEnv = process.env) {
  const env = { ...baseEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, {
    PORT: String(config.port),
    HOST: "127.0.0.1",
    PHONE_PORT: String(config.phonePort),
    PHONE_HOST: "127.0.0.1",
    REDIS_URL: "",
    RUNTIME_DIR: config.runtimeDir,
    NOONCHI_STDIN_CONTROL: "1",
  });
  if (config.twaFingerprints) env.ANDROID_TWA_SHA256_FINGERPRINTS = config.twaFingerprints;
  return { command: config.nodePath, args: [`--env-file=${config.envFile}`, "--import", "tsx", "src/server/main.ts"], cwd: config.repoDir, env };
}

/** 서버 시작 전에 여는 Tailscale HTTPS 경로. 서버가 tailscale serve status로 주소를 스스로 찾는다. */
function tailscaleOpenArgs(config) {
  if (!config.tailscale.enabled) return [];
  const route = (httpsPort, port) => {
    const target = `http://127.0.0.1:${port}`;
    return { httpsPort, target, args: ["serve", "--bg", `--https=${httpsPort}`, target] };
  };
  return [route(config.tailscale.hubHttpsPort, config.port), route(config.tailscale.phoneHttpsPort, config.phonePort)];
}

const tailscaleCloseArgs = (httpsPort) => ["serve", `--https=${httpsPort}`, "off"];

/** `tailscale serve status --json` → HTTPS 포트마다 { rootProxy(사이트 뿌리 / 하나만 있을 때 그 대상), desc(오류 창에 적을 대상) }. */
function servedRoutes(statusText) {
  const status = String(statusText || "").trim() ? JSON.parse(statusText) : {};
  const out = new Map();
  const tcp = isRecord(status.TCP) ? status.TCP : {};
  for (const [port, entry] of Object.entries(tcp)) {
    if (!isRecord(entry)) continue;
    const desc = Object.entries(entry).filter(([k]) => k !== "HTTPS").map(([k, v]) => `${k} ${v}`).join(", ");
    out.set(Number(port), { rootProxy: null, desc: desc || "HTTPS" });
  }
  const web = isRecord(status.Web) ? status.Web : {};
  for (const [hostPort, site] of Object.entries(web)) {
    const m = /:(\d+)$/.exec(hostPort);
    const handlers = isRecord(site) && isRecord(site.Handlers) ? site.Handlers : {};
    if (!m) continue;
    const mounts = Object.entries(handlers).map(([mount, h]) => [mount, isRecord(h) ? h.Proxy || h.Path || h.Text || "" : ""]);
    const root = mounts.length === 1 && mounts[0][0] === "/" ? String(mounts[0][1]) : null;
    out.set(Number(m[1]), { rootProxy: root, desc: mounts.map(([mount, t]) => (mount === "/" ? t : `${mount} → ${t}`)).join(", ") || "HTTPS" });
  }
  return out;
}

/** 이미 있는 대상이 이 PC의 그 포트로 가는 사이트 뿌리 경로인지. */
function sameTarget(proxy, target) {
  try {
    const a = new URL(proxy);
    const b = new URL(target);
    return a.protocol === "http:" && LOCAL_HOSTS.has(a.hostname) && a.port === b.port && a.pathname === "/";
  } catch {
    return false;
  }
}

/** 한 번 재 보기: "busy"(127.0.0.1 연결됨, 또는 127.0.0.1 열기가 EADDRINUSE·EACCES), "free"(열림), "unknown"(EFAULT 같은 일시 오류).
 *  0.0.0.0에 열면 첫 실행 때 Windows 방화벽 창이 뜨므로 127.0.0.1에만 열어 본다. */
function probePort(port) {
  return new Promise((resolve) => {
    let done = false;
    const sock = net.connect({ port, host: "127.0.0.1" });
    const after = (state) => {
      if (done) return;
      done = true;
      sock.destroy();
      if (state) return resolve(state);
      const probe = net.createServer();
      probe.once("error", (e) => resolve(e.code === "EADDRINUSE" || e.code === "EACCES" ? "busy" : "unknown"));
      probe.listen({ port, host: "127.0.0.1", exclusive: true }, () => probe.close(() => resolve("free")));
    };
    sock.setTimeout(1000);
    sock.once("connect", () => after("busy"));
    sock.once("error", (e) => after(e.code === "ECONNREFUSED" ? null : "unknown"));
    sock.once("timeout", () => after(null));
  });
}

/** 포트를 누가 듣고 있으면 true. 일시 오류면 3번까지 다시 재고, 계속되면 비었다고 본다(진짜로 못 열면 서버가 로그와 함께 끝난다). */
async function portInUse(port) {
  for (let i = 0; i < 3; i++) {
    const state = await probePort(port);
    if (state !== "unknown") return state === "busy";
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const pad = (n) => String(n).padStart(2, "0");
/** server-YYYYMMDD-HHmmss.log(현지 시각). */
const logFileName = (d) => `server-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.log`;

/** promise가 ms 안에 끝나면 true, 아니면 false. 타이머는 늘 치운다. */
function within(promise, ms) {
  let timer;
  return Promise.race([promise.then(() => true), new Promise((r) => { timer = setTimeout(() => r(false), ms); })]).finally(() => clearTimeout(timer));
}

/**
 * 시작: 설정 → 포트 → node 버전 → env 파일 → 대시보드 빌드 → Tailscale 경로 → 서버 실행 → GET /api/setup 200까지 기다림.
 * 종료: 여는 중인 경로를 기다림 → 표준 입력 shutdown 한 줄 → stopMs 안에 안 끝나면 프로세스 트리 강제 종료 → 앱이 연 경로만 닫기.
 * start()는 { ok: true, url, logPath } 또는 { ok: false, kind, message, logPath }.
 * kind: config·port·node·envFile·uiBuild·tailscale·exited·timeout·stopped.
 * 준비 뒤 앱이 끄지 않았는데 서버가 끝나면 deps.onServerExit(로그 경로를 담은 글)를 부른다.
 */
function createHub(config, deps) {
  const t = { ...DEFAULT_TIMEOUTS, ...(deps.timeouts || {}) };
  const opened = [];
  let child = null;
  let exited = null;
  let exitCode = null;
  let hasExited = false;
  let logPath = null;
  let opening = null;
  let stopping = null;

  const fail = (kind, message) => ({ ok: false, kind, message, logPath });

  async function closeRoutes() {
    while (opened.length) {
      const port = opened.shift();
      try { await deps.run("tailscale", tailscaleCloseArgs(port)); } catch { /* 이미 닫혔으면 그대로 둔다 */ }
    }
  }

  // 같은 대상이 이미 있으면 그대로 쓰고(열지도 닫지도 않음), 다른 대상이 있으면 덮어쓰지 않고 멈춘다
  async function openRoutes() {
    const wanted = tailscaleOpenArgs(config);
    if (!wanted.length) return null;
    let served;
    try {
      served = servedRoutes(await deps.run("tailscale", ["serve", "status", "--json"]));
    } catch (e) {
      return fail("tailscale", `Tailscale 상태를 읽지 못했어요: ${e.message}`);
    }
    for (const { httpsPort, target } of wanted) {
      const existing = served.get(httpsPort);
      if (existing && !(existing.rootProxy && sameTarget(existing.rootProxy, target))) {
        return fail("tailscale", `Tailscale https ${httpsPort}에 이미 다른 경로가 있어요: ${existing.desc}. 그 경로를 끄거나 설정 tailscale 포트를 바꾼 뒤 다시 여세요.`);
      }
    }
    for (const { httpsPort, args } of wanted) {
      if (stopping) return null;
      if (served.has(httpsPort)) continue;
      try {
        await deps.run("tailscale", args);
        opened.push(httpsPort);
      } catch (e) {
        await closeRoutes();
        return fail("tailscale", `Tailscale 경로(https ${httpsPort})를 열지 못했어요: ${e.message}`);
      }
    }
    return null;
  }

  function stop() {
    return (stopping ??= (async () => {
      if (opening) await opening;
      if (child && !hasExited) {
        try { child.stdin.write("shutdown\n"); } catch { /* 표준 입력이 이미 닫혔으면 아래 강제 종료로 간다 */ }
        if (!(await within(exited, t.stopMs))) {
          await deps.killTree(child.pid);
          await within(exited, 5_000);
        }
      }
      await closeRoutes();
    })());
  }

  function launch() {
    const logsDir = path.join(config.runtimeDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    logPath = path.join(logsDir, logFileName(deps.now ? deps.now() : new Date()));
    // 서버가 로그 파일에 직접 쓴다: 실행기가 죽어도 서버의 종료 로그가 남고, 끊긴 파이프에 써서 죽지 않는다
    const fd = fs.openSync(logPath, "a");
    const { command, args, cwd, env } = serverLaunch(config, deps.env || process.env);
    // Windows: detached가 아니면 libuv가 자식을 실행기의 kill-on-close job에 넣는다. 그러면 실행기가 죽을 때 서버가
    // 표준 입력 끝을 보기 전에 같이 죽어 정리(종료하는 중…)를 못 한다. 표준 입력은 파이프 그대로라 끝은 그대로 보인다
    const detached = process.platform === "win32";
    try {
      child = deps.spawn(command, args, { cwd, env, stdio: ["pipe", fd, fd], windowsHide: true, detached });
    } finally {
      fs.closeSync(fd);
    }
    exited = new Promise((resolve) => {
      child.once("exit", (code) => { hasExited = true; exitCode = code; resolve(); });
      child.once("error", (e) => { hasExited = true; exitCode = e.message; resolve(); });
    });
    if (child.stdin && typeof child.stdin.on === "function") child.stdin.on("error", () => {});
  }

  async function start() {
    const problem = configProblem(config);
    if (problem) return fail("config", problem);

    const busy = [];
    for (const port of [config.port, config.phonePort]) if (await deps.portInUse(port)) busy.push(port);
    if (busy.length) return fail("port", `${busy.join("·")} 포트를 이미 쓰고 있어요. 그 포트의 서버를 끈 뒤 다시 여세요.`);

    let version = "";
    try { version = String(await deps.run(config.nodePath, ["--version"])).trim(); } catch { /* 아래에서 못 찾음으로 알린다 */ }
    if (!nodeVersionOk(version)) {
      return fail("node", `Node ${NODE_RANGE}가 필요해요. 지금 ${config.nodePath}: ${version || "실행하지 못함"}. 설정 nodePath에 맞는 node.exe 경로를 넣으세요.`);
    }
    if (!config.envFile || !deps.exists(config.envFile)) return fail("envFile", `env 파일이 없어요: ${config.envFile || "(설정 envFile 없음)"}`);
    const uiIndex = path.join(config.repoDir, "ui", "dist", "index.html");
    if (!deps.exists(uiIndex)) return fail("uiBuild", `대시보드 빌드가 없어요: ${uiIndex}. 저장소 뿌리에서 npm run ui:build를 먼저 실행하세요.`);

    if (stopping) return fail("stopped", "");
    opening = openRoutes();
    const routeFail = await opening;
    if (routeFail) return routeFail;
    if (stopping) {
      await closeRoutes();
      return fail("stopped", "");
    }

    launch();
    const base = `http://127.0.0.1:${config.port}`;
    const deadline = Date.now() + t.readyMs;
    for (;;) {
      if (stopping) return fail("stopped", "");
      if (hasExited) {
        await stop();
        return fail("exited", `서버가 준비 전에 끝났어요(코드 ${exitCode}). 로그: ${logPath}`);
      }
      if (Date.now() >= deadline) {
        await stop();
        return fail("timeout", `서버가 ${Math.round(t.readyMs / 1000)}초 안에 준비되지 않았어요. 로그: ${logPath}`);
      }
      try {
        const res = await deps.fetch(`${base}/api/setup`, { signal: AbortSignal.timeout(2_000) });
        if (res.status === 200) {
          // 준비 뒤에도 서버 종료를 지켜본다: 앱이 끄는 중이 아닌데 끝나면 알린다
          exited.then(() => {
            if (!stopping && deps.onServerExit) deps.onServerExit(`서버가 끝났어요(코드 ${exitCode}). 로그: ${logPath}`);
          });
          return { ok: true, url: `${base}/`, logPath };
        }
      } catch { /* 아직 듣지 않음 */ }
      await within(exited, t.pollMs);
    }
  }

  return { start, stop };
}

/** 실제 실행기(main.cjs). */
function realDeps() {
  const { execFile, spawn } = require("node:child_process");
  const run = (cmd, args) => new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15_000, windowsHide: true }, (e, out, err) => (e ? reject(new Error(String(err || e.message).trim())) : resolve(String(out))));
  });
  const killTree = async (pid) => {
    if (process.platform === "win32") await run("taskkill", ["/PID", String(pid), "/T", "/F"]).catch(() => {});
    else try { process.kill(pid, "SIGKILL"); } catch { /* 이미 끝남 */ }
  };
  return { portInUse, exists: (p) => fs.existsSync(p), run, spawn, fetch: (...a) => fetch(...a), killTree };
}

module.exports = {
  NODE_RANGE, DEFAULT_TIMEOUTS, normalizeConfig, configProblem, readConfig, writeConfig, nodeVersionOk, serverLaunch,
  tailscaleOpenArgs, tailscaleCloseArgs, servedRoutes, portInUse, logFileName, createHub, realDeps,
};
