// 폰 → 서버 카메라 프레임 바이너리 패킷: [헤더 길이 4바이트(big-endian)][JSON 헤더][JPEG].
// JSON으로 감싸면 base64로 33% 커지므로 /phone/events에 바이너리 메시지로 그대로 보낸다.

import { z } from "zod";
import type { Quat, Vec3 } from "./align.js";

/** ws maxPayload와 같다. 사진(카메라 원본 크기, 품질 0.9)도 이 안에 든다. */
export const MAX_PACKET_BYTES = 4 * 1024 * 1024;
const MAX_HEADER_BYTES = 4096;

const num = z.number().refine(Number.isFinite);
const size = z.number().int().min(1).max(8192);
const HeaderSchema = z.object({
  kind: z.enum(["frame", "photo"]),
  width: size,
  height: size,
  position: z.tuple([num, num, num]).optional(),
  orientation: z.tuple([num, num, num, num]).optional(),
  tracking: z.enum(["ok", "limited"]).optional(),
});

export interface FrameHeader {
  kind: "frame" | "photo";
  width: number;
  height: number;
  position?: Vec3;
  orientation?: Quat;
  tracking?: "ok" | "limited";
}

export function encodeFramePacket(header: FrameHeader, jpeg: Uint8Array): Buffer {
  const head = Buffer.from(JSON.stringify(header), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(head.length, 0);
  return Buffer.concat([len, head, Buffer.from(jpeg)]);
}

export function parseFramePacket(buf: Buffer): { header: FrameHeader; jpeg: Buffer } | { error: string } {
  if (buf.length < 4) return { error: "패킷이 너무 짧습니다" };
  const n = buf.readUInt32BE(0);
  if (n > MAX_HEADER_BYTES || 4 + n > buf.length) return { error: "헤더 길이가 맞지 않습니다" };
  let raw: unknown;
  try {
    raw = JSON.parse(buf.subarray(4, 4 + n).toString("utf8"));
  } catch {
    return { error: "헤더 JSON을 읽지 못했습니다" };
  }
  const parsed = HeaderSchema.safeParse(raw);
  if (!parsed.success) return { error: `헤더가 올바르지 않습니다: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}` };
  const jpeg = buf.subarray(4 + n);
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return { error: "JPEG가 아닙니다" };
  return { header: parsed.data as FrameHeader, jpeg };
}
