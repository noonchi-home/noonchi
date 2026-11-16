// @vitest-environment node
// 실시간 트윈: /events 가전 상태·배치(옮기기·더하기·빼기)를 구운 트윈에 바로 반영한다. 합친 정적 물건은 떼고 옮기고,
// 새 물건은 그림자 없이 더한다. 엔진이 뜨기 전에 온 메시지는 모아 두었다가(기기마다 마지막 상태, 배치는 온 차례) 넣는다.
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../../../src/contract/events.ts";
import type { LayoutMessage, SceneObject, Vec3 } from "../../../src/contract/layout.ts";
import { scene3d } from "../../../src/design/tokens.ts";
import scene from "../../../twin/homes/mokryeon_180b/scene.json";
import { LayoutOps, LiveQueue, attachLive, liveViewer, type StateEntry } from "../../src/twin/3d/live";
import { StaticMerge } from "../../src/twin/3d/merge";
import { TwinStates } from "../../src/twin/3d/states";

const FRIDGE = "fridge_bbc363a3";
const SOFA = "sofa_a848b595";
const TABLE = "dining_table_978b20c7";
const entryOf = (id: string) => scene.objects.find((o) => o.id === id)! as unknown as SceneObject;
const fabric = new THREE.MeshBasicMaterial({ name: "fabric" });

const mesh = (name: string, x: number, part?: string) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), fabric);
  m.name = name;
  m.position.x = x;
  if (part) m.userData.part = part;
  return m;
};
const nodeOf = (id: string, ...kids: THREE.Object3D[]) => {
  const e = entryOf(id);
  const g = new THREE.Group();
  g.name = id;
  g.position.fromArray(e.position);
  g.rotation.fromArray([...e.rotation, "XYZ"]);
  g.add(...kids);
  return g;
};
const boxAt = (node: THREE.Object3D): [number, number, number] => {
  const b = new THREE.Box3().setFromObject(node);
  return [(b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2];
};

/** 구운 GLB처럼 Apartment > furniture·appliances 아래 물건 노드. 소파·식탁은 합친 정적 물건, 냉장고는 상태가 있는 가전(합치지 않음). */
function fakeEngine(o: { fridge?: Record<string, unknown>; load?: (url: string) => Promise<THREE.Object3D> } = {}) {
  const scene3 = new THREE.Scene();
  const root = new THREE.Group();
  const apartment = new THREE.Group();
  apartment.name = "Apartment";
  const furniture = new THREE.Group();
  furniture.name = "furniture";
  const appliances = new THREE.Group();
  appliances.name = "appliances";
  const sofa = nodeOf(SOFA, mesh("sofa_body", 0), mesh("sofa_arm", 1));
  const table = nodeOf(TABLE, mesh("table_top", 0));
  const fridge = nodeOf(FRIDGE, mesh("fridge_body", 0), mesh("fridge_door_l", 0.3, "door_left"), mesh("fridge_door_r", -0.3, "door_right"));
  furniture.add(sofa, table);
  appliances.add(fridge);
  apartment.add(furniture, appliances);
  root.add(apartment);
  scene3.add(root);
  root.updateMatrixWorld(true);
  const states = new TwinStates(scene3, root);
  const f = entryOf(FRIDGE);
  states.add(FRIDGE, fridge, { attrs: f.attrs as Record<string, unknown[]>, states: f.states, state: o.fridge ?? f.state });
  const merge = new StaticMerge(scene3, [...sofa.children, ...table.children] as THREE.Mesh[], (m) => m.parent?.name ?? null);
  merge.build();
  const anchors = new Map<string, [number, number, number] | null>();
  const engine = {
    root, merge, states,
    layout: null as unknown as LayoutOps,
    find: (id: string) => root.getObjectByName(id) ?? null,
    anchor(id: string) {
      if (engine.layout.isRemoved(id)) return null;
      if (!anchors.has(id)) { const n = engine.find(id); anchors.set(id, n ? boxAt(n) : null); }
      return anchors.get(id)!;
    },
    forgetAnchor: vi.fn((id?: string) => { if (id === undefined) anchors.clear(); else anchors.delete(id); }),
    requestRender: vi.fn(),
  };
  engine.layout = new LayoutOps(engine, { load: o.load, entry: (id) => scene.objects.find((x) => x.id === id) as StateEntry | undefined });
  const setState = vi.spyOn(states, "setState");
  const detach = vi.spyOn(merge, "detach");
  return { engine, sofa, table, fridge, setState, detach };
}

const state = (id: string, twin: Record<string, unknown>): ServerMessage => ({ type: "state", state: { id, online: true, twin, matter: {}, updatedAt: "t" } });
const hello: ServerMessage = { type: "hello", devices: 1, provider: null, hub: "memory", home: "mokryeon_180b" };
const move = (id: string, position: Vec3, rotation: Vec3): LayoutMessage => ({
  type: "layout", op: "move", id, room: "living", plan: { position: [position[0], position[2]], facing_deg: 0, elevation: position[1] }, position, rotation,
});
const crate: SceneObject = {
  id: "box_1", name: "상자", type: "box", asset: null, category: "props", mount: "floor", room: "living",
  plan: { position: [8, 9], facing_deg: 90, elevation: 0, on: null, surface: null, wall: null },
  position: [8, 0, 9], rotation: [0, 0, 0], scale: [1, 1, 1], interactive: true, attrs: {}, states: {}, state: {}, footprint: [0.4, 0.4], height: 0.5,
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const meshesOf = (n: THREE.Object3D) => { const out: THREE.Mesh[] = []; n.traverse((x) => { if (x instanceof THREE.Mesh) out.push(x); }); return out; };
const close = (v: THREE.Vector3 | THREE.Euler) => [v.x, v.y, v.z].map((x) => Number(x.toFixed(6)) + 0);

describe("가전 상태", () => {
  it("liveViewer는 트윈 상태 저장소를 뷰어 모양(getState·getAttrs·setState)으로 보인다", () => {
    const { engine } = fakeEngine();
    const v = liveViewer(engine.states);
    expect(v.getState(FRIDGE)).toEqual({ door: "closed" });
    expect(v.getAttrs(FRIDGE)).toEqual({ door: ["closed", "open"] });
    expect(v.getAttrs("nope")).toBeNull();
  });

  it("바뀐 값만 한 번 넣고 한 번 그린다. 같은 값·모르는 기기·모르는 값은 넣지 않는다", () => {
    const { engine, fridge, setState } = fakeEngine();
    const live = attachLive(engine);
    live.handle(state(FRIDGE, { door: "open" }));
    expect(setState.mock.calls).toEqual([[FRIDGE, "door", "open"]]);
    expect(engine.requestRender).toHaveBeenCalledTimes(1);
    const opened = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (-100 * Math.PI) / 180, 0));
    expect(fridge.getObjectByName("fridge_door_l")!.quaternion.angleTo(opened)).toBeCloseTo(0, 6);
    live.handle(state(FRIDGE, { door: "open" }));
    live.handle(state("nope_1", { power: "on" }));
    live.handle(state(FRIDGE, { door: "melted" }));
    expect(setState).toHaveBeenCalledTimes(1);
    expect(engine.requestRender).toHaveBeenCalledTimes(1);
  });

  it("dispose 뒤에는 넣지 않는다", () => {
    const { engine, setState } = fakeEngine();
    const live = attachLive(engine);
    live.dispose();
    live.handle(state(FRIDGE, { door: "open" }));
    expect(setState).not.toHaveBeenCalled();
    expect(engine.requestRender).not.toHaveBeenCalled();
  });
});

describe("배치 옮기기", () => {
  it("정적 소파는 합친 메시에서 한 번 떼고 메시지 자리로 옮기며 기준점을 다시 셈한다", () => {
    const { engine, sofa, detach } = fakeEngine();
    const live = attachLive(engine);
    const before = engine.anchor(SOFA);
    live.handle(move(SOFA, [6.5, 0, 9.2], [0, 0, 0]));
    expect(detach.mock.calls).toEqual([[SOFA]]);
    expect(close(sofa.position)).toEqual([6.5, 0, 9.2]);
    expect(close(sofa.rotation)).toEqual([0, 0, 0]);
    expect(sofa.children.every((m) => m.visible)).toBe(true);
    expect(engine.merge.mergedOf(SOFA)).toBeNull();
    expect(engine.forgetAnchor).toHaveBeenCalledWith(SOFA);
    expect(engine.anchor(SOFA)).not.toEqual(before);
    expect(engine.anchor(SOFA)).toEqual(boxAt(sofa));
    expect(engine.requestRender).toHaveBeenCalledTimes(1);
    live.handle(move(SOFA, [6, 0, 9], [0, Math.PI / 2, 0]));
    expect(detach).toHaveBeenCalledTimes(1);
    expect(close(sofa.position)).toEqual([6, 0, 9]);
  });

  it("가전은 떼지 않고 변환만 바꾼다", () => {
    const { engine, fridge, detach } = fakeEngine();
    attachLive(engine).handle(move(FRIDGE, [5.5, 0, 3], [0, Math.PI, 0]));
    expect(detach).not.toHaveBeenCalled();
    expect(close(fridge.position)).toEqual([5.5, 0, 3]);
    expect(fridge.rotation.y).toBeCloseTo(Math.PI, 6);
    expect(engine.requestRender).toHaveBeenCalledTimes(1);
  });

  it("모르는 물건은 옮기지 않고 그리지 않는다", () => {
    const { engine } = fakeEngine();
    attachLive(engine).handle(move("ghost_1", [1, 0, 1], [0, 0, 0]));
    expect(engine.requestRender).not.toHaveBeenCalled();
  });
});

describe("배치 더하기", () => {
  it("asset이 없으면 footprint·height 회색 상자 하나를 그 자리에 그림자 없이 더한다", async () => {
    const { engine } = fakeEngine();
    attachLive(engine).handle({ type: "layout", op: "add", object: crate });
    await flush();
    const holder = engine.find("box_1")!;
    expect(holder).toBeTruthy();
    expect(close(holder.position)).toEqual([8, 0, 9]);
    const boxes = meshesOf(holder);
    expect(boxes).toHaveLength(1);
    const box = boxes[0]!;
    expect((box.geometry as THREE.BoxGeometry).parameters).toMatchObject({ width: 0.4, height: 0.5, depth: 0.4 });
    expect(box.position.y).toBeCloseTo(0.25, 9);
    expect([box.castShadow, box.receiveShadow]).toEqual([false, false]);
    expect((box.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(new THREE.Color(scene3d.placeholder).getHexString());
    expect(engine.requestRender).toHaveBeenCalledTimes(1);
  });

  it("asset이 있으면 /twin/<asset>을 불러 실시간 재질 그대로, 그림자 없이 더한다", async () => {
    const lit = new THREE.MeshStandardMaterial({ name: "lamp_metal" });
    const load = vi.fn(async () => {
      const gltf = new THREE.Group();
      const top = new THREE.Group();
      top.name = "floor_lamp";
      const part = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.5), lit);
      part.castShadow = part.receiveShadow = true;
      top.add(part);
      gltf.add(top);
      return gltf;
    });
    const { engine } = fakeEngine({ load });
    const lamp = { ...crate, id: "floor_lamp_1", type: "floor_lamp", asset: "lib/assets/lighting/floor_lamp.glb" };
    attachLive(engine).handle({ type: "layout", op: "add", object: lamp });
    await flush();
    expect(load.mock.calls).toEqual([["/twin/lib/assets/lighting/floor_lamp.glb"]]);
    const parts = meshesOf(engine.find("floor_lamp_1")!);
    expect(parts.map((m) => [m.material, m.castShadow, m.receiveShadow])).toEqual([[lit, false, false]]);
    expect(engine.requestRender).toHaveBeenCalledTimes(1);
  });

  it("접속 때 상태가 더하기보다 먼저 와도(서버는 state 다음 layout add를 보낸다) 더하기가 끝나면 그 기기의 마지막 상태를 넣는다: 닫은 커튼·켠 조명이 기본값으로 보이지 않는다", async () => {
    const load = vi.fn(async () => {
      const gltf = new THREE.Group();
      const top = new THREE.Group();
      top.name = "ceiling_light";
      top.add(mesh("ceiling_light_diffuser", 0, "diffuser"));
      gltf.add(top);
      return gltf;
    });
    const { engine } = fakeEngine({ load });
    const light = {
      ...crate, id: "light_living", type: "ceiling_light", asset: "assets/fixtures/ceiling_light.glb",
      attrs: { power: ["off", "on"] },
      states: { power: { default: "off", effects: { off: [{ part: "diffuser", emissive: 0 }], on: [{ part: "diffuser", emissive: 1 }] } } },
      state: { power: "off" },
    } as unknown as SceneObject;
    const live = attachLive(engine);
    live.handle(state("light_living", { power: "on" }));
    expect(engine.states.has("light_living")).toBe(false);
    live.handle({ type: "layout", op: "add", object: light });
    await flush();
    expect(engine.states.getState("light_living")).toEqual({ power: "on" });
    expect(engine.requestRender).toHaveBeenCalled();
    // 다시 접속(hello)하면 앞 접속의 상태는 버린다: 새 접속이 상태를 다시 보낸다
    live.handle(hello);
    live.handle({ type: "layout", op: "add", object: light });
    await flush();
    expect(engine.states.getState("light_living")).toEqual({ power: "off" });
  });

  it("asset을 못 불러오면 회색 상자", async () => {
    const { engine } = fakeEngine({ load: async () => { throw new Error("404"); } });
    attachLive(engine).handle({ type: "layout", op: "add", object: { ...crate, asset: "assets/props/none.glb" } });
    await flush();
    expect(meshesOf(engine.find("box_1")!).map((m) => (m.geometry as THREE.BoxGeometry).type)).toEqual(["BoxGeometry"]);
  });

  it("불러오는 동안 온 옮기기는 더한 뒤 그 자리에, 빼기는 더하지 않는다", async () => {
    let done!: (g: THREE.Object3D) => void;
    const { engine } = fakeEngine({ load: () => new Promise((r) => { done = r; }) });
    const live = attachLive(engine);
    live.handle({ type: "layout", op: "add", object: { ...crate, asset: "assets/props/box.glb" } });
    live.handle(move("box_1", [7, 0, 7], [0, 0, 0]));
    live.handle({ type: "layout", op: "add", object: { ...crate, id: "box_2", asset: "assets/props/box.glb" } });
    live.handle({ type: "layout", op: "remove", id: "box_2" });
    const g = new THREE.Group();
    const top = new THREE.Group();
    top.name = "box";
    top.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), fabric));
    g.add(top);
    done(g);
    await flush();
    expect(close(engine.find("box_1")!.position)).toEqual([7, 0, 7]);
    expect(engine.find("box_2")).toBeNull();
  });
});

describe("배치 빼기", () => {
  it("정적 물건은 뗀 뒤 숨기고, 가전은 떼지 않고 숨기며 상태 연결도 끊는다", () => {
    const { engine, sofa, fridge, detach, setState } = fakeEngine();
    const live = attachLive(engine);
    live.handle({ type: "layout", op: "remove", id: SOFA });
    expect(detach.mock.calls).toEqual([[SOFA]]);
    expect(sofa.visible).toBe(false);
    expect(engine.anchor(SOFA)).toBeNull();
    live.handle({ type: "layout", op: "remove", id: FRIDGE });
    expect(detach).toHaveBeenCalledTimes(1);
    expect(fridge.visible).toBe(false);
    expect(engine.states.getAttrs(FRIDGE)).toBeNull();
    live.handle(state(FRIDGE, { door: "open" }));
    expect(setState).not.toHaveBeenCalled();
    expect(engine.requestRender).toHaveBeenCalledTimes(2);
  });

  it("뺀 물건을 다시 더하면(되돌리기) 그 노드를 다시 보이고 상태를 다시 잇는다", async () => {
    const { engine, sofa, fridge, setState } = fakeEngine();
    const live = attachLive(engine);
    live.handle({ type: "layout", op: "remove", id: SOFA });
    live.handle({ type: "layout", op: "remove", id: FRIDGE });
    live.handle({ type: "layout", op: "add", object: entryOf(SOFA) });
    live.handle({ type: "layout", op: "add", object: entryOf(FRIDGE) });
    await flush();
    expect([sofa.visible, fridge.visible]).toEqual([true, true]);
    expect(engine.root.getObjectsByProperty("name", SOFA)).toHaveLength(1);
    live.handle(state(FRIDGE, { door: "open" }));
    expect(setState.mock.calls).toEqual([[FRIDGE, "door", "open"]]);
  });
});

describe("접속 때 맞추기", () => {
  // 서버 LayoutEditor.syncMessages()의 모양: 원래 배치에서 옮긴 것은 move, 뺀 것은 remove, 더한 것은 add
  const sync: LayoutMessage[] = [
    move(SOFA, [6.5, 0, 9.2], [0, 0, 0]),
    { type: "layout", op: "remove", id: FRIDGE },
    { type: "layout", op: "add", object: crate },
  ];

  it("맞추기 메시지를 받아도 하나씩 받은 것과 같고, 다시 접속해 또 받아도 그대로다", async () => {
    const one = fakeEngine();
    const a = attachLive(one.engine);
    for (const m of sync) a.handle(m);
    await flush();
    const two = fakeEngine();
    const b = attachLive(two.engine);
    for (let round = 0; round < 2; round++) {
      b.handle(hello);
      for (const m of sync) b.handle(m);
      await flush();
    }
    const look = (f: ReturnType<typeof fakeEngine>) => ({
      sofa: close(f.sofa.position), fridge: f.fridge.visible, boxes: f.engine.root.getObjectsByProperty("name", "box_1").length,
      box: close(f.engine.find("box_1")!.position), detach: f.detach.mock.calls,
    });
    expect(look(two)).toEqual(look(one));
    expect(look(two)).toEqual({ sofa: [6.5, 0, 9.2], fridge: false, boxes: 1, box: [8, 0, 9], detach: [[SOFA]] });
  });

  it("끊긴 사이 배치가 원래대로 돌아가면, 다시 접속한 hello에서 옮긴 것·뺀 것·더한 것을 원래대로 돌린 뒤 빈 맞추기를 받는다", async () => {
    const f = fakeEngine();
    const live = attachLive(f.engine);
    const sofaAt = close(f.sofa.position);
    const sofaTurn = close(f.sofa.rotation);
    const tableAt = close(f.table.position);
    for (const m of sync) live.handle(m);
    live.handle({ type: "layout", op: "remove", id: TABLE });
    live.handle({ type: "layout", op: "add", object: { ...entryOf(TABLE), position: [2, 0, 2] } });
    await flush();
    expect(close(f.table.position)).toEqual([2, 0, 2]);
    const moved = f.engine.anchor(SOFA);
    f.engine.requestRender.mockClear();
    live.handle(hello);
    expect(f.engine.requestRender).toHaveBeenCalledTimes(1);
    expect([close(f.sofa.position), close(f.sofa.rotation)]).toEqual([sofaAt, sofaTurn]);
    expect(close(f.table.position)).toEqual(tableAt);
    expect(f.fridge.visible).toBe(true);
    expect(f.engine.find("box_1")).toBeNull();
    expect(f.engine.layout.isRemoved(FRIDGE)).toBe(false);
    expect(f.engine.anchor(SOFA)).toEqual(boxAt(f.sofa));
    expect(f.engine.anchor(SOFA)).not.toEqual(moved);
    live.handle(state(FRIDGE, { door: "open" }));
    expect(f.setState.mock.calls).toEqual([[FRIDGE, "door", "open"]]);
    live.handle(hello);
    expect(f.engine.requestRender).toHaveBeenCalledTimes(2);
  });

  it("더하는 중에 다시 접속하면 그 더하기는 버린다", async () => {
    let done!: (g: THREE.Object3D) => void;
    const { engine } = fakeEngine({ load: () => new Promise((r) => { done = r; }) });
    const live = attachLive(engine);
    live.handle({ type: "layout", op: "add", object: { ...crate, asset: "assets/props/box.glb" } });
    live.handle(hello);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), fabric));
    done(g);
    await flush();
    expect(engine.find("box_1")).toBeNull();
  });
});

describe("엔진 전 메시지", () => {
  it("기기마다 마지막 상태와 온 차례의 배치를 모았다가 상태 → 배치 차례로 넣는다", () => {
    const q = new LiveQueue();
    q.push(hello);
    q.push(state(FRIDGE, { door: "open" }));
    q.push(state(FRIDGE, { door: "closed" }));
    q.push(move(SOFA, [6.5, 0, 9.2], [0, 0, 0]));
    q.push({ type: "plan", plan: null });
    const drained = q.drain();
    expect(drained).toEqual([state(FRIDGE, { door: "closed" }), move(SOFA, [6.5, 0, 9.2], [0, 0, 0])]);
    expect(q.drain()).toEqual([]);
    const { engine, sofa, setState } = fakeEngine({ fridge: { door: "open" } });
    const live = attachLive(engine);
    for (const m of drained) live.handle(m);
    expect(setState.mock.calls).toEqual([[FRIDGE, "door", "closed"]]);
    expect(close(sofa.position)).toEqual([6.5, 0, 9.2]);
  });

  it("hello가 오면 모은 배치를 비운다(서버가 맞추기 메시지를 다시 보냄)", () => {
    const q = new LiveQueue();
    q.push(move(SOFA, [6.5, 0, 9.2], [0, 0, 0]));
    q.push(state(FRIDGE, { door: "open" }));
    q.push(hello);
    expect(q.drain()).toEqual([state(FRIDGE, { door: "open" })]);
  });
});
