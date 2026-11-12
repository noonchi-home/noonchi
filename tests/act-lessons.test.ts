// 수업 기록(src/act/lessons.ts): 코치 계획을 끝낼 때마다 단계마다 도움 없이 이어서 해낸 횟수를 남기고, 이어서 QUIET_AFTER번 혼자 해낸 단계는 다음부터 소리로 읽지 않는다.
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LessonStore, QUIET_AFTER, QUIET_HINT_MS, lessonsPath, memoryLessons, quietLabels } from "../src/act/lessons.js";

const TASK = "라면 끓이기 알려 주기";
const run = (helped: string[] = []) => ["냄비 꺼내기", "물 받기", "인덕션 켜기"].map((label) => ({ label, alone: !helped.includes(label) }));

describe("수업 기록", () => {
  it("말 줄이기 기준: 이어서 2번 혼자 해내면 조용한 단계, 20초 안 되면 한 번 읽는다", () => {
    expect([QUIET_AFTER, QUIET_HINT_MS]).toEqual([2, 20_000]);
  });

  it("두 판을 도움 없이 끝낸 단계는 quietLabels에 있고, 셋째 판에 도움을 받으면 빠진다", () => {
    const book = memoryLessons();
    expect(book.get(TASK)).toBeNull();
    expect([...quietLabels(null)]).toEqual([]);
    book.record(TASK, run(["물 받기"]), "2026-11-13T01:00:00.000Z");
    expect(book.get(TASK)).toEqual({ task: TASK, runs: 1, updatedAt: "2026-11-13T01:00:00.000Z", steps: [{ label: "냄비 꺼내기", alone: 1 }, { label: "물 받기", alone: 0 }, { label: "인덕션 켜기", alone: 1 }] });
    expect([...quietLabels(book.get(TASK))]).toEqual([]);
    book.record(TASK, run(), "2026-11-13T02:00:00.000Z");
    expect(book.get(TASK)!.steps).toEqual([{ label: "냄비 꺼내기", alone: 2 }, { label: "물 받기", alone: 1 }, { label: "인덕션 켜기", alone: 2 }]);
    expect([...quietLabels(book.get(TASK))].sort()).toEqual(["냄비 꺼내기", "인덕션 켜기"]);
    book.record(TASK, run(["냄비 꺼내기"]), "2026-11-13T03:00:00.000Z");
    expect(book.get(TASK)).toMatchObject({ runs: 3, steps: [{ label: "냄비 꺼내기", alone: 0 }, { label: "물 받기", alone: 2 }, { label: "인덕션 켜기", alone: 3 }] });
    expect([...quietLabels(book.get(TASK))].sort()).toEqual(["물 받기", "인덕션 켜기"]);
  });

  it("단계는 이름으로 맞춘다: 지난번에 없던 이름은 0에서 시작하고, 이번에 없는 이름은 버린다. 다른 행동의 기록과 섞이지 않는다", () => {
    const book = memoryLessons();
    book.record(TASK, run(), "t1");
    book.record(TASK, [{ label: "냄비 꺼내기", alone: true }, { label: "달걀 넣기", alone: true }], "t2");
    expect(book.get(TASK)!.steps).toEqual([{ label: "냄비 꺼내기", alone: 2 }, { label: "달걀 넣기", alone: 1 }]);
    expect(book.get("다른 일")).toBeNull();
    // 돌려준 기록을 바꿔도 책은 그대로다
    book.get(TASK)!.steps[0]!.alone = 99;
    expect(book.get(TASK)!.steps[0]!.alone).toBe(2);
  });

  it("파일이 없거나 깨졌으면 빈 기록으로 시작하고, 임시 파일에 쓴 뒤 이름을 바꾼다. 다시 열어도 같다", () => {
    const dir = mkdtempSync(join(tmpdir(), "lessons-"));
    const path = lessonsPath(dir, "mokryeon_180b");
    expect(path).toBe(join(dir, "homes", "mokryeon_180b", "lessons.json"));
    const a = new LessonStore(path);
    expect(a.get(TASK)).toBeNull();
    expect(existsSync(path)).toBe(false);
    a.record(TASK, run(), "2026-11-13T01:00:00.000Z");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ version: 1, lessons: { [TASK]: { task: TASK, runs: 1, updatedAt: "2026-11-13T01:00:00.000Z", steps: run().map((s) => ({ label: s.label, alone: 1 })) } } });
    expect(readdirSync(join(dir, "homes", "mokryeon_180b"))).toEqual(["lessons.json"]);
    expect(new LessonStore(path).get(TASK)).toMatchObject({ runs: 1 });
    writeFileSync(path, "{ 깨진 글");
    const b = new LessonStore(path);
    expect(b.get(TASK)).toBeNull();
    b.record(TASK, run(), "t");
    expect(new LessonStore(path).get(TASK)).toMatchObject({ runs: 1 });
    writeFileSync(path, JSON.stringify({ version: 1, lessons: { [TASK]: { task: TASK, runs: "셋", steps: [{ label: 3 }] } } }));
    expect(new LessonStore(path).get(TASK)).toBeNull();
  });
});
