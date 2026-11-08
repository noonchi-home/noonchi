// 카메라 텍스처(WebGL) → 원하는 크기의 픽셀 → JPEG, 그리고 서버로 보낼 바이너리 패킷(src/phone/packet.ts와 같은 형식).
// grab은 XR 프레임 콜백 안에서 불러야 카메라 텍스처가 유효하다. 부른 뒤 XR 프레임버퍼를 다시 묶는 것은 부른 쪽 몫이다.
//
// flipY: 텍스처가 GL 방식(t=0이 이미지 아래쪽)이면 true. readPixels는 아래 줄부터 읽으므로 셰이더에서 뒤집어
// 위 줄부터 나오게 한다. 실제 폰 카메라 텍스처 방향은 폰에서 확인하고, 거꾸로면 폰 페이지 ?flip=0으로 바꾼다.

import { drawMarks, markFont } from "./marks.js";

export { drawMarks };

const VS = `attribute vec2 p; varying vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `precision mediump float; varying vec2 uv; uniform sampler2D tex; uniform float flipY;
void main() { gl_FragColor = texture2D(tex, vec2(uv.x, flipY > 0.5 ? 1.0 - uv.y : uv.y)); }`;

function compile(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "셰이더 오류");
  return shader;
}

export function createGrabber(gl, { flipY = true } = {}) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "셰이더 연결 오류");
  const attr = gl.getAttribLocation(program, "p");
  const uTex = gl.getUniformLocation(program, "tex");
  const uFlip = gl.getUniformLocation(program, "flipY");
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const target = gl.createTexture();
  const fbo = gl.createFramebuffer();
  let size = "";

  /** texture를 width×height로 줄여 그린 RGBA 픽셀(위 줄부터). */
  function grab(texture, width, height) {
    if (size !== `${width}x${height}`) {
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      size = `${width}x${height}`;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uTex, 0);
    gl.uniform1f(uFlip, flipY ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  const encoder = createEncoder();

  /** marks(초점 표시, project.js focusMarks)가 있으면 화면용 프레임 위에 고리를 그린다. 사진에는 넘기지 않는다.
   *  pixels의 버퍼는 워커로 넘어가므로 부른 뒤에는 쓰지 않는다. */
  function toJpeg(pixels, width, height, quality, marks = []) {
    return encoder.encode(pixels, width, height, quality, marks);
  }

  return { grab, toJpeg, get encoderMode() { return encoder.mode; } };
}

const ENCODE_TIMEOUT_MS = 2000;

/** 픽셀 → JPEG Blob. 워커(OffscreenCanvas) 두 개로 두 장까지 동시에 인코딩하고, 워커를 못 쓰면 메인 스레드 canvas.toBlob으로 한다.
 *  메인 스레드 toBlob은 AR 중에 화면을 터치해야 진행되는 일이 있어(encoder-worker.js 설명) 대체 경로로만 쓴다. */
export function createEncoder({ workers: count = 2 } = {}) {
  const pool = []; // { worker, busy }
  let seq = 0;
  const waiting = new Map(); // id → { resolve, reject, slot }
  const drop = (slot, message) => {
    const i = pool.indexOf(slot);
    if (i >= 0) pool.splice(i, 1);
    for (const [id, w] of waiting) {
      if (w.slot !== slot) continue;
      waiting.delete(id);
      w.reject(new Error(message));
    }
  };
  try {
    if (typeof Worker === "function" && typeof OffscreenCanvas === "function") {
      for (let i = 0; i < count; i++) {
        const slot = { worker: new Worker(new URL("./encoder-worker.js", import.meta.url), { type: "module" }), busy: 0 };
        slot.worker.onmessage = ({ data }) => {
          const w = waiting.get(data.id);
          if (!w) return;
          waiting.delete(data.id);
          slot.busy = Math.max(0, slot.busy - 1);
          if (data.blob) w.resolve(data.blob);
          else w.reject(new Error(`JPEG를 만들지 못했어요: ${data.error}`));
        };
        slot.worker.onerror = (event) => {
          // 워커를 띄우지 못하면(모듈 워커 미지원 등) 그 워커를 빼고, 다 빠지면 메인 스레드로 한다
          event.preventDefault?.();
          drop(slot, "인코딩 워커를 쓸 수 없어 다른 경로로 바꿨어요");
        };
        pool.push(slot);
      }
    }
  } catch {
    pool.length = 0;
  }

  let canvas = null;
  let ctx = null;
  async function onMainThread(pixels, width, height, quality, marks) {
    // 이름표 글자의 글꼴 조각(phone 페이지 @font-face)을 받은 뒤 그린다
    const text = marks.map((m) => m.label).join("");
    if (text && document.fonts) await document.fonts.load(markFont(width), text).catch(() => {});
    canvas ??= document.createElement("canvas");
    ctx ??= canvas.getContext("2d");
    canvas.width = width;
    canvas.height = height;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), width, height), 0, 0);
    drawMarks(ctx, marks, width, height);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("JPEG를 만들지 못했어요"))), "image/jpeg", quality));
  }

  function encode(pixels, width, height, quality, marks = []) {
    if (pool.length === 0) return onMainThread(pixels, width, height, quality, marks);
    const slot = pool.reduce((a, b) => (b.busy < a.busy ? b : a));
    return new Promise((resolve, reject) => {
      const id = ++seq;
      slot.busy += 1;
      waiting.set(id, { resolve, reject, slot });
      slot.worker.postMessage({ id, pixels: pixels.buffer, width, height, quality, marks }, [pixels.buffer]);
      setTimeout(() => {
        if (!waiting.delete(id)) return;
        slot.busy = Math.max(0, slot.busy - 1);
        reject(new Error(`JPEG 인코딩이 ${ENCODE_TIMEOUT_MS / 1000}초 안에 끝나지 않았어요`));
      }, ENCODE_TIMEOUT_MS);
    });
  }

  return { encode, get mode() { return pool.length ? `worker×${pool.length}` : "main"; } };
}

/** [헤더 길이 4바이트][JSON 헤더][JPEG] Blob. */
export function framePacket(header, jpeg) {
  const head = new TextEncoder().encode(JSON.stringify(header));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, head.length);
  return new Blob([len, head, jpeg]);
}
