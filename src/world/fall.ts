// 쓰러짐 의심(2026-11-16 회의 안전 계층 「자세 변화로 낙상 의심」): 이미 도는 관절 자세(src/world/pose.ts)만 본다. 신고·연락은 하지 않는다.
// 서 있음에서 dropMs 안에 바닥에 누운 자세(flat: 몸통과 허벅지가 다 누움)가 되고, 그 자세가 holdMs 이어지면 쓰러짐 의심이다.
// 서 있음·앉아 있음이 보이면(일어남) 풀고 셈을 다시 한다. 다리 가림·모름·확실하지 않은 관절·허벅지가 선 누움(허리 숙이기)은 셈을 그대로 둔다.
// 숫자 근거:
// - dropMs 2초: 낙상의 넘어지는 단계(critical phase)는 약 0.3~0.5초다(Noury 외 2007, 「Fall detection - Principles and Methods」, IEEE EMBC).
//   실제 노인 낙상 영상 26건에서는 그 단계가 더 길었다(BMC Geriatrics 2013, doi:10.1186/1471-2318-13-103). 관절은 0.3초마다
//   (엔진 프레임 0.1초 × BRAIN_POSE_EVERY 3) 보므로 2초면 그 사이 6장이다. 천천히 눕기는 앉은 자세를 몇 초 거쳐 2초를 넘는다.
// - holdMs 3초: 넘어진 뒤(post-fall) 누운 채인지 본다. 잠깐 바닥에 앉았다 눕는 짧은 흔들림을 거르고, PAM 주기(5초) 안에 알린다.
// - torsoDeg 60°·thighDeg 45°: 누움·앉음 규칙과 같은 각도(docs/provenance.md, Perception-lab describe_pose). 허리 숙이기는 허벅지가 45° 안이다.
import { LYING_DEG, SITTING_DEG, type PoseInfo } from "./pose.js";

export interface FallConfig { dropMs: number; holdMs: number; torsoDeg: number; thighDeg: number }

export const FALL_DEFAULTS: FallConfig = { dropMs: 2000, holdMs: 3000, torsoDeg: LYING_DEG, thighDeg: SITTING_DEG };

/** FALL_DROP_MS·FALL_HOLD_MS(0보다 큰 ms), FALL_TORSO_DEG·FALL_THIGH_DEG(0보다 크고 90보다 작은 °). 틀린 값이면 던진다(시작하지 않는다). */
export function loadFallConfig(env: Record<string, string | undefined>): FallConfig {
  return {
    dropMs: num(env, "FALL_DROP_MS", FALL_DEFAULTS.dropMs), holdMs: num(env, "FALL_HOLD_MS", FALL_DEFAULTS.holdMs),
    torsoDeg: num(env, "FALL_TORSO_DEG", FALL_DEFAULTS.torsoDeg, 90), thighDeg: num(env, "FALL_THIGH_DEG", FALL_DEFAULTS.thighDeg, 90),
  };
}

const num = (env: Record<string, string | undefined>, key: string, d: number, max = Number.POSITIVE_INFINITY) => {
  const raw = env[key]?.trim();
  if (!raw) return d;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0 || v >= max) throw new Error(`${key}=${raw}: 0보다 크${max === Number.POSITIVE_INFINITY ? "" : `고 ${max}보다 작`}은 숫자여야 합니다`);
  return v;
};

/** 가장 확실한 한 사람의 관절을 시각 순으로 받아 쓰러짐 의심을 정한다. */
export class FallWatch {
  /** 지금 쓰러짐 의심인가. */
  active = false;
  private standAt: number | null = null;
  private flatSince: number | null = null;
  private fast = false;
  constructor(private readonly cfg: FallConfig) {}

  /** 관절 한 장. fall: 쓰러짐 의심이 됨, up: 일어나 풀림, null: 바뀐 것 없음. */
  see(at: number, p: Pick<PoseInfo, "posture" | "flat" | "level">): "fall" | "up" | null {
    if (p.level === "low") return null;
    if (p.flat) {
      if (this.flatSince === null) {
        this.flatSince = at;
        this.fast = this.standAt !== null && at - this.standAt <= this.cfg.dropMs;
      }
      if (this.active || !this.fast || at - this.flatSince < this.cfg.holdMs) return null;
      this.active = true;
      return "fall";
    }
    if (p.posture !== "standing" && p.posture !== "sitting") return null;
    if (p.posture === "standing") this.standAt = at;
    this.flatSince = null;
    this.fast = false;
    if (!this.active) return null;
    this.active = false;
    return "up";
  }
}
