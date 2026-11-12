// YOLO 속도 재기: 세션 추론만 20번 돌린 중앙값(ms)과 JPEG 풀기 시간을 한 줄씩 찍는다. 무거운 일이라 npm run heavy로 돌린다.
//
//   npm run heavy -- npx tsx scripts/brain-yolo-bench.ts                                  # models/의 감지 모델, 640, cpu 8스레드와 dml
//   npm run heavy -- npx tsx scripts/brain-yolo-bench.ts --model a.onnx --size 480 --threads 4 --provider cpu
//   npm run heavy -- npx tsx scripts/brain-yolo-bench.ts --jpeg <사진 파일·폴더>           # 풀기 시간을 그 사진으로
//
// --jpeg가 없으면 tests/fixtures/twin-pixels/hub-1920.png을 360×640으로 이어 붙여 JPEG(품질 80)로 만든 한 장을 쓴다.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { DETECTOR_MODEL, MODELS_DIR } from "../src/brain/detector.js";
import { readPng } from "../tests/helpers/png.js";

const RUNS = 20, WARMUP = 3;
export const median = (a: number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1]!;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 고정 자료 PNG를 width×height로 이어 붙인 JPEG 한 장(폰 엔진 프레임 크기). */
export function fixtureJpeg(width = 360, height = 640): Buffer {
  const png = readPng(join("tests", "fixtures", "twin-pixels", "hub-1920.png"));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = png.pixels[(y % png.height) * png.width + (x % png.width)]!;
    data.set([r, g, b, 255], (y * width + x) * 4);
  }
  return Buffer.from(jpeg.encode({ data, width, height }, 80).data);
}

export function jpegs(path: string | undefined): Buffer[] {
  if (!path) return [fixtureJpeg()];
  if (!existsSync(path)) throw new Error(`없음: ${path}`);
  if (!statSync(path).isDirectory()) return [readFileSync(path)];
  return readdirSync(path).filter((f) => /\.jpe?g$/i.test(f)).map((f) => readFileSync(join(path, f)));
}

export async function time(fn: () => unknown | Promise<unknown>, runs = RUNS, warmup = WARMUP): Promise<number> {
  for (let i = 0; i < warmup; i++) await fn();
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await fn();
    ms.push(performance.now() - t);
  }
  return median(ms);
}

async function sessionMs(model: string, size: number, provider: string, threads: number): Promise<number> {
  const ort = await import("onnxruntime-node");
  const s = await ort.InferenceSession.create(model, { intraOpNumThreads: threads, executionProviders: [provider] });
  try {
    const input = new ort.Tensor("float32", new Float32Array(3 * size * size).fill(0.4), [1, 3, size, size]);
    return await time(() => s.run({ [s.inputNames[0]!]: input }));
  } finally {
    await s.release();
  }
}

async function main(): Promise<void> {
  const model = arg("model") ?? join(MODELS_DIR, DETECTOR_MODEL.file);
  const size = Number(arg("size")) || 640;
  const threads = Number(arg("threads")) || 8;
  const providers = arg("provider") ? [arg("provider")!] : ["cpu", "dml"];
  const files = jpegs(arg("jpeg"));

  let k = 0;
  const jsMs = await time(() => jpeg.decode(files[k++ % files.length]!, { useTArray: true, formatAsRGBA: true }));
  const first = jpeg.decode(files[0]!, { useTArray: true });
  console.log(`JPEG 풀기 jpeg-js ${first.width}×${first.height} (${files.length}장): 중앙값 ${jsMs.toFixed(1)}ms`);

  for (const provider of providers) {
    const t = provider === "cpu" ? threads : 1;
    try {
      const ms = await sessionMs(model, size, provider, t);
      console.log(`추론 ${provider} ${size} ${provider === "cpu" ? `${t}스레드` : ""}: 중앙값 ${ms.toFixed(1)}ms (초당 ${(1000 / ms).toFixed(0)}장)`);
    } catch (e) {
      console.log(`추론 ${provider} ${size}: 실패 ${String((e as Error).message).slice(0, 160)}`);
    }
  }
}

await main();
