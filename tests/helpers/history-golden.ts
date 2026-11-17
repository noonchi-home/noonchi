// 기록 DB 같음 시험(stage-queue 계획 정한 것 10, 묶음 1 Task 5): 반성이 읽는 종류(DAY_KINDS·HABIT_KINDS)의 줄을
// 시각과 상관없는 모양으로 뽑아, 지금 방식이 남긴 정답(tests/fixtures/history-golden)과 견준다.
// 묶음 2·3에서 단계 사이를 통로로 바꿔도 같은 e2e 장면이 같은 줄을 같은 차례로 남기는지 본다.
// 모양: 흐름마다(판단·실행·사용자 답 / 집 상태 / 가전) 시각 차례로 줄을 늘어놓고, 바로 이어진 같은 줄만 하나로 본다(다른 사건 사이의 되풀이는 남긴다).
// 흐름끼리의 앞뒤는 프레임·판단 주기에 따라 섞여서 보지 않는다. 판단 주기의 대기, VLM·YOLO 프레임 줄은 몇 번이든 있는지만 본다.
import { createHash } from "node:crypto";
import { expect } from "vitest";
import type { HistoryDb } from "../../src/brain/history/db.js";
import type { HistoryRow } from "../../src/contract/history.js";

const STREAMS: { name: string; kinds: readonly HistoryRow["kind"][] }[] = [
  { name: "판단·실행·답", kinds: ["decision", "execution", "feedback"] },
  { name: "집 상태", kinds: ["detection", "world"] },
  { name: "가전", kinds: ["device"] },
];

const lineOf = (r: HistoryRow): string => {
  const d = (r.data ?? {}) as Record<string, unknown>;
  switch (r.kind) {
    case "device": return `device ${r.subject} ${String(d.attr)} ${JSON.stringify(d.from)}→${JSON.stringify(d.to)}`;
    case "decision": return `decision ${r.text} ${String(d.status)}`;
    default: return `${r.kind} ${r.text}`;
  }
};
const isWait = (r: HistoryRow) => r.kind === "decision" && (r.data as { status?: string } | null)?.status === "valid" && r.text === "대기";

/** 반성용 줄의 모양: 흐름마다 시각 차례(바로 이어진 같은 줄은 하나), 끝에 있는지만 보는 줄. */
export function reflectionRows(db: HistoryDb): string[] {
  const out: string[] = [];
  for (const s of STREAMS) {
    const rows = db.list({ kinds: [...s.kinds], limit: Number.MAX_SAFE_INTEGER }).filter((r) => !isWait(r));
    let last = "";
    for (const r of rows) {
      const line = `[${s.name}] ${lineOf(r)}`;
      if (line !== last) out.push(line);
      last = line;
    }
  }
  if (db.list({ kinds: ["decision"], limit: Number.MAX_SAFE_INTEGER }).some(isWait)) out.push("[있음] decision 대기");
  for (const kind of ["vlm", "yolo"] as const) if (db.list({ kinds: [kind], limit: 1 }).length) out.push(`[있음] ${kind}`);
  return out;
}

/** 시험 하나의 기록 DB 모양(서버를 닫기 전에 reflectionRows로 뽑은 것)을 그 시험의 정답 파일과 견준다(없으면 쓴다, -u면 고쳐 쓴다).
 *  정답은 tests/fixtures/history-golden/<e2e 파일>/<시험 이름 해시>.txt이고 첫 줄이 시험 이름이다. 경로는 tests/의 시험 파일 기준이다. */
export async function expectHistoryGolden(file: string, test: string, lines: string[]): Promise<void> {
  const id = createHash("sha1").update(test).digest("hex").slice(0, 10);
  await expect(`# ${test}\n${lines.join("\n")}\n`).toMatchFileSnapshot(`./fixtures/history-golden/${file}/${id}.txt`);
}
