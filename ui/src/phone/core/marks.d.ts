// marks.js의 형(테스트에서 TypeScript로 부른다).
export interface FocusMark { id: string; label: string; u: number; v: number; off: boolean; angle: number }
/** CanvasRenderingContext2D·OffscreenCanvasRenderingContext2D 중 marks.js가 쓰는 것. */
export interface MarkContext {
  lineWidth: number; strokeStyle: unknown; fillStyle: unknown; lineJoin?: unknown;
  save(): void; restore(): void; beginPath(): void; closePath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  stroke(): void; fill(): void;
}
export function markFont(width: number): string;
export function drawMarks(ctx: MarkContext, marks: FocusMark[], width: number, height: number): void;
