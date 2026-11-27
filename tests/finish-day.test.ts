// 하루 마치기(POST /api/day/finish, FINISH_DAY=1): 판단·습관 방문 멈춤 → 오늘 반성 → 진행 중인 일 다시 보기 → 다음 날로 넘김 → 넘긴 날은 새 판본.
// 막기 규칙은 finishBlock, 차례는 finishDayRunner(src/server/finish-day.ts). 대시보드로 나가는 반성 사건에는 모델이 쓴 글이 없다(publicReflection).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addDays } from "../src/brain/history/db.js";
import { DAY_TEXT, REFLECT_TEXT } from "../src/brain/history/labels.js";
import type { ReflectResult } from "../src/brain/history/reflect.js";
import { publicReflection } from "../src/brain/history/reflection-wire.js";
import type { BrainLog } from "../src/contract/events.js";
import { busyNow, finishBlock, finishDayRunner, homeBusy, homeDayMoved, reflectBlocked } from "../src/server/finish-day.js";
import { fetchRetry } from "../src/shared/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { pamLlmEnv, startFakePamLlm, type FakePamLlm, type FakePamLlmOptions } from "./helpers/pam.js";
import { openWebSocket } from "./helpers/ws.js";

let srv: RunningServer | undefined;
let pam: FakePamLlm | undefined;
afterEach(async () => {
  await srv?.close(); srv = undefined;
  await pam?.close(); pam = undefined;
});
type Msg = Record<string, any>;
type Ev = Extract<BrainLog, { type: "reflection" }>;
async function start(extra: Record<string, string> = {}, fake: FakePamLlmOptions = {}) {
  pam = await startFakePamLlm(fake);
  srv = await startServer({ env: { HUB: "memory", PORT: "0", REFLECT_AT: "off", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), ...pamLlmEnv(pam), ...extra }, log: () => {} });
  return srv;
}
const call = async (path: string, body?: unknown) => {
  const r = await fetchRetry(`${srv!.url}${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Msg };
};
const until = async (ok: () => boolean) => { const end = Date.now() + 3000; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); };
const listen = (s: RunningServer, box: Msg[]) => openWebSocket(`${s.url.replace(/^http/, "ws")}/events`, { setup: (ws) => ws.on("message", (d) => box.push(JSON.parse(String(d)))) });
const isReflection = (m: Msg) => m.type === "brain" && m.event?.type === "reflection";
/** 뜻 검사가 두 번 다 모델 까닭으로 거절한다(반성 기억을 쓰지 않음). */
const REJECT: FakePamLlmOptions = { check: () => ({ ok: false, items: [{ kind: "state", ref: "drinking", ok: false, why: "모델 까닭" }] }) };

describe("막기 규칙", () => {
  const base = { enabled: true, mode: "test" as const, closing: false, reflecting: false, today: "2026-11-27", day: "2026-11-27", busy: false };
  it("켜지 않았으면 404, 실제 모드·반성 중·오늘이 아님·진행 중인 일이면 409", () => {
    expect(finishBlock(base)).toBeNull();
    expect(finishBlock({ ...base, enabled: false })).toEqual({ status: 404, error: DAY_TEXT.off });
    expect(finishBlock({ ...base, mode: "live" })).toEqual({ status: 409, error: DAY_TEXT.live });
    expect(finishBlock({ ...base, reflecting: true })).toEqual({ status: 409, error: REFLECT_TEXT.running });
    expect(finishBlock({ ...base, closing: true })).toEqual({ status: 409, error: REFLECT_TEXT.running });
    expect(finishBlock({ ...base, day: "2026-11-26" })).toEqual({ status: 409, error: DAY_TEXT.notToday("2026-11-27") });
    expect(finishBlock({ ...base, busy: true })).toEqual({ status: 409, error: DAY_TEXT.busy });
  });
});

describe("반성 잠금", () => {
  it("반성 중이거나 하루 마치기 중이면 다른 반성을 막고, 하루 마치기의 반성만 지난다", () => {
    expect(reflectBlocked({ reflecting: false, closing: null, finish: false })).toBe(false);
    expect(reflectBlocked({ reflecting: true, closing: null, finish: false })).toBe(true);
    expect(reflectBlocked({ reflecting: false, closing: "2026-11-27", finish: false })).toBe(true);
    expect(reflectBlocked({ reflecting: false, closing: "2026-11-27", finish: true })).toBe(false);
  });
});

describe("진행 중인 일", () => {
  const idle = { plan: null, goal: null, checking: false, deciding: 0, habitVisit: false, roomVisit: false };
  it("열린 계획·세운 목표·확인 방문·답을 기다리는 판단·습관 방문·사용자 찾기 가운데 하나라도 있으면 참", () => {
    expect(busyNow(idle)).toBe(false);
    for (const status of ["planned", "running"]) expect(busyNow({ ...idle, plan: { status } })).toBe(true);
    expect(busyNow({ ...idle, plan: { status: "done" } })).toBe(false);
    for (const status of ["armed", "checking", "fired"]) expect(busyNow({ ...idle, goal: { status } })).toBe(true);
    expect(busyNow({ ...idle, goal: { status: "dropped" } })).toBe(false);
    expect(busyNow({ ...idle, checking: true })).toBe(true);
    expect(busyNow({ ...idle, deciding: 1 })).toBe(true);
    expect(busyNow({ ...idle, habitVisit: true })).toBe(true);
    expect(busyNow({ ...idle, roomVisit: true })).toBe(true);
  });

  it("집 묶음의 칸(계획·목표·확인 방문·판단·습관 방문·사용자 찾기)을 하나씩 읽는다", () => {
    const core = () => ({
      plans: { current: () => null as { status: string } | null }, goal: null as { status: string } | null, checkingVisit: null as unknown,
      decider: { inflight: () => 0 } as { inflight(): number } | null, habitWatch: { waiting: () => false }, roomWatch: { isBusy: () => false },
    });
    expect(homeBusy(core())).toBe(false);
    expect(homeBusy({ ...core(), decider: null, habitWatch: undefined, roomWatch: undefined })).toBe(false);
    expect(homeBusy({ ...core(), plans: { current: () => ({ status: "running" }) } })).toBe(true);
    expect(homeBusy({ ...core(), goal: { status: "armed" } })).toBe(true);
    expect(homeBusy({ ...core(), checkingVisit: {} })).toBe(true);
    expect(homeBusy({ ...core(), decider: { inflight: () => 1 } })).toBe(true);
    expect(homeBusy({ ...core(), habitWatch: { waiting: () => true } })).toBe(true);
    expect(homeBusy({ ...core(), roomWatch: { isBusy: () => true } })).toBe(true);
  });
});

describe("넘긴 뒤", () => {
  it("판단 기억과 도움 습관을 다시 읽고, 넘기기 전 반성이 있으면 말풍선에 넘긴다", () => {
    const calls: string[] = [];
    const core = { invalidateMemory: () => { calls.push("기억"); }, routinesChanged: () => { calls.push("습관"); } };
    homeDayMoved(core, null, () => calls.push("말"));
    expect(calls).toEqual(["기억", "습관"]);
    homeDayMoved(core, { type: "reflection", day: "2026-11-27", ok: true } as Ev, (e) => calls.push(`말 ${e.day}`));
    expect(calls.slice(2)).toEqual(["기억", "습관", "말 2026-11-27"]);
  });
});

const wait = () => new Promise((r) => setTimeout(r, 5));
const OK: ReflectResult = { ok: true, version: 3, appliesDay: "2026-11-28", learned: [], active: [], dropped: [] };
function runner(o: { busyAfter?: boolean; result?: ReflectResult } = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  let busy = false;
  const r = finishDayRunner({
    enabled: true, mode: () => "test", today: () => "2026-11-27", reflecting: () => false, busy: () => busy,
    hold: (on) => { calls.push(`hold ${on}`); },
    flush: async () => { await wait(); calls.push("flush"); },
    reflect: async (day) => {
      await wait();
      calls.push(`reflect ${day}`);
      r.onReflection({ type: "reflection", day, ok: true } as Ev);
      if (o.busyAfter) busy = true;
      return o.result ?? OK;
    },
    skip: async (day) => { await wait(); calls.push(`skip ${day}`); return { from: day, to: addDays(day, 1), version: 3 }; },
    moved: (e) => { calls.push(`moved ${e?.day ?? "없음"}`); },
    speak: (e) => { calls.push(`speak ${e.day}`); },
    sendDay: () => { calls.push(`day ${r.closing() ?? "-"}`); },
    log: (line) => { logs.push(line); },
  });
  return { r, calls, logs };
}

describe("하루 마치기 차례", () => {
  it("멈춤 → closing 방송 → 쓰기 비우기 → 반성 → 넘김 → 새로 읽기·말풍선 → 멈춤 풀기 → 방송. 반성 중 사건은 바로 말하지 않는다", async () => {
    const { r, calls } = runner();
    expect(await r.run("2026-11-27")).toEqual({ ok: true, from: "2026-11-27", to: "2026-11-28", version: 3, applies_day: "2026-11-28" });
    expect(calls).toEqual(["hold true", "day 2026-11-27", "flush", "reflect 2026-11-27", "skip 2026-11-27", "moved 2026-11-27", "hold false", "day -"]);
  });

  it("반성 뒤 진행 중인 일이 생겼으면 넘기지 않고 409", async () => {
    const { r, calls } = runner({ busyAfter: true });
    await expect(r.run("2026-11-27")).rejects.toMatchObject({ status: 409, message: DAY_TEXT.busy });
    expect(calls.filter((c) => c.startsWith("skip") || c.startsWith("moved"))).toEqual([]);
    expect(calls.slice(-2)).toEqual(["hold false", "day -"]);
  });

  it("반성이 실패하면 넘기지 않고 502(고정 글, 모델 까닭은 서버 로그에만), 빈 날이면 409", async () => {
    const failed = runner({ result: { ok: false, error: "모델 까닭" } });
    await expect(failed.r.run("2026-11-27")).rejects.toMatchObject({ status: 502, message: DAY_TEXT.failed });
    expect(failed.logs.some((l) => l.includes("모델 까닭"))).toBe(true);
    const empty = runner({ result: { ok: false, error: REFLECT_TEXT.empty, empty: true } });
    await expect(empty.r.run("2026-11-27")).rejects.toMatchObject({ status: 409, message: DAY_TEXT.empty });
    expect([...failed.calls, ...empty.calls].some((c) => c.startsWith("skip"))).toBe(false);
  });

  it("하루 마치기 밖의 반성 사건은 바로 말한다", () => {
    const { r, calls } = runner();
    r.onReflection({ type: "reflection", day: "2026-11-26", ok: true } as Ev);
    expect(calls).toEqual(["speak 2026-11-26"]);
  });
});

describe("대시보드로 나가는 반성 사건", () => {
  it("화살표 사건·조건, 뺀 후보 조건, 거절 까닭, 실패 까닭이 든 글을 뺀다. 숫자와 상태·행동 id는 남긴다", () => {
    const edge = { from: "drinking", to: "away", on: "모델 사건", when: "모델 조건", action: "컵 치우기" };
    const done = publicReflection({
      type: "reflection", at_ms: 1, day: "2026-11-27", ok: true, version: 3, applies_day: "2026-11-28", text: REFLECT_TEXT.done(3, "2026-11-28"),
      learned: [edge], active: [edge], rejected: null,
      dropped: [{ from: "cooking", to: "cooking", on: "모델 사건", action: "라면 끓이기 알려 주기", kept: false, reason: "coach", conditions: ["모델 조건"] }],
      checks: [{ state: "drinking", action: "컵 치우기", on: "모델 사건", when: "모델 조건", n: 2, k: 2, unknown: 0, rate: 1, base_rate: 0, p0: 0.01, p_value: 0.0001, passed: true }],
    });
    expect(JSON.stringify(done)).not.toMatch(/모델/);
    expect(done).toMatchObject({ ok: true, version: 3, text: REFLECT_TEXT.done(3, "2026-11-28"), learned: [{ from: "drinking", to: "away", action: "컵 치우기" }], checks: [{ n: 2, k: 2, p_value: 0.0001, passed: true }] });
    const rejected = publicReflection({ type: "reflection", at_ms: 1, day: "2026-11-27", ok: false, version: null, applies_day: null, text: REFLECT_TEXT.rejected("모델 까닭"), rejected: "모델 까닭" });
    expect(rejected.text).toBe(REFLECT_TEXT.notUsed);
    expect(JSON.stringify(rejected)).not.toMatch(/모델/);
    const failed = publicReflection({ type: "reflection", at_ms: 1, day: "2026-11-27", ok: false, version: null, applies_day: null, text: REFLECT_TEXT.failed("모델 오류 글") });
    expect(failed.text).toBe(REFLECT_TEXT.failedPlain);
    const empty = publicReflection({ type: "reflection", at_ms: 1, day: "2026-11-27", ok: false, version: null, applies_day: null, text: REFLECT_TEXT.failed(REFLECT_TEXT.empty) });
    expect(empty.text).toBe(REFLECT_TEXT.failed(REFLECT_TEXT.empty));
  });
});

describe("하루 마치기 API", () => {
  it("FINISH_DAY가 없으면 POST는 404이고 GET /api/day는 넘김 없는 오늘이다", async () => {
    await start();
    const day = await call("/api/day");
    expect(day.json).toMatchObject({ ok: true, shift: 0, finish: false, closing: false });
    expect(day.json.today).toBe(day.json.real_today);
    expect((await call("/api/day/finish", { day: day.json.today })).status).toBe(404);
  });

  it("오늘을 반성하고 다음 날로 넘긴다: 넘긴 날은 새 판본에 고정되고 대시보드는 day 메시지를 받는다. 같은 날로 다시 부르면 409", async () => {
    const s = await start({ FINISH_DAY: "1" });
    await s.historyWriter.add("detection", Date.now(), "사람 보임");
    await s.historyWriter.flush();
    const before = (await call("/api/day")).json;
    const box: Msg[] = [];
    const dash = await listen(s, box);
    try {
      const r = await call("/api/day/finish", { day: before.today });
      expect(r.status).toBe(200);
      const to = addDays(before.today, 1);
      expect(r.json).toMatchObject({ ok: true, from: before.today, to, applies_day: to });
      expect((await call("/api/day")).json).toMatchObject({ today: to, real_today: before.real_today, shift: 1, finish: true, closing: false });
      expect((await call(`/api/memory/day/${to}`)).json.pinned).toBe(r.json.version);
      await until(() => box.filter((m) => m.type === "day").length >= 3);
      expect(box.filter((m) => m.type === "day").map((m) => [m.day.closing, m.day.shift])).toEqual([[false, 0], [true, 0], [false, 1]]);
      expect((await call("/api/day/finish", { day: before.today })).status).toBe(409);
    } finally {
      dash.close();
    }
  });

  it("넘긴 뒤 새로 붙은 대시보드는 넘기기 전 날의 반성 사건을 다시 받는다", async () => {
    const s = await start({ FINISH_DAY: "1" });
    await s.historyWriter.add("detection", Date.now(), "사람 보임");
    await s.historyWriter.flush();
    const before = (await call("/api/day")).json;
    expect((await call("/api/day/finish", { day: before.today })).status).toBe(200);
    const box: Msg[] = [];
    const dash = await listen(s, box);
    try {
      await until(() => box.some(isReflection));
      expect(box.find(isReflection)?.event.day).toBe(before.today);
    } finally {
      dash.close();
    }
  });

  it("그날 기록이 없으면 넘기지 않는다", async () => {
    await start({ FINISH_DAY: "1" });
    const before = (await call("/api/day")).json;
    const r = await call("/api/day/finish", { day: before.today });
    expect(r.status).toBe(409);
    expect((await call("/api/day")).json.shift).toBe(0);
  });

  it("반성 기억을 쓰지 않으면 502이고, 응답·대시보드 반성 사건(바로 받은 것, 새로 붙어 받은 것)에 모델 까닭이 없다", async () => {
    const s = await start({ FINISH_DAY: "1" }, REJECT);
    await s.historyWriter.add("detection", Date.now(), "사람 보임");
    await s.historyWriter.flush();
    const before = (await call("/api/day")).json;
    const box: Msg[] = [];
    const dash = await listen(s, box);
    const late: Msg[] = [];
    let again: Awaited<ReturnType<typeof listen>> | undefined;
    try {
      const r = await call("/api/day/finish", { day: before.today });
      expect(r.status).toBe(502);
      expect(r.json.error).toBe(DAY_TEXT.failed);
      await until(() => box.some(isReflection));
      again = await listen(s, late);
      await until(() => late.some(isReflection));
      for (const m of [r.json, box.find(isReflection), late.find(isReflection)]) {
        expect(m).toBeDefined();
        expect(JSON.stringify(m)).not.toContain("모델 까닭");
      }
      expect((await call("/api/day")).json.shift).toBe(0);
    } finally {
      dash.close();
      again?.close();
    }
  });
});
