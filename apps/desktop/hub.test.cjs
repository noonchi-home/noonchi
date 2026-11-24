// hub.cjs 시험(node --test). 실제 서버·Tailscale·Electron 없이 가짜 실행기로 흐름을 본다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const hub = require("./hub.cjs");

const appDir = path.resolve(__dirname);
const repoDir = path.resolve(appDir, "../..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hub-"));
// 닫은 Tailscale 경로의 https 포트 칸(["run", "tailscale", "serve", "--https=8444", "off"])
const closed = (calls) => calls.filter((x) => x[1] === "tailscale" && x.at(-1) === "off").map((x) => x[3]);

function config(over = {}) {
  const dir = tmp();
  return hub.normalizeConfig({ repoDir: dir, envFile: path.join(dir, "noonchi.env"), port: 8300, phonePort: 8310, runtimeDir: "runtime/hub-check", ...over }, appDir);
}

// 가짜 실행기: 부른 순서를 calls에 적는다. 서버는 shutdown 줄을 받거나 kill되면 끝난다.
function fakeDeps(over = {}) {
  const calls = [];
  const children = [];
  const deps = {
    calls, children,
    portInUse: async () => false,
    exists: () => true,
    run: async (cmd, args) => { calls.push(["run", cmd, ...args]); return cmd === "node" ? "v22.15.0\n" : ""; },
    spawn: (cmd, args, opts) => {
      calls.push(["spawn", cmd, ...args]);
      const child = new EventEmitter();
      child.pid = 4242;
      child.opts = opts;
      child.lines = [];
      child.stdin = { write: (s) => { child.lines.push(s); if (s === "shutdown\n" && !over.ignoreShutdown) setImmediate(() => child.emit("exit", 0, null)); return true; } };
      children.push(child);
      return child;
    },
    fetch: async (url) => { calls.push(["fetch", url]); return { status: 200 }; },
    killTree: async (pid) => { calls.push(["killTree", pid]); for (const c of children) c.emit("exit", 1, null); },
    timeouts: { readyMs: 200, pollMs: 5, stopMs: 50 },
    ...over,
  };
  return deps;
}

test("기본 설정: 저장소는 앱 폴더 ../.., 포트 8200·8210, Tailscale 8444·443, env 파일 없음", () => {
  const c = hub.normalizeConfig({}, appDir);
  assert.equal(c.repoDir, repoDir);
  assert.equal(c.envFile, null);
  assert.equal(c.runtimeDir, path.join(repoDir, "runtime", "hub"));
  assert.equal(c.port, 8200);
  assert.equal(c.phonePort, 8210);
  assert.deepEqual(c.tailscale, { enabled: true, hubHttpsPort: 8444, phoneHttpsPort: 443 });
  assert.equal(c.twaFingerprints, null);
  assert.equal(c.nodePath, "node");
});

test("설정 파일: 없으면 기본값, 있으면 고친 키만 바꾸고 tailscale은 칸별로 합친다", () => {
  const dir = tmp();
  const file = path.join(dir, "config.json");
  assert.equal(hub.readConfig(file, appDir).saved, false);
  fs.writeFileSync(file, JSON.stringify({ port: 8300, tailscale: { enabled: false } }));
  const { config: c, saved } = hub.readConfig(file, appDir);
  assert.equal(saved, true);
  assert.equal(c.port, 8300);
  assert.equal(c.phonePort, 8210);
  assert.deepEqual(c.tailscale, { enabled: false, hubHttpsPort: 8444, phoneHttpsPort: 443 });
  hub.writeConfig(file, { envFile: "C:/x/noonchi.env" });
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).envFile, "C:/x/noonchi.env");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).port, 8300);
});

test("RUNTIME_DIR는 상대 경로를 줘도 저장소 기준 절대 경로다", () => {
  const c = config();
  const { env } = hub.serverLaunch(c, {});
  assert.ok(path.isAbsolute(env.RUNTIME_DIR));
  assert.equal(env.RUNTIME_DIR, path.join(c.repoDir, "runtime", "hub-check"));
  assert.equal(hub.serverLaunch(config({ runtimeDir: undefined }), {}).env.RUNTIME_DIR.endsWith(path.join("runtime", "hub")), true);
});

test("실행 명령: 시스템 node, --env-file, tsx, 저장소 루트. 환경 변수는 정한 값만", () => {
  const c = config();
  const launch = hub.serverLaunch(c, { PATH: "p", ELECTRON_RUN_AS_NODE: "1" });
  assert.equal(launch.command, "node");
  assert.deepEqual(launch.args, [`--env-file=${c.envFile}`, "--import", "tsx", "src/server/main.ts"]);
  assert.equal(launch.cwd, c.repoDir);
  assert.equal(launch.env.PATH, "p");
  assert.equal(launch.env.PORT, "8300");
  assert.equal(launch.env.HOST, "127.0.0.1");
  assert.equal(launch.env.PHONE_PORT, "8310");
  assert.equal(launch.env.REDIS_URL, "");
  assert.equal(launch.env.NOONCHI_STDIN_CONTROL, "1");
  assert.equal("ELECTRON_RUN_AS_NODE" in launch.env, false);
  assert.equal("HUB_URL" in launch.env, false);
  assert.equal("PHONE_URL" in launch.env, false);
  assert.equal("ANDROID_TWA_SHA256_FINGERPRINTS" in launch.env, false);
  assert.equal(hub.serverLaunch(config({ twaFingerprints: "AA:BB" }), {}).env.ANDROID_TWA_SHA256_FINGERPRINTS, "AA:BB");
  // 바로가기로 켜면 PATH의 node가 다른 버전일 수 있다: nodePath로 22.x node를 고른다
  assert.equal(hub.serverLaunch(config({ nodePath: "C:/fnm/v22/node.exe" }), {}).command, "C:/fnm/v22/node.exe");
});

test("env 파일 경로는 --env-file로만 쓰고 앱은 읽지 않는다", async (t) => {
  const c = config();
  fs.writeFileSync(c.envFile, "SECRET=x\n");
  const touched = [];
  const isEnv = (p) => typeof p === "string" && path.resolve(p) === path.resolve(c.envFile);
  for (const [obj, name] of [[fs, "readFileSync"], [fs, "readFile"], [fs, "createReadStream"], [fs, "openSync"], [fs, "open"], [fs.promises, "readFile"], [fs.promises, "open"]]) {
    const orig = obj[name];
    t.mock.method(obj, name, function (...a) { if (isEnv(a[0])) touched.push(name); return orig.apply(this, a); });
  }
  const deps = fakeDeps();
  const h = hub.createHub(c, deps);
  assert.equal((await h.start()).ok, true);
  await h.stop();
  assert.deepEqual(touched, []);
  const spawned = deps.calls.find((x) => x[0] === "spawn");
  assert.equal(spawned.filter((a) => a.includes(c.envFile)).length, 1);
  assert.equal(Object.values(deps.children[0].opts.env).some((v) => String(v).includes(c.envFile)), false);
});

test("Tailscale: 켜면 허브·폰 경로 열기, 끄면 명령이 없다", async () => {
  const c = config({ tailscale: { enabled: true } });
  assert.deepEqual(hub.tailscaleOpenArgs(c), [
    { httpsPort: 8444, args: ["serve", "--bg", "--https=8444", "http://127.0.0.1:8300"] },
    { httpsPort: 443, args: ["serve", "--bg", "--https=443", "http://127.0.0.1:8310"] },
  ]);
  assert.deepEqual(hub.tailscaleCloseArgs(8444), ["serve", "--https=8444", "off"]);
  const off = config({ tailscale: { enabled: false } });
  assert.deepEqual(hub.tailscaleOpenArgs(off), []);
  const deps = fakeDeps();
  const h = hub.createHub(off, deps);
  assert.equal((await h.start()).ok, true);
  await h.stop();
  assert.equal(deps.calls.some((x) => x[1] === "tailscale"), false);
});

// 127.0.0.1 빈 포트에 연다. 이 PC의 도구 샌드박스에서는 소켓 호출이 가끔 EFAULT로 실패해 다시 연다
async function listenLocal() {
  for (let i = 0; ; i++) {
    try {
      return await new Promise((ok, no) => { const srv = net.createServer(); srv.once("error", no); srv.listen(0, "127.0.0.1", () => ok(srv)); });
    } catch (e) {
      if (e.code !== "EFAULT" || i >= 20) throw e;
    }
  }
}

test("포트 사용 확인: 듣는 포트는 true, 닫으면 false", async () => {
  const srv = await listenLocal();
  const { port } = srv.address();
  assert.equal(await hub.portInUse(port), true);
  await new Promise((ok) => srv.close(ok));
  assert.equal(await hub.portInUse(port), false);
});

test("포트 사용 확인: 열기 실패는 EADDRINUSE·EACCES만 쓰는 중, 일시 오류(EFAULT)는 다시 재고 계속되면 비었다고 본다", async (t) => {
  const emitLater = (em, code) => setImmediate(() => em.emit("error", Object.assign(new Error(code), { code })));
  // 연결은 늘 거부(아무도 안 들음), 열기 결과는 codes 차례로(없으면 마지막 값)
  t.mock.method(net, "connect", () => { const sock = new EventEmitter(); sock.setTimeout = () => {}; sock.destroy = () => {}; emitLater(sock, "ECONNREFUSED"); return sock; });
  const listens = (...codes) => {
    let n = 0;
    return () => {
      const code = codes[Math.min(n++, codes.length - 1)];
      const probe = new EventEmitter();
      probe.listen = (_opts, cb) => (code === "ok" ? setImmediate(cb) : emitLater(probe, code));
      probe.close = (cb) => cb && cb();
      return probe;
    };
  };
  const server = t.mock.method(net, "createServer", listens("EFAULT"));
  assert.equal(await hub.portInUse(8399), false);
  assert.equal(server.mock.callCount(), 3);
  for (const [codes, busy] of [[["EADDRINUSE"], true], [["EACCES"], true], [["ok"], false], [["EFAULT", "EADDRINUSE"], true], [["EFAULT", "ok"], false]]) {
    server.mock.mockImplementation(listens(...codes));
    assert.equal(await hub.portInUse(8399), busy, codes.join(","));
  }
});

test("포트가 쓰이면 Tailscale도 서버도 시작하지 않는다", async () => {
  const srv = await listenLocal();
  try {
    const c = config({ port: srv.address().port });
    const deps = fakeDeps({ portInUse: hub.portInUse });
    const r = await hub.createHub(c, deps).start();
    assert.equal(r.ok, false);
    assert.equal(r.kind, "port");
    assert.match(r.message, new RegExp(String(srv.address().port)));
    assert.deepEqual(deps.calls.filter((x) => x[0] === "spawn" || x[1] === "tailscale"), []);
  } finally {
    await new Promise((ok) => srv.close(ok));
  }
});

test("node 버전: 22.15 이상 23 미만만", async () => {
  for (const [v, ok] of [["v22.15.0", true], ["v22.20.1", true], ["v22.14.9", false], ["v23.0.0", false], ["v24.14.1", false], ["", false]]) {
    assert.equal(hub.nodeVersionOk(v), ok, v);
  }
  const deps = fakeDeps({ run: async (cmd, args) => { deps.calls.push(["run", cmd, ...args]); return "v24.14.1\n"; } });
  const r = await hub.createHub(config(), deps).start();
  assert.equal(r.kind, "node");
  assert.match(r.message, /v24\.14\.1/);
  assert.match(r.message, /nodePath/);
  assert.equal(deps.calls.some((x) => x[0] === "spawn" || x[1] === "tailscale"), false);
});

test("env 파일이 없으면 시작하지 않는다", async () => {
  const deps = fakeDeps({ exists: () => false });
  const r = await hub.createHub(config(), deps).start();
  assert.equal(r.kind, "envFile");
  assert.equal(deps.calls.some((x) => x[0] === "spawn"), false);
});

test("시작: 경로 열기 → 서버 → /api/setup 200. 종료: shutdown 줄 → 연 경로만 닫기", async () => {
  const c = config();
  const deps = fakeDeps();
  const h = hub.createHub(c, deps);
  const r = await h.start();
  assert.deepEqual(r, { ok: true, url: "http://127.0.0.1:8300/", logPath: r.logPath });
  assert.match(path.basename(r.logPath), /^server-\d{8}-\d{6}\.log$/);
  assert.equal(path.dirname(r.logPath), path.join(c.runtimeDir, "logs"));
  const order = deps.calls.map((x) => x[0] === "run" ? `${x[1]} ${x[2]}` : x[0]);
  assert.deepEqual(order.slice(0, 5), ["node --version", "tailscale serve", "tailscale serve", "spawn", "fetch"]);
  assert.equal(deps.calls.find((x) => x[0] === "fetch")[1], "http://127.0.0.1:8300/api/setup");
  const child = deps.children[0];
  assert.equal(child.opts.cwd, c.repoDir);
  assert.equal(child.opts.windowsHide, true);
  // Windows: detached가 아니면 libuv가 서버를 실행기의 kill-on-close job에 넣어, 실행기가 죽을 때 정리 없이 같이 죽는다
  assert.equal(child.opts.detached, process.platform === "win32");
  assert.equal(child.opts.stdio[0], "pipe");
  assert.equal(typeof child.opts.stdio[1], "number");
  await Promise.all([h.stop(), h.stop()]);
  assert.deepEqual(child.lines, ["shutdown\n"]);
  assert.equal(deps.calls.some((x) => x[0] === "killTree"), false);
  assert.deepEqual(closed(deps.calls), ["--https=8444", "--https=443"]);
});

test("준비될 때까지 기다린다: 503·연결 실패 뒤 200", async () => {
  let n = 0;
  const deps = fakeDeps({ fetch: async () => { n += 1; if (n === 1) throw new Error("ECONNREFUSED"); return { status: n === 2 ? 503 : 200 }; } });
  const h = hub.createHub(config({ tailscale: { enabled: false } }), deps);
  assert.equal((await h.start()).ok, true);
  assert.equal(n, 3);
  await h.stop();
});

test("종료가 20초(stopMs) 안에 안 끝나면 프로세스 트리를 강제로 끈다", async () => {
  const deps = fakeDeps({ ignoreShutdown: true });
  const h = hub.createHub(config({ tailscale: { enabled: false } }), deps);
  await h.start();
  await h.stop();
  assert.deepEqual(deps.calls.filter((x) => x[0] === "killTree"), [["killTree", 4242]]);
});

test("서버가 먼저 끝나면 로그 경로와 함께 실패하고 연 경로를 닫는다", async () => {
  const deps = fakeDeps({ fetch: async () => { setImmediate(() => deps.children[0].emit("exit", 1, null)); throw new Error("ECONNREFUSED"); } });
  const r = await hub.createHub(config(), deps).start();
  assert.equal(r.ok, false);
  assert.equal(r.kind, "exited");
  assert.ok(r.message.includes(r.logPath));
  assert.deepEqual(closed(deps.calls), ["--https=8444", "--https=443"]);
});

test("시간 안에 준비되지 않으면 서버를 끄고 연 경로를 닫는다", async () => {
  const deps = fakeDeps({ fetch: async () => ({ status: 503 }) });
  const r = await hub.createHub(config(), deps).start();
  assert.equal(r.kind, "timeout");
  assert.ok(r.message.includes(r.logPath));
  assert.deepEqual(deps.children[0].lines, ["shutdown\n"]);
  assert.deepEqual(closed(deps.calls), ["--https=8444", "--https=443"]);
});

test("Tailscale 경로를 열다 실패하면 먼저 연 것만 닫고 서버를 띄우지 않는다", async () => {
  const deps = fakeDeps({
    run: async (cmd, args) => {
      deps.calls.push(["run", cmd, ...args]);
      if (cmd === "node") return "v22.15.0";
      if (args.includes("--https=443") && args.includes("--bg")) throw new Error("not logged in");
      return "";
    },
  });
  const r = await hub.createHub(config(), deps).start();
  assert.equal(r.kind, "tailscale");
  assert.match(r.message, /not logged in/);
  assert.deepEqual(closed(deps.calls), ["--https=8444"]);
  assert.equal(deps.calls.some((x) => x[0] === "spawn"), false);
});

test("시작 중에 종료하면 기다림을 멈추고 실패 창 없이 끝난다", async () => {
  const deps = fakeDeps({ fetch: async () => ({ status: 503 }), timeouts: { readyMs: 5000, pollMs: 5, stopMs: 50 } });
  const h = hub.createHub(config({ tailscale: { enabled: false } }), deps);
  const started = h.start();
  await new Promise((ok) => setTimeout(ok, 30));
  await h.stop();
  assert.equal((await started).kind, "stopped");
});

test("로그 파일 이름은 현지 시각 server-YYYYMMDD-HHmmss.log", () => {
  assert.equal(hub.logFileName(new Date(2026, 10, 24, 9, 5, 7)), "server-20261124-090507.log");
});
