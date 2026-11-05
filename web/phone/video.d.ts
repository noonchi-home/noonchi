// video.js의 형(테스트에서 TypeScript로 부른다).
export function videoSize(cameraWidth: number, cameraHeight: number, opts?: { long?: number; short?: number; align?: number }): { width: number; height: number };
export function codecCandidates(width: number, height: number): string[];
export function videoPacket(header: object, body: Uint8Array): Uint8Array;
export function createBacklogWatch(opts?: { windowMs?: number; minAttempts?: number; ratio?: number; now?: () => number }): {
  attempt(backedUp: boolean): void;
  check(): boolean;
  reset(): void;
};
export function createSendGate(opts?: { maxBuffered?: number; keyMs?: number }): {
  beforeEncode(buffered: number, nowMs: number): { keyFrame: boolean } | null;
  onChunk(isKey: boolean, buffered: number): { send: boolean; config: boolean };
  configChanged(): void;
  reset(): void;
};
