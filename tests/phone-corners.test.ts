// 벽 하나로 A·B 구석 채우기(src/phone/corners.ts). 가짜 평면도와 실제 twin-studio 집 파일로 본다.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { autoCorners, parseWallPick, readScenePlan, type HomePlan } from "../src/phone/corners.js";
import { TouchPointsError, homeBounds, parseTouchPoints } from "../src/phone/touch.js";
import { resolveTwinStudioDir } from "../src/model/devices.js";
import { readRegistry } from "../src/model/homes.js";

type P = [number, number];

/** 두께 0.2 바깥벽 네 개로 둘러싼 네모 방(중심선 0..w × 0..h). */
function boxRoom(w: number, h: number, open: ("S" | "E" | "N" | "W")[] = []): HomePlan {
  const sides = {
    S: { a: [0, 0], b: [w, 0], normal: [0, 1] },
    E: { a: [w, 0], b: [w, h], normal: [-1, 0] },
    N: { a: [w, h], b: [0, h], normal: [0, -1] },
    W: { a: [0, h], b: [0, 0], normal: [1, 0] },
  };
  return {
    rooms: [{ id: "room", label: "방", polygon: [[0, 0], [w, 0], [w, h], [0, h]] }],
    walls: (Object.keys(sides) as (keyof typeof sides)[]).filter((k) => !open.includes(k)).map((k) => ({
      id: k, thickness: 0.2, a: sides[k].a, b: sides[k].b, faces: [{ room: "room", normal: sides[k].normal }],
    })),
  };
}
const at = (points: { id: string; position: P }[]) => Object.fromEntries(points.map((p) => [p.id, p.position]));

describe("autoCorners: 가짜 평면도", () => {
  const box = boxRoom(4, 3);

  it("벽 하나를 누르면 A는 그 벽의 가까운 구석, B는 맞은편 벽에서 A와 먼 구석이다(방 쪽 면 기준)", () => {
    const points = autoCorners(box, { position: [1, 0.1], room: "room", normal: [0, 1] });
    expect(points).toEqual([
      { id: "A", label: "방 구석", position: [0.1, 0.1] },
      { id: "B", label: "방 맞은편 구석", position: [3.9, 2.9] },
    ]);
  });

  it("방·법선이 없거나 방이 틀려도 누른 점에 가장 가까운 면으로 정한다", () => {
    expect(autoCorners(box, { position: [1, 0.1] })).toEqual(autoCorners(box, { position: [1, 0.1], room: "room", normal: [0, 1] }));
    expect(autoCorners(box, { position: [1, 0.1], room: "nope" })).toEqual(autoCorners(box, { position: [1, 0.1] }));
    expect(at(autoCorners(box, { position: [3.9, 2] }))).toEqual({ A: [3.9, 2.9], B: [0.1, 0.1] });
  });

  it("구석 가까이 눌러도, 점이 구석을 지나 옆 벽 두께 안에 있어도 B는 맞은편의 대각선 구석이다", () => {
    expect(at(autoCorners(box, { position: [0.15, 0.1], room: "room", normal: [0, 1] }))).toEqual({ A: [0.1, 0.1], B: [3.9, 2.9] });
    // 뷰어는 벽 중심선 끝까지 붙인다
    expect(at(autoCorners(box, { position: [0, 0.1], room: "room", normal: [0, 1] }))).toEqual({ A: [0.1, 0.1], B: [3.9, 2.9] });
    expect(at(autoCorners(box, { position: [4, 0.1], room: "room", normal: [0, 1] }))).toEqual({ A: [3.9, 0.1], B: [0.1, 2.9] });
    expect(at(autoCorners(box, { position: [3.9, 2.95], room: "room", normal: [-1, 0] }))).toEqual({ A: [3.9, 2.9], B: [0.1, 0.1] });
  });

  it("벽이 끝나는 열린 쪽은 구석이 아니라서 먼 쪽 구석을 A로 쓴다", () => {
    const openEast = boxRoom(4, 3, ["E"]);
    expect(at(autoCorners(openEast, { position: [3.5, 0.1], room: "room", normal: [0, 1] }))).toEqual({ A: [0.1, 0.1], B: [0.1, 2.9] });
  });

  it("기둥이 막은 구석은 벽 면과 기둥 면이 만나는 점으로 옮긴다", () => {
    const plan = boxRoom(4, 3);
    plan.walls.push({
      id: "col", polygon: [[3.5, 2.5], [4, 2.5], [4, 3], [3.5, 3]],
      faces: [{ room: "room", normal: [-1, 0] }, { room: "room", normal: [0, -1] }],
    });
    expect(at(autoCorners(plan, { position: [1, 0.1], room: "room", normal: [0, 1] }))).toEqual({ A: [0.1, 0.1], B: [3.5, 2.9] });
    expect(at(autoCorners(plan, { position: [3.9, 2], room: "room", normal: [-1, 0] }))).toEqual({ A: [3.9, 2.5], B: [0.1, 0.1] });
  });

  it("두 방 사이 열린 경계 위를 누르면 보낸 방을 따른다", () => {
    const plan: HomePlan = {
      rooms: [
        { id: "room", label: "방", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] },
        { id: "hall", label: "복도", polygon: [[4, 0], [6, 0], [6, 3], [4, 3]] },
      ],
      walls: [
        { id: "S", thickness: 0.2, a: [0, 0], b: [6, 0], faces: [{ room: "room", normal: [0, 1] }, { room: "hall", normal: [0, 1] }] },
        { id: "N", thickness: 0.2, a: [6, 3], b: [0, 3], faces: [{ room: "room", normal: [0, -1] }, { room: "hall", normal: [0, -1] }] },
        { id: "W", thickness: 0.2, a: [0, 3], b: [0, 0], faces: [{ room: "room", normal: [1, 0] }] },
        { id: "E", thickness: 0.2, a: [6, 0], b: [6, 3], faces: [{ room: "hall", normal: [-1, 0] }] },
      ],
    };
    expect(at(autoCorners(plan, { position: [4, 0.1], room: "room", normal: [0, 1] }))).toEqual({ A: [0.1, 0.1], B: [0.1, 2.9] });
    expect(at(autoCorners(plan, { position: [4, 0.1], room: "hall", normal: [0, 1] }))).toEqual({ A: [5.9, 0.1], B: [5.9, 2.9] });
  });

  it("맞은편이 열려 있으면 A만 준다", () => {
    const openNorth = boxRoom(4, 3, ["N"]);
    expect(autoCorners(openNorth, { position: [1, 0.1], room: "room", normal: [0, 1] })).toEqual([{ id: "A", label: "방 구석", position: [0.1, 0.1] }]);
  });

  it("A–B가 0.5m보다 가까우면 A만 준다", () => {
    const tiny = boxRoom(0.5, 0.5);
    expect(at(autoCorners(tiny, { position: [0.2, 0.1], room: "room", normal: [0, 1] }))).toEqual({ A: [0.1, 0.1] });
  });

  it("집 범위 검사에 걸리는 점은 빼고, A가 걸리면 아무것도 주지 않는다", () => {
    expect(at(autoCorners(box, { position: [1, 0.1], room: "room", normal: [0, 1] }, { minX: -1, minY: -1, maxX: 2, maxY: 5 }))).toEqual({ A: [0.1, 0.1] });
    expect(autoCorners(box, { position: [1, 0.1], room: "room", normal: [0, 1] }, { minX: 1, minY: -1, maxX: 5, maxY: 5 })).toEqual([]);
  });

  it("양쪽 끝이 다 열린 벽, 벽에서 먼 점은 빈 목록", () => {
    const stub: HomePlan = {
      rooms: [{ id: "room", label: "방", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
      walls: [{ id: "S", thickness: 0.2, a: [0, 0], b: [4, 0], faces: [{ room: "room", normal: [0, 1] }] }],
    };
    expect(autoCorners(stub, { position: [2, 0.1], room: "room", normal: [0, 1] })).toEqual([]);
    expect(autoCorners(box, { position: [2, 1.5] })).toEqual([]);
  });

  it("이름은 방 이름으로 만들고 40자를 넘지 않는다. 방 이름이 없으면 비운다", () => {
    const long = boxRoom(4, 3);
    long.rooms[0]!.label = "가".repeat(45);
    const [a, b] = autoCorners(long, { position: [1, 0.1] });
    expect(a!.label.length).toBeLessThanOrEqual(40);
    expect(b!.label.length).toBeLessThanOrEqual(40);
    expect(b!.label.endsWith(" 맞은편 구석")).toBe(true);
    const nameless = boxRoom(4, 3);
    delete nameless.rooms[0]!.label;
    expect(autoCorners(nameless, { position: [1, 0.1] }).map((p) => p.label)).toEqual(["", ""]);
  });
});

describe("parseWallPick", () => {
  it("위치는 꼭, 방·법선은 있으면 읽는다", () => {
    expect(parseWallPick({ home: "x", position: [1, 2] })).toEqual({ position: [1, 2] });
    expect(parseWallPick({ position: [1, 2], room: "living", normal: [0, -1] })).toEqual({ position: [1, 2], room: "living", normal: [0, -1] });
  });

  it.each([[null], [{}], [{ position: [1] }], [{ position: [1, Number.NaN] }], [{ position: [1, 2], normal: ["a", 1] }], [{ position: [1, 2], room: 3 }]])(
    "틀리면 TouchPointsError(%#)", (raw) => {
      expect(() => parseWallPick(raw)).toThrow(TouchPointsError);
    },
  );
});

// ── 실제 집 파일 ──

const REPO = fileURLToPath(new URL("..", import.meta.url));
const STUDIO = resolveTwinStudioDir(process.env.TWIN_STUDIO_DIR, REPO);
const HOMES = readRegistry(STUDIO).homes.filter((h) => existsSync(h.scenePath));
const plans = new Map(HOMES.map((h) => [h.id, readScenePlan(h.scenePath)]));
const planOf = (id: string) => {
  const plan = plans.get(id);
  if (!plan) throw new Error(`집 ${id}의 scene.json이 없습니다`);
  return plan;
};

describe("실제 집: 손으로 셈한 구석", () => {
  it("한양목련 180B를 포함해 scene.json이 있는 집을 모두 본다", () => {
    expect(HOMES.map((h) => h.id)).toEqual(expect.arrayContaining(["mokryeon_180b", "apartment", "oneroom"]));
  });

  // [집, 방, 누른 점(방 쪽 면 위), 면 법선, A, B 또는 null]
  const CASES: [string, string, P, P, P, P | null][] = [
    // 네모 방. A는 도면 기준 후보 alpha_corner [0.1, 6.0656]
    ["mokryeon_180b", "alpha", [1, 6.066], [0, 1], [0.1, 6.066], [3.525, 10.556]],
    // 구석 가까이, 구석을 지나 옆 벽(E18) 속까지 눌러도 같은 대각선
    ["mokryeon_180b", "alpha", [0.15, 6.066], [0, 1], [0.1, 6.066], [3.525, 10.556]],
    ["mokryeon_180b", "alpha", [0, 6.066], [0, 1], [0.1, 6.066], [3.525, 10.556]],
    // 거실·복도(12각형): 알파룸 쪽 벽을 누르면 복도 끝 욕실 3 앞 구석이 B
    ["mokryeon_180b", "living", [3.675, 7], [1, 0], [3.675, 7.744], [13.594, 6.066]],
    // 침실 3: A는 도면 기준 후보 bed_ne_corner [16.1, 2.2969]
    ["mokryeon_180b", "bed_ne", [16.1, 3], [-1, 0], [16.1, 2.297], [11.859, 5.916]],
    // 침실 3: 기둥(column_ne)이 막은 구석은 기둥 면과 만나는 점
    ["mokryeon_180b", "bed_ne", [16.1, 4.5], [-1, 0], [16.1, 5.147], [11.859, 2.297]],
    ["mokryeon_180b", "bed_ne", [14.5, 5.916], [0, -1], [15.525, 5.916], [11.859, 2.297]],
    // 욕실 2: 샤프트(shaft_center)가 막은 구석
    ["mokryeon_180b", "bath_center", [6.5, 4.266], [0, 1], [5.503, 4.266], [8.7, 5.916]],
    ["mokryeon_180b", "bath_center", [8.7, 5.3], [-1, 0], [8.7, 4.978], [5.503, 5.916]],
    // 주방·식당(ㄱ자, 거실 쪽 열림): 열린 쪽 끝은 구석이 아니고, 맞은편은 냉장고 자리 벽 모서리
    ["mokryeon_180b", "kitchen", [8.5, 4.116], [0, -1], [5.503, 4.116], [8.391, 2.297]],
    // 전면 발코니: 비스듬한 벽(E12)과 만나는 구석
    ["mokryeon_180b", "balcony_front", [9, 12.309], [0, 1], [3.7, 12.309], [9.722, 14.075]],
    // 마곡 아파트 서재: A는 corner_study_se [11.5, 4.89](벽 I12와 기둥 S03 면이 한 줄)
    ["apartment", "bedroom_3", [11.5, 4], [-1, 0], [11.5, 4.89], [8.56, 1.86]],
    // 작은방: A는 corner_bed2_sw [0.1, 10.9]
    ["apartment", "bedroom_2", [0.1, 10], [1, 0], [0.1, 10.9], [3.14, 6.86]],
    // 원룸 방: A는 corner_ne [3.9, 0.1], 맞은편이 주방으로 열려 있어 B 없음
    ["oneroom", "room", [3, 0.1], [0, 1], [3.9, 0.1], null],
    // 원룸 욕실: A는 corner_bath_sw [0.1, 6.5]
    ["oneroom", "bathroom", [0.1, 6], [1, 0], [0.1, 6.5], [1.64, 4.06]],
  ];

  it.each(CASES)("%s %s %j", (home, room, position, normal, a, b) => {
    const plan = planOf(home);
    const points = autoCorners(plan, { position, room, normal }, homeBounds(plan.rooms));
    expect(points.map((p) => p.id)).toEqual(b ? ["A", "B"] : ["A"]);
    expect(points[0]!.position[0]).toBeCloseTo(a[0], 3);
    expect(points[0]!.position[1]).toBeCloseTo(a[1], 3);
    if (b) {
      expect(points[1]!.position[0]).toBeCloseTo(b[0], 3);
      expect(points[1]!.position[1]).toBeCloseTo(b[1], 3);
      expect(() => parseTouchPoints({ points }, homeBounds(plan.rooms))).not.toThrow();
    }
    // 방·법선 없이 위치만 보내도 같다
    expect(autoCorners(plan, { position }, homeBounds(plan.rooms))).toEqual(points);
  });

  it("여러 방이 함께 쓰는 벽(E10)에서 뷰어가 첫 방(bed_ne)을 보내도 누른 점이 든 방(침실 2)으로 정한다", () => {
    const plan = planOf("mokryeon_180b");
    const points = autoCorners(plan, { position: [16.1, 10], room: "bed_ne", normal: [-1, 0] }, homeBounds(plan.rooms));
    expect(points.map((p) => p.label)).toEqual(["침실 2 구석", "침실 2 맞은편 구석"]);
    expect(points[0]!.position[0]).toBeCloseTo(16.1, 3);
    expect(points[0]!.position[1]).toBeCloseTo(7.894, 3);
    expect(points[1]!.position[0]).toBeCloseTo(11.859, 3);
    expect(points[1]!.position[1]).toBeCloseTo(12.159, 3);
  });

  it("이름은 방 이름: 알파룸 구석 / 알파룸 맞은편 구석", () => {
    const points = autoCorners(planOf("mokryeon_180b"), { position: [1, 6.066], room: "alpha", normal: [0, 1] });
    expect(points.map((p) => p.label)).toEqual(["알파룸 구석", "알파룸 맞은편 구석"]);
  });
});

// ── 실제 집: 모든 방의 모든 벽 면 ──
// 시험 쪽 판정: 벽 면은 중심선 + 법선 × 두께/2(고체는 법선이 같은 다각형 변). 구석은 같은 방의 서로 다른 방향 면 두 개 위에 있다.

type Seg = { a: P; b: P; n: P };
const TOL = 0.002;

function faceSegs(plan: HomePlan, room: string): Seg[] {
  const segs: Seg[] = [];
  for (const w of plan.walls) {
    for (const f of w.faces ?? []) {
      if (f.room !== room) continue;
      const len = Math.hypot(f.normal[0]!, f.normal[1]!);
      const n: P = [f.normal[0]! / len, f.normal[1]! / len];
      if (w.a && w.b && typeof w.thickness === "number") {
        const h = w.thickness / 2;
        segs.push({ a: [w.a[0]! + n[0] * h, w.a[1]! + n[1] * h], b: [w.b[0]! + n[0] * h, w.b[1]! + n[1] * h], n });
      } else if (w.polygon) {
        const poly = w.polygon;
        const area = poly.reduce((s, p, i) => s + p[0]! * poly[(i + 1) % poly.length]![1]! - poly[(i + 1) % poly.length]![0]! * p[1]!, 0);
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
          const l = Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!);
          const out: P = [Math.sign(area) * (q[1]! - p[1]!) / l, -Math.sign(area) * (q[0]! - p[0]!) / l];
          if (out[0] * n[0] + out[1] * n[1] > 0.99) segs.push({ a: [p[0]!, p[1]!], b: [q[0]!, q[1]!], n });
        }
      }
    }
  }
  return segs;
}
const distToSeg = (p: P, s: Seg) => {
  const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
  const t = Math.min(1, Math.max(0, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(s.a[0] + dx * t - p[0], s.a[1] + dy * t - p[1]);
};
const distToLine = (p: P, s: Seg) => Math.abs((p[0] - s.a[0]) * s.n[0] + (p[1] - s.a[1]) * s.n[1]);
const inside = (p: P, poly: number[][]) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as P, [xj, yj] = poly[j] as P;
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
/** 방 안이거나 방 다각형 변 위(고체 면이 방 경계와 겹치는 곳, 마곡 안방 욕실 S03). */
const inRoom = (p: P, poly: number[][]) => inside(p, poly) || poly.some((q, i) => {
  const r = poly[(i + 1) % poly.length]!;
  const seg: Seg = { a: [q[0]!, q[1]!], b: [r[0]!, r[1]!], n: [0, 0] };
  return distToSeg(p, seg) < TOL;
});
/** 같은 방의 서로 다른 방향 면 두 개가 만나는 점(벽 끝에서 벽 두께만큼은 이어진 것으로 본다). */
const isCorner = (p: P, segs: Seg[]) => {
  const on = segs.filter((s) => distToSeg(p, s) < 0.16 && distToLine(p, s) < TOL);
  return on.some((s) => on.some((t) => Math.abs(s.n[0] * t.n[0] + s.n[1] * t.n[1]) < 0.9));
};

describe.each(HOMES.map((h) => h.id))("실제 집 %s: 모든 방의 모든 벽 면 가운데와 양 끝을 누른다", (homeId) => {
  const plan = planOf(homeId);
  const bounds = homeBounds(plan.rooms);
  const solids = plan.walls.filter((w) => w.polygon).map((w) => w.polygon!);
  const picks = plan.rooms.flatMap((room) => faceSegs(plan, room.id!).flatMap((seg) => {
    // 면 중 그 방 안에 있고 고체에 가리지 않은 부분의 가운데와 양 끝(끝은 옆 벽 두께 속일 수 있다)
    const free: P[] = [];
    for (let i = 1; i < 400; i++) {
      const t = i / 400;
      const p: P = [seg.a[0] + (seg.b[0] - seg.a[0]) * t, seg.a[1] + (seg.b[1] - seg.a[1]) * t];
      const probe: P = [p[0] + seg.n[0] * 0.01, p[1] + seg.n[1] * 0.01];
      if (inside(probe, room.polygon!) && !solids.some((s) => inside(probe, s))) free.push(p);
    }
    const spots = [free[0], free[Math.floor(free.length / 2)], free.at(-1)].filter((p): p is P => p !== undefined);
    return spots.map((p) => ({ room: room.id!, seg, position: [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000] as P }));
  }));
  const results = picks.map((p) => ({ ...p, points: autoCorners(plan, { position: p.position, room: p.room, normal: p.seg.n }, bounds) }));

  it("A는 누른 벽 위의 같은 방 구석, B는 맞은편 벽 위의 같은 방 구석, A–B ≥ 0.5m, 저장 검사 통과", () => {
    expect(picks.length).toBeGreaterThan(10);
    for (const r of results) {
      const segs = faceSegs(plan, r.room);
      const polygon = plan.rooms.find((x) => x.id === r.room)!.polygon!;
      const where = `${r.room} ${JSON.stringify(r.position)}`;
      const [a, b] = r.points;
      if (!a) continue;
      expect(a.id, where).toBe("A");
      expect(distToLine(a.position, r.seg), where).toBeLessThan(TOL);
      expect(isCorner(a.position, segs), `A ${where} → ${JSON.stringify(a.position)}`).toBe(true);
      expect(inRoom(a.position, polygon), where).toBe(true);
      if (!b) continue;
      expect(b.id, where).toBe("B");
      const opposite = segs.filter((s) => s.n[0] * r.seg.n[0] + s.n[1] * r.seg.n[1] < 0 && distToSeg(b.position, s) < 0.16 && distToLine(b.position, s) < TOL);
      expect(opposite.length, `B ${where} → ${JSON.stringify(b.position)} 맞은편 벽 위`).toBeGreaterThan(0);
      expect(isCorner(b.position, segs), `B ${where} → ${JSON.stringify(b.position)}`).toBe(true);
      expect(inRoom(b.position, polygon), where).toBe(true);
      expect(Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1]), where).toBeGreaterThanOrEqual(0.5);
      expect(() => parseTouchPoints({ points: r.points }, bounds), where).not.toThrow();
    }
  });

  // 구석이 없는 벽도 있다: 양쪽 끝이 열린 벽(마곡 아파트 I03), 마주 보는 두 벽만 있는 방(원룸 주방)
  it("대부분의 벽에서 A를, 절반 넘게 A·B를 채운다", () => {
    const withA = results.filter((r) => r.points.length >= 1).length;
    const withB = results.filter((r) => r.points.length === 2).length;
    expect(withA / results.length).toBeGreaterThan(0.8);
    expect(withB / results.length).toBeGreaterThan(0.5);
  });
});
