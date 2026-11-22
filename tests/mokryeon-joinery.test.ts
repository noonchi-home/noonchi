import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const bake = new URL("../twin/homes/mokryeon_180b/bake/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", bake), "utf8"));
const bytes = readFileSync(new URL(manifest.glb, bake));
const jsonEnd = 20 + bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.toString("utf8", 20, jsonEnd));
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function coordinates(accessor: number, axis: number, doc = gltf, blob = bytes): number[] {
  const acc = doc.accessors[accessor];
  const view = doc.bufferViews[acc.bufferView];
  const start = 28 + blob.readUInt32LE(12) + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  return Array.from({ length: acc.count }, (_, i) => blob.readFloatLE(start + i * (view.byteStride ?? 12) + axis * 4));
}

it("독립 트윈이 scene.json으로 여는 옷장 다섯 개도 4mm 안쪽 앞판을 쓴다", () => {
  const scene = JSON.parse(readFileSync(new URL("../scene.json", bake), "utf8"));
  const wardrobes = scene.objects.filter((obj: { type: string }) => /^wardrobe(?:_\d+)?$/.test(obj.type));
  expect(wardrobes).toHaveLength(5);
  for (const obj of wardrobes) {
    const asset = readFileSync(new URL("../" + obj.asset, bake));
    const doc = JSON.parse(asset.toString("utf8", 20, 20 + asset.readUInt32LE(12)));
    const doors = doc.nodes.filter((n: { extras?: { part?: string } }) => /^door_(?:\d+|l|r)$/.test(n.extras?.part ?? ""));
    expect(doors.length, obj.asset).toBeGreaterThan(0);
    for (const door of doors) {
      const prim = doc.meshes[door.mesh].primitives[0];
      const front = doc.accessors[prim.attributes.POSITION].max[2];
      const z = coordinates(prim.attributes.POSITION, 2, doc, asset);
      expect(z.filter(v => Math.abs(front - v - 0.004) < 0.00005).length, door.name).toBeGreaterThan(2);
    }
  }
});

it("목련의 기존 경첩·미닫이 노드, 변환, 재질과 재질 배정을 보존한다", () => {
  const nodes = structuredClone(gltf.nodes);
  for (const node of nodes) {
    if (node.mesh === undefined || node.extras?.bake_role !== "static") continue;
    if (!/^(?:door_|wardrobe_|dining_chair_)/.test(node.name)) continue;
    expect(Boolean(node.extras.bake_open), node.name).toBe(node.name.startsWith("dining_chair_"));
    // Compare the other properties, including every transform, to the original house.
    delete node.extras.bake_open;
  }
  expect(digest(nodes)).toBe("a350b65e8ebad21bd29779e9db130298c0a00fe56755b963098a0906ce7f075c");
  expect(digest(gltf.materials)).toBe("aa62c548eb49432fdc369d97c1cb82912f138e7433d44b07bfecd7beb38865d9");
  expect(digest(gltf.meshes.map((m: { primitives: { material: number }[] }) => m.primitives.map(p => p.material))))
    .toBe("d1fc2b0bfdb1bc60f852d5b56550c4060e37b511767f3bc47149e2a6ebd361f3");
  expect(bytes.length).toBe(manifest.glb_bytes);
});

it("소비되는 옷장 문짝 20개에는 테두리 안쪽으로 4mm 물러난 앞판이 있다", () => {
  const doors = gltf.nodes.filter((n: { name: string }) => /^wardrobe_[0-9a-f]+_door_(?:\d+|l|r)$/.test(n.name));
  expect(doors.length).toBe(20);
  for (const door of doors) {
    const prim = gltf.meshes[door.mesh].primitives[0];
    const acc = gltf.accessors[prim.attributes.POSITION];
    const front = acc.max[2];
    const inset = coordinates(prim.attributes.POSITION, 2).filter(z => Math.abs(front - z - 0.004) < 0.00005);
    expect(inset.length, door.name).toBeGreaterThan(2);
    expect(prim.attributes.TEXCOORD_1).toBeDefined();
  }
});

it("여닫이문 10개의 경첩 핀마다 양쪽 고리 홈의 단면이 있다", () => {
  const hinges = gltf.nodes.filter((n: { name: string }) => /^door_.*_hinges$/.test(n.name));
  expect(hinges).toHaveLength(10);
  for (const hinge of hinges) {
    const parts = gltf.nodes.filter((n: { name: string }) => n.name === hinge.name || n.name === hinge.name + "_upper");
    const heights = new Set<number>();
    for (const node of parts) {
      const skin = gltf.meshes[node.mesh].primitives[0];
      for (const y of coordinates(skin.attributes.POSITION, 1)) heights.add(y);
    }
    const barrels: number[][] = [];
    for (const y of [...heights].sort((a, b) => a - b)) {
      const last = barrels.at(-1);
      if (!last || y - last[last.length - 1] > 0.25) barrels.push([y]);
      else last.push(y);
    }
    expect(barrels, hinge.name).toHaveLength(3);
    for (const ys of barrels) {
      const length = ys[ys.length - 1] - ys[0];
      for (const fraction of [0.23, 0.77]) {
        const center = ys[0] + length * fraction;
        expect(ys.some(y => Math.abs(y - center) < 0.00005), hinge.name).toBe(true);
      }
    }
  }
});
