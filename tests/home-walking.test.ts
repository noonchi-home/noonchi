// 걷기 길 자료 캐시(src/server/home/walking.ts, 검토 R5): 설정 화면에서 저장한 자리 지도(HomeCore.setStations, PUT /api/setup/stations)가
// 다음 계획 길 목적지가 된다. 한양목련 실제 장면과 배치 편집기.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SceneObject } from "../src/contract/layout.js";
import { resolveHome } from "../src/layout/homes.js";
import { loadLayout } from "../src/layout/load.js";
import { loadScene } from "../src/layout/scene.js";
import { DEFAULT_TWIN_DIR } from "../src/layout/twin-files.js";
import { moveStop } from "../src/layout/walk-grid.js";
import { HomeCore } from "../src/server/home/core.js";
import type { HomeContext } from "../src/server/home/index.js";
import { walkingCache } from "../src/server/home/walking.js";

const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("걷기 길 자료 캐시", () => {
  it("계획 길을 한 번 만든 뒤 설정 화면에서 식탁 앞자리를 [9.96, 5.15] → [10.5, 5.15]로 옮겨 저장하면, 다음 계획 길의 식탁 이동 끝이 새 앞자리다", () => {
    const runtimeDir = mkdtempSync(join(tmpdir(), "home-walking-"));
    dirs.push(runtimeDir);
    const core = new HomeCore({} as HomeContext);
    core.scene = loadScene(home);
    core.layout = loadLayout(home, { runtimeDir, log: () => {} });
    const walk = walkingCache(core);
    const table = (core.scene!.objects as SceneObject[]).find((o) => o.type === "dining_table")!;
    const stop = () => moveStop(walk.way()!, table.id, table.room, table.plan.position);
    expect(stop()).toEqual([9.96, 5.15]);

    const saved = structuredClone(core.scene!.stations);
    saved.surface_fronts = saved.surface_fronts.map((f) => (f.surface_id === table.id ? { ...f, position: [10.5, 5.15] } : f));
    core.setStations(saved);
    expect(stop()).toEqual([10.5, 5.15]);
  });
});
