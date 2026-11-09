// 굽기에 쓴 하늘 사진(HDR)에서 반구광 하늘·아래 색을 한 번 셈해 둔다. 대시보드는 HDR을 받지 않는다.
//   npx tsx ui/scripts/bake-light.ts --hdr <studio_small_09 .hdr> --manifest twin/homes/<집>/bake/manifest.json --out ui/src/twin3d/homes/<집>.light.json
import { readFileSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { hemisphere, irradiance } from "../src/twin3d/irradiance";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const [hdr, manifest, out] = [arg("--hdr"), arg("--manifest"), arg("--out")];
if (!hdr || !manifest || !out) { console.error("쓰는 법: --hdr <파일> --manifest <파일> --out <파일>"); process.exit(2); }
const env = (JSON.parse(readFileSync(manifest, "utf8")) as { light: { environment: { hdri: string; intensity: number } } }).light.environment;
const buf = readFileSync(hdr);
const img = new HDRLoader().setDataType(THREE.FloatType).parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) as { width: number; height: number; data: Float32Array };
writeFileSync(out, `${JSON.stringify({ hemisphere: hemisphere(irradiance(img), env.intensity), from: env }, null, 1)}\n`);
console.log(`반구광 → ${out}`);
