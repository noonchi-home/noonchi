import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadTwin } from "../src/devices/devices.js";
import { listHomes, readRegistry, resolveHome } from "../src/model/homes.js";

const temps: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "twin-home-homes-"));
  temps.push(d);
  return d;
}
function writeJson(path: string, data: unknown) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data), "utf8");
}
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const REGISTRY = {
  version: 1,
  default: "apartment",
  viewer: "apartment/viewer",
  library: "library",
  homes: [
    { id: "apartment", name: "아파트", data: "data/apartment", out: "apartment" },
    { id: "oneroom", name: "원룸 예시", data: "data/homes/oneroom", out: "homes/oneroom" },
  ],
};

function scene(objects: unknown[]) {
  return {
    version: 1,
    plan: { rooms: [{ id: "room", label: "방" }], doors: [] },
    objects,
  };
}

describe("homes.json 읽기", () => {
  it("집 목록·기본 집·경로", () => {
    const dir = tempDir();
    writeJson(join(dir, "homes.json"), REGISTRY);
    const reg = readRegistry(dir);
    expect(reg.default).toBe("apartment");
    expect(reg.viewerDir).toBe(join(dir, "apartment", "viewer"));
    expect(reg.libraryDir).toBe(join(dir, "library"));
    expect(reg.homes.map((h) => h.id)).toEqual(["apartment", "oneroom"]);
    const one = resolveHome(dir, "oneroom");
    expect(one).toMatchObject({
      id: "oneroom", name: "원룸 예시",
      dataDir: join(dir, "data", "homes", "oneroom"),
      outDir: join(dir, "homes", "oneroom"),
      scenePath: join(dir, "homes", "oneroom", "scene.json"),
      viewerDir: join(dir, "apartment", "viewer"),
      libraryDir: join(dir, "library"),
    });
    expect(resolveHome(dir).id).toBe("apartment");
    expect(listHomes(dir)).toEqual([{ id: "apartment", name: "아파트" }, { id: "oneroom", name: "원룸 예시" }]);
  });

  it("없는 집은 있는 집 목록을 담은 오류", () => {
    const dir = tempDir();
    writeJson(join(dir, "homes.json"), REGISTRY);
    expect(() => resolveHome(dir, "nowhere")).toThrow(/없는 집입니다: nowhere \(있는 집: apartment, oneroom\)/);
  });

  it("homes.json이 없으면 아파트 한 집", () => {
    const dir = tempDir();
    const home = resolveHome(dir);
    expect(home).toMatchObject({ id: "apartment", dataDir: join(dir, "data", "apartment"), outDir: join(dir, "apartment") });
    expect(home.viewerDir).toBe(join(dir, "apartment", "viewer"));
    expect(() => resolveHome(dir, "oneroom")).toThrow(/없는 집입니다/);
  });

  it("카탈로그: 집 폴더 catalog → 공용 data/catalog → 옛 data/apartment/catalog", () => {
    const dir = tempDir();
    writeJson(join(dir, "homes.json"), REGISTRY);
    writeJson(join(dir, "data", "apartment", "catalog", "tv.json"), { type: "tv" });
    expect(resolveHome(dir, "oneroom").catalogDir).toBe(join(dir, "data", "apartment", "catalog"));
    writeJson(join(dir, "data", "catalog", "tv.json"), { type: "tv" });
    expect(resolveHome(dir, "oneroom").catalogDir).toBe(join(dir, "data", "catalog"));
    writeJson(join(dir, "data", "homes", "oneroom", "catalog", "tv.json"), { type: "tv" });
    expect(resolveHome(dir, "oneroom").catalogDir).toBe(join(dir, "data", "homes", "oneroom", "catalog"));
  });

  it("잘못된 homes.json은 한국어 오류", () => {
    const dir = tempDir();
    writeJson(join(dir, "homes.json"), { homes: [{ id: "Bad-Id", data: "x", out: "y" }] });
    expect(() => readRegistry(dir)).toThrow(/homes\.json/);
  });
});

describe("loadTwin이 고른 집을 읽는다", () => {
  it("HOME 고르기: 그 집의 scene.json에서 기기를 만든다", () => {
    const dir = tempDir();
    writeJson(join(dir, "homes.json"), REGISTRY);
    writeJson(join(dir, "apartment", "scene.json"), scene([
      { id: "tv_apt", type: "tv", name: "아파트 TV", room: "room", attrs: { power: ["off", "on"] } },
    ]));
    writeJson(join(dir, "homes", "oneroom", "scene.json"), scene([
      { id: "tv_one", type: "tv", name: "원룸 TV", room: "room", attrs: { power: ["off", "on"] } },
    ]));
    expect(loadTwin(dir).devices.map((d) => d.id)).toEqual(["tv_apt"]);
    const one = loadTwin(dir, { home: "oneroom" });
    expect(one.devices.map((d) => d.id)).toEqual(["tv_one"]);
    expect(one.home.id).toBe("oneroom");
    expect(one.source).toBe("scene");
  });

  it("scene.json이 없으면 그 집의 placement + 공용 카탈로그", () => {
    const dir = tempDir();
    writeJson(join(dir, "homes.json"), REGISTRY);
    writeJson(join(dir, "data", "catalog", "tv.json"), { type: "tv", attrs: { power: ["off", "on"] } });
    writeJson(join(dir, "data", "homes", "oneroom", "floorplan.json"), { rooms: [{ id: "room", label: "방" }], doors: [] });
    writeJson(join(dir, "data", "homes", "oneroom", "placement.json"), {
      items: [{ id: "tv_one", type: "tv", label: "원룸 TV", room: "room", position: [1, 1], facing_deg: 0 }],
    });
    const one = loadTwin(dir, { home: "oneroom" });
    expect(one.source).toBe("catalog");
    expect(one.devices.map((d) => d.id)).toEqual(["tv_one"]);
  });
});
