// 덩어리 기록·시각 찾기 답 검사(src/brain/pam/marks.ts): 석준 님 pam/contracts.py validate_chunks·validate_marks 경우를 그대로(오류 글도 같다).
import { afterEach, describe, expect, it } from "vitest";
import { validateChunks, validateMarks } from "../src/brain/pam/marks.js";
import { estimateTokens, type PamMessage } from "../src/brain/pam/index.js";
import { mergeMarks } from "../src/brain/pam/client.js";
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
    // 조각은 기록 줄의 이어진 일부이고 모두 합치면 기록 전체다. 뒤 조각은 새로 맡은 첫 줄 앞 검사 창(300초)의 줄도 함께 받는다(Codex 81d209ef P2)
    const sec = (l: string) => { const [h, m, x] = l.substring(0, 8).split(":").map(Number); return h! * 3600 + m! * 60 + x!; };
    for (const b of asked) expect(lines.slice(lines.indexOf(b.lines[0]!), lines.indexOf(b.lines[0]!) + b.lines.length)).toEqual(b.lines);
    expect(new Set(asked.flatMap((b) => b.lines)).size).toBe(lines.length);
    let seen = new Set<string>();
    for (const b of asked) {
      const fresh = b.lines.find((l) => !seen.has(l))!;
      if (seen.size) expect(b.lines.filter((l) => sec(l) < sec(fresh))).toEqual(lines.filter((l) => sec(l) >= sec(fresh) - 300 && sec(l) < sec(fresh)));
      seen = new Set([...seen, ...b.lines]);
    }
    for (const [i, b] of asked.entries()) {
      const first = b.lines[0]!.substring(0, 8), last = b.lines.at(-1)!.substring(0, 8);
      expect(b.chunks).toEqual(chunks.filter((c) => c.substring(0, 8) <= last && c.substring(9, 17) >= first));
      const messages = (pam.requests.filter((r) => JSON.stringify(r).includes("Actions to find"))[i]!.messages) as PamMessage[];
      expect(estimateTokens(messages) + 16_384).toBeLessThanOrEqual(32_768);
    }
    const all = leaves({ lines });
    expect(marks).toEqual({ candidates: [{ state: "drinking", candidate: "떠난다.", times: all }], actions: [{ action: "컵 치우기", times: [] }], unseen: all.map((t) => ({ start: t, end: t })) });
  });

  it("걷기 시작 줄과 행동을 마친 줄이 조각 경계를 넘어도 뒤 조각이 시작 줄을 함께 받아 그 행동을 시작 줄 시각으로 찾는다", async () => {
    const hms = (s: number) => new Date(s * 1000).toISOString().substring(11, 19);
    // 50줄마다 걷기 시작(45번째)과 100초 뒤 컵을 싱크대에 넣음(55번째)
    const lines = Array.from({ length: 1200 }, (_, i) => `${hms(7 * 3600 + i * 10)} | ${i % 50 === 45 ? "사람이 일어나 싱크대 쪽으로 걸어가기 시작한다" : i % 50 === 5 && i > 5 ? "사람이 컵을 싱크대에 넣는다" : "사람이 식탁 옆에서 컵을 들고 천천히 마시는 중이다"}`);
    const starts = lines.filter((l) => l.endsWith("걸어가기 시작한다")).map((l) => l.substring(0, 8)).filter((t) => lines.some((l) => l.endsWith("싱크대에 넣는다") && l > t));
    // 시험 모델: 넣은 줄과 그 앞 걷기 시작 줄이 한 요청에 다 있을 때만 그 행동을 시작 줄 시각으로 답한다
    const sec = (l: string) => { const [h, m, x] = l.substring(0, 8).split(":").map(Number); return h! * 3600 + m! * 60 + x!; };
    pam = await startFakePamLlm({ mark: (v) => {
      const has = new Set(v.lines.map((l) => l.substring(0, 8)));
      const found = v.lines.filter((l) => l.endsWith("싱크대에 넣는다")).map((l) => hms(sec(l) - 100)).filter((t) => has.has(t));
      return { candidates: [], actions: v.actions.map((action) => ({ action, times: found })), unseen: [] };
    } });
    const marks = await pamClientFor(pam).mark({ states: [{ id: "drinking", description: "마시는 중" }], candidates: [], actions: ["컵 치우기"], lines, chunks: [] });
    expect(pam.bodies.filter((b) => b.role === "mark").length).toBeGreaterThan(1);
    expect(marks.actions).toEqual([{ action: "컵 치우기", times: starts }]);
  });

  it("조각 답을 합칠 때 다른 조각이 같은 후보·행동을 10초 안에 다시 답했으면 한 번으로 센다(앞 시각). 한 조각 안의 답과 10초 넘게 떨어진 답은 그대로, 같은 안 보인 구간은 하나다", () => {
    const part = (c: string[], a: string[], u: [string, string][]) => ({ candidates: [{ state: "watching_tv", candidate: "TV를 켠다.", times: c }], actions: [{ action: "에어컨 켜기", times: a }], unseen: u.map(([start, end]) => ({ start, end })) });
    expect(mergeMarks([part(["08:00:00", "08:00:05"], ["09:00:00"], [["07:00:00", "07:10:00"]]), part(["08:00:07", "08:30:00"], ["09:00:10", "09:00:11"], [["07:00:00", "07:10:00"], ["10:00:00", "10:00:00"]])]))
      .toEqual(part(["08:00:00", "08:00:05", "08:30:00"], ["09:00:00", "09:00:11"], [["07:00:00", "07:10:00"], ["10:00:00", "10:00:00"]]));
    const one = part(["08:00:00", "08:00:05"], [], []);
    expect(mergeMarks([one])).toEqual(one);
  });
});
