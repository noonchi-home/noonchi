// openai와 vllm은 같은 코드 경로다: 같은 클래스·같은 요청 순서, 다른 것은 주소·모델 이름·제공자 요청 칸뿐이다.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { loadEndpoints } from "../src/infer/endpoints.js";
import { createInference } from "../src/infer/inference.js";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
let f: FakeServer | undefined;
afterEach(async () => { await f?.close(); f = undefined; });

describe("같은 구조", () => {
  it("두 모드의 차이는 VLM·PAM LLM 주소·모델·키·제공자 칸뿐이다", () => {
    const a = loadEndpoints({ INFERENCE_MODE: "openai" });
    const b = loadEndpoints({ INFERENCE_MODE: "vllm" });
    expect({ ...a, mode: "", vlm: {}, pam: {} }).toEqual({ ...b, mode: "", vlm: {}, pam: {} });
    expect(Object.keys(a.vlm)).toEqual(Object.keys(b.vlm));
    expect(Object.keys(a.pam)).toEqual(Object.keys(b.pam));
  });

  it("INFERENCE_MODE는 src/infer/endpoints.ts만 읽고, src에 가짜 모드 분기가 없다", () => {
    for (const p of walk(SRC).filter((x) => /\.tsx?$/.test(x))) {
      const t = readFileSync(p, "utf8");
      if (!p.endsWith(join("infer", "endpoints.ts"))) expect(t, p).not.toMatch(/INFERENCE_MODE|endpoints\.mode|inferenceMode/);
      // 에이전트도 같다: 규칙 기반·가짜 공급자를 두지 않고 늘 실제 공급자(openai·anthropic)를 부른다. 시험은 가짜 서버를 OPENAI_BASE_URL에 붙인다
      expect(t, p).not.toMatch(/class \w*(Mock|Scripted|Fake|Rule)\w*(Decision|Perceiver|Detector|Vlm|Pam|Provider|Agent|Llm)\b/);
    }
  });

  it("src에 규칙으로 행동 계획을 만드는 코드가 없다: PAM 행동의 계획은 에이전트 계획 모드(src/agent/planner.ts)만 만든다", () => {
    for (const p of walk(SRC).filter((x) => /\.tsx?$/.test(x))) {
      // 예전 서버의 컵·질문 계획 규칙(cupPlan·askPlan·planFor)은 tests/helpers/cup-plan.ts에 모양으로만 남는다
      expect(readFileSync(p, "utf8"), p).not.toMatch(/(cupPlan|askPlan|planFor)/);
    }
  });

  it("두 모드가 같은 가짜 주소 자리에 같은 순서로 요청한다", async () => {
    f = await startFakeOpenAI({ reply: () => '{"a":1}' });
    const paths: string[][] = [];
    const bodies: string[][] = [];
    for (const mode of ["openai", "vllm"]) {
      const before = f.requests.length;
      const { vlm } = createInference({ INFERENCE_MODE: mode, VLM_BASE_URL: `${f.url}/v1` });
      const r = await vlm.json({ prompt: "p", images: [Buffer.from([0xff, 0xd8])], schema: { name: "s", schema: {} }, parse: JSON.parse });
      expect(r.value, mode).toEqual({ a: 1 });
      paths.push(f.requests.slice(before).map((q) => `${q.method} ${q.path}`));
      bodies.push(f.requests.slice(before).flatMap((q) => Object.keys(q.body ?? {}).sort()));
    }
    expect(paths[0]).toEqual(paths[1]);
    // openai만 OpenAI 제공자 칸(reasoning_effort)을 더 보낸다
    expect(bodies[0]!.filter((k) => !bodies[1]!.includes(k))).toEqual(["reasoning_effort"]);
    expect(bodies[1]!.filter((k) => !bodies[0]!.includes(k))).toEqual([]);
  });
});
