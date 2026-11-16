import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveTwinStudioDir } from "../src/devices/devices.js";
import { approach, floorPlanFrom, roomAt, roomNamedAt, route } from "../src/layout/route.js";

// A(0..4 × 0..4)와 B(4..8 × 0..4)는 트여 있고, C(0..4 × 4..8)는 A와 (2,4) 문으로 이어진다
const scene = {
  plan: {
    rooms: [
      { id: "A", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
      { id: "B", polygon: [[4, 0], [8, 0], [8, 4], [4, 4]] },
      { id: "C", polygon: [[0, 4], [4, 4], [4, 8], [0, 8]] },
    ],
    doors: [{ id: "d1", position: [2, 4], connects: ["A", "C"] }],
    open_edges: [["A", "B"]],
    robot: { dock: "dock", reachable_rooms: ["A", "B", "C"] },
  },
  objects: [
    { id: "dock", type: "robot_dock", room: "C", plan: { position: [2, 6] } },
    { id: "table", type: "dining_table", room: "B", plan: { position: [6, 2] } },
  ],
};

describe("바닥 경로", () => {
  const fp = floorPlanFrom(scene);
  it("로봇은 충전대 자리에서 시작", () => {
    expect(fp.robot).toEqual({ position: [2, 6], room: "C", reachable: ["A", "B", "C"] });
  });
  it("트인 경계는 겹치는 변의 가운데", () => {
    expect(fp.portals.find((p) => p.rooms.includes("B"))?.point).toEqual([4, 2]);
  });
  it("방 찾기", () => {
    expect(roomAt(fp, [6, 1])).toBe("B");
    expect(roomAt(fp, [20, 20])).toBeNull();
  });
  it("방 찾기(이름): 트윈 방 목록의 이름, 목록에 없는 방은 id", () => {
    const named = roomNamedAt(fp, [{ id: "A", label: "거실" }, { id: "B", label: "주방" }]);
    expect(named([6, 1])).toEqual({ id: "B", label: "주방" });
    expect(named([2, 6])).toEqual({ id: "C", label: "C" });
    expect(named([20, 20])).toBeNull();
  });
  it("C에서 B 식탁까지: 문 → 트인 경계 → 식탁", () => {
    expect(route(fp, [2, 6], [6, 2])).toEqual([[2, 6], [2, 4], [4, 2], [6, 2]]);
  });
  it("갈 수 없는 방이면 null", () => {
    const blocked = floorPlanFrom({ ...scene, plan: { ...scene.plan, robot: { dock: "dock", reachable_rooms: ["C"] } } });
    expect(route(blocked, [2, 6], [6, 2])).toBeNull();
  });
  it("목적지 0.5m 앞에서 멈춘다", () => {
    expect(approach([[0, 0], [0, 2]], 0.5)).toEqual([[0, 0], [0, 1.5]]);
  });
});

describe("로봇 시작점이 없는 집", () => {
  // 로봇·충전대 물건이 없고 plan.robot도 없다. D: 현관 단차(-0.1m), bath_1: 욕실
  const bare = floorPlanFrom({
    plan: {
      rooms: [
        ...scene.plan.rooms,
        { id: "D", floor_z: -0.1, polygon: [[8, 0], [12, 0], [12, 4], [8, 4]] },
        { id: "bath_1", floor_z: 0, polygon: [[4, 4], [8, 4], [8, 8], [4, 8]] },
      ],
      doors: scene.plan.doors,
      open_edges: [["A", "B"], ["B", "D"], ["C", "bath_1"]],
    },
    objects: [scene.objects[1]],
  });
  it("로봇·충전대가 없으면 위치 null, 경로 없음", () => {
    expect(bare.robot.position).toBeNull();
    expect(bare.robot.room).toBeNull();
    expect(route(bare, bare.robot.position, [6, 2])).toBeNull();
  });
  it("갈 수 있는 방 기본값: 단차·욕실 제외", () => {
    expect(bare.robot.reachable).toEqual(["A", "B", "C"]);
  });
  it("시작점이 주어지면 경로가 있다", () => {
    expect(route(bare, [2, 6], [6, 2])?.at(-1)).toEqual([6, 2]);
  });
  it("갈 수 있는 방 바로 옆이어도 못 가는 방(욕실)이 목적지면 null", () => {
    expect(bare.portals.some((p) => p.rooms.includes("C") && p.rooms.includes("bath_1"))).toBe(true);
    expect(route(bare, [2, 6], [6, 6])).toBeNull();
  });
});

const STUDIO = resolveTwinStudioDir(process.env.TWIN_STUDIO_DIR, fileURLToPath(new URL("..", import.meta.url)));
const APARTMENT = join(STUDIO, "apartment", "scene.json");
const MOKRYEON = join(STUDIO, "homes", "mokryeon_180b", "scene.json");
type RealScene = { objects: { id: string; type: string; room?: string | null; plan?: { position?: [number, number] } }[] };
// 건너뛰는 묶음도 본문은 돈다. 파일은 시험 안에서 처음 쓸 때 읽는다.
const home = (path: string) => {
  let cached: { real: RealScene; fp: ReturnType<typeof floorPlanFrom> } | undefined;
  return () => {
    if (!cached) {
      const real = JSON.parse(readFileSync(path, "utf8")) as RealScene;
      cached = { real, fp: floorPlanFrom(real) };
    }
    return cached;
  };
};

describe.skipIf(!existsSync(APARTMENT))("마곡 아파트(twin-studio apartment)", () => {
  const load = home(APARTMENT);
  it("복도 로봇에서 식탁 table_1까지 경로가 있다", () => {
    const { fp } = load();
    expect(fp.robot.position).toEqual([3.9, 5.51]);
    const path = route(fp, fp.robot.position, fp.objects.get("table_1")!.position);
    expect(path?.[0]).toEqual([3.9, 5.51]);
    expect(path?.at(-1)).toEqual([8.04, 2.7]);
    expect(path!.length).toBeLessThanOrEqual(3);
  });
  it("가구·가전 자리는 그 물건의 방에 있다", () => {
    const { real, fp } = load();
    const wrong = real.objects
      .filter((o) => o.plan?.position && !/^(door|win)_/.test(o.id))
      .filter((o) => roomAt(fp, o.plan!.position!) !== (o.room ?? null))
      .map((o) => o.id);
    expect(wrong).toEqual([]);
  });
});

describe.skipIf(!existsSync(MOKRYEON))("한양목련 180B(로봇 자리 없음)", () => {
  const load = home(MOKRYEON);
  const table = () => load().real.objects.find((o) => o.type === "dining_table")!.plan!.position!;
  it("로봇 위치 null, 경로 없음", () => {
    const { fp } = load();
    expect(fp.robot.position).toBeNull();
    expect(route(fp, fp.robot.position, table())).toBeNull();
  });
  it("갈 수 있는 방 기본값: 발코니·현관·전실(단차 -0.1m)과 욕실 제외", () => {
    const { fp } = load();
    expect(fp.robot.reachable).toEqual(expect.arrayContaining(["living", "kitchen", "bed_sw", "alpha"]));
    for (const r of ["balcony_front", "balcony_north", "balcony_west", "entrance", "vestibule", "bath_west", "bath_center", "bath_east"]) expect(fp.robot.reachable).not.toContain(r);
  });
  it("알파룸 자리에서 식탁까지는 문을 지나는 경로가 있다", () => {
    expect(route(load().fp, [3.5, 9], table())).toEqual([[3.5, 9], [3.6, 6.75], table()]);
  });
});
