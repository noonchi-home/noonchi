// 하루 마치기·밤 반성 화면 글. 사용자 할 일과 지금 상태만 쓴다. 「PAM」을 쓰지 않는다(우리 부품 이름은 FSM 판단 · 밤 반성 · 채택 검사).

/** 우연일 확률 글: 유효숫자 둘, 0.0001 아래는 「0.0001 미만」. */
export const pText = (p: number): string => (p < 0.0001 ? "0.0001 미만" : String(Number(p.toPrecision(2))));
const pct = (x: number) => Math.round(x * 100);

export const RW = {
  // 설정 창 날짜 줄
  closing: "밤 반성 중",
  skipped: (n: number) => (n === 1 ? "다음 날로 넘김" : `${n}일 넘김`),
  dayLine: (date: string, state: string | null) => (state ? `${date} · ${state}` : date),
  finish: "하루 마치기", cancel: "취소", ask: "하루를 마칠까요?", askLine: "오늘 기록으로 반성하고 다음 날로 넘겨요.", finishFailed: "하루를 마치지 못했어요",
  // 「FSM 바뀜」 칸
  pane: "FSM 바뀜",
  step: { start: "밤 반성 중", chunk: "하루 묶기", did: "사람이 한 일", candidate: "후보", count: "날마다 셈", adopt: "채택 검사", fsm: "FSM 바뀜", end: "밤 반성 끝", failed: "반성 실패", rejected: "반성 기억 안 씀" },
  /** 사람 상태 짧은 이름(사용자 확정 2026-11-27). 표에 없는 상태는 newState. */
  stateName: { drinking: "마시는 중", watching_tv: "TV 보는 중", cooking: "요리 중", away: "자리에 없음", studying: "공부 중" } as Record<string, string>,
  newState: "새 상태",
  maybe: (action: string) => `${action}?`,
  followCount: (k: number, n: number) => `뒤따름 ${k} / ${n}`,
  unseenCount: (n: number) => `못 봄 ${n}`,
  // 사용자가 정한 글 그대로(화면 글 검사 예외 표 scripts/lint-ui-copy.ts COPY_EXCEPTIONS에 있다)
  checkLine: (rate: number, rateMin: number, p: number, alpha: number, passed: boolean) =>
    `${pct(rate)}% (${pct(rateMin)}% 이상) · 우연일 확률 ${pText(p)} (${alpha} 미만) · ${passed ? "통과" : "통과 못 함"}`,
  chance: (p: number) => `우연일 확률 ${pText(p)}`,
  from: (md: string) => `${md}부터`,
  dropReason: { habit: "습관 거르기", chance: "우연", too_few: "횟수 적음", coach: "코치 행동", unchanged: "바뀐 것 없음", settings: "사용자가 정한 습관" },
  // 트윈 이름표
  tagChunk: (from: string, to: string, state: string) => `${from}~${to} · ${state}`,
  tagChunkTime: (from: string, to: string) => `${from}~${to}`,
  didPerson: "직접 함", didAnswer: "답으로 부탁",
  tagDid: (hm: string, action: string, how: string) => `${hm} · ${action} · ${how}`,
  tagCandidate: (action: string) => `후보 · ${action}`,
  tagFollowed: (md: string, gap: string) => `${md} · ${gap} 뒤 따라옴`,
  tagAnsweredNo: (md: string) => `${md} · 답 · 그대로 둬요`,
  tagUnseen: (md: string) => `${md} · 못 봄`,
  tagNotFollowed: (md: string) => `${md} · 따라오지 않음`,
  tagAdopted: (passed: boolean, action: string) => `${passed ? "채택" : "채택 안 함"} · ${action}`,
  tagFrom: (md: string, action: string) => `${md}부터 · ${action}`,
} as const;
