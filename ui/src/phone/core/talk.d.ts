// talk.js의 형.
export type RecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
export interface TalkHooks { onListening(on: boolean): void; onLine(text: string, ms?: number): void; onHeard(text: string): void }
export interface PressToTalk { down(): void; up(): void }
export function recognition(w?: object): RecognitionCtor | null;
export function createPressToTalk(Recognition: RecognitionCtor, hooks: TalkHooks): PressToTalk;
export function speak(text: string): void;
