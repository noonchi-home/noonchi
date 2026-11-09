// 보관 기간(src/history/retention.ts): 사진 찍기 사진(PHOTO_RETENTION_DAYS)과 시험 자료(DATASET_RETENTION_DAYS)가 지나면 파일과 표 줄을 지운다.
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HistoryDb } from "../src/history/db.js";
import { loadRetention, sweep } from "../src/history/retention.js";

describe("보관 기간", () => {
  it("기간이 지난 사진 찍기 사진과 시험 자료만 지운다(같은 이름의 .json도)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ph-"));
    const db = HistoryDb.open(":memory:");
    const day = 86_400_000;
    const now = 100 * day;
    for (const [id, at, origin] of [["old", now - 8 * day, "photo"], ["new", now - day, "photo"], ["ds", now - 3 * day, "dataset"]] as const) {
      writeFileSync(join(dir, `${id}.jpg`), "x");
      writeFileSync(join(dir, `${id}.json`), "{}");
      db.addPhoto({ id, atMs: at, path: join(dir, `${id}.jpg`), origin });
    }
    expect(sweep(db, { photoDays: 7, datasetDays: 2, nowMs: now })).toEqual({ photos: 1, dataset: 1 });
    expect(existsSync(join(dir, "old.jpg"))).toBe(false);
    expect(existsSync(join(dir, "old.json"))).toBe(false);
    expect(existsSync(join(dir, "ds.jpg"))).toBe(false);
    expect(existsSync(join(dir, "new.jpg"))).toBe(true);
    expect(db.listPhotos().map((p) => p.id)).toEqual(["new"]);
    expect(sweep(db, { photoDays: 7, datasetDays: 2, nowMs: now })).toEqual({ photos: 0, dataset: 0 });
  });

  it("파일이 이미 없어도 표 줄은 지운다", () => {
    const db = HistoryDb.open(":memory:");
    db.addPhoto({ id: "gone", atMs: 0, path: join(tmpdir(), "no-such-photo-xyz.jpg"), origin: "photo" });
    expect(sweep(db, { photoDays: 1, datasetDays: 1, nowMs: 2 * 86_400_000 })).toEqual({ photos: 1, dataset: 0 });
    expect(db.listPhotos()).toEqual([]);
  });

  it("PHOTO_RETENTION_DAYS·DATASET_RETENTION_DAYS: 비우면 7일, 0보다 큰 숫자가 아니면 시작을 막는다", () => {
    expect(loadRetention({})).toEqual({ photoDays: 7, datasetDays: 7 });
    expect(loadRetention({ PHOTO_RETENTION_DAYS: "30", DATASET_RETENTION_DAYS: "0.5" })).toEqual({ photoDays: 30, datasetDays: 0.5 });
    expect(() => loadRetention({ PHOTO_RETENTION_DAYS: "0" })).toThrow(/PHOTO_RETENTION_DAYS/);
    expect(() => loadRetention({ DATASET_RETENTION_DAYS: "일주일" })).toThrow(/DATASET_RETENTION_DAYS/);
  });
});
