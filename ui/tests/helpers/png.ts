// 시험용 PNG 읽기: 8비트 RGBA(색 종류 6), 겹침 없는 PNG를 픽셀로 푼다(node:zlib). 브랜드 마스코트 그림 픽셀을 시험에서 본다.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export interface Png { width: number; height: number; at: (x: number, y: number) => [number, number, number, number] }

export function readPng(file: string): Png {
  const b = readFileSync(file);
  if (b.toString("latin1", 1, 4) !== "PNG") throw new Error(`${file}: PNG가 아니에요`);
  let o = 8, width = 0, height = 0;
  const idat: Buffer[] = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const type = b.toString("latin1", o + 4, o + 8);
    const data = b.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error(`${file}: 8비트 RGBA·겹침 없음만 읽어요`);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? px[y * stride + i - 4]! : 0;
      const up = y > 0 ? px[(y - 1) * stride + i]! : 0;
      const c = y > 0 && i >= 4 ? px[(y - 1) * stride + i - 4]! : 0;
      const p = a + up - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - up), Math.abs(p - c)];
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      const add = f === 0 ? 0 : f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : paeth;
      px[y * stride + i] = (src[i]! + add) & 0xff;
    }
  }
  const at = (x: number, y: number): [number, number, number, number] => {
    const i = (Math.round(y) * width + Math.round(x)) * 4;
    return [px[i]!, px[i + 1]!, px[i + 2]!, px[i + 3]!];
  };
  return { width, height, at };
}
