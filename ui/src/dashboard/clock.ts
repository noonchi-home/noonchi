// 트윈 오른쪽 위 날짜·시간 칩 글(순수 함수). 시각은 브라우저 시계이고 시간대는 서버 기록 시간대(HISTORY_TZ_MINUTES, /api/health tz_minutes)다:
// 서버에는 따로 도는 시뮬레이션 시계가 없어 서버 시각과 브라우저 시각은 같은 실제 시각이고, 시간대만 기록 DB의 날(반성·기록의 하루)과 맞춘다.
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const two = (n: number) => String(n).padStart(2, "0");

/** ms 시각을 tzMinutes 시간대로 「11월 17일 (화) 01:30」. */
export function clockText(ms: number, tzMinutes: number): string {
  const d = new Date(ms + tzMinutes * 60_000);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEKDAY[d.getUTCDay()]}) ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** 다음 분이 바뀔 때까지 남은 ms(분 첫 순간이면 1분). */
export const untilNextMinute = (ms: number) => 60_000 - (((ms % 60_000) + 60_000) % 60_000);
