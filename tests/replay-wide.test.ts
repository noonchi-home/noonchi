// 실제 판 재생: 기록 DB(vlm 이벤트)의 장면·가까이 본 VLM 답 원문·그 사진의 카메라·YOLO 감지를 도착 순서로 World State에 넣는다(사진은 넣지 않는다).
// 고정 자료: tests/fixtures/replay/<판>.json
// - 2026-11-18 06:15~06:29 가로 유리컵 r10·가로 키 큰 컵 r4·가로 머그 r7(0af95a1). 가까이 본 답 원문이 없다.
// - 2026-11-18 07:00~07:04 가로 키 큰 컵 r5·가로 머그 r8(b8fe7bf 전 코드). 가까이 본 답(잘라 본 칸은 look 이벤트의 crop)도 넣는다.
// 트윈 면은 한양목련(mokryeon_180b) 배치 그대로다(실제 판과 같은 집, 저장한 배치 수정본 없음).
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CameraView, Detection, SceneObservation } from "../src/contract/observe.js";
import type { WorldObject } from "../src/contract/world.js";
import { floorLookup, readScenePlan } from "../src/layout/home-plan.js";
import { resolveHome } from "../src/layout/homes.js";
import { loadLayout } from "../src/layout/load.js";
import { DEFAULT_TWIN_DIR } from "../src/layout/twin-files.js";
import { linkDets } from "../src/observe/pipeline.js";
import { surfaceSource } from "../src/server/home/observe.js";
import { WorldState } from "../src/world/state/world.js";
import type { DetLabel } from "../src/world/vocab.js";
import { det } from "./helpers/detectors.js";

interface Step {
  frame: string; at: number; size: [number, number]; view: CameraView; dets: { id: string; class: string; box: [number, number, number, number]; score: number }[]; scene: SceneObservation;
  /** 가까이 본 답이면 잘라 본 칸(엔진 프레임 픽셀). dets는 잘라 키운(2배) 사진 픽셀이다. */
  crop?: [number, number, number, number];
}

const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
const layout = loadLayout(home, { runtimeDir: mkdtempSync(join(tmpdir(), "replay-")), log: () => {} })!;
const twinSurfaces = surfaceSource(layout.editor);
const plan = readScenePlan(home.scenePath);
const floorAt = floorLookup(plan.rooms);

/** 한 판을 재생하고 마시는 그릇 id(사라진 것 포함)와 물건별 놓인 곳 값을 돌려준다. twin이면 한양목련 트윈 면을 쓴다. */
const TABLE = "dining_table_978b20c7";
const TABLE_CENTER: [number, number] = [9.9612, 3.9242];
const fromTable = (p: readonly number[]) => Math.hypot(p[0]! - TABLE_CENTER[0], p[2]! - TABLE_CENTER[1]);

/** 그 판 실행 추적의 집기·들고 가기·내려놓기 단계(첫 VLM 촬영부터 ms, 이벤트 기록의 단계 시작 시각). 대상은 집기 시작 때 식탁 가운데에서 가장 가까운 확인된 컵이고,
 *  내려놓기 자리는 목적지(싱크볼 가운데)다. */
export interface ReplayPlan { steps: { at: number; step: "pick" | "carry" | "place"; spot?: [number, number] }[] }

export function replay(name: string, twin = true, trace?: (step: string, w: WorldState, at: number) => void, plan?: ReplayPlan) {
  const steps = JSON.parse(readFileSync(new URL(`./fixtures/replay/${name}.json`, import.meta.url), "utf-8")) as Step[];
  const w = new WorldState({ evidenceStepMs: 1000, surfaces: twin ? twinSurfaces : () => [], floorAt: twin ? floorAt : () => 0, roomAt: () => null, devices: () => [] });
  const places = new Set<string>();
  const todo = [...(plan?.steps ?? [])];
  let target: string | null = null;
  for (const s of steps) {
    const at = s.at + 1000;
    while (todo.length && todo[0]!.at + 1000 <= at) {
      const p = todo.shift()!;
      const objects = w.view(at).objects.filter((o) => o.status !== "gone" && (o.cls === "cup" || o.cls === "bottle") && o.position);
      if (p.step === "pick") target = objects.sort((a, b) => fromTable(a.position!) - fromTable(b.position!))[0]?.id ?? null;
      const now: WorldObject | undefined = target ? w.view(at).objects.find((o) => o.id === target) : undefined;
      target = now?.status === "gone" && now.followed_by ? now.followed_by : target;
      const spot: [number, number] | null = p.step === "pick" ? (now?.position ? [now.position[0], now.position[2]] : null) : p.spot ?? null;
      if (target) w.focus(target, { step: p.step, spot });
    }
    const eye = { position: [s.view.origin[0], s.view.origin[2]] as [number, number], height_m: s.view.origin[1], yaw_deg: 0, pitch_deg: 0 };
    if (s.crop) {
      // 가까이 본 답: 잘라 키운 사진의 감지를 엔진 프레임 픽셀로 옮겨 묶고, 그 장의 VLM 답으로 넣는다(원본 프레임 id는 「.c」 앞)
      const [cx, cy, cw, ch] = s.crop;
      const k = cw / s.size[0];
      const source = s.frame.split(".")[0]!;
      const dets = s.dets.map((d) => ({ ...det(d.class as DetLabel, d.score, [cx + d.box[0] * k, cy + d.box[1] * k, d.box[2] * k, d.box[3] * k], 0), edge: false }));
      const r = w.applyCloser([{ frameId: source, capturedAtMs: at, view: s.view, width: s.size[0], height: s.size[1], dets }]);
      w.applyCloserScene(source, at, s.scene, r.ids, r.pending, { view: s.view, width: s.size[0], height: s.size[1], crop: s.crop });
    } else {
      const frame = { id: s.frame, capturedAtMs: at, latestAtMs: at, jpeg: Buffer.alloc(0), sha256: s.frame, width: s.size[0], height: s.size[1], eye, view: s.view, vlm: true };
      const dets: Detection[] = s.dets.map((d) => det(d.class as DetLabel, d.score, d.box, 0));
      const { ids } = w.applyDetections(frame, dets);
      const scene = linkDets(s.scene, s.dets, s.size[0], s.size[1]);
      // 관찰 흐름처럼 그 사진의 YOLO 감지(바닥 점 = 상자 아랫변 가운데)를 함께 넘긴다: 감지와 이은 VLM 물건은 그 바닥 점이 자리다
      w.applyScene(s.frame, at, scene, ids, { view: s.view, width: s.size[0], height: s.size[1], eye: eye.position, dets: dets.map((d, i) => ({ id: s.dets[i]!.id, box: d.box, foot: d.foot })) });
    }
    for (const o of w.view(at).objects) if (o.facts.place) places.add(`${o.id}:${o.facts.place.value}`);
    trace?.(s.frame, w, at);
  }
  const end = (steps.at(-1)?.at ?? 0) + 1000;
  const cups = w.view(end).objects.filter((o) => o.cls === "cup" || o.cls === "bottle");
  return { cups: cups.map((o) => o.id), places: [...places], world: w.view(end), target };
}


// 마시는 그릇 id 수(사라진 것 포함)가 아래보다 늘지 않는다. r10·r4·r7은 0af95a1 글(「비율, 픽셀 아님」)로 받은 답이라 선반 장식(트로피 모양 잔 등)도 컵으로 답했고,
// 키 큰 컵 v1·r5는 VLM이 「유리잔과 밝은 색 컵」처럼 식탁 위 컵을 둘 이상 답한다.
describe("실제 판 재생(장면·가까이 본 VLM 답 + 카메라 + YOLO 감지 + 한양목련 트윈 면)", () => {
  const limit: Record<string, number> = {
    "wide-glass-r10": 4, "wide-tall-r4": 2, "wide-mug-r7": 3, "wide-tall-r5": 2, "wide-mug-r8": 2, "wide-glass-v1": 1, "wide-tall-v1": 3, "wide-mug-v1": 2,
    "wide-tall-q1": 4, "wide-mug-q1": 2, "wide-tall-q2": 3, "wide-mug-q2": 1, "wide-tall-m1": 2, "wide-glass-c1": 1, "wide-tall-c1": 3, "wide-mug-c1": 2,
  };
  for (const name of Object.keys(limit)) {
    it(`${name}: 마시는 그릇 id가 ${limit[name]}개를 넘지 않는다`, () => {
      const r = replay(name);
      expect(r.cups.length, JSON.stringify({ cups: r.cups, places: r.places })).toBeLessThanOrEqual(limit[name]!);
    });
  }

  // b8fe7bf 실제 판 v1(2026-11-18 08:30~08:37): 트윈 면에 바닥 크기가 없어 식탁이 반지름 0.4m 원이었고, 식탁 위 컵 상자 광선이 식탁을 지나쳐 후면 발코니 바닥에 닿았다
  it("가로 유리컵 v1: 식탁 위 잔 하나는 처음부터 끝까지 한 id이고, 식탁 위(가운데에서 0.2m 안)·「식탁 위」다", () => {
    const r = replay("wide-glass-v1");
    expect(r.cups).toHaveLength(1);
    const cup = r.world.objects.find((o) => o.id === r.cups[0])!;
    expect(cup).toMatchObject({ surface: TABLE, facts: { place: { value: "on_table" } } });
    expect(fromTable(cup.position!)).toBeLessThan(0.2);
  });

  // 0371f2a 실제 판 q1(2026-11-18 09:36~09:44): 키 큰 컵 q1은 후면 발코니 유령 cup_4를 계획 대상으로 잡아 「세탁기로 가 주세요」를 보냈고, 식탁 위 cup_3·머그 cup_2는 「선반 위」였다
  it("처음 고정 카메라로 본 컵은 모두 식탁 위에 있다(가운데에서 0.9m 안, 후면 발코니 바닥으로 가지 않는다): 키 큰 컵 v1·r5·q1, 머그 r8·q1", () => {
    for (const name of ["wide-tall-v1", "wide-tall-r5", "wide-mug-r8", "wide-tall-q1", "wide-mug-q1"]) {
      const steps = JSON.parse(readFileSync(new URL(`./fixtures/replay/${name}.json`, import.meta.url), "utf-8")) as Step[];
      const first = steps[0]!.view.origin;
      // 폰 눈이 처음 자리에서 0.3m 넘게 움직인 사진부터는 보지 않는다(싱크대로 가는 단계 영상)
      const moved = steps.findIndex((x) => Math.hypot(x.view.origin[0] - first[0], x.view.origin[2] - first[2]) > 0.3);
      const until = moved < 0 ? Number.POSITIVE_INFINITY : steps[moved]!.at + 1000;
      let last = 0;
      replay(name, true, (_step, w, at) => {
        if (at >= until) return;
        const v = w.view(at);
        for (const o of v.objects) {
          if (!o.position || (o.cls !== "cup" && o.cls !== "bottle")) continue;
          expect(fromTable(o.position), `${name} ${o.id} ${at}`).toBeLessThan(0.9);
          expect(o.surface, `${name} ${o.id} ${at}`).toBe(TABLE);
          if (o.facts.place) expect(o.facts.place.value, `${name} ${o.id} ${at}`).not.toBe("on_shelf");
        }
        last = at;
      });
      expect(last).toBeGreaterThan(0);
    }
  });

  // 가로 키 큰 컵 r5(item 7): 식탁 끝 가까이 컵을 VLM이 「선반 위」(장면·가까이 본 답)로 답해 그대로 남았다
  it("키 큰 컵 r5: 식탁 위 컵의 놓인 곳은 「식탁 위」다(VLM의 「선반 위」를 트윈 면으로 바꾼다)", () => {
    const r = replay("wide-tall-r5");
    for (const id of r.cups) expect(r.world.objects.find((o) => o.id === id)!.facts.place?.value, id).toBe("on_table");
  });

  // 5bdff18 실제 판 q2(2026-11-18 09:51~09:56). 머그 q2: 한 머그를 VLM이 큰 상자와 그 안 작은 상자로 답해 같은 식탁에 cup_1·cup_2가 따로 확정됐고(가까이 보기가
  // 후보를 확정), cup_1이 사라짐이 돼 계획이 「찾은 뒤 다시 판단」으로 취소됐다. 키 큰 컵 q2: 싱크볼 바닥 컵 광선이 싱크대 너머 바닥에 닿아 내려놓기 대상과 잇지
  // 못했고(새 cup_3), 싱크대 위 컵이 VLM 말 그대로 「식탁 위」라 내려놓기가 끝나지 않았다
  it("머그 q2: 식탁 위 머그는 처음부터 끝까지 한 id이고 사라지지 않는다", () => {
    const r = replay("wide-mug-q2");
    expect(r.cups).toEqual(["cup_1"]);
    expect(r.world.objects.find((o) => o.id === "cup_1")).toMatchObject({ status: "present", surface: TABLE });
  });

  it("키 큰 컵 q2(그 판 단계 시각): 집은 컵은 싱크대에서 새 id 없이 그 id로 이어지고, 싱크볼 안(싱크볼 가운데에서 0.2m 안)·「싱크대 안」이 된다", () => {
    const SINK = "sink_counter_kitchen", BASIN: [number, number] = [5.86, 0.693];
    const plan: ReplayPlan = { steps: [{ at: 33613, step: "pick" }, { at: 56392, step: "carry" }, { at: 69818, step: "place", spot: BASIN }] };
    let inSink: number | null = null;
    const r = replay("wide-tall-q2", true, (_s, w, at) => {
      if (inSink === null && w.view(at).objects.some((o) => o.facts.place?.value === "in_sink")) inSink = at;
    }, plan);
    const t = r.world.objects.find((o) => o.id === r.target)!;
    expect(t).toMatchObject({ status: "present", surface: SINK, facts: { place: { value: "in_sink" } } });
    expect(Math.hypot(t.position![0] - BASIN[0], t.position![2] - BASIN[1])).toBeLessThan(0.2);
    // 싱크대 쪽(목적지 1.5m 안)에는 대상 말고 다른 마시는 그릇 id가 없다
    const near = r.world.objects.filter((o) => o.id !== r.target && o.position && Math.hypot(o.position[0] - BASIN[0], o.position[2] - BASIN[1]) < 1.5);
    expect(near).toEqual([]);
    // 「싱크대 안」은 내려놓기 시작 뒤 20초 안이다(그 판은 끝나지 않았다)
    expect(inSink).not.toBeNull();
    expect(inSink! - (69818 + 1000)).toBeLessThan(20000);
  });

  // 813f5ca 실제 판 m1(2026-11-18 14:28): VLM이 키 큰 유리잔을 처음 두 장(14.3·16.7초 사진) 병으로 답해 bottle_1이 됐다
  it("키 큰 컵 m1: 처음 병으로 생긴 식탁 위 유리잔은 이어진 컵 답 두 장으로 컵이 되고(id는 bottle_1 그대로), 식탁 위에 있다", () => {
    let cupAt: number | null = null;
    const r = replay("wide-tall-m1", true, (_s, w, at) => {
      if (cupAt === null && w.view(at).objects.find((o) => o.id === "bottle_1")?.cls === "cup") cupAt = at;
    });
    expect(cupAt).toBe(20762 + 1000);
    expect(r.world.objects.find((o) => o.id === "bottle_1")).toMatchObject({ cls: "cup", surface: TABLE, status: "present" });
  });

  // 7541d94 실제 판 c1(2026-11-18 15:26~15:34): 유리잔 c1·키 큰 컵 c1에서 VLM이 식탁 위 유리잔을 한 장 「병」으로 답해 그 후보가 다음 「컵」 답으로 bottle_1로 확정됐고,
  // 유리잔 c1은 컵 치우기가 「대상 물건이 보이지 않아」로 실패했다
  it("유리잔·키 큰 컵·머그 c1: 마시는 그릇은 병 id 없이 처음부터 컵(cup_n)이고, 유리잔 c1의 식탁 위 잔은 13.3초 사진에서 한 id로 나타난다", () => {
    for (const name of ["wide-glass-c1", "wide-tall-c1", "wide-mug-c1"]) {
      const ids = new Set<string>();
      replay(name, true, (_s, w, at) => { for (const o of w.view(at).objects) ids.add(`${o.id}/${o.cls}`); });
      expect([...ids].filter((x) => x.startsWith("bottle_")), name).toEqual([]);
    }
    let first: number | null = null;
    const r = replay("wide-glass-c1", true, (_s, w, at) => { if (first === null && w.view(at).objects.length) first = at; });
    expect(first).toBe(12250 + 1000);
    expect(r.world.objects).toEqual([expect.objectContaining({ cls: "cup", surface: TABLE, status: "present" })]);
    expect(r.world.objects[0]!.id).toMatch(/^cup_\d+$/);
  });
});

