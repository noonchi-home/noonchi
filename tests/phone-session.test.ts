// 폰 세션(src/phone/session.ts): 위치 맞춤 모듈로 맞춘 뒤에만 진짜 눈 자세·사진 위치·카메라·「여기」·트윈 → AR을 준다.
// AR 원점(epoch)이 바뀌면 맞춤을 버리고, 버린 원점의 늦은 메시지는 받지 않는다. 맞추기 전에는 창가 추정 눈.
import { describe, expect, it } from "vitest";
import { PhoneSession, estimateViewpoint } from "../src/phone/session.js";
import type { Rigid } from "../src/sync/rigid.js";
import { BOX_START, BOX_WALLS, alignMessages } from "./helpers/align.js";

const sync = { landmarks: [], walls: BOX_WALLS, start: BOX_START };
const session = (opts: { now?: () => Date; fallback?: { position: [number, number]; yawDeg: number; heightM: number } } = {}) => new PhoneSession({ ...opts, sync });
/** 시작 위치 + 벽 점으로 맞춘다. */
function align(s: PhoneSession, o: { epoch?: string; truth?: Rigid; floorY?: number } = {}) {
  for (const m of alignMessages(BOX_WALLS, BOX_START, o)) s.handle(m);
  return s;
}

describe("PhoneSession", () => {
  it("맞추기 전 자세는 진짜 눈으로 내보내지 않는다. 맞춘 뒤에는 자세를 눈 자세로 바꾼다", () => {
    const s = session({ now: () => new Date("2026-10-24T10:00:00Z") });
    expect(s.handle({ type: "pose", position: [3.9, 1.4, 5], orientation: [0, 0, 0, 1] })).toEqual({});
    expect(s.status()).toMatchObject({ aligned: false, sync: { state: "none" } });
    align(s);
    expect(s.status()).toMatchObject({ aligned: true, sync: { state: "aligned", source: "walls", started: true } });
    const eye = s.handle({ type: "pose", position: [3.9, 1.4, 4], orientation: [0, 0, 0, 1] }).eye!;
    expect(eye.position).toEqual([3.9, 4]);
    expect(eye.height_m).toBeCloseTo(1.4, 2);
    expect(eye).not.toHaveProperty("estimated");
  });

  it("잘못된 메시지는 이유를 돌려준다. 예전 기준점 기록(anchor)은 모르는 메시지다", () => {
    const s = session();
    expect(s.handle({ type: "nope" }).reply!.error).toBe("알 수 없는 메시지입니다");
    expect(s.handle({ type: "anchor", id: "A", point: [0, 0, 0] }).reply!.error).toBe("알 수 없는 메시지입니다");
  });

  it("reset은 맞춤을 지운다", () => {
    const s = align(session());
    s.handle({ type: "reset" });
    expect(s.aligned).toBe(false);
    expect(s.status().sync.state).toBe("none");
  });
});

describe("AR 원점(epoch)", () => {
  const pose = (epoch: string) => ({ type: "pose", position: [2, 1.4, 2], orientation: [0, 0, 0, 1], tracking: "ok", epoch });

  it("새 원점의 자세가 오면 reset을 못 받았어도 맞춤을 버리고 상태로 알린다", () => {
    const s = align(session(), { epoch: "e1" });
    const r = s.handle(pose("e2"));
    expect(r.reply).toMatchObject({ aligned: false, error: expect.stringContaining("AR 원점이 바뀌어") });
  });

  it("이미 버린 원점의 늦은 자세·시작·면 점은 무시하고 지금 맞춤을 지킨다", () => {
    const s = session();
    align(s, { epoch: "e1" });
    s.handle(pose("e2"));
    align(s, { epoch: "e2" });
    expect(s.aligned).toBe(true);
    expect(s.handle(pose("e1"))).toEqual({});
    expect(s.handle({ type: "start", position: [0, 1.4, 0], orientation: [0, 0, 0, 1], epoch: "e1" }).reply!.error).toContain("이전 AR");
    expect(s.aligned).toBe(true);
    expect(s.handle(pose("e2")).eye).toBeDefined();
  });

  it("같은 원점의 reset은 맞춤만 지우고, 그 원점으로 다시 맞출 수 있다", () => {
    const s = align(session(), { epoch: "e1" });
    s.handle({ type: "reset", epoch: "e1" });
    expect(s.aligned).toBe(false);
    align(s, { epoch: "e1" });
    expect(s.handle(pose("e1")).eye?.estimated).toBeUndefined();
  });

  it("버린 원점의 늦은 reset은 지금 맞춤을 지우지 않는다", () => {
    const s = session();
    s.handle({ type: "reset", epoch: "e1" });
    align(s, { epoch: "e2" });
    s.handle({ type: "reset", epoch: "e1" });
    expect(s.aligned).toBe(true);
  });

  it("사진: 찍은 원점이 지금 맞춤과 다르면 위치를 붙이지 않는다(원점을 안 보내면 그대로)", () => {
    const s = align(session(), { epoch: "e2" });
    expect(s.eyeAt([2, 1.4, 2], [0, 0, 0, 1], "ok", "e1")).toBeNull();
    expect(s.eyeAt([2, 1.4, 2], [0, 0, 0, 1], "ok", "e2")).not.toBeNull();
    expect(s.eyeAt([2, 1.4, 2], [0, 0, 0, 1], "ok", undefined)).not.toBeNull();
  });
});

describe("여기(조준점)와 트윈 → AR", () => {
  it("맞춘 뒤 조준점이 바닥에 닿은 자세면 평면도 점과 폰 위치를 준다", () => {
    let t = Date.parse("2026-10-24T10:00:00Z");
    const s = session({ now: () => new Date(t) });
    expect(s.here()).toEqual({ error: expect.stringMatching(/맞추기 전/) });
    align(s);
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

  it("시작 위치만이면(어림) 「맞추는 중」", () => {
    const s = session();
    s.handle(alignMessages(BOX_WALLS, BOX_START)[0]!);
    expect(s.here()).toEqual({ error: expect.stringMatching(/맞추는 중/) });
  });

  it("toAr는 트윈 점(x, 높이, y)을 AR 공간으로 되돌린다(돌아간 AR 공간)", () => {
    const s = session();
    expect(s.toAr([1, 0.5, 2])).toBeNull();
    // 정답: plan = R(90°)·ar + (0, 0), AR 바닥 높이 0.1
    align(s, { truth: { theta: Math.PI / 2, tx: 0, ty: 0 }, floorY: 0.1 });
    const ar = s.toAr([1, 0.5, 2])!;
    [2, 0.6, -1].forEach((v, i) => expect(ar[i]).toBeCloseTo(v, 2));
    s.handle({ type: "pose", position: [0, 1.5, 0], orientation: [0, 0, 0, 1], hit: ar });
    const here = s.here() as { position: [number, number] };
    here.position.forEach((v, i) => expect(v).toBeCloseTo([1, 2][i]!, 2));
  });
});

describe("엔진 프레임 카메라(viewAt)", () => {
  const P = Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0));
  it("맞춘 뒤에만 트윈 원점 [x, 높이, y]·AR 회전·맞춤 회전·투영을 준다", () => {
    const s = session();
    expect(s.viewAt([3.9, 1.4, 4], [0, 0, 0, 1], P, undefined)).toBeNull();
    align(s);
    const v = s.viewAt([3.9, 1.4, 4], [0, 0, 0, 1], P, undefined)!;
    expect(v).toMatchObject({ orientation: [0, 0, 0, 1], projection: P });
    v.origin.forEach((x, i) => expect(x).toBeCloseTo([3.9, 1.4, 4][i]!, 2));
    expect(v.theta).toBeCloseTo(0, 3);
  });
  it("투영이 없거나 16개가 아니거나 다른 AR 원점이면 null", () => {
    const s = align(session());
    expect(s.viewAt([3.9, 1.4, 4], [0, 0, 0, 1], undefined, undefined)).toBeNull();
    expect(s.viewAt([3.9, 1.4, 4], [0, 0, 0, 1], [1, 2], undefined)).toBeNull();
    s.handle({ type: "reset", epoch: "a" });
    expect(s.viewAt([3.9, 1.4, 4], [0, 0, 0, 1], P, "b")).toBeNull();
  });
});

describe("맞추기 전 추정 눈(창가 고정 위치 + 폰 방향)", () => {
  const FALLBACK = { position: [2, 0.8] as [number, number], yawDeg: 90, heightM: 1.3 };
  const s45 = Math.SQRT1_2;

  it("AR 시작 방향(-Z)을 창에서 방 안쪽으로 보고, 돌리면 yaw·기울이면 pitch가 바뀐다(위치는 고정)", () => {
    const s = session({ now: () => new Date("2026-10-24T10:00:00Z"), fallback: FALLBACK });
    expect(s.handle({ type: "pose", position: [0, 1.4, 0], orientation: [0, 0, 0, 1] })).toEqual({
      eye: { position: [2, 0.8], height_m: 1.3, yaw_deg: 90, pitch_deg: 0, tracking: "ok", at: "2026-10-24T10:00:00.000Z", estimated: true },
    });
    const left = s.handle({ type: "pose", position: [3, 1.2, -2], orientation: [0, s45, 0, s45] }).eye!;
    expect(left).toMatchObject({ position: [2, 0.8], height_m: 1.3, yaw_deg: 0, estimated: true });
    const sin15 = Math.sin(-Math.PI / 12);
    const down = s.handle({ type: "pose", position: [0, 1.4, 0], orientation: [sin15, 0, 0, Math.cos(-Math.PI / 12)] }).eye!;
    expect(down.pitch_deg).toBeCloseTo(-30, 1);
    expect(down.yaw_deg).toBeCloseTo(90, 1);
  });

  it("사진(eyeFor)에는 추정 눈을 쓰지 않고, 맞춘 뒤에는 진짜 자세(estimated 없음)", () => {
    const s = session({ fallback: FALLBACK });
    expect(s.eyeFor([0, 1.4, 0], [0, 0, 0, 1], "ok")).toBeNull();
    align(s);
    const eye = s.handle({ type: "pose", position: [3.9, 1.4, 4], orientation: [0, 0, 0, 1] }).eye!;
    expect(eye.position).toEqual([3.9, 4]);
    expect(eye).not.toHaveProperty("estimated");
  });

  it("추정 기준이 없으면 맞추기 전에는 아무것도 보내지 않는다", () => {
    expect(session().handle({ type: "pose", position: [0, 1.4, 0], orientation: [0, 0, 0, 1] })).toEqual({});
  });
});

describe("estimateViewpoint: 가장 넓은 방의 창에서 방 안쪽으로 0.8m", () => {
  const rooms = [
    { id: "room", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
    { id: "bath", polygon: [[0, 4], [1.7, 4], [1.7, 6.6], [0, 6.6]] },
  ];
  it("창이 있으면 창 → 방 무게중심 방향", () => {
    const v = estimateViewpoint({ plan: { rooms, windows: [{ id: "w_bath", position: [0, 5], width: 0.9, room: "bath" }, { id: "win_room", position: [2, 0], width: 1.65, room: "room" }] } });
    expect(v.position[0]).toBeCloseTo(2);
    expect(v.position[1]).toBeCloseTo(0.8);
    expect(v.yawDeg).toBeCloseTo(90);
    expect(v.heightM).toBe(1.3);
  });
  it("창이 없으면 가장 넓은 방 무게중심, yaw 90", () => {
    const v = estimateViewpoint({ plan: { rooms, windows: [] } });
    expect(v).toEqual({ position: [2, 2], yawDeg: 90, heightM: 1.3 });
  });
});
