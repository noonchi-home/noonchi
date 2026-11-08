// capture.js의 형(시험이 TypeScript로 부른다).
import type { FocusMark } from "./marks.js";

export { drawMarks } from "./marks.js";
export interface JpegEncoder {
  readonly mode: string;
  encode(pixels: Uint8Array, width: number, height: number, quality: number, marks?: FocusMark[]): Promise<Blob>;
  /** 워커를 끝내고 기다리던 요청을 거절한다. 그 뒤 encode는 거절한다. */
  close(): void;
}
export interface Grabber {
  readonly encoderMode: string;
  grab(texture: unknown, width: number, height: number): Uint8Array;
  toJpeg(pixels: Uint8Array, width: number, height: number, quality: number, marks?: FocusMark[]): Promise<Blob>;
  close(): void;
}
export function createGrabber(gl: unknown, opts?: { flipY?: boolean }): Grabber;
export function createEncoder(opts?: { workers?: number }): JpegEncoder;
export function framePacket(header: object, jpeg: Blob): Blob;
