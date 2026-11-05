// eye-video.js의 형(테스트에서 TypeScript로 부른다).
export interface StreamMessage { header: Record<string, unknown>; body: Uint8Array }
export function createStreamParser(opts?: { maxMessageBytes?: number }): { push(bytes: Uint8Array): StreamMessage[] };
export function createDisplayMode(opts?: { staleMs?: number; now?: () => number }): { frame(): void; reset(): void; readonly mode: "video" | "jpeg" };
export function createDecodeGate(opts?: { maxQueue?: number }): { accept(key: boolean, queueSize?: number): boolean; reset(): void };
export function displayCaption(display: { codec: string | null; width: number | null; height: number | null; fps: number; kbps: number } | null | undefined): string | null;
export function runDecoder(opts: { canvas: unknown; url: string; onMode?: (mode: "video" | "jpeg") => void; onStats?: (s: object) => void; statsMs?: number; retryMs?: number }): { close(): void };
export function attachEyeVideo(opts: { canvas: unknown; img: unknown; onShown?: () => void; url?: string }): { readonly mode: "video" | "jpeg"; close(): void };
