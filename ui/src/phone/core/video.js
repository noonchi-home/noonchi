// 폰 표시 영상(H.264)의 순수 계산(DOM·WebCodecs 없음): 영상 크기, 코덱 후보, 패킷, 보내기 관문.
// 표시 영상은 분석용 JPEG보다 먼저 양보한다: 와이파이 버퍼 기준이 JPEG(512KB)보다 낮다.

/** 카메라 크기를 긴 변 long·짧은 변 short 안으로 줄인 영상 크기. 16 배수(매크로블록)로 맞추고 카메라보다 키우지 않는다. */
export function videoSize(cameraWidth, cameraHeight, { long = 1280, short = 720, align = 16 } = {}) {
  const scale = Math.min(long / Math.max(cameraWidth, cameraHeight), short / Math.min(cameraWidth, cameraHeight), 1);
  const fit = (v, max) => {
    let r = Math.round((v * scale) / align) * align;
    if (r > max) r = Math.floor(max / align) * align;
    return Math.max(align, r);
  };
  return { width: fit(cameraWidth, cameraWidth), height: fit(cameraHeight, cameraHeight) };
}

// H.264 레벨별 한 장 최대 매크로블록 수(30fps 기준으로 넉넉한 레벨만)
const LEVELS = [[3600, "1F"], [8192, "28"], [36864, "33"]];
const PROFILES = ["42E0", "4D40", "6400"]; // Constrained Baseline, Main, High

/** 이 크기를 담는 가장 낮은 레벨부터의 avc1 코덱 이름 후보. 폰마다 되는 것이 달라 앞에서부터 isConfigSupported로 고른다. */
export function codecCandidates(width, height) {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  return LEVELS.filter(([max]) => mbs <= max).flatMap(([, level]) => PROFILES.map((p) => `avc1.${p}${level}`));
}

/** [헤더 길이 u32][JSON 헤더][본문]. 서버 src/phone/packet.ts parsePacket이 읽는다. */
export function videoPacket(header, body) {
  const head = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + head.length + body.length);
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  out.set(body, 4 + head.length);
  return out;
}

/** 인코더가 계속 밀리는지: windowMs마다 그동안의 시도 중 밀린(건너뛴) 비율이 ratio 이상이면 true. 판단한 뒤 창을 새로 시작한다.
 *  같은 폰·브라우저라도 프레임 출처(canvas·readPixels)와 하드웨어·소프트웨어 인코더에 따라 처리량이 크게 달라 이걸 보고 바꾼다. */
export function createBacklogWatch({ windowMs = 2000, minAttempts = 20, ratio = 0.5, now = () => performance.now() } = {}) {
  let start = now();
  let attempts = 0;
  let backed = 0;
  return {
    attempt(backedUp) {
      attempts += 1;
      if (backedUp) backed += 1;
    },
    check() {
      if (now() - start < windowMs) return false;
      const slow = attempts >= minAttempts && backed / attempts >= ratio;
      start = now();
      attempts = 0;
      backed = 0;
      return slow;
    },
    reset() {
      start = now();
      attempts = 0;
      backed = 0;
    },
  };
}

/** 무엇을 언제 보낼지. 키프레임은 keyMs마다, 버퍼가 넘치면 인코딩을 쉬고 다음 프레임을 키프레임으로. 키프레임 전 델타는 버린다.
 *  디코더 설정은 처음·다시 연결·설정이 바뀐 뒤 첫 키프레임 앞에 붙인다. */
export function createSendGate({ maxBuffered = 256 * 1024, keyMs = 2000 } = {}) {
  let lastKeyAt = null;
  let needKey = true; // 다음 인코딩을 키프레임으로
  let waitKey = true; // 키프레임을 보낼 때까지 델타를 버림
  let needConfig = true;
  return {
    /** 인코딩 전에: 쉬면 null, 아니면 키프레임 여부. */
    beforeEncode(buffered, nowMs) {
      if (buffered > maxBuffered) {
        needKey = true;
        return null;
      }
      const keyFrame = needKey || lastKeyAt === null || nowMs - lastKeyAt >= keyMs;
      if (keyFrame) {
        lastKeyAt = nowMs;
        needKey = false;
      }
      return { keyFrame };
    },
    /** 인코딩된 청크가 나왔을 때: 보낼지, 그 앞에 설정을 붙일지. */
    onChunk(isKey, buffered) {
      if (waitKey && !isKey) return { send: false, config: false };
      if (buffered > maxBuffered) {
        waitKey = true;
        needKey = true;
        return { send: false, config: false };
      }
      const config = needConfig && isKey;
      if (config) needConfig = false;
      if (isKey) waitKey = false;
      return { send: true, config };
    },
    configChanged() { needConfig = true; },
    /** 새 연결: 서버는 이 연결의 설정부터 받는다. */
    reset() {
      needKey = true;
      waitKey = true;
      needConfig = true;
    },
  };
}
