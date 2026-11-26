import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HistoryDb } from "../src/brain/history/db.js";

describe("남은 음료를 버려도 된다는 배운 답", () => {
  let db: HistoryDb;
  beforeEach(() => { db = HistoryDb.open(":memory:"); });
  afterEach(() => db.close());

  it("같은 집·주민이 명시적으로 허용해야 한다", () => {
    const answers = db.cupAnswers;
    expect(answers.allowDiscard("A","owner")).toBe(false);
    answers.remember("A","owner",true);
    expect(answers.allowDiscard("A","owner")).toBe(true);
    expect(answers.allowDiscard("B","owner")).toBe(false);
    expect(answers.allowDiscard("A","guest")).toBe(false);
    expect(answers.allowDiscard("A",null)).toBe(false);
    expect(answers.demoResident("A",1)).toBeNull();
  });

  it("단일 사용자 시연 준비는 멱등하고 이후의 거절을 덮지 않는다", () => {
    const answers = db.cupAnswers;
    answers.seedDemo("A");
    answers.seedDemo("A");
    const owner = answers.demoResident("A",0);
    expect(owner).not.toBeNull();
    expect(answers.allowDiscard("A",owner)).toBe(true);
    expect(answers.demoResident("A",2)).toBeNull();
    expect(answers.demoResident("B",1)).toBeNull();
    answers.remember("A",owner!,false);
    answers.seedDemo("A");
    expect(answers.allowDiscard("A",owner)).toBe(false);
  });
});
