// 키 없는 컨테이너 확인: compose 프로젝트 noonchi-check로 noonchi를 127.0.0.1:8500(허브)·8510(폰)에 띄우고
// /api/health가 200인지, 폰 화면이 열리는지, docker stop(SIGTERM)에 종료 코드 0으로 끝나는지 본 뒤 내린다(볼륨까지 지운다).
// 저장소 .env와 셸의 키·토큰은 넘기지 않는다: 확인용 값만 적은 임시 env 파일을 --env-file과 NOONCHI_ENV_FILE로 준다.
// 모델·PAM·에이전트(OpenAI 공급자) 주소는 컨테이너 안에서 닿지 않는 로컬 주소다. 실제 AI API를 부르지 않는다.
// 무거운 일 잠금 안에서 돌린다: npm run heavy -- npx tsx scripts/container-smoke.ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HUB_URL = "http://127.0.0.1:8500";
const PHONE_URL = "http://127.0.0.1:8510";
const CHECK_ENV = {
  HUB: "memory", INFERENCE_MODE: "mock", VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_URL: "http://127.0.0.1:9",
  AGENT_PROVIDER: "openai", OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
};

const envFile = join(mkdtempSync(join(tmpdir(), "noonchi-check-")), "check.env");
writeFileSync(envFile, Object.entries(CHECK_ENV).map(([k, v]) => `${k}=${v}\n`).join(""));
// 셸의 키·토큰 값은 넘기지 않는다
const shell = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/(KEY|TOKEN|SECRET)$/i.test(k)));
const env = { ...shell, NOONCHI_ENV_FILE: envFile, NOONCHI_PORT: "8500", NOONCHI_PHONE_PORT: "8510" };
const compose = (args: string[], capture = false) =>
  spawnSync("docker", ["compose", "--env-file", envFile, "-p", "noonchi-check", ...args], { cwd: ROOT, env, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitJson(url: string, ms: number): Promise<Record<string, any> | null> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (r.ok) return (await r.json()) as Record<string, any>;
    } catch { /* 아직 안 뜸 */ }
    await sleep(2000);
  }
  return null;
}

let code = 1;
try {
  if (compose(["up", "-d", "--build", "noonchi"]).status !== 0) throw new Error("compose up 실패");
  const h = await waitJson(`${HUB_URL}/api/health`, 120_000);
  if (!h) throw new Error("120초 안에 /api/health가 답하지 않았어요");
  console.log(`health: hub=${h.hub} provider=${h.provider} eye=${h.eye} twin=${h.twin}`);
  console.log(`ready: ${JSON.stringify(h.ready)}`);
  const fails: string[] = [];
  if (h.provider !== "openai") fails.push(`에이전트가 openai가 아니에요(${h.provider})`);
  if (!h.twin) fails.push("트윈 결과물(twin/)이 이미지에 없어요");
  if (h.ready?.db !== true) fails.push("기록 DB를 열지 못했어요");
  if (h.ready?.inference_mode !== "mock" || h.ready?.vlm?.base_url !== CHECK_ENV.VLM_BASE_URL) fails.push("추론 설정이 확인용 env 파일 값이 아니에요");
  const phone = await fetch(`${PHONE_URL}/phone/`, { signal: AbortSignal.timeout(5000) }).then((r) => r.status, () => 0);
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
  compose(["logs", "--tail", "80", "noonchi"]);
} finally {
  compose(["down", "-v"]);
}
process.exit(code);
