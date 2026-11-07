// mock과 live는 같은 코드 경로다: 같은 클래스·같은 요청 순서, 다른 것은 주소·모델 이름·제공자 요청 칸뿐이다.
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
  it("두 모드의 차이는 VLM 주소·모델·키·제공자 칸뿐이다", () => {
    const a = loadEndpoints({ INFERENCE_MODE: "mock" });
    const b = loadEndpoints({ INFERENCE_MODE: "live" });
    expect({ ...a, mode: "", vlm: {} }).toEqual({ ...b, mode: "", vlm: {} });
    expect(Object.keys(a.vlm)).toEqual(Object.keys(b.vlm));
  });

  it("INFERENCE_MODE는 src/infer/endpoints.ts만 읽고, src에 가짜 모드 분기가 없다", () => {
    for (const p of walk(SRC).filter((x) => /\.tsx?$/.test(x))) {
      const t = readFileSync(p, "utf8");
      if (!p.endsWith(join("infer", "endpoints.ts"))) expect(t, p).not.toMatch(/INFERENCE_MODE|endpoints\.mode|inferenceMode/);
      expect(t, p).not.toMatch(/class \w*(Mock|Scripted|Fake)(Decision|Perceiver|Detector|Vlm|Pam)\b/);
    }
  });

  it("두 모드가 같은 가짜 주소 자리에 같은 순서로 요청한다", async () => {
    f = await startFakeOpenAI({ reply: () => '{"a":1}' });
    const paths: string[][] = [];
    const bodies: string[][] = [];
    for (const mode of ["mock", "live"]) {
      const before = f.requests.length;
      const { vlm } = createInference({ INFERENCE_MODE: mode, VLM_BASE_URL: `${f.url}/v1` });
      const r = await vlm.json({ prompt: "p", images: [Buffer.from([0xff, 0xd8])], schema: { name: "s", schema: {} }, parse: JSON.parse });
      expect(r.value, mode).toEqual({ a: 1 });
      paths.push(f.requests.slice(before).map((q) => `${q.method} ${q.path}`));
      bodies.push(f.requests.slice(before).flatMap((q) => Object.keys(q.body ?? {}).sort()));
    }
    expect(paths[0]).toEqual(paths[1]);
    // mock만 OpenAI 제공자 칸(reasoning_effort)을 더 보낸다
    expect(bodies[0]!.filter((k) => !bodies[1]!.includes(k))).toEqual(["reasoning_effort"]);
    expect(bodies[1]!.filter((k) => !bodies[0]!.includes(k))).toEqual([]);
  });
});
