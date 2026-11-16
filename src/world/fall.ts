// 쓰러짐 의심(2026-11-16 회의 안전 계층 「자세 변화로 낙상 의심」): 이미 도는 관절 자세(src/world/pose.ts)만 본다. 신고·연락은 하지 않는다.
// 기울기는 사진 세로가 아니라 엔진 프레임 카메라 자세로 구한 중력 방향에서 잰다(폰을 기울여 들어도 그대로). 카메라 자세가 없거나(맞추기 전)
// 그 점을 거의 바로 아래·위로 보면(viewDeg 안) 보류한다.
// 한 장의 자세(fallPose): 몸통이 torsoDeg 안이면 허벅지로 서 있음·앉아 있음(무릎이 안 보이면 모름), 몸통이 누웠으면 허벅지도 thighDeg 넘게 누워야
// 바닥에 누운 자세(flat)다(허리 숙이기는 허벅지가 서 있어 모름). 무릎이 안 보이면 사진 경계에 잘리지 않은 상자가 중력에 가로로 더 길 때만 flat이다.
// 확인된 침대·소파(트윈 가구) 위에 누운 것(rest: 엉덩이·어깨 광선이 그 가구의 누울 면 높이와 가장자리 0.1m 안쪽에서 만남, src/world/place.ts onRest)은
// 쓰러짐 셈을 다시 하게 하지만, 이미 쓰러짐 의심이면 풀지 않는다(트윈 배치가 어긋나도 켜진 알림을 지우지 않게).
// 서 있음에서 dropMs 안에 flat이 되고, 이어서 본 flat이 holdMs 이어지면 쓰러짐 의심이다. flat 사이가 gapMs 넘게 끊기면 다시 본 때부터 센다.
// 서 있음·앉아 있음이 보이면 풀고 셈을 다시 한다. 모름·확실하지 않은 관절은 셈을 그대로 둔다.
// 숫자 근거:
// - dropMs 2초: 낙상의 넘어지는 단계(critical phase)는 약 0.3~0.5초다(Noury 외 2007, 「Fall detection - Principles and Methods」, IEEE EMBC).
//   실제 노인 낙상 영상 26건에서는 그 단계가 더 길었다(BMC Geriatrics 2013, doi:10.1186/1471-2318-13-103). 관절은 0.3초마다
//   (엔진 프레임 0.1초 × BRAIN_POSE_EVERY 3) 보므로 2초면 그 사이 6장이다. 천천히 눕기는 앉은 자세를 몇 초 거쳐 2초를 넘는다.
// - holdMs 3초: 넘어진 뒤(post-fall) 누운 채인지 본다. 짧은 흔들림을 거르고, PAM 주기(5초) 안에 알린다.
// - gapMs 1초: 관절 간격 0.3초의 세 배 남짓이라 한두 장 놓쳐도 이어 보고, 그보다 길게 끊기면 그사이 일어났는지 모른다.
// - torsoDeg 60°·thighDeg 45°: 누움·앉음 규칙과 같은 각도(docs/provenance.md, Perception-lab describe_pose). 허리 숙이기는 허벅지가 45° 안이다.
// - viewDeg 15°: 광선이 수직에서 15° 안이면 선 몸통도 사진에서 제 길이의 1/4 아래로 짧아져(sin 15° ≈ 0.26) 기울기를 믿을 수 없다.
// - 사진 경계 2%: 사람 발이 보이는지 보는 기준(src/world/state.ts FEET_EDGE 0.98)과 같다.
import { LYING_DEG, SITTING_DEG, type Lean } from "./pose.js";

export interface FallConfig { dropMs: number; holdMs: number; gapMs: number; torsoDeg: number; thighDeg: number; viewDeg: number }

export const FALL_DEFAULTS: FallConfig = { dropMs: 2000, holdMs: 3000, gapMs: 1000, torsoDeg: LYING_DEG, thighDeg: SITTING_DEG, viewDeg: 15 };

/** 상자가 사진 경계에서 이 몫 안이면 그 몸은 잘렸다. */
const EDGE = 0.02;

/** FALL_DROP_MS·FALL_HOLD_MS·FALL_GAP_MS(0보다 큰 ms), FALL_TORSO_DEG·FALL_THIGH_DEG·FALL_VIEW_DEG(0보다 크고 90보다 작은 °). 틀린 값이면 던진다(시작하지 않는다). */
export function loadFallConfig(env: Record<string, string | undefined>): FallConfig {
  return {
    dropMs: num(env, "FALL_DROP_MS", FALL_DEFAULTS.dropMs), holdMs: num(env, "FALL_HOLD_MS", FALL_DEFAULTS.holdMs), gapMs: num(env, "FALL_GAP_MS", FALL_DEFAULTS.gapMs),
    torsoDeg: num(env, "FALL_TORSO_DEG", FALL_DEFAULTS.torsoDeg, 90), thighDeg: num(env, "FALL_THIGH_DEG", FALL_DEFAULTS.thighDeg, 90),
    viewDeg: num(env, "FALL_VIEW_DEG", FALL_DEFAULTS.viewDeg, 90),
  };
}

const num = (env: Record<string, string | undefined>, key: string, d: number, max = Number.POSITIVE_INFINITY) => {
  const raw = env[key]?.trim();
  if (!raw) return d;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0 || v >= max) throw new Error(`${key}=${raw}: 0보다 크${max === Number.POSITIVE_INFINITY ? "" : `고 ${max}보다 작`}은 숫자여야 합니다`);
  return v;
};

/** 쓰러짐 셈에 쓰는 한 장의 자세. rest: 확인된 침대·소파 위에 누움. */
export type FallPose = "standing" | "sitting" | "flat" | "rest";

/** 중력 기준 기울기·상자로 본 한 장의 자세(rest는 World State가 정한다). 모르면 null. */
export function fallPose(lean: Lean | null, box: [number, number, number, number], size: { width: number; height: number }, cfg: FallConfig): Exclude<FallPose, "rest"> | null {
  if (!lean) return null;
  if (lean.torso <= cfg.torsoDeg) return lean.thigh === null ? null : lean.thigh > cfg.thighDeg ? "sitting" : "standing";
  if (lean.thigh !== null) return lean.thigh > cfg.thighDeg ? "flat" : null;
  const cut = box[0] <= size.width * EDGE || box[1] <= size.height * EDGE || box[0] + box[2] >= size.width * (1 - EDGE) || box[1] + box[3] >= size.height * (1 - EDGE);
  return !cut && lean.wide ? "flat" : null;
}

/** 가장 확실한 한 사람의 관절을 시각 순으로 받아 쓰러짐 의심을 정한다. */
export class FallWatch {
  /** 지금 쓰러짐 의심인가. */
  active = false;
  private standAt: number | null = null;
  /** 누운 자세 후보: 서 있음에서 dropMs 안에 왔는가, 이어서 본 첫 시각, 마지막으로 본 시각. */
  private flat: { fast: boolean; since: number; last: number } | null = null;
  constructor(private readonly cfg: FallConfig) {}

  /** 관절 한 장. fall: 쓰러짐 의심이 됨, up: 일어나 풀림, null: 바뀐 것 없음. */
  see(at: number, pose: FallPose | null): "fall" | "up" | null {
    if (pose === null) return null;
    if (pose === "flat") {
      if (!this.flat) this.flat = { fast: this.standAt !== null && at - this.standAt <= this.cfg.dropMs, since: at, last: at };
      else if (at - this.flat.last > this.cfg.gapMs) this.flat.since = at;
      this.flat.last = at;
      if (this.active || !this.flat.fast || at - this.flat.since < this.cfg.holdMs) return null;
      this.active = true;
      return "fall";
    }
    if (pose === "rest" && this.active) return null;
    if (pose === "standing") this.standAt = at;
    this.flat = null;
    if (!this.active) return null;
    this.active = false;
    return "up";
  }
}
