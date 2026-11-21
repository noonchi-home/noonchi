// 시나리오 2 합성 재생(침실 1 책상): 사흘 부르고 물을 받은 뒤 밤 반성으로 습관을 배우고, 나흘째는 부르지 않아도 그 시각에 확인하고 가져다준다.
// 실제 노드(goal·manager·act·기록)를 가상 시계로 돌리고 집·폰을 든 사람·VLM은 실제 조건(tests/helpers/home-realism.ts)으로 흉내 낸다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY, type FsmMemory } from "../src/brain/decision.js";
import { HistoryDb } from "../src/brain/history/db.js";
import { runNight } from "../src/brain/history/night.js";
import { memoryForDay } from "../src/brain/history/reflect.js";
import { candidateFsmOf } from "../src/brain/pam/adopt.js";
import { WATER_ACTION } from "../src/act/tasks.js";
import { CALL_DAY, HABIT_DAY, judgeScenario2 } from "../scripts/scenario2-judge.js";
import { adoptedRoutines, kstMs, replayDay } from "./helpers/scenario2-replay.js";
import { pamClientFor, startFakePamLlm, type ChunkView, type MarkView } from "./helpers/pam.js";

const CALLS: [string, string][] = [["2026-11-22", "20:00:00"], ["2026-11-23", "19:58:00"], ["2026-11-24", "20:02:00"]];

describe("시나리오 2 합성 재생", { timeout: 240_000 }, () => {
  it("사흘 부른 물 전달 → 밤 반성으로 습관 → 나흘째 부르지 않고 그 시각에 확인해 가져다준다", async () => {
    const db = HistoryDb.open(":memory:");
    const pam = await startFakePamLlm({
      chunk: (v: ChunkView) => ({ chunks: v.lines.map((l) => ({ start: l.substring(0, 8), end: l.substring(0, 8), text: l.substring(11) })) }),
      reflect: () => candidateFsmOf(CUP_FSM_MEMORY), check: () => ({ ok: true, items: [] }),
      mark: (v: MarkView) => ({ candidates: v.candidates.map(([state, candidate]) => ({ state, candidate, times: [] })), actions: v.actions.map((action) => ({ action, times: [] })), unseen: [] }),
    });
    try {
      // 1~3일: 「클로이드!」 → 책상 → 「무엇을 도와드릴까요?」 → 「물 한 잔만 가져다줘」 → 전달 → 도움 기록
      for (const [day, hms] of CALLS) {
        const callAt = kstMs(day, hms);
        const r = await replayDay({ db, day, mode: "call", start: callAt - 10_000, callAt, until: callAt + 5 * 60_000, memory: CUP_FSM_MEMORY });
        expect(judgeScenario2(r.events, CALL_DAY, ["habit_visit"]), `${day} ${JSON.stringify(r.events.filter((e) => e.kind !== "photo"))}`).toEqual({ passed: true, firstMismatch: null });
        expect(r.records).toHaveLength(1);
        // 사진은 그때 시스템 간격(보통 2초)으로 찍혔다
        const shots = r.events.filter((e) => e.kind === "photo").map((e) => e.at);
        expect(shots.length).toBeGreaterThan(20);
      }
      // 사흘째 밤 반성: 도움 기록에서 「저녁 8시 전후 책상에서 공부할 때 물 한 잔」 습관을 다음 날 기억에 더한다
      const night = await runNight(db, pamClientFor(pam), "2026-11-24", { dir: mkdtempSync(join(tmpdir(), "s2-replay-")) });
      expect(night.ok, JSON.stringify(night)).toBe(true);
      const memory = memoryForDay(db, "2026-11-25").memory as FsmMemory;
      const edge = memory.states.find((s) => s.id === "studying")?.next.find((e) => e.action === WATER_ACTION);
      expect(edge).toMatchObject({ on: "사용자가 저녁 8시 전후에 책상에서 공부한다.", when: "지금 시각이 저녁 7시 45분부터 저녁 8시 15분 사이이고 책상 위에 마실 물이 없다." });
      expect(adoptedRoutines(db, memory, kstMs("2026-11-25", "19:00:00"))).toEqual([expect.objectContaining({ action: WATER_ACTION, center_min: 20 * 60, place_label: "책상" })]);
      // 4일: 부르지 않는다. 19:55에 책상 관찰 자리로 확인하러 가서 공부 중·물 없음을 보고 배운 화살표로 물을 가져다준다
      const day4 = await replayDay({ db, day: "2026-11-25", mode: "habit", start: kstMs("2026-11-25", "19:54:50"), until: kstMs("2026-11-25", "20:08:00"), memory });
      expect(judgeScenario2(day4.events, HABIT_DAY, ["call", "ask", "answer"]), JSON.stringify(day4.events.filter((e) => e.kind !== "photo"))).toEqual({ passed: true, firstMismatch: null });
      expect(day4.records[0]!.text).toMatch(/^\d\d:\d\d · 책상에서 공부 중 · 습관 기반 도움 · 물 전달 완료$/);
      // 판정은 차례가 어긋나면 실패한다
      expect(judgeScenario2(day4.events.filter((e) => e.kind !== "habit_visit"), HABIT_DAY).firstMismatch).toBe("missing:habit_visit");
    } finally {
      await pam.close();
      db.close();
    }
  });
});
