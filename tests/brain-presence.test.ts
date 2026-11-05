// YOLO 존재 판정(최근 창, 놓침 견딤, 모름)과 식탁을 비추는가(눈 자세 + 트윈 식탁).

import { describe, expect, it } from "vitest";
import type { Detection } from "../src/brain/detector.js";
import { DEFAULT_PRESENCE, PresenceTracker, surfacesFrom, tableInView, type Surface } from "../src/brain/presence.js";

const person = (score = 0.8): Detection => ({ label: "person", score, box: [0, 0, 10, 10], cls: 0 });
const cup = (score = 0.7): Detection => ({ label: "cup", score, box: [0, 0, 5, 5], cls: 41 });

describe("PresenceTracker", () => {
  it("창(600ms) 안 프레임 중 하나라도 보이면 있음: 한 장 놓쳐도 컵 있음", () => {
    const t = new PresenceTracker(DEFAULT_PRESENCE);
    t.push({ atMs: 0, detections: [cup()], table: "unknown" });
    t.push({ atMs: 100, detections: [cup()], table: "unknown" });
    const p = t.push({ atMs: 200, detections: [], table: "unknown" })!;
    expect(p).toMatchObject({ atMs: 200, person: "no", cup: "yes", frames: 3 });
  });

  it("창 안에 하나도 없으면 없음, 점수가 기준(사람 0.5·컵 0.4) 아래면 안 본 것으로", () => {
    const t = new PresenceTracker(DEFAULT_PRESENCE);
    t.push({ atMs: 0, detections: [person(), cup()], table: "yes" });
    t.push({ atMs: 700, detections: [person(0.45), cup(0.35)], table: "yes" });
    const p = t.push({ atMs: 800, detections: [], table: "yes" })!;
    expect(p).toMatchObject({ person: "no", cup: "no", table: "yes" });
  });

  it("창 안 프레임이 2장 미만이면 사람·컵 모두 모름(공백 뒤 첫 장)", () => {
    const t = new PresenceTracker(DEFAULT_PRESENCE);
    t.push({ atMs: 0, detections: [cup()], table: "unknown" });
    const p = t.push({ atMs: 5000, detections: [cup()], table: "unknown" })!;
    expect(p).toMatchObject({ person: "unknown", cup: "unknown", frames: 1 });
  });

  it("앞선 촬영 시각의 프레임은 버린다(null)", () => {
    const t = new PresenceTracker(DEFAULT_PRESENCE);
    t.push({ atMs: 500, detections: [], table: "unknown" });
    expect(t.push({ atMs: 400, detections: [person()], table: "unknown" })).toBeNull();
  });

  it("실제 마지막 검출 시각: 창 안에 지난 컵이 남아 있어도 이번 프레임에 없으면 그 시각은 그대로", () => {
    const t = new PresenceTracker(DEFAULT_PRESENCE);
    t.push({ atMs: 0, detections: [cup()], table: "unknown" });
    const p = t.push({ atMs: 300, detections: [person(0.4)], table: "unknown" })!;
    expect(p.cup).toBe("yes");
    expect(p.seen).toEqual({ person: null, cup: 0 });
  });

  it("가장 높은 점수를 기록에 남긴다", () => {
    const t = new PresenceTracker(DEFAULT_PRESENCE);
    t.push({ atMs: 0, detections: [person(0.6)], table: "unknown" });
    const p = t.push({ atMs: 50, detections: [person(0.9), cup(0.5)], table: "unknown" })!;
    expect(p.scores).toEqual({ person: 0.9, cup: 0.5 });
  });
});

describe("tableInView", () => {
  const table: Surface = { id: "dining_table_1", label: "식탁", center: [5, 0], top: 0.75, radius: 0.7 };
  const eye = (yaw: number, pitch = -30, at: [number, number] = [3, 0]) => ({ position: at, height_m: 1.5, yaw_deg: yaw, pitch_deg: pitch });

  it("맞추기 전(눈 자세 없음)은 모름", () => {
    expect(tableInView(null, [table]).table).toBe("unknown");
  });

  it("식탁이 없으면 모름", () => {
    expect(tableInView(eye(0), []).table).toBe("unknown");
  });

  it("카메라 앞 30° 안이면 예, 등 돌리면 아니오", () => {
    // 2m 앞, 0.75m 아래 → 내려다보는 각 약 20.6°
    expect(tableInView(eye(0, -20), [table])).toMatchObject({ table: "yes", id: "dining_table_1" });
    expect(tableInView(eye(180, -20), [table]).table).toBe("no");
  });

  it("가장자리(반지름)가 시야에 걸치면 예: 중심이 40° 옆이어도 가까우면 보인다", () => {
    const near: Surface = { ...table, center: [4, 0.8], radius: 0.8 };
    // 중심까지 각 약 34.5°(30° 밖), 반지름 각 약 28° → 가장자리가 걸친다
    expect(tableInView(eye(0, -25), [near]).table).toBe("yes");
  });

  it("6m보다 멀면 아니오", () => {
    expect(tableInView(eye(0, -5, [-3, 0]), [table]).table).toBe("no");
  });
});

describe("surfacesFrom", () => {
  it("type에 table·desk가 있는 물건만, 윗면 높이·반지름을 만든다", () => {
    const s = surfacesFrom([
      { id: "dining_table_1", name: "식탁", type: "dining_table", plan: [9.9, 3.9], base: 0, height: 0.75, footprint: [1.2, 0.8] },
      { id: "desk_small_1", name: "책상", type: "desk_small", plan: [6, 11], base: 0, height: 0.72, footprint: [1, 0.5] },
      { id: "sofa_1", name: "소파", type: "sofa", plan: [7, 9], base: 0, height: 0.8, footprint: [2, 0.9] },
    ]);
    expect(s.map((x) => x.id)).toEqual(["dining_table_1", "desk_small_1"]);
    expect(s[0]).toMatchObject({ center: [9.9, 3.9], top: 0.75 });
    expect(s[0]!.radius).toBeCloseTo(Math.hypot(1.2, 0.8) / 2, 6);
  });
});
