// 기록 DB 같음 시험(stage-queue 계획 정한 것 10, 묶음 1 Task 5): 반성이 읽는 종류(DAY_KINDS·HABIT_KINDS)의 줄을
// 시각·줄 수·프레임 수와 상관없는 모양으로 뽑아, 지금 방식이 남긴 정답(tests/fixtures/history-golden)과 견준다.
// 묶음 2·3에서 단계 사이를 통로로 바꿔도 같은 e2e 장면이 같은 줄을 남기는지 본다.
// 뺀 것: 시각, 같은 줄이 몇 번 나왔는지(판단 주기·프레임 수가 시간에 따라 다름), VLM·YOLO 프레임마다의 줄(있는지만 남김), 계획 id.
import { createHash } from "node:crypto";
import { expect } from "vitest";
import type { HistoryDb } from "../../src/brain/history/db.js";
import type { HistoryRow } from "../../src/contract/history.js";

const KINDS = ["detection", "world", "device", "decision", "execution", "feedback"] as const;

const lineOf = (r: HistoryRow): string => {
  const d = (r.data ?? {}) as Record<string, unknown>;
  switch (r.kind) {
    case "device": return `device ${r.subject} ${String(d.attr)} ${JSON.stringify(d.from)}→${JSON.stringify(d.to)}`;
    case "decision": return `decision ${r.text} ${String(d.status)}`;
    default: return `${r.kind} ${r.text}`;
  }
};

/** 반성용 줄의 모양: 서로 다른 줄을 가나다 차례로. VLM·YOLO 줄은 있는지만. */
export function reflectionRows(db: HistoryDb): string[] {
  const rows = db.list({ kinds: [...KINDS], limit: Number.MAX_SAFE_INTEGER });
  const lines = new Set(rows.map(lineOf));
  for (const kind of ["vlm", "yolo"] as const) if (db.list({ kinds: [kind], limit: 1 }).length) lines.add(`${kind} 있음`);
  return [...lines].sort();
}

/** 시험 하나의 기록 DB 모양(서버를 닫기 전에 reflectionRows로 뽑은 것)을 그 시험의 정답 파일과 견준다(없으면 쓴다, -u면 고쳐 쓴다).
 *  정답은 tests/fixtures/history-golden/<e2e 파일>/<시험 이름 해시>.txt이고 첫 줄이 시험 이름이다. 경로는 tests/의 시험 파일 기준이다. */
export async function expectHistoryGolden(file: string, test: string, lines: string[]): Promise<void> {
  const id = createHash("sha1").update(test).digest("hex").slice(0, 10);
  await expect(`# ${test}\n${lines.join("\n")}\n`).toMatchFileSnapshot(`./fixtures/history-golden/${file}/${id}.txt`);
}
