// 집 상태 노드(src/world/node.ts, stage-queue 묶음 2 Task 3): World State를 바꾸는 곳은 이 노드 하나다.
// 입력(VLM 답 /perception/scene·/world/input·/phone/heard·/device/changes와 YOLO 다리)을 노드 줄에 들어온 차례로 넣고,
// 변화가 있으면 rev를 올려 /world/state와 /world/changes를 낸다. 가까이 보기는 VLM 합치기 뒤 /world/closer로 최종 id 표를 답한다.
import { describe, expect, it } from "vitest";
import { BusNode, MemoryBus, RETRY_MS, VirtualClock, type Envelope, type NodeName, type TopicName } from "../src/bus/index.js";
import type { Detection, FrameMeta, SceneObservation } from "../src/contract/observe.js";
import type { WorldChange } from "../src/contract/world.js";
import { settle } from "../src/record/replay.js";
import { WorldState, startWorldNode, type CloserPass } from "../src/world/index.js";
import type { DetLabel } from "../src/world/vocab.js";
import { engineFrame, LOOK_SIZE, LOOK_VIEW } from "./helpers/camera.js";
import { det as mkDet } from "./helpers/detectors.js";

const EPOCH = { boot: "b1", home: "h#1" };
const NOW = 10_000;
type Box = [number, number, number, number];
const ws = (devices: { id: string; kind: string; label: string }[] = []) =>
  new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => devices });
const det = (label: DetLabel, box: Box, score = 0.8): Detection => mkDet(label, score, box, 0);
const cupIn = det("cup", [230, 170, 20, 10]);
const cupFar = det("cup", [130, 100, 20, 10]);
const person = det("person", [150, 20, 120, 330], 0.9);
const pass = (frameId: string, atMs: number, dets: Detection[]): CloserPass => ({ frameId, capturedAtMs: atMs, view: LOOK_VIEW, ...LOOK_SIZE, dets: dets.map((d) => ({ ...d, edge: false })) });
const meta = (id: string, atMs: number): FrameMeta => { const { jpeg: _jpeg, sha256: _sha, ...m } = engineFrame(id, atMs); return m; };
const said = (...obs: [string, string][]): SceneObservation => ({ scene: "k", observations: obs.map(([object_id, state]) => ({ object_id, state: state as never })), summary: "s" });

type Got = { topic: TopicName; body: any };
const of = (got: Got[], topic: TopicName) => got.filter((g) => g.topic === topic).map((g) => g.body);
const changesOf = (got: Got[]): WorldChange[] => of(got, "/world/changes").flatMap((b) => b.changes);
const lastView = (got: Got[]) => of(got, "/world/state").at(-1)?.view;
/** YOLO 임시 갈래 하나를 /perception/scene으로 낸다(VLM 전용으로 바뀔 자리). */
const yolo = (r: { perception: BusNode }, b: Record<string, unknown>) => r.perception.publish("/perception/scene", b as never);

/** World State 메서드 부르기를 적는다(이름·인자·돌려준 값·겹친 깊이). */
function spy(world: WorldState) {
  const calls: { name: string; args: unknown[]; out: unknown; depth: number }[] = [];
  let depth = 0;
  const proxy = new Proxy(world, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== "function" || prop === "view") return v;
      return (...args: unknown[]) => {
        depth++;
        try {
          const out = v.apply(target, args);
          calls.push({ name: String(prop), args, out, depth });
          return out;
        } finally { depth--; }
      };
    },
  });
  return { proxy, calls };
}

/** 집 상태 노드와 입력을 보내는 노드들, 나온 것을 받는 노드(perception: 가까이 보기 답을 받는 쪽). */
/** 정한 토픽의 다음 발행 한 번을 실패시키는 통로(다시 주기는 가상 시계로 돈다). */
class FlakyBus extends MemoryBus {
  readonly failing = new Set<TopicName>();
  override async publish<N extends TopicName>(e: Envelope<N>): Promise<void> {
    if (this.failing.delete(e.topic)) throw new Error(`${e.topic} 발행 실패`);
    return super.publish(e);
  }
}

async function rig(world = ws()) {
  const clock = new VirtualClock(NOW);
  const bus = new FlakyBus({ warn: () => {}, clock });
  const w = await startWorldNode({ bus, epoch: EPOCH, world, clock, log: () => {} });
  const node = (name: NodeName) => new BusNode({ name, bus, epoch: EPOCH, clock, log: () => {} });
  const perception = node("perception");
  const act = node("act");
  const phone = node("phone");
  const devices = node("devices");
  const got: Got[] = [];
  for (const t of ["/world/state", "/world/changes", "/world/closer"] as const) perception.on(t, (b) => { got.push({ topic: t, body: b }); });
  const all = [w.node, perception, act, phone, devices];
  for (const n of all.slice(1)) await n.prepare();
  for (const n of all) n.start();
  const flush = () => settle(bus, all);
  await flush();
  return { bus, clock, w, perception, act, phone, devices, got, all, flush };
}

describe("집 상태 노드", () => {
  it("YOLO 갈래·VLM 답 토픽으로 넣은 것과 WorldState에 바로 넣은 것의 변화 줄과 보기가 같다(감지 → VLM 답, 가까이 보기 합치기 → 그 VLM 답, 위에서 본 값, 분석 없음)", async () => {
    const direct = ws();
    const d: WorldChange[] = [];
    for (const [id, at] of [["e1", 1000], ["e2", 2000], ["e3", 3000]] as const) {
      const r1 = direct.applyDetections(meta(id, at), [cupIn, person]);
      d.push(...r1.changes, ...direct.applyScene(id, at, said(["d1", "in_sink"]), r1.ids));
    }
    const rc = direct.applyCloser([pass("e4", 4000, [cupFar]), pass("e5", 5000, [person, cupFar])], "e5");
    d.push(...rc.changes, ...direct.applyCloserScene("e5", 5000, said(["d2", "on_floor"]), rc.ids, rc.pending));
    d.push(...direct.applyTop("cup_1", "e6", 6000, "empty"));
    d.push(...direct.applyMissing("e7", 7000, { vlm: "timeout" }), ...direct.applyMissing("e8", 8000, { yolo: "error" }));

    const r = await rig();
    for (const [id, at] of [["e1", 1000], ["e2", 2000], ["e3", 3000]] as const) {
      await yolo(r, { kind: "frame", frame: meta(id, at), dets: [cupIn, person] });
      await r.perception.publish("/perception/scene", { kind: "scene", frame_id: id, observed_ms: at, scene: said(["d1", "in_sink"]) });
      await r.flush();
    }
    await yolo(r, { kind: "closer_merge", look: "e5.c1", passes: [pass("e4", 4000, [cupFar]), pass("e5", 5000, [person, cupFar])], from: "e5" });
    await r.perception.publish("/perception/scene", { kind: "closer_scene", look: "e5.c1", frame_id: "e5", observed_ms: 5000, scene: said(["d2", "on_floor"]) });
    await r.perception.publish("/perception/scene", { kind: "top", object_id: "cup_1", frame_id: "e6", observed_ms: 6000, value: "empty" });
    await r.perception.publish("/perception/scene", { kind: "missing", frame_id: "e7", observed_ms: 7000, missing: "timeout" });
    await r.flush();
    await yolo(r, { kind: "yolo_missing", frame_id: "e8", observed_ms: 8000, yolo: "error" });
    await r.flush();
    expect(d.length).toBeGreaterThan(5);
    expect(changesOf(r.got)).toEqual(d);
    expect(lastView(r.got)).toEqual(JSON.parse(JSON.stringify(direct.view(NOW))));   // 통로는 JSON으로 오간다(-0은 0)
  });

  it("가까이 보기: VLM 답을 넣은 뒤 /world/closer로 VLM 답이 만든 물건 id까지 담은 최종 표를 낸다. 답 없이 끝나면(closer_end) 후보를 버리고 그때의 표를 낸다", async () => {
    const r = await rig();
    await yolo(r, { kind: "closer_merge", look: "e2.c1", passes: [pass("e1", 1000, [cupIn]), pass("e2", 2000, [person, cupIn])], from: "e2" });
    await r.flush();
    expect(of(r.got, "/world/closer")).toEqual([]);
    await r.perception.publish("/perception/scene", { kind: "closer_scene", look: "e2.c1", frame_id: "e2", observed_ms: 2000, scene: said(["d2", "in_sink"]) });
    await r.flush();
    expect(of(r.got, "/world/closer")).toEqual([{ look: "e2.c1", ids: { d2: "cup_1" } }]);
    await yolo(r, { kind: "closer_merge", look: "e4.c2", passes: [pass("e3", 3000, [cupFar]), pass("e4", 4000, [cupFar])], from: "e4" });
    await r.perception.publish("/perception/scene", { kind: "closer_end", look: "e4.c2" });
    await r.flush();
    expect(of(r.got, "/world/closer").at(-1)).toEqual({ look: "e4.c2", ids: {} });
    expect(lastView(r.got).objects.map((o: { id: string }) => o.id)).toEqual(["cup_1"]);
  });

  it("변화가 있을 때만 rev가 오르고 상태를 변화보다 먼저 같은 rev로 낸다. 변화 없는 입력은 rev를 올리지 않고, 250ms마다 같은 rev로 상태를 다시 낸다", async () => {
    const r = await rig();
    expect(of(r.got, "/world/state").map((b) => b.rev)).toEqual([0]);
    await yolo(r, { kind: "yolo_missing", frame_id: "e1", observed_ms: 1000, yolo: "error" });
    await r.flush();
    expect(r.got.slice(-2).map((g) => [g.topic, g.body.rev])).toEqual([["/world/state", 1], ["/world/changes", 1]]);
    await r.act.publish("/world/input", { kind: "guard", id: "없는 물건", on: true, at_ms: 1000 });
    await r.flush();
    expect(Math.max(...of(r.got, "/world/state").map((b) => b.rev))).toBe(1);
    expect(of(r.got, "/world/changes")).toHaveLength(1);
    const states = of(r.got, "/world/state").length;
    await r.clock.advanceTo(NOW + 1000, r.flush);
    expect(of(r.got, "/world/state").slice(states).map((b) => b.rev)).toEqual([1, 1, 1, 1]);
    expect(of(r.got, "/world/state").at(-1).view.at_ms).toBe(NOW + 1000);
    expect(of(r.got, "/world/changes")).toHaveLength(1);
  });

  it("/world/input 지킴·따르기 창은 world.guard·contentsAction을 그 값으로 부른다", async () => {
    const s = spy(ws());
    const r = await rig(s.proxy);
    await r.act.publish("/world/input", { kind: "guard", id: "cup_1", on: true, at_ms: 4000 });
    await r.act.publish("/world/input", { kind: "contents", id: "cup_1", on: false, at_ms: 4100 });
    await r.flush();
    expect(s.calls.filter((c) => c.name === "guard" || c.name === "contentsAction").map((c) => [c.name, ...c.args])).toEqual([["guard", "cup_1", 4000, true], ["contentsAction", "cup_1", 4100, false]]);
  });

  it("가전 첫 상태(initial)는 넣되 변화를 내지 않고, 그 뒤 상태는 applyDevice의 변화를 낸다. 들은 말은 heard 변화를 낸다", async () => {
    const s = spy(ws([{ id: "fridge", kind: "fridge", label: "냉장고" }]));
    const r = await rig(s.proxy);
    const fridge = (door: string) => ({ id: "fridge", online: true, twin: { door }, matter: {}, updatedAt: "2026-11-18T00:00:00Z" });
    await r.devices.publish("/device/changes", { id: "fridge", state: fridge("closed"), note: { initial: true, label: "냉장고", kind: "fridge" } });
    await r.flush();
    expect(s.calls.filter((c) => c.name === "applyDevice")).toHaveLength(1);
    expect(of(r.got, "/world/changes")).toEqual([]);
    await r.devices.publish("/device/changes", { id: "fridge", state: fridge("open"), note: { label: "냉장고", kind: "fridge" } });
    await r.phone.publish("/phone/heard", { text: "컵 치워 줘", observed_ms: 5000 });
    await r.flush();
    const device = s.calls.filter((c) => c.name === "applyDevice")[1]!.out as WorldChange[];
    const heard = s.calls.find((c) => c.name === "heard")!.out as WorldChange[];
    expect(heard.map((c) => c.kind)).toEqual(["heard"]);
    expect(changesOf(r.got)).toEqual([...device, ...heard]);
  });

  it("1620be1 다시 들어오기: 변화를 받는 쪽이 같은 콜백 안에서 /world/input을 내도 그 입력은 지금 입력을 다 넣은 뒤에 넣는다", async () => {
    const s = spy(ws());
    const r = await rig(s.proxy);
    r.act.on("/world/changes", async () => { await r.act.publish("/world/input", { kind: "guard", id: "cup_1", on: true, at_ms: 1 }); });
    await r.act.prepare();   // 시험용으로 늦게 붙인 구독(준비 뒤 시작)
    r.act.start();
    await yolo(r, { kind: "yolo_missing", frame_id: "e1", observed_ms: 1000, yolo: "error" });
    await r.flush();
    expect(s.calls.map((c) => [c.name, c.depth])).toEqual([["applyMissing", 1], ["guard", 1]]);
  });

  it("발행이 실패해 다시 받은 입력은 다시 넣지 않고 남은 출력(변화·판본·가까이 보기 답)만 다시 낸다", async () => {
    const s = spy(ws());
    const direct = ws();
    const d: WorldChange[] = [];
    const r = await rig(s.proxy);
    for (const [id, at, state] of [["e1", 1000, "in_sink"], ["e2", 2000, "in_sink"], ["e3", 3000, "on_floor"]] as const) {
      const r1 = direct.applyDetections(meta(id, at), [cupIn, person]);
      d.push(...r1.changes, ...direct.applyScene(id, at, said(["d1", state]), r1.ids));
      await yolo(r, { kind: "frame", frame: meta(id, at), dets: [cupIn, person] });
      await r.flush();
      if (id === "e3") r.bus.failing.add("/world/changes");
      await r.perception.publish("/perception/scene", { kind: "scene", frame_id: id, observed_ms: at, scene: said(["d1", state]) });
      await r.flush();
    }
    await r.clock.advanceTo(NOW + RETRY_MS, r.flush);
    expect(s.calls.filter((c) => c.name === "applyScene")).toHaveLength(3);
    expect(changesOf(r.got)).toEqual(d);
    // 가까이 보기 답이 실패해도 VLM 합치기는 한 번, 답은 같은 최종 표로 한 번
    await yolo(r, { kind: "closer_merge", look: "e5.c1", passes: [pass("e4", 4000, [cupFar]), pass("e5", 5000, [person, cupFar])], from: "e5" });
    await r.flush();
    r.bus.failing.add("/world/closer");
    await r.perception.publish("/perception/scene", { kind: "closer_scene", look: "e5.c1", frame_id: "e5", observed_ms: 5000, scene: said(["d2", "on_floor"]) });
    await r.flush();
    await r.clock.advanceTo(NOW + 2 * RETRY_MS, r.flush);
    expect(s.calls.filter((c) => c.name === "applyCloserScene")).toHaveLength(1);
    expect(of(r.got, "/world/closer")).toEqual([{ look: "e5.c1", ids: { d2: "cup_2" } }]);
  });

  it("YOLO 갈래 입력의 발행이 실패하면 다시 받을 때 남은 변화를 한 번만 낸다", async () => {
    const r = await rig();
    r.bus.failing.add("/world/changes");
    await yolo(r, { kind: "yolo_missing", frame_id: "e1", observed_ms: 1000, yolo: "error" });
    await r.flush();
    expect(of(r.got, "/world/changes")).toEqual([]);
    await r.clock.advanceTo(NOW + RETRY_MS, r.flush);
    expect(of(r.got, "/world/changes").map((b) => [b.rev, b.changes.map((c: WorldChange) => c.kind)])).toEqual([[1, ["yolo_missing"]]]);
  });

  it("VLM 답이 오지 않아 30초 넘은 가까이 보기 후보는 지우기 전에 endCloser로 끝낸다", async () => {
    const s = spy(ws());
    const r = await rig(s.proxy);
    await yolo(r, { kind: "closer_merge", look: "e2.c1", passes: [pass("e1", 1000, [cupIn]), pass("e2", 2000, [person, cupIn])], from: "e2" });
    await r.flush();
    await r.clock.advanceTo(NOW + 29_000, r.flush);
    expect(s.calls.filter((c) => c.name === "endCloser")).toEqual([]);
    await r.clock.advanceTo(NOW + 31_000, r.flush);
    expect(s.calls.filter((c) => c.name === "endCloser")).toHaveLength(1);
  });

});
