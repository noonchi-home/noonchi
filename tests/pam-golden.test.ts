// 옮기기 전 Python PAM이 만든 정답(tests/fixtures/pam-golden/out)과 TS 결과를 비교한다.
// 메시지는 바이트까지 같다(toMatchFileSnapshot). 프롬프트를 일부러 바꿨으면 `npx vitest run tests/pam-golden.test.ts -u`로 새 정답을 쓰고 차이를 본다.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adaptation, buildPredictMessages, buildReflectMessages, estimateTokens, pamLimits, parseMemory, parsePrediction, predictRequest, reflectRequest } from "../src/brain/pam/index.js";

const DIR = new URL("./fixtures/pam-golden/", import.meta.url);
const inputs = JSON.parse(readFileSync(new URL("inputs.json", DIR), "utf8"));
const out = (name: string) => JSON.parse(readFileSync(new URL(`out/${name}`, DIR), "utf8"));
const pretty = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const JSON_ERR = /^JSON syntax error at char \d+$/;
const norm = (e: string) => (JSON_ERR.test(e) ? "<json>" : e);
const MAX = { maxModelLen: 32768, maxTokens: { predictor: 2048, reflector: 16384 } };

async function sameFile(name: string, text: string) {
  expect(existsSync(new URL(`out/${name}`, DIR)), `정답 파일 ${name}`).toBe(true);
  await expect(text).toMatchFileSnapshot(`./fixtures/pam-golden/out/${name}`);
}

describe("Python과 같은 결과", () => {
  it("판단 메시지·토큰 추정", async () => {
    for (const c of inputs.predict) {
      const built = buildPredictMessages(predictRequest(c.request));
      await sameFile(`${c.id}.messages.json`, pretty(built));
      expect(estimateTokens(built.messages), c.id).toBe(out("tokens.json")[c.id]);
    }
  });

  it("반성 메시지·토큰 추정", async () => {
    for (const c of inputs.reflect) {
      const built = buildReflectMessages(reflectRequest(c.request));
      await sameFile(`${c.id}.messages.json`, pretty(built));
      expect(estimateTokens(built.messages), c.id).toBe(out("tokens.json")[c.id]);
    }
  });

  it("노닌치 바꾸기 적용 결과", () => {
    const want = out("adaptation.json") as Record<string, unknown>;
    for (const id of Object.keys(want)) expect(adaptation(id as never), id).toEqual(want[id]);
  });

  it("판단 답 검사(parse_prediction)", () => {
    const got = inputs.parse.map((c: { id: string; raw: string; tasks: string[] }) => {
      const r = parsePrediction(c.raw, c.tasks);
      return { id: c.id, result: { ...r, errors: r.errors.map(norm) } };
    });
    expect(got).toEqual(out("parse.json"));
  });

  it("반성 답 검사(parse_memory)", () => {
    const got = inputs.memory.map((c: { id: string; raw: string; kind: "list" | "fsm" }) => {
      const r = parseMemory(c.raw, c.kind);
      return r.ok ? { id: c.id, ok: true, memory: r.memory } : { id: c.id, ok: false, error: norm(r.error) };
    });
    expect(got).toEqual(out("memory.json"));
  });

  it("입력 한도(limits)", () => {
    const len = (env: Record<string, string>) => Number(env.PAM_MAX_MODEL_LEN?.trim() || 32768);
    const got = inputs.limits.map((env: Record<string, string>) => ({ env, limits: pamLimits({ ...MAX, maxModelLen: len(env) }) }));
    expect(got).toEqual(out("limits.json"));
  });
});
