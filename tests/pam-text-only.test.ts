// PAM에는 사진을 넘기지 않는다: 계약 타입에 사진 칸이 없고, 사진 칸이 든 요청은 LLM에 보내기 전에 막힌다(PamRequestError).
import { afterEach, describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY, CUP_TASKS } from "../src/brain/decision.js";
import { assertTextOnly, PamRequestError } from "../src/brain/pam/index.js";
import type { PamPredictRequest, PamReflectRequest } from "../src/contract/pam.js";
import { pamClientFor, startFakePamLlm, type FakePamLlm } from "./helpers/pam.js";

let pam: FakePamLlm | undefined;
afterEach(async () => { await pam?.close(); pam = undefined; });

describe("사진 없는 PAM", () => {
  it("계약 타입에 사진 칸을 넣으면 타입 검사가 실패한다", () => {
    const ok: PamPredictRequest = { contract: "pam-predict/2", final_time: "2026-11-07T21:00:08.000+09:00", observation_text: "t", memory_kind: "fsm", memory: {}, tasks: ["a"] };
    // @ts-expect-error 사진 칸은 계약에 없다
    const bad: PamPredictRequest = { ...ok, frames: [{ image: { base64: "AAAA" } }] };
    const reflect: PamReflectRequest = { contract: "pam-reflect/2", day: "2026-11-07", memory_kind: "fsm", memory: {}, observation_text: "t", action_summary: "a", feedback: null };
    // @ts-expect-error 반성 계약에도 사진 칸이 없다
    const badReflect: PamReflectRequest = { ...reflect, images: ["data:image/jpeg;base64,AAAA"] };
    expect(bad && badReflect).toBeTruthy();
  });

  it("사진 칸·data:image 값이 든 본문은 보내기 전에 막힌다", () => {
    expect(() => assertTextOnly({ evidence: [{ image: { base64: "A" } }] })).toThrow(/사진/);
    expect(() => assertTextOnly({ observation_text: "data:image/jpeg;base64,AAAA" })).toThrow(/사진/);
    expect(() => assertTextOnly({ a: { b: [{ image_url: "x" }] } })).toThrow(/body\.a\.b\[0\]\.image_url/);
    expect(() => assertTextOnly({ observation_text: "컵이 식탁 위" })).not.toThrow();
  });

  it("사진 칸이 든 요청은 LLM으로 나가지 않는다", async () => {
    pam = await startFakePamLlm();
    const client = pamClientFor(pam);
    const bad = { final_time: "2026-11-07T21:00:08.000+09:00", observation_text: "x", memory_kind: "fsm" as const, memory: CUP_FSM_MEMORY, tasks: [...CUP_TASKS], frames: [] };
    await expect(client.predict(bad)).rejects.toThrow(/사진/);
    await expect(client.predict(bad)).rejects.toBeInstanceOf(PamRequestError);
    expect(pam.requests).toHaveLength(0);
  });

  it("PAM LLM으로 실제로 나간 본문에 사진이 없고 관찰 텍스트가 든다", async () => {
    pam = await startFakePamLlm({ predict: () => ({ observation: "o", reasoning: "r", task_index: 0 }) });
    const p = await pamClientFor(pam).predict({ final_time: "2026-11-07T21:00:08.000+09:00", observation_text: "21:00:00 사람 보임", memory_kind: "fsm", memory: CUP_FSM_MEMORY, tasks: [...CUP_TASKS] });
    expect(p.task_index).toBe(0);
    const sent = JSON.stringify(pam.requests.at(-1));
    expect(sent).not.toMatch(/data:image|base64|"image_url"|"type":"image/);
    expect(sent).toContain("21:00:00 사람 보임");
    expect(pam.bodies.at(-1)).toMatchObject({ role: "predict", observation_text: "21:00:00 사람 보임" });
  });
});
