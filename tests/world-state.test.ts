import { describe, expect, it } from "vitest";
import { WorldState } from "../src/world/state.js";
import { sha256, type EngineFrame } from "../src/observe/ring.js";
import type { Detection } from "../src/brain/detector.js";
import type { CameraView } from "../src/phone/session.js";
import { checkPlan } from "../src/act/check.js";

const surfaces = () => [{ id: "table_1", label: "식탁", center: [2, 0] as [number, number], top: 0.75, radius: 0.6 }];
const devices = () => [{ id: "dishwasher_1", kind: "dishwasher", label: "식기세척기" }];
const ws = () => new WorldState({ surfaces, floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices });
const frame = (i: number): EngineFrame => ({ id: `e${i}`, capturedAtMs: i * 1000, latestAtMs: i * 1000, jpeg: Buffer.from(`${i}`), sha256: sha256(Buffer.from(`${i}`)), width: 480, height: 360, eye: null, view: null });
const cup: Detection = { label: "cup", score: 0.9, cls: 41, box: [220, 160, 40, 20] };
const person: Detection = { label: "person", score: 0.9, cls: 0, box: [10, 10, 100, 300] };

// 카메라: 트윈 (0, 1.5, 0)에서 45° 아래로 숙이고 +x(look) 또는 −x(away)를 본다. 90° 시야 투영(열 우선)
const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
const mul = (a: number[], b: number[]) => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!, a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
const tilt = [Math.sin(-Math.PI / 8), 0, 0, Math.cos(-Math.PI / 8)];
const camera = (yaw: number): CameraView => ({ origin: [0, 1.5, 0], orientation: mul([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], tilt) as [number, number, number, number], theta: 0, projection: P });
const look = camera(-Math.PI / 2);
const away = camera(Math.PI / 2);

describe("World State", () => {
  it("3장 연속 컵이면 등장, 관계표로 식기세척기를 붙인다(맞추기 전 위치는 모름)", () => {
    const w = ws();
    let last;
    for (let i = 1; i <= 3; i++) last = w.applyDetections(frame(i), [cup]);
    expect(last!.changes.map((c) => c.kind)).toEqual(["appeared"]);
    const o = w.view(3000).objects[0]!;
    expect(o).toMatchObject({ cls: "cup", status: "present", position: null, devices: ["dishwasher_1"], first_seen_ms: 1000, last_seen_ms: 3000 });
  });
  it("등장 확인 전 물체는 보이지 않고, 한 장 끊기면 잊는다", () => {
    const w = ws();
    w.applyDetections(frame(1), [cup]);
    w.applyDetections(frame(2), [cup]);
    expect(w.view(2000).objects).toEqual([]);
    w.applyDetections(frame(3), []);
    for (let i = 4; i <= 6; i++) w.applyDetections(frame(i), [cup]);
    expect(w.view(6000).objects.map((o) => [o.id, o.first_seen_ms])).toEqual([["cup_2", 4000]]);
  });
  it("VLM 사실을 면(facet)마다 두고, 두 번 연속이면 confirmed", () => {
    const w = ws();
    let ids = new Map<string, string>();
    for (let i = 1; i <= 3; i++) ids = w.applyDetections(frame(i), [cup]).ids;
    expect(w.applyScene("e3", 3000, { scene: "kitchen", observations: [{ object_id: "d1", state: "empty" }], summary: "s" }, ids)
      .filter((c) => c.kind === "state")).toEqual([expect.objectContaining({ subject: "cup_1", text: "컵 cup_1 비어 있음", meaningful: true })]);
    expect(w.view(3000).objects[0]!.facts.contents).toMatchObject({ value: "empty", certainty: "inferred" });
    w.applyScene("e3", 3000, { scene: "kitchen", observations: [{ object_id: "d1", state: "empty" }, { object_id: "d1", state: "on_table" }], summary: "s" }, ids);
    expect(w.view(3000).objects[0]!.facts).toMatchObject({ contents: { certainty: "confirmed" }, place: { value: "on_table" } });
  });
  it("늦게 온 오래된 VLM 답은 새 사실을 덮지 않고, 분석 없음은 셈과 변화로 남긴다", () => {
    const w = ws();
    let ids = new Map<string, string>();
    for (let i = 1; i <= 3; i++) ids = w.applyDetections(frame(i), [cup]).ids;
    w.applyScene("e3", 3000, { scene: "k", observations: [{ object_id: "d1", state: "has_contents" }], summary: "s" }, ids);
    w.applyScene("e2", 2000, { scene: "k", observations: [{ object_id: "d1", state: "empty" }], summary: "s" }, ids);
    expect(w.view(3000).objects[0]!.facts.contents!.value).toBe("has_contents");
    expect(w.applyMissing("e4", 4000, { vlm: "cap" })[0]).toMatchObject({ kind: "vlm_missing", meaningful: false, text: "요청이 몰려 VLM 분석 없음" });
    expect(w.view(4000).vlm_missing).toBe(1);
  });
  it("VLM 요약은 바뀔 때만 vlm 변화를 낸다", () => {
    const w = ws();
    const kinds = (s: string) => w.applyScene("e1", 1000, { scene: "k", observations: [], summary: s }, new Map()).map((c) => c.kind);
    expect(kinds("컵이 식탁 위")).toEqual(["vlm"]);
    expect(kinds("컵이 식탁 위")).toEqual([]);
    expect(kinds("사람이 컵을 듦")).toEqual(["vlm"]);
    expect(w.applyScene("e0", 500, { scene: "k", observations: [], summary: "더 앞선 사진" }, new Map())).toEqual([]);
  });
  it("감지 실패·대기열 초과 프레임은 등장·사라짐 셈에 넣지 않고 분석 없음으로 센다", () => {
    const w = ws();
    for (let i = 1; i <= 3; i++) w.applyDetections(frame(i), [cup]);
    for (let i = 4; i <= 6; i++) expect(w.applyMissing(`e${i}`, i * 1000, { yolo: "error" })[0]).toMatchObject({ kind: "yolo_missing", text: "감지 오류로 YOLOX 분석 없음" });
    expect(w.applyMissing("e7", 7000, { yolo: "cap", vlm: "cap" })[0]).toMatchObject({ kind: "yolo_missing", text: "요청이 몰려 YOLOX·VLM 분석 없음" });
    expect(w.view(7000)).toMatchObject({ yolo_missing: 4, vlm_missing: 1, objects: [{ status: "present" }] });
  });
  it("맞추기 전(눈 자세 없음)에는 3장 연속 안 보이면 사라짐", () => {
    const w = ws();
    for (let i = 1; i <= 3; i++) w.applyDetections(frame(i), [cup]);
    w.applyDetections(frame(4), []);
    w.applyDetections(frame(5), []);
    expect(w.applyDetections(frame(6), []).changes.map((c) => c.kind)).toEqual(["gone"]);
    expect(w.view(6000).objects[0]!.status).toBe("gone");
  });
  it("맞춘 뒤: 트윈 위치를 붙이고, 같은 자리 같은 종류는 같은 물체, 시야 밖이면 사라짐을 세지 않는다", () => {
    const w = new WorldState({ surfaces: () => [{ id: "table_1", label: "식탁", center: [0.75, 0], top: 0.75, radius: 0.6 }], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices });
    const at = (i: number, view: CameraView) => ({ ...frame(i), view });
    let last;
    for (let i = 1; i <= 3; i++) last = w.applyDetections(at(i, look), [cup]);
    expect(last!.changes).toEqual([expect.objectContaining({ kind: "appeared", text: "컵 cup_1 보임 · 식탁 위", meaningful: true })]);
    expect(w.view(3000).objects).toEqual([expect.objectContaining({ id: "cup_1", surface: "table_1", room: "kitchen" })]);
    expect(w.view(3000).objects[0]!.position![1]).toBeCloseTo(0.75, 2);
    expect(w.applyDetections(at(4, away), []).changes).toEqual([expect.objectContaining({ kind: "out_of_view", text: "컵 cup_1 시야 밖", meaningful: false })]);
    for (let i = 5; i <= 8; i++) expect(w.applyDetections(at(i, away), []).changes).toEqual([]);
    expect(w.view(8000).objects[0]).toMatchObject({ status: "out_of_view", last_in_view_ms: 3000 });
    expect(w.applyDetections(at(9, look), [cup]).changes.map((c) => c.kind)).toEqual(["back_in_view"]);
    expect(w.view(9000).objects.map((o) => [o.id, o.status])).toEqual([["cup_1", "present"]]);
  });
  it("쓰는 중·물건을 들고 있음은 그 물체를 본 뒤 VLM 답에 없으면 지우고, 사람이 안 보이면 사람 사실을 지운다", () => {
    const w = ws();
    let ids = new Map<string, string>();
    for (let i = 1; i <= 3; i++) ids = w.applyDetections(frame(i), [person, cup]).ids;
    w.applyScene("e3", 3000, { scene: "k", observations: [{ object_id: "d1", state: "holding_object" }, { object_id: "d2", state: "in_use" }], summary: "마심" }, ids);
    expect(w.view(3000).objects[0]!.facts.use?.value).toBe("in_use");
    expect(w.view(3000).person.facts.action?.value).toBe("holding_object");
    for (let i = 4; i <= 100; i++) {
      ids = w.applyDetections(frame(i), [cup]).ids;
      w.applyScene(`e${i}`, i * 1000, { scene: "k", observations: [{ object_id: "d1", state: "on_table" }, { object_id: "d1", state: "empty" }], summary: "빈 컵" }, ids);
    }
    const v = w.view(100_000);
    expect(v.person).toMatchObject({ visible: false, facts: {} });
    expect(v.objects[0]!.facts.use).toBeUndefined();
    expect(v.objects[0]!.facts).toMatchObject({ place: { value: "on_table" }, contents: { value: "empty" } });
    const decision = { id: "pam-1", seq: 1, atMs: 99_000, textSent: "", finalTime: "", status: "valid" as const, prediction: { observation: "o", reasoning: "r", task_index: 0 }, action: "컵 치우기", memoryVersion: 1, world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 } };
    const plan = { id: "plan:pam-1", revision: 1, source: "brain" as const, goal: "g", judgment: "j", dryRun: true, robot: { position: null, room: null }, path: [], legs: [],
      steps: [{ id: "s1", kind: "act" as const, label: "l", status: "pending" as const, target: { objectId: v.objects[0]!.id } }], status: "planned" as const, updatedAt: "" };
    expect(checkPlan({ decision, tasks: ["컵 치우기", "사용자에게 물어보기"], plan, world: v, nowMs: 100_500, staleMs: 3000, mode: "test" })).toEqual({ ok: true });
  });
  it("늦게 온 오래된 답은 쓰는 중을 지우지 않는다", () => {
    const w = ws();
    let ids = new Map<string, string>();
    for (let i = 1; i <= 3; i++) ids = w.applyDetections(frame(i), [cup]).ids;
    w.applyScene("e3", 3000, { scene: "k", observations: [{ object_id: "d1", state: "in_use" }], summary: "s" }, ids);
    w.applyScene("e2", 2000, { scene: "k", observations: [], summary: "s" }, ids);
    expect(w.view(3000).objects[0]!.facts.use?.value).toBe("in_use");
  });
  it("띄엄띄엄 본 사람은 보임으로 치지 않는다", () => {
    const w = ws();
    const out: string[] = [];
    w.applyDetections(frame(1), [person]);
    for (let i = 2; i <= 30; i++) out.push(...w.applyDetections(frame(i), []).changes.map((c) => c.kind));
    out.push(...w.applyDetections(frame(31), [person]).changes.map((c) => c.kind));
    expect(out).toEqual([]);
    expect(w.view(31_000).person.visible).toBe(false);
  });
  it("사라진 물건을 띄엄띄엄 다시 봐도 등장으로 치지 않는다", () => {
    const w = new WorldState({ surfaces: () => [{ id: "table_1", label: "식탁", center: [0.75, 0], top: 0.75, radius: 0.6 }], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices });
    const out: string[] = [];
    let n = 0;
    const step = (dets: Detection[]) => { n++; out.push(...w.applyDetections({ ...frame(n), view: look }, dets).changes.map((c) => `${n}:${c.kind}`)); };
    for (const dets of [[cup], [cup], [cup], [], [], [], [cup], [], [], [], [cup], [], [], [], [cup]]) step(dets);
    expect(out).toEqual(["3:appeared", "6:gone"]);
    expect(w.view(n * 1000).objects.map((o) => o.status)).toEqual(["gone"]);
  });
  it("사람은 2장으로 보임·안 보임, 가전 변화는 바뀐 시각과 이력", () => {
    const w = ws();
    w.applyDetections(frame(1), [person]);
    expect(w.applyDetections(frame(2), [person]).changes.map((c) => c.kind)).toEqual(["person_appeared"]);
    expect(w.view(2000).person).toMatchObject({ visible: true, since_ms: 2000, last_seen_ms: 2000 });
    const ch = w.applyDevice({ id: "dishwasher_1", online: true, twin: { running: true }, matter: {}, updatedAt: "" }, 5000);
    expect(ch[0]).toMatchObject({ kind: "device", meaningful: true, text: "식기세척기 작동 중" });
    expect(w.view(5000).devices[0]).toMatchObject({ status: "작동 중", changed_ms: 5000, remaining_min: null, history: [{ attr: "running", to: true, at_ms: 5000 }] });
    expect(w.applyDevice({ id: "dishwasher_1", online: true, twin: { running: true }, matter: {}, updatedAt: "" }, 6000)).toEqual([]);
    expect(w.applyDevice({ id: "tv_1", online: true, twin: { power: "on" }, matter: {}, updatedAt: "" }, 6000)).toEqual([]);
  });
  it("남은 시간은 running이 참이 된 시각과 코스 분으로만 센다", () => {
    const w = ws();
    w.applyDevice({ id: "dishwasher_1", online: true, twin: { running: true, course_min: 90 }, matter: {}, updatedAt: "" }, 0);
    w.applyDevice({ id: "dishwasher_1", online: true, twin: { running: true, course_min: 90 }, matter: {}, updatedAt: "" }, 60_000);
    expect(w.view(30 * 60_000 + 1).devices[0]).toMatchObject({ started_ms: 0, remaining_min: 60 });
    w.applyDevice({ id: "dishwasher_1", online: true, twin: { running: false }, matter: {}, updatedAt: "" }, 40 * 60_000);
    expect(w.view(40 * 60_000).devices[0]).toMatchObject({ started_ms: null, remaining_min: null });
  });
  it("신호 없는 가전은 상태를 모름으로 둔다", () => {
    const w = ws();
    expect(w.applyDevice({ id: "dishwasher_1", online: false, twin: {}, matter: {}, updatedAt: "", signal: "none" }, 0)).toEqual([]);
    expect(w.view(0).devices[0]).toMatchObject({ status: null });
  });
});
