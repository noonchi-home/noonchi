// 키 없는 컨테이너 확인: compose 프로젝트 noonchi-check로 noonchi(호스트 허브·폰 포트), 가짜 OpenAI 호환 서버(check 프로필)를 띄우고
// ready.ok가 true인지(VLM·PAM LLM이 모두 가짜 서버로 답함), /api/health 폰 주소가 확인용 PHONE_URL 하나뿐인지, 에이전트가 가짜 서버의 답을 돌려주는지, 엔진 프레임 뒤 서버 안 PAM 판단(대기)이 기록되는지, 폰 화면(HTML·script·link 파일·인코딩 워커)이 열리는지,
// 이미지 안 YOLO26s·관절 모델이 떴고(GET /api/brain detector yolo26s-seg, pose yolo26n-pose) 관찰 흐름(BRAIN=1)이 엔진 프레임 한 장을 YOLO·가짜 VLM으로 분석해 기록 DB에 vlm 줄을 남기는지(GET /api/history·/api/brain detected),
// 호스트에서 보낸 계획(POST /api/plan)이 토큰 없이는 403, PLAN_TOKEN을 붙이면 200인지,
// docker stop(SIGTERM)에 종료 코드 0으로 끝나는지, 멈춘 컨테이너에 onnxruntime 원격 측정 파일(~/.cache/Microsoft/DeveloperTools/.onnxruntime)이 없는지(docker diff) 본 뒤 내린다(볼륨까지 지운다).
// 키가 그 키를 쓰는 서비스에만 가는지(docker compose config, scripts/compose-keys.ts)도 본다.
// 저장소 .env와 셸의 키·토큰은 넘기지 않는다: 확인용 값만 적은 임시 env 파일을 --env-file로 주고, compose가 서비스에 넘기는 이름은 셸 값을 지운다.
// 모델·PAM LLM·에이전트(OpenAI 공급자) 주소는 compose 안의 가짜 서버(fake-openai:8500)다. 실제 AI API를 부르지 않는다.
// 호스트 포트(127.0.0.1)는 기본 허브 8500·폰 8510이고 CHECK_HUB_PORT·CHECK_PHONE_PORT로 바꾼다(scripts/check-ports.ts).
// 무거운 일 잠금 안에서 돌린다: npm run heavy -- npx tsx scripts/container-smoke.ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import WebSocket from "ws";
import { parse } from "yaml";
import { checkPorts, type CheckPorts } from "./check-ports.js";
import { KEY_OWNERS } from "./compose-keys.js";
import { phoneAssetFailures } from "./phone-assets.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { fetchRetry } from "../src/shared/net.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** compose 파일. 그 안의 상대 경로(빌드 문맥 ..)는 deploy/ 기준이다. */
const COMPOSE_FILE = join(ROOT, "deploy", "compose.yaml");
let PORTS: CheckPorts;
try { PORTS = checkPorts(process.env); } catch (e) { console.error((e as Error).message); process.exit(2); }
const HUB_URL = `http://127.0.0.1:${PORTS.hub}`;
const PHONE_URL = `http://127.0.0.1:${PORTS.phone}`;
const FAKE = "http://fake-openai:8500/v1";
const PLAN_TOKEN = "check-plan-token";
/** 확인용 폰 주소. /api/health 폰 주소는 이것 하나여야 한다(컨테이너 안 주소는 밖에서 열 수 없어 넣지 않는다). */
const CHECK_PHONE_URL = "https://noonchi-check.example/phone/";
const CHECK_ENV = {
  HUB: "memory", BRAIN: "1", INFERENCE_MODE: "vllm", VLM_BASE_URL: "http://fake-openai:8500/v1", PAM_LLM_BASE_URL: "http://fake-openai:8500/v1",
  AGENT_PROVIDER: "openai", OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: "http://fake-openai:8500/v1", PLAN_TOKEN, PHONE_URL: CHECK_PHONE_URL,
  // 엔진 프레임 한 장 뒤 서버 안 PAM 판단이 곧 한 번 돌게 주기를 줄인다
  PAM_PERIOD_MS: "1000",
};
/** docs/plan-contract.md의 { plan } 예시. */
const PLAN_BODY = /```json\r?\n([\s\S]*?)```/.exec(readFileSync(join(ROOT, "docs", "plan-contract.md"), "utf8"))![1]!;

const tmp = mkdtempSync(join(tmpdir(), "noonchi-check-"));
const envFile = join(tmp, "check.env");
writeFileSync(envFile, Object.entries(CHECK_ENV).map(([k, v]) => `${k}=${v}\n`).join(""));
/** compose 서비스가 받는 설정 이름. 셸에 같은 이름이 있으면 compose가 env 파일보다 셸 값을 넘기므로 지운다. */
const SERVICE_ENV = new Set(Object.values((parse(readFileSync(COMPOSE_FILE, "utf8"), { merge: true }) as { services: Record<string, { environment?: Record<string, unknown> }> }).services)
  .flatMap((svc) => Object.keys(svc.environment ?? {})));
// 셸의 키·토큰 값과 서비스가 받는 이름은 넘기지 않는다
const shell = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/(KEY|TOKEN|SECRET)$/i.test(k) && !SERVICE_ENV.has(k)));
const env = { ...shell, NOONCHI_PORT: String(PORTS.hub), NOONCHI_PHONE_PORT: String(PORTS.phone) };
const compose = (args: string[], capture = false) =>
  spawnSync("docker", ["compose", "--env-file", envFile, "-f", COMPOSE_FILE, "-p", "noonchi-check", "--profile", "check", ...args],
    { cwd: ROOT, env, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 모든 키에 확인용 값을 넣은 env 파일로 compose 설정(gpu·check 프로필 포함)을 풀어, 키를 받는 서비스가 KEY_OWNERS와 다른 것을 낸다. 값은 찍지 않는다. */
function keyLeaks(): string[] {
  const keysFile = join(tmp, "keys.env");
  writeFileSync(keysFile, Object.keys(KEY_OWNERS).map((k) => `${k}=check-${k.toLowerCase()}\n`).join(""));
  const r = spawnSync("docker", ["compose", "--env-file", keysFile, "-f", COMPOSE_FILE, "-p", "noonchi-check", "--profile", "gpu", "--profile", "check", "config", "--format", "json"],
    { cwd: ROOT, env, encoding: "utf8" });
  if (r.status !== 0) return ["docker compose config 실패"];
  const services = (JSON.parse(r.stdout) as { services: Record<string, { environment?: Record<string, string | null> }> }).services;
  const out: string[] = [];
  for (const [key, owners] of Object.entries(KEY_OWNERS)) {
    const got = Object.entries(services).filter(([, svc]) => svc.environment?.[key] != null).map(([n]) => n).sort();
    if (got.join(",") !== [...owners].sort().join(",")) out.push(`${key}를 ${got.join("·") || "아무 서비스도 안"} 받아요(${owners.join("·")}만 받아야 해요)`);
  }
  return out;
}

/** 답이 올 때까지 기다리고, until(답)이 참이면 그 답을 낸다. 시간 안에 참이 안 되면 마지막 답(없으면 null). */
async function waitJson(url: string, ms: number, until: (b: Record<string, any>) => boolean = () => true): Promise<Record<string, any> | null> {
  const end = Date.now() + ms;
  let last: Record<string, any> | null = null;
  while (Date.now() < end) {
    try {
      const r = await fetchRetry(url, { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        last = (await r.json()) as Record<string, any>;
        if (until(last)) return last;
      }
    } catch { /* 아직 안 뜸 */ }
    await sleep(2000);
  }
  return last;
}

/** 폰 이벤트 소켓으로 엔진 프레임(회색 64×48 JPEG) 한 장을 보낸다. 포트 전달의 일시 오류면 다시 시도한다. */
async function sendEngineFrame(): Promise<void> {
  const w = 64, h = 48;
  const body = jpeg.encode({ data: Buffer.alloc(w * h * 4, 128), width: w, height: h }, 80).data;
  for (let attempt = 1; ; attempt++) {
    const ws = new WebSocket(`${PHONE_URL.replace(/^http/, "ws")}/phone/events`);
    try {
      await new Promise<void>((ok, no) => { ws.once("open", () => ok()); ws.once("error", no); });
      ws.send(encodeFramePacket({ kind: "engine", width: w, height: h, captured_at: Date.now(), time_err_ms: 0 }, body));
      await sleep(500);
      ws.close();
      return;
    } catch (e) {
      ws.terminate();
      if (attempt >= 5) throw e;
      await sleep(500 * attempt);
    }
  }
}

/** ms 안에 TCP로 붙지 않는 호스트 포트(127.0.0.1). 컨테이너 앞의 Docker 포트 전달이 열렸는지만 본다. */
async function closedPorts(ports: number[], ms: number): Promise<number[]> {
  const open = (port: number) => new Promise<boolean>((ok) => {
    const s = connect(port, "127.0.0.1");
    s.setTimeout(2000, () => { s.destroy(); ok(false); });
    s.once("connect", () => { s.destroy(); ok(true); });
    s.once("error", () => ok(false));
  });
  const end = Date.now() + ms;
  let closed = ports;
  while (closed.length && Date.now() < end) {
    closed = (await Promise.all(closed.map(async (p) => ((await open(p)) ? null : p)))).filter((p): p is number => p !== null);
    if (closed.length) await sleep(1000);
  }
  return closed;
}

let code = 1;
// 기다리던 요청이 이 PC의 EFAULT로 손잡이 없이 멈춰도 프로세스가 정리 없이 끝나지 않게 붙잡아 둔다(제한 시간이 돌고 down -v가 돈다)
const keepAlive = setInterval(() => {}, 1000);
try {
  const leaks = keyLeaks();
  console.log(`서비스마다 받는 키: ${leaks.length ? leaks.join("; ") : "키는 그 키를 쓰는 서비스만 받음"}`);
  if (compose(["build"]).status !== 0) throw new Error("compose build 실패");
  // 이 PC(Windows)는 포트를 열 때 가끔 EFAULT(invalid pointer address)로 실패하고, up이 성공해도 호스트 포트 하나가 안 열릴 때가 있다
  // (src/shared/net.ts). 그때만 내리고 다시 띄운다
  for (let attempt = 1; ; attempt++) {
    const up = compose(["up", "-d", "noonchi", "fake-openai"], true);
    process.stdout.write(up.stdout ?? "");
    process.stderr.write(up.stderr ?? "");
    const closed = up.status === 0 ? await closedPorts([PORTS.hub, PORTS.phone], 15_000) : [];
    if (up.status === 0 && !closed.length) break;
    const flaky = up.status === 0 || /invalid pointer address/i.test(`${up.stdout}${up.stderr}`);
    if (attempt >= 8 || !flaky) throw new Error(up.status === 0 ? `호스트 포트가 열리지 않아요(${closed.join(", ")})` : "compose up 실패");
    console.log(`compose up: ${up.status === 0 ? `호스트 포트 ${closed.join(", ")} 안 열림` : "포트 열기 일시 오류(EFAULT)"}, ${attempt}번째 다시 시도`);
    compose(["down"]);
    await sleep(1000 * attempt);
  }
  const h = await waitJson(`${HUB_URL}/api/health`, 120_000, (b) => b.ready?.ok === true);
  if (!h) throw new Error("120초 안에 /api/health가 답하지 않았어요");
  console.log(`health: hub=${h.hub} provider=${h.provider} eye=${h.eye} twin=${h.twin}`);
  console.log(`ready: ${JSON.stringify(h.ready)}`);
  const fails: string[] = [...leaks];
  if (h.ready?.ok !== true) fails.push("120초 안에 ready.ok가 true가 되지 않았어요");
  if (h.provider !== "openai") fails.push(`에이전트가 openai가 아니에요(${h.provider})`);
  if (!h.twin) fails.push("트윈 결과물(twin/)이 이미지에 없어요");
  if (h.ready?.db !== true) fails.push("기록 DB를 열지 못했어요");
  if (h.ready?.inference_mode !== "vllm" || h.ready?.vlm?.base_url !== FAKE) fails.push("추론 설정이 확인용 env 파일 값이 아니에요");
  if (h.ready?.pam?.base_url !== FAKE || h.ready?.pam?.reachable !== true) fails.push("PAM LLM 주소가 확인용 가짜 서버가 아니거나 답하지 않아요");
  console.log(`폰 주소: ${JSON.stringify(h.phone_urls)}`);
  if (JSON.stringify(h.phone_urls) !== JSON.stringify([CHECK_PHONE_URL])) fails.push(`폰 주소가 PHONE_URL 하나가 아니에요(${JSON.stringify(h.phone_urls)})`);
  const chat = await fetchRetry(`${HUB_URL}/api/agent/chat`, {
    method: "POST", headers: { "content-type": "application/json", origin: HUB_URL }, body: JSON.stringify({ message: "안녕" }), signal: AbortSignal.timeout(30_000),
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, any> }), (e: Error) => ({ status: 0, body: { error: e.message } as Record<string, any> }));
  console.log(`에이전트: ${chat.status} ${JSON.stringify(chat.body.reply ?? chat.body)}`);
  if (chat.status !== 200 || !String(chat.body.reply ?? "").includes("가짜 답")) fails.push("에이전트가 가짜 서버의 답(가짜 답)을 돌려주지 않았어요");
  // 폰 화면: /phone/ HTML, 그 script·link 파일, 폰 JS가 띄우는 인코딩 워커가 모두 200이어야 화면이 뜬다
  const phone = await phoneAssetFailures(PHONE_URL, (url) => fetchRetry(url, { signal: AbortSignal.timeout(5000) }).catch((e: Error & { cause?: { code?: string; syscall?: string } }) => {
    throw new Error(`${e.message} ${e.cause?.code ?? ""} ${e.cause?.syscall ?? ""}`.trim());
  }));
  console.log(`폰 화면 파일: ${phone.checked}개 받음, ${phone.failures.length ? phone.failures.join(", ") : "모두 200"}`);
  fails.push(...phone.failures);
  if (h.brain !== true) fails.push("관찰 흐름(BRAIN=1)이 켜지지 않았어요");
  const brain0 = await waitJson(`${HUB_URL}/api/brain`, 10_000);
  console.log(`감지기: ${brain0?.detector ?? null}, 관절: ${brain0?.pose ?? null}`);
  if (brain0?.detector !== "yolo26s-seg") fails.push(`이미지 안 YOLO26s-seg가 뜨지 않았어요(${brain0?.detector ?? null})`);
  if (brain0?.pose !== "yolo26n-pose") fails.push(`이미지 안 관절 모델이 뜨지 않았어요(${brain0?.pose ?? null})`);
  // 계획: 호스트에서 보내면 컨테이너에는 Docker 브리지 주소로 보인다. 토큰 없이는 403, PLAN_TOKEN을 붙이면 200
  const postPlan = (headers: Record<string, string>) => fetchRetry(`${HUB_URL}/api/plan`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: PLAN_BODY, signal: AbortSignal.timeout(10_000),
  }).then((r) => r.status, () => 0);
  const planNoToken = await postPlan({});
  const planToken = await postPlan({ authorization: `Bearer ${PLAN_TOKEN}` });
  console.log(`계획 보내기: 토큰 없음 ${planNoToken}, 토큰 ${planToken}`);
  if (planNoToken !== 403 || planToken !== 200) fails.push(`호스트에서 보낸 계획이 토큰 없음 403·토큰 200이 아니에요(${planNoToken}, ${planToken})`);
  // 관찰 흐름: 엔진 프레임 한 장 → YOLO·가짜 VLM → 기록 DB vlm 줄
  await sendEngineFrame().catch((e: Error) => fails.push(`엔진 프레임을 보내지 못했어요(${e.message})`));
  const vlm = await waitJson(`${HUB_URL}/api/history?kinds=vlm`, 30_000, (b) => (b.rows?.length ?? 0) > 0);
  console.log(`기록 vlm 줄: ${JSON.stringify(vlm?.rows?.[0]?.text ?? null)}`);
  if (vlm?.ok !== true || !(vlm.rows?.length > 0)) fails.push("/api/history에 엔진 프레임의 vlm 줄이 없어요");
  const brain1 = await waitJson(`${HUB_URL}/api/brain`, 10_000, (b) => (b.detected ?? 0) >= 1);
  console.log(`YOLO 분석: ${brain1?.detected ?? 0}장`);
  if (!((brain1?.detected ?? 0) >= 1)) fails.push("YOLO가 엔진 프레임을 분석하지 않았어요(/api/brain detected)");
  // 서버 안 PAM 판단: 엔진 프레임이 오는 동안 주기 판단 한 번(가짜 PAM LLM은 대기) → 기록 DB decision 줄
  const decided = await waitJson(`${HUB_URL}/api/history?kinds=decision`, 30_000, (b) => (b.rows?.length ?? 0) > 0);
  const decision = decided?.rows?.[0];
  console.log(`PAM 판단: ${JSON.stringify(decision?.text ?? null)} ${JSON.stringify(decision?.data?.status ?? null)}`);
  if (decision?.data?.status !== "valid" || decision?.text !== "대기") fails.push("서버 안 PAM 판단이 가짜 PAM LLM의 대기가 아니에요(기록 DB decision 줄)");
  // docker stop(SIGTERM) → 서버가 닫고 0으로 끝나야 한다
  if (compose(["stop", "noonchi"]).status !== 0) fails.push("compose stop 실패");
  const id = compose(["ps", "-a", "-q", "noonchi"], true).stdout.trim();
  const exit = spawnSync("docker", ["inspect", "-f", "{{.State.ExitCode}}", id], { encoding: "utf8" }).stdout.trim();
  console.log(`stop 뒤 종료 코드: ${exit}`);
  if (exit !== "0") fails.push(`SIGTERM 뒤 종료 코드가 0이 아니에요(${exit})`);
  // onnxruntime 원격 측정(기기 id·측정 DB를 쓰고 HTTPS로 보냄)은 이미지가 ORT_DISABLE_TELEMETRY=1로 끈다: YOLO가 돈 뒤에도 그 파일이 없어야 한다
  const diff = spawnSync("docker", ["diff", id], { encoding: "utf8" });
  const telemetry = (diff.stdout ?? "").split(/\r?\n/).filter((l) => /\/home\/node\/\.cache|DeveloperTools|\.onnxruntime/.test(l));
  console.log(`onnxruntime 원격 측정 파일: ${diff.status !== 0 ? "docker diff 실패" : telemetry.length ? telemetry.join(", ") : "없음"}`);
  if (diff.status !== 0) fails.push("docker diff 실패");
  else if (telemetry.length) fails.push(`onnxruntime 원격 측정 파일이 생겼어요(${telemetry.join(", ")})`);
  if (fails.length) throw new Error(fails.join("; "));
  console.log("키 없는 컨테이너 확인: 통과");
  code = 0;
} catch (e) {
  console.error(`키 없는 컨테이너 확인 실패: ${(e as Error).message}`);
  compose(["logs", "--tail", "80", "noonchi", "fake-openai"]);
} finally {
  compose(["down", "-v"]);
  clearInterval(keepAlive);
}
process.exit(code);
