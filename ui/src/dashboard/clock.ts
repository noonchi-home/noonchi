// 시스템 날짜 글(순수 함수): 설정 창 날짜 줄 「11월 27일 (금)」. 날짜는 서버의 시스템 날짜(day 메시지, 하루 마치기로 넘긴 날 포함)다.
// 트윈 칸에는 날짜·시간 칩을 두지 않는다(2026-11-27 사용자 결정).
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

/** 시스템 날짜 YYYY-MM-DD → 「11월 27일 (금)」. */
export function dayText(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEKDAY[d.getUTCDay()]})`;
}
