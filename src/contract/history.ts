// 기록 DB 계약(GET /api/history·/api/history/day/{날짜}·/api/decisions). 순수 타입만 둔다: ui/가 그대로 가져다 쓴다.
// 만드는 곳은 src/history/db.ts·summary.ts다.

/** 한 시간축 기록 종류. detection 등장·사라짐(사람 포함), vlm VLM 답·VLM 분석 없음, yolo YOLOX 분석 없음(감지 오류·대기열 초과),
 *  world 나머지 World State 변화, pam_text PAM에 보낸 관찰 텍스트, link PAM 연결 끊김·연결됨, trigger 주기 판단 멈춤·다시 시작,
 *  photo 폰 사진 찍기 사진. */
export type HistoryKind =
  | "device" | "detection" | "vlm" | "yolo" | "world" | "pam_text" | "mode" | "decision" | "plan" | "execution" | "reflection" | "feedback" | "photo"
  | "link" | "trigger";

export interface HistoryRow {
  id: number;
  at_ms: number;
  /** 기록 시간대(HISTORY_TZ_MINUTES)의 날짜 YYYY-MM-DD. */
  day: string;
  kind: HistoryKind;
  /** 물건·가전·프레임·판단·계획 id. 없으면 null. */
  subject: string | null;
  text: string;
  data: unknown;
}

/** 하루 요약(반성 입력). dropped는 입력 한도 때문에 뺀 오래된 줄 수. */
export interface DaySummary {
  day: string;
  observation_text: string;
  action_summary: string;
  counts: Partial<Record<HistoryKind, number>>;
  dropped: { observation: number; action: number };
}
