// 반성과 기억 판본(src/history/reflect.ts): 하루 관찰 텍스트·행동 요약·피드백 → pam-reflect/2 → 새 판본은 다음 날부터.
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CUP_FSM_MEMORY } from "../src/brain/decision.js";
import { PamClient } from "../src/brain/pam.js";
import type { BrainLog } from "../src/contract/events.js";
import { HistoryDb } from "../src/history/db.js";
import { loadReflectAt, memoryForDay, runReflection, scheduleReflection } from "../src/history/reflect.js";
import { fetchRetry, listenRetry } from "../src/server/net.js";
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
    expect(r).toEqual({ ok: true, version: 2, appliesDay: "2026-11-08" });
    expect(got.at(-1)).toMatchObject({ contract: "pam-reflect/2", day: "2026-11-07", memory_kind: "fsm", memory: CUP_FSM_MEMORY, feedback: "다 마신 뒤에만 치워 줘" });
    expect(got.at(-1)!.observation_text).toContain("08:00:00 사람 보임");
    expect(got.at(-1)!.action_summary).toBe("08:01:00 클로이드 판단: 컵 치우기\n08:02:00 사용자: 다 마신 뒤에만 치워 줘");
    expect(memoryForDay(db, "2026-11-07").version).toBe(1); // 그날은 그대로
    expect(memoryForDay(db, "2026-11-08")).toMatchObject({ version: 2, memory: { initial_state: "left_cup" } });
    expect(db.list({ kinds: ["reflection"] })).toEqual([expect.objectContaining({
      at_ms: t + 3_600_000, text: "반성 완료: 기억 2판, 2026-11-08부터", data: { day: "2026-11-07", ok: true, version: 2, applies_day: "2026-11-08" },
    })]);
    expect(logs).toEqual([{ type: "reflection", at_ms: t + 3_600_000, day: "2026-11-07", ok: true, version: 2, applies_day: "2026-11-08", text: "반성 완료: 기억 2판, 2026-11-08부터" }]);
  });

  it("다음 날 판단이 이미 판본을 정했으면 그날은 바꾸지 않고 그다음 날부터 쓴다", async () => {
    const db = HistoryDb.open(":memory:");
    expect(memoryForDay(db, "2026-11-08").version).toBe(1); // 11-08 판단이 먼저 시작함
    db.add("detection", Date.UTC(2026, 10, 7, 1), "사람 보임");
    expect(await runReflection(db, new PamClient({ url: await startPam({ ...CUP_FSM_MEMORY, initial_state: "left_cup" }) }), "2026-11-07")).toEqual({ ok: true, version: 2, appliesDay: "2026-11-09" });
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
    running = await startServer({ env: { HUB: "memory", PORT: "0", AGENT_PROVIDER: "mock", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PAM_URL: fakePam.url, ...extra }, log: () => {} });
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
