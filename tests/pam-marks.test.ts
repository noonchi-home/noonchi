// 시각 찾기 답 검사(src/brain/pam/marks.ts): 석준 님 pam/contracts.py validate_marks 경우를 그대로(오류 글도 같다). 덩어리 기록 검사는 2026-11-25에 뺐다.
import { afterEach, describe, expect, it } from "vitest";
import { validateMarks } from "../src/brain/pam/marks.js";
import { estimateTokens, PamBudgetError, type PamMessage } from "../src/brain/pam/index.js";
import { MARK_MAX_REQUESTS } from "../src/brain/pam/client.js";
import { pamClientFor, startFakePamLlm, type FakePamLlm, type MarkView } from "./helpers/pam.js";

let pam: FakePamLlm | undefined;
afterEach(async () => { await pam?.close(); pam = undefined; });

describe("시각 찾기 답 검사(석준 님 validate_marks)", () => {
  it("시각 찾기는 물은 것을 꼭 한 번씩 답한다", () => {
    expect(() => validateMarks({ candidates: [], actions: [], unseen: [] }, [["drinking", "c"]], [])).toThrow(/answer every asked candidate exactly once/);
  });
  it("물은 행동 빠짐·안 보인 구간 거꾸로·틀린 시각은 거절하고, 맞는 답은 그대로 받는다", () => {
    // 이 저장소 기록은 줄 사이가 고르지 않아 줄 시각 목록으로도 받는다
    const lines = ["07:00:00", "07:00:03", "07:01:30"];
    expect(() => validateMarks({ candidates: [{ state: "drinking", candidate: "c", times: ["07:00:01"] }], actions: [{ action: "컵 치우기", times: [] }], unseen: [] }, [["drinking", "c"]], ["컵 치우기"], lines)).toThrow(/not the time of a line/);
    expect(() => validateMarks({ candidates: [{ state: "drinking", candidate: "c", times: ["7:00"] }], actions: [{ action: "컵 치우기", times: [] }], unseen: [] }, [["drinking", "c"]], ["컵 치우기"])).toThrow(/expected a time as HH:MM:SS/);
    const ok = { candidates: [{ state: "drinking", candidate: "c", times: ["07:00:03"] }], actions: [{ action: "컵 치우기", times: [] }], unseen: [{ start: "07:00:03", end: "07:01:30" }] };
    expect(validateMarks(ok, [["drinking", "c"]], ["컵 치우기"], lines)).toEqual(ok);
    expect(() => validateMarks({ ...ok, actions: [] }, [["drinking", "c"]], ["컵 치우기"], lines)).toThrow(/answer every asked action exactly once/);
    expect(() => validateMarks({ ...ok, unseen: [{ start: "07:01:30", end: "07:00:03" }] }, [["drinking", "c"]], ["컵 치우기"], lines)).toThrow(/end must not come before start/);
    expect(() => validateMarks({ ...ok, extra: 1 }, [["drinking", "c"]], ["컵 치우기"])).toThrow(/incorrect fields/);
  });
});

// Codex(1b07d3e2 P2): 시각 찾기가 하루 기록 줄 전체를 한 요청에 넣어 문맥 길이를 넘으면 밤 흐름이 실패했다
// 시각 찾기 나눠 묻기(Codex 1b07d3e2·81d209ef·be8a98c0): 하루 기록을 겹치지 않는 맡은 구간으로 나누고, 조각은 앞뒤 검사 창(300초)의 맥락 줄을 함께 받는다.
// 답은 시각이 맡은 구간 안인 것만 남긴다(맥락의 답은 그 구간을 맡은 이웃 조각이 남긴다). 그래서 따로 일어난 행동은 둘 다 남고, 끝 후보 시각도 모델 답 그대로다
describe("시각 찾기 나눠 묻기", () => {
  const hms = (s: number) => new Date(s * 1000).toISOString().substring(11, 19);
  const sec = (l: string) => { const [h, m, x] = l.substring(0, 8).split(":").map(Number); return h! * 3600 + m! * 60 + x!; };
  /** 시험 모델: 받은 줄(맥락 포함)에서 끝(end)으로 끝나는 줄은 후보로, 행동 줄은 행동으로, 안 보임 줄은 그 한 줄짜리 안 보인 구간으로 모두 답한다. */
  const answerAll = (end: { cand: string; act: string; unseen: string }) => (v: MarkView) => {
    const at = (tail: string) => v.lines.filter((l) => l.endsWith(tail)).map((l) => l.substring(0, 8));
    return { candidates: v.candidates.map(([state, candidate]) => ({ state, candidate, times: at(end.cand) })), actions: v.actions.map((action) => ({ action, times: at(end.act) })),
      unseen: at(end.unseen).map((t) => ({ start: t, end: t })) };
  };
  const marks = () => pam!.bodies.filter((b): b is MarkView => b.role === "mark");

  it("요청이 문맥 길이를 넘으면 맡은 구간으로 나눠 여러 번 묻고(요청마다 한도 안, 앞뒤 300초 맥락 줄), 맡은 구간의 답만 남겨 한 번씩 센다", async () => {
    const lines = Array.from({ length: 1200 }, (_, i) => `${hms(7 * 3600 + i * 10)} | ${i % 100 === 99 ? "사람 안 보임" : "사람이 식탁 옆에서 컵을 들고 천천히 마시는 중이다"}`);
    pam = await startFakePamLlm({ mark: answerAll({ cand: "사람 안 보임", act: "없는 줄", unseen: "사람 안 보임" }) });
    const got = await pamClientFor(pam).mark({ states: [{ id: "drinking", description: "마시는 중" }, { id: "away", description: "안 보임" }],
      candidates: [{ state: "drinking", candidate: { on: "떠난다." } }], actions: ["컵 치우기"], lines });
    const asked = marks();
    expect(asked.length).toBeGreaterThan(1);
    expect(asked.length).toBeLessThanOrEqual(MARK_MAX_REQUESTS);
    for (const [i, b] of asked.entries()) {
      // 이어진 줄이고, 앞 조각과 겹치는 줄은 앞 맥락(300초 안)이다
      const at = lines.indexOf(b.lines[0]!);
      expect(lines.slice(at, at + b.lines.length)).toEqual(b.lines);
      const messages = (pam.requests.filter((r) => JSON.stringify(r).includes("Actions to find"))[i]!.messages) as PamMessage[];
      expect(estimateTokens(messages) + 16_384).toBeLessThanOrEqual(32_768);
      if (i > 0) {
        const prev = asked[i - 1]!;
        const own = b.lines.find((l) => sec(l) > sec(prev.lines.at(-1)!) - 300)!;
        expect(sec(b.lines[0]!)).toBeLessThan(sec(prev.lines.at(-1)!));
        expect(sec(own) - sec(b.lines[0]!)).toBeLessThanOrEqual(300);
      }
    }
    expect(new Set(asked.flatMap((b) => b.lines)).size).toBe(lines.length);
    const leaves = lines.filter((l) => l.endsWith("사람 안 보임")).map((l) => l.substring(0, 8));
    expect(got).toEqual({ candidates: [{ state: "drinking", candidate: "떠난다.", times: leaves }], actions: [{ action: "컵 치우기", times: [] }], unseen: leaves.map((t) => ({ start: t, end: t })) });
  });

  it("조각 경계 양쪽에서 5초 사이로 따로 일어난 두 행동은 둘 다 한 번씩 남는다(맥락으로 본 이웃 조각의 답은 남기지 않는다)", async () => {
    const base = Array.from({ length: 1200 }, (_, i) => ({ s: 7 * 3600 + i * 10, text: "사람이 식탁 옆에서 컵을 들고 천천히 마시는 중이다" }));
    // 첫 나눔 경계(base 600번 줄, 08:40:00) 바로 앞뒤에 컵을 하나씩 싱크대에 넣는다
    const two = [{ s: 7 * 3600 + 5995, text: "사람이 컵을 싱크대에 넣는다" }, { s: 7 * 3600 + 6005, text: "사람이 컵을 싱크대에 넣는다" }];
    const lines = [...base, ...two].sort((a, b) => a.s - b.s).map((x) => `${hms(x.s)} | ${x.text}`);
    pam = await startFakePamLlm({ mark: answerAll({ cand: "싱크대에 넣는다", act: "싱크대에 넣는다", unseen: "없는 줄" }) });
    const got = await pamClientFor(pam).mark({ states: [{ id: "drinking", description: "마시는 중" }], candidates: [{ state: "drinking", candidate: { on: "컵을 넣는다." } }], actions: ["컵 치우기"], lines });
    expect(marks().length).toBeGreaterThan(1);
    expect(marks().filter((b) => b.lines.some((l) => l.startsWith(hms(7 * 3600 + 5995)))).length).toBeGreaterThan(1);
    const times = two.map((x) => hms(x.s));
    expect(got.actions).toEqual([{ action: "컵 치우기", times }]);
    expect(got.candidates).toEqual([{ state: "drinking", candidate: "컵을 넣는다.", times }]);
  });

  it("걷기 시작 줄과 행동을 마친 줄이 조각 경계를 넘어도 시작 줄을 맡은 조각이 뒤 맥락으로 마친 줄을 보고 그 행동을 시작 줄 시각으로 한 번 찾는다", async () => {
    // 50줄마다 걷기 시작(45번째)과 100초 뒤 컵을 싱크대에 넣음(55번째)
    const lines = Array.from({ length: 1200 }, (_, i) => `${hms(7 * 3600 + i * 10)} | ${i % 50 === 45 ? "사람이 일어나 싱크대 쪽으로 걸어가기 시작한다" : i % 50 === 5 && i > 5 ? "사람이 컵을 싱크대에 넣는다" : "사람이 식탁 옆에서 컵을 들고 천천히 마시는 중이다"}`);
    const starts = lines.filter((l) => l.endsWith("걸어가기 시작한다")).map((l) => l.substring(0, 8)).filter((t) => lines.some((l) => l.endsWith("싱크대에 넣는다") && l > t));
    // 시험 모델: 넣은 줄과 그 100초 앞 걷기 시작 줄이 한 요청에 다 있을 때만 그 행동을 시작 줄 시각으로 답한다
    pam = await startFakePamLlm({ mark: (v) => {
      const has = new Set(v.lines.map((l) => l.substring(0, 8)));
      const found = v.lines.filter((l) => l.endsWith("싱크대에 넣는다")).map((l) => hms(sec(l) - 100)).filter((t) => has.has(t));
      return { candidates: [], actions: v.actions.map((action) => ({ action, times: found })), unseen: [] };
    } });
    const got = await pamClientFor(pam).mark({ states: [{ id: "drinking", description: "마시는 중" }], candidates: [], actions: ["컵 치우기"], lines });
    expect(marks().length).toBeGreaterThan(1);
    expect(got.actions).toEqual([{ action: "컵 치우기", times: starts }]);
  });

  it("300초 맥락만으로도 문맥 한도를 넘으면 맡은 구간이 한 줄(같은 초 줄 묶음)이 될 때까지 나누고 그다음 맥락을 줄여 맞춘다(로그 한 줄). 요청 수가 상한을 넘으면 묻기 전에 그날을 실패로 둔다", async () => {
    // 1초마다 한 줄, 줄마다 약 3.2KB: 20줄이 한 요청 한도(약 45KB)를 넘는다
    const long = "사람이 식탁 옆에서 컵을 들고 천천히 마시는 중이다 ".repeat(40);
    const few = Array.from({ length: 20 }, (_, i) => `${hms(7 * 3600 + i)} | ${long}${i}`);
    pam = await startFakePamLlm({ mark: (v) => ({ candidates: [], actions: v.actions.map((action) => ({ action, times: v.lines.map((l) => l.substring(0, 8)) })), unseen: [] }) });
    const logs: string[] = [];
    const got = await pamClientFor(pam).mark({ states: [{ id: "drinking", description: "마시는 중" }], candidates: [], actions: ["컵 치우기"], lines: few }, {}, (l) => logs.push(l));
    expect(marks().length).toBeLessThanOrEqual(MARK_MAX_REQUESTS);
    expect(got.actions).toEqual([{ action: "컵 치우기", times: few.map((l) => l.substring(0, 8)) }]);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => /맥락/.test(l))).toBe(true);
    // 줄이 많으면(맡은 구간 한 줄마다 한 요청) 상한을 넘으니 묻지 않고 PamBudgetError
    const before = marks().length;
    const many = Array.from({ length: MARK_MAX_REQUESTS * 3 }, (_, i) => `${hms(8 * 3600 + i)} | ${long}${i}`);
    await expect(pamClientFor(pam).mark({ states: [{ id: "drinking", description: "마시는 중" }], candidates: [], actions: ["컵 치우기"], lines: many })).rejects.toBeInstanceOf(PamBudgetError);
    expect(marks().length).toBe(before);
  });
});
