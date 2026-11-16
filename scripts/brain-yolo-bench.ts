// YOLO 속도 재기: 한 줄에 중앙값(ms) 하나씩 찍는다. 무거운 일이라 npm run heavy로 돌린다.
//   - JPEG 풀기: jpeg-js와 sharp
//   - 추론만: 감지 세션·관절 세션을 20번 돌린 값
//   - 한 장 전체: OnnxDetector.detect()(JPEG 풀기 + 레터박스 + 추론 + 마스크)와 그 안의 단계별 값
//
//   npm run heavy -- npx tsx scripts/brain-yolo-bench.ts                                  # models/의 모델, 640, cpu 8스레드와 dml
//   npm run heavy -- npx tsx scripts/brain-yolo-bench.ts --model a.onnx --size 480 --threads 4 --provider cpu
//   npm run heavy -- npx tsx scripts/brain-yolo-bench.ts --jpeg <사진 파일·폴더>           # 그 사진으로(여러 장이면 돌아가며)
//
// --jpeg가 없으면 tests/fixtures/twin-pixels/hub-1920.png을 360×640으로 이어 붙여 만든 JPEG 한 장을 쓴다(tests/helpers/jpeg.ts).
// 기준(계획 2026-11-12-seg-realtime Task 3): 한 장 전체가 dml 80ms 이하, cpu 8스레드 100ms 이하.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { DETECTOR_MODEL, MODELS_DIR, OnnxDetector, POSE_MODEL, jpegDecoder, type DetectResult } from "../src/observe/detector.js";
import { fixtureJpeg } from "../tests/helpers/jpeg.js";

const RUNS = 20, WARMUP = 3;
const median = (a: number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1]!;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function jpegs(path: string | undefined): Buffer[] {
  if (!path) return [fixtureJpeg()];
  if (!existsSync(path)) throw new Error(`없음: ${path}`);
  if (!statSync(path).isDirectory()) return [readFileSync(path)];
  const files = readdirSync(path).filter((f) => /\.jpe?g$/i.test(f)).map((f) => readFileSync(join(path, f)));
  if (!files.length) throw new Error(`JPEG이 없습니다: ${path}`);
  return files;
}

async function time(fn: (i: number) => unknown | Promise<unknown>): Promise<number> {
  for (let i = 0; i < WARMUP; i++) await fn(i);
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    await fn(i);
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
  const pose = join(MODELS_DIR, POSE_MODEL.file);
  const size = Number(arg("size")) || 640;
  const threads = Number(arg("threads")) || 8;
  const providers = (arg("provider") ? [arg("provider")!] : ["cpu", "dml"]) as ("cpu" | "dml")[];
  const files = jpegs(arg("jpeg"));
  const first = jpeg.decode(files[0]!, { useTArray: true });
  const what = `${first.width}×${first.height} ${files.length}장`;

  const jsMs = await time((i) => jpeg.decode(files[i % files.length]!, { useTArray: true, formatAsRGBA: false }));
  console.log(`JPEG 풀기 jpeg-js (${what}): ${jsMs.toFixed(1)}ms`);
  const dec = await jpegDecoder();
  if (dec.name === "sharp") console.log(`JPEG 풀기 sharp (${what}): ${(await time((i) => dec.decode(files[i % files.length]!))).toFixed(1)}ms`);
  else console.log("JPEG 풀기 sharp: 불러오지 못함");

  for (const provider of providers) {
    const tag = provider === "cpu" ? `cpu ${threads}스레드` : provider;
    try {
      const ms = await sessionMs(model, size, provider, threads);
      console.log(`추론만 감지 ${tag} ${size}: ${ms.toFixed(1)}ms (초당 ${(1000 / ms).toFixed(0)}장)`);
      if (size === 640) console.log(`추론만 관절 ${tag} 640: ${(await sessionMs(pose, 640, provider, threads)).toFixed(1)}ms`);
    } catch (e) {
      console.log(`추론만 ${tag} ${size}: 실패 ${String((e as Error).message).slice(0, 160)}`);
    }
  }

  // 한 장 전체는 감지기(640 고정)로 잰다
  if (size !== 640) return;
  for (const provider of providers) {
    const tag = provider === "cpu" ? `cpu ${threads}스레드` : provider;
    try {
      const det = await OnnxDetector.create({ modelPath: model, provider, threads });
      try {
        const got: DetectResult[] = [];
        for (let i = 0; i < WARMUP + RUNS; i++) {
          const r = await det.detect(files[i % files.length]!);
          if (i >= WARMUP) got.push(r);
        }
        const step = (k: keyof NonNullable<DetectResult["steps"]>) => median(got.map((r) => r.steps![k])).toFixed(1);
        const all = median(got.map((r) => r.ms));
        console.log(`한 장 전체 ${tag} (${what}, JPEG ${det.decoder}): ${all.toFixed(1)}ms (초당 ${(1000 / all).toFixed(0)}장) = 풀기 ${step("decode")} + 레터박스 ${step("letterbox")} + 추론 ${step("infer")} + 마스크 ${step("masks")}, 감지 평균 ${(got.reduce((a, r) => a + r.detections.length, 0) / got.length).toFixed(1)}개`);
      } finally {
        await det.close();
      }
    } catch (e) {
      console.log(`한 장 전체 ${tag}: 실패 ${String((e as Error).message).slice(0, 160)}`);
    }
  }
}

await main();
