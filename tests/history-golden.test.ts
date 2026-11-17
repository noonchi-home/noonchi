// 기록 DB 같음 시험의 모양(tests/helpers/history-golden.ts): 시각은 빼도 뜻이 있는 사건 차례와 되풀이는 지킨다.
import { describe, expect, it } from "vitest";
import { HistoryDb } from "../src/brain/history/db.js";
import { reflectionRows } from "./helpers/history-golden.js";

const day = (rows: [string, string, string?][]) => {
  const db = HistoryDb.open(":memory:");
  rows.forEach(([kind, text, subject], i) => db.add(kind as never, 1000 + i, text, { subject, data: kind === "decision" ? { status: "valid" } : undefined }));
  return reflectionRows(db);
};

describe("기록 DB 같음 시험의 모양", () => {
  it("판단·실행·사용자 답의 차례가 바뀌면 모양이 달라진다", () => {
    const a = day([["decision", "컵 치우기"], ["feedback", "거절"], ["execution", "취소"]]);
    const b = day([["decision", "컵 치우기"], ["execution", "취소"], ["feedback", "거절"]]);
    expect(a).not.toEqual(b);
  });

  it("다른 사건 사이에서 되풀이된 사건은 남기고, 바로 이어진 같은 줄만 하나로 본다", () => {
    const once = day([["execution", "판단"], ["execution", "계획"], ["execution", "완료"]]);
    const twice = day([["execution", "판단"], ["execution", "계획"], ["execution", "완료"], ["execution", "판단"], ["execution", "계획"], ["execution", "완료"]]);
    expect(twice).not.toEqual(once);
    expect(day([["detection", "컵 보임"], ["detection", "컵 보임"], ["detection", "컵 안 보임"]])).toEqual(day([["detection", "컵 보임"], ["detection", "컵 안 보임"]]));
  });

  it("판단 주기의 대기는 몇 번이든 있는지만 본다(시간에 따라 횟수가 다름)", () => {
    expect(day([["decision", "대기"], ["decision", "컵 치우기"], ["decision", "대기"], ["decision", "대기"]]))
      .toEqual(day([["decision", "대기"], ["decision", "컵 치우기"]]));
  });
});
