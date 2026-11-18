// 덩어리 기록·시각 찾기 답 검사(src/brain/pam/marks.ts): 석준 님 pam/contracts.py validate_chunks·validate_marks 경우를 그대로(오류 글도 같다).
import { afterEach, describe, expect, it } from "vitest";
import { validateChunks, validateMarks } from "../src/brain/pam/marks.js";
import { estimateTokens, type PamMessage } from "../src/brain/pam/index.js";
import { pamClientFor, startFakePamLlm, type FakePamLlm, type MarkView } from "./helpers/pam.js";

let pam: FakePamLlm | undefined;
afterEach(async () => { await pam?.close(); pam = undefined; });

describe("덩어리·시각 찾기 답 검사(석준 님 validate_chunks·validate_marks)", () => {
  it("덩어리는 시각 순서로 겹치지 않고 기록 줄의 시각만, 시각 찾기는 물은 것을 꼭 한 번씩 답한다", () => {
    expect(() => validateChunks({ chunks: [{ start: "07:00:02", end: "07:00:00", text: "x" }] })).toThrow(/end must not come before start/);
    expect(() => validateChunks({ chunks: [{ start: "07:00:01", end: "07:00:03", text: "x" }] }, ["07:00:00", "07:00:10", 2])).toThrow(/not the time of a line/);
    expect(() => validateMarks({ candidates: [], actions: [], unseen: [] }, [["drinking", "c"]], [])).toThrow(/answer every asked candidate exactly once/);
  });
  it("겹친 덩어리·빈 덩어리·틀린 시각 꼴·물은 행동 빠짐·안 보인 구간 거꾸로는 거절하고, 맞는 답은 그대로 받는다", () => {
    expect(() => validateChunks({ chunks: [] })).toThrow(/at least one chunk is required/);
    expect(() => validateChunks({ chunks: [{ start: "07:00:00", end: "07:00:04", text: "a" }, { start: "07:00:04", end: "07:00:08", text: "b" }] })).toThrow(/without overlapping/);
    expect(() => validateChunks({ chunks: [{ start: "7:00", end: "07:00:04", text: "a" }] })).toThrow(/expected a time as HH:MM:SS/);
    // 이 저장소 기록은 줄 사이가 고르지 않아 줄 시각 목록으로도 받는다
    const lines = ["07:00:00", "07:00:03", "07:01:30"];
    expect(validateChunks({ chunks: [{ start: "07:00:00", end: "07:00:03", text: "a" }, { start: "07:01:30", end: "07:01:30", text: "b" }] }, lines).chunks).toHaveLength(2);
    expect(() => validateChunks({ chunks: [{ start: "07:00:01", end: "07:00:03", text: "a" }] }, lines)).toThrow(/not the time of a line/);
    const ok = { candidates: [{ state: "drinking", candidate: "c", times: ["07:00:03"] }], actions: [{ action: "컵 치우기", times: [] }], unseen: [{ start: "07:00:03", end: "07:01:30" }] };
    expect(validateMarks(ok, [["drinking", "c"]], ["컵 치우기"], lines)).toEqual(ok);
    expect(() => validateMarks({ ...ok, actions: [] }, [["drinking", "c"]], ["컵 치우기"], lines)).toThrow(/answer every asked action exactly once/);
    expect(() => validateMarks({ ...ok, unseen: [{ start: "07:01:30", end: "07:00:03" }] }, [["drinking", "c"]], ["컵 치우기"], lines)).toThrow(/end must not come before start/);
    expect(() => validateMarks({ ...ok, extra: 1 }, [["drinking", "c"]], ["컵 치우기"])).toThrow(/incorrect fields/);
  });
});

// Codex(1b07d3e2 P2): 시각 찾기가 하루 기록 줄 전체를 한 요청에 넣어 문맥 길이를 넘으면 밤 흐름이 실패했다
describe("시각 찾기 나눠 묻기", () => {
  it("요청이 문맥 길이를 넘으면 기록 줄을 차례대로 나눠 여러 번 묻고(요청마다 한도 안, 그 줄 구간에 걸친 덩어리만), 답의 시각을 합친다", async () => {
    const hms = (s: number) => new Date(s * 1000).toISOString().substring(11, 19);
    const lines = Array.from({ length: 1200 }, (_, i) => `${hms(7 * 3600 + i * 10)} | ${i % 100 === 99 ? "사람 안 보임" : "사람이 식탁 옆에서 컵을 들고 천천히 마시는 중이다"}`);
    const chunks = Array.from({ length: 12 }, (_, k) => `${hms(7 * 3600 + k * 1000)}~${hms(7 * 3600 + k * 1000 + 990)} [drinking] 식탁에서 마시는 중`);
    const leaves = (v: { lines: string[] }) => v.lines.filter((l) => l.endsWith("| 사람 안 보임")).map((l) => l.substring(0, 8));
    pam = await startFakePamLlm({ mark: (v) => ({ candidates: v.candidates.map(([state, candidate]) => ({ state, candidate, times: leaves(v) })), actions: v.actions.map((action) => ({ action, times: [] })),
      unseen: leaves(v).map((t) => ({ start: t, end: t })) }) });
    const marks = await pamClientFor(pam).mark({ states: [{ id: "drinking", description: "마시는 중" }, { id: "away", description: "안 보임" }],
      candidates: [{ state: "drinking", candidate: { on: "떠난다." } }], actions: ["컵 치우기"], lines, chunks });
    const asked = pam.bodies.filter((b): b is MarkView => b.role === "mark");
    expect(asked.length).toBeGreaterThan(1);
    expect(asked.flatMap((b) => b.lines)).toEqual(lines);
    for (const [i, b] of asked.entries()) {
      const first = b.lines[0]!.substring(0, 8), last = b.lines.at(-1)!.substring(0, 8);
      expect(b.chunks).toEqual(chunks.filter((c) => c.substring(0, 8) <= last && c.substring(9, 17) >= first));
      const messages = (pam.requests.filter((r) => JSON.stringify(r).includes("Actions to find"))[i]!.messages) as PamMessage[];
      expect(estimateTokens(messages) + 16_384).toBeLessThanOrEqual(32_768);
    }
    const all = leaves({ lines });
    expect(marks).toEqual({ candidates: [{ state: "drinking", candidate: "떠난다.", times: all }], actions: [{ action: "컵 치우기", times: [] }], unseen: all.map((t) => ({ start: t, end: t })) });
  });
});
