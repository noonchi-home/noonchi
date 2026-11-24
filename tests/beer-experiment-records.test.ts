// 간추린 합성 기록 생성기(scripts/beer-experiment-records.ts): 기록의 모양·줄 수와, 가짜 AI로 21밤을 차례로 돌렸을 때 규칙이 처음 생기는 밤.
// 계산(기준 0.01, 맥락 없음 → 하나 → 둘): 토요일 2번(낮 TV 반례 2번 포함)으로는 TV 시작 전체 T가 20 이하일 때 탈락((2/T)² ≥ 0.01)이고, 평일 기록이 쌓여 T=21이 되는 18번째 날 밤(금요일)에
// (2/21)² ≈ 0.0091로 처음 통과한다. 3번째 토요일 밤(T=22)은 (3/22)³ ≈ 0.0025, 다음 일요일 밤은 (3/23)³ ≈ 0.0022.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryDb } from "../src/brain/history/db.js";
import { dayLines, runNight, type NightResult } from "../src/brain/history/night.js";
import { BEER, BEER_CANDIDATES, CAN, beerRecords, fakeChunk, fakeMark, groundMark } from "../scripts/beer-experiment-records.js";
import { pamClientFor, startFakePamLlm, type FakePamLlm } from "./helpers/pam.js";

let pam: FakePamLlm | undefined;
afterEach(async () => { await pam?.close(); pam = undefined; });

describe("간추린 합성 기록 생성기", () => {
  it("21일: 월요일부터, 토요일 3번(맥주), 첫 두 토요일에만 낮 TV(맥주 없음). 같은 옵션이면 같은 기록이다", () => {
    const a = beerRecords(HistoryDb.open(":memory:")), b = beerRecords(HistoryDb.open(":memory:"));
    expect(a).toEqual(b);
    expect(a.days).toHaveLength(21);
    expect(a.days[0]).toBe("2026-10-12");
    expect(a.saturdays).toEqual(["2026-10-17", "2026-10-24", "2026-10-31"]);
    expect(a.daytimeSaturdays).toEqual(["2026-10-17", "2026-10-24"]);
  });
  it("저녁만 있는 날은 약 360~420줄, 낮 창이 있는 토요일은 그만큼 더 길다. 전체 8천 줄 안팎", () => {
    const db = HistoryDb.open(":memory:");
    const s = beerRecords(db);
    expect(s.linesByDay["2026-10-12"]).toBeGreaterThan(360);
    expect(s.linesByDay["2026-10-12"]).toBeLessThan(420);
    expect(s.linesByDay["2026-10-31"]).toBeLessThan(430);                                 // 맥주 있는 세 번째 토요일(낮 창 없음)
    expect(s.linesByDay["2026-10-17"]!).toBeGreaterThan(s.linesByDay["2026-10-12"]! + 100);   // 낮 창이 더해진 첫 토요일
    const total = Object.values(s.linesByDay).reduce((x, y) => x + y, 0);
    expect(total).toBeGreaterThan(7500);
    expect(total).toBeLessThan(9500);
  });
  it("줄 모양은 서버가 남기는 글이다: 사람 보임·사람 TV 보는 중·거실 TV 켜짐 · 카메라로 봄·VLM 영어 한 문장. 맥주는 TV를 켠 지 3분 안, 캔은 TV를 끈 지 1분 안이다", () => {
    const db = HistoryDb.open(":memory:");
    beerRecords(db);
    const sat = dayLines(db, "2026-10-31").map((l) => l.line);
    const sun = dayLines(db, "2026-11-01").map((l) => l.line);
    for (const text of ["사람 보임", "사람 TV 보는 중", "거실 TV 켜짐 · 카메라로 봄", "거실 TV 꺼짐 · 카메라로 봄", "사람 안 보임"]) expect(sat.some((l) => l.endsWith(` | ${text}`)), text).toBe(true);
    expect(sat.filter((l) => l.includes("| VLM: A person")).length).toBeGreaterThan(300);
    const timeOf = (lines: string[], text: string) => lines.find((l) => l.includes(text))!.substring(0, 8);
    expect(timeOf(sat, "takes out a beer can")).toBe("19:02:50");        // TV 켠 19:00:00 + 2분 50초
    expect(timeOf(sat, "puts the beer can into the sink")).toBe("20:31:00");
    expect(sun.some((l) => l.includes("beer"))).toBe(false);                 // 일요일에는 맥주가 없다
    expect(dayLines(db, "2026-10-12").some((l) => l.line.includes("beer"))).toBe(false);
  });
});

describe("합성 정답 표시(groundMark)", () => {
  it("Qwen이 쓴 문장을 합성 사건 시각으로 알아보고, 사람이 안 보인 구간은 TV를 끈 지 6분 뒤부터다", () => {
    const db = HistoryDb.open(":memory:");
    beerRecords(db);
    const sat = dayLines(db, "2026-10-31").map((l) => l.line), mon = dayLines(db, "2026-10-12").map((l) => l.line);
    const m = groundMark({ role: "mark", states: [], candidates: [["watching_tv", "TV 가 꺼진다"], ["watching_tv", "사람이 소파에서 일어나 냉장고로 간다"], ["away", "사용자가 돌아와 TV 를 본다."], ["watching_tv", "알 수 없는 문장"]], actions: [BEER, CAN], chunks: [], lines: sat });
    expect(m.candidates.map((c) => c.times)).toEqual([["20:30:02"], ["19:02:30"], ["19:00:05"], []]);
    expect(m.actions).toEqual([{ action: BEER, times: ["19:02:30"] }, { action: CAN, times: ["20:30:30"] }]);
    expect(m.unseen).toEqual([{ start: "20:36:00", end: "20:36:00" }]);
    expect(groundMark({ role: "mark", states: [], candidates: [], actions: [BEER], chunks: [], lines: mon }).actions[0]!.times).toEqual([]);
  });
});

describe("간추린 기록 + 가짜 AI 21밤", () => {
  it("토요일 2번만으로는 날이 쌓여 T=21이 되는 18번째 날 밤(금요일)에 처음 통과하고(0.0091), 3번째 토요일 밤에는 0.0025로 여유가 생긴다. 그 전에는 규칙이 없다", async () => {
    pam = await startFakePamLlm({ chunk: fakeChunk, reflect: () => BEER_CANDIDATES, check: () => ({ ok: true, items: [] }), mark: fakeMark });
    const db = HistoryDb.open(":memory:");
    const stats = beerRecords(db);
    const dir = mkdtempSync(join(tmpdir(), "beer-exp-"));
    const active: number[] = [];
    const rules: ([number, number, number] | null)[] = [];   // 밤마다 맥주 가져다주기의 [n, k, p×10000 반올림]
    for (const day of stats.days) {
      const res = await runNight(db, pamClientFor(pam), day, { dir });
      expect(res.ok, day).toBe(true);
      const r = res as Extract<NightResult, { ok: true }>;
      active.push(r.active.length);
      const rule = r.checks.find((c) => c.action === BEER)?.ctx_rules?.[0];
      rules.push(rule ? [rule.n, rule.k, Math.round(rule.p_value * 10000)] : null);
      if (day === stats.days.at(-1)) expect(r.active.map((e) => [e.action, e.ctx]).sort()).toEqual([[BEER, { dow: 5, slot: 6 }], [CAN, { dow: 5, slot: 6 }]].sort());
    }
    // 날짜 0번이 월요일: 토요일은 5·12·19번째 날. 2주째 밤(13번째 날)까지는 탈락
    expect(active).toEqual([...Array(18).fill(0), 2, 2, 2]);
    expect(rules.slice(0, 18).every((x) => x === null)).toBe(true);
    expect(rules[18]).toEqual([2, 2, 91]);   // (2/21)² = 0.0091: 통과는 아슬아슬하다
    expect(rules[19]).toEqual([3, 3, 25]);   // 3번째 토요일 밤 (3/22)³
    expect(rules[20]).toEqual([3, 3, 22]);   // 다음 일요일 밤 (3/23)³
  });
});
