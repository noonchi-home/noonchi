// 폰 → 서버 바이너리 패킷: [헤더 길이 4바이트(big-endian)][JSON 헤더][본문].
// JSON으로 감싸면 base64로 33% 커지므로 /phone/events에 바이너리 메시지로 그대로 보낸다.
// 본문: engine(분석용)·frame(표시용)·photo는 JPEG, video_config는 H.264 디코더 설정(avcC), video는 H.264 청크(표시 전용, src/phone/video.ts).

import { z } from "zod";
import type { Quat, Vec3 } from "./align.js";

/** ws maxPayload와 같다. 사진(카메라 원본 크기, 품질 0.9)도 이 안에 든다. */
export const MAX_PACKET_BYTES = 4 * 1024 * 1024;
const MAX_HEADER_BYTES = 4096;
/** H.264 디코더 설정(avcC)은 보통 100바이트 안팎이다. 서버가 붙는 화면마다 다시 보내므로 크기를 묶는다. */
const MAX_DESCRIPTION_BYTES = 64 * 1024;

const num = z.number().refine(Number.isFinite);
const size = z.number().int().min(1).max(8192);
const HeaderSchema = z.object({
  kind: z.enum(["frame", "photo", "engine"]),
  width: size,
  height: size,
  position: z.tuple([num, num, num]).optional(),
  orientation: z.tuple([num, num, num, num]).optional(),
  tracking: z.enum(["ok", "limited"]).optional(),
  /** 찍은 순간의 AR 원점(session.ts). 사진 위치는 이 원점이 지금 맞춤과 같을 때만 붙인다. */
  epoch: z.string().min(1).max(64).optional(),
  /** 서버 시계로 옮긴 촬영 시각(ms)과 그 오차(clock 핑 왕복의 절반). 관찰 흐름이 촬영 시각으로 쓴다(src/observe/ring.ts captureTime). */
  captured_at: num.optional(),
  time_err_ms: z.number().min(0).max(60_000).optional(),
  /** 엔진 프레임: 찍은 순간 XRView.projectionMatrix(16개, 열 우선). 물건의 트윈 위치를 구할 때 쓴다. */
  projection: z.array(num).length(16).optional(),
  /** 엔진 프레임: 붙잡은 장면 다시 보내기(true만). 관찰 흐름이 같은 사진도 VLM 간격마다 받는다. */
  held: z.literal(true).optional(),
});
// 코덱 이름은 대시보드가 VideoDecoder에 그대로 넘기므로 avc1.42E01F 같은 모양만 받는다
const VideoHeaderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("video_config"), codec: z.string().regex(/^[A-Za-z0-9.]{1,64}$/), width: size, height: size }),
  z.object({ kind: z.literal("video"), key: z.boolean(), ts: z.number().int().min(0), width: size, height: size }),
]);

export interface FrameHeader {
  kind: "frame" | "photo" | "engine";
  width: number;
  height: number;
  position?: Vec3;
  orientation?: Quat;
  tracking?: "ok" | "limited";
  epoch?: string;
  captured_at?: number;
  time_err_ms?: number;
  /** 엔진 프레임의 투영 행렬(16개, 열 우선). */
  projection?: number[];
  /** 엔진 프레임: 붙잡은 장면을 다시 보낸 것(영상 시험의 단계 영상 끝 장면). 같은 사진이어도 VLM 간격마다 새 관찰로 받는다(src/observe/ring.ts). */
  held?: true;
}

/** 표시 영상 패킷 헤더. ts는 폰 인코더 시각(µs), width·height는 인코딩 크기. */
export type VideoHeader =
  | { kind: "video_config"; codec: string; width: number; height: number }
  | { kind: "video"; key: boolean; ts: number; width: number; height: number };

export type ParsedPacket = { header: FrameHeader; jpeg: Buffer } | { video: VideoHeader; data: Buffer } | { error: string };

export function encodeFramePacket(header: FrameHeader | VideoHeader, body: Uint8Array): Buffer {
  const head = Buffer.from(JSON.stringify(header), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(head.length, 0);
  return Buffer.concat([len, head, Buffer.from(body)]);
}

const issues = (e: z.ZodError) => `헤더가 올바르지 않습니다: ${e.issues.map((i) => i.path.join(".")).join(", ")}`;

/** 패킷 하나를 JPEG(engine·frame·photo) 또는 영상(video_config·video)으로 읽는다. */
export function parsePacket(buf: Buffer): ParsedPacket {
  if (buf.length < 4) return { error: "패킷이 너무 짧습니다" };
  const n = buf.readUInt32BE(0);
  if (n > MAX_HEADER_BYTES || 4 + n > buf.length) return { error: "헤더 길이가 맞지 않습니다" };
  let raw: unknown;
  try {
    raw = JSON.parse(buf.subarray(4, 4 + n).toString("utf8"));
  } catch {
    return { error: "헤더 JSON을 읽지 못했습니다" };
  }
  const body = buf.subarray(4 + n);
  const kind = (raw as { kind?: unknown } | null)?.kind;
  if (kind === "video" || kind === "video_config") {
    const parsed = VideoHeaderSchema.safeParse(raw);
    if (!parsed.success) return { error: issues(parsed.error) };
    if (parsed.data.kind === "video" && body.length === 0) return { error: "영상 청크가 비었습니다" };
    if (parsed.data.kind === "video_config" && body.length > MAX_DESCRIPTION_BYTES) return { error: "디코더 설정이 너무 큽니다" };
    return { video: parsed.data, data: body };
  }
  const parsed = HeaderSchema.safeParse(raw);
  if (!parsed.success) return { error: issues(parsed.error) };
  if (body.length < 2 || body[0] !== 0xff || body[1] !== 0xd8) return { error: "JPEG가 아닙니다" };
  return { header: parsed.data as FrameHeader, jpeg: body };
}

/** JPEG 패킷(engine·frame·photo)만 받는다. */
export function parseFramePacket(buf: Buffer): { header: FrameHeader; jpeg: Buffer } | { error: string } {
  const packet = parsePacket(buf);
  return "video" in packet ? { error: "JPEG 패킷이 아닙니다" } : packet;
}
