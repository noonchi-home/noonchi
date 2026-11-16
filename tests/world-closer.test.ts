import { describe, expect, it } from "vitest";
import type { Detection } from "../src/contract/observe.js";
import type { SceneObservation, SceneState } from "../src/observe/scene.js";
import { decisionWorld } from "../src/world/decide.js";
import { CLOSER_HOLD_MS, WorldState, type CloserPass } from "../src/world/state.js";
import type { DetLabel } from "../src/world/vocab.js";
import { AWAY_VIEW, engineFrame, LOOK_SIZE, LOOK_VIEW } from "./helpers/camera.js";
import { det as mkDet } from "./helpers/detectors.js";

// 바닥만 있는 집. 잘라 본 상자 R = [120, 90, 240, 180](엔진 프레임 픽셀), 그 안 컵 [230, 170, 20, 10]은 바닥 (1.5, 0, 0)이다.
const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
const det = (label: DetLabel, box: [number, number, number, number], score = 0.8): Detection => mkDet(label, score, box, 0);
const cupIn = det("cup", [230, 170, 20, 10]);
const cupOut = det("cup", [60, 300, 40, 20]);
const person = det("person", [150, 20, 120, 330], 0.9);
const pass = (frameId: string, atMs: number, dets: (Detection & { edge?: boolean })[], view = LOOK_VIEW): CloserPass =>
  ({ frameId, capturedAtMs: atMs, view, ...LOOK_SIZE, dets: dets.map((d) => ({ ...d, edge: d.edge ?? false })) });
const full = (w: WorldState, id: string, atMs: number, dets: Detection[], view = LOOK_VIEW) => w.applyDetections(engineFrame(id, atMs, { view }), dets);
const obj = (w: WorldState, id: string, nowMs: number) => w.view(nowMs).objects.find((o) => o.id === id);

describe("가까이 보기 합치기(applyCloser)", () => {
  it("서로 다른 원본 프레임 세 장에서 같은 자리로 보인 컵만 VLM 답 없이 확인된 컵 하나로 만든다. 두 장이나 같은 프레임 세 번이면 만들지 않는다", () => {
    const w = ws();
    const two = w.applyCloser([pass("e1", 1000, [cupIn]), pass("e2", 2000, [cupIn])]);
    expect([two.changes, two.ids]).toEqual([[], new Map()]);
    w.endCloser(two.pending!);
    expect(w.applyCloser([pass("e2", 2000, [cupIn]), pass("e2", 2000, [cupIn]), pass("e2", 2000, [cupIn])]).changes).toEqual([]);
    expect(w.view(3000).objects).toEqual([]);
    const r = w.applyCloser([pass("e3", 3000, [cupIn]), pass("e1", 1000, [cupIn]), pass("e2", 2000, [cupIn])]);
    expect(r.changes).toEqual([expect.objectContaining({ kind: "appeared", subject: "cup_1", meaningful: true, at_ms: 3000 })]);
    expect(r.ids).toEqual(new Map([["d1", "cup_1"]]));   // 가장 새 원본 프레임(e3)의 감지 번호
    const cup = obj(w, "cup_1", 3000)!;
    expect(cup).toMatchObject({ status: "present", first_seen_ms: 1000, last_seen_ms: 3000, closer_hold: true });
    expect(cup.position![0]).toBeCloseTo(1.5, 2);
  });

  it("ids는 고른 원본 프레임(없으면 가장 새 프레임)의 감지 번호다. 물건 감지는 사람·가전 설비·받지 않는 감지·경계에 닿은 상자가 아닌 것이다", () => {
    const w = ws();
    const looks = [pass("e1", 1000, [cupIn]), pass("e2", 2000, [person, cupIn]), pass("e3", 3000, [cupIn]), pass("e4", 4000, [person])];
    expect(w.applyCloser(looks, "e2").ids).toEqual(new Map([["d2", "cup_1"]]));
    expect(ws().applyCloser(looks).ids).toEqual(new Map());   // 가장 새 프레임 e4에는 컵이 없다
    expect(w.closerObject({ ...cupIn, edge: false })).toBe(true);
    expect(w.closerObject({ ...cupIn, edge: true })).toBe(false);
    expect(w.closerObject({ ...person, edge: false })).toBe(false);
    expect(w.closerObject({ ...det("sink", [130, 100, 200, 150], 0.9), edge: false })).toBe(false);
    expect(w.closerObject({ ...det("cup", [230, 170, 20, 10], 0.3), edge: false })).toBe(false);
  });

  it("사람 감지와 잘라 본 경계에 닿은 상자는 쓰지 않는다: 사람 보임·수·자리는 그대로다", () => {
    const w = ws();
    for (let i = 1; i <= 2; i++) full(w, `e${i}`, i * 1000, [person]);
    const before = w.view(2000).person;
    expect(before).toMatchObject({ visible: true, count: 1 });
    const edgeCup = { ...cupIn, edge: true };
    const r = w.applyCloser([3, 4, 5].map((i) => pass(`e${i}`, i * 1000, [det("person", [200, 100, 60, 160], 0.9), det("person", [130, 100, 60, 160], 0.9), edgeCup])));
    expect(r).toEqual({ changes: [], ids: new Map() });
    expect(w.view(5000).objects).toEqual([]);
    expect(w.view(5000).person).toMatchObject({ visible: true, count: 1, position: before.position, last_seen_ms: 2000 });
  });

  it("맞는 물건은 그 물건의 마지막 촬영보다 새 촬영일 때만 자리·본 시각·상태를 고친다. 옛 촬영은 아무것도 바꾸지 않는다", () => {
    const w = ws();
    for (let i = 1; i <= 3; i++) full(w, `e${i}`, i * 1000, [cupIn]);
    for (let i = 4; i <= 5; i++) full(w, `e${i}`, i * 1000, [], AWAY_VIEW);
    expect(obj(w, "cup_1", 5000)).toMatchObject({ status: "out_of_view", last_seen_ms: 3000 });
    const old = w.applyCloser([pass("e1", 1000, [det("cup", [236, 170, 20, 10])])]);
    expect(old.changes).toEqual([]);
    expect(obj(w, "cup_1", 5000)).toMatchObject({ status: "out_of_view", last_seen_ms: 3000, closer_hold: false });
    const moved = det("cup", [236, 172, 20, 10]);
    const r = w.applyCloser([pass("e6", 6000, [moved])]);
    expect(r.changes).toEqual([expect.objectContaining({ kind: "back_in_view", subject: "cup_1" })]);
    expect(r.ids.get("d1")).toBe("cup_1");
    const cup = obj(w, "cup_1", 6000)!;
    expect(cup).toMatchObject({ status: "present", last_seen_ms: 6000, last_in_view_ms: 6000, closer_hold: true });
    expect(cup.position![2]).not.toBeCloseTo(0, 3);   // 새 촬영의 자리로 옮겼다
  });

  it("사라진 물건도 같은 자리에 새 촬영으로 보이면 다시 있음(등장)이 되고, 전체 사진이 다시 사라짐을 셀 수 있다", () => {
    const w = ws();
    for (let i = 1; i <= 3; i++) full(w, `e${i}`, i * 1000, [cupIn]);
    for (let i = 4; i <= 6; i++) full(w, `e${i}`, i * 1000, []);
    expect(obj(w, "cup_1", 6000)!.status).toBe("gone");
    const r = w.applyCloser([pass("e7", 7000, [cupIn])]);
    expect(r.changes).toEqual([expect.objectContaining({ kind: "appeared", subject: "cup_1" })]);
    expect(obj(w, "cup_1", 7000)!.status).toBe("present");
    full(w, "e8", 8000, [cupIn]);   // 다시 등장 셈을 하지 않는다
    expect(w.view(8000).objects.map((o) => o.id)).toEqual(["cup_1"]);
  });

  it("보이지 않은 물건과 세는 중인 물건은 그대로 둔다", () => {
    const w = ws();
    for (let i = 1; i <= 3; i++) full(w, `e${i}`, i * 1000, [cupIn]);
    for (let i = 4; i <= 5; i++) full(w, `e${i}`, i * 1000, [cupIn, cupOut]);   // 상자 밖 컵 cup_2를 두 장 셈
    expect(w.applyCloser([6, 7, 8].map((i) => pass(`e${i}`, i * 1000, [])))).toEqual({ changes: [], ids: new Map() });
    expect(obj(w, "cup_1", 8000)!.status).toBe("present");
    expect(full(w, "e9", 9000, [cupIn, cupOut]).changes).toEqual([expect.objectContaining({ kind: "appeared", subject: "cup_2" })]);
  });

  it("가까이 보기로 찾은 물건은 30초 동안 전체 사진이 그 자리를 보면서 못 봐도 사라짐으로 세지 않는다. 30초 뒤에는 센다", () => {
    const w = ws();
    w.applyCloser([1, 2, 3].map((i) => pass(`e${i}`, i * 1000, [cupIn])));
    for (let i = 4; i <= 6; i++) expect(full(w, `e${i}`, i * 2000, []).changes).toEqual([]);
    expect(obj(w, "cup_1", 12_000)).toMatchObject({ status: "present", closer_hold: true });
    const after = 3000 + CLOSER_HOLD_MS;
    expect(obj(w, "cup_1", after)!.closer_hold).toBe(false);
    full(w, "e7", after + 1000, []);
    full(w, "e8", after + 3000, []);
    expect(full(w, "e9", after + 5000, []).changes).toEqual([expect.objectContaining({ kind: "gone", subject: "cup_1" })]);
  });

  it("같은 종류 새 물건이 다른 자리에 생기면(옮김) 지킴을 바로 풀어 옛 물건은 사라짐을 센다", () => {
    const w = ws();
    w.applyCloser([1, 2, 3].map((i) => pass(`e${i}`, i * 1000, [cupIn])));
    full(w, "e4", 4000, [cupOut]);
    full(w, "e5", 5000, [cupOut]);
    expect(obj(w, "cup_1", 5000)!.closer_hold).toBe(true);
    expect(full(w, "e6", 6000, [cupOut]).changes).toEqual([expect.objectContaining({ kind: "appeared", subject: "cup_2" })]);
    expect(obj(w, "cup_1", 6000)).toMatchObject({ status: "present", closer_hold: false, followed_by: "cup_2" });
    expect(obj(w, "cup_2", 6000)!.followed_by).toBeNull();
    full(w, "e7", 7000, [cupOut]);
    full(w, "e8", 8000, [cupOut]);
    expect(full(w, "e9", 9000, [cupOut]).changes).toEqual([expect.objectContaining({ kind: "gone", subject: "cup_1" })]);
  });

  it("옮김 표시(followed_by)는 지킴 중이던 물건에만 붙고, 그 뒤 전체 사진이 옛 물건을 다시 보면 지운다. 같은 프레임에서 본 물건에는 붙지 않는다", () => {
    const w = ws();
    w.applyCloser([1, 2, 3].map((i) => pass(`e${i}`, i * 1000, [cupIn])));
    for (let i = 4; i <= 6; i++) full(w, `e${i}`, i * 1000, [cupOut]);
    expect(obj(w, "cup_1", 6000)!.followed_by).toBe("cup_2");
    full(w, "e5", 5000, [cupIn, cupOut]);   // 표시보다 옛 촬영은 지우지 않는다
    expect(obj(w, "cup_1", 6000)!.followed_by).toBe("cup_2");
    full(w, "e7", 7000, [cupIn, cupOut]);
    expect(obj(w, "cup_1", 7000)!.followed_by).toBeNull();
    // 지킴이 없던 물건, 같은 프레임에서 보인 물건에는 붙지 않는다
    const v = ws();
    for (let i = 1; i <= 3; i++) full(v, `e${i}`, i * 1000, [cupIn]);
    for (let i = 4; i <= 6; i++) full(v, `e${i}`, i * 1000, [cupIn, cupOut]);
    expect(v.view(6000).objects.map((o) => [o.id, o.followed_by])).toEqual([["cup_1", null], ["cup_2", null]]);
    const u = ws();
    u.applyCloser([1, 2, 3].map((i) => pass(`e${i}`, i * 1000, [cupIn])));
    for (let i = 4; i <= 6; i++) full(u, `e${i}`, i * 1000, [cupIn, cupOut]);
    expect(u.view(6000).objects.map((o) => [o.id, o.followed_by])).toEqual([["cup_1", null], ["cup_2", null]]);
  });

  it("전체 사진의 새 컵 등장으로 옮김 표시가 붙은 뒤 같은 원본 사진을 잘라 옛 컵을 찾으면 표시를 지운다(두 컵이 함께 있었다). 표시보다 옛 촬영을 잘라 찾으면 지우지 않는다", () => {
    const w = ws();
    w.applyCloser([1, 2, 3].map((i) => pass(`e${i}`, i * 1000, [cupIn])));
    for (let i = 4; i <= 6; i++) full(w, `e${i}`, i * 1000, [cupOut]);
    expect(obj(w, "cup_1", 6000)!.followed_by).toBe("cup_2");
    w.applyCloser([pass("e5", 5000, [cupIn])]);
    expect(obj(w, "cup_1", 6000)!.followed_by).toBe("cup_2");
    expect(w.applyCloser([pass("e6", 6000, [cupIn])]).ids.get("d1")).toBe("cup_1");
    expect(obj(w, "cup_1", 6000)).toMatchObject({ status: "present", followed_by: null });
  });

  it("옮김 표시가 붙고 더 새 전체 사진이 옛 컵 보임(시야 밖·사라짐)을 판단한 뒤에도, 같은 원본 사진을 잘라 옛 컵을 찾으면 표시를 지운다. 보임은 되살리지 않고, 표시보다 옛 촬영은 지우지 않는다", () => {
    const marked = () => {
      const w = ws();
      w.applyCloser([1, 2, 3].map((i) => pass(`e${i}`, i * 1000, [cupIn])));
      for (let i = 4; i <= 6; i++) full(w, `e${i}`, i * 1000, [cupOut]);
      expect(obj(w, "cup_1", 6000)!.followed_by).toBe("cup_2");
      return w;
    };
    const w = marked();
    full(w, "e7", 7000, [], AWAY_VIEW);
    expect(obj(w, "cup_1", 7000)).toMatchObject({ status: "out_of_view", followed_by: "cup_2" });
    w.applyCloser([pass("e5", 5000, [cupIn])]);
    expect(obj(w, "cup_1", 7000)!.followed_by).toBe("cup_2");
    expect(w.applyCloser([pass("e6", 6000, [cupIn])]).changes).toEqual([]);
    expect(obj(w, "cup_1", 7000)).toMatchObject({ status: "out_of_view", followed_by: null });
    const v = marked();
    for (let i = 7; i <= 9; i++) full(v, `e${i}`, i * 1000, [cupOut]);
    expect(obj(v, "cup_1", 9000)).toMatchObject({ status: "gone", followed_by: "cup_2" });
    expect(v.applyCloser([pass("e6", 6000, [cupIn])]).changes).toEqual([]);
    expect(obj(v, "cup_1", 9000)).toMatchObject({ status: "gone", followed_by: null });
  });

  it("지킴 중인 물건을 두고 한 촬영(전체 사진 한 장·가까이 보기 한 번)에 같은 종류 새 물건이 여럿 생기면 지킴만 풀고 어느 것에도 잇지 않는다(옮김 표시 없음)", () => {
    const cupFar = det("cup", [380, 300, 40, 20]);
    const w = ws();
    w.applyCloser([1, 2, 3].map((i) => pass(`e${i}`, i * 1000, [cupIn])));
    for (let i = 4; i <= 6; i++) full(w, `e${i}`, i * 1000, [cupOut, cupFar]);
    expect(w.view(6000).objects.map((o) => [o.id, o.status, o.closer_hold, o.followed_by])).toEqual([
      ["cup_1", "present", false, null], ["cup_2", "present", false, null], ["cup_3", "present", false, null],
    ]);
    const v = ws();
    v.applyCloser([1, 2, 3].map((i) => pass(`e${i}`, i * 1000, [cupOut])));
    v.applyCloser([4, 5, 6].map((i) => pass(`e${i}`, i * 1000, [cupIn, det("cup", [130, 100, 20, 10])])));
    expect(v.view(6000).objects.map((o) => [o.id, o.closer_hold, o.followed_by])).toEqual([["cup_1", false, null], ["cup_2", true, null], ["cup_3", true, null]]);
  });

  it("전체 사진이 더 새 촬영으로 사라짐·시야 밖을 판단했으면 그보다 옛 촬영의 가까이 보기는 되살리지 않는다(10초에 마지막으로 보고 20초에 사라짐, 15초 촬영)", () => {
    const w = ws();
    for (const s of [6, 8, 10]) full(w, `e${s}`, s * 1000, [cupIn]);
    for (const s of [16, 18, 20]) full(w, `e${s}`, s * 1000, []);
    expect(obj(w, "cup_1", 20_000)).toMatchObject({ status: "gone", last_seen_ms: 10_000 });
    expect(w.applyCloser([pass("e15", 15_000, [cupIn])]).changes).toEqual([]);
    expect(obj(w, "cup_1", 20_000)).toMatchObject({ status: "gone", closer_hold: false });
    expect(full(w, "e22", 22_000, []).changes).toEqual([]);
    // 판단보다 새 촬영이면 되살린다
    expect(w.applyCloser([pass("e23", 23_000, [cupIn])]).changes).toEqual([expect.objectContaining({ kind: "appeared", subject: "cup_1" })]);
    const v = ws();
    for (const s of [6, 8, 10]) full(v, `e${s}`, s * 1000, [cupIn]);
    full(v, "e20", 20_000, [], AWAY_VIEW);
    expect(obj(v, "cup_1", 20_000)!.status).toBe("out_of_view");
    expect(v.applyCloser([pass("e15", 15_000, [cupIn])]).changes).toEqual([]);
    expect(obj(v, "cup_1", 20_000)).toMatchObject({ status: "out_of_view", closer_hold: false });
  });

  it("가까이 보기가 새 자리를 넣은 뒤 감지 대기열에 있던 옛 전체 사진이 와도 자리를 되돌리지 않는다. 같은 원본 프레임이면 잘라 본 자리가 앞선다", () => {
    const w = ws();
    for (let i = 1; i <= 3; i++) full(w, `e${i}`, i * 1000, [cupIn]);
    const at = (nowMs: number) => obj(w, "cup_1", nowMs)!.position!;
    w.applyCloser([pass("e6", 6000, [det("cup", [236, 172, 20, 10])])]);
    const moved = at(6000);
    expect(moved[2]).not.toBeCloseTo(0, 3);
    full(w, "e5", 5000, [cupIn]);   // 대기열에 있던 옛 프레임
    expect(at(6000)).toEqual(moved);
    full(w, "e6", 6000, [cupIn]);   // 같은 원본 프레임의 전체 사진
    expect(at(6000)).toEqual(moved);
    full(w, "e7", 7000, [cupIn]);   // 더 새 전체 사진은 자리를 고친다
    expect(at(7000)[2]).toBeCloseTo(0, 3);
  });
});

describe("보임 판단보다 옛 촬영과 같은 원본 촬영", () => {
  it("보임 판단보다 옛 전체 사진은 등장·사라짐 셈에 넣지 않는다: 20초에 사라짐을 본 뒤 늦게 온 15·16·17초 사진 세 장이 되살리지 않고, 20초에 본 컵을 15·16·17초 빈 사진이 지우지 않는다", () => {
    const w = ws();
    for (const s of [6, 8, 10]) full(w, `e${s}`, s * 1000, [cupIn]);
    for (const s of [16, 18, 20]) full(w, `e${s}`, s * 1000, []);
    expect(obj(w, "cup_1", 20_000)!.status).toBe("gone");
    for (const s of [15, 16, 17]) expect(full(w, `l${s}`, s * 1000, [cupIn]).changes, `${s}초`).toEqual([]);
    expect(obj(w, "cup_1", 20_000)!.status).toBe("gone");
    const v = ws();
    for (const s of [6, 8, 10, 20]) full(v, `e${s}`, s * 1000, [cupIn]);
    for (const s of [15, 16, 17]) expect(full(v, `l${s}`, s * 1000, []).changes, `${s}초`).toEqual([]);
    expect(obj(v, "cup_1", 20_000)!.status).toBe("present");
  });

  it("옛 전체 사진은 새 사진의 등장 셈을 끊지 않는다: 20초 사라짐 뒤 22·24초에 보고 늦게 온 17초 빈 사진이 와도 26초에 다시 있음이 된다", () => {
    const w = ws();
    for (const s of [6, 8, 10]) full(w, `e${s}`, s * 1000, [cupIn]);
    for (const s of [16, 18, 20]) full(w, `e${s}`, s * 1000, []);
    full(w, "e22", 22_000, [cupIn]);
    full(w, "e24", 24_000, [cupIn]);
    full(w, "l17", 17_000, []);
    expect(full(w, "e26", 26_000, [cupIn]).changes).toEqual([expect.objectContaining({ kind: "appeared", subject: "cup_1" })]);
  });

  it("이미 넣은 가장 새 전체 사진보다 옛 전체 사진은 넣지 않는다: 20초에 보고 30·31초에 못 본 뒤 늦게 온 25초 양성 사진이 사라짐 셈을 끊지 않아 32초에 사라짐이 된다", () => {
    const w = ws();
    for (const s of [6, 8, 10, 20]) full(w, `e${s}`, s * 1000, [cupIn]);
    full(w, "e30", 30_000, []);
    full(w, "e31", 31_000, []);
    const late = full(w, "l25", 25_000, [cupIn]);
    expect(full(w, "e32", 32_000, []).changes).toEqual([expect.objectContaining({ kind: "gone", subject: "cup_1" })]);
    expect(obj(w, "cup_1", 32_000)).toMatchObject({ status: "gone", last_seen_ms: 20_000 });
    expect(late).toEqual({ changes: [], ids: new Map() });
  });

  it("늦게 온 옛 전체 사진 세 장은 다른 자리 새 컵의 등장 셈도 하지 않는다", () => {
    const w = ws();
    for (const s of [6, 8, 10, 20]) full(w, `e${s}`, s * 1000, [cupIn]);
    for (const s of [12, 14, 16]) expect(full(w, `l${s}`, s * 1000, [cupIn, cupOut]).changes, `${s}초`).toEqual([]);
    expect(w.view(20_000).objects.map((o) => o.id)).toEqual(["cup_1"]);
  });

  it("마지막 전체 사진에서 사라짐이 된 뒤 같은 원본 사진을 잘라 컵을 찾으면 잘라 본 양성이 앞서 다시 있음이 된다. 같은 원본 전체 사진이 늦게 와도 뒤집지 않는다", () => {
    const w = ws();
    for (const s of [6, 8, 10]) full(w, `e${s}`, s * 1000, [cupIn]);
    for (const s of [16, 18, 20]) full(w, `e${s}`, s * 1000, []);
    expect(obj(w, "cup_1", 20_000)!.status).toBe("gone");
    const r = w.applyCloser([16, 18, 20].map((s) => pass(`e${s}`, s * 1000, [cupIn])));
    expect(r.changes).toEqual([expect.objectContaining({ kind: "appeared", subject: "cup_1", at_ms: 20_000 })]);
    expect(obj(w, "cup_1", 20_000)).toMatchObject({ status: "present", last_seen_ms: 20_000, closer_hold: true });
    expect(full(w, "e20", 20_000, [], AWAY_VIEW).changes).toEqual([]);
    expect(obj(w, "cup_1", 20_000)!.status).toBe("present");
  });

  it("가까이 보기로 10초에 확인한 컵은 그보다 옛(4~6초) 전체 사진의 다른 자리 컵 등장으로 지킴이 풀리거나 옮김 표시가 붙지 않는다. 같은 촬영(10초)의 등장도 옮김이 아니다", () => {
    const w = ws();
    w.applyCloser([8, 9, 10].map((s) => pass(`e${s}`, s * 1000, [cupIn])));
    for (const s of [4, 5, 6]) full(w, `e${s}`, s * 1000, [cupOut]);
    expect(w.view(10_000).objects.map((o) => [o.id, o.status, o.closer_hold, o.followed_by])).toEqual([["cup_1", "present", true, null], ["cup_2", "present", false, null]]);
    const v = ws();
    v.applyCloser([8, 9, 10].map((s) => pass(`e${s}`, s * 1000, [cupIn])));
    for (const s of [8, 9, 10]) full(v, `f${s}`, s * 1000, [cupOut]);
    expect(v.view(10_000).objects.map((o) => [o.id, o.closer_hold, o.followed_by])).toEqual([["cup_1", true, null], ["cup_2", false, null]]);
  });
});

describe("같은 원본 프레임의 VLM 답: 전체 사진과 잘라 본 사진이 원본 프레임·물건·면 하나의 규칙을 쓴다", () => {
  const three = (dets: Detection[] = [cupIn]) => {
    const w = ws();
    let ids = new Map<string, string>();
    for (let i = 1; i <= 3; i++) ids = full(w, `e${i}`, i * 1000, dets).ids;
    return { w, ids };
  };
  const scene = (...states: SceneState[]): SceneObservation => ({ scene: "k", observations: states.map((state) => ({ object_id: "d1", state })), summary: "" });
  const crop = new Map([["d1", "cup_1"]]);
  const facts = (w: WorldState, nowMs = 3000) => w.view(nowMs).objects[0]!.facts;

  it("잘라 본 답이 먼저 오고 같은 원본 프레임의 전체 사진 답이 늦게 오면: 같은 값도 확신으로 올리지 않고, 다른 값은 잘라 본 답을 덮지 않는다", () => {
    const a = three();
    a.w.applyCloserScene("e3", 3000, scene("in_sink"), crop);
    expect(a.w.applyScene("e3", 3000, scene("in_sink"), a.ids)).toEqual([]);
    expect(facts(a.w).place).toMatchObject({ value: "in_sink", certainty: "inferred" });
    const b = three();
    b.w.applyCloserScene("e3", 3000, scene("in_sink"), crop);
    expect(b.w.applyScene("e3", 3000, scene("on_table"), b.ids)).toEqual([]);
    expect(facts(b.w).place).toMatchObject({ value: "in_sink", certainty: "inferred" });
    // 다른 원본 프레임의 같은 값은 확신으로 센다
    const { ids } = full(b.w, "e4", 4000, [cupIn]);
    b.w.applyScene("e4", 4000, scene("in_sink"), ids);
    expect(facts(b.w, 4000).place).toMatchObject({ value: "in_sink", certainty: "confirmed" });
  });

  it("전체 사진 답이 먼저 오고 같은 원본 프레임의 잘라 본 답이 오면: 잘라 본 답이 앞서되 같은 값은 확신으로 올리지 않는다", () => {
    const a = three();
    a.w.applyScene("e3", 3000, scene("on_table"), a.ids);
    expect(a.w.applyCloserScene("e3", 3000, scene("in_sink"), crop).map((c) => c.text)).toEqual(["컵 cup_1 싱크대 안"]);
    expect(facts(a.w).place).toMatchObject({ value: "in_sink", certainty: "inferred" });
    const b = three();
    b.w.applyScene("e3", 3000, scene("in_sink"), b.ids);
    expect(b.w.applyCloserScene("e3", 3000, scene("in_sink"), crop)).toEqual([]);
    expect(facts(b.w).place).toMatchObject({ value: "in_sink", certainty: "inferred" });
  });

  it("잘라 본 답이 넣은 지금만 맞는 사실(쓰는 중)은 같은 원본 프레임의 전체 사진 답에 없어도 지우지 않는다", () => {
    const a = three();
    a.w.applyCloserScene("e3", 3000, scene("in_use"), crop);
    a.w.applyScene("e3", 3000, scene("on_table"), a.ids);
    expect(facts(a.w).use).toMatchObject({ value: "in_use" });
  });

  it("같은 원본 프레임을 다른 물건 둘레로 다시 잘라 보면 그 물건 사실은 넣는다(막는 것은 원본 프레임·물건·면이 같을 때만)", () => {
    const { w } = three([cupIn, cupOut]);
    w.applyCloserScene("e3", 3000, scene("in_sink"), new Map([["d1", "cup_1"]]));
    expect(w.applyCloserScene("e3", 3000, scene("in_sink"), new Map([["d1", "cup_2"]])).map((c) => c.subject)).toEqual(["cup_2"]);
    expect(w.view(3000).objects.map((o) => [o.id, o.facts.place?.value])).toEqual([["cup_1", "in_sink"], ["cup_2", "in_sink"]]);
  });
});

describe("가까이 본 사진의 VLM 답(applyCloserScene)", () => {
  const seeded = () => {
    const w = ws();
    let ids = new Map<string, string>();
    for (let i = 1; i <= 3; i++) ids = full(w, `e${i}`, i * 1000, [cupIn, person]).ids;
    w.applyScene("e3", 3000, { scene: "kitchen", observations: [{ object_id: "d1", state: "in_use" }, { object_id: "d2", state: "standing" }], summary: "s1" }, ids);
    return w;
  };

  it("그 사진에서 잡은 물건 id의 사실만 넣고, 장면 요약·답에 없는 면·지금만 맞는 사실은 그대로 둔다", () => {
    const w = seeded();
    const changes = w.applyCloserScene("e3", 3000, { scene: "k", observations: [{ object_id: "d1", state: "in_sink" }, { object_id: "d1", state: "empty" }, { object_id: "d2", state: "sitting" }], summary: "s2" },
      new Map([["d1", "cup_1"]]));
    expect(changes.map((c) => [c.kind, c.text])).toEqual([["state", "컵 cup_1 싱크대 안"], ["state", "컵 cup_1 비어 있음"]]);
    const v = w.view(3000);
    expect(v.objects[0]!.facts).toMatchObject({ place: { value: "in_sink" }, contents: { value: "empty" }, use: { value: "in_use" } });
    expect(v.person.facts.posture).toMatchObject({ value: "standing" });
    // 요약이 그대로 s1이라 같은 요약은 변화가 아니다
    expect(w.applyScene("e4", 4000, { scene: "k", observations: [], summary: "s1" }, new Map()).filter((c) => c.kind === "vlm")).toEqual([]);
  });

  it("가까이 본 답이 면 값을 새로 넣거나 바꾸면 그 원본 사진의 촬영 시각(closer_ms)을 남긴다. 같은 값이 이어지는 동안 남고 다른 값이 들어오면 없어진다. 같은 값을 다시 본 것은 남기지 않는다", () => {
    const w = seeded();
    const ids = new Map([["d1", "cup_1"]]);
    const said = (state: SceneState): SceneObservation => ({ scene: "k", observations: [{ object_id: "d1", state }], summary: "" });
    const contents = (nowMs: number) => w.view(nowMs).objects[0]!.facts.contents;
    w.applyCloserScene("e3", 3000, said("has_contents"), ids);
    expect(contents(3000)).toEqual({ value: "has_contents", at_ms: 3000, since_ms: 3000, certainty: "inferred", closer_ms: 3000 });
    w.applyScene("e4", 4000, said("has_contents"), full(w, "e4", 4000, [cupIn, person]).ids);
    expect(contents(4000)).toEqual({ value: "has_contents", at_ms: 4000, since_ms: 3000, certainty: "confirmed", closer_ms: 3000 });
    w.applyScene("e5", 5000, said("empty"), full(w, "e5", 5000, [cupIn, person]).ids);
    expect(contents(5000)).toEqual({ value: "empty", at_ms: 5000, since_ms: 5000, certainty: "inferred" });
    w.applyCloserScene("e6", 6000, said("empty"), ids);
    expect(contents(6000)).toEqual({ value: "empty", at_ms: 6000, since_ms: 5000, certainty: "confirmed" });
    w.applyCloserScene("e7", 7000, said("has_contents"), ids);
    expect(contents(7000)).toMatchObject({ value: "has_contents", closer_ms: 7000 });
  });

  it("가까이 본 답이 면 값을 새로 넣거나 바꾼 횟수(closer_rev)는 지금 값의 출처와 따로 남는다: 전체 사진이 값을 바꿔 closer_ms가 없어져도 줄지 않고, 판단 기록 요약에도 실린다", () => {
    const w = seeded();
    const ids = new Map([["d1", "cup_1"]]);
    const said = (state: SceneState): SceneObservation => ({ scene: "k", observations: [{ object_id: "d1", state }], summary: "" });
    const cup = (nowMs: number) => w.view(nowMs).objects[0]!;
    expect(cup(3000).closer_rev).toBeUndefined();
    w.applyCloserScene("e3", 3000, said("has_contents"), ids);
    expect(cup(3000).closer_rev).toEqual({ contents: 1 });
    w.applyScene("e5", 5000, said("contents_unknown"), full(w, "e5", 5000, [cupIn, person]).ids);
    expect(cup(5000).facts.contents).toEqual({ value: "contents_unknown", at_ms: 5000, since_ms: 5000, certainty: "inferred" });
    expect(cup(5000).closer_rev).toEqual({ contents: 1 });
    w.applyCloserScene("e6", 6000, said("contents_unknown"), ids);   // 같은 값을 다시 본 것은 세지 않는다
    expect(cup(6000).closer_rev).toEqual({ contents: 1 });
    w.applyCloserScene("e7", 7000, said("empty"), ids);
    expect(cup(7000).closer_rev).toEqual({ contents: 2 });
    expect(decisionWorld(w.view(7000)).objects[0]!.closer_rev).toEqual({ contents: 2 });
  });

  it("이미 있는 물건도 그 상자에 가림(not_visible)과 사실을 함께 답하면 답 순서와 상관없이 그 상자의 사실을 넣지 않는다", () => {
    const hidden = (first: SceneState, second: SceneState): SceneObservation => ({ scene: "k", observations: [{ object_id: "d1", state: first }, { object_id: "d1", state: second }], summary: "" });
    for (const scene of [hidden("not_visible", "in_sink"), hidden("in_sink", "not_visible")]) {
      const w = seeded();
      expect(w.applyCloserScene("e3", 3000, scene, new Map([["d1", "cup_1"]]))).toEqual([]);
      const cup = w.view(3000).objects[0]!;
      expect(cup.facts.place).toBeUndefined();
      expect(cup.closer_rev).toBeUndefined();
    }
  });

  it("같은 원본 프레임에서 나온 답은 한 번만 넣고, 같은 촬영의 같은 값으로 확신을 올리지 않는다", () => {
    const w = seeded();
    const ids = new Map([["d1", "cup_1"]]);
    w.applyScene("e3", 3000, { scene: "k", observations: [{ object_id: "d1", state: "empty" }, { object_id: "d1", state: "in_use" }], summary: "s1" }, new Map([["d1", "cup_1"]]));
    expect(w.applyCloserScene("e3", 3000, { scene: "k", observations: [{ object_id: "d1", state: "empty" }, { object_id: "d1", state: "in_sink" }], summary: "x" }, ids)).toHaveLength(1);
    expect(w.applyCloserScene("e3", 3000, { scene: "k", observations: [{ object_id: "d1", state: "in_sink" }, { object_id: "d1", state: "has_contents" }], summary: "x" }, ids)).toEqual([]);
    expect(w.view(3000).objects[0]!.facts).toMatchObject({ contents: { value: "empty", certainty: "inferred" }, place: { value: "in_sink", certainty: "inferred" } });
    w.applyCloserScene("e5", 5000, { scene: "k", observations: [{ object_id: "d1", state: "in_sink" }], summary: "x" }, ids);
    expect(w.view(5000).objects[0]!.facts.place).toMatchObject({ value: "in_sink", certainty: "confirmed" });
  });
});

describe("가까이 보기 새 물건 두 모델 확인(3장 안 된 후보 + VLM 사실)", () => {
  const said = (...obs: [string, SceneState][]): SceneObservation => ({ scene: "k", observations: obs.map(([object_id, state]) => ({ object_id, state })), summary: "s" });
  const holds = (w: WorldState, nowMs: number) => w.view(nowMs).objects.map((o) => [o.id, o.closer_hold, o.followed_by]);
  const cupFar = det("cup", [130, 100, 20, 10]);

  it("맞는 물건이 없고 3장이 안 된 감지는 VLM 답까지 들고 있다가, VLM에 보낸 장의 그 상자 번호에 사실을 하나 이상 답하면 확인된 물건 하나를 만들고 그 사실을 넣는다", () => {
    const w = ws();
    const r = w.applyCloser([pass("e1", 1000, [cupIn]), pass("e2", 2000, [person, cupIn])]);
    expect(r.changes).toEqual([]);
    expect(r.ids).toEqual(new Map());
    expect(w.view(2000).objects).toEqual([]);
    const changes = w.applyCloserScene("e2", 2000, said(["d2", "in_sink"]), r.ids, r.pending);
    expect(changes.map((c) => [c.kind, c.subject, c.at_ms])).toEqual([["appeared", "cup_1", 2000], ["state", "cup_1", 2000]]);
    expect(r.ids).toEqual(new Map([["d2", "cup_1"]]));
    expect(obj(w, "cup_1", 2000)).toMatchObject({
      status: "present", first_seen_ms: 1000, last_seen_ms: 2000, closer_hold: true, closer_rev: { place: 1 },
      facts: { place: { value: "in_sink", certainty: "inferred", closer_ms: 2000 } },
    });
    expect(obj(w, "cup_1", 2000)!.position![0]).toBeCloseTo(1.5, 2);
    // 새로 만든 물건은 가까이 보기로 만든 물건과 같다: 30초 지킴 동안 전체 사진이 못 봐도 사라지지 않는다
    for (let i = 3; i <= 5; i++) expect(full(w, `e${i}`, i * 1000, []).changes).toEqual([]);
    expect(obj(w, "cup_1", 5000)).toMatchObject({ status: "present", closer_hold: true });
  });

  it("VLM이 그 상자에 사실을 답하지 않으면(답 없음·다른 상자·가림·그 종류에 없는 면) 만들지 않는다. VLM 답이 없으면(endCloser) 후보를 버린다", () => {
    for (const scene of [said(), said(["d2", "in_sink"]), said(["d1", "not_visible"]), said(["d1", "standing"])]) {
      const w = ws();
      const r = w.applyCloser([pass("e1", 1000, [cupIn, person])]);
      expect(w.applyCloserScene("e1", 1000, scene, r.ids, r.pending)).toEqual([]);
      expect(r.ids).toEqual(new Map());
      expect(w.view(1000).objects).toEqual([]);
    }
    const w = ws();
    const r = w.applyCloser([pass("e1", 1000, [cupIn])]);
    w.endCloser(r.pending!);
    expect(w.applyCloserScene("e1", 1000, said(["d1", "in_sink"]), r.ids, r.pending)).toEqual([]);   // 이미 끝낸 후보는 다시 쓰지 않는다
    expect(w.view(1000).objects).toEqual([]);
  });

  it("VLM이 그 상자에 가림(not_visible)과 사실을 함께 답하면 답 순서와 상관없이 만들지 않는다", () => {
    for (const scene of [said(["d1", "not_visible"], ["d1", "in_sink"]), said(["d1", "in_sink"], ["d1", "not_visible"])]) {
      const w = ws();
      const r = w.applyCloser([pass("e1", 1000, [cupIn])]);
      expect(w.applyCloserScene("e1", 1000, scene, r.ids, r.pending)).toEqual([]);
      expect(r.ids).toEqual(new Map());
      expect(w.view(1000).objects).toEqual([]);
    }
  });

  it("후보는 VLM에 보낸 장(idsFrom)에 보인 물건 감지뿐이다: 다른 장에만 보인 감지, 사람·가전 설비·경계에 닿은 상자·종류 최소 신뢰도 미만은 VLM이 답해도 만들지 않는다", () => {
    const w = ws();
    const r = w.applyCloser([pass("e1", 1000, [cupIn]), pass("e2", 2000, [person])], "e2");
    w.applyCloserScene("e2", 2000, said(["d1", "in_sink"]), r.ids, r.pending);
    expect(w.view(2000).objects).toEqual([]);
    const v = ws();
    const s = v.applyCloser([pass("e1", 1000, [person, { ...cupIn, edge: true }, det("cup", [230, 170, 20, 10], 0.3), det("sink", [130, 100, 200, 150], 0.9)])]);
    v.applyCloserScene("e1", 1000, said(["d1", "standing"], ["d2", "in_sink"], ["d3", "in_sink"], ["d4", "water_running"]), s.ids, s.pending);
    expect(v.view(1000).objects).toEqual([]);
  });

  it("지킴 중인 물건을 두고 VLM으로 만든 새 물건도 지킴을 풀고 옮김 표시를 남긴다. 3장으로 만든 물건과 함께 생기면 둘이라 표시를 남기지 않고, VLM 답이 없으면 3장으로 만든 물건 하나로 표시한다", () => {
    const w = ws();
    w.applyCloser([1, 2, 3].map((i) => pass(`e${i}`, i * 1000, [cupOut])));
    const r = w.applyCloser([pass("e4", 4000, []), pass("e5", 5000, [cupIn])]);
    expect(holds(w, 5000)).toEqual([["cup_1", true, null]]);   // 후보만으로는 지킴을 풀지 않는다
    w.applyCloserScene("e5", 5000, said(["d1", "in_sink"]), r.ids, r.pending);
    expect(holds(w, 5000)).toEqual([["cup_1", false, "cup_2"], ["cup_2", true, null]]);
    const both = () => {
      const v = ws();
      v.applyCloser([1, 2, 3].map((i) => pass(`e${i}`, i * 1000, [cupOut])));
      const s = v.applyCloser([pass("e4", 4000, [cupIn]), pass("e5", 5000, [cupIn]), pass("e6", 6000, [cupIn, cupFar])]);
      expect(holds(v, 6000)).toEqual([["cup_1", true, null], ["cup_2", true, null]]);   // 3장 컵은 바로 생기고 옮김 처리는 VLM 답까지 미룬다
      return { v, s };
    };
    const a = both();
    a.v.applyCloserScene("e6", 6000, said(["d1", "in_sink"], ["d2", "in_sink"]), a.s.ids, a.s.pending);
    expect(holds(a.v, 6000)).toEqual([["cup_1", false, null], ["cup_2", true, null], ["cup_3", true, null]]);
    const b = both();
    b.v.endCloser(b.s.pending!);
    expect(holds(b.v, 6000)).toEqual([["cup_1", false, "cup_2"], ["cup_2", true, null]]);
  });

  it("VLM 답을 기다리는 사이 전체 사진이 같은 자리 물건을 확인했으면 새로 만들지 않고 그 물건에 사실을 넣는다", () => {
    const w = ws();
    const r = w.applyCloser([pass("e1", 1000, [cupIn])]);
    for (let i = 2; i <= 4; i++) full(w, `e${i}`, i * 1000, [cupIn]);
    w.applyCloserScene("e1", 1000, said(["d1", "in_sink"]), r.ids, r.pending);
    expect(r.ids).toEqual(new Map([["d1", "cup_1"]]));
    expect(w.view(4000).objects.map((o) => [o.id, o.facts.place?.value])).toEqual([["cup_1", "in_sink"]]);
  });
});
