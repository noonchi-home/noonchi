// 두뇌(BRAIN=1)의 YOLO 모델 받기: Megvii 공식 YOLOX ONNX(Apache-2.0)를 runtime/models/에 받고 sha256을 맞춰 본다.
// runtime/은 커밋하지 않는다. 다른 모델은 BRAIN_DETECTOR=yolox_nano 등으로 고른다.
//
//   npx tsx scripts/brain-yolo-fetch.ts            # yolox_tiny(기본, 약 20MB)
//   npx tsx scripts/brain-yolo-fetch.ts yolox_nano # 더 가볍고 덜 정확(약 3.7MB)

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { YOLOX_MODELS, type YoloxModel } from "../src/brain/detector.js";

const name = (process.argv[2] ?? "yolox_tiny") as YoloxModel;
const model = YOLOX_MODELS[name];
if (!model) {
  console.error(`모르는 모델: ${name} (${Object.keys(YOLOX_MODELS).join(", ")})`);
  process.exit(1);
}
const dir = fileURLToPath(new URL("../runtime/models/", import.meta.url));
const path = join(dir, model.file);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

if (existsSync(path) && sha(readFileSync(path)) === model.sha256) {
  console.log(`이미 있음(sha256 맞음): ${path}`);
  process.exit(0);
}
console.log(`받는 중: ${model.url}`);
const res = await fetch(model.url);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const body = Buffer.from(await res.arrayBuffer());
const got = sha(body);
if (got !== model.sha256) throw new Error(`sha256이 다릅니다(받은 ${got}, 기대 ${model.sha256}). 파일을 쓰지 않았어요.`);
mkdirSync(dir, { recursive: true });
writeFileSync(`${path}.part`, body);
renameSync(`${path}.part`, path);
console.log(`저장: ${path} (${(body.length / 1e6).toFixed(1)}MB, sha256 맞음)`);
