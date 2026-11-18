// 메시지 상자 문장(대시보드 생각 말풍선 줄): 모델 없이 판단 기록·실행 추적이 가진 사실로만 만든다(2026-11-18 사용자 결정: 작은 모델이 PAM 판단·계획에
// 없는 「물기를 닦을게요」를 지어냈다). 말투는 채팅처럼 클로이드가 직접 하는 말이다(「컵을 치울게요」).
// - 행동을 고른 판단: 맞은 FSM 규칙 하나(판단 기록 fsm, matched이고 트리거가 있음)면 「<그 규칙 조건> <행동 허락> 된다고 하셨어요」 한 줄.
//   시연 기억 규칙은 사용자가 정한 짧은 조건형(src/world/labels.ts RULE_IF: 「컵을 두고 자리를 뜨면」, 덧조건 없음), 배운 규칙은 트리거를 줄이지 않고 ruleIf로 그대로. 허락형은 src/act/tasks.ts TASK_SAY.
//   규칙을 특정하지 못하면(규칙 여럿이라 트리거 없음·규칙 없이 고른 행동) 줄이 없다(상태 이름으로 조건을 지어내지 않는다).
// - 그다음 줄 「컵을 치울게요」와 단계 줄 「식탁으로 갈게요」는 말풍선 말(say, src/act/say.ts)이 잇는다.
// - 대기·실패 판단은 줄을 만들지 않는다. 그동안의 줄은 실행 추적이 올리는 사실 줄(note: 쓰는 중 지킴·찾기)이다.
// 이미 올린 말(최근 메시지)과 같은 줄은 다시 올리지 않는다. 새 줄은 id(판단 id@시각:차례)·판단 id·시각을 붙여 보내고(send) 기록 DB(thought, 집 id 포함)에
// 하나씩 남긴다. 최근 것은 새로 붙은 대시보드·다시 띄운 서버에 다시 보낸다. 닫으면(close, 집·서버 종료) 보내지 않는다. 보내기·기록 오류는 받아 넘긴다.
import { josa } from "../shared/korean.js";
import { TASK_SAY } from "../act/tasks.js";
import { ruleIf } from "../world/labels.js";
import type { BrainLog, ThoughtEvent, ThoughtMessage } from "../contract/events.js";
import type { HistoryDb } from "./history/db.js";

/** 최근 메시지를 두는 수: 새로 붙은 대시보드·다시 띄운 서버에 다시 보낸다. 메시지 상자에는 3줄이 보인다. */
export const THOUGHT_KEEP = 5;
/** 최근 메시지의 나이 상한(ms): 이보다 오래된 메시지는 다시 보내지도, 다시 띄울 때 되살리지도 않는다. */
export const THOUGHT_KEEP_MS = 10 * 60_000;

type Decision = Extract<BrainLog, { type: "decision" }>;

/** 같은 말인가(빈칸·끝 마침표 차이는 같다). */
const same = (a: string, b: string) => a.replace(/\s+/g, "").replace(/[.。]+$/, "") === b.replace(/\s+/g, "").replace(/[.。]+$/, "");

/** 판단 기록 → 메시지 상자 문장(사실로만): 맞은 규칙 하나의 허락 한 줄. 행동을 고른 유효 판단이 아니거나 규칙을 특정하지 못하면 빈 목록. */
export function decisionLines(e: Decision): string[] {
  const action = e.action;
  const trigger = e.status === "valid" && action && e.fsm?.matched ? e.fsm.trigger : null;
  if (!action || !trigger) return [];
  return [`${ruleIf({ trigger, action, learned: e.fsm?.learned ?? false })} ${TASK_SAY[action]?.may ?? `${josa(action, "을/를")} 해도`} 된다고 하셨어요`];
}

export interface ThoughtFeed {
  /** 판단 기록 하나(대시보드에 보낸 그대로): 사실 문장을 바로 보낸다. */
  decision(e: Decision): void;
  /** 정한 사실 줄 한 줄을 바로 보내고 기록한다(바로 앞 메시지와 같은 말이면 보내지 않는다). decision은 그 일의 판단 id. */
  note(text: string, decision: string): void;
  /** 최근 메시지(새로 붙은 대시보드에 다시 보낸다). 없으면 null. */
  last(): ThoughtEvent | null;
  /** 집·서버를 닫을 때: 그 뒤로는 보내지 않는다. */
  close(): void;
}

/**
 * 판단 기록·사실 줄 → 메시지 보내기. 최근 THOUGHT_KEEP개(THOUGHT_KEEP_MS 안)를 두고 새로 붙은 대시보드에 다시 보낸다. seed는 기록에서 읽은 최근 메시지다.
 */
export function thoughtFeed(o: { send: (m: ThoughtEvent) => void; record?: (m: ThoughtMessage) => void; seed?: ThoughtMessage[]; clock?: () => number }): ThoughtFeed {
  const clock = o.clock ?? Date.now;
  let recent: ThoughtMessage[] = (o.seed ?? []).slice(-THOUGHT_KEEP);
  let closed = false;
  /** 나이 상한 안의 최근 메시지. */
  const fresh = () => recent.filter((m) => clock() - m.at_ms <= THOUGHT_KEEP_MS);
  const post = (made: ThoughtMessage[], kept: ThoughtMessage[]) => {
    recent = [...kept, ...made].slice(-THOUGHT_KEEP);
    try { o.send({ type: "thought", messages: made }); } catch { /* 보내기 오류는 메시지를 버리지 않는다 */ }
    for (const m of made) try { o.record?.(m); } catch { /* 닫힌 기록 DB 등: 기록만 빠진다 */ }
  };
  return {
    decision(e) {
      if (closed) return;
      const kept = fresh();
      const lines = decisionLines(e).filter((t, i, all) => !kept.some((m) => same(m.text, t)) && !all.slice(0, i).some((u) => same(u, t)));
      if (!lines.length) return;
      const at = clock();
      post(lines.map((text, i) => ({ id: `${e.id}@${at}:${i}`, text, at_ms: at, decision: e.id })), kept);
    },
    note(text, decision) {
      if (closed) return;
      const kept = fresh();
      if (kept.length && same(kept.at(-1)!.text, text)) return;
      const at = clock();
      const base = `${decision}@${at}:note`;
      const id = kept.some((m) => m.id === base) ? `${base}:${kept.length}` : base;
      post([{ id, text, at_ms: at, decision }], kept);
    },
    last: () => {
      const kept = fresh();
      return kept.length ? { type: "thought", messages: kept } : null;
    },
    close() {
      closed = true;
    },
  };
}

/** 메시지 하나를 기록 DB에 남긴다(kind thought, 시각은 메시지 시각, subject는 판단 id, data에 집 id·메시지 id). 기록 DB는 집을 바꿔도 하나라 집 id를 함께 둔다. */
export function storeThought(db: Pick<HistoryDb, "add">, home: string, m: ThoughtMessage): void {
  db.add("thought", m.at_ms, m.text, { subject: m.decision, data: { home, id: m.id } });
}

/** 다시 띄울 때 되살릴 메시지: 기록 DB의 이 집 thought 줄 가운데 THOUGHT_KEEP_MS 안의 최근 THOUGHT_KEEP개(오래된 것부터).
 *  기록 DB는 집을 바꿔도 하나라, 나이 안의 줄을 모두 읽어 이 집 것만 거른 뒤 개수를 센다(다른 집 메시지에 밀리지 않게). */
export function lastStoredThoughts(db: Pick<HistoryDb, "list">, home: string, nowMs: number): ThoughtMessage[] {
  return db.list({ kinds: ["thought"], since: nowMs - THOUGHT_KEEP_MS, latest: true })
    .flatMap((r) => {
      const d = (r.data ?? null) as { home?: unknown; id?: unknown } | null;
      return d?.home === home && typeof d.id === "string" ? [{ id: d.id, text: r.text, at_ms: r.at_ms, decision: r.subject ?? "" }] : [];
    })
    .slice(-THOUGHT_KEEP);
}
