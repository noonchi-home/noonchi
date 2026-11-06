// 기록 DB(src/history/db.ts): 런타임 볼륨의 SQLite 파일 하나. WAL, 잠금 대기 5초.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HistoryDb } from "../src/history/db.js";

describe("기록 DB", () => {
  it("폴더를 만들고 WAL·잠금 대기 5초로 연다", () => {
    const path = join(mkdtempSync(join(tmpdir(), "db-")), "a", "noonchi.db");
    const h = HistoryDb.open(path);
    try {
      expect(existsSync(path)).toBe(true);
      expect(h.ok()).toBe(true);
      expect(h.db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      expect(h.db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    } finally {
      h.close();
    }
  });

  it("닫은 뒤에는 ok()가 false다", () => {
    const h = HistoryDb.open(":memory:");
    h.close();
    expect(h.ok()).toBe(false);
  });
});
