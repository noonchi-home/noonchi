const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** ms → 그 시간대(분)의 ISO 시각. 예: 2026-11-04T12:00:01.000+09:00 */
export function isoWithOffset(ms: number, offsetMinutes: number): string {
  const local = new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 23);
  const a = Math.abs(offsetMinutes);
  return `${local}${offsetMinutes >= 0 ? "+" : "-"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
