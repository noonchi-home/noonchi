// 배포 파일(Dockerfile·compose.yaml·.dockerignore·.env.example·키 없는 컨테이너 확인)이 배포 규칙을 지키는지 본다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { YOLOX_MODELS } from "../src/brain/detector.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("배포 파일", () => {
  it("Dockerfile: Node 22.15 이상 22.x, 운영 의존성만, 화면 빌드, 트윈 포함, YOLOX sha256 검사", () => {
    const d = read("Dockerfile");
    expect(d).toMatch(/node:22\.(1[5-9]|[2-9]\d)\.\d+-bookworm-slim/);
    expect(d).toContain("npm ci --omit=dev");
    expect(d).toContain("npm --prefix ui run build");
    expect(d).toContain("COPY twin twin");
    expect(d).toContain(YOLOX_MODELS.yolox_tiny.url);
    expect(d).toContain(YOLOX_MODELS.yolox_tiny.sha256);
    expect(d).toMatch(/sha256sum -c/);
    expect(d).toMatch(/USER node/);
    expect(d).toContain('CMD ["node", "--import", "tsx", "src/server/main.ts"]');
  });

  it("compose: 포트는 127.0.0.1만, gpu 프로필 vLLM 두 개(태그 고정·내건 이름·GPU 몫·캐시·차례로 뜸), 볼륨·env_file·상태 검사", () => {
    const c = parse(read("compose.yaml"), { merge: true }) as { services: Record<string, any>; volumes: Record<string, unknown> };
    for (const [name, s] of Object.entries(c.services)) {
      for (const p of s.ports ?? []) expect(String(p), name).toMatch(/^127\.0\.0\.1:/);
      expect(s.healthcheck, name).toBeTruthy();
    }
    expect(c.services.noonchi.env_file).toEqual([{ path: "${NOONCHI_ENV_FILE:-.env}", required: false }]);
    expect(c.services.noonchi.volumes).toContain("noonchi-data:/data");
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
    expect(pam.env_file).toEqual([{ path: "${NOONCHI_ENV_FILE:-.env}", required: false }]);
    expect(pam.profiles).toBeUndefined();
    expect(c.services.noonchi.environment.PAM_URL).toBe("http://pam:8300");
    expect(c.services.noonchi.depends_on).toEqual({ pam: { condition: "service_healthy" } });
    // 설정은 env_file에서 온다: environment에 ${X:-}를 두면 env_file 값을 덮는다
    for (const name of ["noonchi", "pam"]) for (const v of Object.values(c.services[name].environment ?? {})) expect(String(v), name).not.toContain("${");
    const fake = c.services["fake-openai"];
    expect(fake.profiles).toEqual(["check"]);
    expect(fake.image).toBe("noonchi:local");
    expect(fake.ports).toBeUndefined();
    expect(fake.command.join(" ")).toContain("scripts/fake-openai.ts --port 8500 --host 0.0.0.0");
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
      "`ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY`", "curl -s http://127.0.0.1:8410/v1/models", "curl -s http://127.0.0.1:8420/v1/models", "3,600", "vllm/vllm-openai:v0.17.0",
      "curl -s http://127.0.0.1:8300/health", "PAM_HOST_PORT", "`PAM_LLM_BASE_URL`", "fake-openai"]) expect(d).toContain(s);
    expect(d).not.toMatch(/\| `PAM_URL` \|/);
  });

  it("키 없는 컨테이너 확인: 저장소 .env와 셸의 키를 넘기지 않고 8500·8510에 띄운다", () => {
    const s = read("scripts/container-smoke.ts");
    expect(s).toContain('"--env-file", envFile');
    expect(s).toContain("NOONCHI_ENV_FILE: envFile");
    expect(s).toContain("(KEY|TOKEN|SECRET)$");
    expect(s).toContain('NOONCHI_PORT: "8500"');
    expect(s).toContain('NOONCHI_PHONE_PORT: "8510"');
    expect(s).toContain('"down", "-v"');
    expect(s).toContain('PAM_HOST_PORT: "8520"');
  });

  it("키 없는 컨테이너 확인: 모델·PAM LLM·에이전트를 모두 가짜 서버에 붙이고 ready.ok와 에이전트 답을 본다", () => {
    const s = read("scripts/container-smoke.ts");
    expect(s).toContain('"--profile", "check"');
    for (const k of ["VLM_BASE_URL", "PAM_LLM_BASE_URL", "OPENAI_BASE_URL"]) expect(s).toContain(`${k}: "http://fake-openai:8500/v1"`);
    expect(s).toContain('INFERENCE_MODE: "live"');
    expect(s).not.toMatch(/PAM_URL:/);
    expect(s).toContain("ready.ok");
    expect(s).toContain("/api/agent/chat");
    expect(s).toContain("가짜 답");
    // 이 PC의 일시 EFAULT: 호스트 요청은 fetchRetry, 포트 열기 실패는 내리고 다시 띄우고, 멈춘 요청이 있어도 down -v까지 간다
    expect(s).not.toMatch(/\bawait fetch\(/);
    expect(s).toContain("invalid pointer address");
    expect(s).toContain("clearInterval(keepAlive)");
  });

  it("키 없는 컨테이너 확인: 관찰 흐름을 켜고 엔진 프레임 한 장의 vlm 줄을 기록 API로 본다", () => {
    const s = read("scripts/container-smoke.ts");
    expect(s).toContain('BRAIN: "1"');
    expect(s).toContain('kind: "engine"');
    expect(s).toContain("/api/history?kinds=vlm");
  });

  it("키 없는 컨테이너 확인: 이미지 안 YOLOX가 떠서 분석했는지, 호스트에서 보낸 계획이 토큰으로만 들어가는지 본다", () => {
    const s = read("scripts/container-smoke.ts");
    expect(s).toContain("/api/brain");
    expect(s).toContain('detector !== "yolox_tiny"');
    expect(s).toContain("detected");
    expect(s).toContain("/api/plan");
    expect(s).toContain("planNoToken !== 403 || planToken !== 200");
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
