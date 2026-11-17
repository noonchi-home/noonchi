// 배포 파일(Dockerfile·compose.yaml·.dockerignore·.env.example·키 없는 컨테이너 확인)이 배포 규칙을 지키는지 본다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { isKeyName, KEY_OWNERS } from "../scripts/compose-keys.js";
import { DETECTOR_MODEL, POSE_MODEL } from "../src/observe/detector.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
type Service = { environment?: Record<string, unknown> | string[]; env_file?: unknown };
/** 서비스가 받는 설정 이름(값을 정한 것과 .env에서 받는 것). */
const envNames = (s: Service) => (Array.isArray(s.environment) ? s.environment.map((e) => e.split("=")[0]!) : Object.keys(s.environment ?? {}));
const services = () => (parse(read("compose.yaml"), { merge: true }) as { services: Record<string, Service> }).services;
/** 서버 코드(src/)가 읽는 설정 이름. */
function serverEnvNames(): Set<string> {
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts")) files.push(p); } };
  walk(root);
  const res = [/\benv\??\.([A-Z][A-Z0-9_]+)/g, /\(env, "([A-Z][A-Z0-9_]+)"/g, /\bv\("([A-Z][A-Z0-9_]+)"\)/g, /keyEnv: "([A-Z][A-Z0-9_]+)"/g];
  return new Set(files.flatMap((f) => { const t = readFileSync(f, "utf8"); return res.flatMap((re) => [...t.matchAll(re)].map((m) => m[1]!)); }));
}
/** 컨테이너에 넘기지 않는 서버 설정: 호스트 경로(이미지 안 twin/·모델, RUNTIME_DIR/photos), MCP 서버용 주소, matter.js 안쪽 값. */
const NOT_FOR_CONTAINER = new Set(["TWIN_STUDIO_DIR", "PHONE_PHOTO_DIR", "BRAIN_YOLO_PATH", "BRAIN_POSE_PATH", "TWIN_HOME_URL", "MATTER_RUNTIME_SIGNALS"]);

describe("배포 파일", () => {
  it("Dockerfile: Node 22.15 이상 22.x, 운영 의존성만, 화면 빌드, 트윈 포함, 저장소 models/의 YOLO26 두 개 sha256 검사", () => {
    const d = read("Dockerfile");
    expect(d).toMatch(/node:22\.(1[5-9]|[2-9]\d)\.\d+-bookworm-slim/);
    expect(d).toContain("npm ci --omit=dev");
    expect(d).toContain("npm --prefix ui run build");
    expect(d).toContain("COPY twin twin");
    expect(d).not.toContain("COPY web web");
    // 모델은 받지 않고 저장소 models/를 복사한 뒤 표(src/observe/detector.ts)의 sha256으로 확인한다
    expect(d).toContain("COPY models models");
    for (const { file, sha256: sha } of [DETECTOR_MODEL, POSE_MODEL]) {
      expect(d).toContain(`${sha}  models/${file}`);
    }
    expect(d).toMatch(/sha256sum -c/);
    expect(d).not.toContain("BRAIN_YOLO_PATH"); // 기본 경로(/app/models/)를 쓴다
    expect(d).toMatch(/USER node/);
    expect(d).toContain('CMD ["node", "--import", "tsx", "src/server/main.ts"]');
  });

  it("Dockerfile: 실행 이미지는 onnxruntime 원격 측정(기기 id·측정 DB·HTTPS 전송)을 끈다", () => {
    const d = read("Dockerfile");
    // onnxruntime v1.31.1 docs/Privacy.md "Disabling Telemetry": ORT_DISABLE_TELEMETRY=1을 onnxruntime이 뜨기 전에 준다
    const run = d.slice(d.lastIndexOf("FROM "));
    expect(run).toContain("ORT_DISABLE_TELEMETRY=1");
  });

  it("compose: 포트는 127.0.0.1만, gpu 프로필 vLLM 두 개(태그 고정·내건 이름·GPU 몫·캐시·차례로 뜸), 볼륨·env_file·상태 검사", () => {
    const c = parse(read("compose.yaml"), { merge: true }) as { services: Record<string, any>; volumes: Record<string, unknown> };
    for (const [name, s] of Object.entries(c.services)) {
      for (const p of s.ports ?? []) expect(String(p), name).toMatch(/^127\.0\.0\.1:/);
      expect(s.healthcheck, name).toBeTruthy();
    }
    expect(c.services.noonchi.volumes).toContain("noonchi-data:/data");
    // 영상 모드 영상은 볼륨 /data/videos에 둔다(기본 공용 폴더 /app/runtime/videos는 볼륨 밖이라 이미지마다 비어 있다)
    expect(c.services.noonchi.environment.PHONE_VIDEO_DIR).toBe("/data/videos");
    const run = read("Dockerfile").slice(read("Dockerfile").lastIndexOf("FROM "));
    expect(run.replace(/\\\r?\n/g, " ")).toMatch(/^ENV .*\bPHONE_VIDEO_DIR=\/data\/videos\b/m);
    expect(c.services.noonchi.profiles).toBeUndefined();
    for (const [name, served] of [["vllm-vlm", "vlm"], ["vllm-pam", "pam"]] as const) {
      const s = c.services[name];
      expect(s.profiles).toEqual(["gpu"]);
      expect(s.image).toBe("${VLLM_IMAGE:-vllm/vllm-openai:v0.17.0}");
      const cmd = s.command.join(" ");
      expect(cmd).toMatch(/--gpu-memory-utilization \$\{VLLM_\w+_GPU_SHARE:-0\.\d+\}/);
      expect(cmd).toContain(`--served-model-name ${served}`);
      expect(s.volumes).toContain("model-cache:/root/.cache/huggingface");
    }
    expect(c.services["vllm-pam"].command.join(" ")).toContain("--max-model-len ${PAM_MAX_MODEL_LEN:-32768}");
    // live PAM LLM: Qwen3.5-27B 4비트. 생각 글은 reasoning_content로 빼서 content에는 답만 남긴다
    expect(c.services["vllm-pam"].command.join(" ")).toContain("--model ${PAM_LIVE_MODEL:-Qwen/Qwen3.5-27B-GPTQ-Int4}");
    expect(c.services["vllm-pam"].command.join(" ")).toContain("--reasoning-parser qwen3");
    expect(c.services["vllm-pam"].depends_on).toEqual({ "vllm-vlm": { condition: "service_healthy" } });
    expect(Object.keys(c.volumes)).toEqual(expect.arrayContaining(["noonchi-data", "model-cache"]));
  });

  it("compose: pam 서비스와 check 프로필 가짜 서버, noonchi는 pam에 붙는다", () => {
    const c = parse(read("compose.yaml"), { merge: true }) as { services: Record<string, any> };
    const pam = c.services.pam;
    expect(pam.build).toBe("services/pam");
    expect(pam.image).toBe("noonchi-pam:local");
    expect(pam.ports).toEqual(["127.0.0.1:${PAM_HOST_PORT:-8300}:8300"]);
    expect(pam.profiles).toBeUndefined();
    expect(c.services.noonchi.environment.PAM_URL).toBe("http://pam:8300");
    // 컨테이너 안 네트워크 주소(Docker 브리지)는 밖에서 열 수 없으니 폰 주소에 넣지 않는다
    expect(c.services.noonchi.environment.PHONE_LAN_URLS).toBe("0");
    expect(c.services.noonchi.depends_on).toEqual({ pam: { condition: "service_healthy" } });
    // 이름만 적은 칸은 .env에 있을 때만 넘긴다. ${X:-}로 두면 비어 있어도 늘 넘긴다
    for (const name of ["noonchi", "pam"]) for (const v of Object.values(c.services[name].environment ?? {})) expect(String(v), name).not.toContain("${");
    const fake = c.services["fake-openai"];
    expect(fake.profiles).toEqual(["check"]);
    expect(fake.image).toBe("noonchi:local");
    expect(fake.ports).toBeUndefined();
    expect(fake.command.join(" ")).toContain("scripts/fake-openai.ts --port 8500 --host 0.0.0.0");
  });

  it("compose: env_file 없이 서비스마다 받을 이름을 적고, 키는 그 키를 쓰는 서비스만 받는다", () => {
    const svc = services();
    for (const [name, s] of Object.entries(svc)) expect(s.env_file, `${name}: env_file은 .env 전체를 넘긴다`).toBeUndefined();
    const exampleKeys = read(".env.example").split(/\r?\n/).map((l) => /^#?\s*([A-Z][A-Z0-9_]+)=/.exec(l)?.[1]).filter((k): k is string => !!k);
    const keys = new Set([...exampleKeys, ...Object.values(svc).flatMap(envNames)].filter(isKeyName));
    for (const k of keys) {
      expect(KEY_OWNERS, `${k}을 받을 서비스를 scripts/compose-keys.ts에 적으세요`).toHaveProperty(k);
      const got = Object.entries(svc).filter(([, s]) => envNames(s).includes(k)).map(([n]) => n).sort();
      expect(got, k).toEqual([...KEY_OWNERS[k]!].sort());
    }
    expect(envNames(svc["fake-openai"]!)).toEqual([]);
  });

  it("아키텍처 계획도 compose처럼 서비스마다 이름을 적는다(env_file·NOONCHI_ENV_FILE 없음)", () => {
    const plan = read("docs/superpowers/plans/2026-11-07-noonchi-architecture.md");
    expect(plan).not.toMatch(/NOONCHI_ENV_FILE|env_file:\s*\[|env_file\)\.toEqual|env_file\(|env_file에서/);
    expect(plan).toContain("KEY_OWNERS");
    expect(plan).toContain("!SERVICE_ENV.has(k)");
  });

  it("compose: noonchi는 서버 코드가 읽는 설정을, pam은 PAM 서비스가 읽는 설정을 받는다", () => {
    const svc = services();
    const noonchi = new Set(envNames(svc.noonchi!));
    const missing = [...serverEnvNames()].filter((k) => !NOT_FOR_CONTAINER.has(k) && !noonchi.has(k));
    expect(missing, "compose.yaml noonchi environment에 더하세요").toEqual([]);
    const settings = read("services/pam/noonchi_pam/settings.py");
    const pamReads = [...settings.matchAll(/get\("([A-Z][A-Z0-9_]+)"\)|"key_env": "([A-Z][A-Z0-9_]+)"/g)].map((m) => (m[1] ?? m[2])!);
    pamReads.push((JSON.parse(read("services/pam/config/openrouter.json")) as { api_key_env: string }).api_key_env);
    expect(pamReads.length).toBeGreaterThan(5);
    expect(pamReads.filter((k) => !envNames(svc.pam!).includes(k)), "compose.yaml pam environment에 더하세요").toEqual([]);
  });

  it("PAM 이미지: 저장소 안 services/pam만 쓰고 해시를 고정한 잠금 파일로 pyproject와 같은 판의 의존성을 깐다", () => {
    const d = read("services/pam/Dockerfile");
    expect(d).toMatch(/^FROM python:3\.13\.\d+-slim-bookworm/m);
    expect(d).toContain("COPY requirements.lock ./");
    expect(d).toContain("pip install --no-cache-dir --require-hashes -r requirements.lock");
    const pyproject = read("services/pam/pyproject.toml");
    const pins = (re: RegExp) => re.exec(pyproject)![1]!.match(/"[^"]+"/g)!.map((x) => x.slice(1, -1).toLowerCase());
    const runtime = pins(/dependencies = \[([^\]]*)\]/);
    const test = pins(/test = \[([^\]]*)\]/);
    for (const [file, need] of [["services/pam/requirements.lock", runtime], ["services/pam/requirements-test.lock", [...runtime, ...test]]] as const) {
      // 판을 ==로 고정한 줄마다 sha256 해시 줄이 따른다
      const reqs: { pin: string; hashes: number }[] = [];
      for (const line of read(file).split(/\r?\n/)) {
        if (/^[A-Za-z0-9]/.test(line)) reqs.push({ pin: line.split(/[ ;]/)[0]!.toLowerCase(), hashes: 0 });
        else if (/^\s+--hash=sha256:[0-9a-f]{64}/.test(line) && reqs.length) reqs.at(-1)!.hashes++;
      }
      expect(reqs.length, file).toBeGreaterThan(need.length);
      for (const r of reqs) {
        expect(r.pin, file).toMatch(/^[a-z0-9._-]+==\S+$/);
        expect(r.hashes, `${file} ${r.pin}`).toBeGreaterThan(0);
      }
      for (const dep of need) expect(reqs.map((r) => r.pin), file).toContain(dep);
    }
    for (const x of ["COPY pam pam", "COPY noonchi_pam noonchi_pam", "COPY prompts prompts", "COPY config config", "COPY scenarios scenarios", "USER pam", "EXPOSE 8300"]) expect(d).toContain(x);
    expect(d).toContain('CMD ["uvicorn", "noonchi_pam.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8300"]');
    const i = read("services/pam/.dockerignore").split(/\r?\n/);
    for (const x of [".venv", "__pycache__", ".pytest_cache", "tests", "*.egg-info"]) expect(i).toContain(x);
  });

  it(".dockerignore가 비밀·런타임·의존성을 뺀다", () => {
    const i = read(".dockerignore").split(/\r?\n/);
    for (const x of [".env", "node_modules", "ui/node_modules", "runtime", "runtime-3d", "graft", ".git", "services/pam/.venv"]) expect(i).toContain(x);
  });

  it(".env.example의 키·토큰 값은 비어 있다", () => {
    for (const line of read(".env.example").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (m && /(KEY|TOKEN|SECRET)$/.test(m[1]!)) expect(m[2], m[1]).toBe("");
    }
  });

  it("CI: 화면 글·타입·시험·화면 빌드·이미지 빌드·키 없는 확인을 하고 이미지를 올리지 않는다", () => {
    const ci = read(".github/workflows/ci.yml");
    for (const s of ["npm run lint", "npx tsc --noEmit", "npm --prefix ui run typecheck", "npx vitest run", "npm --prefix ui test", "npm --prefix ui run build",
      "docker build", "npx tsx scripts/container-smoke.ts", "node-version-file: .node-version"]) expect(ci).toContain(s);
    expect(ci).not.toMatch(/docker push|push: true/);
    const jobs = (parse(ci) as { jobs: Record<string, { env?: Record<string, string> }> }).jobs;
    for (const [name, j] of Object.entries(jobs)) expect(j.env?.ONNXRUNTIME_NODE_INSTALL, name).toBe("skip");
    expect(ci).toContain("pip install --require-hashes -r services/pam/requirements-test.lock");
    expect(ci).toContain("pytest services/pam");
    expect(ci).toContain("docker build -t noonchi-pam:ci services/pam");
  });

  it("배포 문서: GPU 서버 크기·Tailscale 인증서·두 모드의 에이전트 키·두 모델 확인·호출량", () => {
    const d = read("docs/deploy.md");
    for (const s of ["g6e.2xlarge", "MagicDNS", "HTTPS Certificates", "tailscale serve --bg --https=443 http://127.0.0.1:8200", "tailscale serve --bg --https=8443 http://127.0.0.1:8210",
      "`ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY`", "curl -s http://127.0.0.1:8410/v1/models", "curl -s http://127.0.0.1:8420/v1/models", "`ENGINE_FRAME_MS`(기본 100)", "`VLM_FRAME_MS`(기본 2000)", "1,800", "vllm/vllm-openai:v0.17.0",
      "curl -s http://127.0.0.1:8300/health", "PAM_HOST_PORT", "`PAM_LLM_BASE_URL`", "fake-openai"]) expect(d).toContain(s);
    expect(d).not.toMatch(/\| `PAM_URL` \|/);
    // VLM 프레임 기본 간격 2초(src/observe/pipeline.ts loadObserveConfig)와 같은 값·호출량
    expect(d).not.toContain("3,600");
    expect(read("docs/reference.md")).toContain("| `ENGINE_FRAME_MS` | `100` |");
    expect(read("docs/reference.md")).toContain("| `VLM_FRAME_MS` | `2000` |");
    // 에이전트는 키가 없어도 다른 공급자(규칙 기반)로 바꾸지 않고 준비 안 됨으로 보인다
    expect(d).toContain("`agent.key`·`agent.reachable`");
    for (const f of ["docs/deploy.md", ".env.example", "README.md", "docs/reference.md", "docs/plan.md"]) expect(read(f), f).not.toMatch(/규칙 기반|rule-based|rules-ko|mock 에이전트|mock 공급자|anthropic` \/ `mock|openai \| anthropic \| mock/);
  });

  it("키 없는 컨테이너 확인: 저장소 .env와 셸의 키를 넘기지 않고 확인용 호스트 포트(기본 8500·8510·8530)에 띄운다", () => {
    const s = read("scripts/container-smoke.ts");
    expect(s).toContain('"--env-file", envFile');
    expect(s).toContain("(KEY|TOKEN|SECRET)$");
    // compose가 서비스에 넘기는 이름은 셸 값을 쓰지 않고, 실제 compose 설정에서 키가 그 키를 쓰는 서비스에만 가는지 본다
    expect(s).toContain("!SERVICE_ENV.has(k)");
    expect(s).toContain('"--profile", "gpu", "--profile", "check", "config", "--format", "json"');
    expect(s).toContain("KEY_OWNERS");
    expect(s).toContain("NOONCHI_PORT: String(PORTS.hub)");
    expect(s).toContain("NOONCHI_PHONE_PORT: String(PORTS.phone)");
    expect(s).toContain('"down", "-v"');
    expect(s).toContain("PAM_HOST_PORT: String(PORTS.pam)");
  });

  it("키 없는 컨테이너 확인: 모델·PAM LLM·에이전트를 모두 가짜 서버에 붙이고 ready.ok와 에이전트 답을 본다", () => {
    const s = read("scripts/container-smoke.ts");
    expect(s).toContain('"--profile", "check"');
    for (const k of ["VLM_BASE_URL", "PAM_LLM_BASE_URL", "OPENAI_BASE_URL"]) expect(s).toContain(`${k}: "http://fake-openai:8500/v1"`);
    expect(s).toContain('INFERENCE_MODE: "vllm"');
    expect(s).not.toMatch(/PAM_URL:/);
    expect(s).toContain("ready.ok");
    expect(s).toContain("/api/agent/chat");
    expect(s).toContain("가짜 답");
    // 이 PC의 일시 EFAULT: 호스트 요청은 fetchRetry, 포트 열기 실패는 내리고 다시 띄우고, 멈춘 요청이 있어도 down -v까지 간다
    expect(s).not.toMatch(/\bawait fetch\(/);
    expect(s).toContain("invalid pointer address");
    expect(s).toContain("clearInterval(keepAlive)");
  });

  it("키 없는 컨테이너 확인: 폰 화면 HTML만이 아니라 그 script·link 파일과 인코딩 워커까지 200인지 본다", () => {
    const s = read("scripts/container-smoke.ts");
    expect(s).toContain("phoneAssetFailures(PHONE_URL");
    expect(s).not.toContain("fetchRetry(`${PHONE_URL}/phone/`");
  });

  it("키 없는 컨테이너 확인: /api/health 폰 주소가 PHONE_URL 하나뿐인지(컨테이너 안 주소 없음) 본다", () => {
    const s = read("scripts/container-smoke.ts");
    expect(s).toContain('PHONE_URL: CHECK_PHONE_URL');
    expect(s).toContain("JSON.stringify(h.phone_urls) !== JSON.stringify([CHECK_PHONE_URL])");
  });

  it("키 없는 컨테이너 확인: 관찰 흐름을 켜고 엔진 프레임 한 장의 vlm 줄을 기록 API로 본다", () => {
    const s = read("scripts/container-smoke.ts");
    expect(s).toContain('BRAIN: "1"');
    expect(s).toContain('kind: "engine"');
    expect(s).toContain("/api/history?kinds=vlm");
  });

  it("키 없는 컨테이너 확인: 이미지 안 YOLO26s·관절 모델이 떠서 분석했는지, 호스트에서 보낸 계획이 토큰으로만 들어가는지 본다", () => {
    const s = read("scripts/container-smoke.ts");
    expect(s).toContain("/api/brain");
    expect(s).toContain('detector !== "yolo26s-seg"');
    expect(s).toContain('pose !== "yolo26n-pose"');
    expect(s).toContain("detected");
    expect(s).toContain("/api/plan");
    expect(s).toContain("planNoToken !== 403 || planToken !== 200");
    // YOLO가 돈 뒤 멈춘 컨테이너에 onnxruntime 원격 측정 파일(~/.cache/Microsoft/DeveloperTools/.onnxruntime)이 없는지 docker diff로 본다
    expect(s).toContain('["diff", id]');
    expect(s).toContain("DeveloperTools");
  });

  it(".env.example에 PAM 서비스 설정 자리가 있다", () => {
    const keys = read(".env.example").split(/\r?\n/).map((l) => /^#?\s*([A-Z0-9_]+)=/.exec(l)?.[1]).filter(Boolean);
    for (const k of ["OPENROUTER_API_KEY", "PAM_LLM_BASE_URL", "PAM_LLM_MODEL", "PAM_LLM_API_KEY", "PAM_HOST_PORT"]) expect(keys, k).toContain(k);
  });

  it("배포 문서 3절이 .env에 넣으라는 이름은 모두 .env.example에 있고, 관찰 흐름은 켜져 있다", () => {
    const example = read(".env.example");
    const keys = example.split(/\r?\n/).map((l) => /^#?\s*([A-Z0-9_]+)=/.exec(l)?.[1]).filter(Boolean);
    const d = read("docs/deploy.md");
    const table = d.slice(d.indexOf("## 3."), d.indexOf("## 4.")).split(/\r?\n/).filter((l) => l.startsWith("| `"));
    const named = table.flatMap((l) => [...l.split("|")[1]!.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1]!));
    expect(named.length).toBeGreaterThan(5);
    for (const k of named) expect(keys, k).toContain(k);
    expect(example).toMatch(/^BRAIN=1$/m);
  });
});
