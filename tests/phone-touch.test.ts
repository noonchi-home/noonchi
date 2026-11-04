// 벽 두 지점(A·B)에 폰을 대서 맞추기: 기준점 저장소(src/phone/touch.ts)와 세션의 벽 대기 모드.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AnchorTarget } from "../src/phone/anchors.js";
import { PhoneSession } from "../src/phone/session.js";
import {
  TouchPointsError, TouchStore, eyeHeightOf, floorLookup, homeBounds, parseTouchPoints, readTouchPoints, touchPointsPath, touchTargets,
} from "../src/phone/touch.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "touch-"));
  dirs.push(dir);
  return dir;
};

const ROOMS = [
  { id: "living", polygon: [[0, 0], [6, 0], [6, 4], [0, 4]] },
  { id: "bed", polygon: [[6, 0], [9, 0], [9, 4], [6, 4]] },
];
const BOUNDS = homeBounds(ROOMS);
const BODY = { points: [{ label: "거실 창틀", position: [0.1, 2] }, { label: "반대편 벽", position: [5.9, 2] }] };

describe("parseTouchPoints", () => {
  it("두 점을 A·B로 읽고 이름 앞뒤 빈칸을 지운다", () => {
    expect(parseTouchPoints({ points: [{ label: "  거실 창틀 ", position: [0.1, 2] }, BODY.points[1]] }, BOUNDS)).toEqual([
      { id: "A", label: "거실 창틀", position: [0.1, 2] },
      { id: "B", label: "반대편 벽", position: [5.9, 2] },
    ]);
  });

  it("이름이 비면 'A 지점'·'B 지점'", () => {
    const points = parseTouchPoints({ points: [{ label: "", position: [0.1, 2] }, { position: [5.9, 2] }] }, BOUNDS);
    expect(points.map((p) => p.label)).toEqual(["A 지점", "B 지점"]);
  });

  it.each([
    [{ points: [BODY.points[0]] }, "두 곳"],
    [{ points: [BODY.points[0], { label: "b", position: [0.3, 2] }] }, "0.5m"],
    [{ points: [BODY.points[0], { label: "b", position: [20, 2] }] }, "집 범위"],
    [{ points: [BODY.points[0], { label: "b", position: [Number.NaN, 2] }] }, "위치"],
    [{ points: [BODY.points[0], { label: "가".repeat(41), position: [5.9, 2] }] }, "이름"],
    [null, "두 곳"],
  ])("잘못된 값은 TouchPointsError(%#)", (raw, message) => {
    expect(() => parseTouchPoints(raw, BOUNDS)).toThrow(TouchPointsError);
    expect(() => parseTouchPoints(raw, BOUNDS)).toThrow(message);
  });

  it("집 범위는 방 다각형 경계 상자 + 0.3m", () => {
    expect(BOUNDS).toEqual({ minX: -0.3, minY: -0.3, maxX: 9.3, maxY: 4.3 });
    expect(homeBounds([])).toBeNull();
    expect(() => parseTouchPoints({ points: [BODY.points[0], { position: [9.25, 2] }] }, BOUNDS)).not.toThrow();
  });
});

describe("TouchStore", () => {
  it("저장하면 파일에 쓰고 바뀐 점을 알린다. 지우면 파일을 지우고 null을 알린다", () => {
    const path = touchPointsPath(tempDir(), "mokryeon_180b");
    expect(path.replaceAll("\\", "/")).toMatch(/homes\/mokryeon_180b\/phone-touch\.json$/);
    const seen: unknown[] = [];
    const store = new TouchStore(path, BOUNDS, (p) => seen.push(p));
    expect(store.get()).toBeNull();
    const saved = store.save(BODY);
    expect(store.get()).toEqual(saved);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ version: 1, points: saved });
    expect(readTouchPoints(path)).toEqual(saved);
    store.clear();
    expect(existsSync(path)).toBe(false);
    expect(store.get()).toBeNull();
    expect(seen).toEqual([saved, null]);
  });

  it("잘못된 값은 저장하지 않는다", () => {
    const path = touchPointsPath(tempDir(), "h");
    const store = new TouchStore(path, BOUNDS, () => {});
    expect(() => store.save({ points: [] })).toThrow(TouchPointsError);
    expect(existsSync(path)).toBe(false);
  });

  it("깨진 파일은 TouchPointsError로 알린다(시작할 때 바닥 조준으로 대신한다)", () => {
    const path = join(tempDir(), "phone-touch.json");
    writeFileSync(path, "{ 깨짐");
    expect(() => readTouchPoints(path)).toThrow(TouchPointsError);
    expect(readTouchPoints(join(tempDir(), "없음.json"))).toBeNull();
  });
});

describe("touchTargets·eyeHeightOf", () => {
  it("A·B 기준점 대상으로 바꾼다", () => {
    expect(touchTargets(parseTouchPoints(BODY, BOUNDS))).toEqual([
      { id: "A", label: "거실 창틀", plan: [0.1, 2] },
      { id: "B", label: "반대편 벽", plan: [5.9, 2] },
    ]);
  });

  it("PHONE_EYE_HEIGHT_M: 없거나 이상하면 1.5", () => {
    expect(eyeHeightOf(undefined)).toBe(1.5);
    expect(eyeHeightOf("1.6")).toBe(1.6);
    expect(eyeHeightOf("abc")).toBe(1.5);
    expect(eyeHeightOf("0")).toBe(1.5);
    expect(eyeHeightOf("4")).toBe(1.5);
  });
});

describe("PhoneSession 벽 대기 모드", () => {
  const FLOOR: AnchorTarget[] = [
    { id: "corner_a", label: "모서리 A", plan: [0.1, 0.1] },
    { id: "corner_b", label: "모서리 B", plan: [5.9, 3.9] },
  ];
  const TOUCH = touchTargets(parseTouchPoints(BODY, BOUNDS));
  const now = () => new Date("2026-11-04T10:00:00Z");

  it("상태에 모드가 있다(기본 바닥 조준)", () => {
    expect(new PhoneSession(FLOOR).status().mode).toBe("floor");
    expect(new PhoneSession(TOUCH, { mode: "touch" }).status().mode).toBe("touch");
  });

  it("폰 위치 두 곳으로 맞추고, 눈 높이는 기록 높이와 상관없이 고정이다", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch", eyeHeightM: 1.5, now });
    // AR 공간이 트윈과 같은 방향, 원점만 (1, ?, 1) 떨어진 경우. 두 번 다른 높이로 댔다
    s.handle({ type: "anchor", id: "A", point: [-0.9, 0.9, 1] });
    const r = s.handle({ type: "anchor", id: "B", point: [4.9, 1.1, 1] });
    expect(r.reply).toMatchObject({ aligned: true, mismatch_m: 0, mode: "touch" });
    const eye = s.eyeFor([2, 0.4, 2], [0, 0, 0, 1], "ok")!;
    expect(eye.position).toEqual([3, 3]);
    expect(eye.height_m).toBe(1.5);
    expect(s.eyeFor([2, 1.8, 2], [0, 0, 0, 1], "ok")!.height_m).toBe(1.5);
  });

  it("바닥 높이는 기록 순간 조준점이 닿은 바닥 높이 평균이다", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch", eyeHeightM: 1.5, now });
    s.handle({ type: "anchor", id: "A", point: [-0.9, 0.9, 1], floor: [-0.5, -0.32, 1] });
    s.handle({ type: "anchor", id: "B", point: [4.9, 1.1, 1], floor: [4.5, -0.28, 1] });
    expect(s.toAr([3, 0, 3])).toEqual([2, -0.3, 2]);
  });

  it("눈 높이에 그 자리 방의 바닥 높이를 더한다", () => {
    const floorAt = floorLookup([{ polygon: [[0, 0], [2, 0], [2, 4], [0, 4]], floor_z: -0.1 }, { polygon: [[2, 0], [6, 0], [6, 4], [2, 4]], floor_z: 0 }]);
    expect(floorAt([1, 1])).toBe(-0.1);
    expect(floorAt([9, 9])).toBe(0);
    const s = new PhoneSession(TOUCH, { mode: "touch", eyeHeightM: 1.5, floorAt, now });
    s.handle({ type: "anchor", id: "A", point: [-0.9, 1, 1] });
    s.handle({ type: "anchor", id: "B", point: [4.9, 1, 1] });
    expect(s.eyeFor([0, 1, 0.5], [0, 0, 0, 1], "ok")!).toMatchObject({ position: [1, 1.5], height_m: 1.4 });
    expect(s.eyeFor([3, 1, 0.5], [0, 0, 0, 1], "ok")!.height_m).toBe(1.5);
  });

  it("바닥 조준점이 없으면 바닥 높이 = 두 기록 높이 평균 − 눈 높이(어림)", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch", eyeHeightM: 1.5, now });
    s.handle({ type: "anchor", id: "A", point: [-0.9, 0.9, 1] });
    s.handle({ type: "anchor", id: "B", point: [4.9, 1.1, 1] });
    // 트윈 바닥(높이 0)은 AR y = 1.0 − 1.5 = −0.5
    expect(s.toAr([3, 0, 3])).toEqual([2, -0.5, 2]);
  });

  it("거리 차이가 허용보다 크면 맞추지 않는다", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch", maxMismatchM: 0.3 });
    s.handle({ type: "anchor", id: "A", point: [0, 1, 0] });
    const r = s.handle({ type: "anchor", id: "B", point: [5, 1, 0] });
    expect(r.reply).toMatchObject({ aligned: false });
    expect(r.reply!.error).toContain("80cm");
  });

  it("setTargets: 기준점과 모드를 바꾸고 기록·맞춤을 지운다", () => {
    const s = new PhoneSession(FLOOR, { now });
    s.handle({ type: "anchor", id: "corner_a", point: [0.1, 0, 0.1] });
    s.handle({ type: "anchor", id: "corner_b", point: [5.9, 0, 3.9] });
    expect(s.aligned).toBe(true);
    s.setTargets(TOUCH, "touch");
    expect(s.aligned).toBe(false);
    expect(s.status()).toMatchObject({
      mode: "touch", aligned: false,
      anchors: [{ id: "A", label: "거실 창틀", recorded: false }, { id: "B", label: "반대편 벽", recorded: false }],
    });
    expect(s.handle({ type: "anchor", id: "corner_a", point: [0, 0, 0] }).reply!.error).toContain("모르는 기준점");
    s.setTargets(FLOOR, "floor");
    expect(s.status().mode).toBe("floor");
    expect(() => s.setTargets([TOUCH[0]!], "touch")).toThrow("두 곳");
  });
});

describe("리뷰 반영: 원점 바뀜·기준점 바뀜·바닥 단차·바닥 아닌 면", () => {
  const TOUCH = touchTargets(parseTouchPoints(BODY, BOUNDS));
  const FLOOR: AnchorTarget[] = [
    { id: "corner_a", label: "모서리 A", plan: [0.1, 0.1] },
    { id: "corner_b", label: "모서리 B", plan: [5.9, 3.9] },
  ];
  // A·corner_a는 바닥 −0.1m 방, B·corner_b는 바닥 0 방
  const floorAt = floorLookup([{ polygon: [[0, 0], [2, 0], [2, 4], [0, 4]], floor_z: -0.1 }, { polygon: [[2, 0], [6, 0], [6, 4], [2, 4]], floor_z: 0 }]);
  const pose = (epoch: string) => ({ type: "pose", position: [2, 1, 2], orientation: [0, 0, 0, 1], tracking: "ok", epoch });

  it("AR 원점(epoch)이 바뀐 자세가 오면 reset을 못 받았어도 기록·맞춤을 버리고 상태를 알린다", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch" });
    s.handle({ type: "anchor", id: "A", point: [-0.9, 1, 1], epoch: "e1" });
    s.handle({ type: "anchor", id: "B", point: [4.9, 1, 1], epoch: "e1" });
    expect(s.aligned).toBe(true);
    expect(s.handle(pose("e1")).eye?.estimated).toBeUndefined();
    const out = s.handle(pose("e2"));
    expect(s.aligned).toBe(false);
    expect(out.reply).toMatchObject({ aligned: false, anchors: [{ recorded: false }, { recorded: false }] });
    expect(out.reply!.error).toContain("다시 기록");
  });

  it("다른 원점에서 찍은 두 기록으로는 맞추지 않는다", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch" });
    s.handle({ type: "anchor", id: "A", point: [-0.9, 1, 1], epoch: "e1" });
    const r = s.handle({ type: "anchor", id: "B", point: [4.9, 1, 1], epoch: "e2" });
    expect(r.reply).toMatchObject({ aligned: false, anchors: [{ recorded: false }, { recorded: true }] });
  });

  it("기준점이 바뀌면 revision이 오르고, 이전 revision으로 시작한 기록은 받지 않는다", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch" });
    const rev = s.status().revision;
    s.setTargets(TOUCH, "touch");
    expect(s.status().revision).toBe(rev + 1);
    const stale = s.handle({ type: "anchor", id: "A", point: [-0.9, 1, 1], revision: rev });
    expect(stale.reply!.error).toContain("기준점이 바뀌었");
    expect(stale.reply!.anchors[0]!.recorded).toBe(false);
    expect(s.handle({ type: "anchor", id: "A", point: [-0.9, 1, 1], revision: rev + 1 }).reply!.anchors[0]!.recorded).toBe(true);
  });

  it("벽 대기: 바닥 높이에서 기준점 방의 floor_z를 뺀다(트윈 높이 0의 AR y)", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch", eyeHeightM: 1.5, floorAt });
    s.handle({ type: "anchor", id: "A", point: [-0.9, 1, 1], floor: [-0.9, -0.4, 1] });
    s.handle({ type: "anchor", id: "B", point: [4.9, 1, 1], floor: [4.9, -0.3, 1] });
    expect(s.toAr([3, 0, 3])).toEqual([2, -0.3, 2]);
  });

  it("벽 대기: 바닥 조준점이 없으면 점마다 (기록 높이 − 눈 높이 − floor_z) 평균", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch", eyeHeightM: 1.5, floorAt });
    s.handle({ type: "anchor", id: "A", point: [-0.9, 1, 1] });
    s.handle({ type: "anchor", id: "B", point: [4.9, 1, 1] });
    expect(s.toAr([3, 0, 3])).toEqual([2, -0.45, 2]);
  });

  it("벽 아래 바닥 조준: 기록 점이 바닥 자체면(point = floor) 그 높이가 바닥이다", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch", eyeHeightM: 1.5, floorAt });
    s.handle({ type: "anchor", id: "A", point: [-0.9, -0.4, 1], floor: [-0.9, -0.4, 1] });
    const r = s.handle({ type: "anchor", id: "B", point: [4.9, -0.3, 1], floor: [4.9, -0.3, 1] });
    expect(r.reply).toMatchObject({ aligned: true, mismatch_m: 0 });
    expect(s.toAr([3, 0, 3])).toEqual([2, -0.3, 2]);
    expect(s.eyeFor([2, 1.2, 2], [0, 0, 0, 1], "ok")!).toMatchObject({ position: [3, 3], height_m: 1.5 });
  });

  it("벽 대기: 폰보다 0.9m 안쪽 아래의 면(탁자 등)은 바닥으로 쓰지 않는다", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch", eyeHeightM: 1.5 });
    s.handle({ type: "anchor", id: "A", point: [-0.9, 1, 1], floor: [-0.9, 0.6, 1] });
    s.handle({ type: "anchor", id: "B", point: [4.9, 1, 1], floor: [4.9, 0.6, 1] });
    expect(s.toAr([3, 0, 3])).toEqual([2, -0.5, 2]);
  });

  it("바닥 조준: 바닥 높이에서 기준점 방의 floor_z를 빼, 눈 높이가 트윈 높이가 된다", () => {
    const s = new PhoneSession(FLOOR, { floorAt });
    s.handle({ type: "anchor", id: "corner_a", point: [0.1, -0.1, 0.1] });
    s.handle({ type: "anchor", id: "corner_b", point: [5.9, 0, 3.9] });
    expect(s.eyeFor([3, 1.5, 2], [0, 0, 0, 1], "ok")!.height_m).toBe(1.5);
  });
});

describe("리뷰 반영 2: 버린 원점의 늦은 메시지·사진", () => {
  const TOUCH = touchTargets(parseTouchPoints(BODY, BOUNDS));
  const pose = (epoch: string) => ({ type: "pose", position: [2, 1, 2], orientation: [0, 0, 0, 1], tracking: "ok", epoch });
  const alignIn = (s: PhoneSession, epoch: string) => {
    s.handle({ type: "anchor", id: "A", point: [-0.9, 1, 1], epoch });
    s.handle({ type: "anchor", id: "B", point: [4.9, 1, 1], epoch });
  };

  it("이미 버린 원점의 늦은 자세는 무시하고 지금 맞춤을 지킨다", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch" });
    alignIn(s, "e1");
    s.handle(pose("e2"));
    alignIn(s, "e2");
    expect(s.aligned).toBe(true);
    expect(s.handle(pose("e1"))).toEqual({});
    expect(s.aligned).toBe(true);
    expect(s.handle(pose("e2")).eye).toBeDefined();
  });

  it("버린 원점의 늦은 기록은 받지 않는다", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch" });
    s.handle({ type: "anchor", id: "A", point: [-0.9, 1, 1], epoch: "e1" });
    s.handle(pose("e2"));
    const r = s.handle({ type: "anchor", id: "B", point: [4.9, 1, 1], epoch: "e1" });
    expect(r.reply!.error).toContain("이전 AR");
    expect(r.reply!.anchors.every((a) => !a.recorded)).toBe(true);
  });

  it("같은 원점의 reset(메뉴 '다시 맞추기')은 기록만 지우고, 그 원점의 새 기록·자세를 받는다", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch" });
    alignIn(s, "e1");
    s.handle({ type: "reset", epoch: "e1" });
    expect(s.aligned).toBe(false);
    alignIn(s, "e1");
    expect(s.aligned).toBe(true);
    expect(s.handle(pose("e1")).eye?.estimated).toBeUndefined();
  });

  it("새 원점을 담은 reset(AR 다시 시작)은 이전 원점을 버린다", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch" });
    s.handle({ type: "anchor", id: "A", point: [-0.9, 1, 1], epoch: "e1" });
    s.handle({ type: "reset", epoch: "e2" });
    expect(s.handle({ type: "anchor", id: "A", point: [-0.9, 1, 1], epoch: "e1" }).reply!.error).toContain("이전 AR");
  });

  it("버린 원점의 늦은 reset은 지금 맞춤을 지우지 않는다", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch" });
    s.handle({ type: "reset", epoch: "e1" });
    alignIn(s, "e2");
    s.handle({ type: "reset", epoch: "e1" });
    expect(s.aligned).toBe(true);
  });

  it("사진: 찍은 원점이 지금 맞춤과 다르면 위치를 붙이지 않는다(원점을 안 보내면 예전처럼)", () => {
    const s = new PhoneSession(TOUCH, { mode: "touch" });
    alignIn(s, "e2");
    expect(s.eyeAt([2, 1, 2], [0, 0, 0, 1], "ok", "e1")).toBeNull();
    expect(s.eyeAt([2, 1, 2], [0, 0, 0, 1], "ok", "e2")).not.toBeNull();
    expect(s.eyeAt([2, 1, 2], [0, 0, 0, 1], "ok", undefined)).not.toBeNull();
  });
});
