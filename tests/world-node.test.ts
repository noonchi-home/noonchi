// 집 상태 노드(src/world/node.ts): World State를 바꾸는 곳은 이 노드 하나다.
// 입력(VLM 답 /perception/scene·/world/input·/phone/heard·/device/changes와 YOLO 다리)을 노드 줄에 들어온 차례로 넣고,
// 변화가 있으면 rev를 올려 /world/state와 /world/changes를 낸다. 가까이 보기는 VLM 합치기 뒤 /world/closer로 최종 id 표를 답한다.
import { describe, expect, it } from "vitest";
import { BusNode, MemoryBus, RETRY_MS, VirtualClock, type Envelope, type NodeName, type TopicName } from "../src/bus/index.js";
import type { Detection, FrameMeta, SceneObservation } from "../src/contract/observe.js";
import type { WorldChange } from "../src/contract/world.js";
import { settle } from "../src/record/replay.js";
import { WorldState, canRelink, startWorldNode, type CloserPass } from "../src/world/index.js";
import type { DetLabel } from "../src/world/vocab.js";
import { engineFrame, LOOK_SIZE, LOOK_VIEW } from "./helpers/camera.js";
import { det as mkDet } from "./helpers/detectors.js";
import { vlmObjects } from "./helpers/vlm-scene.js";
import { accepts } from "../src/world/index.js";

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
/** 그 사진 VLM 답: 감지(d1…)와 이은 VLM 물건(v1…, 물건은 VLM 답으로만 생긴다)과 사실. */
const sceneOf = (dets: Detection[], ...obs: [string, string][]): SceneObservation => ({ ...said(...obs), objects: vlmObjects(dets, LOOK_SIZE, accepts) });
/** 그 사진의 카메라·크기·폰 눈(카메라 자리)·감지(바닥 점): 이어진 VLM 물건은 감지 바닥 점 자리다. */
const lookOf = (id: string, at: number, dets: Detection[]) => {
  const m = meta(id, at);
  return { view: m.view!, width: m.width, height: m.height, eye: [m.view!.origin[0], m.view!.origin[2]] as [number, number], dets: dets.map((d, i) => ({ id: `d${i + 1}`, box: d.box, foot: d.foot })) };
};
/** 장면 VLM 답에 YOLO가 못 본 유리잔 하나(VLM 물건 목록). */
const withVlmObject = (s: SceneObservation): SceneObservation => ({ ...s, objects: [{ id: "v1", cls: "glass", box: { x: 0.3, y: 0.55, w: 0.06, h: 0.08 }, det: null }] });
/** VLM 답을 받은 사진의 카메라·크기(폰 눈 자리 없음), 가까이 본 장의 카메라·크기·자른 자리. */
const LOOK = { view: LOOK_VIEW, ...LOOK_SIZE, eye: null };
const AT = { view: LOOK_VIEW, ...LOOK_SIZE, crop: [120, 60, 240, 180] as [number, number, number, number] };

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
      // 읽기만 하는 view·householdSerial·householdNow는 적지 않는다(넣기 차례만 본다)
      if (typeof v !== "function" || prop === "view" || prop === "householdSerial" || prop === "householdNow") return v;
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
  /** 통로에는 들어갔는데 답만 끊긴 발행(다음 한 번). */
  readonly lying = new Set<TopicName>();
  override async publish<N extends TopicName>(e: Envelope<N>): Promise<void> {
    if (this.failing.delete(e.topic)) throw new Error(`${e.topic} 발행 실패`);
    await super.publish(e);
    if (this.lying.delete(e.topic)) throw new Error(`${e.topic} 답 끊김`);
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
  for (const t of ["/world/state", "/world/changes", "/world/closer", "/world/household_photo"] as const) perception.on(t, (b) => { got.push({ topic: t, body: b }); });
  const all = [w.node, perception, act, phone, devices];
  for (const n of all.slice(1)) await n.prepare();
  for (const n of all) n.start();
  const flush = () => settle(bus, all);
  await flush();
  return { bus, clock, w, perception, act, phone, devices, got, all, flush };
}

describe("집 상태 노드", () => {
  it("YOLO 갈래·VLM 답 토픽으로 넣은 것과 WorldState에 바로 넣은 것의 변화 줄과 보기가 같다(감지 → VLM 답·물건 목록·사진 카메라, 가까이 보기 합치기(VLM 답까지 미룸) → 그 VLM 답·자른 자리, 위에서 본 값, 분석 없음)", async () => {
    const direct = ws();
    const d: WorldChange[] = [];
    for (const [id, at] of [["e1", 1000], ["e2", 2000], ["e3", 3000]] as const) {
      const r1 = direct.applyDetections(meta(id, at), [cupIn, person]);
      d.push(...r1.changes, ...direct.applyScene(id, at, sceneOf([cupIn, person], ["d1", "in_sink"]), r1.ids, lookOf(id, at, [cupIn, person]), at, NOW));
    }
    const rc = direct.applyCloser([pass("e4", 4000, [cupFar]), pass("e5", 5000, [person, cupFar])]);
    d.push(...rc.changes, ...direct.applyCloserScene("e5", 5000, sceneOf([person, cupFar], ["d2", "on_floor"]), rc.ids, rc.pending, AT));
    d.push(...direct.applyTop("cup_1", "e6", 6000, "empty"));
    d.push(...direct.applyMissing("e7", 7000, { vlm: "timeout" }, NOW), ...direct.applyMissing("e8", 8000, { yolo: "error" }, NOW));

    const r = await rig();
    for (const [id, at] of [["e1", 1000], ["e2", 2000], ["e3", 3000]] as const) {
      await yolo(r, { kind: "frame", frame: meta(id, at), dets: [cupIn, person] });
      await r.perception.publish("/perception/scene", { kind: "scene", frame_id: id, observed_ms: at, scene: sceneOf([cupIn, person], ["d1", "in_sink"]), look: lookOf(id, at, [cupIn, person]) });
      await r.flush();
    }
    await yolo(r, { kind: "closer_merge", look: "e5.c1", passes: [pass("e4", 4000, [cupFar]), pass("e5", 5000, [person, cupFar])], from: "e5" });
    await r.perception.publish("/perception/scene", { kind: "closer_scene", look: "e5.c1", frame_id: "e5", observed_ms: 5000, scene: sceneOf([person, cupFar], ["d2", "on_floor"]), at: AT });
    await r.perception.publish("/perception/scene", { kind: "top", object_id: "cup_1", frame_id: "e6", observed_ms: 6000, value: "empty" });
    await r.perception.publish("/perception/scene", { kind: "missing", frame_id: "e7", observed_ms: 7000, missing: "timeout" });
    await r.flush();
    await yolo(r, { kind: "yolo_missing", frame_id: "e8", observed_ms: 8000, yolo: "error" });
    await r.flush();
    expect(d.length).toBeGreaterThan(5);
    expect(d.some((c) => c.kind === "appeared" && c.subject === "cup_1")).toBe(true);   // VLM 답이 만든 물건
    expect(changesOf(r.got)).toEqual(d);
    expect(lastView(r.got)).toEqual(JSON.parse(JSON.stringify(direct.view(NOW))));   // 통로는 JSON으로 오간다(-0은 0)
  });

  it("가까이 보기 묶음은 VLM 답까지 들고 있고, VLM 답 없이 끝나면(closer_end) 아무것도 넣지 않고 빈 표를 낸다(물건은 VLM 답으로만)", async () => {
    const s = spy(ws());
    const r = await rig(s.proxy);
    const passes = [pass("e1", 1000, [cupFar]), pass("e2", 2000, [cupFar]), pass("e3", 3000, [person, cupFar])];
    await yolo(r, { kind: "closer_merge", look: "e3.c1", passes, from: "e3" });
    await r.flush();
    expect(s.calls.find((c) => c.name === "applyCloser")!.args).toHaveLength(1);
    expect(changesOf(r.got).filter((c) => c.kind === "appeared")).toEqual([]);
    await r.perception.publish("/perception/scene", { kind: "closer_end", look: "e3.c1" });
    await r.flush();
    expect(s.calls.find((c) => c.name === "endCloser")!.args).toHaveLength(1);
    expect(changesOf(r.got).filter((c) => c.kind === "appeared")).toEqual([]);
    expect(of(r.got, "/world/closer").at(-1)).toEqual({ look: "e3.c1", ids: {} });
  });

  it("VLM 갈래의 사진 카메라(look)·가까이 본 장의 자리(at)를 World State에 그대로 넘긴다", async () => {
    const s = spy(ws());
    const r = await rig(s.proxy);
    await yolo(r, { kind: "frame", frame: meta("e1", 1000), dets: [cupIn] });
    await r.perception.publish("/perception/scene", { kind: "scene", frame_id: "e1", observed_ms: 1000, scene: withVlmObject(said(["d1", "in_sink"])), look: LOOK });
    await yolo(r, { kind: "closer_merge", look: "e2.c1", passes: [pass("e2", 2000, [cupIn])], from: "e2" });
    await r.perception.publish("/perception/scene", { kind: "closer_scene", look: "e2.c1", frame_id: "e2", observed_ms: 2000, scene: said(["d1", "in_sink"]), at: AT });
    await r.flush();
    expect(s.calls.find((c) => c.name === "applyScene")!.args[4]).toEqual(LOOK);
    // 사건 구간 시작이 없으면 그 사진의 촬영 시각이다
    expect(s.calls.find((c) => c.name === "applyScene")!.args[5]).toBe(1000);
    expect(s.calls.find((c) => c.name === "applyScene")!.args[2]).toEqual(withVlmObject(said(["d1", "in_sink"])));
    expect(s.calls.find((c) => c.name === "applyCloserScene")!.args[5]).toEqual(AT);
  });

  it("/world/input link(찾기가 겨눈 자리의 물건을 계획 대상으로 잇기)는 world.relink를 그 값으로 부르고 상태를 다시 낸다", async () => {
    const s = spy(ws());
    const r = await rig(s.proxy);
    const states = of(r.got, "/world/state").length;
    await r.act.publish("/world/input", { kind: "link", from: "cup_2", to: "cup_1", at_ms: 4000 });
    await r.flush();
    expect(s.calls.filter((c) => c.name === "relink").map((c) => c.args)).toEqual([["cup_2", "cup_1", 4000]]);
    expect(of(r.got, "/world/state").length).toBeGreaterThan(states);
  });

  it("canRelink: 두 물건이 다 있고, 다른 물건이고, 잇는 쪽이 사라지지 않았고, 같은 무리(마시는 그릇)일 때만 잇는다", () => {
    const cup = { id: "cup_1", cls: "cup" as const, status: "present" as const };
    expect(canRelink({ id: "cup_2", cls: "cup", status: "present" }, cup)).toBe(true);
    expect(canRelink({ id: "bottle_1", cls: "bottle", status: "out_of_view" }, cup)).toBe(true);
    expect(canRelink({ id: "cup_2", cls: "cup", status: "gone" }, cup)).toBe(false);
    expect(canRelink(cup, cup)).toBe(false);
    expect(canRelink(undefined, cup)).toBe(false);
    expect(canRelink({ id: "cup_2", cls: "cup", status: "present" }, undefined)).toBe(false);
    expect(canRelink({ id: "remote_1", cls: "remote", status: "present" }, cup)).toBe(false);
  });

  it("집 사진(household_photo)에 그 VLM 답을 집 상태 노드가 넣은 때(answered_ms, 노드 시계)를 싣는다: 다시 낸 상태의 발행 시각(at_ms)이 아니다", async () => {
    const r = await rig();
    await r.clock.advanceTo(NOW + 700, r.flush);
    await r.perception.publish("/perception/scene", { kind: "scene", frame_id: "e1", observed_ms: 1000, scene: { ...sceneOf([]), household: { seats: "clear", people: [], dining_food: "unknown" } }, look: { ...lookOf("e1", 1000, []), fresh: true, person_ids: [] } });
    await r.flush();
    await r.clock.advanceTo(NOW + 1300, r.flush);
    const v = lastView(r.got);
    expect(v.household_photo).toMatchObject({ at_ms: 1000, answered_ms: NOW + 700 });
    expect(v.at_ms).toBeGreaterThan(NOW + 700);
  });
  it("장면 VLM 답의 사건 구간 시작(from_ms, 그 답이 본 가장 옛 사진)을 World State에 넘긴다(마시기·따르기 사건)", async () => {
    const s = spy(ws());
    const r = await rig(s.proxy);
    await r.perception.publish("/perception/scene", { kind: "scene", frame_id: "e5", observed_ms: 5000, from_ms: 1000, scene: said(["d1", "drank"]) });
    await r.flush();
    expect(s.calls.find((c) => c.name === "applyScene")!.args[5]).toBe(1000);
  });

  it("/world/input focus(지금 단계 대상)는 world.focus를 그 값으로 부르고, id null이면 푼다", async () => {
    const s = spy(ws());
    const r = await rig(s.proxy);
    await r.act.publish("/world/input", { kind: "focus", id: "cup_1", focus: { step: "place", spot: [1, 2] }, at_ms: 4000 });
    await r.act.publish("/world/input", { kind: "focus", id: null, focus: null, at_ms: 4100 });
    await r.flush();
    expect(s.calls.filter((c) => c.name === "focus").map((c) => c.args)).toEqual([["cup_1", { step: "place", spot: [1, 2] }], [null, null]]);
  });

  it("가까이 보기: VLM 답을 넣은 뒤 /world/closer로 VLM 답이 만든 물건 id까지 담은 최종 표를 낸다. 답 없이 끝나면(closer_end) 후보를 버리고 그때의 표를 낸다", async () => {
    const r = await rig();
    await yolo(r, { kind: "closer_merge", look: "e2.c1", passes: [pass("e1", 1000, [cupIn]), pass("e2", 2000, [person, cupIn])], from: "e2" });
    await r.flush();
    expect(of(r.got, "/world/closer")).toEqual([]);
    await r.perception.publish("/perception/scene", { kind: "closer_scene", look: "e2.c1", frame_id: "e2", observed_ms: 2000, scene: sceneOf([person, cupIn], ["d2", "in_sink"]), at: AT });
    await r.flush();
    expect(of(r.got, "/world/closer")).toEqual([{ look: "e2.c1", ids: { d2: "cup_1", v1: "cup_1" } }]);
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

  it("새 집 사진(serial)마다 그 사진을 /world/household_photo(RELIABLE)로 한 번씩 낸다: 상태(STATE)는 가장 새 것만 남아 받는 쪽이 사진을 건너뛸 수 있다", async () => {
    const r = await rig();
    const answer = (id: string, at: number) => r.perception.publish("/perception/scene", { kind: "scene", frame_id: id, observed_ms: at, scene: { ...sceneOf([]), household: { seats: "clear", people: [], dining_food: "unknown" } }, look: { ...lookOf(id, at, []), fresh: true, person_ids: [] } });
    await answer("e1", 1000);
    await answer("e2", 2000);
    // 집 답이 없는 VLM 답도 새 사진이다(근거 없음, proof null): 부재 구간을 끊으므로 함께 낸다
    await r.perception.publish("/perception/scene", { kind: "scene", frame_id: "e3", observed_ms: 3000, scene: said(["d1", "sitting"]) });
    // 같은 사진의 늦은 답은 새 사진이 아니다
    await r.perception.publish("/perception/scene", { kind: "scene", frame_id: "e0", observed_ms: 500, scene: said(["d1", "sitting"]) });
    await r.flush();
    const photos = of(r.got, "/world/household_photo").map((b) => b.photo);
    expect(photos.map((p) => [p.serial, p.id, p.at_ms, p.proof === null])).toEqual([[1, "e1", 1000, false], [2, "e2", 2000, false], [3, "e3", 3000, true]]);
    expect(photos[2]).toEqual(lastView(r.got).household_photo);
  });
  it("변화 없는 VLM 답이라도 집 사진(household_photo)을 새로 넣으면 같은 rev로 상태를 바로 낸다(250ms 다시 냄을 기다리지 않음: TV 끄기 5초)", async () => {
    const world = ws();
    let serial = 0;
    world.applyScene = () => { serial++; return []; };
    world.householdSerial = () => serial || null;
    const r = await rig(world);
    const states = of(r.got, "/world/state").length;
    await r.perception.publish("/perception/scene", { kind: "scene", frame_id: "e1", observed_ms: NOW, scene: said(["d1", "sitting"]) });
    await r.flush();
    expect(of(r.got, "/world/state").slice(states).map((b) => b.rev)).toEqual([0]);
    expect(of(r.got, "/world/changes")).toHaveLength(0);
    // 집 사진이 그대로인 답은 상태를 다시 내지 않는다
    world.applyScene = () => [];
    await r.perception.publish("/perception/scene", { kind: "scene", frame_id: "e2", observed_ms: NOW, scene: said(["d1", "sitting"]) });
    await r.flush();
    expect(of(r.got, "/world/state").slice(states)).toHaveLength(1);
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
      d.push(...r1.changes, ...direct.applyScene(id, at, sceneOf([cupIn, person], ["d1", state]), r1.ids, lookOf(id, at, [cupIn, person])));
      await yolo(r, { kind: "frame", frame: meta(id, at), dets: [cupIn, person] });
      await r.flush();
      if (id === "e1") r.bus.failing.add("/world/changes");
      await r.perception.publish("/perception/scene", { kind: "scene", frame_id: id, observed_ms: at, scene: sceneOf([cupIn, person], ["d1", state]), look: lookOf(id, at, [cupIn, person]) });
      await r.flush();
    }
    await r.clock.advanceTo(NOW + RETRY_MS, r.flush);
    expect(r.bus.failing.size).toBe(0);
    expect(s.calls.filter((c) => c.name === "applyScene")).toHaveLength(3);
    expect(changesOf(r.got)).toEqual(d);
    // 가까이 보기 답이 실패해도 VLM 합치기는 한 번, 답은 같은 최종 표로 한 번
    await yolo(r, { kind: "closer_merge", look: "e5.c1", passes: [pass("e4", 4000, [cupFar]), pass("e5", 5000, [person, cupFar])], from: "e5" });
    await r.flush();
    r.bus.failing.add("/world/closer");
    await r.perception.publish("/perception/scene", { kind: "closer_scene", look: "e5.c1", frame_id: "e5", observed_ms: 5000, scene: sceneOf([person, cupFar], ["d2", "on_floor"]), at: AT });
    await r.flush();
    await r.clock.advanceTo(NOW + 2 * RETRY_MS, r.flush);
    expect(r.bus.failing.size).toBe(0);
    expect(s.calls.filter((c) => c.name === "applyCloserScene")).toHaveLength(1);
    expect(of(r.got, "/world/closer")).toEqual([{ look: "e5.c1", ids: { d2: "cup_2", v1: "cup_2" } }]);
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

  it("앞 rev의 변화 발행이 실패하면 뒤 rev를 먼저 내지 않는다(받는 쪽이 늦게 온 앞 rev를 낡은 것으로 버리지 않게)", async () => {
    const r = await rig();
    r.bus.failing.add("/world/changes");
    await yolo(r, { kind: "yolo_missing", frame_id: "e1", observed_ms: 1000, yolo: "error" });
    await r.flush();
    r.bus.failing.add("/world/changes");
    await r.phone.publish("/phone/heard", { text: "컵 치워 줘", observed_ms: 1500 });
    await r.flush();
    await r.clock.advanceTo(NOW + 3 * RETRY_MS, r.flush);
    expect(of(r.got, "/world/changes").map((b) => [b.rev, b.changes.map((c: WorldChange) => c.kind)])).toEqual([[1, ["yolo_missing"]], [2, ["heard"]]]);
  });

  it("통로에 들어갔는데 답만 끊긴 출력을 다시 낼 때는 같은 봉투(메시지 id)로 내서 받는 쪽이 한 번만 받는다", async () => {
    const r = await rig();
    r.bus.lying.add("/world/changes");
    await yolo(r, { kind: "yolo_missing", frame_id: "e1", observed_ms: 1000, yolo: "error" });
    await r.flush();
    await r.clock.advanceTo(NOW + 2 * RETRY_MS, r.flush);
    expect(of(r.got, "/world/changes").map((b) => b.rev)).toEqual([1]);
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
    // 들고 있던 묶음은 버린다(VLM 답 없이는 넣지 않는다)
    expect(s.calls.find((c) => c.name === "endCloser")!.args).toHaveLength(1);
  });

});
