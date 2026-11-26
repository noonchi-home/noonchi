// 하루 요약(출처: docs/provenance.md): 관찰 텍스트(등장·사라짐, World State 변화, 가전 변화, 하루 분석 수)와
// 행동 요약(판단·실행·사용자 말)을 시각 순으로. 프레임마다 쓰는 vlm·yolo 줄은 세기만 한다. 이어진 같은 줄은 묶는다.
// maxBytes(UTF-8)를 넘으면 오래된 줄부터 빼고 첫 줄에 「앞선 기록 N줄 생략」을 둔다. 관찰 텍스트가 70%, 행동 요약이 30%를 쓰고, 한쪽이 덜 쓰면 남는 몫을 다른 쪽이 쓴다.
// caps는 칸마다의 상한(바이트, PAM 반성 칸 상한)이다.
import type { DaySummary, HistoryKind } from "../../contract/history.js";
import { collapseLines } from "../../world/index.js";
import type { HistoryDb } from "./db.js";
import { SUMMARY_TEXT } from "./labels.js";

const OBSERVED: HistoryKind[] = ["detection", "world", "device"];
const ACTED: HistoryKind[] = ["decision", "execution", "feedback"];
const PREFIX: Partial<Record<HistoryKind, string>> = { decision: SUMMARY_TEXT.decision, execution: SUMMARY_TEXT.execution, feedback: SUMMARY_TEXT.feedback };
const bytes = (s: string) => Buffer.byteLength(s, "utf8");
const joinedBytes = (lines: string[]) => lines.reduce((a, l) => a + bytes(l) + 1, 0);

/** 다 들어가면 그대로. 아니면 최근 줄부터 budget 바이트까지 담고 뺀 줄 수를 첫 줄에 적는다. tail은 늘 끝에 둔다. */
function fit(lines: string[], budget: number, tail: string[] = []): { text: string; dropped: number } {
  const all = [...lines, ...tail];
  if (joinedBytes(all) - 1 <= budget) return { text: all.join("\n"), dropped: 0 };
  let used = joinedBytes(tail) + bytes(SUMMARY_TEXT.dropped(lines.length)) + 1;
  let i = lines.length;
  while (i > 0 && used + bytes(lines[i - 1]!) + 1 <= budget) used += bytes(lines[--i]!) + 1;
  return { text: [...(i ? [SUMMARY_TEXT.dropped(i)] : []), ...lines.slice(i), ...tail].join("\n"), dropped: i };
}

/** YYYY-MM-DD이고 달력에 있는 날짜인가. */
export function isDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === day;
}

export function daySummary(db: HistoryDb, day: string, o: { maxBytes?: number; caps?: { observation: number; action: number } } = {}): DaySummary {
  // 판단 줄에는 그 판단의 사람 상태(판단 기록 fsm.state, 임시 상태 포함)를 붙인다: 반성이 기억에 없던 활동을 본다
  const stateOf = (data: unknown) => (data as { fsm?: { state?: unknown } | null } | null)?.fsm?.state;
  const lines = (kinds: HistoryKind[]) =>
    collapseLines(db.list({ day, kinds, limit: 10_000_000 }).map((r) => {
      const state = r.kind === "decision" ? stateOf(r.data) : undefined;
      return { atMs: r.at_ms, text: `${PREFIX[r.kind] ?? ""}${r.text}${typeof state === "string" ? SUMMARY_TEXT.state(state) : ""}` };
    }), db.offsetMinutes);
  const observed = lines(OBSERVED);
  const acted = lines(ACTED);
  const counts = db.counts(day);
  // 프레임마다 쓰는 vlm·yolo 줄은 넣지 않고 센다. 대기열 초과 yolo 줄은 VLM도 분석하지 않았다
  const n = db.analysisTally(day);
  const tail = [SUMMARY_TEXT.tally(n.vlm, n.vlmMissing, n.yoloMissing)];
  const total = o.maxBytes ?? Number.POSITIVE_INFINITY;
  const caps = o.caps ?? { observation: Number.POSITIVE_INFINITY, action: Number.POSITIVE_INFINITY };
  const actFull = Math.max(0, joinedBytes(acted) - 1);
  const obs = fit(observed, Math.min(caps.observation, Math.max(Math.floor(total * 0.7), total - actFull)), tail);
  const act = fit(acted, Math.min(caps.action, total - bytes(obs.text)));
  return { day, observation_text: obs.text, action_summary: act.text, counts, dropped: { observation: obs.dropped, action: act.dropped } };
}
