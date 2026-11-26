// 반성과 기억 판본(src/brain/history/reflect.ts): 하루 관찰 텍스트·행동 요약·피드백 → pam-reflect/3(가짜 PAM LLM, 후보 FSM) → 새 판본은 다음 날부터.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CUP_FSM_MEMORY } from "../src/brain/decision.js";
import { candidateFsmOf } from "../src/brain/pam/adopt.js";
import { MEMORY_CHECK_PROMPT } from "../src/brain/pam/index.js";
import type { PamClient } from "../src/brain/pam/index.js";
import type { BrainLog } from "../src/contract/events.js";
import { HistoryDb } from "../src/brain/history/db.js";
import { NIGHT_TEXT, REFLECT_TEXT } from "../src/brain/history/labels.js";
import { loadReflectAt, memoryForDay, runReflection, scheduleReflection } from "../src/brain/history/reflect.js";
import { fetchRetry, listenRetry } from "../src/shared/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { pamClientFor, startFakePamLlm, type ChunkView, type FakePamLlm, type ReflectView, pamLlmEnv } from "./helpers/pam.js";
import { openWebSocket } from "./helpers/ws.js";

let reflectLlm: FakePamLlm | undefined;
let running: RunningServer | undefined;
let fakePam: FakePamLlm | undefined;
afterEach(async () => {
  await reflectLlm?.close();
  reflectLlm = undefined;
  await running?.close();
  running = undefined;
  await fakePam?.close();
  fakePam = undefined;
  vi.useRealTimers();
});

const got: (ReflectView & Record<string, any>)[] = [];
/** seed를 후보 FSM 모양으로(반성 답의 기본 꼴). */
const SEED_C = () => candidateFsmOf(CUP_FSM_MEMORY);
const DAY = "2026-11-07";
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
/** 한 주소로 받는 가짜 LLM 답: 기억 뜻 검사 요청이면 통과 판정, 그 밖(반성)은 seed 후보 FSM. */
const answerOf = (init?: RequestInit) => (String(init?.body ?? "").includes(JSON.stringify(MEMORY_CHECK_PROMPT).slice(1, 40)) ? JSON.stringify({ ok: true, items: [] }) : JSON.stringify(SEED_C()));
/** 그날 기록이 한 줄 있는 기록 DB. */
function dayWithLog(): HistoryDb {
  const db = HistoryDb.open(":memory:");
  db.add("detection", Date.UTC(2026, 10, 6, 23), "사람 보임");
  return db;
}
/** 가짜 PAM LLM(vllm 모드 모델 pam)의 사용량: 토큰 0, 가격표에 없는 모델이라 비용 null. */
const FAKE_USAGE = { model: "pam", prompt: 0, completion: 0, cached: 0, cost_usd: null };
/** 반성 답이 memory인 가짜 PAM LLM에 붙은 PamClient. 받은 반성 요청 값은 got에 쌓인다. env로 문맥 길이(PAM_MAX_MODEL_LEN) 등을 바꾼다. */
async function startPam(memory: unknown, env: Record<string, string> = {}, chunk?: (v: ChunkView) => unknown): Promise<PamClient> {
  await reflectLlm?.close();
  reflectLlm = await startFakePamLlm({ reflect: (v) => { got.push(v); return memory; }, ...(chunk ? { chunk } : {}) });
  return pamClientFor(reflectLlm, { env });
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

  it("지금 seed와 같은 seed는 올리지 않는다", () => {
    const db = HistoryDb.open(":memory:");
    expect(memoryForDay(db, "2026-11-13").version).toBe(1);
    expect(memoryForDay(db, "2026-11-13").version).toBe(1);
    expect(memoryForDay(db, "2026-11-14").version).toBe(1);
    expect(db.memoryVersion(2)).toBeNull();
  });
});

describe("옛 모양 기억", () => {
  const OLD = { initial_state: "drinking", states: [{ id: "drinking", description: "먹는 중", rules: [{ trigger: "컵이 빈다.", action: "컵에 물 채워 주기" }], next: [] }] };
  it("그날 판본이 옛 모양이면 옮기지 않고 새 seed 판본을 올려 쓰고 로그에 한 줄 남긴다", () => {
    const db = HistoryDb.open(":memory:");
    const old = db.saveMemory({ kind: "fsm", memory: OLD, day: "2026-11-18", appliesDay: "2026-11-19", source: "reflection" });
    const lines: string[] = [];
    const m = memoryForDay(db, "2026-11-19", { log: (l) => lines.push(l) });
    expect(m.version).toBeGreaterThan(old);
    expect(m.memory).toEqual(CUP_FSM_MEMORY);
    expect(lines).toEqual([`옛 모양 기억 ${old}판이라 새 seed로 다시 시작해요`]);
    expect(memoryForDay(db, "2026-11-19").version).toBe(m.version);
  });
  it("반성은 옛 모양 판본을 읽지 않는다(그날 판본이 옛 모양이면 새 seed로 반성한다)", async () => {
    const db = HistoryDb.open(":memory:");
    db.saveMemory({ kind: "fsm", memory: OLD, day: null, appliesDay: null, source: "seed" });
    db.add("world", Date.parse("2026-11-19T03:00:00Z"), "사람 보임");
    got.length = 0;
    await runReflection(db, await startPam(SEED_C()), "2026-11-19");
    expect(got.map((v) => v.memory)).toEqual([SEED_C()]);
  });
});

describe("반성", () => {
  it("하루 관찰 텍스트·행동 요약·피드백을 pam-reflect/3(후보 FSM)으로 보내고, 새 로봇 판본·후보 판본은 다음 날부터 쓴다", async () => {
    const db = HistoryDb.open(":memory:");
    expect(memoryForDay(db, "2026-11-07").version).toBe(1); // 그날 첫 판단: seed를 정해 고정
    const t = Date.UTC(2026, 10, 6, 23); // 서울 11-07 08시
    db.add("detection", t, "사람 보임");
    db.add("decision", t + 60_000, "컵 치우기");
    db.add("feedback", t + 120_000, "다 마신 뒤에만 치워 줘");
    const next = SEED_C();
    next.states[0]!.description = "사용자가 아침마다 식탁에서 커피를 마신다.";
    const logs: BrainLog[] = [];
    const r = await runReflection(db, await startPam(next), "2026-11-07", { emit: (l) => logs.push(l), now: () => t + 3_600_000 });
    expect(r).toEqual({ ok: true, version: 2, appliesDay: "2026-11-08", learned: [], active: [], dropped: [] });
    expect(got.at(-1)).toMatchObject({ role: "reflect", memory_kind: "fsm_candidates", memory: SEED_C(), feedback: "다 마신 뒤에만 치워 줘" });
    expect(got.at(-1)!.observation_text).toContain("08:00:00 사람 보임");
    const [acted, fixed] = got.at(-1)!.action_summary.split("\n\n");
    expect(acted).toBe("08:01:00 클로이드 판단: 컵 치우기\n08:02:00 사용자: 다 마신 뒤에만 치워 줘");
    // 팀이 정한 로봇 일 화살표는 이미 채택된 것으로 행동 칸 끝에 붙는다(후보 FSM에는 없다)
    expect(fixed!.split("\n")).toEqual([
      NIGHT_TEXT.seedHead, NIGHT_TEXT.seedAsk("사용자에게 물어보기"),
      ...CUP_FSM_MEMORY.states.flatMap((s) => s.next.filter((e) => e.action).map((e) => `${s.id} | ${e.when ? `${e.on} (${e.when})` : e.on} | ${e.action}`)),
    ]);
    expect(fixed).toContain("watching_tv | 사용자가 TV 보기를 끝내고 다른 일로 넘어간다. (같이 마시는 중이었다.) | 사용자에게 물어보기");
    expect(memoryForDay(db, "2026-11-07").version).toBe(1); // 그날은 그대로
    const after = memoryForDay(db, "2026-11-08");
    expect(after.version).toBe(2);
    expect((after.memory as typeof CUP_FSM_MEMORY).states[0]).toMatchObject({ id: "drinking", description: "사용자가 아침마다 식탁에서 커피를 마신다." });
    expect(db.candidatesFor("2026-11-08")).toMatchObject({ kind: "fsm_candidates", memory: next });
    expect(db.list({ kinds: ["reflection"] })).toEqual([expect.objectContaining({
      at_ms: t + 3_600_000, text: "반성 완료: 기억 2판, 2026-11-08부터", data: { day: "2026-11-07", ok: true, version: 2, applies_day: "2026-11-08", learned: [], active: [], dropped: [], rejected: null, usage: FAKE_USAGE },
    })]);
    expect(logs).toEqual([{ type: "reflection", at_ms: t + 3_600_000, day: "2026-11-07", ok: true, version: 2, applies_day: "2026-11-08", text: "반성 완료: 기억 2판, 2026-11-08부터", learned: [], active: [], dropped: [], rejected: null, usage: FAKE_USAGE }]);
  });

  it("정상 후보 FSM 반성 답(rules에 컵 치우기 후보)은 답 오류 없이 받아져 후보 판본과 로봇 판본이 저장된다. 요청은 후보 FSM 종류다", async () => {
    const c = candidateFsmOf(CUP_FSM_MEMORY);
    c.states.find((s) => s.id === "drinking")!.rules.push({ to: "*", action: "컵 치우기", candidates: [{ on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다." }] });
    const db = dayWithLog();
    got.length = 0;
    const r = await runReflection(db, await startPam(c), DAY);
    expect(r).toMatchObject({ ok: true });
    expect(got.find((b) => b.role === "reflect")).toMatchObject({ memory_kind: "fsm_candidates", memory: candidateFsmOf(CUP_FSM_MEMORY) });
    expect(db.candidatesFor(nextDay(DAY))!.memory).toEqual(c);
    // 아직 셈이 없어 로봇 FSM은 seed 그대로(떠날 때 묻기). 채택까지는 밤 흐름 시험이 같은 길로 본다
    expect(db.memoryFor(nextDay(DAY))!.memory).toEqual(CUP_FSM_MEMORY);
  });

  it("다음 반성은 지난 밤 후보 판본을 입력으로 받는다(후보 문구·상태 id를 이어 간다)", async () => {
    const c = SEED_C();
    c.states.find((s) => s.id === "drinking")!.rules.push({ to: "*", action: "컵 치우기", candidates: [{ on: "사용자가 외출하러 나간다." }] });
    const db = dayWithLog();
    await runReflection(db, await startPam(c), DAY);
    db.add("detection", Date.UTC(2026, 10, 7, 23), "사람 보임");
    got.length = 0;
    await runReflection(db, await startPam(c), nextDay(DAY));
    expect(got.at(-1)).toMatchObject({ memory_kind: "fsm_candidates", memory: c });
  });

  it("반성 답을 로봇 FSM 모양(fsm)으로 내면 후보 FSM 모양 오류로 거절하고 까닭을 붙여 한 번 다시 반성한다", async () => {
    const asked: (string | null)[] = [];
    const answers: unknown[] = [CUP_FSM_MEMORY, SEED_C()];
    const pam = await startFakePamLlm({ reflect: (v) => { asked.push(v.feedback); return answers.shift()!; } });
    try {
      const db = dayWithLog();
      const r = await runReflection(db, pamClientFor(pam), DAY);
      expect(r).toMatchObject({ ok: true });
      expect(asked[0]).toBeNull();
      expect(asked[1]).toMatch(/incorrect fields/);
      expect(db.candidatesFor(nextDay(DAY))!.memory).toEqual(SEED_C());
    } finally {
      await pam.close();
    }
  });

  describe("반성 → 코드 검사 → 뜻 검사", () => {
    // 반성 답은 후보 FSM 모양이다
    const LEFT = () => { const c = SEED_C(); c.states.splice(3, 0, { id: "left_cup", description: "사용자가 컵을 두고 떠났다.", activity: ["putting_away"], next: [], rules: [] }); return c; };
    it("뜻 검사가 거절하면 까닭을 피드백에 붙여 한 번 다시 반성하고, 다시 낸 기억이 통과하면 그것을 쓴다", async () => {
      const asked: (string | null)[] = [];
      const answers = [LEFT(), SEED_C()];
      const pam = await startFakePamLlm({
        reflect: (v) => { asked.push(v.feedback); return answers.shift()!; },
        check: (v) => (v.memory.states.some((s: { id: string }) => s.id === "left_cup")
          ? { ok: false, items: [{ kind: "state", ref: "left_cup", ok: false, why: "컵 상황은 사람이 하는 일이 아니다" }] }
          : { ok: true, items: [] }),
      });
      try {
        const db = dayWithLog();
        const r = await runReflection(db, pamClientFor(pam), DAY);
        expect(r).toMatchObject({ ok: true });
        expect(asked[1]).toContain("컵 상황은 사람이 하는 일이 아니다");
        // 밤 흐름: 덩어리 기록 → 반성 → 뜻 검사(거절) → 다시 반성 → 뜻 검사
        expect(pam.calls).toEqual(["chunk", "reflect", "check", "reflect", "check"]);
        expect(db.candidatesFor(nextDay(DAY))!.memory).toEqual(SEED_C());
      } finally {
        await pam.close();
      }
    });
    it("반성 답이 기억 모양부터 틀리면(옛 모양 rules) 그 까닭을 피드백에 붙여 한 번 다시 반성한다", async () => {
      const asked: (string | null)[] = [];
      const OLD = { initial_state: "away", states: [{ id: "away", description: "d", rules: [], next: [] }] };
      const answers: unknown[] = [OLD, SEED_C()];
      const pam = await startFakePamLlm({ reflect: (v) => { asked.push(v.feedback); return answers.shift()!; }, check: () => ({ ok: true, items: [] }) });
      try {
        const r = await runReflection(dayWithLog(), pamClientFor(pam), DAY);
        expect(r).toMatchObject({ ok: true });
        expect(asked[1]).toMatch(/incorrect fields/);
      } finally {
        await pam.close();
      }
    });
    it("다시 낸 기억도 거절이면(코드 검사든 뜻 검사든) 새 판본을 저장하지 않고 까닭을 반성 기록에 남긴다", async () => {
      const pam = await startFakePamLlm({ reflect: () => LEFT(), check: () => ({ ok: false, items: [{ kind: "state", ref: "left_cup", ok: false, why: "물건 상황" }] }) });
      try {
        const db = dayWithLog();
        const before = db.latestMemoryVersion();
        const r = await runReflection(db, pamClientFor(pam), DAY);
        expect(r).toMatchObject({ ok: false });
        expect(db.latestMemoryVersion()).toBe(before);
        expect(db.candidatesFor(nextDay(DAY))).toBeNull();
        const row = db.list({ kinds: ["reflection"] }).at(-1)!;
        expect(row.text).toBe("반성 기억을 쓰지 않아요 · left_cup: 물건 상황");
        expect(row.data).toMatchObject({ ok: false, rejected: "left_cup: 물건 상황" });
      } finally {
        await pam.close();
      }
    });
  });

  describe("반성 뒤 검사(배우지 않는 행동 빼기·습관 거르기)", () => {
    const RAMEN = "라면 끓이기 알려 주기";
    const t = Date.UTC(2026, 10, 6, 23);

    it("반성이 낸 코치·정한 습관 행동 후보는 빠지고 dropped에 reason coach·settings로 남는다. 저장된 로봇 판본의 정한 습관 화살표는 seed 그대로다", async () => {
      const db = HistoryDb.open(":memory:");
      db.add("detection", t, "사람 보임");
      const c = SEED_C();
      c.states.find((s) => s.id === "drinking")!.rules.push({ to: "drinking", action: RAMEN, candidates: [{ on: "저녁 19시마다 사용자가 식탁에 앉는다." }] }, { to: "drinking", action: "컵에 물 채워 주기", candidates: [{ on: "사용자가 물을 다 마신다." }] });
      const logs: BrainLog[] = [];
      const r = await runReflection(db, await startPam(c), "2026-11-07", { emit: (l) => logs.push(l), now: () => t + 3_600_000 });
      expect(r).toMatchObject({ ok: true, version: 2, learned: [], dropped: [
        { from: "drinking", to: "drinking", on: "저녁 19시마다 사용자가 식탁에 앉는다.", action: RAMEN, kept: false, reason: "coach" },
        { from: "drinking", to: "drinking", on: "사용자가 물을 다 마신다.", action: "컵에 물 채워 주기", kept: false, reason: "settings" },
      ] });
      expect(db.memoryVersion(2)!.memory).toEqual(CUP_FSM_MEMORY);
      expect(db.list({ kinds: ["reflection"] }).at(-1)!.data).toMatchObject({ dropped: [{ reason: "coach" }, { reason: "settings" }] });
      expect(logs.at(-1)).toMatchObject({ type: "reflection", dropped: [{ reason: "coach" }, { reason: "settings" }] });
    });

    it("filter는 지난 30일 world·device·decision·execution·feedback 줄을 시각 순으로 받고, 그 함수가 남긴 기록은 dropped에 있다. 그 함수는 정한 습관 화살표를 바꾸지 못한다", async () => {
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
      const r = await runReflection(db, await startPam(SEED_C()), "2026-11-07", {
        filter: (i) => {
          seen.push({ rows: i.rows.map((x) => `${x.kind}:${x.text}`), windowDays: i.windowDays, offsetMinutes: i.offsetMinutes, day: i.day });
          const memory = structuredClone(i.proposed);
          memory.states.find((s) => s.id === "watching_tv")!.next = [];
          return { memory, notes: [{ from: "watching_tv", to: "watching_tv", on: "사용자가 덥다고 말하거나 더워서 부채질을 한다.", action: "에어컨 켜기", kept: false, reason: "too_few", seen: 1, fired: 1 }] };
        },
      });
      expect(seen).toEqual([{
        day: "2026-11-07", windowDays: 30, offsetMinutes: 540,
        rows: ["world:30일 안 world", "device:거실 에어컨 켜짐", "decision:컵 치우기", "execution:완료", "feedback:고마워"],
      }]);
      expect(r).toMatchObject({ ok: true, learned: [], dropped: [{ from: "watching_tv", reason: "too_few" }] });
      expect(db.memoryVersion(2)!.memory).toEqual(CUP_FSM_MEMORY);
    });

    it("기본 거르기(keepAll)로 반성하면 지난 30일 기록 줄을 읽지 않는다(기록 DB가 커도 서버를 멈추지 않게)", async () => {
      const db = HistoryDb.open(":memory:");
      db.add("detection", t, "사람 보임");
      const list = vi.spyOn(db, "list");
      const r = await runReflection(db, await startPam(SEED_C()), "2026-11-07");
      expect(r).toMatchObject({ ok: true });
      const kinds = list.mock.calls.map((c) => c[0].kinds ?? []);
      expect(kinds.some((k) => k.includes("execution") && k.includes("device") && !k.includes("detection"))).toBe(false);
      expect(list.mock.calls.some((c) => c[0].since !== undefined)).toBe(false);
    });

    it("거르기 결과가 기억 모양 검사에 걸리면 반성은 실패로 남고 판본은 늘지 않는다", async () => {
      const db = HistoryDb.open(":memory:");
      db.add("detection", t, "사람 보임");
      const r = await runReflection(db, await startPam(SEED_C()), "2026-11-07", {
        filter: (i) => ({ memory: { ...i.proposed, initial_state: "nowhere" }, notes: [] }),
      });
      expect(r.ok).toBe(false);
      // 반성은 그날 기억을 읽기만 하므로 실패하면 seed 판본도 남기지 않는다
      expect(db.latestMemoryVersion()).toBeNull();
      expect(db.list({ kinds: ["reflection"] }).at(-1)!.text).toMatch(/^반성 실패: /);
    });
  });

  it("다음 날 판단이 이미 판본을 정했으면 그날은 바꾸지 않고 그다음 날부터 쓴다", async () => {
    const db = HistoryDb.open(":memory:");
    expect(memoryForDay(db, "2026-11-08").version).toBe(1); // 11-08 판단이 먼저 시작함
    db.add("detection", Date.UTC(2026, 10, 7, 1), "사람 보임");
    expect(await runReflection(db, await startPam(SEED_C()), "2026-11-07")).toEqual({ ok: true, version: 2, appliesDay: "2026-11-09", learned: [], active: [], dropped: [] });
    expect(memoryForDay(db, "2026-11-08").version).toBe(1);
    expect(memoryForDay(db, "2026-11-09").version).toBe(2);
  });

  it("PAM이 알린 입력 한도에 맞춰 하루 요약을 줄여 보낸다", async () => {
    const db = HistoryDb.open(":memory:");
    for (let i = 0; i < 3000; i++) db.add("world", Date.UTC(2026, 10, 7, 0, 0, i), `컵 cup_${i % 5} 상태 ${i}`);
    const pam = await startPam(SEED_C());
    await runReflection(db, pam, "2026-11-07");
    const sent = got.at(-1)!;
    const size = Buffer.byteLength(sent.observation_text) + Buffer.byteLength(sent.action_summary) + Buffer.byteLength(JSON.stringify(sent.memory, null, 2));
    expect(size).toBeLessThanOrEqual((await pam.limits()).reflect_input_bytes);
    expect(sent.observation_text.split("\n")[0]).toMatch(/^앞선 기록 \d+줄 생략$/);
    expect(sent.action_summary.split("\n\n")[0]).toBe("행동 없음");
  });

  it("입력 한도가 커도 pam-reflect/3 칸 상한(관찰 100,000·행동 50,000·피드백 8,000자)을 넘지 않는다", async () => {
    const db = HistoryDb.open(":memory:");
    const at = (i: number) => Date.UTC(2026, 10, 7, 0, 0, 0, i * 10);
    for (let i = 0; i < 4000; i++) db.add("world", at(i), `컵 cup_${i % 5} 상태 바뀜 번호 ${i}`);
    for (let i = 0; i < 2000; i++) db.add("decision", at(i), `컵 치우기 판단 번호 ${i}`);
    for (let i = 0; i < 400; i++) db.add("feedback", at(i), `피드백 번호 ${i} 다 마신 뒤에 치워 줘`);
    // 덩어리 기록(초마다 한 덩어리, 긴 글)이 관찰 칸 상한을 넘으면 최근 덩어리부터 담고 첫 줄에 뺀 줄 수를 적는다
    const long = (v: ChunkView) => ({ chunks: [...new Set(v.lines.map((l) => l.substring(0, 8)))].map((t) => ({ start: t, end: t, text: "덩어리 ".repeat(2000) })) });
    const r = await runReflection(db, await startPam(SEED_C(), { PAM_MAX_MODEL_LEN: "4000000" }, long), "2026-11-07");
    expect(r.ok).toBe(true);
    const sent = got.at(-1)!;
    expect(Buffer.byteLength(sent.observation_text)).toBeLessThanOrEqual(100_000);
    expect(Buffer.byteLength(sent.action_summary)).toBeLessThanOrEqual(50_000);
    expect(Buffer.byteLength(sent.feedback!)).toBeLessThanOrEqual(8_000);
    expect(sent.observation_text.split("\n")[0]).toMatch(/^앞선 기록 \d+줄 생략$/);
    expect(sent.action_summary.split("\n")[0]).toMatch(/^앞선 기록 \d+줄 생략$/);
    expect(sent.feedback!.split("\n").at(-1)).toBe("피드백 번호 399 다 마신 뒤에 치워 줘");
  });

  it("그날 기록이 없으면 PAM을 부르지 않고 실패를 기록한다", async () => {
    const db = HistoryDb.open(":memory:");
    const logs: BrainLog[] = [];
    const r = await runReflection(db, pamClientFor({ url: "http://127.0.0.1:9/v1" }), "2026-11-07", { emit: (l) => logs.push(l) });
    expect(r).toEqual({ ok: false, empty: true, error: "그날 기록 없음" });
    expect(db.list({ kinds: ["reflection"] }).map((x) => x.text)).toEqual(["반성 실패: 그날 기록 없음"]);
    expect(logs).toEqual([expect.objectContaining({ type: "reflection", ok: false, version: null, applies_day: null })]);
  });

  it("PAM에 닿지 않으면 실패를 기록하고 기억은 그대로다", async () => {
    const db = HistoryDb.open(":memory:");
    db.add("detection", Date.UTC(2026, 10, 7, 1), "사람 보임");
    const r = await runReflection(db, pamClientFor({ url: "http://127.0.0.1:9/v1" }), "2026-11-07");
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/PAM LLM 연결 실패/) });
    expect(db.list({ kinds: ["reflection"] })[0]!.text).toMatch(/^반성 실패: PAM LLM 연결 실패/);
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
    fakePam = await startFakePamLlm();
    running = await startServer({ env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), ...pamLlmEnv(fakePam), ...extra }, log: () => {} });
    return running;
  }
  const post = async (body: unknown) => {
    const r = await fetchRetry(`${running!.url}/api/reflection/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as Record<string, any> };
  };

  it("서버를 끄면 진행 중인 반성 요청을 끊고 끝날 때까지 기다린 뒤 DB를 닫는다", async () => {
    let got = false;
    let cut = false;
    const hang = createServer((_req, res) => { got = true; res.on("close", () => { cut = true; }); });
    const { port } = await listenRetry(hang, 0, "127.0.0.1");
    try {
      running = await startServer({ env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PAM_LLM_BASE_URL: `http://127.0.0.1:${port}/v1`, PAM_LLM_API_KEY: "fake-key" }, log: () => {} });
      running.history.add("detection", Date.UTC(2026, 10, 7, 1), "사람 보임");
      const pending = post({ day: "2026-11-07" }).catch(() => null);
      const end = Date.now() + 5000;
      while (!got && Date.now() < end) await new Promise((ok) => setTimeout(ok, 20));
      expect(got).toBe(true);
      const t0 = Date.now();
      await running.close();
      running = undefined;
      expect(Date.now() - t0).toBeLessThan(5000);
      // 끊긴 요청의 소켓 닫힘이 PAM LLM 쪽에 닿을 때까지
      const until = Date.now() + 2000;
      while (!cut && Date.now() < until) await new Promise((ok) => setTimeout(ok, 20));
      expect(cut).toBe(true);
      await pending;
    } finally {
      hang.closeAllConnections();
      hang.close();
    }
  });

  it("끊긴 반성은 그날 고정·seed 판본·기록을 남기지 않는다", async () => {
    const db = HistoryDb.open(":memory:");
    db.add("detection", Date.UTC(2026, 10, 6, 23), "사람 보임");
    const ac = new AbortController();
    const hang = ((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)))) as typeof fetch;
    const run = runReflection(db, pamClientFor({ url: "http://pam.invalid/v1" }, { fetchImpl: hang }), "2026-11-07", { signal: ac.signal });
    await new Promise((ok) => setTimeout(ok, 30));
    ac.abort();
    expect(await run).toEqual({ ok: false, error: REFLECT_TEXT.cancelled });
    expect(db.pinnedMemory("2026-11-07")).toBeNull();
    expect(db.latestMemoryVersion()).toBeNull();
    expect(db.list({ kinds: ["reflection"] })).toEqual([]);
  });

  it("습관 거르기 중 끊기면 새 판본·성공 기록을 남기지 않는다", async () => {
    const db = HistoryDb.open(":memory:");
    db.add("detection", Date.UTC(2026, 10, 6, 23), "사람 보임");
    const ac = new AbortController();
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => Response.json({ model: "pam", choices: [{ message: { content: answerOf(init) }, finish_reason: "stop" }] })) as unknown as typeof fetch;
    const r = await runReflection(db, pamClientFor({ url: "http://pam.invalid/v1" }, { fetchImpl }), "2026-11-07", {
      signal: ac.signal, filter: async (x) => { ac.abort(); return { memory: x.proposed, notes: [] }; },
    });
    expect(r).toEqual({ ok: false, error: REFLECT_TEXT.cancelled });
    expect(db.latestMemoryVersion()).toBeNull();
    expect(db.list({ kinds: ["reflection"] })).toEqual([]);
  });

  it("반성 기록에 PAM 사용량(그 밤에 부른 호출을 모두 더한 것)을 남긴다", async () => {
    const db = HistoryDb.open(":memory:");
    const t = Date.UTC(2026, 10, 6, 23);
    db.add("detection", t, "사람 보임");
    const logs: BrainLog[] = [];
    let calls = 0;
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => { calls++; return Response.json({ model: "pam", choices: [{ message: { content: answerOf(init) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3000, completion_tokens: 900 } }); }) as unknown as typeof fetch;
    const r = await runReflection(db, pamClientFor({ url: "http://pam.invalid/v1" }, { fetchImpl }), "2026-11-07", { emit: (l) => logs.push(l), now: () => t + 3_600_000 });
    expect(r.ok).toBe(true);
    expect(calls).toBeGreaterThan(1);
    const usage = { model: "pam", prompt: 3000 * calls, completion: 900 * calls, cached: 0, cost_usd: null };
    expect(logs.find((l) => l.type === "reflection")).toMatchObject({ usage });
    expect(db.list({ kinds: ["reflection"] })[0]!.data).toMatchObject({ usage });
  });

  it("POST /api/reflection/run: 그날을 반성하고 결과를 대시보드 판단 기록으로 보낸다", async () => {
    const s = await start();
    s.history.add("detection", Date.UTC(2026, 10, 7, 1), "사람 보임");
    const box: Record<string, any>[] = [];
    const dash = await openWebSocket(`${s.url.replace(/^http/, "ws")}/events`, { setup: (ws) => ws.on("message", (d) => box.push(JSON.parse(String(d)))) });
    try {
      const r = await post({ day: "2026-11-07" });
      expect(r).toEqual({ status: 200, json: { ok: true, day: "2026-11-07", version: 2, appliesDay: "2026-11-08" } });
      expect(fakePam!.bodies.filter((b) => b.role === "reflect").at(-1)).toMatchObject({ role: "reflect", memory_kind: "fsm_candidates" });
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
