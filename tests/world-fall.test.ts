// 쓰러짐 의심(11-16 회의 안전 계층 「자세 변화로 낙상 의심」): 관절 자세가 서 있음에서 짧은 시간(FALL_DROP_MS) 안에 바닥에 누운 자세(중력 기준으로 몸통·허벅지 모두 누움)가 되고
// 이어 본 그 자세가 FALL_HOLD_MS 이어지면 World State에 사람 자세 「쓰러짐 의심」 사실과 변화 줄을 남긴다. 천천히 눕기·소파에 앉기·허리 숙이기는 신호가 나지 않는다.
// 기울기는 엔진 프레임 카메라 자세로 중력 방향을 잡아 잰다(맞추기 전·거의 바로 아래를 보면 보류). 확인된 침대·소파(트윈 가구) 위에 누운 것은 쓰러짐이 아니다.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CameraView, Detection, EngineFrame, Pose } from "../src/contract/observe.js";
import type { WorldChange } from "../src/contract/world.js";
import { sayLine } from "../src/act/say.js";
import { SAY_TEXT } from "../src/act/labels.js";
import { sha256 } from "../src/observe/ring.js";
import { SCENE_JSON_SCHEMA, SCENE_PROMPT } from "../src/observe/scene.js";
import { FALL_DEFAULTS, fallPose, loadFallConfig, type FallConfig } from "../src/world/fall.js";
import { describePose } from "../src/world/pose.js";
import { pixelOf, restsFromLayout, type RestSpot } from "../src/world/place.js";
import { WorldState } from "../src/world/state.js";
import { textFromWorld } from "../src/world/text.js";
import { SCENE_STATES } from "../src/world/vocab.js";
import { resolveHome } from "../src/layout/homes.js";
import { loadLayout } from "../src/layout/load.js";
import { DEFAULT_TWIN_DIR } from "../src/layout/twin-files.js";
import { restSource } from "../src/server/home.js";
import { LOOK_VIEW } from "./helpers/camera.js";
import { det } from "./helpers/detectors.js";
import { poseOf } from "./helpers/poses.js";

// 사진 480×360, 카메라는 트윈 (0, 1.5, 0)에서 45° 아래로 숙여 +x를 본다(LOOK_VIEW). 관절은 사진 가운데 세로줄 가까이에 둔다(원근 기울기가 작다)
const person: Detection = det("person", 0.9, [40, 60, 400, 290], 0);
const standing = (): Pose => poseOf({ 5: [220, 100, 0.9], 6: [260, 100, 0.9], 11: [225, 200, 0.9], 12: [255, 200, 0.9], 13: [225, 280, 0.9], 14: [255, 280, 0.9] }, [200, 70, 80, 250]);
/** 앉은 사람: 몸통은 서고 허벅지가 수평(엉덩이 y200 → 무릎 y205). */
const sitting = (): Pose => poseOf({ 5: [220, 100, 0.9], 6: [260, 100, 0.9], 11: [225, 200, 0.9], 12: [255, 200, 0.9], 13: [305, 205, 0.9], 14: [335, 205, 0.9] }, [200, 70, 150, 160]);
/** 바닥에 누운 사람: 어깨·엉덩이·무릎이 한 줄로 가로(몸통·허벅지 모두 수평), 상자도 가로로 길다. */
const flat = (): Pose => poseOf({ 5: [140, 250, 0.9], 6: [140, 280, 0.9], 11: [240, 255, 0.9], 12: [240, 285, 0.9], 13: [320, 258, 0.9], 14: [320, 288, 0.9] }, [120, 230, 220, 80]);
/** 허리 숙이기: 몸통은 수평이지만 허벅지는 서 있다(엉덩이 y205 → 무릎 y285). */
const bending = (): Pose => poseOf({ 5: [150, 190, 0.9], 6: [150, 210, 0.9], 11: [240, 195, 0.9], 12: [240, 215, 0.9], 13: [240, 285, 0.9], 14: [242, 285, 0.9] }, [130, 150, 130, 200]);
/** 물건을 주우며 숙였는데 무릎이 사진 아래로 잘림: 몸통은 수평, 무릎 없음, 상자는 가로로 길고 사진 아래 끝에 닿는다. */
const bendingCut = (): Pose => poseOf({ 5: [150, 250, 0.9], 6: [150, 270, 0.9], 11: [240, 255, 0.9], 12: [240, 275, 0.9] }, [130, 200, 220, 160]);

const mul = (a: number[], b: number[]) => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!, a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
/** LOOK_VIEW를 보는 축으로 90° 돌린 카메라(폰을 옆으로 눕혀 든 것): 서 있는 사람이 사진에서 가로로 비친다. */
const ROLLED: CameraView = { ...LOOK_VIEW, orientation: mul(LOOK_VIEW.orientation, [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)]) as CameraView["orientation"] };

const ws = (o: { fall?: FallConfig; rests?: RestSpot[] | (() => RestSpot[]) } = {}) => new WorldState({
  evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "living", label: "거실" }), devices: () => [],
  ...(o.fall ? { fall: o.fall } : {}), ...(o.rests ? { rests: typeof o.rests === "function" ? o.rests : () => o.rests as RestSpot[] } : {}),
});
const frame = (t: number, view: CameraView | null = LOOK_VIEW): EngineFrame => ({ id: `e${t}`, capturedAtMs: t, latestAtMs: t, jpeg: Buffer.from(`${t}`), sha256: sha256(Buffer.from(`${t}`)), width: 480, height: 360, eye: null, view });
/** 관절은 0.3초마다(엔진 프레임 0.1초 × BRAIN_POSE_EVERY 3). from부터 to까지 그 자세로 보고 나온 변화를 모은다. */
const run = (w: WorldState, from: number, to: number, pose: () => Pose, out: WorldChange[] = [], view: CameraView | null = LOOK_VIEW) => {
  for (let t = from; t <= to; t += 300) out.push(...w.applyDetections(frame(t, view), [person], [pose()]).changes);
  return out;
};
const posture = (w: WorldState, t: number) => w.view(t).person.facts.posture?.value;
const FALL_LINE = "사람 쓰러짐 의심";
/** 사진 아래 방향이 곧 중력인 카메라(LOOK_VIEW 가운데 세로줄). */
const DOWN = () => [0, 1] as [number, number];

describe("쓰러짐 의심: 관절 자세 변화", () => {
  it("중력 기준 자세: 바닥에 누운 자세는 몸통과 허벅지가 다 누운 것이다(허리 숙이기는 허벅지가 서 있어 아니다). 무릎이 안 보이면 잘리지 않은 상자가 가로로 길 때만이다", () => {
    const at = (p: Pose, size = { width: 480, height: 360 }) => fallPose(describePose(p, DOWN).lean ?? null, p.box, size, FALL_DEFAULTS);
    expect(at(flat())).toBe("flat");
    expect(at(standing())).toBe("standing");
    expect(at(sitting())).toBe("sitting");
    expect(at(bending())).toBeNull();
    expect(at(bendingCut())).toBeNull();
    // 같은 몸이 사진 안에 다 들어오면(잘리지 않음) 상자로 본다
    expect(at(bendingCut(), { width: 480, height: 480 })).toBe("flat");
    // 중력 방향을 모르면 보류
    expect(fallPose(describePose(flat(), () => null).lean ?? null, flat().box, { width: 480, height: 360 }, FALL_DEFAULTS)).toBeNull();
  });

  it("서 있다가 2초 안에 바닥에 누운 자세가 되고 3초 이어지면 자세 「쓰러짐 의심」 사실과 의미 있는 변화 줄을 한 번 남긴다", () => {
    const w = ws();
    run(w, 0, 3000, standing);
    const early = run(w, 3300, 6000, flat);
    expect(posture(w, 6000)).toBe("lying");
    expect(early.some((c) => c.text === FALL_LINE)).toBe(false);
    const changes = run(w, 6300, 6300, flat);
    expect(posture(w, 6300)).toBe("fall_suspected");
    expect(changes).toContainEqual({ kind: "person_state", at_ms: 6300, subject: "person", meaningful: true, text: FALL_LINE });
    // 누운 채 이어져도 사실은 그대로이고 줄은 다시 내지 않는다
    const later = run(w, 6600, 9000, flat);
    expect(posture(w, 9000)).toBe("fall_suspected");
    expect(later.some((c) => c.text === FALL_LINE)).toBe(false);
  });

  it("관찰 텍스트에 「사람 쓰러짐 의심」 줄이 들어가고, 대시보드 말풍선 카드는 쓰러짐 의심을 먼저 알린다", () => {
    const w = ws();
    run(w, 0, 3000, standing);
    const changes = run(w, 3300, 6300, flat);
    const view = w.view(6300);
    const text = textFromWorld(view, changes, { nowMs: 6300, offsetMinutes: 540 });
    expect(text.split("\n").filter((l) => l.endsWith(FALL_LINE))).toHaveLength(1);
    expect(text).toContain("쓰러짐 의심");
    expect(sayLine({ plan: null, command: null, world: view, nowMs: 6300 })).toBe(SAY_TEXT.fall);
  });

  it("일어나면(서 있음·앉아 있음) 쓰러짐 의심을 풀고 자세를 그대로 둔다", () => {
    const w = ws();
    run(w, 0, 3000, standing);
    run(w, 3300, 6300, flat);
    expect(posture(w, 6300)).toBe("fall_suspected");
    run(w, 6600, 7200, sitting);
    expect(posture(w, 7200)).toBe("sitting");
    expect(sayLine({ plan: null, command: null, world: w.view(7200), nowMs: 7200 })).not.toBe(SAY_TEXT.fall);
  });

  // Codex(0234ddd): 관절이 없는 더 새 프레임의 VLM 자세 답이 쓰러짐 의심을 덮어 알림을 지울 수 있었다
  it("쓰러짐 의심인 동안 VLM의 자세 답(관절 없는 더 새 프레임)은 자세를 바꾸지 않는다", () => {
    const w = ws();
    run(w, 0, 3000, standing);
    run(w, 3300, 6300, flat);
    const { ids } = w.applyDetections(frame(6400), [person]);
    w.applyScene("e6400", 6400, { scene: "living", observations: [{ object_id: "d1", state: "standing" }], summary: "s" }, ids);
    expect(posture(w, 6400)).toBe("fall_suspected");
  });

  // Codex(0234ddd): 누운 자세 한 장 뒤 관절이 오래 끊겼다가 한 장만 와도 3초 이어짐으로 인정했다
  it("누운 자세 사이가 FALL_GAP_MS(1초) 넘게 끊기면 다시 본 때부터 이어서 본 시간만 센다", () => {
    const w = ws();
    run(w, 0, 3000, standing);
    run(w, 3300, 3300, flat);
    run(w, 7000, 7000, flat);
    expect(posture(w, 7000)).toBe("lying");
    run(w, 7300, 9700, flat);
    expect(posture(w, 9700)).toBe("lying");
    run(w, 10_000, 10_000, flat);
    expect(posture(w, 10_000)).toBe("fall_suspected");
  });

  // Codex(0234ddd): 사진 세로만 써서 서 있는 사람을 비추며 폰을 90° 기울이면 낙상으로 잡혔다
  it("기울기는 카메라 자세의 중력 방향으로 잰다: 폰을 90° 돌려 서 있는 사람이 가로로 비쳐도 쓰러짐이 아니고, 카메라 자세가 없으면(맞추기 전) 보류한다", () => {
    const rolled = ws();
    run(rolled, 0, 3000, standing);
    const out = run(rolled, 3300, 9300, flat, [], ROLLED);
    expect(out.some((c) => c.text === FALL_LINE)).toBe(false);
    expect(posture(rolled, 9300)).not.toBe("fall_suspected");
    const unaligned = ws();
    run(unaligned, 0, 3000, standing, [], null);
    const none = run(unaligned, 3300, 9300, flat, [], null);
    expect(none.some((c) => c.text === FALL_LINE)).toBe(false);
  });

  // 침대·소파 위로 빼려면 기하(몸 점이 그 가구 자리에 비침)에 더해 그 사람을 본 최근 VLM 자리 답이 그 가구 위여야 한다. 기하는 후보만 고른다
  /** 그 사람(감지 d1)을 본 VLM 답 하나(자리 값). */
  const vlmSays = (w: WorldState, t: number, state: string) =>
    w.applyScene(`e${t}`, t, { scene: "living", observations: [{ object_id: "d1", state: state as never }], summary: "s" }, new Map([["d1", "person"]]));
  /** 트윈 높이 h에 옆으로(z) 누운 몸(엉덩이 x, 어깨 z −0.5, 무릎 z +0.4)의 관절을 그 카메라로 비춘다. */
  const lyingAt = (view: CameraView, x: number, h: number) => {
    const size = { width: 480, height: 360 };
    const px = (z: number) => pixelOf(view, [x, h, z], size)!;
    const [sh, hip, knee] = [px(-0.5), px(0), px(0.4)];
    const xs = [sh[0], hip[0], knee[0]], ys = [sh[1], hip[1], knee[1]];
    return (): Pose => poseOf({
      5: [sh[0], sh[1] - 6, 0.9], 6: [sh[0], sh[1] + 6, 0.9], 11: [hip[0], hip[1] - 6, 0.9], 12: [hip[0], hip[1] + 6, 0.9], 13: [knee[0], knee[1] - 6, 0.9], 14: [knee[0], knee[1] + 6, 0.9],
    }, [Math.min(...xs) - 20, Math.min(...ys) - 25, Math.max(...xs) - Math.min(...xs) + 40, Math.max(...ys) - Math.min(...ys) + 50]);
  };
  const BED: RestSpot = { id: "bed_1", label: "침대", kind: "bed", center: [0.6, 0], size: [2.0, 1.0], facing_deg: 0, top: 0.5 };

  // Codex(0234ddd): 바닥인지 보지 않아 침대·소파에 빨리 누워 쉬어도 낙상 알림이 났다
  it("트윈 침대 자리에 비친 몸이고 VLM이 그 사람을 「침대 위」라고 답했을 때만 쓰러짐이 아니다. 답이 없거나 「바닥」이거나 침대가 다른 자리면 쓰러짐 의심이다", () => {
    // 엉덩이(240, 270) 광선은 몸 점 높이(0.6~0.75)에서 x 0.25~0.3, 어깨(140, 265)는 그 높이에서 z ±0.3 근처다(침대 안쪽)
    const said = ws({ rests: [BED] });
    run(said, 0, 3000, standing);
    run(said, 3300, 3300, flat);
    vlmSays(said, 3300, "on_bed");
    const out = run(said, 3600, 9300, flat);
    expect(out.some((c) => c.text === FALL_LINE)).toBe(false);
    expect(posture(said, 9300)).not.toBe("fall_suspected");
    for (const answer of [null, "on_floor"]) {
      const w = ws({ rests: [BED] });
      run(w, 0, 3000, standing);
      run(w, 3300, 3300, flat);
      if (answer) vlmSays(w, 3300, answer);
      run(w, 3600, 6300, flat);
      expect(posture(w, 6300), String(answer)).toBe("fall_suspected");
    }
    const far = ws({ rests: [{ ...BED, center: [3, 2] }] });
    run(far, 0, 3000, standing);
    run(far, 3300, 3300, flat);
    vlmSays(far, 3300, "on_bed");
    run(far, 3600, 6300, flat);
    expect(posture(far, 6300)).toBe("fall_suspected");
  });

  // Codex(ca916a8): 몸 점 높이 구간의 광선 겹침만으로 빼서, 소파 너머 바닥에 쓰러진 몸이 소파 위로 빠졌다
  it("소파 너머 35cm 바닥에 쓰러진 몸(높이 0.2m)은 광선이 소파 자리에 겹쳐도 VLM이 「바닥」이라 답하면(또는 답이 없으면) 쓰러짐 의심이다", () => {
    // 카메라 1.5m, 소파 x 0.3~1.15(좌판 0.45m). 몸은 x 1.5, 높이 0.2. 엉덩이 광선은 높이 0.7에서 x 0.92로 소파 자리 안이다
    const sofa: RestSpot = { id: "sofa_1", label: "소파", kind: "sofa", center: [0.725, 0], size: [2.0, 0.85], facing_deg: 0, top: 0.45 };
    const beyond = lyingAt(LOOK_VIEW, 1.5, 0.2);
    for (const answer of ["on_floor", null]) {
      const w = ws({ rests: [sofa] });
      run(w, 0, 3000, standing);
      run(w, 3300, 3300, beyond);
      if (answer) vlmSays(w, 3300, answer);
      run(w, 3600, 6300, beyond);
      expect(posture(w, 6300), String(answer)).toBe("fall_suspected");
    }
  });

  it("소파에 빨리 누워도 VLM이 그 사람을 「소파 위」라고 답하면 쓰러짐이 아니다", () => {
    const sofa: RestSpot = { id: "sofa_1", label: "소파", kind: "sofa", center: [0.725, 0], size: [2.0, 0.85], facing_deg: 0, top: 0.45 };
    const onSofa = lyingAt(LOOK_VIEW, 0.725, 0.65);
    const w = ws({ rests: [sofa] });
    run(w, 0, 3000, standing);
    run(w, 3300, 3300, onSofa);
    vlmSays(w, 3300, "on_sofa");
    const out = run(w, 3600, 9300, onSofa);
    expect(out.some((c) => c.text === FALL_LINE)).toBe(false);
    expect(posture(w, 9300)).not.toBe("fall_suspected");
  });

  // Codex(4f515e1): 누운 사람의 엉덩이·어깨는 매트리스보다 높은데 광선을 매트리스 높이까지 내려, 먼 침대에 누운 몸이 가구 밖으로 밀려 낙상 알림이 났다
  it("먼 침대에 빨리 누워도(몸 점은 매트리스 위 0.2m) VLM이 「침대 위」라 답하면 침대 위다: 몸 점 높이(누울 면 + 0.1~0.25m)에서 광선을 본다", () => {
    // 카메라 (0, 1.5, 0)에서 15° 숙여 +x를 본다. 침대 x 2.0~3.4(매트리스 0.57m), 몸은 x 2.7, 높이 0.77에 옆으로(z) 눕는다
    // 매트리스 높이까지 내리면 엉덩이 광선이 x 3.44(침대 밖)에 닿는다
    const pitch = (-15 * Math.PI) / 180;
    const view: CameraView = { ...LOOK_VIEW, orientation: mul([0, Math.sin(-Math.PI / 4), 0, Math.cos(-Math.PI / 4)], [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)]) as CameraView["orientation"] };
    const onBed = lyingAt(view, 2.7, 0.77);
    const bed: RestSpot = { id: "bed_1", label: "침대", kind: "bed", center: [2.7, 0], size: [2.2, 1.4], facing_deg: 0, top: 0.57 };
    const w = ws({ rests: [bed] });
    run(w, 0, 3000, standing, [], view);
    run(w, 3300, 3300, onBed, [], view);
    vlmSays(w, 3300, "on_bed");
    const out = run(w, 3600, 9300, onBed, [], view);
    expect(out.some((c) => c.text === FALL_LINE)).toBe(false);
    expect(posture(w, 9300)).not.toBe("fall_suspected");
    // 침대가 없으면 같은 자세는 쓰러짐 의심이다(이 자세가 바닥에 누운 자세로 읽힌다)
    const none = ws();
    run(none, 0, 3000, standing, [], view);
    run(none, 3300, 6300, onBed, [], view);
    expect(posture(none, 6300)).toBe("fall_suspected");
  });

  // Codex(9984116): 엉덩이 광선이 가구의 전체 높이~바닥 공간을 지나기만 해도 쉬는 가구 위로 단정해, 가구 바로 앞 바닥에 쓰러져도 놓쳤다
  it("침대 바로 앞 바닥에 쓰러지면(엉덩이 광선이 침대 매트리스 면이 아니라 그 아래 공간만 지남) 쓰러짐 의심이다", () => {
    // 침대는 x 0.4~1.4. 엉덩이 광선은 높이 0.55에서 x 0.32(침대 앞), 바닥에서 x 0.5(침대 아래)다
    const bed: RestSpot = { ...BED, center: [0.9, 0], top: 0.55 };
    const w = ws({ rests: [bed] });
    run(w, 0, 3000, standing);
    run(w, 3300, 6300, flat);
    expect(posture(w, 6300)).toBe("fall_suspected");
  });

  // Codex(9984116): 쉬는 가구 판정이 이미 켜진 쓰러짐 의심도 풀었다
  it("이미 쓰러짐 의심이면 쉬는 가구 판정(침대 자리 + VLM 「침대 위」)으로 풀지 않는다(서 있음·앉아 있음만 푼다)", () => {
    let rests: RestSpot[] = [];
    const w = ws({ rests: () => rests });
    run(w, 0, 3000, standing);
    run(w, 3300, 6300, flat);
    expect(posture(w, 6300)).toBe("fall_suspected");
    rests = [BED];
    vlmSays(w, 6300, "on_bed");
    run(w, 6600, 7800, flat);
    expect(posture(w, 7800)).toBe("fall_suspected");
  });

  it("트윈 배치에서 침대·소파만 쉬는 가구로 고른다(협탁 조명·안락의자·바닥 크기 없는 것은 뺀다). 누울 면 높이는 카탈로그 면(매트리스), 없으면 침대 0.55m·소파 0.45m", () => {
    const o = (id: string, type: string, footprint?: [number, number], surface?: number) => ({ id, name: id, type, plan: [1, 2] as [number, number], base: 0, facing_deg: 90, ...(footprint ? { footprint } : {}), ...(surface !== undefined ? { surface } : {}) });
    const rests = restsFromLayout([o("bed_1", "bed_queen", [1.6, 2.1], 0.57), o("sofa_1", "sofa", [2.2, 0.9]), o("bed_3", "bed_single", [1.3, 2.4]), o("lamp_1", "bedside_lamp", [0.3, 0.3]), o("chair_1", "armchair", [0.8, 0.8]), o("bed_2", "bed_single")]);
    expect(rests).toEqual([
      { id: "bed_1", label: "bed_1", kind: "bed", center: [1, 2], size: [1.6, 2.1], facing_deg: 90, top: 0.57 },
      { id: "sofa_1", label: "sofa_1", kind: "sofa", center: [1, 2], size: [2.2, 0.9], facing_deg: 90, top: 0.45 },
      { id: "bed_3", label: "bed_3", kind: "bed", center: [1, 2], size: [1.3, 2.4], facing_deg: 90, top: 0.55 },
    ]);
  });

  // Codex(9984116): 목련 장면의 침대·소파는 배치에 바닥 크기가 없어 쉬는 가구 목록에서 모두 빠졌다
  it("한양목련 서버의 쉬는 가구는 침대 넷·소파 하나이고, 바닥 크기·매트리스 높이를 카탈로그에서 채운다", () => {
    const runtime = mkdtempSync(join(tmpdir(), "rt-rests-"));
    try {
      const { editor } = loadLayout(resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b"), { runtimeDir: runtime, log: () => {} })!;
      const rests = restSource(editor)();
      expect(rests.map((r) => r.id).sort()).toEqual(["bed_queen_08dcffff", "bed_queen_aedb6a01", "bed_single_100dda69", "bed_single_2f581c50", "sofa_a848b595"]);
      const of = (id: string) => rests.find((r) => r.id === id)!;
      expect(of("bed_queen_aedb6a01")).toMatchObject({ size: [1.434, 2.228], top: 0.57 });
      expect(of("bed_single_100dda69")).toMatchObject({ size: [1.297, 2.392], top: 0.55 });
      expect(of("sofa_a848b595")).toMatchObject({ size: [2.1, 0.95], top: 0.45 });
    } finally {
      rmSync(runtime, { recursive: true, force: true });
    }
  });

  describe("오탐 시험: 신호가 나지 않는다", () => {
    const quiet = (steps: [number, number, () => Pose][]) => {
      const w = ws();
      const out: WorldChange[] = [];
      for (const [from, to, pose] of steps) run(w, from, to, pose, out);
      const end = steps.at(-1)![1];
      expect(out.some((c) => c.text === FALL_LINE)).toBe(false);
      expect(posture(w, end)).not.toBe("fall_suspected");
      return w;
    };
    it("천천히 눕기: 서 있다가 3초 앉은 뒤 누워 10초 있다", () => {
      quiet([[0, 3000, standing], [3300, 6300, sitting], [6600, 16_600, flat]]);
    });
    it("소파에 앉기: 서 있다가 앉아 10초 있다", () => {
      quiet([[0, 3000, standing], [3300, 13_300, sitting]]);
    });
    it("허리 숙이기: 서 있다가 몸통만 수평으로 10초 숙인다", () => {
      quiet([[0, 3000, standing], [3300, 13_300, bending]]);
    });
    // Codex(0234ddd): 무릎이 사진 밖으로 잘리면 숙인 몸통과 가로로 긴 상자만으로 누운 자세가 됐다
    it("물건 줍기: 숙이며 무릎이 사진 아래로 잘린 채 10초 있다", () => {
      quiet([[0, 3000, standing], [3300, 13_300, bendingCut]]);
    });
    it("잠깐 바닥에 누웠다가(2.4초) 바로 일어선다", () => {
      quiet([[0, 3000, standing], [3300, 5700, flat], [6000, 9000, standing]]);
    });
  });

  it("시간·각도는 설정으로 바꾼다(FALL_DROP_MS·FALL_HOLD_MS·FALL_GAP_MS·FALL_TORSO_DEG·FALL_THIGH_DEG·FALL_VIEW_DEG). 틀린 값이면 시작하지 않는다", () => {
    expect(loadFallConfig({})).toEqual(FALL_DEFAULTS);
    expect(FALL_DEFAULTS).toEqual({ dropMs: 2000, holdMs: 3000, gapMs: 1000, torsoDeg: 60, thighDeg: 45, viewDeg: 15 });
    expect(loadFallConfig({ FALL_DROP_MS: "1500", FALL_HOLD_MS: "5000", FALL_GAP_MS: "800", FALL_TORSO_DEG: "70", FALL_THIGH_DEG: "50", FALL_VIEW_DEG: "20" }))
      .toEqual({ dropMs: 1500, holdMs: 5000, gapMs: 800, torsoDeg: 70, thighDeg: 50, viewDeg: 20 });
    for (const bad of [{ FALL_DROP_MS: "0" }, { FALL_HOLD_MS: "x" }, { FALL_GAP_MS: "-5" }, { FALL_TORSO_DEG: "95" }, { FALL_THIGH_DEG: "-1" }, { FALL_VIEW_DEG: "90" }]) expect(() => loadFallConfig(bad)).toThrow();
    // 이어짐을 5초로 늘리면 3초 누워서는 신호가 없다
    const w = ws({ fall: { ...FALL_DEFAULTS, holdMs: 5000 } });
    run(w, 0, 3000, standing);
    run(w, 3300, 6300, flat);
    expect(posture(w, 6300)).toBe("lying");
    run(w, 6600, 8400, flat);
    expect(posture(w, 8400)).toBe("fall_suspected");
  });

  it("쓰러짐 의심은 관절만 정한다: VLM 스키마 enum·프롬프트에 없다", () => {
    expect(SCENE_STATES as readonly string[]).not.toContain("fall_suspected");
    expect(JSON.stringify(SCENE_JSON_SCHEMA)).not.toContain("fall_suspected");
    expect(SCENE_PROMPT).not.toContain("fall_suspected");
  });
});
