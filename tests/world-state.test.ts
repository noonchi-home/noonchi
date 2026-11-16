import { describe, expect, it } from "vitest";
import { WorldState } from "../src/world/state.js";
import { CHANGE_TEXT, redactHeard, redactSaid, saidIn } from "../src/world/labels.js";
import { placeBox, placePoint } from "../src/world/place.js";
import { sha256 } from "../src/observe/ring.js";
import type { EngineFrame, Detection, CameraView } from "../src/contract/observe.js";
import { checkPlan } from "../src/act/check.js";
import { poseOf, standing } from "./helpers/poses.js";
import { det } from "./helpers/detectors.js";

const surfaces = () => [{ id: "table_1", label: "식탁", center: [2, 0] as [number, number], top: 0.75, radius: 0.6 }];
const devices = () => [{ id: "dishwasher_1", kind: "dishwasher", label: "식기세척기" }];
const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces, floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices });
const frame = (i: number): EngineFrame => ({ id: `e${i}`, capturedAtMs: i * 1000, latestAtMs: i * 1000, jpeg: Buffer.from(`${i}`), sha256: sha256(Buffer.from(`${i}`)), width: 480, height: 360, eye: null, view: null });
const cup: Detection = det("cup", 0.9, [220, 160, 40, 20], 41);
const person: Detection = det("person", 0.9, [10, 10, 100, 300], 0);

// 카메라: 트윈 (0, 1.5, 0)에서 45° 아래로 숙이고 +x(look) 또는 −x(away)를 본다. 90° 시야 투영(열 우선)
const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
const mul = (a: number[], b: number[]) => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!, a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
const tilt = [Math.sin(-Math.PI / 8), 0, 0, Math.cos(-Math.PI / 8)];
const camera = (yaw: number): CameraView => ({ origin: [0, 1.5, 0], orientation: mul([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], tilt) as [number, number, number, number], theta: 0, projection: P });
const look = camera(-Math.PI / 2);
const away = camera(Math.PI / 2);

describe("들은 말(실제 폰이 들은 한 마디)", () => {
  it("변화 줄 하나로 남긴다: 판단 계기이고 글은 「사람이 말함: 「…」」", () => {
    expect(ws().heard("  라면 끓이는 법 알려 줘 ", 5000)).toEqual([{ kind: "heard", at_ms: 5000, subject: "person", text: "사람이 말함: 「라면 끓이는 법 알려 줘」", meaningful: true }]);
    expect(CHANGE_TEXT.heard("뭐 해야 되지")).toBe("사람이 말함: 「뭐 해야 되지」");
  });
  it("200자에서 자르고 줄바꿈·「」를 뺀다. 빈 말은 남기지 않는다", () => {
    const [long] = ws().heard("가".repeat(300), 0);
    expect(long!.text).toBe(`사람이 말함: 「${"가".repeat(200)}」`);
    expect(ws().heard("첫 줄\n둘째 「줄」\r\n끝", 0)[0]!.text).toBe("사람이 말함: 「첫 줄 둘째 줄 끝」");
    expect(ws().heard("  \n ", 0)).toEqual([]);
  });
  it("기록에 남길 글에서는 들은 말 줄을 내용 없는 표시로 바꾸고, 그 말이 그대로 든 다른 글에서도 뺀다", () => {
    const text = "12:00:00 사람 보임\n12:00:03 사람이 말함: 「라면 끓이는 법 알려 줘」\n[지속] 사람 보임";
    expect(redactHeard(text)).toBe("12:00:00 사람 보임\n12:00:03 들은 말 있음\n[지속] 사람 보임");
    expect(saidIn(text)).toEqual(["라면 끓이는 법 알려 줘"]);
    expect(redactSaid("사용자가 라면 끓이는 법 알려 줘 라고 말함", saidIn(text))).toBe("사용자가 들은 말 라고 말함");
    expect(redactHeard("12:00:00 사람 보임")).toBe("12:00:00 사람 보임");
  });
});

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
    // 같은 원본 프레임의 답은 두 번 세지 않는다. 다른 프레임의 같은 값이어야 confirmed
    w.applyScene("e3", 3000, { scene: "kitchen", observations: [{ object_id: "d1", state: "empty" }], summary: "s" }, ids);
    expect(w.view(3000).objects[0]!.facts.contents).toMatchObject({ value: "empty", certainty: "inferred" });
    w.applyScene("e4", 4000, { scene: "kitchen", observations: [{ object_id: "d1", state: "empty" }, { object_id: "d1", state: "on_table" }], summary: "s" }, ids);
    expect(w.view(4000).objects[0]!.facts).toMatchObject({ contents: { certainty: "confirmed" }, place: { value: "on_table" } });
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
    for (let i = 4; i <= 6; i++) expect(w.applyMissing(`e${i}`, i * 1000, { yolo: "error" })[0]).toMatchObject({ kind: "yolo_missing", text: "감지 오류로 YOLO 분석 없음" });
    expect(w.applyMissing("e7", 7000, { yolo: "cap", vlm: "cap" })[0]).toMatchObject({ kind: "yolo_missing", text: "요청이 몰려 YOLO·VLM 분석 없음" });
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
    const w = new WorldState({ evidenceStepMs: 1000, surfaces: () => [{ id: "table_1", label: "식탁", center: [0.75, 0], top: 0.75, radius: 0.6 }], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices });
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
    expect(w.view(3000).person.facts.holding?.value).toBe("holding_object");
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
    const w = new WorldState({ evidenceStepMs: 1000, surfaces: () => [{ id: "table_1", label: "식탁", center: [0.75, 0], top: 0.75, radius: 0.6 }], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices });
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

// 관절(YOLO26-pose)로 본 사실: 손목이 컵 상자 안·가까이면 컵 「손에 있음」과 사람 「물건을 들고 있음」, 관절로 서 있음·앉아 있음·누워 있음.
// 같은 프레임에서는 관절 사실이 VLM 답보다 앞선다. 손목이 떨어지면 관절이 붙인 「손에 있음」만 지운다.
describe("World State: 프레임 간격과 상관없는 시간 규칙(기본 2초 한 장)", () => {
  const table = () => [{ id: "table_1", label: "식탁", center: [0.75, 0] as [number, number], top: 0.75, radius: 0.6 }];
  const real = () => new WorldState({ surfaces: table, floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices });
  const at = (t: number, view: CameraView | null = null): EngineFrame => ({ ...frame(0), id: `t${t}`, capturedAtMs: t, latestAtMs: t, view });
  /** 장면(촬영 시각 → 카메라·감지)을 stepMs 간격으로 넣고 난 변화를 [종류, 대상, 시각]으로 모은다. */
  const run = (stepMs: number, endMs: number, scene: (t: number) => { view?: CameraView; dets: Detection[]; poses?: ReturnType<typeof standing>[] }) => {
    const w = real();
    const out: [string, string | undefined, number][] = [];
    for (let t = 0; t <= endMs; t += stepMs) {
      const s = scene(t);
      out.push(...w.applyDetections(at(t, s.view ?? null), s.dets, s.poses).changes.map((c): [string, string | undefined, number] => [c.kind, c.subject, c.at_ms]));
    }
    return { w, out };
  };

  it("같은 장면을 2000ms 간격과 100ms 간격으로 넣으면 같은 촬영 시각에 같은 사건이 난다(등장·사라짐·시야 밖·다시 보임·사람)", () => {
    // 컵: 0~8초 보임, 10초부터 16초 전까지 카메라가 반대쪽, 16~20초 다시 보임, 그 뒤 안 보임. 사람: 2~6초 보임
    const scene = (t: number) => {
      const turned = t >= 10_000 && t < 16_000;
      const cupSeen = t <= 8000 || (t >= 16_000 && t <= 20_000);
      return { view: turned ? away : look, dets: [...(cupSeen ? [cup] : []), ...(t >= 2000 && t <= 6000 ? [person] : [])] };
    };
    const want = [
      ["appeared", "cup_1", 4000], ["person_appeared", "person", 4000], ["person_gone", "person", 10_000], ["out_of_view", "cup_1", 10_000],
      ["back_in_view", "cup_1", 16_000], ["gone", "cup_1", 26_000],
    ];
    const kinds = (r: ReturnType<typeof run>) => r.out.filter(([k]) => k !== "person_room");
    expect(kinds(run(2000, 30_000, scene))).toEqual(want);
    expect(kinds(run(100, 30_000, scene))).toEqual(want);
  });

  it("100ms 간격: 세는 중인 물건을 한두 장 놓쳐도 잊지 않고, 500ms 넘게 못 보면 잊는다", () => {
    const kept = run(100, 4000, (t) => ({ dets: t === 1000 || t === 1100 ? [] : [cup] }));
    expect(kept.w.view(4000).objects.map((o) => [o.id, o.first_seen_ms])).toEqual([["cup_1", 0]]);
    const lost = run(100, 6000, (t) => ({ dets: t >= 1000 && t <= 1500 ? [] : [cup] }));
    expect(lost.out).toEqual([["appeared", "cup_2", 5600]]);
    expect(lost.w.view(6000).objects.map((o) => [o.id, o.first_seen_ms])).toEqual([["cup_2", 1600]]);
  });

  it("관절이 붙인 사실은 같은 값이 2초 이어져야 confirmed다(100ms 두 장으로 오르지 않는다)", () => {
    const grip = standing({ 10: [230, 170, 0.9] }), apart = standing({ 10: [120, 230, 0.9] });
    // 4초부터 손목이 컵 상자 안
    const scene = (t: number) => ({ dets: [person, cup], poses: [t >= 4000 ? grip : apart] });
    for (const [step, ends] of [[2000, [4000]], [100, [4000, 4100, 5900]]] as const) {
      for (const end of ends) {
        const v = run(step, end, scene).w.view(end);
        expect(v.objects[0]!.facts.place, String(step) + "ms " + end).toMatchObject({ value: "in_hand", certainty: "inferred", since_ms: 4000 });
        expect(v.person.facts.holding, String(step) + "ms " + end).toMatchObject({ value: "holding_object", certainty: "inferred" });
      }
      const v = run(step, 6000, scene).w.view(6000);
      expect(v.objects[0]!.facts.place, String(step) + "ms").toMatchObject({ value: "in_hand", certainty: "confirmed", since_ms: 4000 });
      expect(v.person.facts.holding, String(step) + "ms").toMatchObject({ certainty: "confirmed", since_ms: 4000 });
    }
  });
});

describe("World State: 트윈 자리는 마스크 바닥 점(foot)의 광선", () => {
  const table = () => [{ id: "table_1", label: "식탁", center: [0.75, 0] as [number, number], top: 0.75, radius: 0.6 }];
  const real = () => new WorldState({ surfaces: table, floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices });
  const size = { width: 480, height: 360 };
  // 손이 컵 아래를 가려 상자 아랫변이 20px 아래로 늘어난 감지. 마스크 바닥 점은 컵 바닥 그대로다
  const covered: Detection = { ...det("cup", 0.9, [220, 160, 40, 40]), foot: [240, 180] };
  const byFoot = placePoint(look, [240, 180], size, table(), () => 0).position!;
  const byBox = placeBox(look, covered.box, size, table(), () => 0).position!;

  it("고정 값: 바닥 점 자리는 식탁 위 (0.75, 0.75, 0)이고 상자 아래 가운데 자리와 0.1m 넘게 다르다", () => {
    expect(byFoot[0]).toBeCloseTo(0.75, 2);
    expect(byFoot[1]).toBeCloseTo(0.75, 2);
    expect(Math.hypot(byFoot[0] - byBox[0], byFoot[2] - byBox[2])).toBeGreaterThan(0.1);
  });

  it("전체 사진(applyDetections): 물건 자리는 foot 광선의 자리다", () => {
    const w = real();
    for (const t of [0, 2000, 4000]) w.applyDetections({ ...frame(0), id: `t${t}`, capturedAtMs: t, latestAtMs: t, view: look }, [covered]);
    const o = w.view(4000).objects[0]!;
    expect(o.position).toEqual(byFoot);
    expect(o.surface).toBe("table_1");
  });

  it("가까이 보기(applyCloser): 물건 자리는 foot 광선의 자리다", () => {
    const w = real();
    const passes = [0, 2000, 4000].map((t) => ({ frameId: `t${t}`, capturedAtMs: t, view: look, ...size, dets: [{ ...covered, edge: false }] }));
    w.applyCloser(passes);
    const o = w.view(4000).objects[0]!;
    expect(o.position).toEqual(byFoot);
    expect(o.surface).toBe("table_1");
  });
});

describe("World State + 관절", () => {
  const grip = standing({ 10: [230, 170, 0.9] }); // 오른 손목이 컵 상자 [220, 160, 40, 20] 안
  const apart = standing({ 10: [120, 230, 0.9] }); // 손목이 컵에서 멀다
  it("손목이 컵 상자 안이면 컵 손에 있음·사람 물건을 들고 있음·서 있음, 변화 글은 등장 다음에", () => {
    const w = ws();
    let changes: ReturnType<WorldState["applyDetections"]>["changes"] = [];
    for (let i = 1; i <= 3; i++) changes = w.applyDetections(frame(i), [person, cup], [grip]).changes;
    expect(changes.map((c) => [c.kind, c.text, c.meaningful])).toEqual([
      ["appeared", "컵 cup_1 보임", true],
    ]);
    const v = w.view(3000);
    expect(v.objects[0]!.facts.place).toMatchObject({ value: "in_hand", certainty: "confirmed" });
    expect(v.person.facts).toMatchObject({ holding: { value: "holding_object" }, posture: { value: "standing" } });
    // 사람은 2장째에 보임이 되고, 그때 사람 사실이 변화로 나간다
    const w2 = ws();
    w2.applyDetections(frame(1), [person, cup], [grip]);
    expect(w2.applyDetections(frame(2), [person, cup], [grip]).changes.map((c) => c.text)).toEqual(["사람 보임"]);
    const w3 = ws();
    w3.applyDetections(frame(1), [person, cup], [apart]);
    w3.applyDetections(frame(2), [person, cup], [apart]);
    expect(w3.applyDetections(frame(3), [person, cup], [grip]).changes.map((c) => c.text)).toEqual(["컵 cup_1 보임", "컵 cup_1 손에 있음", "사람 물건을 들고 있음"]);
  });

  it("같은 프레임 VLM 답이 식탁 위·앉아 있음이라 해도 관절 사실이 남고, 들고 있음도 지우지 않는다. 다음 프레임 VLM 답은 그대로 받는다", () => {
    const w = ws();
    let ids = new Map<string, string>();
    for (let i = 1; i <= 3; i++) ids = w.applyDetections(frame(i), [person, cup], [grip]).ids;
    w.applyScene("e3", 3000, { scene: "k", observations: [{ object_id: "d2", state: "on_table" }, { object_id: "d1", state: "sitting" }, { object_id: "d2", state: "empty" }], summary: "s" }, ids);
    let v = w.view(3000);
    expect(v.objects[0]!.facts).toMatchObject({ place: { value: "in_hand" }, contents: { value: "empty" } });
    expect(v.person.facts).toMatchObject({ holding: { value: "holding_object" }, posture: { value: "standing" } });
    // 관절이 없는 프레임(사람 상자만): VLM 답이 그대로 들어간다
    ids = w.applyDetections(frame(4), [person, cup]).ids;
    w.applyScene("e4", 4000, { scene: "k", observations: [{ object_id: "d2", state: "on_table" }, { object_id: "d1", state: "sitting" }], summary: "s" }, ids);
    v = w.view(4000);
    expect(v.objects[0]!.facts.place?.value).toBe("on_table");
    expect(v.person.facts.posture?.value).toBe("sitting");
    expect(v.person.facts.holding).toBeUndefined();
  });

  it("손목이 컵에서 떨어지면 관절이 붙인 손에 있음·들고 있음을 지우고, VLM이 붙인 손에 있음은 두며, 사람이 안 보이게 되면 관절의 손에 있음도 지운다", () => {
    const w = ws();
    let ids = new Map<string, string>();
    for (let i = 1; i <= 3; i++) w.applyDetections(frame(i), [person, cup], [grip]);
    w.applyDetections(frame(4), [person, cup], [apart]);
    let v = w.view(4000);
    expect(v.objects[0]!.facts.place).toBeUndefined();
    expect(v.person.facts.holding).toBeUndefined();
    ids = w.applyDetections(frame(5), [person, cup], [apart]).ids;
    w.applyScene("e5", 5000, { scene: "k", observations: [{ object_id: "d2", state: "in_hand" }], summary: "s" }, ids);
    w.applyDetections(frame(6), [person, cup], [apart]);
    expect(w.view(6000).objects[0]!.facts.place?.value).toBe("in_hand"); // VLM 사실은 관절이 지우지 않는다
    w.applyDetections(frame(7), [person, cup], [grip]);
    for (let i = 8; i <= 9; i++) w.applyDetections(frame(i), [cup]);
    v = w.view(9000);
    expect(v.person.visible).toBe(false);
    expect(v.objects[0]!.facts.place).toBeUndefined();
  });

  it("자세는 가장 확실한 한 사람으로, 손에 듦은 모든 관절의 손목으로 본다(팔 조각의 손목이 컵 상자 안)", () => {
    const w = ws();
    const arm = poseOf({ 10: [235, 170, 0.6] }, [200, 120, 150, 60], 0.3);
    for (let i = 1; i <= 3; i++) w.applyDetections(frame(i), [person, cup], [apart, arm]);
    const v = w.view(3000);
    expect(v.objects[0]!.facts.place?.value).toBe("in_hand");
    expect(v.person.facts).toMatchObject({ holding: { value: "holding_object" }, posture: { value: "standing" } });
  });

  it("관절로 앉아 있음·누워 있음, 다리가 가려 모르면 자세를 바꾸지 않는다", () => {
    const w = ws();
    const sit = poseOf({ 5: [110, 100, 0.9], 6: [150, 100, 0.9], 11: [115, 200, 0.9], 12: [145, 200, 0.9], 13: [190, 215, 0.9], 14: [210, 215, 0.9] });
    const hidden = poseOf({ 5: [110, 100, 0.9], 6: [150, 100, 0.9], 11: [115, 200, 0.9], 12: [145, 200, 0.9] });
    const lie = poseOf({ 5: [100, 100, 0.9], 6: [100, 120, 0.9], 11: [200, 115, 0.9], 12: [200, 135, 0.9] });
    w.applyDetections(frame(1), [person], [sit]);
    expect(w.applyDetections(frame(2), [person], [sit]).changes.map((c) => c.text)).toEqual(["사람 보임"]);
    expect(w.view(2000).person.facts.posture).toMatchObject({ value: "sitting", certainty: "confirmed" });
    expect(w.applyDetections(frame(3), [person], [hidden]).changes).toEqual([]);
    expect(w.applyDetections(frame(4), [person], [lie]).changes.map((c) => [c.kind, c.text, c.meaningful])).toEqual([["person_state", "사람 누워 있음", false]]);
  });
});
