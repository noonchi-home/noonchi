// 기록 노드: 반성용 기록 DB 줄은 쓴 뒤에만 ack하고, 기록 줄과 처리표가 한 트랜잭션이라 다시 와도 한 번만 남는다.
// 가전 기록기는 기기마다 지난 값을 든다. 녹화는 사진 칸을 뺀다.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HistoryDb } from "../src/brain/index.js";
import { BusNode, MemoryBus } from "../src/bus/index.js";
import { Bag, startRecorder } from "../src/record/index.js";
import { HEARD_MARK } from "../src/world/labels.js";

const EPOCH = { boot: "b1", home: "h#1" };
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const sender = async (name: "world" | "phone" | "devices" | "act", bus: MemoryBus) => {
  const n = new BusNode({ name, bus, epoch: EPOCH, log: () => {} });
  await n.prepare();
  n.start();
  return n;
};

describe("기록 노드", () => {
  it("World State 바뀜을 기록 DB에 지금과 같은 줄로 쓴다", async () => {
    const bus = new MemoryBus();
    const db = HistoryDb.open(":memory:");
    const rec = await startRecorder({ bus, epoch: EPOCH, db });
    rec.start();
    const world = await sender("world", bus);
    await world.publish("/world/changes", { rev: 1, changes: [{ kind: "appeared", at_ms: 1000, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }] });
    await tick();
    await rec.idle();
    expect(db.list({}).map((r) => [r.kind, r.text])).toEqual([["detection", "컵 cup_1 보임"]]);
  });

  it("미리 세운 목표의 전환(/brain/goal_changes, RELIABLE)은 한 번에 몰려도 녹화와 기록 DB에 같은 차례로 한 줄씩 남는다", async () => {
    const bus = new MemoryBus();
    const db = HistoryDb.open(":memory:");
    const bag = Bag.open(":memory:");
    const rec = await startRecorder({ bus, epoch: EPOCH, db, bag });
    rec.start();
    const act = await sender("act", bus);
    const goal = {
      id: "goal-1", action: "컵 치우기", state: "left_cup", trigger: "t", object: "cup_1", cls: "cup", status: "armed" as const, prep: "waiting" as const, reason: null, text: null,
      armed_ms: 1, ready_ms: null, gone_ms: null, fired_ms: null, plan: null,
    };
    const steps = [
      { status: "armed", prep: "waiting" }, { status: "armed", prep: "planning" }, { status: "armed", prep: "ready" }, { status: "fired", prep: "ready" }, { status: "used", prep: "ready" },
    ] as const;
    // 기다리지 않고 한 번에 낸다(STATE는 가운데 값을 합칠 수 있다)
    await Promise.all(steps.map((s) => act.publish("/brain/goal_changes", { goal: { ...goal, ...s } })));
    await tick();
    await rec.idle();
    const kept = bag.range(0, Number.MAX_SAFE_INTEGER).filter(({ e }) => e.topic === "/brain/goal_changes").map(({ e }) => (e.body as { goal: { status: string; prep: string } }).goal);
    expect(kept.map((g) => `${g.status}/${g.prep}`)).toEqual(steps.map((s) => `${s.status}/${s.prep}`));
    expect(db.list({}).map((r) => ({ kind: r.kind, subject: r.subject, data: r.data }))).toMatchObject(
      steps.map((s) => ({ kind: "goal", subject: "goal-1", data: s })),
    );
    await rec.stop();
    await act.stop();
    await bus.close();
    bag.close();
    db.close();
  });

  it("World State 변화의 프레임마다 분석 없음은 world_change로 다시 쓰지 않고(관찰 기록으로 남음), 들은 말은 표시만 쓴다", async () => {
    const bus = new MemoryBus();
    const db = HistoryDb.open(":memory:");
    const rec = await startRecorder({ bus, epoch: EPOCH, db });
    rec.start();
    const world = await sender("world", bus);
    const c = (kind: string, text: string) => ({ kind: kind as "appeared", at_ms: 1000, subject: "s", text, meaningful: false });
    await world.publish("/world/changes", { rev: 1, changes: [c("yolo_missing", "YOLO 없음"), c("vlm_missing", "VLM 없음"), c("heard", "들은 말: 컵 치워 줘")] });
    await tick();
    await rec.idle();
    expect(db.list({}).map((r) => r.text)).toEqual([HEARD_MARK]);
  });

  it("들은 말은 KEEP_HEARD_TEXT가 아니면 기록 DB와 녹화 모두 표시만 남기고, 켜면 그대로 남긴다", async () => {
    for (const keepHeard of [false, true]) {
      const bus = new MemoryBus();
      const db = HistoryDb.open(":memory:");
      const bag = Bag.open(":memory:");
      const rec = await startRecorder({ bus, epoch: EPOCH, db, bag, keepHeard });
      rec.start();
      const phone = await sender("phone", bus);
      const world = await sender("world", bus);
      await phone.publish("/phone/heard", { text: "컵 치워 줘", observed_ms: 1000 });
      await world.publish("/world/changes", { rev: 1, changes: [{ kind: "heard", at_ms: 1000, subject: "person", text: "들은 말: 컵 치워 줘", meaningful: true }] });
      await tick();
      await rec.idle();
      const want = (raw: string) => (keepHeard ? raw : HEARD_MARK);
      expect(db.list({}).map((r) => r.text)).toEqual([want("들은 말: 컵 치워 줘")]);
      const kept = bag.range(0, Number.MAX_SAFE_INTEGER).map(({ e }) => e.body as Record<string, any>);
      expect(kept.map((b) => b.text ?? b.changes?.[0]?.text)).toEqual([want("컵 치워 줘"), want("들은 말: 컵 치워 줘")]);
      expect(JSON.stringify(kept).includes("컵 치워 줘")).toBe(keepHeard);
    }
  });

  it("World State 변화의 기록 시각은 처리 시각이고, 근거(촬영) 시각은 data.observed_ms로 따로 남긴다", async () => {
    const bus = new MemoryBus();
    const db = HistoryDb.open(":memory:");
    const rec = await startRecorder({ bus, epoch: EPOCH, db, clock: { now: () => 50_000, every: () => () => {}, after: () => () => {} } });
    rec.start();
    const world = await sender("world", bus);
    await world.publish("/world/changes", { rev: 1, changes: [{ kind: "appeared", at_ms: 1000, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }] });
    await tick();
    await rec.idle();
    expect(db.list({}).map((r) => [r.at_ms, r.data])).toEqual([[50_000, { kind: "appeared", observed_ms: 1000 }]]);
  });

  it("녹화가 실패해 같은 메시지를 다시 받아도 기록 DB 줄은 한 번만 남는다", async () => {
    const bus = new MemoryBus();
    const db = HistoryDb.open(":memory:");
    const bag = Bag.open(":memory:");
    const write = bag.write.bind(bag);
    let fail = 1;
    bag.write = (e, at) => { if (fail-- > 0) throw new Error("녹화 실패"); write(e, at); };
    const rec = await startRecorder({ bus, epoch: EPOCH, db, bag });
    rec.start();
    const world = await sender("world", bus);
    await world.publish("/world/changes", { rev: 1, changes: [{ kind: "appeared", at_ms: 1000, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }] });
    await tick(400);
    await rec.idle();
    expect(db.list({ kinds: ["detection"] })).toHaveLength(1);
    expect(bag.range(0, Number.MAX_SAFE_INTEGER)).toHaveLength(1);
  });

  it("가전 기록기는 기기마다 지난 값을 들어, 처음 상태는 적지 않고 같은 값은 다시 적지 않는다. 기록 노드를 다시 만들어도 이어진다", async () => {
    const bus = new MemoryBus();
    const db = HistoryDb.open(":memory:");
    const tv = (on: boolean) => ({ id: "tv", online: true, twin: { on }, matter: {}, updatedAt: "2026-11-17T12:00:00Z" });
    const note = { label: "TV", kind: "tv" };
    const rec1 = await startRecorder({ bus, epoch: EPOCH, db });
    rec1.start();
    const dev = await sender("devices", bus);
    await dev.publish("/device/changes", { id: "tv", state: tv(false), note: { ...note, initial: true } });
    await dev.publish("/device/changes", { id: "tv", state: tv(true), note });
    await tick(100);
    await rec1.stop();
    const rec2 = await startRecorder({ bus, epoch: EPOCH, db });
    rec2.start();
    await dev.publish("/device/changes", { id: "tv", state: tv(true), note });
    await dev.publish("/device/changes", { id: "tv", state: tv(false), note });
    await tick(100);
    await rec2.idle();
    expect(db.list({ kinds: ["device"] }).map((r) => r.data)).toEqual([
      expect.objectContaining({ attr: "on", from: false, to: true }),
      expect.objectContaining({ attr: "on", from: true, to: false }),
    ]);
  });

  it("노드를 다시 만들어 seq가 1로 돌아와도 새 메시지는 중복으로 버려지지 않는다", async () => {
    const bus = new MemoryBus();
    const db = HistoryDb.open(":memory:");
    const rec = await startRecorder({ bus, epoch: EPOCH, db });
    rec.start();
    for (const text of ["컵 cup_1 보임", "컵 cup_2 보임"]) {
      const world = await sender("world", bus);
      await world.publish("/world/changes", { rev: 1, changes: [{ kind: "appeared", at_ms: 1000, subject: "cup", text, meaningful: true }] });
      await tick();
      await world.stop();
    }
    await rec.idle();
    expect(db.list({ kinds: ["detection"] }).map((r) => r.text)).toEqual(["컵 cup_1 보임", "컵 cup_2 보임"]);
  });

  it("/act/log의 사용자 답(feedback)을 기록 DB feedback 줄로 쓴다(반성 입력)", async () => {
    const bus = new MemoryBus({ warn: () => {} });
    const db = HistoryDb.open(":memory:");
    const rec = await startRecorder({ bus, epoch: EPOCH, db });
    rec.start();
    const act = new BusNode({ name: "act", bus, epoch: EPOCH, log: () => {} });
    await act.prepare();
    act.start();
    await act.publish("/act/log", { type: "feedback", at_ms: 1000, subject: "plan:pam-1", text: "완료 · 부탁: 식탁으로 가 주세요", data: { choice: "done", via: "button" } });
    await act.publish("/act/log", { type: "execution", at_ms: 1001, plan_id: "plan:pam-1", state: "done", text: "완료" });
    await tick(100);
    await rec.idle();
    expect(db.list({}).map((r) => [r.kind, r.text, r.subject])).toEqual([
      ["feedback", "완료 · 부탁: 식탁으로 가 주세요", "plan:pam-1"],
      ["execution", "완료", "plan:pam-1"],
    ]);
  });

  it("녹화에 사진 바이트(jpeg_b64)는 남기지 않는다", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "bag-")), "bag.sqlite");
    const bus = new MemoryBus();
    const bag = Bag.open(path);
    const rec = await startRecorder({ bus, epoch: EPOCH, db: HistoryDb.open(":memory:"), bag });
    rec.start();
    const phone = await sender("phone", bus);
    const b64 = Buffer.from("SECRET-PHOTO-BYTES").toString("base64");
    await phone.publish("/perception/frame", { jpeg_b64: b64, width: 4, height: 3, observed_ms: 1000 });
    await tick();
    await rec.idle();
    bag.close();
    expect(readFileSync(path).includes(Buffer.from(b64))).toBe(false);
  });
});
