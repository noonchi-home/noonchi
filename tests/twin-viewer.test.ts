// 트윈 뷰어(twin/apartment/viewer, /twin/viewer/): 집 산출물에 없는 apartment_complete.glb를 받지 않는다.
// 이 저장소 twin/에는 apartment_complete.glb가 없다(scripts/twin-assets.ts가 복사하지 않음). 위치 대조는 스튜디오 검사(?debug=1)에서만 한다.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VIEWER = join(ROOT, "twin", "apartment", "viewer");
type SceneModule = { completeCheckUrl?: (base: string, search: string) => string | null };

describe("트윈 뷰어", () => {
  it("화면(대시보드·설정·embed)에서는 apartment_complete.glb 위치 대조를 하지 않고, ?debug=1 검사에서만 그 주소를 준다", async () => {
    const scene = (await import(pathToFileURL(join(VIEWER, "scene.mjs")).href)) as SceneModule;
    expect(typeof scene.completeCheckUrl).toBe("function");
    expect(scene.completeCheckUrl!("/twin/", "?live=auto&embed=1")).toBeNull();
    expect(scene.completeCheckUrl!("/twin/", "")).toBeNull();
    expect(scene.completeCheckUrl!("/twin/", "?debug=1")).toBe("/twin/apartment_complete.glb");
  });

  it("main.mjs는 불러온 뒤 검사에서 completeCheckUrl이 준 주소만 받는다", () => {
    const main = readFileSync(join(VIEWER, "main.mjs"), "utf8");
    expect(main).toContain("completeCheckUrl(BASE, location.search)");
    const deviation = main.slice(main.indexOf("async function deviation()"), main.indexOf("function independence()"));
    expect(deviation).not.toContain("load(COMPLETE)");
  });

  it("저장소 twin/의 집에는 apartment_complete.glb가 없다", () => {
    const homes = JSON.parse(readFileSync(join(ROOT, "twin", "homes.json"), "utf8")) as { homes: { id: string; out: string }[] };
    expect(homes.homes.map((h) => h.id)).toContain("mokryeon_180b");
    for (const h of homes.homes) {
      expect(existsSync(join(ROOT, "twin", h.out, "scene.json")), h.id).toBe(true);
      expect(readdirSync(join(ROOT, "twin", h.out)), h.id).not.toContain("apartment_complete.glb");
    }
  });
});
