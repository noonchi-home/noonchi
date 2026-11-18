// 합성 일주일(scripts/seed-history.ts) 위에서 도는 밤 흐름 시험의 가짜 시각 찾기 답: 장면 표(dayTimes, weekMarks와 같은 시각)에서 바로 뽑는다(모델 안 부름).
// 받은 기록 줄이 합성 주의 어느 날인지는 기록 DB의 그날 줄(dayLines)과 견줘 찾는다.
import type { HistoryDb } from "../../src/brain/history/db.js";
import { dayLines } from "../../src/brain/history/night.js";
import { LEAVE_ON, TV_START_ON, dayTimes } from "../../scripts/seed-history.js";
import type { MarkView } from "./pam.js";

/** 가짜 시각 찾기: 마시는 중 → * 컵 치우기 후보는 커피 뒤 떠난 때, 자리에 없음 → TV 보는 중 에어컨 켜기 후보는 돌아와 TV를 보기 시작한 때,
 *  에어컨 켜기 행동은 2·3일째 사람이 켠 때(컵 치우기는 사람이 하지 않는다: 답·로봇이 한 구간은 서버가 기록 DB로 센다), 안 보인 구간은 집에 없는 때. */
export function weekMark(db: () => HistoryDb, days: readonly string[]) {
  return (v: MarkView) => {
    const i = days.findIndex((d) => {
      const ls = dayLines(db(), d).map((l) => l.line);
      return ls.length === v.lines.length && ls.every((l, k) => l === v.lines[k]);
    });
    if (i < 0) throw new Error("시각 찾기: 합성 주의 날이 아닌 기록이에요");
    const t = dayTimes(days[i]!, i);
    return {
      candidates: v.candidates.map(([state, candidate]) => ({
        state, candidate, times: state === "drinking" && candidate === LEAVE_ON ? [t.leave] : state === "away" && candidate === TV_START_ON ? [t.tv] : [],
      })),
      actions: v.actions.map((action) => ({ action, times: action === "에어컨 켜기" && t.personAc ? [t.personAc] : [] })),
      unseen: [{ start: t.gone, end: t.tv }],
    };
  };
}
