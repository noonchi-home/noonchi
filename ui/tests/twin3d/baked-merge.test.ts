// @vitest-environment node
// 배치 편집으로 뺀 구운 물건(검토 R12): 트윈 3D는 구운 장면(/api/scene/baked)으로 상태·정적 합치기를 만들고, 연결 때 오는 맞추기 remove가
// 그 물건을 합침에서 떼고 숨긴다(고친 배치 /api/scene에는 그 물건이 없다). 원뿔 걷기 격자는 고친 배치를 쓴다.
// 한양목련 실제 장면·카탈로그·구운 manifest, 배치 편집(edits.json remove와 같은 applyEdits)으로 뺀 탁자(정적)·가전 stand_ac(dynamic)·옷장(clip).
// GLB는 물건마다 메시 하나인 가짜 나무다.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { routeLayout } from "@viewer/layout.mjs";
import { describe, expect, it } from "vitest";
import type { SceneObject } from "../../../src/contract/layout.ts";
import { loadCatalog } from "../../../src/layout/catalog.ts";
import { LayoutEditor } from "../../../src/layout/editor.ts";
import { resolveHome } from "../../../src/layout/homes.ts";
import { loadScene, withFootprints } from "../../../src/layout/scene.ts";
import { BAKED_SCENE_PATH, SCENE_PATH } from "../../../src/shared/scene-paths.ts";
import { TwinEngine, bakedMerge, twinScenes, type EngineIo } from "../../src/twin/3d/engine";
import { LayoutOps } from "../../src/twin/3d/live";

const home = resolveHome(resolve(dirname(fileURLToPath(import.meta.url)), "../../../twin"), "mokryeon_180b");
const REMOVED = ["coffee_table_38536572", "stand_ac_dc22b8f3", "wardrobe_0358a8fe"];
const KEPT = "sofa_a848b595";

/** 조상까지 모두 보이는가(그려지는가). */
const drawn = (n: THREE.Object3D): boolean => n.visible && (!n.parent || drawn(n.parent));

describe("배치 편집으로 뺀 구운 물건", () => {
  it("edits.json remove로 탁자·stand_ac·옷장을 뺀 뒤 대시보드를 열면: 맞추기 remove로 셋 다 숨고 합친 메시에도 남지 않는다. 걷기 격자 장면에는 셋이 없다", async () => {
    const runtimeDir = mkdtempSync(join(tmpdir(), "baked-merge-"));
    try {
      // 서버가 띄울 때 edits.json을 다시 적용하는 것과 같다(src/layout/load.ts)
      const catalog = loadCatalog(home.catalogDir);
      const base = loadScene(home)!;
      const editor = new LayoutEditor({ homeId: home.id, scene: loadScene(home)!, catalog, savePath: join(runtimeDir, "edits.json"), outDir: home.outDir, libraryDir: home.libraryDir, unbaked: base.added });
      expect(editor.applyEdits(REMOVED.map((id) => ({ op: "remove" as const, id })))).toBe(REMOVED.length);
      const layout = { editor };
      const footprint = (type: string) => catalog.get(type)?.footprint;
      // 서버가 주는 두 장면: 구운 장면(/api/scene/baked)과 고친 배치(/api/scene)
      const served: Record<string, unknown> = {
        "/api/scene/baked": { scene: withFootprints(base, footprint) },
        "/api/scene": { scene: withFootprints({ ...base, objects: layout.editor.objects() }, footprint) },
      };
      const scenes = await twinScenes(async <T,>(url: string) => served[url] as T);
      const layoutIds = (scenes.layout.objects as SceneObject[]).map((o) => o.id);
      for (const id of REMOVED) expect(layoutIds).not.toContain(id);

      const scene3 = new THREE.Scene();
      const root = new THREE.Group();
      scene3.add(root);
      const material = new THREE.MeshBasicMaterial();
      const meshes = new Map<string, THREE.Mesh>();
      for (const id of [...REMOVED, KEPT]) {
        const node = new THREE.Group();
        node.name = id;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
        mesh.name = `${id}_body`;
        mesh.userData.baked = true;
        node.add(mesh);
        root.add(node);
        meshes.set(id, mesh);
      }
      root.updateMatrixWorld(true);
      const manifest = JSON.parse(readFileSync(join(home.outDir, "bake", "manifest.json"), "utf8")) as { view: { clip: string[] }; dynamic: Record<string, unknown> };
      const find = (id: string) => root.getObjectByName(id) ?? null;
      const merge = bakedMerge(scene3, root, scenes.baked.objects as SceneObject[], { clip: manifest.view.clip, dynamic: Object.keys(manifest.dynamic), keep: [] }, find);
      merge.build();
      const ops = new LayoutOps({ root, merge, states: { add: () => true, remove: () => true }, find, forgetAnchor: () => {} });
      // 대시보드가 연결될 때 서버가 보내는 맞추기 메시지
      for (const m of layout.editor.syncMessages()) routeLayout(m, ops);

      for (const id of REMOVED) expect(drawn(meshes.get(id)!), id).toBe(false);
      expect(drawn(meshes.get(KEPT)!)).toBe(false);
      const mergedVertices = scene3.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh).reduce((n, m) => n + m.geometry.attributes.position!.count, 0);
      expect(mergedVertices).toBe(meshes.get(KEPT)!.geometry.attributes.position!.count);
    } finally {
      rmSync(runtimeDir, { recursive: true, force: true });
    }
  });

  it("엔진 불러오기(TwinEngine.load)는 구운 장면으로 합치기를 만든다: edits.json remove로 뺀 탁자·stand_ac·옷장이 맞추기 remove 뒤 그려지지 않고, 합친 메시에는 소파만 남는다", async () => {
    const runtimeDir = mkdtempSync(join(tmpdir(), "baked-merge-"));
    try {
      const catalog = loadCatalog(home.catalogDir);
      const base = loadScene(home)!;
      const editor = new LayoutEditor({ homeId: home.id, scene: loadScene(home)!, catalog, savePath: join(runtimeDir, "edits.json"), outDir: home.outDir, libraryDir: home.libraryDir, unbaked: base.added });
      expect(editor.applyEdits(REMOVED.map((id) => ({ op: "remove" as const, id })))).toBe(REMOVED.length);
      const footprint = (type: string) => catalog.get(type)?.footprint;
      const manifest = JSON.parse(readFileSync(join(home.outDir, "bake", "manifest.json"), "utf8")) as { nodes: Record<string, string> };
      const served: Record<string, unknown> = {
        [BAKED_SCENE_PATH]: { scene: withFootprints(base, footprint) },
        [SCENE_PATH]: { scene: withFootprints({ ...base, objects: editor.objects() }, footprint) },
        "/twin/bake/manifest.json": manifest,
      };
      // 구운 GLB 모양의 가짜 나무: 물건 노드마다 manifest 메시 이름 하나(탁자·소파 lm0, 옷장 lm2), stand_ac는 굽지 않은 가전 메시
      const root = new THREE.Group();
      const furniture = new THREE.Group();
      furniture.name = "furniture";
      root.add(furniture);
      const wood = new THREE.MeshStandardMaterial({ name: "wood" });
      const parts: [string, string][] = [["coffee_table_38536572", "coffee_table_38536572_top"], ["wardrobe_0358a8fe", "wardrobe_0358a8fe_carcass"], ["stand_ac_dc22b8f3", "stand_ac_dc22b8f3_body"], [KEPT, "sofa_a848b595_back"]];
      const meshes = new Map<string, THREE.Mesh>();
      for (const [id, part] of parts) {
        const node = new THREE.Group();
        node.name = id;
        const geometry = new THREE.BoxGeometry();
        geometry.setAttribute("uv1", geometry.attributes.uv!.clone());
        const mesh = new THREE.Mesh(geometry, wood);
        mesh.name = part;
        node.add(mesh);
        furniture.add(node);
        meshes.set(id, mesh);
      }
      expect([manifest.nodes["coffee_table_38536572_top"], manifest.nodes["wardrobe_0358a8fe_carcass"], manifest.nodes["sofa_a848b595_back"], manifest.nodes["stand_ac_dc22b8f3_body"]]).toEqual(["lm0", "lm2", "lm0", undefined]);
      const renderer = {
        setPixelRatio() {}, setSize() {}, toneMapping: 0, toneMappingExposure: 1, shadowMap: { enabled: false }, localClippingEnabled: false, autoClear: true,
        info: { autoReset: true, reset() {} }, capabilities: { getMaxAnisotropy: () => 1 }, compileAsync: async () => {}, render() {}, dispose() {}, forceContextLoss() {},
      } as unknown as THREE.WebGLRenderer;
      const io: EngineIo = {
        renderer: () => renderer,
        json: async <T,>(url: string) => {
          if (!(url in served)) throw new Error(`${url} 404`);
          return served[url] as T;
        },
        gltf: async () => ({ scene: root }),
        texture: async () => new THREE.Texture(),
      };
      const engine = await TwinEngine.load({ canvas: {} as HTMLCanvasElement, home: home.id, box: { width: 1920, height: 1080 }, dpr: 1, io });
      // 대시보드가 연결될 때 서버가 보내는 맞추기 메시지
      for (const m of editor.syncMessages()) routeLayout(m, engine.layout);

      for (const id of REMOVED) expect(drawn(meshes.get(id)!), id).toBe(false);
      const merged = engine.scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.name.startsWith("merged_"));
      expect(merged.reduce((n, m) => n + m.geometry.attributes.position!.count, 0)).toBe(meshes.get(KEPT)!.geometry.attributes.position!.count);
      engine.dispose();
    } finally {
      rmSync(runtimeDir, { recursive: true, force: true });
    }
  });
});
