// 기록 DB 쓰기 작업 스레드(src/record/thread-writer.ts)의 약속:
// 커밋 전에는 ack하지 않는다, 쓰기가 실패하면 버스가 다시 준다, 같은 메시지는 한 줄, 묶음 안 한 건 실패가 나머지를 막지 않는다,
// 닫을 때 남은 묶음을 커밋한다, 작업 스레드가 죽으면 기다리던 쓰기가 실패로 돌아오고 연속 3번이면 쓰지 않는다.
// 구조: 서버 메인 스레드의 기록 DB 연결은 읽기 전용이라 거기로 쓰면 실패한다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryDb } from "../src/brain/history/db.js";
import { BusNode, MemoryBus, VirtualClock, type Deliver, type NodeName, type ReadMode, type TopicName } from "../src/bus/index.js";
import { settle } from "../src/record/replay.js";
import { CUP_FSM_MEMORY } from "../src/brain/decision.js";
import { historyRoutesVia, ThreadWriter, writeBatch, type HistoryWriter } from "../src/record/index.js";
import { startServer, type RunningServer } from "../src/server/start.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });

async function openWriter(o: { windowMs?: number } = {}) {
  const path = join(mkdtempSync(join(tmpdir(), "writer-")), "noonchi.db");
  const workers: Worker[] = [];
  const logs: string[] = [];
  const thread = await ThreadWriter.open(path, { offsetMinutes: 540, log: (l) => logs.push(l), onWorker: (w) => workers.push(w), ...o });
  const writer = thread.api();
  cleanup.push(() => writer.close());
  const read = HistoryDb.open(path, 540, { readOnly: true });
  cleanup.push(() => read.close());
  return { path, writer, read, workers, logs };
}

/** 기록 노드(서버와 같은 historyRoutesVia)와 그 토픽에 보내는 실행 노드. */
async function recorderOn(writer: HistoryWriter, logs: string[], onLog: (line: string) => void = () => {}) {
  const bus = new MemoryBus({ warn: () => {} });
  const epoch = { boot: "b1", home: "h#1" };
  const recorder = new BusNode({ name: "recorder", bus, epoch, log: () => {} });
  historyRoutesVia(recorder, writer, { now: () => Date.now(), machinesOnly: true, log: (l) => { logs.push(l); onLog(l); } });
  await recorder.prepare();
  recorder.start();
  const act = new BusNode({ name: "act", bus, epoch, log: () => {} });
  cleanup.push(async () => { await act.stop(); await recorder.stop(); await bus.close(); });
  const send = (i: number) => act.publish("/act/log", { type: "execution", at_ms: 1_000 + i, plan_id: `p-${i}`, state: "running", text: `일 ${i}` });
  /** 폰 단계 명령(같은 명령·단계를 다시 보내면 기록 노드가 줄을 겹쳐 쓰지 않는다). */
  const step = (id: string, stepId: string) => act.publish("/act/phone_changes", { cmd: { type: "command", id, step: stepId, kind: "go", text: "싱크대로 가 주세요",
    vision: null, choices: [], speak: true, target: { id: "sink", label: "싱크대", position: [0, 0, 0] } } });
  return { bus, recorder, send, step };
}

const rows = (read: HistoryDb) => read.list({ kinds: ["execution"] });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** ms 안에 끝나면 그 값, 아니면 "멈춤". */
const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, sleep(ms).then(() => "멈춤" as const)]);

describe("기록 DB 쓰기 작업 스레드", () => {
  it("커밋이 끝나기 전에는 메시지를 ack하지 않는다", async () => {
    const { path, writer, read, logs } = await openWriter();
    const { bus, send } = await recorderOn(writer, logs);
    // 다른 연결이 쓰기 잠금을 잡고 있으면 작업 스레드는 BEGIN IMMEDIATE에서 기다린다
    const blocker = new DatabaseSync(path);
    blocker.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
    await send(1);
    await new Promise((r) => setTimeout(r, 300));
    expect(bus.length("/act/log")).toBe(1);
    expect(rows(read)).toEqual([]);
    blocker.exec("ROLLBACK");
    blocker.close();
    await vi.waitFor(() => expect(bus.length("/act/log")).toBe(0), { timeout: 5000 });
    expect(rows(read).map((r) => r.subject)).toEqual(["p-1"]);
  });

  it("쓰기가 실패하면 ack하지 않아 버스가 다시 주고, 다시 받은 메시지를 한 줄로 쓴다", async () => {
    const { path, writer, read, logs } = await openWriter();
    // 첫 쓰기만 실패하게 하는 트리거(실패를 본 뒤 지운다)
    const admin = new DatabaseSync(path);
    cleanup.push(() => admin.close());
    admin.exec("PRAGMA busy_timeout = 5000; CREATE TRIGGER fail_once BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'disk says no'); END;");
    // 실패를 본 그때 트리거를 지운다(버스는 RETRY_MS 뒤 같은 메시지를 다시 준다)
    let failed = 0;
    let waitingAck = -1;
    const { bus, send } = await recorderOn(writer, logs, (l) => {
      if (!l.includes("disk says no") || failed++) return;
      waitingAck = bus.length("/act/log");
      admin.exec("DROP TRIGGER fail_once");
    });
    await send(1);
    await vi.waitFor(() => expect(failed).toBe(1), { timeout: 5000 });
    expect(waitingAck).toBe(1);
    await vi.waitFor(() => expect(bus.length("/act/log")).toBe(0), { timeout: 5000 });
    expect(rows(read).map((r) => r.subject)).toEqual(["p-1"]);
    expect((read.db.prepare("SELECT COUNT(*) AS n FROM bus_seen").get() as { n: number }).n).toBe(1);
  });

  it("같은 메시지가 두 번 와도 한 줄만 쓴다", async () => {
    const { writer, read } = await openWriter();
    const e = { topic: "/act/log" as const, key: "_", header: { stamp: 1, node: "act" as const, inst: "i", seq: 1, boot: "b", home: "h#1" },
      body: { type: "execution" as const, at_ms: 1, plan_id: "p", state: "running" as const, text: "한 번" } };
    const job = { session: "s", e, now: 1, keepHeard: false, machinesOnly: true };
    expect((await Promise.all([writer.record(job), writer.record(job)])).map((r) => r.fresh)).toEqual([true, false]);
    expect((await writer.record(job)).fresh).toBe(false);
    expect(rows(read)).toHaveLength(1);
  });

  it("한 묶음 안 한 건이 실패해도 나머지는 같은 커밋으로 쓴다", async () => {
    const { writer, read } = await openWriter();
    const before = await writer.stats();
    const good = [1, 2, 3].map((i) => writer.add("execution", i, `일 ${i}`, { subject: `p-${i}` }));
    const bad = writer.plan({} as never, 0);
    await expect(Promise.all(good)).resolves.toHaveLength(3);
    await expect(bad).rejects.toThrow();
    const after = await writer.stats();
    expect({ commits: after.commits - before.commits, batches: after.batches - before.batches, jobs: after.jobs - before.jobs }).toEqual({ commits: 1, batches: 1, jobs: 4 });
    expect(rows(read).map((r) => r.subject)).toEqual(["p-1", "p-2", "p-3"]);
  });

  it("닫을 때 아직 커밋하지 않은 쓰기를 커밋하고 닫는다", async () => {
    const { path, writer } = await openWriter({ windowMs: 1000 });
    const pending = Array.from({ length: 10 }, (_, i) => writer.add("execution", i, `일 ${i}`, { subject: `p-${i}` }));
    await writer.close();
    await expect(Promise.all(pending)).resolves.toHaveLength(10);
    const db = HistoryDb.open(path, 540, { readOnly: true });
    try {
      expect(rows(db)).toHaveLength(10);
    } finally {
      db.close();
    }
  });

  it("작업 스레드가 죽으면 기다리던 쓰기가 실패로 돌아오고, 다시 띄운 스레드로 쓴다. 연속 3번 죽으면 쓰지 않는다", async () => {
    // 작업 스레드가 묶음을 1초 모으는 동안 끝낸다(쓰기는 작업 스레드 안에서 기다리는 중)
    const { writer, read, workers, logs } = await openWriter({ windowMs: 1000 });
    const waiting = writer.add("execution", 1, "죽기 전", { subject: "lost" });
    await new Promise((r) => setTimeout(r, 100));
    await workers[0]!.terminate();
    await expect(waiting).rejects.toThrow(/작업 스레드가 끝나/);
    await vi.waitFor(() => expect(workers).toHaveLength(2), { timeout: 5000 });
    await writer.add("execution", 2, "다시 띄운 뒤", { subject: "kept" });
    expect(rows(read).map((r) => r.subject)).toEqual(["kept"]);
    expect(writer.writable()).toBe(true);
    // 커밋 없이 연속 3번 끝나면 다시 띄우지 않는다
    for (let n = 2; n <= 4; n++) {
      await vi.waitFor(() => expect(workers).toHaveLength(n), { timeout: 5000 });
      await workers[n - 1]!.terminate();
    }
    await vi.waitFor(() => expect(writer.writable()).toBe(false), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 200));
    expect(workers).toHaveLength(4);
    await expect(writer.add("execution", 3, "끝난 뒤", {})).rejects.toThrow(/작업 스레드가 끝나/);
    expect(logs.some((l) => l.includes("연속 3번"))).toBe(true);
  }, 30_000);
});

describe("기록 DB 쓰기 작업 스레드: 리뷰 뒤", () => {
  it("다시 띄운 작업 스레드가 연결을 열기 전에 닫다가 그 스레드도 죽으면 close가 끝나고 남은 쓰기는 실패로 돌아온다", async () => {
    const { writer, workers } = await openWriter();
    await writer.add("execution", 1, "처음", {});
    const n = workers.length;
    await workers.at(-1)!.terminate();
    await vi.waitFor(() => expect(workers.length).toBe(n + 1), { timeout: 5000 });
    const left = writer.add("execution", 2, "다시 띄우는 동안", {}).then(() => "커밋", (e: Error) => e.message);
    const closing = writer.close().then(() => "닫음");
    await workers.at(-1)!.terminate();
    expect(await within(closing, 8000)).toBe("닫음");
    expect(await within(left, 1000)).toMatch(/닫았|끝나/);
  }, 30_000);

  it("처음 연결을 열기 전에 닫다가 작업 스레드가 죽어도 close가 끝난다", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "writer-")), "noonchi.db");
    const workers: Worker[] = [];
    const thread = ThreadWriter.start(path, { offsetMinutes: 540, onWorker: (w) => workers.push(w) });
    const writer = thread.api();
    const closing = writer.close().then(() => "닫음");
    await workers.at(-1)!.terminate();
    expect(await within(closing, 8000)).toBe("닫음");
    expect(await within(thread.ready().then(() => "열림", () => "실패"), 1000)).not.toBe("멈춤");
  }, 30_000);

  it("작업 스레드가 다시 떠도 기록 노드의 중복 막기(같은 폰 단계는 한 줄)가 이어진다", async () => {
    const { writer, read, workers, logs } = await openWriter();
    const { step, bus } = await recorderOn(writer, logs);
    const sent = () => read.list({ kinds: ["household"] }).filter((r) => r.text === "폰 단계 전송");
    await step("cup", "go");
    await vi.waitFor(() => expect(sent()).toHaveLength(1), { timeout: 5000 });
    const n = workers.length;
    await workers.at(-1)!.terminate();
    await vi.waitFor(() => expect(workers.length).toBe(n + 1), { timeout: 5000 });
    await step("cup", "go");
    await vi.waitFor(() => expect(bus.length("/act/phone_changes")).toBe(0), { timeout: 8000 });
    await step("cup", "place");
    await vi.waitFor(() => expect(sent()).toHaveLength(2), { timeout: 8000 });
    expect(sent().map((r) => (r.data as { step: string }).step)).toEqual(["go", "place"]);
  }, 30_000);

  it("한 일이 쓰다가 던지면 그 일이 쓴 것만 되돌리고(SAVEPOINT) 같은 묶음의 다른 일은 커밋한다", async () => {
    const { writer, read } = await openWriter();
    const before = writer.add("execution", 1, "앞", { subject: "a" });
    // 밤 저장은 seed 판본·날 고정·로봇 판본을 쓴 뒤 반성 기록 data(BigInt)를 JSON으로 못 바꿔 던진다
    const bad = writer.saveNight({ day: "2026-10-01", appliesDay: "2026-10-02", kind: "list", robot: CUP_FSM_MEMORY, candidates: null, atMs: 1, learnedCount: 0, found: { big: 1n }, used: {} });
    const after = writer.add("execution", 2, "뒤", { subject: "b" });
    await expect(Promise.all([before, after])).resolves.toHaveLength(2);
    await expect(bad).rejects.toThrow(/BigInt/);
    expect(rows(read).map((r) => r.subject)).toEqual(["a", "b"]);
    expect(read.memoryVersions()).toEqual([]);
    expect(read.pinnedMemory("2026-10-01")).toBeNull();
  });

  it("바깥 COMMIT이 실패하면 묶음 전부 실패로 돌려주고 아무것도 남기지 않으며, 그 연결로 다음 묶음을 쓴다", () => {
    const db = HistoryDb.open(join(mkdtempSync(join(tmpdir(), "batch-")), "noonchi.db"));
    try {
      // 미룬 외래 키는 문장 때는 통과하고 COMMIT에서 실패한다
      db.db.exec("PRAGMA foreign_keys = ON; CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (pid INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);");
      const failed = writeBatch(db, [{ id: 1 }, { id: 2 }], (job) => (job.id === 1 ? db.add("execution", 1, "앞", {}) : db.db.exec("INSERT INTO child VALUES (99)")));
      expect(failed.committed).toBe(false);
      expect(failed.results.map((r) => [r.id, typeof r.error])).toEqual([[1, "string"], [2, "string"]]);
      expect(rows(db)).toEqual([]);
      const next = writeBatch(db, [{ id: 3 }], () => db.add("execution", 2, "뒤", { subject: "b" }));
      expect(next).toMatchObject({ committed: true, results: [{ id: 3 }] });
      expect(rows(db).map((r) => r.subject)).toEqual(["b"]);
    } finally {
      db.close();
    }
  });
});

/** 재생 도우미(tests/helpers/assistance-replay.ts)처럼 배달 중인 수도 조용함에 넣는 통로. */
class CountingBus extends MemoryBus {
  delivering = 0;
  override async subscribe<N extends TopicName>(topic: N, node: NodeName, deliver: Deliver<N>, o?: { mode?: ReadMode }) {
    return super.subscribe(topic, node, async (m) => { this.delivering++; try { return await deliver(m); } finally { this.delivering--; } }, o);
  }
  override quiet(): boolean { return super.quiet() && this.delivering === 0; }
}

describe("재생 장벽과 기록 쓰기", () => {
  it("장벽은 쓰기의 then에서 이어 보낸 쓰기(도움 줄 → 습관 다시 읽기)까지 기다린다", async () => {
    const { writer } = await openWriter();
    const clock = new VirtualClock(Date.UTC(2026, 10, 22, 11));
    const bus = new CountingBus({ clock, warn: () => {} });
    const epoch = { boot: "b", home: "h#1" };
    const devices = new BusNode({ name: "devices", bus, epoch, clock, log: () => {} });
    const act = new BusNode({ name: "act", bus, epoch, clock, log: () => {} });
    cleanup.push(async () => { await devices.stop(); await act.stop(); await bus.close(); });
    let step = "없음";
    let n = 0;
    // 서버 act.ts의 도움 줄처럼: 도움 줄 쓰기 → then 습관 다시 읽기 → then 목록 바꿈
    act.on("/device/result", () => {
      const k = ++n;
      step = `도움 ${k} 보냄`;
      void writer.add("help", clock.now(), "도움", { subject: "a" }).then(() => {
        step = `습관 ${k} 보냄`;
        return writer.routines(clock.now());
      }).then(() => { step = `습관 ${k} 끝`; });
    });
    for (const x of [devices, act]) await x.prepare();
    for (const x of [devices, act]) x.start();
    const after: string[] = [];
    for (let i = 1; i <= 10; i++) {
      await devices.publish("/device/result", { command_id: `c-${i}`, status: "done" });
      await settle(bus, [devices], undefined, () => writer.flush());
      after.push(step);
    }
    expect(after).toEqual(Array.from({ length: 10 }, (_, i) => `습관 ${i + 1} 끝`));
  }, 30_000);
});

describe("서버 기록 DB 연결", () => {
  let srv: RunningServer | undefined;
  afterEach(async () => { await srv?.close(); srv = undefined; });

  it("메인 스레드 연결은 읽기 전용이라 쓰면 실패하고, 쓰기는 HistoryWriter(기록 작업 스레드)로 한다", async () => {
    srv = await startServer({ env: { HUB: "memory", PORT: "0", HOME_ID: "oneroom", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")) }, log: () => {} });
    expect(() => srv!.history.add("feedback", 1, "메인에서 씀")).toThrow(/readonly/i);
    expect(() => srv!.history.cupAnswers.remember("oneroom", "r", true)).toThrow(/readonly/i);
    await srv.historyWriter.add("feedback", 1, "작업 스레드에서 씀");
    expect(srv.history.list({ kinds: ["feedback"] }).map((r) => r.text)).toEqual(["작업 스레드에서 씀"]);
  });
});
