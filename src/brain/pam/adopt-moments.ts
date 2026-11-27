// 후보가 일어날 때마다의 판정(화면용). 창 규칙은 채택 검사(src/brain/pam/adopt.ts checkCandidate)와 같다: 반열린 창 [후보+1, 후보+창+1),
// 같은 후보가 다시 나오면 거기까지, 행동 → 답(따라오지 않음) → 못 봄 → 따라오지 않음 차례. 셈 파일(adopt.ts)은 바꾸지 않는다.
import type { MomentVerdict } from "../../contract/reflection.js";
import { FOLLOW_SECONDS, type CheckDay } from "./adopt.js";

export interface CandidateMoment { at: number; verdict: MomentVerdict; action_at: number | null; via: "person" | "answer" | null }

/** asked: 묻기 답으로 센 행동 시각(via answer). 시각은 자정부터 초. */
export function candidateMoments(d: CheckDay & { asked?: readonly number[] }, window = FOLLOW_SECONDS): CandidateMoment[] {
  const ordered = [...d.candidate].sort((a, b) => a - b);
  return ordered.map((moment, i) => {
    const low = moment + 1;
    let high = moment + window + 1;
    const repeat = ordered.slice(i + 1).find((later) => later > moment);
    if (repeat !== undefined && repeat < high) high = repeat;
    const act = d.action.filter((a) => low <= a && a < high).sort((a, b) => a - b)[0];
    if (act !== undefined) return { at: moment, verdict: "followed", action_at: act, via: d.asked?.includes(act) ? "answer" : "person" };
    if ((d.answered ?? []).some((a) => low <= a && a < high)) return { at: moment, verdict: "answered_no", action_at: null, via: null };
    if (d.unseen.some(([s, e]) => s < high && e > low)) return { at: moment, verdict: "unseen", action_at: null, via: null };
    return { at: moment, verdict: "not_followed", action_at: null, via: null };
  });
}
