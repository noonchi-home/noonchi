// 시스템 날짜(src/brain/history/db.ts dayOf): 달력 날짜 + 그 시각 전에 한 넘김 수. 넘긴 날은 넘긴 때 시작하고, 그 뒤 자정마다 하루씩 간다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HistoryDb, addDays, calendarDay, dayWindow } from "../src/brain/history/db.js";

const at = (day: string, time: string) => Date.parse(`${day}T${time}+09:00`);
const PRESS = at("2026-11-27", "15:02:00");

describe("시스템 날짜", () => {
  it("넘김이 없으면 달력 날짜다", () => {
    const db = HistoryDb.open(":memory:");
    expect(db.dayOf(at("2026-11-27", "23:59:59"))).toBe("2026-11-27");
    expect(db.dayOf(at("2026-11-28", "00:00:00"))).toBe("2026-11-28");
    expect(calendarDay(PRESS, 540)).toBe("2026-11-27");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });

  it("넘기면 그 시각부터 다음 날이고, 그 뒤 자정에 하루 더 간다. 옛 시각은 옛 날짜다", () => {
    const db = HistoryDb.open(":memory:");
    expect(db.skipDay(PRESS, "2026-11-27")).toEqual({ from: "2026-11-27", to: "2026-11-28" });
    expect(db.dayOf(PRESS - 1)).toBe("2026-11-27");
    expect(db.dayOf(PRESS)).toBe("2026-11-28");
    expect(db.dayOf(at("2026-11-28", "00:00:00"))).toBe("2026-11-29");
    expect(db.skips()).toEqual([{ atMs: PRESS, from: "2026-11-27", to: "2026-11-28" }]);
    expect(db.rangeOf("2026-11-27")).toEqual({ start: at("2026-11-27", "00:00:00"), end: PRESS });
    expect(db.rangeOf("2026-11-28")).toEqual({ start: PRESS, end: at("2026-11-28", "00:00:00") });
    expect(db.rangeOf("2026-11-29")).toEqual({ start: at("2026-11-28", "00:00:00"), end: at("2026-11-29", "00:00:00") });
  });

  it("넘긴 뒤 쓰는 기록 줄은 새 날이고, 넘긴 시각 뒤에 먼저 들어간 줄도 새 날로 고친다", () => {
    const db = HistoryDb.open(":memory:");
    db.add("detection", PRESS - 60_000, "사람 보임");
    db.add("detection", PRESS + 1_000, "사람 안 보임");
    db.skipDay(PRESS, "2026-11-27");
    db.add("detection", PRESS + 2_000, "사람 보임");
    expect(db.list({}).map((r) => r.day)).toEqual(["2026-11-27", "2026-11-28", "2026-11-28"]);
  });

  it("그 시각의 날이 아닌 날은 넘기지 못한다(두 번 누름)", () => {
    const db = HistoryDb.open(":memory:");
    db.skipDay(PRESS, "2026-11-27");
    expect(() => db.skipDay(PRESS + 60_000, "2026-11-27")).toThrow(/2026-11-28/);
    expect(db.skips()).toHaveLength(1);
  });

  it("다른 연결(읽기 전용)도 다시 읽지 않고 넘긴 날을 본다", () => {
    const path = join(mkdtempSync(join(tmpdir(), "days-")), "noonchi.db");
    HistoryDb.create(path);
    const read = HistoryDb.open(path, 540, { readOnly: true });
    const write = HistoryDb.open(path, 540);
    try {
      expect(read.dayOf(PRESS)).toBe("2026-11-27");
      write.skipDay(PRESS, "2026-11-27");
      expect(read.dayOf(PRESS)).toBe("2026-11-28");
    } finally {
      read.close();
      write.close();
    }
  });
});

describe("넘긴 날의 시각 범위", () => {
  it("넘긴 날에 남긴 바람 기록은 넘긴 날 것이다", () => {
    const db = HistoryDb.open(":memory:");
    db.skipDay(PRESS, "2026-11-27");
    db.db.prepare("INSERT INTO intervention_preferences (home, user, action, context, at_ms, origin_id) VALUES ('h', 'u', '컵 치우기', 'c', ?, 'o1')").run(at("2026-11-27", "15:10:00"));
    expect(db.hasInterventionPreference("2026-11-28")).toBe(true);
    expect(db.hasInterventionPreference("2026-11-27")).toBe(false);
  });

  it("지난 n일 창은 첫날 시작부터 그날 끝 바로 전까지다", () => {
    const db = HistoryDb.open(":memory:");
    db.skipDay(PRESS, "2026-11-27");
    expect(dayWindow(db, "2026-11-28", 2)).toEqual({ since: at("2026-11-27", "00:00:00"), until: at("2026-11-28", "00:00:00") - 1 });
    expect(dayWindow(db, "2026-11-27", 1)).toEqual({ since: at("2026-11-27", "00:00:00"), until: PRESS - 1 });
  });
});
