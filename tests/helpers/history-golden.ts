// 기록 DB 같음 시험: 반성이 읽는 종류(DAY_KINDS·HABIT_KINDS)의 줄을
// 시각과 상관없는 모양으로 뽑아, 지금 방식이 남긴 정답(tests/fixtures/history-golden)과 견준다.
// 묶음 2·3에서 단계 사이를 통로로 바꿔도 같은 e2e 장면이 같은 줄을 같은 차례로 남기는지 본다.
// 모양: 흐름마다(판단·실행·답 / 집 상태 / 들은 말 / 가전) 시각 차례로 줄을 늘어놓고, 바로 이어진 같은 줄만 하나로 본다(다른 사건 사이의 되풀이는 남긴다).
// 정해지지 않는 차이만 뺀다(근거는 각 규칙 옆):
// - 흐름끼리의 앞뒤: 영상 프레임·VLM 답·폰 말·가전이 서로 다른 시계로 와서 섞이는 차례가 실행마다 다르다.
// - 주기 판단과 그 처리 메모(대기·같은 행동·기다리는 동안·앞선 판단·방금 계획함·판단 실패·가까이 본 뒤 다시 판단·미리 세운 목표가 맡음): 판단은 5초 주기(PAM_PERIOD_MS)라
//   장면 단계와 상관없는 시각에 와서 몇 번·어디에 끼는지가 실행마다 다르다(src/brain/decide.ts tick, src/act/track/start.ts onDecision). 있는지만 본다.
//   계획을 시작한 판단(그 판단 id의 실행 줄 「판단」이 있는 것)은 차례에 남긴다. 그 계획을 하는 동안 같은 행동을 고른 주기 판단과 「같은 행동을 진행 중」은
//   있는지도 보지 않는다(계획 중에 주기 판단이 오느냐가 판마다 다르다, 2026-11-18 조정자 결정). 다른 행동을 고른 판단은 [있음]에 남긴다.
//   계획이 시작될 때 나가 있던 요청의 같은 화살표 반복 답(판단이 버린 늦은 답 late, src/brain/decide.ts released)과 그 메모(앞선 판단)도 같은 까닭으로 보지 않는다
//   (그때 주기 판단이 나가 있었느냐가 판마다 다르다. 2026-11-19 화살표를 직전 상태에서만 찾게 한 뒤 컵 치우기·물 채우기 장면에서 있다 없다 했다).
// - 정답은 통로를 닫기와 같은 차례로 비운 뒤 뽑는다(settledRows: srv.settle, 시간으로 기다리지 않고 기한을 넘기면 시험 실패).
// - 사람 단계의 「완료」 답: 그 단계는 비전(World State)·폰 위치로도 끝나서(단계 확인 규칙), 사람이 먼저 눌렀는지 비전이 먼저 봤는지에 따라
//   완료 답 줄이 있거나 없다(2026-11-18 전자레인지 장면 4번 문 닫기: 세 번 중 한 번은 VLM이 먼저 닫힘을 봐 완료 줄이 없었다). 뺀다.
//   승인·거절·질문 답처럼 사람만 정하는 답은 차례에 남긴다.
import { createHash } from "node:crypto";
import { expect } from "vitest";
import type { HistoryDb } from "../../src/brain/history/db.js";
import type { HistoryRow } from "../../src/contract/history.js";
import { EXEC_TEXT } from "../../src/act/labels.js";
import { DECISION_TEXT } from "../../src/brain/history/labels.js";

/** 주기 판단을 받아 처리한 메모(계획을 시작하지 않은 판단의 실행 줄). */
const DECISION_NOTES = new Set<string>([EXEC_TEXT.wait, EXEC_TEXT.same, EXEC_TEXT.busy, EXEC_TEXT.late, EXEC_TEXT.held, EXEC_TEXT.decisionFailed, EXEC_TEXT.closerNewer, EXEC_TEXT.goalWait]);

const lineOf = (r: HistoryRow): string => {
  const d = (r.data ?? {}) as Record<string, unknown>;
  switch (r.kind) {
    case "device": return `device ${r.subject} ${String(d.attr)} ${JSON.stringify(d.from)}→${JSON.stringify(d.to)}`;
    case "decision": return `decision ${r.text} ${String(d.status)}`;
    default: return `${r.kind} ${r.text}`;
  }
};

const ordered = (name: string, rows: HistoryRow[]): string[] => {
  const out: string[] = [];
  let last = "";
  for (const r of rows) {
    const line = `[${name}] ${lineOf(r)}`;
    if (line !== last) out.push(line);
    last = line;
  }
  return out;
};

/** 계획의 끝 줄(실행 추적이 완료·실패로 닫은 줄). */
const ended = (r: HistoryRow): boolean => {
  const state = (r.data as { state?: string } | null)?.state;
  return state ? state === "done" || state === "failed" : r.text === EXEC_TEXT.done || r.text === EXEC_TEXT.failed;
};

/** 반성용 줄의 모양: 흐름마다 시각 차례(바로 이어진 같은 줄은 하나), 끝에 있는지만 보는 줄. */
export function reflectionRows(db: HistoryDb): string[] {
  const all = (kinds: HistoryRow["kind"][]) => db.list({ kinds, limit: Number.MAX_SAFE_INTEGER });
  const acted = all(["decision", "execution", "feedback"]);
  const started = new Set(acted.filter((r) => r.kind === "execution" && r.text === EXEC_TEXT.decided).map((r) => r.subject));
  const periodic = (r: HistoryRow) =>
    (r.kind === "decision" && !started.has(`plan:${r.subject}`)) || (r.kind === "execution" && DECISION_NOTES.has(r.text));
  const doneAnswer = (r: HistoryRow) => r.kind === "feedback" && (r.data as { choice?: string } | null)?.choice === "done";
  // 계획이 진행 중인 구간(시작한 판단 ~ 그 계획의 완료·실패 줄, 끝 줄이 없으면 기록 끝까지): 그 안에서 같은 행동을 고른 주기 판단과
  // 그 메모(같은 행동을 진행 중)는 [있음]에도 넣지 않는다. 계획 전·끝난 뒤의 같은 행동 판단은 남긴다.
  // 판단 id는 날마다 다시 1부터라 대기 판단이 다른 날 계획 id와 겹칠 수 있다: 시작한 판단은 「판단」 줄 앞의 대기 아닌 같은 id 판단이다
  const spans = acted.filter((r) => r.kind === "execution" && r.text === EXEC_TEXT.decided && r.subject?.startsWith("plan:")).flatMap((d) => {
    const id = d.subject!.slice("plan:".length);
    const starter = acted.filter((r) => r.kind === "decision" && r.subject === id && r.text !== DECISION_TEXT.wait && r.at_ms <= d.at_ms).at(-1);
    if (!starter) return [];
    const end = acted.find((r) => r.kind === "execution" && r.subject === d.subject && r.at_ms >= d.at_ms && ended(r));
    return [{ starter, action: starter.text, from: starter.at_ms, to: end ? end.at_ms : Number.POSITIVE_INFINITY }];
  });
  const stale = new Set(acted.filter((r) => r.kind === "decision" && (r.data as { late?: boolean } | null)?.late === true).map((r) => `plan:${r.subject}`));
  const repeat = (r: HistoryRow) => (r.kind === "decision" && spans.some((s) => s.starter !== r && s.action === r.text && r.at_ms >= s.from && r.at_ms <= s.to))
    || (r.kind === "execution" && r.text === EXEC_TEXT.same)
    || (r.kind === "decision" && stale.has(`plan:${r.subject}`)) || (r.kind === "execution" && r.text === EXEC_TEXT.late && stale.has(r.subject ?? ""));
  const world = all(["detection", "world"]);
  const heard = (r: HistoryRow) => (r.data as { kind?: string } | null)?.kind === "heard";
  const out = [
    ...ordered("판단·실행·답", acted.filter((r) => !periodic(r) && !doneAnswer(r))),
    ...ordered("집 상태", world.filter((r) => !heard(r))),
    ...ordered("들은 말", world.filter(heard)),
    ...ordered("가전", all(["device"])),
  ];
  const seen = new Set(acted.filter((r) => periodic(r) && !repeat(r)).map((r) => `[있음] ${lineOf(r)}`));
  for (const kind of ["vlm", "yolo"] as const) if (all([kind]).length) seen.add(`[있음] ${kind}`);
  return [...out, ...[...seen].sort()];
}

/** 정답을 뽑기 전 비우기 기한(ms). */
export const GOLDEN_SETTLE_MS = 2000;

/** 서버를 닫기 전에 통로에 들어오는 중인 메시지를 닫기와 같은 차례(발행 줄 → 집 상태 → 거울)로 다 닿게 한 뒤(srv.settle) 반성용 줄 모양을 뽑는다.
 *  기한 안에 못 비우면 Error를 돌려준다(시험이 정리한 뒤 던져 실패한다). 줄이 안 생기는 버그는 가리지 않는다: 비운 뒤에도 없으면 정답과 다르다. */
export async function settledRows(srv: { settle(ms: number): Promise<boolean>; history: HistoryDb }): Promise<string[] | Error> {
  if (!(await srv.settle(GOLDEN_SETTLE_MS))) return new Error(`통로를 ${GOLDEN_SETTLE_MS}ms 안에 다 비우지 못했어요`);
  return reflectionRows(srv.history);
}

/** 시험 하나의 기록 DB 모양(서버를 닫기 전에 reflectionRows로 뽑은 것)을 그 시험의 정답 파일과 견준다(없으면 쓴다, -u면 고쳐 쓴다).
 *  정답은 tests/fixtures/history-golden/<e2e 파일>/<시험 이름 해시>.txt이고 첫 줄이 시험 이름이다. 경로는 tests/의 시험 파일 기준이다. */
export async function expectHistoryGolden(file: string, test: string, lines: string[]): Promise<void> {
  const id = createHash("sha1").update(test).digest("hex").slice(0, 10);
  await expect(`# ${test}\n${lines.join("\n")}\n`).toMatchFileSnapshot(`./fixtures/history-golden/${file}/${id}.txt`);
}
