// 상위 판단 에이전트(클로이드의 두뇌) 설정. 기본값은 11-01 실험(최근 2초·최대 5장, 근거 나이 1.5~2초)과
// 사용자 결정(자리 비움 5초, 근거 3초 넘으면 모름)을 따른다. BRAIN_* 환경 변수로 바꾼다.
// 2단계(계획서 2026-11-04-brain-live.md): YOLO 존재 판정 창 0.6초, 치워짐 2초, 행동 결과 기다림 120초.

export interface WindowConfig {
  /** 판정 창 길이(ms). 최신 사진에서 이만큼 안의 사진만 넣는다. */
  spanMs: number;
  /** 이전 사진 간격(ms). */
  stepMs: number;
  /** 창의 최대 사진 수(최신 포함). */
  maxFrames: number;
}

export interface BrainConfig {
  /** 판정 호출 시작 간격(ms). 진행 중이면 기다렸다가 그때의 최신 창으로 부른다. */
  intervalMs: number;
  /** 세션당 판정 호출 상한. */
  callCap: number;
  window: WindowConfig;
  /** 근거가 이보다 오래되면 모름으로 본다(ms). */
  staleMs: number;
  /** 컵이 보이고 사람이 없는 상태가 이만큼 이어져야 자리 비움(ms). */
  awayMs: number;
  /** 컵 안 사진 요청을 거두는 시간(ms). */
  requestTimeoutMs: number;
  /** 버퍼에 두는 사진 길이(ms). VLM 판정 창과 컵 안 근거를 찾는 데 쓴다. */
  bufferMs: number;
  /** 판단 모델에 넘길 관찰 텍스트 창(ms): 마지막 관찰까지 이 안의 YOLO·VLM 줄. */
  decisionWindowMs: number;
  /** YOLO 존재 판정 창(ms): 이 안의 프레임 중 하나라도 보이면 있음. */
  holdMs: number;
  /** 행동 결과: 컵 없음이 이만큼 이어지면 치워짐(ms). */
  clearMs: number;
  /** 행동 결과를 기다리는 시간(ms). */
  actionTimeoutMs: number;
}

export const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  intervalMs: 1000,
  callCap: 120,
  window: { spanMs: 2000, stepMs: 500, maxFrames: 5 },
  staleMs: 3000,
  awayMs: 5000,
  requestTimeoutMs: 60_000,
  bufferMs: 10_000,
  decisionWindowMs: 10_000,
  holdMs: 600,
  clearMs: 2000,
  actionTimeoutMs: 120_000,
};

function num(env: Record<string, string | undefined>, key: string, fallback: number, min: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < min) throw new Error(`${key}=${raw}: ${min} 이상의 숫자여야 합니다`);
  return v;
}

export function loadBrainConfig(env: Record<string, string | undefined> = process.env): BrainConfig {
  const d = DEFAULT_BRAIN_CONFIG;
  return {
    intervalMs: num(env, "BRAIN_INTERVAL_MS", d.intervalMs, 100),
    callCap: Math.floor(num(env, "BRAIN_CALL_CAP", d.callCap, 1)),
    window: { ...d.window },
    staleMs: num(env, "BRAIN_STALE_MS", d.staleMs, 100),
    awayMs: num(env, "BRAIN_AWAY_MS", d.awayMs, 0),
    requestTimeoutMs: num(env, "BRAIN_REQUEST_TIMEOUT_MS", d.requestTimeoutMs, 1000),
    bufferMs: d.bufferMs,
    decisionWindowMs: d.decisionWindowMs,
    holdMs: num(env, "BRAIN_HOLD_MS", d.holdMs, 100),
    clearMs: num(env, "BRAIN_CLEAR_MS", d.clearMs, 0),
    actionTimeoutMs: num(env, "BRAIN_ACTION_TIMEOUT_MS", d.actionTimeoutMs, 1000),
  };
}
