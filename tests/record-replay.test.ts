// 격리 재생: 실제 통로가 아닌 새 MemoryBus·가상 시계에서, 허용 목록의 바깥 입력만 도착 차례·도착 시각대로 흘리고,
// 메시지마다 이어지는 발행이 다 끝날 때까지(처리 장벽) 기다린다.
import { describe, expect, it } from "vitest";
import { BusNode, RETRY_MS } from "../src/bus/index.js";
import { Bag, REPLAY_INPUTS, replay } from "../src/record/index.js";
import type { Detection, FrameMeta } from "../src/contract/observe.js";
import type { WorldChange } from "../src/contract/world.js";
import { WorldState, startWorldNode, type CloserPass } from "../src/world/index.js";
import { engineFrame, LOOK_SIZE, LOOK_VIEW } from "./helpers/camera.js";
import { det } from "./helpers/detectors.js";
import { vlmObjects } from "./helpers/vlm-scene.js";
import { accepts } from "../src/world/index.js";

const cupIn = det("cup", 0.8, [230, 170, 20, 10], 41);
const cupFar = det("cup", 0.8, [130, 100, 20, 10], 41);
const person = det("person", 0.9, [150, 20, 120, 330], 0);
const meta = (id: string, atMs: number): FrameMeta => { const { jpeg: _jpeg, sha256: _sha, ...m } = engineFrame(id, atMs); return m; };
const pass = (frameId: string, atMs: number, dets: Detection[]): CloserPass => ({ frameId, capturedAtMs: atMs, view: LOOK_VIEW, ...LOOK_SIZE, dets: dets.map((d) => ({ ...d, edge: false })) });

const EPOCH = { boot: "b1", home: "h#1" };
const h = (seq: number, stamp: number) => ({ stamp, node: "perception" as const, inst: "i1", seq, ...EPOCH });

describe("격리 재생", () => {
  it("가전 명령은 보내지 않고 판단과 계획은 녹화한 모델 결과를 쓴다", () => {
    expect(REPLAY_INPUTS).not.toContain("/device/command");
    expect(REPLAY_INPUTS).toContain("/brain/plan");
    expect(REPLAY_INPUTS).not.toContain("/brain/plan_request");
    expect(REPLAY_INPUTS).toContain("/perception/analysis");
    // 실행 추적이 집 상태에 넣은 입력(지킴·따르기 창·지금 단계 대상·잇기)도 집 상태 입력이다
    expect(REPLAY_INPUTS).toContain("/world/input");
  });

  it("녹화한 YOLO 갈래·VLM 답(/perception/scene, 사진 없음)을 흘려 집 상태 노드가 컵의 등장·사실·가까이 보기 결과를 바로 넣은 것과 같게 다시 만든다", async () => {
    expect(REPLAY_INPUTS).toContain("/perception/scene");
    const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
    // 물건은 VLM 답으로만 생긴다: VLM 답은 감지와 이은 물건 목록을 싣고, 그 사진의 카메라·감지(바닥 점)를 함께 낸다
    const said = (id: string, state: string, dets: Detection[]) => ({ scene: "k", observations: [{ object_id: id, state: state as never }], objects: vlmObjects(dets, LOOK_SIZE, accepts), summary: "s" });
    const lookOf = (id: string, at: number, dets: Detection[]) => {
      const m = meta(id, at);
      return { view: m.view!, width: m.width, height: m.height, eye: [m.view!.origin[0], m.view!.origin[2]] as [number, number], dets: dets.map((d, i) => ({ id: `d${i + 1}`, box: d.box, foot: d.foot })) };
    };
    const passes = [pass("e4", 4000, [cupFar]), pass("e5", 5000, [person, cupFar])];
    // 바로 넣은 것
    const direct = ws();
    const want: WorldChange[] = [];
    for (const [id, at] of [["e1", 1000], ["e2", 2000], ["e3", 3000]] as const) {
      const r1 = direct.applyDetections(meta(id, at), [cupIn, person]);
      want.push(...r1.changes, ...direct.applyScene(id, at, said("d1", "in_sink", [cupIn, person]), r1.ids, lookOf(id, at, [cupIn, person])));
    }
    // 관찰 흐름이 내는 모양: 가까이 보기 합치기는 VLM 답까지 미루고, VLM 답은 그 장의 자리(at)를 싣는다
    const at = { view: LOOK_VIEW, ...LOOK_SIZE, crop: [120, 60, 240, 180] as [number, number, number, number] };
    const rc = direct.applyCloser(passes);
    want.push(...rc.changes, ...direct.applyCloserScene("e5", 5000, said("d2", "on_floor", [person, cupFar]), rc.ids, rc.pending, at));
    // 녹화: 도착 차례대로
    const bag = Bag.open(":memory:");
    let seq = 0;
    const put = (body: Record<string, unknown>, at: number) => bag.write({ topic: "/perception/scene", key: "_", header: h(++seq, at), body } as never, at);
    for (const [id, at] of [["e1", 1000], ["e2", 2000], ["e3", 3000]] as const) {
      put({ kind: "frame", frame: meta(id, at), dets: [cupIn, person] }, at + 100);
      put({ kind: "scene", frame_id: id, observed_ms: at, scene: said("d1", "in_sink", [cupIn, person]), look: lookOf(id, at, [cupIn, person]) }, at + 900);
    }
    put({ kind: "closer_merge", look: "e5.c1", passes, from: "e5" }, 5100);
    put({ kind: "closer_scene", look: "e5.c1", frame_id: "e5", observed_ms: 5000, scene: said("d2", "on_floor", [person, cupFar]), at }, 6900);
    expect(JSON.stringify(bag.range(0, 10_000))).not.toMatch(/jpeg|sha256/);
    const got: WorldChange[] = [];
    const closer: unknown[] = [];
    let view: unknown = null;
    await replay({
      bag, from: 0, to: 10_000,
      launch: async (bus, clock) => {
        const w = await startWorldNode({ bus, epoch: EPOCH, world: ws(), clock, log: () => {} });
        const probe = new BusNode({ name: "perception", bus, epoch: EPOCH, clock, log: () => {} });
        probe.on("/world/changes", (b) => { got.push(...b.changes); });
        probe.on("/world/closer", (b) => { closer.push(b); });
        probe.on("/world/state", (b) => { view = b.view; });
        return [w.node, probe];
      },
    });
    expect(want.map((c) => c.kind)).toContain("appeared");
    expect(got).toEqual(want);
    expect(closer).toEqual([{ look: "e5.c1", ids: { d2: "cup_2", v1: "cup_2" } }]);
    const objects = (view as { objects: { id: string; facts: Record<string, { value: string }> }[] }).objects;
    expect(objects.map((o) => [o.id, o.facts.place?.value])).toEqual(direct.view(9000).objects.map((o) => [o.id, o.facts.place?.value]));
  });

  it("도착 차례대로 흘리고, 가상 시계는 발행 시각이 아니라 도착 시각까지 당긴다", async () => {
    const bag = Bag.open(":memory:");
    bag.write({ topic: "/perception/analysis", key: "f1", header: h(1, 2000), body: { frame_id: "f1", observed_ms: 1500 } } as never, 2100);
    bag.write({ topic: "/device/command", key: "c1", header: { ...h(1, 2500), node: "act" }, body: { command_id: "c1", deadline_ms: 9e15 } } as never, 2500);
    bag.write({ topic: "/perception/analysis", key: "f2", header: h(2, 2200), body: { frame_id: "f2", observed_ms: 2150 } } as never, 3050);
    const seen: [string, number][] = [];
    const r = await replay({
      bag, from: 0, to: 10_000,
      launch: async (bus, clock) => {
        const n = new BusNode({ name: "world", bus, epoch: EPOCH, clock, log: () => {} });
        n.on("/perception/analysis", async (b) => { await new Promise((ok) => setTimeout(ok, 20)); seen.push([String(b.frame_id), clock.now()]); });
        n.on("/device/command", (b) => { seen.push([`명령 ${String(b.command_id)}`, clock.now()]); });
        return [n];
      },
    });
    expect(r.sent).toBe(2);
    expect(seen).toEqual([["f1", 2100], ["f2", 3050]]);
  });

  it("처리에 실패한 메시지의 다시 주기도 가상 시계로 RETRY_MS 뒤에 온다(실제 시간을 기다리지 않는다)", async () => {
    const bag = Bag.open(":memory:");
    bag.write({ topic: "/perception/analysis", key: "f1", header: h(1, 1000), body: { frame_id: "f1", observed_ms: 1000 } } as never, 1000);
    bag.write({ topic: "/perception/analysis", key: "f2", header: h(2, 1500), body: { frame_id: "f2", observed_ms: 1500 } } as never, 1500);
    const seen: [string, number][] = [];
    let failed = false;
    await replay({
      bag, from: 0, to: 10_000,
      launch: async (bus, clock) => {
        const w = new BusNode({ name: "world", bus, epoch: EPOCH, clock, log: () => {} });
        w.on("/perception/analysis", (b) => {
          if (b.frame_id === "f1" && !failed) { failed = true; throw new Error("처음 한 번 실패"); }
          seen.push([String(b.frame_id), clock.now()]);
        });
        return [w];
      },
    });
    expect(seen).toEqual([["f1", 1000 + RETRY_MS], ["f2", 1500]]);
  });

  it("재생이 중간에 실패해도 노드를 끝내고 통로를 닫는다", async () => {
    const bag = Bag.open(":memory:");
    bag.write({ topic: "/perception/analysis", key: "f1", header: h(1, 1000), body: { frame_id: "f1", observed_ms: 1000 } } as never, 1000);
    let stopped = false;
    let seenBus: { publish: (e: never) => Promise<void> } | null = null;
    const broken = { prepare: async () => {}, start: () => {}, busy: () => false, idle: () => Promise.reject(new Error("장벽 실패")), stop: async () => { stopped = true; } };
    await expect(replay({ bag, from: 0, to: 10_000, launch: async (bus) => { seenBus = bus as never; return [broken as never]; } })).rejects.toThrow("장벽 실패");
    expect(stopped).toBe(true);
    await expect(seenBus!.publish({ topic: "/perception/analysis", key: "f9", header: h(9, 9), body: { frame_id: "f9", observed_ms: 9 } } as never)).rejects.toThrow(/닫힌 통로/);
  });

  it("장벽은 이어지는 발행(다섯 단계)이 다 끝난 뒤 다음 메시지로 간다", async () => {
    const bag = Bag.open(":memory:");
    bag.write({ topic: "/perception/analysis", key: "f1", header: h(1, 1000), body: { frame_id: "f1", observed_ms: 1000 } } as never, 1000);
    bag.write({ topic: "/perception/analysis", key: "f2", header: h(2, 2000), body: { frame_id: "f2", observed_ms: 2000 } } as never, 2000);
    const seen: string[] = [];
    await replay({
      bag, from: 0, to: 10_000,
      launch: async (bus, clock) => {
        const w = new BusNode({ name: "world", bus, epoch: EPOCH, clock, log: () => {} });
        const a = new BusNode({ name: "act", bus, epoch: EPOCH, clock, log: () => {} });
        w.on("/perception/analysis", async (b) => { seen.push(String(b.frame_id)); await w.publish("/world/changes", { rev: Number(b.observed_ms), changes: [] }); });
        a.on("/world/changes", async () => { await a.publish("/act/log", { type: "execution", at_ms: 1, plan_id: "p", state: "running", text: "실행" }); });
        a.on("/act/log", async (b) => { if (b.type !== "execution") return; const n = b.at_ms; seen.push(`log ${n}`); if (n < 5) await a.publish("/act/log", { ...b, at_ms: n + 1 }); });
        return [w, a];
      },
    });
    const five = ["log 1", "log 2", "log 3", "log 4", "log 5"];
    expect(seen).toEqual(["f1", ...five, "f2", ...five]);
  });
});
