// 두뇌(BRAIN=1)의 YOLO 모델 확인·받기·넣기. 모델 표와 sha256은 src/brain/detector.ts(DETECTOR_MODELS·POSE_MODELS) 하나다.
//
//   npx tsx scripts/brain-yolo-fetch.ts                 # 저장소 models/의 yolo26n.onnx·yolo26n-pose.onnx sha256 확인(기본 모델, 받지 않음)
//   npx tsx scripts/brain-yolo-fetch.ts --from <폴더>   # 다시 내보낸 두 파일을 sha256이 표와 같을 때만 models/에 넣는다
//   npx tsx scripts/brain-yolo-fetch.ts yolox_tiny      # YOLOX(Megvii 공식 ONNX, Apache-2.0)를 runtime/models/에 받는다. BRAIN_DETECTOR=yolox_tiny로 고른다
//
// 다시 내보내는 법은 THIRD_PARTY.md 「모델」에 있다. 내보낸 파일의 sha256이 표와 다르면 넣지 않고 새 값을 알린다.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DETECTOR_MODELS, MODELS_DIR, POSE_MODELS } from "../src/brain/detector.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const BUNDLED = [DETECTOR_MODELS.yolo26n, POSE_MODELS["yolo26n-pose"]].map((m) => ({ file: m.file, sha256: m.sha256 }));
const args = process.argv.slice(2);

/** 커밋한 모델 확인: 없거나 sha256이 다르면 실패. */
function check(): void {
  let bad = 0;
  for (const m of BUNDLED) {
    const path = join(MODELS_DIR, m.file);
    const got = existsSync(path) ? sha(readFileSync(path)) : null;
    if (got === m.sha256) console.log(`맞음: ${path}`);
    else {
      bad++;
      console.error(got ? `sha256이 다릅니다: ${path} (지금 ${got}, 표 ${m.sha256})` : `없음: ${path}`);
    }
  }
  if (bad) process.exit(1);
}

/** 다시 내보낸 파일 넣기: 두 파일 모두 sha256이 표와 같을 때만 복사한다. */
function install(dir: string): void {
  const found = BUNDLED.map((m) => {
    const src = join(dir, m.file);
    if (!existsSync(src)) throw new Error(`없음: ${src}`);
    return { ...m, src, got: sha(readFileSync(src)) };
  });
  const diff = found.filter((f) => f.got !== f.sha256);
  if (diff.length) {
    for (const f of diff) console.error(`sha256이 표와 다릅니다: ${f.src}\n  받은 ${f.got}\n  표   ${f.sha256}`);
    console.error("넣지 않았어요. 이 파일을 쓰려면 src/brain/detector.ts 표와 Dockerfile의 sha256을 새 값으로 바꾸고 다시 돌리세요.");
    process.exit(1);
  }
  mkdirSync(MODELS_DIR, { recursive: true });
  for (const f of found) copyFileSync(f.src, join(MODELS_DIR, f.file));
  console.log(`넣음: ${found.map((f) => f.file).join(", ")} → ${MODELS_DIR}`);
}

/** YOLOX 받기(runtime/models/). */
async function fetchYolox(name: "yolox_tiny" | "yolox_nano"): Promise<void> {
  const model = DETECTOR_MODELS[name];
  const dir = fileURLToPath(new URL("../runtime/models/", import.meta.url));
  const path = join(dir, model.file);
  if (existsSync(path) && sha(readFileSync(path)) === model.sha256) {
    console.log(`이미 있음(sha256 맞음): ${path}`);
    return;
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
}

const [first, second] = args;
if (!first || first === "yolo26n" || first === "yolo26n-pose") check();
else if (first === "--from" && second) install(second);
else if (first === "yolox_tiny" || first === "yolox_nano") await fetchYolox(first);
else {
  console.error(`모르는 인자: ${args.join(" ")} (없음·--from <폴더>·yolox_tiny·yolox_nano)`);
  process.exit(1);
}
