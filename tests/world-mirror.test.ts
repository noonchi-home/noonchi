// 거울(src/world/mirror.ts): /world/state·/world/changes를 받아 가장 새 보기와 변화 콜백을 준다.
// 변화는 그 판본 이상의 상태를 가진 뒤에 오고(P2-7), 대시보드 보기 콜백은 판본이 바뀔 때만 부른다(250ms 다시 냄은 부르지 않음).
import { describe, expect, it } from "vitest";
import { BusNode, MemoryBus } from "../src/bus/index.js";
import type { WorldChange, WorldView } from "../src/contract/world.js";
import { settle } from "../src/record/replay.js";
import { startWorldMirror } from "../src/world/index.js";

const EPOCH = { boot: "b1", home: "h#1" };
const view = (at_ms: number): WorldView => ({ at_ms, objects: [], person: {} as never, fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0 });
const change = (subject: string): WorldChange => ({ kind: "appeared", at_ms: 1, subject, text: `${subject} 보임`, meaningful: true });

async function rig(o: { before?: (w: BusNode) => Promise<void> } = {}) {
  const bus = new MemoryBus({ warn: () => {} });
  const world = new BusNode({ name: "world", bus, epoch: EPOCH, log: () => {} });
  await world.prepare();
  world.start();
  await o.before?.(world);
  const seen: string[] = [];
  let atChange: (WorldView | null)[] = [];
  const m = await startWorldMirror({
    bus, epoch: EPOCH, name: "act", log: () => {},
    onChanges: (c, v) => { seen.push(`변화 ${c.map((x) => x.subject).join(",")}@${v.at_ms}`); atChange.push(m.view()); },
    onView: (v) => { seen.push(`보기 ${v.at_ms}`); },
  });
  m.node.start();
  const flush = () => settle(bus, [world, m.node]);
  await flush();
  return { bus, world, m, seen, atChange: () => atChange, flush, reset: () => { atChange = []; } };
}

describe("거울", () => {
  it("변화는 그 rev 이상의 상태를 가진 뒤에 onChanges로 오고, 그때 view()도 그 상태다", async () => {
    const r = await rig();
    await r.world.publish("/world/changes", { rev: 1, changes: [change("cup_1")] });
    await r.flush();
    expect(r.seen).toEqual([]);
    expect(r.m.view()).toBeNull();
    await r.world.publish("/world/state", { rev: 1, view: view(100) });
    await r.flush();
    expect(r.seen).toEqual(["보기 100", "변화 cup_1@100"]);
    expect(r.atChange()).toEqual([view(100)]);
    expect(r.m.rev()).toBe(1);
  });

  it("onView는 rev가 바뀔 때만 부르고(같은 rev 다시 냄은 부르지 않음), view()는 다시 낸 가장 새 보기다", async () => {
    const r = await rig();
    await r.world.publish("/world/state", { rev: 1, view: view(100) });
    await r.flush();
    await r.world.publish("/world/state", { rev: 1, view: view(350) });
    await r.flush();
    expect(r.m.view()).toEqual(view(350));
    await r.world.publish("/world/state", { rev: 2, view: view(400) });
    await r.world.publish("/world/changes", { rev: 2, changes: [change("cup_2")] });
    await r.flush();
    expect(r.seen).toEqual(["보기 100", "보기 400", "변화 cup_2@400"]);
  });

  it("같은 rev에서 집 사진(household_photo serial)만 바뀌면 onPhoto를 부른다(TV 규칙이 새 VLM 답을 바로 보게). rev가 바뀌면 onView만 부른다", async () => {
    const bus = new MemoryBus({ warn: () => {} });
    const world = new BusNode({ name: "world", bus, epoch: EPOCH, log: () => {} });
    await world.prepare();
    world.start();
    const seen: string[] = [];
    const m = await startWorldMirror({
      bus, epoch: EPOCH, name: "goal", log: () => {},
      onView: (v) => { seen.push(`보기 ${v.household_photo?.serial}`); },
      onPhoto: (v) => { seen.push(`사진 ${v.household_photo?.serial}`); },
    });
    m.node.start();
    const flush = () => settle(bus, [world, m.node]);
    const photo = (serial: number) => ({ ...view(100), household_photo: { id: `p${serial}`, at_ms: 100, serial, proof: null } });
    for (const [rev, serial] of [[1, 1], [1, 2], [1, 2], [2, 3], [2, 3]] as const) {
      await world.publish("/world/state", { rev, view: photo(serial) });
      await flush();
    }
    expect(seen).toEqual(["보기 1", "사진 2", "보기 3"]);
  });

  it("onView가 실패하면 그 rev를 보인 것으로 치지 않고, 같은 rev가 다시 오면 다시 부른다", async () => {
    const bus = new MemoryBus({ warn: () => {} });
    const world = new BusNode({ name: "world", bus, epoch: EPOCH, log: () => {} });
    await world.prepare();
    world.start();
    const shown: number[] = [];
    let fail = true;
    const m = await startWorldMirror({
      bus, epoch: EPOCH, name: "act", log: () => {},
      onView: (v) => { if (fail) { fail = false; throw new Error("방송 실패"); } shown.push(v.at_ms); },
    });
    m.node.start();
    const flush = () => settle(bus, [world, m.node]);
    await world.publish("/world/state", { rev: 1, view: view(100) });
    await flush();
    expect(shown).toEqual([]);
    await world.publish("/world/state", { rev: 1, view: view(350) });
    await flush();
    expect(shown).toEqual([350]);
    await world.publish("/world/state", { rev: 1, view: view(600) });
    await flush();
    expect(shown).toEqual([350]);
  });

  it("늦게 붙어도 가장 새 상태를 바로 받는다(STATE)", async () => {
    const r = await rig({
      before: async (w) => {
        await w.publish("/world/state", { rev: 1, view: view(100) });
        await w.publish("/world/state", { rev: 2, view: view(200) });
      },
    });
    expect(r.m.view()).toEqual(view(200));
    expect(r.seen).toEqual(["보기 200"]);
  });
});
