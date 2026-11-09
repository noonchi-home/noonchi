// 시험 자료 PNG 읽기: 8비트 RGB·RGBA, 비월 없음만. 화소를 [r, g, b] 배열로 준다.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export function readPng(path: string): { width: number; height: number; pixels: [number, number, number][] } {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: PNG가 아니에요`);
  let width = 0, height = 0, channels = 0;
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, color, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) throw new Error(`${path}: 8비트 RGB·RGBA(비월 없음)만 읽어요`);
      channels = color === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      if (pred === undefined) throw new Error(`${path}: 모르는 필터 ${filter}`);
      out[y * stride + x] = (row[x]! + pred) & 0xff;
    }
  }
  const pixels: [number, number, number][] = [];
  for (let i = 0; i < out.length; i += channels) pixels.push([out[i]!, out[i + 1]!, out[i + 2]!]);
  return { width, height, pixels };
}
