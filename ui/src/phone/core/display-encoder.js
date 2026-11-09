// 폰 표시 영상(H.264): XR 카메라 텍스처를 영상 크기로 canvas에 그려 VideoFrame → VideoEncoder → /phone/events 바이너리 패킷.
// 대시보드 클로이드의 눈을 선명하게 보이는 표시 전용이다. 분석용 JPEG(capture.js)와 따로 돈다.
// 와이파이가 막히면 영상이 먼저 쉰다(video.js createSendGate). H.264를 못 쓰면 null을 돌려주고 화면은 JPEG 그대로다.
// 프레임은 기본으로 readPixels(RGBA 버퍼)로 만든다. WebGL canvas에서 바로 만든 프레임은 이 PC 크롬(하드웨어 인코더)에서 10fps에 그쳤고
// 같은 GPU를 쓰는 대시보드 디코더까지 느려졌다(readPixels 26fps, 소프트웨어 인코더 30fps). 폰에서 시험하려면 ?vsrc=canvas.
// 인코더가 2초 넘게 밀리면 한 단계씩 바꾼다: canvas였으면 readPixels로 → 소프트웨어 인코더로.
// URL: ?video=0 끄기, ?vfps=(5~30, 기본 30) ?vlong=(긴 변, 기본 1280) ?vkbps=(기본 2000) ?vsrc=canvas.

import { createSendStats } from "./pipeline.js";
import { codecCandidates, createBacklogWatch, createSendGate, videoPacket, videoSize } from "./video.js";

const clamp = (raw, lo, hi, fallback) => {
  const n = Number(raw);
  return raw !== null && raw !== "" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const MAX_ERRORS = 3;

export const displaySupported = () => typeof VideoEncoder === "function" && typeof VideoFrame === "function";

/** 영상 인코딩·보내기(그리기와 무관). frame(make, w, h, ms): make(size)가 그 크기의 VideoFrame을 만든다.
 *  onSlow: 인코더가 밀릴 때 먼저 부른다. 프레임 만드는 방법을 바꿨으면 true(그다음은 소프트웨어 인코더로). */
export function createVideoSender({ socket, params = new URLSearchParams(), onError = () => {}, onSlow = () => false }) {
  if (!displaySupported() || params.get("video") === "0") return null;
  const fps = clamp(params.get("vfps"), 5, 30, 30);
  const long = clamp(params.get("vlong"), 320, 1920, 1280);
  const short = Math.round((long * 9) / 16 / 16) * 16;
  const kbps = clamp(params.get("vkbps"), 300, 8000, 2000);
  const gate = createSendGate();
  const stats = createSendStats({ windowMs: 2000 });
  const watch = createBacklogWatch();
  let accel = "no-preference";
  let encoder = null;
  let state = "idle"; // idle → configuring → ready, 못 쓰면 failed
  let source = "";
  let size = null;
  let codec = null;
  let decoderConfig = null;
  let lastAt = -Infinity;
  let lastWs = null;
  let drawMs = 0;
  let errors = 0;
  let why = "";

  const open = (ws) => ws && ws.readyState === WebSocket.OPEN;

  function output(chunk, meta) {
    if (meta?.decoderConfig) {
      const d = meta.decoderConfig.description;
      const bytes = !d ? new Uint8Array(0) : d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
      decoderConfig = {
        codec: meta.decoderConfig.codec ?? codec,
        width: meta.decoderConfig.codedWidth ?? size.width,
        height: meta.decoderConfig.codedHeight ?? size.height,
        description: new Uint8Array(bytes),
      };
      gate.configChanged();
    }
    const ws = socket();
    if (!open(ws)) return;
    const key = chunk.type === "key";
    const d = gate.onChunk(key, ws.bufferedAmount);
    if (!d.send) {
      stats.skipped("buffer");
      return;
    }
    if (d.config && decoderConfig) {
      const { codec: c, width, height, description } = decoderConfig;
      ws.send(videoPacket({ kind: "video_config", codec: c, width, height }, description));
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    ws.send(videoPacket({ kind: "video", key, ts: Math.max(0, Math.round(chunk.timestamp)), width: size.width, height: size.height }, data));
    stats.sent({ bytes: data.length, readMs: drawMs, encodeMs: 0 });
  }

  async function supported(want) {
    for (const c of codecCandidates(size.width, size.height)) {
      const cfg = { codec: c, width: size.width, height: size.height, bitrate: kbps * 1000, framerate: fps, latencyMode: "realtime", avc: { format: "avc" }, hardwareAcceleration: want };
      const support = await VideoEncoder.isConfigSupported(cfg).catch(() => null);
      if (support?.supported) return cfg;
    }
    return null;
  }

  async function configure(width, height) {
    state = "configuring";
    size = videoSize(width, height, { long, short });
    let cfg = await supported(accel);
    // 소프트웨어 인코더가 없으면(폰마다 다름) 원래대로
    if (!cfg && accel === "prefer-software") {
      accel = "no-preference";
      cfg = await supported(accel);
    }
    if (state !== "configuring") return; // 기다리는 사이 닫힘
    if (cfg) {
      codec = cfg.codec;
      if (encoder && encoder.state !== "closed") encoder.close();
      encoder = new VideoEncoder({
        output,
        error(error) {
          errors += 1;
          why = `인코더 오류: ${error?.message ?? error}`;
          state = errors >= MAX_ERRORS ? "failed" : "idle";
          if (state === "failed") onError("표시 영상 인코딩이 계속 실패해 껐어요. 화면은 JPEG로 보여요");
        },
      });
      encoder.configure(cfg);
      gate.reset();
      watch.reset();
      state = "ready";
      return;
    }
    state = "failed";
    why = "H.264 인코딩 미지원";
    onError("이 폰은 H.264 인코딩을 못 해요. 대시보드 화면은 JPEG로 보여요");
  }

  return {
    get state() { return state; },
    get size() { return size; },
    /** XR 프레임마다 부른다. 때가 아니거나 쉬어야 하면 그리지 않는다. */
    frame(make, sourceWidth, sourceHeight, timeMs) {
      if (state === "failed" || state === "configuring") return;
      const ws = socket();
      if (ws !== lastWs) {
        lastWs = ws;
        gate.reset(); // 새 연결: 설정·키프레임부터
      }
      if (!open(ws) || timeMs - lastAt < 1000 / fps - 2) return;
      if (state === "idle" || source !== `${sourceWidth}x${sourceHeight}`) {
        source = `${sourceWidth}x${sourceHeight}`;
        void configure(sourceWidth, sourceHeight);
        return;
      }
      const backed = encoder.encodeQueueSize > 2;
      watch.attempt(backed);
      if (watch.check() && !onSlow() && accel !== "prefer-software") {
        accel = "prefer-software";
        state = "idle"; // 다음 프레임에 소프트웨어 인코더로 다시 설정
        return;
      }
      if (backed) {
        stats.skipped("encoding");
        return;
      }
      const decision = gate.beforeEncode(ws.bufferedAmount, timeMs);
      if (!decision) {
        stats.skipped("buffer");
        return;
      }
      lastAt = timeMs;
      const t0 = performance.now();
      const vf = make(size, Math.round(timeMs * 1000));
      drawMs = performance.now() - t0;
      try {
        encoder.encode(vf, { keyFrame: decision.keyFrame });
      } finally {
        vf.close();
      }
    },
    /** ⋯ 메뉴 한 줄. path: 프레임 만드는 방법(canvas·readPixels). */
    describe(path = "") {
      if (state === "failed") return `표시 영상: 꺼짐(${why})`;
      if (!size) return "표시 영상: 준비 중";
      const s = stats.snapshot();
      const mbps = s.kbPerFrame === null ? 0 : (s.kbPerFrame * 1024 * 8 * s.fps) / 1e6;
      const how = [path, accel === "prefer-software" ? "소프트웨어 인코더" : "기본 인코더"].filter(Boolean).join("·");
      return `표시 영상 ${codec ?? "-"} ${size.width}×${size.height} · ${s.fps.toFixed(1)} fps · ${mbps.toFixed(1)}Mbps · ${how} · 2초간 건너뜀 버퍼 ${s.skipped.buffer} · 인코더 밀림 ${s.skipped.encoding}`;
    },
    close(reason = "AR 끝") {
      state = "failed";
      why = reason;
      if (encoder && encoder.state !== "closed") encoder.close();
    },
  };
}

const VS = `attribute vec2 p; varying vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `precision mediump float; varying vec2 uv; uniform sampler2D tex; uniform float flipY;
void main() { gl_FragColor = texture2D(tex, vec2(uv.x, flipY > 0.5 ? 1.0 - uv.y : uv.y)); }`;

function program(gl) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "셰이더 오류");
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "셰이더 연결 오류");
  return p;
}

/** XR 카메라 텍스처용. gl은 XR 세션 컨텍스트(카메라 텍스처가 그 안에서만 유효), flipY는 capture.js와 같은 뜻(?flip=). */
export function createDisplayEncoder({ gl, flipY = true, socket, params, onError = () => {} }) {
  // ?vsrc=canvas일 때만 canvas에서 바로 만든다. 못 만들거나(브라우저마다 다름) 인코더가 밀리면 readPixels로
  let fromCanvas = params?.get("vsrc") === "canvas";
  const onSlow = () => {
    if (!fromCanvas) return false;
    fromCanvas = false;
    return true;
  };
  const sender = createVideoSender({ socket, params, onError, onSlow });
  if (!sender) return null;
  let prog;
  try {
    prog = program(gl);
  } catch (error) {
    sender.close(`셰이더 오류: ${error.message}`);
    onError(`표시 영상을 켜지 못했어요: ${error.message}. 화면은 JPEG로 보여요`);
    return null;
  }
  const attr = gl.getAttribLocation(prog, "p");
  const uTex = gl.getUniformLocation(prog, "tex");
  const uFlip = gl.getUniformLocation(prog, "flipY");
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  // 영상 쪽 오류가 XR 프레임(자세·분석용 JPEG)을 멈추지 않게 여기서 받고, 계속되면 끈다
  let failures = 0;

  function draw(texture, { width, height }, flip) {
    const canvas = gl.canvas;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uTex, 0);
    gl.uniform1f(uFlip, flip ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function makeFrame(texture, size, timestamp) {
    if (fromCanvas) {
      // canvas는 아래 줄이 화면 아래라 readPixels(위 줄부터 읽게 뒤집음)와 반대로 그린다
      draw(texture, size, !flipY);
      try {
        return new VideoFrame(gl.canvas, { timestamp, alpha: "discard" });
      } catch {
        fromCanvas = false;
      }
    }
    draw(texture, size, flipY);
    const pixels = new Uint8Array(size.width * size.height * 4);
    gl.readPixels(0, 0, size.width, size.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return new VideoFrame(pixels, { format: "RGBA", codedWidth: size.width, codedHeight: size.height, timestamp });
  }

  return {
    describe: () => sender.describe(fromCanvas ? "canvas" : "readPixels"),
    close: () => sender.close(),
    /** XR 프레임 콜백 안에서 부른다. 묶여 있던 프레임버퍼는 되돌린다. */
    frame(texture, camera, timeMs) {
      if (sender.state === "failed") return;
      const before = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      try {
        sender.frame((size, ts) => makeFrame(texture, size, ts), camera.width, camera.height, timeMs);
      } catch (error) {
        if (++failures >= 3) {
          sender.close(`오류: ${error.message}`);
          onError(`표시 영상을 껐어요: ${error.message}. 화면은 JPEG로 보여요`);
        }
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, before);
      }
    },
  };
}
