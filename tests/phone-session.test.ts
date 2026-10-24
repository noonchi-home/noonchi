import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAnchorTargets, type AnchorTarget } from "../src/phone/anchors.js";
import { PhoneSession } from "../src/phone/session.js";

const TARGETS: AnchorTarget[] = [
  { id: "dock", label: "도크", plan: [3.9, 5.51] },
  { id: "door_main", label: "현관문 문턱 가운데", plan: [2.4, 3.55] },
];
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function sceneFile(objects: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "phone-"));
  dirs.push(dir);
  const file = join(dir, "scene.json");
  writeFileSync(file, JSON.stringify({ objects }));
  return file;
}

const aligned = () => {
  const s = new PhoneSession(TARGETS, { now: () => new Date("2026-10-24T10:00:00Z") });
  s.handle({ type: "anchor", id: "dock", point: [3.9, 0, 5.51] });
  s.handle({ type: "anchor", id: "door_main", point: [2.4, 0, 3.55] });
  return s;
};

describe("loadAnchorTargets", () => {
  it("scene.json 객체의 평면 위치를 읽는다", () => {
    const file = sceneFile([{ id: "dock", plan: { position: [3.9, 5.51] } }, { id: "door_main", plan: { position: [2.4, 3.55] } }]);
    expect(loadAnchorTargets(file)).toEqual([
      { id: "dock", label: "도크", plan: [3.9, 5.51] },
      { id: "door_main", label: "현관문 문턱 가운데", plan: [2.4, 3.55] },
    ]);
  });

  it("기준점 객체가 없으면 알린다", () => {
    expect(() => loadAnchorTargets(sceneFile([{ id: "dock", plan: { position: [3.9, 5.51] } }]))).toThrow("door_main");
  });

  const CORNERS = [
    { id: "corner_nw", label: "방 왼쪽 위 모서리", position: [0.1, 0.1] },
    { id: "corner_se", label: "방 오른쪽 아래 모서리", position: [3.9, 3.94] },
  ];
  const writeJson = (name: string, data: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), "phone-"));
    dirs.push(dir);
    const file = join(dir, name);
    writeFileSync(file, JSON.stringify(data));
    return file;
  };
  const legacy = [{ id: "dock", plan: { position: [3.9, 5.51] } }, { id: "door_main", plan: { position: [2.4, 3.55] } }];

  it("scene.json plan.ar_anchors(방 모서리 두 곳)를 먼저 쓴다", () => {
    const scene = writeJson("scene.json", { plan: { ar_anchors: CORNERS }, objects: legacy });
    expect(loadAnchorTargets(scene)).toEqual([
      { id: "corner_nw", label: "방 왼쪽 위 모서리", plan: [0.1, 0.1] },
      { id: "corner_se", label: "방 오른쪽 아래 모서리", plan: [3.9, 3.94] },
    ]);
  });

  it("scene에 없으면 floorplan.json의 ar_anchors, 그것도 없으면 도크·현관문", () => {
    const scene = writeJson("scene.json", { plan: {}, objects: legacy });
    const floorplan = writeJson("floorplan.json", { ar_anchors: CORNERS });
    expect(loadAnchorTargets(scene, floorplan).map((t) => t.id)).toEqual(["corner_nw", "corner_se"]);
    expect(loadAnchorTargets(scene, writeJson("floorplan.json", {})).map((t) => t.id)).toEqual(["dock", "door_main"]);
    expect(loadAnchorTargets(scene, join(tmpdir(), "no-such-floorplan.json")).map((t) => t.id)).toEqual(["dock", "door_main"]);
  });

  it("ar_anchors가 두 곳이 아니거나 위치가 틀리면 알린다", () => {
    expect(() => loadAnchorTargets(writeJson("scene.json", { plan: { ar_anchors: [CORNERS[0]] }, objects: legacy }))).toThrow(/ar_anchors.*두 곳/);
    expect(() => loadAnchorTargets(writeJson("scene.json", { plan: { ar_anchors: [CORNERS[0], { id: "x", label: "x", position: ["a", 1] }] }, objects: legacy }))).toThrow(/ar_anchors.*x/);
  });
});

describe("PhoneSession", () => {
  it("맞추기 전 자세는 내보내지 않는다", () => {
    const s = new PhoneSession(TARGETS);
    expect(s.handle({ type: "pose", position: [0, 1, 0], orientation: [0, 0, 0, 1] })).toEqual({});
    expect(s.status()).toMatchObject({ aligned: false, mismatch_m: null });
  });

  it("기준점 두 곳 뒤에는 자세를 눈 자세로 바꾼다", () => {
    const s = aligned();
    expect(s.status()).toMatchObject({ aligned: true, mismatch_m: 0, anchors: [{ recorded: true }, { recorded: true }] });
    expect(s.handle({ type: "pose", position: [3.9, 1.4, 5], orientation: [0, 0, 0, 1], tracking: "limited" })).toEqual({
      eye: { position: [3.9, 5], height_m: 1.4, yaw_deg: 270, pitch_deg: 0, tracking: "limited", at: "2026-10-24T10:00:00.000Z" },
    });
  });

  it("잘못된 메시지·모르는 기준점·가까운 기준점은 이유를 돌려준다", () => {
    const s = new PhoneSession(TARGETS);
    expect(s.handle({ type: "pose", position: [0, 1] }).reply?.error).toBe("알 수 없는 메시지입니다");
    expect(s.handle({ type: "anchor", id: "sofa", point: [0, 0, 0] }).reply?.error).toContain("sofa");
    s.handle({ type: "anchor", id: "dock", point: [0, 0, 0] });
    const r = s.handle({ type: "anchor", id: "door_main", point: [0.1, 0, 0] });
    expect(r.reply).toMatchObject({ aligned: false });
    expect(r.reply?.error).toContain("가깝습니다");
  });

  // 트윈 거리 2.468m의 1.5배로 찍으면 실제 거리 3.702m, 차이 1.234m
  const FAR: [number, number, number] = [3.9 + (2.4 - 3.9) * 1.5, 0, 5.51 + (3.55 - 5.51) * 1.5];

  it("거리 차이가 허용값을 넘으면 맞추지 않고 다시 찍으라고 한다", () => {
    const s = new PhoneSession(TARGETS);
    s.handle({ type: "anchor", id: "dock", point: [3.9, 0, 5.51] });
    const r = s.handle({ type: "anchor", id: "door_main", point: FAR });
    expect(r.reply).toMatchObject({ aligned: false });
    expect(r.reply?.error).toContain("123cm");
    expect(s.handle({ type: "pose", position: [0, 1, 0], orientation: [0, 0, 0, 1] })).toEqual({});
  });

  it("허용값을 크게 주면 같은 기준점도 받아들인다", () => {
    const s = new PhoneSession(TARGETS, { maxMismatchM: 2 });
    s.handle({ type: "anchor", id: "dock", point: [3.9, 0, 5.51] });
    expect(s.handle({ type: "anchor", id: "door_main", point: FAR }).reply).toMatchObject({ aligned: true, mismatch_m: 1.23 });
  });

  it("eyeFor: 맞춘 뒤에만 눈 자세를 준다", () => {
    expect(new PhoneSession(TARGETS).eyeFor([0, 1, 0], [0, 0, 0, 1], "ok")).toBeNull();
    expect(aligned().eyeFor([3.9, 1.4, 5], [0, 0, 0, 1], "ok")).toMatchObject({ position: [3.9, 5], height_m: 1.4, tracking: "ok" });
  });

  it("reset은 기록을 지운다", () => {
    const s = aligned();
    expect(s.handle({ type: "reset" }).reply).toMatchObject({ aligned: false, anchors: [{ recorded: false }, { recorded: false }] });
  });
});

describe("여기(조준점)와 트윈 → AR", () => {
  it("맞춘 뒤 조준점이 바닥에 닿은 자세면 평면도 점과 폰 위치를 준다", () => {
    let t = Date.parse("2026-10-24T10:00:00Z");
    const s = new PhoneSession(TARGETS, { now: () => new Date(t) });
    expect(s.here()).toEqual({ error: expect.stringMatching(/맞추기 전/) });
    s.handle({ type: "anchor", id: "dock", point: [3.9, 0, 5.51] });
    s.handle({ type: "anchor", id: "door_main", point: [2.4, 0, 3.55] });
    expect(s.here()).toEqual({ error: expect.stringMatching(/폰 AR/) });
    s.handle({ type: "pose", position: [3, 1.4, 4], orientation: [0, 0, 0, 1], hit: [2, 0, 3] });
    expect(s.here()).toEqual({ position: [2, 3], from: [3, 4] });
    s.handle({ type: "pose", position: [3, 1.4, 4], orientation: [0, 0, 0, 1], hit: null });
    expect(s.here()).toEqual({ error: expect.stringMatching(/조준점/) });
    s.handle({ type: "pose", position: [3, 1.4, 4], orientation: [0, 0, 0, 1], hit: [2, 0, 3] });
    t += 16_000;
    expect(s.here()).toEqual({ error: expect.stringMatching(/15초/) });
    s.handle({ type: "reset" });
    expect(s.here()).toEqual({ error: expect.stringMatching(/맞추기 전/) });
  });

  it("toAr는 트윈 점(x, 높이, y)을 AR 공간으로 되돌린다(돌아간 AR 공간)", () => {
    const s = new PhoneSession(TARGETS);
    expect(s.toAr([1, 0.5, 2])).toBeNull();
    // plan = R(90°)·ar + t → ar = (plan.y, -plan.x), AR 바닥 높이 0.1
    s.handle({ type: "anchor", id: "dock", point: [5.51, 0.1, -3.9] });
    s.handle({ type: "anchor", id: "door_main", point: [3.55, 0.1, -2.4] });
    const ar = s.toAr([1, 0.5, 2])!;
    [2, 0.6, -1].forEach((v, i) => expect(ar[i]).toBeCloseTo(v, 6));
    s.handle({ type: "pose", position: [0, 1.4, 0], orientation: [0, 0, 0, 1], hit: ar });
    const here = s.here() as { position: [number, number] };
    here.position.forEach((v, i) => expect(v).toBeCloseTo([1, 2][i]!, 3));
  });
});
