// talk.js의 형.
export type RecognitionCtor = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal?: boolean } & ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
/** on 듣는 중, paused 폰이 읽는 동안 멈춤, denied 마이크 꺼짐, off 꺼짐. */
export type ListenState = "on" | "paused" | "denied" | "off";
export interface ListenHooks { onState(state: ListenState): void; onHeard(text: string): void }
export interface Listener { start(): void; stop(): void; pause(): void; resume(): void }
export function recognition(w?: object): RecognitionCtor | null;
export function createListener(Recognition: RecognitionCtor, hooks: ListenHooks, opts?: { restartMs?: number }): Listener;
export function speak(text: string, done?: () => void): void;
