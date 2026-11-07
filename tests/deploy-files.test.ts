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
    expect(c.services["vllm-pam"].depends_on).toEqual({ "vllm-vlm": { condition: "service_healthy" } });
    expect(Object.keys(c.volumes)).toEqual(expect.arrayContaining(["noonchi-data", "model-cache"]));
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
  });

  it("배포 문서: GPU 서버 크기·Tailscale 인증서·두 모드의 에이전트 키·두 모델 확인·호출량", () => {
    const d = read("docs/deploy.md");
    for (const s of ["g6e.2xlarge", "MagicDNS", "HTTPS Certificates", "tailscale serve --bg --https=443 http://127.0.0.1:8200", "tailscale serve --bg --https=8443 http://127.0.0.1:8210",
      "`ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY`", "curl -s http://127.0.0.1:8410/v1/models", "curl -s http://127.0.0.1:8420/v1/models", "3,600", "vllm/vllm-openai:v0.17.0"]) expect(d).toContain(s);
  });

  it("키 없는 컨테이너 확인: 저장소 .env와 셸의 키를 넘기지 않고 8500·8510에 띄운다", () => {
    const s = read("scripts/container-smoke.ts");
    expect(s).toContain('"--env-file", envFile');
    expect(s).toContain("NOONCHI_ENV_FILE: envFile");
    expect(s).toContain("(KEY|TOKEN|SECRET)$");
    expect(s).toContain('NOONCHI_PORT: "8500"');
    expect(s).toContain('NOONCHI_PHONE_PORT: "8510"');
    expect(s).toContain('"down", "-v"');
  });
});
