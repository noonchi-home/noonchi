// 반성과 기억 판본(src/brain/history/reflect.ts): 하루 관찰 텍스트·행동 요약·피드백 → pam-reflect/2 → 새 판본은 다음 날부터.
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CUP_FSM_MEMORY, type FsmMemory } from "../src/brain/decision.js";
import { PamClient } from "../src/brain/pam.js";
import type { BrainLog } from "../src/contract/events.js";
import { HistoryDb } from "../src/brain/history/db.js";
import { loadReflectAt, memoryForDay, runReflection, scheduleReflection } from "../src/brain/history/reflect.js";
import { fetchRetry, listenRetry } from "../src/shared/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { startFakePam, type FakePam } from "./helpers/pam.js";
import { openWebSocket } from "./helpers/ws.js";

let srv: Server | undefined;
let running: RunningServer | undefined;
let fakePam: FakePam | undefined;
afterEach(async () => {
  srv?.closeAllConnections();
  srv?.close();
  srv = undefined;
  await running?.close();
  running = undefined;
  await fakePam?.close();
  fakePam = undefined;
  vi.useRealTimers();
});

const got: Record<string, any>[] = [];
const LIMITS = { max_model_len: 32768, predict_input_bytes: 60_000, reflect_input_bytes: 30_000 };
async function startPam(memory: unknown, limits: Record<string, number> = LIMITS): Promise<string> {
  srv = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    res.writeHead(200, { "content-type": "application/json" });
    if (req.method === "GET" && req.url === "/health") return res.end(JSON.stringify({ ok: true, llm: null, limits }));
    got.push(JSON.parse(raw) as Record<string, any>);
    res.end(JSON.stringify({ status: "valid", raw_response: JSON.stringify(memory), memory, errors: [] }));
  });
  const { port } = await listenRetry(srv, 0, "127.0.0.1");
  return `http://127.0.0.1:${port}`;
}

describe("기억 판본", () => {
  it("그날 첫 판단이 판본을 정해 고정한다. 판본이 없으면 컵 FSM 기억을 1판으로 저장한다", () => {
    const db = HistoryDb.open(":memory:");
    expect(memoryForDay(db, "2026-11-07")).toEqual({ memory: CUP_FSM_MEMORY, kind: "fsm", version: 1 });
    expect(db.pinnedMemory("2026-11-07")).toBe(1);
    expect(memoryForDay(db, "2026-11-07").version).toBe(1);
    expect(db.memoryVersion(1)).toMatchObject({ version: 1, kind: "fsm", appliesDay: null });
    const v2 = db.saveMemory({ kind: "fsm", memory: { ...CUP_FSM_MEMORY, initial_state: "left_cup" }, day: "2026-11-07", appliesDay: "2026-11-08", source: "reflection" });
    expect(v2).toBe(2);
    expect(memoryForDay(db, "2026-11-07").version).toBe(1); // 고정한 날은 그대로
    expect(db.memoryFor("2026-11-08")).toMatchObject({ version: 2, appliesDay: "2026-11-08" });
    db.pinMemory("2026-11-07", 2); // 이미 고정한 날은 바꾸지 않는다
    expect(db.pinnedMemory("2026-11-07")).toBe(1);
  });
});

/** left_cup 규칙을 지금 seed의 습관 하나로 바꾼 기억. */
const withHabit = (m: { initial_state: string; states: { id: string; rules: unknown[] }[] }) => ({
  ...m, states: m.states.map((st) => (st.id === "left_cup" ? { ...st, rules: CUP_FSM_MEMORY.states.find((x) => x.id === "left_cup")!.rules } : st)),
});

describe("seed 판본 올리기", () => {
  // 예전 코드가 저장한 seed(상태 둘, 채워 주기·그대로 두기 규칙 없음)
  const OLD_SEED = {
    initial_state: "drinking",
    states: [
      { id: "drinking", description: "사용자가 식탁에서 컵으로 음료를 마시는 중이라 컵은 사용 중이다.", rules: [], next: [{ to: "left_cup", on: "사용자가 컵을 식탁에 내려놓고 자리를 떠나 보이지 않는다." }] },
      { id: "left_cup", description: "사용자가 컵을 식탁에 두고 자리를 비웠다.", rules: [{ trigger: "빈 컵", action: "컵 치우기" }], next: [{ to: "drinking", on: "사용자가 돌아와 컵을 다시 든다." }] },
    ],
  };

  it("판본 조회는 출처(source)를 돌려준다", () => {
    const db = HistoryDb.open(":memory:");
    db.saveMemory({ kind: "fsm", memory: OLD_SEED, day: null, appliesDay: null, source: "seed" });
    db.saveMemory({ kind: "fsm", memory: OLD_SEED, day: "2026-11-07", appliesDay: "2026-11-08", source: "reflection" });
    expect(db.memoryVersion(1)?.source).toBe("seed");
    expect(db.memoryFor("2026-11-07")?.source).toBe("seed");
    expect(db.memoryFor("2026-11-08")?.source).toBe("reflection");
  });

  it("옛 seed만 있는 DB는 새 seed 판본을 받는다. 이미 옛 seed로 고정한 날도 새 판본으로 다시 고정하고, 그 뒤에는 더 올리지 않는다", () => {
    const db = HistoryDb.open(":memory:");
    expect(db.saveMemory({ kind: "fsm", memory: OLD_SEED, day: null, appliesDay: null, source: "seed" })).toBe(1);
    db.pinMemory("2026-11-12", 1);
    // 아직 고정하지 않은 날
    expect(memoryForDay(db, "2026-11-13")).toEqual({ memory: CUP_FSM_MEMORY, kind: "fsm", version: 2 });
    expect(db.memoryVersion(2)).toMatchObject({ source: "seed", appliesDay: null, memory: CUP_FSM_MEMORY });
    expect(db.pinnedMemory("2026-11-13")).toBe(2);
    // 옛 seed로 고정했던 날
    expect(memoryForDay(db, "2026-11-12")).toEqual({ memory: CUP_FSM_MEMORY, kind: "fsm", version: 2 });
    expect(db.pinnedMemory("2026-11-12")).toBe(2);
    expect(memoryForDay(db, "2026-11-13").version).toBe(2);
    expect(memoryForDay(db, "2026-11-14").version).toBe(2);
    expect(db.memoryVersion(3)).toBeNull();
  });

  it("반성 판본이 있는 DB는 seed로 덮지 않는다: 가장 새 판본이 반성 판본이면 seed를 올리지 않고, 옛 seed로 고정한 날도 바꾸지 않는다. 습관(left_cup)만 반성 판본에 한 번 넣는다", () => {
    const db = HistoryDb.open(":memory:");
    db.saveMemory({ kind: "fsm", memory: OLD_SEED, day: null, appliesDay: null, source: "seed" });
    db.pinMemory("2026-11-12", 1);
    const learned = { ...OLD_SEED, initial_state: "left_cup" };
    db.saveMemory({ kind: "fsm", memory: learned, day: "2026-11-12", appliesDay: "2026-11-13", source: "reflection" });
    expect(memoryForDay(db, "2026-11-13")).toEqual({ memory: withHabit(learned), kind: "fsm", version: 3 });
    // 그날 쓰는 것은 옛 seed여도 그 뒤 반성 판본이 있으면 올리지 않는다(올리면 다음 날 반성 판본을 덮는다)
    expect(memoryForDay(db, "2026-11-12")).toEqual({ memory: OLD_SEED, kind: "fsm", version: 1 });
    expect(db.memoryVersion(4)).toBeNull();
    expect(db.memoryFor("2026-11-14")).toMatchObject({ version: 3, source: "reflection", appliesDay: "2026-11-13" });
  });

  // Codex(4ce9100): 가장 새 판본이 반성·합성 판본인 DB는 새 seed를 받지 않아 그대로 두기·물어보기로 판단했다
  it("컵을 두고 떠나면 치우는 습관은 반성·합성 판본에도 한 번 넣는다: left_cup 규칙만 습관 하나로 바꾸고 다른 상태의 배운 규칙은 둔다. 그 뒤 반성이 다시 배운 규칙은 바꾸지 않는다", () => {
    const db = HistoryDb.open(":memory:");
    const aircon = { trigger: "사용자가 TV를 보러 소파에 앉는다.", action: "에어컨 켜기" };
    const old: FsmMemory = {
      ...CUP_FSM_MEMORY,
      states: CUP_FSM_MEMORY.states.map((st) => st.id === "left_cup"
        ? { ...st, rules: [{ trigger: "사용자가 자리를 비웠지만 컵에 음료가 남아 있다.", action: "컵 그대로 두기" }, { trigger: "사용자가 자리를 비웠고 컵 안을 확인할 수 없다.", action: "사용자에게 물어보기" }] }
        : st.id === "watching_tv" ? { ...st, rules: [...st.rules, aircon] } : st),
    };
    db.saveMemory({ kind: "fsm", memory: CUP_FSM_MEMORY, day: null, appliesDay: null, source: "seed" });
    db.saveMemory({ kind: "fsm", memory: old, day: "2026-11-10", appliesDay: "2026-11-11", source: "synthetic" });
    db.pinMemory("2026-11-16", 2);
    const got = memoryForDay(db, "2026-11-16");
    expect(got.version).toBe(3);
    const states = (got.memory as FsmMemory).states;
    expect(states.find((st) => st.id === "left_cup")!.rules).toEqual(CUP_FSM_MEMORY.states.find((st) => st.id === "left_cup")!.rules);
    expect(states.find((st) => st.id === "watching_tv")!.rules).toContainEqual(aircon);
    expect(db.memoryVersion(3)).toMatchObject({ source: "synthetic", appliesDay: "2026-11-11" });
    expect(db.pinnedMemory("2026-11-16")).toBe(3);
    // 한 번만: 다시 불러도 새 판본을 만들지 않고, 그 뒤 반성이 그대로 두기를 다시 배우면 그대로 쓴다
    expect(memoryForDay(db, "2026-11-17").version).toBe(3);
    db.saveMemory({ kind: "fsm", memory: old, day: "2026-11-17", appliesDay: "2026-11-18", source: "reflection" });
    expect(memoryForDay(db, "2026-11-18")).toEqual({ memory: old, kind: "fsm", version: 4 });
    expect(db.memoryVersion(5)).toBeNull();
  });

  it("지금 seed와 같은 seed는 올리지 않는다", () => {
    const db = HistoryDb.open(":memory:");
    expect(memoryForDay(db, "2026-11-13").version).toBe(1);
    expect(memoryForDay(db, "2026-11-13").version).toBe(1);
    expect(memoryForDay(db, "2026-11-14").version).toBe(1);
    expect(db.memoryVersion(2)).toBeNull();
  });
});

describe("습관 넣기는 판본마다", () => {
  const habit = CUP_FSM_MEMORY.states.find((st) => st.id === "left_cup")!.rules;
  const past: FsmMemory = {
    ...CUP_FSM_MEMORY,
    states: CUP_FSM_MEMORY.states.map((st) => (st.id === "left_cup" ? { ...st, rules: [{ trigger: "사용자가 자리를 비웠지만 컵에 음료가 남아 있다.", action: "컵 그대로 두기" }] } : st)),
  };
  const leftCup = (m: unknown) => (m as FsmMemory).states.find((st) => st.id === "left_cup")!.rules;

  // Codex(0be4ffb): 오늘 고정 판본과 가장 새 판본이 다르면 가장 새 것만 고치고 전역 완료 표시를 남겨 오늘 판본에는 습관이 들어가지 않았다
  it("오늘 고정한 판본이 가장 새 판본(내일부터 쓰는 반성 판본)보다 옛것이어도 오늘 판본과 가장 새 판본에 각각 한 번 넣는다. 가장 새 판본을 고친 것이 가장 높은 판본이다", () => {
    const db = HistoryDb.open(":memory:");
    db.saveMemory({ kind: "fsm", memory: CUP_FSM_MEMORY, day: null, appliesDay: null, source: "seed" });
    db.saveMemory({ kind: "fsm", memory: past, day: "2026-11-15", appliesDay: "2026-11-16", source: "synthetic" });
    db.pinMemory("2026-11-16", 2);
    db.saveMemory({ kind: "fsm", memory: { ...past, initial_state: "left_cup" }, day: "2026-11-16", appliesDay: "2026-11-17", source: "reflection" });
    const today = memoryForDay(db, "2026-11-16");
    expect(leftCup(today.memory)).toEqual(habit);
    expect(db.pinnedMemory("2026-11-16")).toBe(today.version);
    const tomorrow = db.memoryFor("2026-11-17")!;
    expect(tomorrow.version).toBeGreaterThan(today.version);
    expect([leftCup(tomorrow.memory), (tomorrow.memory as FsmMemory).initial_state, tomorrow.source]).toEqual([habit, "left_cup", "reflection"]);
    // 다시 불러도 더 만들지 않는다
    const n = db.latestMemoryVersion();
    expect(memoryForDay(db, "2026-11-16").version).toBe(today.version);
    expect(memoryForDay(db, "2026-11-17").version).toBe(tomorrow.version);
    expect(db.latestMemoryVersion()).toBe(n);
  });

  // Codex(0be4ffb): 지난날 반성(reflect --chain)이 습관을 넣어 그날 판본·날 고정을 바꿨다
  it("지난날 반성은 그날 판본을 그대로 읽는다: 습관을 넣지 않고 날 고정도 바꾸지 않는다", async () => {
    const db = HistoryDb.open(":memory:");
    db.saveMemory({ kind: "fsm", memory: past, day: null, appliesDay: null, source: "synthetic" });
    db.pinMemory("2026-11-03", 1);
    const t = Date.UTC(2026, 10, 2, 23);
    db.add("detection", t, "사람 보임");
    got.length = 0;
    const r = await runReflection(db, new PamClient({ url: await startPam(past) }), "2026-11-03", { now: () => t + 3_600_000 });
    expect(r.ok).toBe(true);
    expect(leftCup(got[0]!.memory)).toEqual(past.states.find((st) => st.id === "left_cup")!.rules);
    expect(db.pinnedMemory("2026-11-03")).toBe(1);
  });
});

describe("반성", () => {
  it("하루 관찰 텍스트·행동 요약·피드백을 pam-reflect/2로 보내고, 새 기억은 다음 날부터 쓴다", async () => {
    const db = HistoryDb.open(":memory:");
    expect(memoryForDay(db, "2026-11-07").version).toBe(1); // 그날 첫 판단: seed를 정해 고정
    const t = Date.UTC(2026, 10, 6, 23); // 서울 11-07 08시
    db.add("detection", t, "사람 보임");
    db.add("decision", t + 60_000, "컵 치우기");
    db.add("feedback", t + 120_000, "다 마신 뒤에만 치워 줘");
    const next = { ...CUP_FSM_MEMORY, initial_state: "left_cup" };
    const logs: BrainLog[] = [];
    const r = await runReflection(db, new PamClient({ url: await startPam(next) }), "2026-11-07", { emit: (l) => logs.push(l), now: () => t + 3_600_000 });
    expect(r).toEqual({ ok: true, version: 2, appliesDay: "2026-11-08", learned: [], active: [], dropped: [] });
    expect(got.at(-1)).toMatchObject({ contract: "pam-reflect/2", day: "2026-11-07", memory_kind: "fsm", memory: CUP_FSM_MEMORY, feedback: "다 마신 뒤에만 치워 줘" });
    expect(got.at(-1)!.observation_text).toContain("08:00:00 사람 보임");
    expect(got.at(-1)!.action_summary).toBe("08:01:00 클로이드 판단: 컵 치우기\n08:02:00 사용자: 다 마신 뒤에만 치워 줘");
    expect(memoryForDay(db, "2026-11-07").version).toBe(1); // 그날은 그대로
    expect(memoryForDay(db, "2026-11-08")).toMatchObject({ version: 2, memory: { initial_state: "left_cup" } });
    expect(db.list({ kinds: ["reflection"] })).toEqual([expect.objectContaining({
      at_ms: t + 3_600_000, text: "반성 완료: 기억 2판, 2026-11-08부터", data: { day: "2026-11-07", ok: true, version: 2, applies_day: "2026-11-08", learned: [], active: [], dropped: [] },
    })]);
    expect(logs).toEqual([{ type: "reflection", at_ms: t + 3_600_000, day: "2026-11-07", ok: true, version: 2, applies_day: "2026-11-08", text: "반성 완료: 기억 2판, 2026-11-08부터", learned: [], active: [], dropped: [] }]);
  });

  describe("반성 뒤 검사(코치 규칙 지키기·습관 거르기)", () => {
    const RAMEN = "라면 끓이기 알려 주기";
    const AIRCON = { trigger: "사용자가 TV를 보러 소파에 앉는다.", action: "에어컨 켜기" };
    const HABIT = { trigger: "저녁 19시마다 사용자가 식탁에 앉는다.", action: RAMEN };
    const withRules = (add: Record<string, { trigger: string; action: string }[]>): FsmMemory => ({
      ...CUP_FSM_MEMORY, states: CUP_FSM_MEMORY.states.map((s) => ({ ...s, rules: [...s.rules, ...(add[s.id] ?? [])] })),
    });
    const t = Date.UTC(2026, 10, 6, 23);

    it("반성이 낸 코치 습관 규칙은 빠지고 dropped에 reason coach로, 에어컨 습관 규칙은 남고 learned에 있다. 기록 줄·사건에도 있다", async () => {
      const db = HistoryDb.open(":memory:");
      db.add("detection", t, "사람 보임");
      const logs: BrainLog[] = [];
      const r = await runReflection(db, new PamClient({ url: await startPam(withRules({ drinking: [HABIT], watching_tv: [AIRCON] })) }), "2026-11-07", { emit: (l) => logs.push(l), now: () => t + 3_600_000 });
      expect(r).toMatchObject({ ok: true, version: 2, learned: [{ state: "watching_tv", ...AIRCON }], dropped: [{ state: "drinking", ...HABIT, kept: false, reason: "coach" }] });
      const saved = db.memoryVersion(2)!.memory as FsmMemory;
      expect(saved.states.find((s) => s.id === "drinking")!.rules).toEqual(CUP_FSM_MEMORY.states.find((s) => s.id === "drinking")!.rules);
      expect(saved.states.find((s) => s.id === "watching_tv")!.rules).toContainEqual(AIRCON);
      const row = db.list({ kinds: ["reflection"] }).at(-1)!;
      expect(row.text).toBe("반성 완료: 기억 2판, 2026-11-08부터 · 새 규칙 1개를 배웠어요");
      expect(row.data).toMatchObject({ learned: [{ state: "watching_tv", ...AIRCON }], dropped: [{ state: "drinking", ...HABIT, reason: "coach" }] });
      expect(logs.at(-1)).toMatchObject({ type: "reflection", learned: [{ state: "watching_tv", ...AIRCON }], dropped: [{ reason: "coach" }] });
    });

    it("filter는 지난 30일 world·device·decision·execution·feedback 줄을 시각 순으로 받고, 그 함수가 뺀 규칙은 저장되지 않는다. 그 함수가 코치 규칙을 더해도 저장된 판본에는 seed 코치 규칙만 있다", async () => {
      const db = HistoryDb.open(":memory:");
      const day = (d: number, h = 1) => Date.UTC(2026, 9, d, h); // 서울 시간대 10월 d일 10시
      db.add("world", Date.UTC(2026, 9, 8, 1), "31일 전 world"); // 10-08: 30일 밖
      db.add("world", day(9), "30일 안 world");
      db.add("device", day(20), "거실 에어컨 켜짐");
      db.add("detection", day(21), "사람 보임"); // 종류 밖
      db.add("decision", Date.UTC(2026, 10, 7, 0), "컵 치우기");
      db.add("execution", Date.UTC(2026, 10, 7, 0, 1), "완료");
      db.add("feedback", Date.UTC(2026, 10, 7, 0, 2), "고마워");
      db.add("world", Date.UTC(2026, 10, 7, 15, 1), "다음 날 world"); // 서울 11-08 00:01
      const seen: { rows: string[]; windowDays: number; offsetMinutes: number; day: string }[] = [];
      const r = await runReflection(db, new PamClient({ url: await startPam(withRules({ watching_tv: [AIRCON] })) }), "2026-11-07", {
        filter: (i) => {
          seen.push({ rows: i.rows.map((x) => `${x.kind}:${x.text}`), windowDays: i.windowDays, offsetMinutes: i.offsetMinutes, day: i.day });
          const memory = structuredClone(i.proposed);
          memory.states.find((s) => s.id === "watching_tv")!.rules = memory.states.find((s) => s.id === "watching_tv")!.rules.filter((x) => x.trigger !== AIRCON.trigger);
          memory.states.find((s) => s.id === "drinking")!.rules.push(HABIT);
          return { memory, notes: [{ state: "watching_tv", ...AIRCON, kept: false, reason: "too_few", seen: 1, fired: 1 }] };
        },
      });
      expect(seen).toEqual([{
        day: "2026-11-07", windowDays: 30, offsetMinutes: 540,
        rows: ["world:30일 안 world", "device:거실 에어컨 켜짐", "decision:컵 치우기", "execution:완료", "feedback:고마워"],
      }]);
      expect(r).toMatchObject({ ok: true, learned: [], dropped: [{ state: "watching_tv", ...AIRCON, reason: "too_few" }, { state: "drinking", ...HABIT, reason: "coach" }] });
      expect(db.memoryVersion(2)!.memory).toEqual(CUP_FSM_MEMORY);
    });

    it("반성 사건·기록 줄에 learned(이번에 새로 더함)와 active(새 판본에서 seed에 없는 눈치 규칙)가 있다. 앞 판본에 이미 있던 에어컨 습관은 active에만 있다", async () => {
      const db = HistoryDb.open(":memory:");
      const before = withRules({ watching_tv: [AIRCON] });
      db.saveMemory({ kind: "fsm", memory: before, day: "2026-11-06", appliesDay: "2026-11-07", source: "reflection" });
      db.add("detection", t, "사람 보임");
      const NIGHT = { trigger: "밤에 사용자가 식탁을 떠난다.", action: "컵 치우기" };
      const logs: BrainLog[] = [];
      const after = { ...before, states: before.states.map((s) => (s.id === "left_cup" ? { ...s, rules: [...s.rules, NIGHT] } : s)) };
      await runReflection(db, new PamClient({ url: await startPam(after) }), "2026-11-07", { emit: (l) => logs.push(l), now: () => t + 3_600_000 });
      expect(logs.at(-1)).toMatchObject({ type: "reflection", ok: true, learned: [{ state: "left_cup", ...NIGHT }], active: [{ state: "watching_tv", ...AIRCON }, { state: "left_cup", ...NIGHT }] });
      expect(db.list({ kinds: ["reflection"] }).at(-1)!.data).toMatchObject({ learned: [{ state: "left_cup", ...NIGHT }], active: [{ state: "watching_tv", ...AIRCON }, { state: "left_cup", ...NIGHT }] });
    });

    it("기본 거르기(keepAll)로 반성하면 지난 30일 기록 줄을 읽지 않는다(기록 DB가 커도 서버를 멈추지 않게)", async () => {
      const db = HistoryDb.open(":memory:");
      db.add("detection", t, "사람 보임");
      const list = vi.spyOn(db, "list");
      const r = await runReflection(db, new PamClient({ url: await startPam(withRules({ watching_tv: [AIRCON] })) }), "2026-11-07");
      expect(r).toMatchObject({ ok: true, learned: [{ state: "watching_tv", ...AIRCON }] });
      const kinds = list.mock.calls.map((c) => c[0].kinds ?? []);
      expect(kinds.some((k) => k.includes("execution") && k.includes("device") && !k.includes("detection"))).toBe(false);
      expect(list.mock.calls.some((c) => c[0].since !== undefined)).toBe(false);
    });

    it("거르기 결과가 기억 모양 검사에 걸리면 반성은 실패로 남고 판본은 늘지 않는다", async () => {
      const db = HistoryDb.open(":memory:");
      db.add("detection", t, "사람 보임");
      const r = await runReflection(db, new PamClient({ url: await startPam(CUP_FSM_MEMORY) }), "2026-11-07", {
        filter: (i) => ({ memory: { ...i.proposed, initial_state: "nowhere" }, notes: [] }),
      });
      expect(r.ok).toBe(false);
      expect(db.latestMemoryVersion()).toBe(1);
      expect(db.list({ kinds: ["reflection"] }).at(-1)!.text).toMatch(/^반성 실패: /);
    });
  });

  it("다음 날 판단이 이미 판본을 정했으면 그날은 바꾸지 않고 그다음 날부터 쓴다", async () => {
    const db = HistoryDb.open(":memory:");
    expect(memoryForDay(db, "2026-11-08").version).toBe(1); // 11-08 판단이 먼저 시작함
    db.add("detection", Date.UTC(2026, 10, 7, 1), "사람 보임");
    expect(await runReflection(db, new PamClient({ url: await startPam({ ...CUP_FSM_MEMORY, initial_state: "left_cup" }) }), "2026-11-07")).toEqual({ ok: true, version: 2, appliesDay: "2026-11-09", learned: [], active: [], dropped: [] });
    expect(memoryForDay(db, "2026-11-08").version).toBe(1);
    expect(memoryForDay(db, "2026-11-09").version).toBe(2);
  });

  it("PAM이 알린 입력 한도에 맞춰 하루 요약을 줄여 보낸다", async () => {
    const db = HistoryDb.open(":memory:");
    for (let i = 0; i < 3000; i++) db.add("world", Date.UTC(2026, 10, 7, 0, 0, i), `컵 cup_${i % 5} 상태 ${i}`);
    await runReflection(db, new PamClient({ url: await startPam(CUP_FSM_MEMORY) }), "2026-11-07");
    const sent = got.at(-1)!;
    const size = Buffer.byteLength(sent.observation_text) + Buffer.byteLength(sent.action_summary) + Buffer.byteLength(JSON.stringify(sent.memory, null, 2));
    expect(size).toBeLessThanOrEqual(LIMITS.reflect_input_bytes);
    expect(sent.observation_text.split("\n")[0]).toMatch(/^앞선 기록 \d+줄 생략$/);
    expect(sent.action_summary).toBe("행동 없음");
  });

  it("입력 한도가 커도 pam-reflect/2 칸 상한(관찰 100,000·행동 50,000·피드백 8,000자)을 넘지 않는다", async () => {
    const db = HistoryDb.open(":memory:");
    const at = (i: number) => Date.UTC(2026, 10, 7, 0, 0, 0, i * 10);
    for (let i = 0; i < 4000; i++) db.add("world", at(i), `컵 cup_${i % 5} 상태 바뀜 번호 ${i}`);
    for (let i = 0; i < 2000; i++) db.add("decision", at(i), `컵 치우기 판단 번호 ${i}`);
    for (let i = 0; i < 400; i++) db.add("feedback", at(i), `피드백 번호 ${i} 다 마신 뒤에 치워 줘`);
    const r = await runReflection(db, new PamClient({ url: await startPam(CUP_FSM_MEMORY, { ...LIMITS, reflect_input_bytes: 10_000_000 }) }), "2026-11-07");
    expect(r.ok).toBe(true);
    const sent = got.at(-1)!;
    expect(Buffer.byteLength(sent.observation_text)).toBeLessThanOrEqual(100_000);
    expect(Buffer.byteLength(sent.action_summary)).toBeLessThanOrEqual(50_000);
    expect(Buffer.byteLength(sent.feedback)).toBeLessThanOrEqual(8_000);
    expect(sent.observation_text.split("\n")[0]).toMatch(/^앞선 기록 \d+줄 생략$/);
    expect(sent.action_summary.split("\n")[0]).toMatch(/^앞선 기록 \d+줄 생략$/);
    expect(sent.feedback.split("\n").at(-1)).toBe("피드백 번호 399 다 마신 뒤에 치워 줘");
  });

  it("그날 기록이 없으면 PAM을 부르지 않고 실패를 기록한다", async () => {
    const db = HistoryDb.open(":memory:");
    const logs: BrainLog[] = [];
    const r = await runReflection(db, new PamClient({ url: "http://127.0.0.1:9" }), "2026-11-07", { emit: (l) => logs.push(l) });
    expect(r).toEqual({ ok: false, empty: true, error: "그날 기록 없음" });
    expect(db.list({ kinds: ["reflection"] }).map((x) => x.text)).toEqual(["반성 실패: 그날 기록 없음"]);
    expect(logs).toEqual([expect.objectContaining({ type: "reflection", ok: false, version: null, applies_day: null })]);
  });

  it("PAM에 닿지 않으면 실패를 기록하고 기억은 그대로다", async () => {
    const db = HistoryDb.open(":memory:");
    db.add("detection", Date.UTC(2026, 10, 7, 1), "사람 보임");
    const r = await runReflection(db, new PamClient({ url: "http://127.0.0.1:9" }), "2026-11-07");
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/PAM 연결 실패/) });
    expect(db.list({ kinds: ["reflection"] })[0]!.text).toMatch(/^반성 실패: PAM 연결 실패/);
    expect(memoryForDay(db, "2026-11-08").version).toBe(1);
  });
});

describe("반성 시각", () => {
  it("REFLECT_AT: 비우면 23:30, off면 끔, HH:MM이 아니면 시작을 막는다", () => {
    expect(loadReflectAt({})).toBe("23:30");
    expect(loadReflectAt({ REFLECT_AT: "07:05" })).toBe("07:05");
    expect(loadReflectAt({ REFLECT_AT: "off" })).toBeNull();
    for (const bad of ["7:5", "24:00", "23:60", "밤"]) expect(() => loadReflectAt({ REFLECT_AT: bad })).toThrow(/REFLECT_AT/);
  });

  it("매일 그 시각(기록 시간대)에 그날을 반성한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 7, 14, 0)); // 서울 23:00
    const days: string[] = [];
    const s = scheduleReflection({ at: "23:30", offsetMinutes: 540, run: async (day) => { days.push(day); } });
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(days).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(days).toEqual(["2026-11-07"]);
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(days).toEqual(["2026-11-07", "2026-11-08"]);
    s.stop();
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(days).toHaveLength(2);
  });
});

describe("반성 API", () => {
  async function start(extra: Record<string, string> = {}) {
    fakePam = await startFakePam();
    running = await startServer({ env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PAM_URL: fakePam.url, ...extra }, log: () => {} });
    return running;
  }
  const post = async (body: unknown) => {
    const r = await fetchRetry(`${running!.url}/api/reflection/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as Record<string, any> };
  };

  it("POST /api/reflection/run: 그날을 반성하고 결과를 대시보드 판단 기록으로 보낸다", async () => {
    const s = await start();
    s.history.add("detection", Date.UTC(2026, 10, 7, 1), "사람 보임");
    const box: Record<string, any>[] = [];
    const dash = await openWebSocket(`${s.url.replace(/^http/, "ws")}/events`, { setup: (ws) => ws.on("message", (d) => box.push(JSON.parse(String(d)))) });
    try {
      const r = await post({ day: "2026-11-07" });
      expect(r).toEqual({ status: 200, json: { ok: true, day: "2026-11-07", version: 2, appliesDay: "2026-11-08" } });
      expect(fakePam!.bodies.at(-1)).toMatchObject({ contract: "pam-reflect/2", day: "2026-11-07", memory_kind: "fsm" });
      const end = Date.now() + 3000;
      while (!box.some((m) => m.type === "brain" && m.event.type === "reflection") && Date.now() < end) await new Promise((ok) => setTimeout(ok, 20));
      expect(box.find((m) => m.type === "brain" && m.event.type === "reflection")!.event).toMatchObject({ ok: true, version: 2, applies_day: "2026-11-08" });
    } finally {
      dash.close();
    }
    // 반성 뒤 붙은 대시보드도 오늘(기록 시간대) 마지막 반성 사건을 다시 받는다(기록 DB reflection 줄에서)
    const late: Record<string, any>[] = [];
    const again = await openWebSocket(`${s.url.replace(/^http/, "ws")}/events`, { setup: (ws) => ws.on("message", (d) => late.push(JSON.parse(String(d)))) });
    try {
      const end = Date.now() + 3000;
      while (!late.some((m) => m.type === "brain" && m.event.type === "reflection") && Date.now() < end) await new Promise((ok) => setTimeout(ok, 20));
      expect(late.find((m) => m.type === "brain" && m.event.type === "reflection")).toMatchObject({ replay: true, event: { type: "reflection", ok: true, version: 2, applies_day: "2026-11-08", learned: [], active: [] } });
    } finally {
      again.close();
    }
  });

  it("없는 날짜는 400, 그날 기록이 없으면 409", async () => {
    await start({ REFLECT_AT: "off" });
    expect((await post({ day: "2026-02-30" })).status).toBe(400);
    expect((await post({ day: 7 })).status).toBe(400);
    const empty = await post({ day: "2026-11-01" });
    expect(empty.status).toBe(409);
    expect(empty.json.error).toBe("그날 기록 없음");
  });

  it("REFLECT_AT이 틀리면 서버가 뜨지 않는다", async () => {
    await expect(start({ REFLECT_AT: "25:00" })).rejects.toThrow(/REFLECT_AT/);
  });
});
