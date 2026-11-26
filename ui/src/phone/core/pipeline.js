// 폰 카메라 프레임 보내기의 순수 계산(DOM·WebGL 없음): 인코딩 큐, 보낸 장 수·시간 측정, 기본 프레임 크기.

/** 인코딩을 한 번에 maxInFlight장까지 겹친다. 늦게 끝난 오래된 프레임은 순서가 뒤바뀌므로 보내지 않는다. */
export function createFramePipeline({ maxInFlight = 2 } = {}) {
  let seq = 0;
  let lastSent = 0;
  let inFlight = 0;
  return {
    get inFlight() { return inFlight; },
    canStart: () => inFlight < maxInFlight,
    start() {
      inFlight += 1;
      return ++seq;
    },
    /** 인코딩이 끝났을 때: 보내도 되면 true. */
    finish(id) {
      inFlight = Math.max(0, inFlight - 1);
      if (id < lastSent) return false;
      lastSent = id;
      return true;
    },
    fail() {
      inFlight = Math.max(0, inFlight - 1);
    },
  };
}

// engine: 엔진 프레임 차례를 건너뜀(앞 엔진 프레임 인코딩 중·보낼 것이 쌓임)
const REASONS = ["encoding", "buffer", "stale", "engine"];

/** 최근 windowMs 동안 보낸 장 수(fps), 장당 readPixels·인코딩 시간, 크기, 건너뛴 이유별 횟수. */
export function createSendStats({ windowMs = 2000, now = () => performance.now() } = {}) {
  let sent = [];
  let skips = [];
  const prune = () => {
    const from = now() - windowMs;
    sent = sent.filter((e) => e.at > from);
    skips = skips.filter((e) => e.at > from);
  };
  const avg = (key) => (sent.length ? sent.reduce((a, e) => a + e[key], 0) / sent.length : null);
  return {
    sent({ bytes, readMs, encodeMs }) {
      sent.push({ at: now(), bytes, readMs, encodeMs });
    },
    skipped(reason) {
      skips.push({ at: now(), reason });
    },
    snapshot() {
      prune();
      const skipped = Object.fromEntries(REASONS.map((r) => [r, skips.filter((e) => e.reason === r).length]));
      const bytes = avg("bytes");
      return { fps: sent.length / (windowMs / 1000), readMs: avg("readMs"), encodeMs: avg("encodeMs"), kbPerFrame: bytes === null ? null : bytes / 1024, skipped };
    },
  };
}

/** 프레임 가로 크기: ?w가 있으면 그것(160~1280), 없으면 480(폰도 영상도 가로만 보낸다). */
export function frameWidth(param) {
  const n = Number(param);
  if (param !== null && param !== undefined && param !== "" && Number.isFinite(n)) return Math.min(1280, Math.max(160, n));
  return 480;
}
