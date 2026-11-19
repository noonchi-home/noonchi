// 기록 DB 같음 시험의 모양(tests/helpers/history-golden.ts): 시각은 빼도 뜻이 있는 사건 차례와 되풀이는 지키고, 정해지지 않는 차이만 뺀다.
import { describe, expect, it } from "vitest";
import { HistoryDb } from "../src/brain/history/db.js";
import { reflectionRows } from "./helpers/history-golden.js";

type Row = [kind: string, text: string, subject?: string, data?: Record<string, unknown>];
const day = (rows: Row[]) => {
  const db = HistoryDb.open(":memory:");
  rows.forEach(([kind, text, subject, data], i) => db.add(kind as never, 1000 + i, text, { subject, data: data ?? (kind === "decision" ? { status: "valid" } : undefined) }));
  return reflectionRows(db);
};
const plan: Row[] = [["decision", "컵 치우기", "pam-2"], ["execution", "판단", "plan:pam-2"], ["execution", "계획", "plan:pam-2"]];

describe("기록 DB 같음 시험의 모양", () => {
  it("계획을 시작한 판단·실행·사용자 답의 차례가 바뀌면 모양이 달라진다", () => {
    const a = day([...plan, ["feedback", "거절", "plan:pam-2", { choice: "reject" }], ["execution", "취소", "plan:pam-2"]]);
    const b = day([...plan, ["execution", "취소", "plan:pam-2"], ["feedback", "거절", "plan:pam-2", { choice: "reject" }]]);
    expect(a).not.toEqual(b);
    expect(day([["execution", "판단", "plan:pam-2"], ["decision", "컵 치우기", "pam-2"]])).not.toEqual(day([["decision", "컵 치우기", "pam-2"], ["execution", "판단", "plan:pam-2"]]));
  });

  it("다른 사건 사이에서 되풀이된 사건은 남기고, 바로 이어진 같은 줄만 하나로 본다", () => {
    const once = day([["execution", "판단"], ["execution", "계획"], ["execution", "완료"]]);
    const twice = day([["execution", "판단"], ["execution", "계획"], ["execution", "완료"], ["execution", "판단"], ["execution", "계획"], ["execution", "완료"]]);
    expect(twice).not.toEqual(once);
    expect(day([["detection", "컵 보임"], ["detection", "컵 보임"], ["detection", "컵 안 보임"]])).toEqual(day([["detection", "컵 보임"], ["detection", "컵 안 보임"]]));
  });

  it("주기 판단과 그 처리 메모(대기·같은 행동)는 몇 번·어디에 끼든 있는지만 본다", () => {
    const a = day([["decision", "대기", "pam-1"], ["execution", "대기", "plan:pam-1"], ...plan, ["decision", "컵 치우기", "pam-3"], ["execution", "같은 행동을 진행 중", "plan:pam-3"], ["execution", "완료", "plan:pam-2"]]);
    // 같은 행동 판단(같은 행동을 진행 중)은 그 계획이 도는 동안에만 나온다: 대기 판단만 자리를 옮긴다
    const b = day([...plan, ["decision", "대기", "pam-1"], ["execution", "대기", "plan:pam-1"], ["decision", "대기", "pam-4"], ["decision", "컵 치우기", "pam-3"], ["execution", "같은 행동을 진행 중", "plan:pam-3"], ["execution", "완료", "plan:pam-2"]]);
    expect(a).toEqual(b);
    expect(day(plan)).not.toEqual(a);
  });

  it("계획을 시작한 판단과 같은 행동을 고른 주기 판단·「같은 행동을 진행 중」은 빼고(계획 중 주기 판단이 오느냐가 판마다 다르다), 계획을 시작한 판단 줄과 다른 행동을 고른 판단은 남긴다", () => {
    const rows = day([...plan, ["decision", "컵 치우기", "pam-3"], ["execution", "같은 행동을 진행 중", "plan:pam-3"], ["decision", "에어컨 켜기", "pam-4"], ["decision", "대기", "pam-5"]]);
    expect(rows).toContain("[판단·실행·답] decision 컵 치우기 valid");
    expect(rows).toContain("[있음] decision 에어컨 켜기 valid");
    expect(rows).toContain("[있음] decision 대기 valid");
    expect(rows).not.toContain("[있음] decision 컵 치우기 valid");
    expect(rows).not.toContain("[있음] execution 같은 행동을 진행 중");
    expect(rows).toEqual(day([...plan, ["decision", "에어컨 켜기", "pam-4"], ["decision", "대기", "pam-5"]]));
  });

  it("같은 행동 주기 판단을 빼는 것은 그 계획이 진행 중인 구간뿐이다: 계획 전·끝난 뒤의 같은 행동 판단은 [있음]에 남는다(Codex cbdb6ec P3)", () => {
    const before = day([["decision", "컵 치우기", "pam-1"], ...plan, ["execution", "완료", "plan:pam-2"]]);
    expect(before).toContain("[있음] decision 컵 치우기 valid");
    const after = day([...plan, ["execution", "완료", "plan:pam-2"], ["decision", "컵 치우기", "pam-4"]]);
    expect(after).toContain("[있음] decision 컵 치우기 valid");
    const during = day([...plan, ["decision", "컵 치우기", "pam-3"], ["execution", "완료", "plan:pam-2"]]);
    expect(during).not.toContain("[있음] decision 컵 치우기 valid");
  });

  it("계획이 시작될 때 나가 있던 요청의 같은 화살표 반복 답(판단이 버린 늦은 답)과 그 「앞선 판단」 메모는 빼고, 그 밖의 「앞선 판단」 메모는 남긴다", () => {
    const stale: Row[] = [["decision", "대기", "pam-3", { status: "valid", late: true }], ["execution", "앞선 판단이라 쓰지 않음", "plan:pam-3"]];
    expect(day([...plan, ...stale])).toEqual(day(plan));
    expect(day([...plan, ["decision", "대기", "pam-4"], ["execution", "앞선 판단이라 쓰지 않음", "plan:pam-4"]])).toContain("[있음] execution 앞선 판단이라 쓰지 않음");
  });

  it("판단 id가 날마다 다시 1부터라 대기 판단이 다른 날 계획 id와 겹쳐도 대기 판단은 [있음]에 남는다(대기는 계획을 시작하지 않는다)", () => {
    const rows = day([["decision", "대기", "pam-2"], ...plan, ["decision", "대기", "pam-5"]]);
    expect(rows).toContain("[있음] decision 대기 valid");
  });

  it("사람 단계의 「완료」 답은 비전으로도 끝나는 단계라 빼고, 승인·거절처럼 사람만 정하는 답은 남긴다", () => {
    const done: Row = ["feedback", "완료 · 부탁: 문을 닫아 주세요", "plan:pam-2", { choice: "done", via: "button" }];
    expect(day([...plan, done, ["execution", "완료", "plan:pam-2"]])).toEqual(day([...plan, ["execution", "완료", "plan:pam-2"]]));
    const approve: Row = ["feedback", "승인 · 질문: 켤까요?", "plan:pam-2", { choice: "approve", via: "button" }];
    expect(day([...plan, approve, ["execution", "완료", "plan:pam-2"]])).not.toEqual(day([...plan, ["execution", "완료", "plan:pam-2"]]));
  });

  it("들은 말은 집 상태와 다른 흐름이라 둘 사이 앞뒤는 보지 않는다", () => {
    const heard: Row = ["world", "들은 말 있음", undefined, { kind: "heard" }];
    const vlm: Row = ["world", "VLM: 집", undefined, { kind: "vlm" }];
    expect(day([heard, vlm])).toEqual(day([vlm, heard]));
  });
});
