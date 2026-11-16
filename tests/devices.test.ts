import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { DeviceKind } from "../src/devices/kinds.js";
import { initialTwinState } from "../src/devices/devices.js";
import { DEFAULT_TWIN_DIR, loadDevices, loadTwin, resolveTwinStudioDir } from "../src/layout/twin-files.js";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const STUDIO = resolveTwinStudioDir(process.env.TWIN_STUDIO_DIR, REPO);

const EXPECTED: [string, DeviceKind][] = [
  ["tv_living", "tv"],
  ["light_living", "light"],
  ["ac_living", "aircon"],
  ["induction_1", "cooktop"],
  ["dishwasher_1", "dishwasher"],
  ["washer_1", "washer"],
  ["door_main", "lock"],
  ["curtain_living", "covering"],
  ["sink_1", "valve"],
  ["robot_vacuum_1", "vacuum"],
  ["fridge_1", "fridge"],
  ["door_bed2", "contact"],
];

const temps: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "twin-home-devices-"));
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

describe.each(["auto", "catalog"] as const)("실제 twin-studio 데이터 (source=%s)", (source) => {
  const twin = loadTwin(STUDIO, { source });
  const byId = new Map(twin.devices.map((d) => [d.id, d]));

  it.each(EXPECTED)("%s → %s", (id, kind) => {
    const d = byId.get(id);
    expect(d, `${id} 없음`).toBeDefined();
    expect(d!.kind).toBe(kind);
    expect(d!.matterDeviceType).not.toBe("");
  });

  it("id가 겹치지 않고, 모든 기기에 한국어 이름·방 이름이 있다", () => {
    expect(new Set(twin.devices.map((d) => d.id)).size).toBe(twin.devices.length);
    expect(twin.devices.length).toBeGreaterThanOrEqual(50);
    for (const d of twin.devices) {
      expect(d.label, d.id).toMatch(/[가-힣]/);
      expect(d.roomLabel, d.id).toMatch(/[가-힣]/);
      expect(twin.rooms.some((r) => r.id === d.room), `${d.id} 방 ${d.room}`).toBe(true);
    }
  });

  it("냉장고는 문 센서만, 방문은 접촉 센서", () => {
    expect(byId.get("fridge_1")!.sensors).toEqual(["door"]);
    expect(byId.get("fridge_1")!.capabilities).toEqual([]);
    const door = byId.get("door_bed2")!;
    expect(door.sensors).toEqual(["door"]);
    expect(door.room).toBe("bedroom_2");
    expect(door.roomLabel).toBe("작은방");
    expect(door.label).toBe("작은방 문");
  });

  it("이름·방·attrs가 원본을 따른다", () => {
    const tv = byId.get("tv_living")!;
    expect(tv).toMatchObject({ label: "거실 TV", room: "living_room", roomLabel: "거실", twinType: "tv", twinAttrs: { power: ["off", "on"] } });
    const lock = byId.get("door_main")!;
    expect(lock).toMatchObject({ label: "현관문", room: "entrance", roomLabel: "현관", capabilities: ["lock"], sensors: ["door"] });
    // 값 순서는 twin-studio 카탈로그가 바꿀 수 있다(washer.json: [true,false] → [false,true]). 집합으로 비교한다
    const washer = byId.get("washer_1")!.twinAttrs;
    expect(Object.keys(washer).sort()).toEqual(["door", "running"]);
    expect([...washer.running!].sort()).toEqual([false, true]);
    expect([...washer.door!].sort()).toEqual(["closed", "open"]);
  });

  it("초기 twin 상태는 모든 attr를 가지고 값이 attrs 목록 안에 있다", () => {
    for (const d of twin.devices) {
      const init = twin.initial[d.id]!;
      expect(Object.keys(init).sort(), d.id).toEqual(Object.keys(d.twinAttrs).sort());
      for (const [attr, values] of Object.entries(d.twinAttrs)) expect(values, `${d.id}.${attr}`).toContain(init[attr]);
    }
  });

  it.runIf(source === "catalog")("catalog 초기 상태: 꺼짐·잠김·닫힘", () => {
    expect(twin.initial.tv_living).toEqual({ power: "off" });
    expect(twin.initial.door_main).toEqual({ door: "closed", lock: "locked" });
    expect(twin.initial.washer_1).toEqual({ running: false, door: "closed" });
    expect(twin.initial.curtain_living).toEqual({ curtain: "open" });
  });

  it("twin 전용(월패드·CLOiD 로봇)은 기기 목록에서 빠진다", () => {
    expect(byId.has("wallpad_1")).toBe(false);
    expect(byId.has("robot")).toBe(false);
    expect(twin.skipped.map((s) => s.id)).toEqual(expect.arrayContaining(["wallpad_1", "robot"]));
  });
});

describe("loadDevices", () => {
  it("DeviceSpec 배열을 돌려준다", () => {
    const devices = loadDevices(STUDIO, { source: "catalog" });
    expect(devices.find((d) => d.id === "light_living")?.kind).toBe("light");
  });
});

describe("원본 고르기", () => {
  const floorplan = {
    rooms: [
      { id: "living_room", label: "거실", polygon: [] },
      { id: "entrance", label: "현관", polygon: [] },
    ],
    doors: [
      { id: "door_main", position: [0, 0], connects: ["entrance", "outside"], kind: "swing", asset: "door_main", swing_into: "outside" },
    ],
  };
  const catalog = {
    tv: { type: "tv", label: "TV 65형", attrs: { power: ["off", "on"] } },
    sofa: { type: "sofa", label: "소파" },
    door_main: { type: "door_main", label: "현관문(도어록)", attrs: { door: ["closed", "open"], lock: ["locked", "unlocked"] } },
    floor_lamp: { type: "floor_lamp", label: "플로어 스탠드", attrs: { power: ["off", "on"] }, states: { power: { default: "on", effects: {} } } },
  };

  function writeCatalogData(dir: string, items: unknown[]) {
    writeJson(join(dir, "data/apartment/floorplan.json"), floorplan);
    writeJson(join(dir, "data/apartment/placement.json"), { items });
    for (const [type, entry] of Object.entries(catalog)) writeJson(join(dir, `data/apartment/catalog/${type}.json`), entry);
  }

  it("scene.json이 있으면 그것을 쓴다(attrs 있는 객체만, state > states.default)", () => {
    const dir = tempDir();
    writeCatalogData(dir, []);
    writeJson(join(dir, "apartment/scene.json"), {
      version: 1,
      plan: { rooms: floorplan.rooms, doors: floorplan.doors },
      objects: [
        { id: "walls", type: "walls", name: "벽", room: null, attrs: {}, states: {}, state: {} },
        { id: "tv_1", type: "tv", name: "안방 TV", room: "living_room", attrs: { power: ["off", "on"] }, states: { power: { default: "off" } }, state: { power: "on" } },
        { id: "sofa_1", type: "sofa", name: "소파", room: "living_room", attrs: {}, states: {}, state: {} },
        { id: "door_main", type: "door_main", name: "현관문(도어록)", room: "entrance",
          attrs: { door: ["closed", "open"], lock: ["locked", "unlocked"] }, states: { door: { default: "closed" }, lock: { default: "locked" } }, state: {} },
      ],
    });
    const twin = loadTwin(dir);
    expect(twin.source).toBe("scene");
    expect(twin.devices.map((d) => d.id)).toEqual(["tv_1", "door_main"]);
    expect(twin.devices[0]).toMatchObject({ label: "안방 TV", roomLabel: "거실", kind: "tv" });
    expect(twin.devices[1]).toMatchObject({ label: "현관문", kind: "lock" });
    expect(twin.initial.tv_1).toEqual({ power: "on" });
    expect(twin.initial.door_main).toEqual({ door: "closed", lock: "locked" });
    expect(loadTwin(dir, { source: "catalog" }).source).toBe("catalog");
  });

  it("scene.json이 없으면 catalog + placement + floorplan 문", () => {
    const dir = tempDir();
    writeCatalogData(dir, [
      { id: "tv_1", type: "tv", label: "거실 TV", room: "living_room", position: [0, 0], facing_deg: 0, state: { power: "on" } },
      { id: "lamp_1", type: "floor_lamp", label: "스탠드", room: "living_room", position: [0, 0], facing_deg: 0 },
      { id: "sofa_1", type: "sofa", label: "소파", room: "living_room", position: [0, 0], facing_deg: 0 },
    ]);
    const twin = loadTwin(dir);
    expect(twin.source).toBe("catalog");
    expect(twin.devices.map((d) => d.id)).toEqual(["tv_1", "lamp_1", "door_main"]);
    expect(twin.initial).toEqual({ tv_1: { power: "on" }, lamp_1: { power: "on" }, door_main: { door: "closed", lock: "locked" } });
    expect(twin.rooms).toEqual([{ id: "living_room", label: "거실" }, { id: "entrance", label: "현관" }]);
    expect(twin.devices[2]).toMatchObject({ room: "entrance", roomLabel: "현관", label: "현관문" });
  });

  it("scene.json이 깨져 있으면 경고하고 catalog로 돌아간다", () => {
    const dir = tempDir();
    writeCatalogData(dir, []);
    mkdirSync(join(dir, "apartment"), { recursive: true });
    writeFileSync(join(dir, "apartment/scene.json"), "{ not json", "utf8");
    const twin = loadTwin(dir);
    expect(twin.source).toBe("catalog");
    expect(twin.warnings.join("\n")).toMatch(/scene\.json/);
  });

  it("데이터가 없으면 경로를 담은 한국어 오류", () => {
    const dir = tempDir();
    expect(() => loadTwin(dir)).toThrow(/twin-studio 데이터를 찾을 수 없습니다/);
  });
});

describe("initialTwinState", () => {
  it("state > states.default > 기본값", () => {
    const attrs = { power: ["off", "on"], door: ["closed", "open"], running: [true, false] };
    expect(initialTwinState(attrs)).toEqual({ power: "off", door: "closed", running: false });
    expect(initialTwinState(attrs, { power: { default: "on" } })).toEqual({ power: "on", door: "closed", running: false });
    expect(initialTwinState(attrs, { power: { default: "on" } }, { power: "off", running: true })).toEqual({ power: "off", door: "closed", running: true });
  });
});

describe("resolveTwinStudioDir", () => {
  it("기본값은 저장소 twin/, 상대 경로는 base 기준", () => {
    const saved = process.env.TWIN_STUDIO_DIR;
    delete process.env.TWIN_STUDIO_DIR;
    try {
      const base = join(tmpdir(), "x", "twin-home");
      expect(resolveTwinStudioDir(undefined, base)).toBe(resolve(DEFAULT_TWIN_DIR));
      expect(resolveTwinStudioDir("x", base)).toBe(join(base, "x"));
      expect(resolveTwinStudioDir("../studio2", base)).toBe(join(tmpdir(), "x", "studio2"));
    } finally {
      if (saved !== undefined) process.env.TWIN_STUDIO_DIR = saved;
    }
  });
});
