// 키 없는 컨테이너 확인: compose 프로젝트 noonchi-check로 noonchi(127.0.0.1:8500 허브·8510 폰), pam(8520), 가짜 OpenAI 호환 서버(check 프로필)를 띄우고
// ready.ok가 true인지(VLM·PAM 서비스·PAM LLM이 모두 가짜 서버로 답함), 에이전트가 가짜 서버의 답을 돌려주는지, PAM 서비스가 관찰 텍스트로 판단하는지, 폰 화면이 열리는지,
// docker stop(SIGTERM)에 종료 코드 0으로 끝나는지 본 뒤 내린다(볼륨까지 지운다).
// 저장소 .env와 셸의 키·토큰은 넘기지 않는다: 확인용 값만 적은 임시 env 파일을 --env-file과 NOONCHI_ENV_FILE로 준다.
// 모델·PAM LLM·에이전트(OpenAI 공급자) 주소는 compose 안의 가짜 서버(fake-openai:8500)다. 실제 AI API를 부르지 않는다.
// 무거운 일 잠금 안에서 돌린다: npm run heavy -- npx tsx scripts/container-smoke.ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRetry } from "../src/server/net.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HUB_URL = "http://127.0.0.1:8500";
const PHONE_URL = "http://127.0.0.1:8510";
const PAM_URL = "http://127.0.0.1:8520";
const FAKE = "http://fake-openai:8500/v1";
const CHECK_ENV = {
  HUB: "memory", INFERENCE_MODE: "live", VLM_BASE_URL: "http://fake-openai:8500/v1", PAM_LLM_BASE_URL: "http://fake-openai:8500/v1",
  AGENT_PROVIDER: "openai", OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: "http://fake-openai:8500/v1",
};

const envFile = join(mkdtempSync(join(tmpdir(), "noonchi-check-")), "check.env");
writeFileSync(envFile, Object.entries(CHECK_ENV).map(([k, v]) => `${k}=${v}\n`).join(""));
// 셸의 키·토큰 값은 넘기지 않는다
const shell = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/(KEY|TOKEN|SECRET)$/i.test(k)));
const env = { ...shell, NOONCHI_ENV_FILE: envFile, NOONCHI_PORT: "8500", NOONCHI_PHONE_PORT: "8510", PAM_HOST_PORT: "8520" };
const compose = (args: string[], capture = false) =>
  spawnSync("docker", ["compose", "--env-file", envFile, "-p", "noonchi-check", "--profile", "check", ...args],
    { cwd: ROOT, env, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  if (compose(["build"]).status !== 0) throw new Error("compose build 실패");
  // 이 PC(Windows)는 포트를 열 때 가끔 EFAULT(invalid pointer address)로 실패하고, up이 성공해도 호스트 포트 하나가 안 열릴 때가 있다
  // (src/server/net.ts). 그때만 내리고 다시 띄운다
  for (let attempt = 1; ; attempt++) {
    const up = compose(["up", "-d", "noonchi", "pam", "fake-openai"], true);
    process.stdout.write(up.stdout ?? "");
    process.stderr.write(up.stderr ?? "");
    const closed = up.status === 0 ? await closedPorts([8500, 8510, 8520], 15_000) : [];
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
  const fails: string[] = [];
  if (h.ready?.ok !== true) fails.push("120초 안에 ready.ok가 true가 되지 않았어요");
  if (h.provider !== "openai") fails.push(`에이전트가 openai가 아니에요(${h.provider})`);
  if (!h.twin) fails.push("트윈 결과물(twin/)이 이미지에 없어요");
  if (h.ready?.db !== true) fails.push("기록 DB를 열지 못했어요");
  if (h.ready?.inference_mode !== "live" || h.ready?.vlm?.base_url !== FAKE) fails.push("추론 설정이 확인용 env 파일 값이 아니에요");
  if (h.ready?.pam?.url !== "http://pam:8300" || h.ready?.pam?.llm?.base_url !== FAKE) fails.push("PAM 서비스·PAM LLM 주소가 compose·확인용 값이 아니에요");
  const chat = await fetchRetry(`${HUB_URL}/api/agent/chat`, {
    method: "POST", headers: { "content-type": "application/json", origin: HUB_URL }, body: JSON.stringify({ message: "안녕" }), signal: AbortSignal.timeout(30_000),
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, any> }), (e: Error) => ({ status: 0, body: { error: e.message } as Record<string, any> }));
  console.log(`에이전트: ${chat.status} ${JSON.stringify(chat.body.reply ?? chat.body)}`);
  if (chat.status !== 200 || !String(chat.body.reply ?? "").includes("가짜 답")) fails.push("에이전트가 가짜 서버의 답(가짜 답)을 돌려주지 않았어요");
  // PAM 서비스: 관찰 텍스트로 판단 한 번(가짜 PAM LLM은 대기 -1), /health의 입력 한도
  const memory = { initial_state: "s", states: [{ id: "s", description: "d", rules: [], next: [] }] };
  const predict = await fetchRetry(`${PAM_URL}/predict`, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ contract: "pam-predict/2", final_time: "2026-11-07T21:00:08+09:00", observation_text: "21:00:00 사람 보임", memory_kind: "fsm", memory, tasks: ["컵 치우기"] }),
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, any> }), (e: Error) => ({ status: 0, body: { error: e.message } as Record<string, any> }));
  console.log(`PAM 판단: ${predict.status} ${JSON.stringify(predict.body.prediction ?? predict.body)}`);
  if (predict.status !== 200 || predict.body.status !== "valid" || predict.body.prediction?.task_index !== -1) fails.push("PAM 서비스 판단이 가짜 PAM LLM의 대기(-1)가 아니에요");
  const limits = (await waitJson(`${PAM_URL}/health`, 10_000))?.limits;
  if (!(limits?.reflect_input_bytes > 0) || limits?.max_model_len !== 32768) fails.push(`PAM /health 입력 한도가 없어요(${JSON.stringify(limits)})`);
  const phone = await fetchRetry(`${PHONE_URL}/phone/`, { signal: AbortSignal.timeout(5000) }).then((r) => r.status, (e: Error & { cause?: { code?: string; syscall?: string } }) => { console.log(`폰 화면 요청 오류: ${e.message} ${e.cause?.code ?? ""} ${e.cause?.syscall ?? ""}`); return 0; });
  if (phone !== 200) fails.push(`폰 화면이 열리지 않아요(${phone})`);
  // docker stop(SIGTERM) → 서버가 닫고 0으로 끝나야 한다
  if (compose(["stop", "noonchi"]).status !== 0) fails.push("compose stop 실패");
  const id = compose(["ps", "-a", "-q", "noonchi"], true).stdout.trim();
  const exit = spawnSync("docker", ["inspect", "-f", "{{.State.ExitCode}}", id], { encoding: "utf8" }).stdout.trim();
  console.log(`stop 뒤 종료 코드: ${exit}`);
  if (exit !== "0") fails.push(`SIGTERM 뒤 종료 코드가 0이 아니에요(${exit})`);
  if (fails.length) throw new Error(fails.join("; "));
  console.log("키 없는 컨테이너 확인: 통과");
  code = 0;
} catch (e) {
  console.error(`키 없는 컨테이너 확인 실패: ${(e as Error).message}`);
  compose(["logs", "--tail", "80", "noonchi", "pam", "fake-openai"]);
} finally {
  compose(["down", "-v"]);
  clearInterval(keepAlive);
}
process.exit(code);
