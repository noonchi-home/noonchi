// 두뇌(BRAIN=1)의 YOLO 모델 확인·넣기. 모델 이름과 sha256은 src/brain/detector.ts(DETECTOR_MODEL·POSE_MODEL) 하나다.
//
//   npx tsx scripts/brain-yolo-fetch.ts                 # 저장소 models/의 yolo26n-seg.onnx·yolo26n-pose.onnx sha256 확인(받지 않음)
//   npx tsx scripts/brain-yolo-fetch.ts --from <폴더>   # 다시 내보낸 두 파일을 sha256이 표와 같을 때만 models/에 넣는다
//
// 다시 내보내는 법은 THIRD_PARTY.md 「모델」에 있다. 내보낸 파일의 sha256이 표와 다르면 넣지 않고 새 값을 알린다.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DETECTOR_MODEL, MODELS_DIR, POSE_MODEL } from "../src/brain/detector.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const BUNDLED = [DETECTOR_MODEL, POSE_MODEL];
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

const [first, second] = args;
if (!first) check();
else if (first === "--from" && second) install(second);
else {
  console.error(`모르는 인자: ${args.join(" ")} (없음·--from <폴더>)`);
  process.exit(1);
}
