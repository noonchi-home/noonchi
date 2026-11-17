// 집마다 충전 자리 하나(twin/data/homes/<집>/dock.json, 2026-11-18 사용자 결정): 장면을 읽을 때 함께 읽고(src/layout/scene.ts loadScene),
// 계획이 끝나면 실행 추적이 그 자리로 돌아간다(src/act/track/dock.ts). 화면에 새 표시는 없다.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveHome } from "../src/layout/homes.js";
import { floorPlanFrom, roomAt, route } from "../src/layout/route.js";
import { loadScene } from "../src/layout/scene.js";
import { DEFAULT_TWIN_DIR } from "../src/layout/twin-files.js";

function tempHome(dock?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "dock-"));
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  const scenePath = join(dir, "scene.json");
  writeFileSync(scenePath, JSON.stringify({ plan: { rooms: [] }, objects: [] }));
  if (dock !== undefined) writeFileSync(join(dataDir, "dock.json"), typeof dock === "string" ? dock : JSON.stringify(dock));
  return { dataDir, scenePath, libraryDir: null } as unknown as Parameters<typeof loadScene>[0];
}

describe("충전 자리(dock.json)", () => {
  it("장면을 읽을 때 그 집의 충전 자리를 트윈 자리 [x, 0, y]로 함께 읽는다. 없거나 틀린 파일이면 충전 자리가 없다", () => {
    expect(loadScene(tempHome({ version: 1, position: [3.5, 7.25] }))!.dock).toEqual([3.5, 0, 7.25]);
    expect(loadScene(tempHome())).not.toHaveProperty("dock");
    for (const bad of [{ version: 1, position: [1] }, { version: 1, position: ["a", 2] }, { version: 1 }, "{깨짐"]) expect(loadScene(tempHome(bad)), JSON.stringify(bad)).not.toHaveProperty("dock");
  });

  it("시연 집(한양목련)의 충전 자리는 거실 벽가의 빈 바닥이다: 거실 안이고 거실 가운데에서 걸어갈 수 있으며 가구에서 0.8m 넘게 떨어져 있다", () => {
    const scene = loadScene(resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b"))!;
    const [x, , z] = scene.dock!;
    const fp = floorPlanFrom(scene);
    expect(roomAt(fp, [x, z])).toBe("living");
    expect(route(fp, [9.5, 9], [x, z])).not.toBeNull();
    const near = [...fp.objects.values()].filter((o) => o.room === "living" && Math.hypot(o.position[0] - x, o.position[1] - z) < 0.8);
    expect(near.map((o) => o.id)).toEqual([]);
    // 거실 동쪽 벽(x 11.78)에서 0.6m 안
    expect(11.784375 - x).toBeLessThan(0.6);
  });
});
