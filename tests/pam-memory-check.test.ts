// 기억 뜻 검사(LLM, src/brain/pam/memoryCheck.ts): 상태가 사람이 하는 일인지·조건이 사람 쪽 사실만인지·합칠 상태가 있는지 PAM LLM에 묻는다.
// 답은 엄격한 JSON(ok는 항목이 모두 통과일 때만 참)이고, 부르는 길은 판단·반성과 같은 PAM LLM 통로다(같은 가짜 서버 자리).
import { afterEach, describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY } from "../src/brain/decision.js";
import { candidateFsmOf } from "../src/brain/pam/adopt.js";
import { parseVerdict } from "../src/brain/pam/memoryCheck.js";
import { pamClientFor, startFakePamLlm, type FakePamLlm } from "./helpers/pam.js";

let pam: FakePamLlm | undefined;
afterEach(async () => { await pam?.close(); pam = undefined; });

describe("기억 뜻 검사(LLM)", () => {
  it("엄격한 JSON만 받는다: ok는 항목이 모두 통과일 때만 참이다", () => {
    expect(parseVerdict(JSON.stringify({ ok: true, items: [{ kind: "state", ref: "drinking", ok: true, why: "마시는 일" }] }))).toEqual({ ok: true, items: [{ kind: "state", ref: "drinking", ok: true, why: "마시는 일" }] });
    expect(() => parseVerdict(JSON.stringify({ ok: true, items: [{ kind: "state", ref: "left_cup", ok: false, why: "물건 상황" }] }))).toThrow(/ok/);
    expect(() => parseVerdict("```json\n{}\n```")).toThrow();
    expect(() => parseVerdict(JSON.stringify({ ok: true, items: [], extra: 1 }))).toThrow(/incorrect fields/);
  });
  it("PAM LLM 통로로 부르고(같은 가짜 서버), 기억 JSON을 넘긴다", async () => {
    pam = await startFakePamLlm({ check: (v) => ({ ok: v.memory.states.every((s: { id: string }) => s.id !== "left_cup"), items: [] }) });
    const verdict = await pamClientFor(pam).checkMemory(candidateFsmOf(CUP_FSM_MEMORY));
    expect(verdict.ok).toBe(true);
    expect(pam.bodies.at(-1)).toMatchObject({ role: "check", memory: candidateFsmOf(CUP_FSM_MEMORY) });
  });
  it("답이 틀리면(읽을 수 없음) 거절 판정이다", async () => {
    pam = await startFakePamLlm({ check: () => "아니요" });
    expect(await pamClientFor(pam).checkMemory(candidateFsmOf(CUP_FSM_MEMORY))).toEqual({ ok: false, items: [{ kind: "state", ref: "*", ok: false, why: "검사 답을 읽을 수 없음" }] });
  });
});
