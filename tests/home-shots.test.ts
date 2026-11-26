// 장면 사진 가짜 서버(scripts/twin3d/home-shots.ts shotServer): 트윈 엔진(TwinEngine.load twinScenes)이 받는 두 장면 주소에 모두 같은 집 장면으로 답한다.
// 사진은 배치를 고치지 않은 장면이라 구운 장면과 고친 배치가 같다.
import { describe, expect, it } from "vitest";
import type { SceneObject } from "../src/contract/layout.js";
import { resolveHome } from "../src/layout/homes.js";
import { loadScene } from "../src/layout/scene.js";
import { BAKED_SCENE_PATH, SCENE_PATH } from "../src/shared/scene-paths.js";
import { shotServer } from "../scripts/twin3d/home-shots.js";

describe("장면 사진 가짜 서버", () => {
  it("구운 장면(/api/scene/baked)과 고친 배치(/api/scene)에 같은 한양목련 장면으로 답한다", async () => {
    const home = resolveHome("twin", "mokryeon_180b");
    const scene = loadScene(home)!;
    const server = await shotServer(home, scene);
    try {
      const { port } = server.address() as { port: number };
      for (const path of [BAKED_SCENE_PATH, SCENE_PATH]) {
        const r = await fetch(`http://127.0.0.1:${port}${path}`);
        expect(r.status, path).toBe(200);
        const served = ((await r.json()) as { scene: { objects: SceneObject[] } }).scene;
        expect(served.objects.map((o) => o.id), path).toEqual((scene.objects as SceneObject[]).map((o) => o.id));
      }
    } finally {
      await new Promise((done) => server.close(done));
    }
  }, 60_000);
});
