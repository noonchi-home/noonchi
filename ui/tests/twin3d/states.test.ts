// @vitest-environment node
// 가전 상태의 빛 풀(states.ts TwinStates): 빛은 종류마다 미리 만들어 세기 0으로 장면에 두고 켤 때 빌린다(빛 수가 바뀌면 three가 셰이더를 다시 만들어 화면이 멈춘다).
// 구운 장면의 빛만 세면 나중에 더한 조명(연결 때 layout add, 목련 거실등 area·현관등 spot)은 켜도 빛을 못 받는다: 더할 때 그 빛까지 풀을 준비한다.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TwinStates } from "../../src/twin/3d/states";

type Kind = "area" | "spot" | "point";
const SPEC: Record<Kind, Record<string, unknown>> = {
  area: { kind: "area", watts: 180, three_intensity: 10, size: [0.36, 0.36], direction: [0, -1, 0] },
  spot: { kind: "spot", watts: 400, three_intensity: 20, distance: 8, angle_deg: 80, direction: [0, -1, 0] },
  point: { kind: "point", watts: 60, three_intensity: 5, distance: 4 },
};
/** 빛 기준점 하나(glow)를 가진 조명 노드와 그 상태 칸(power off·on). */
function lamp(id: string, kind: Kind, x = 0) {
  const node = new THREE.Group();
  node.name = id;
  node.position.x = x;
  const glow = new THREE.Object3D();
  glow.name = `${id}_glow`;
  glow.userData = { part: "glow", light: JSON.stringify(SPEC[kind]) };
  node.add(glow);
  const entry = {
    attrs: { power: ["off", "on"] },
    states: { power: { default: "off", effects: { off: [{ light: "glow", intensity: 0 }], on: [{ light: "glow", intensity: 1 }] } } },
  };
  return { node, glow, entry };
}
const lit = (scene: THREE.Scene) => {
  const out: THREE.Light[] = [];
  scene.traverse((n) => { if (n instanceof THREE.Light && n.name === "state_light" && n.intensity > 0) out.push(n); });
  return out;
};
const pooled = (scene: THREE.Scene) => {
  const out: THREE.Light[] = [];
  scene.traverse((n) => { if (n instanceof THREE.Light && n.name === "state_light") out.push(n); });
  return out;
};

describe("빛 풀", () => {
  it("구운 장면의 빛 기준점 수만큼 종류마다 미리 만든다(목련: 냉장고·TV area 둘)", () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    const fridge = lamp("fridge", "area");
    const tv = lamp("tv", "area", 2);
    root.add(fridge.node, tv.node);
    scene.add(root);
    new TwinStates(scene, root);
    expect(pooled(scene).map((l) => l.userData.kind)).toEqual(["area", "area"]);
  });

  it("구운 빛 둘이 켜진 채 나중에 더한 거실등(area)·현관등(spot)을 켜도 빛을 받는다: 더할 때 그 빛까지 풀을 준비한다", () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    const fridge = lamp("fridge", "area");
    const tv = lamp("tv", "area", 2);
    root.add(fridge.node, tv.node);
    scene.add(root);
    const states = new TwinStates(scene, root);
    states.add("fridge", fridge.node, fridge.entry);
    states.add("tv", tv.node, tv.entry);
    states.setState("fridge", "power", "on");
    states.setState("tv", "power", "on");
    expect(lit(scene)).toHaveLength(2);
    // 연결 때 더한 조명(layout add): 노드를 장면에 붙인 뒤 상태 칸을 잇는다
    const ceiling = lamp("light_living", "area", 4);
    const down = lamp("light_entrance", "spot", 6);
    root.add(ceiling.node, down.node);
    states.add("light_living", ceiling.node, ceiling.entry);
    states.add("light_entrance", down.node, down.entry);
    const before = pooled(scene).length;
    expect(before).toBe(4);
    states.setState("light_living", "power", "on");
    states.setState("light_entrance", "power", "on");
    expect(lit(scene)).toHaveLength(4);
    expect(lit(scene).map((l) => l.userData.kind).sort()).toEqual(["area", "area", "area", "spot"]);
    // 켤 때는 빛을 새로 만들지 않는다(장면의 빛 수 그대로)
    expect(pooled(scene)).toHaveLength(before);
  });

  it("같은 노드를 다시 이어도(빼고 다시 더하기) 풀을 또 늘리지 않는다", () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    scene.add(root);
    const states = new TwinStates(scene, root);
    const ceiling = lamp("light_living", "area");
    root.add(ceiling.node);
    states.add("light_living", ceiling.node, ceiling.entry);
    states.remove("light_living");
    states.add("light_living", ceiling.node, ceiling.entry);
    expect(pooled(scene)).toHaveLength(1);
  });
});
