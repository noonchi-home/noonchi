// display-encoder.js의 형(테스트에서 TypeScript로 부른다).
/** 프레임 시각(ms, XR 프레임 시각 = performance.now 기준) → 패킷에 붙일 서버 시계 촬영 시각과 오차. 시계를 아직 못 맞췄으면 빈 객체. */
export type DisplayStamp = (frameMs: number) => { captured_at?: number; time_err_ms?: number };
export interface VideoSocket { readonly readyState: number; readonly bufferedAmount: number; send(data: Uint8Array): void }
export interface VideoSender {
  readonly state: "idle" | "configuring" | "ready" | "failed";
  readonly size: { width: number; height: number } | null;
  frame(make: (size: { width: number; height: number }, timestamp: number) => { close(): void }, sourceWidth: number, sourceHeight: number, timeMs: number): void;
  describe(path?: string): string;
  close(reason?: string): void;
}
export function displaySupported(): boolean;
export function createVideoSender(opts: {
  socket: () => VideoSocket | null;
  params?: URLSearchParams;
  onError?: (text: string) => void;
  onSlow?: () => boolean;
  stamp?: DisplayStamp;
}): VideoSender | null;
