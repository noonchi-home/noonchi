// 합성 기록(scripts/seed-history.ts): 한 사람이 사는 한양목련 180B의 지난 7일을 기록 DB API(HistoryDb.add·saveMemory)로만 쓰고,
// 줄마다 data.synthetic, 기억 판본마다 source synthetic을 단다. --clear는 그것만 지우고 실제 기록·판본·고정은 그대로 둔다. PAM·OpenAI를 부르지 않는다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANY_STATE, CUP_FSM_MEMORY, isOldFsm, validateCandidateFsm, validateMemory, type FsmMemory } from "../src/brain/decision.js";
import { TASK_NAMES } from "../src/act/tasks.js";
import { HistoryDb, type HistoryRow } from "../src/brain/history/db.js";
import { memoryForDay } from "../src/brain/history/reflect.js";
import { daySummary } from "../src/brain/history/summary.js";
import { checkCandidate } from "../src/brain/pam/adopt.js";
import type { FsmStep } from "../src/contract/pam.js";
import { LEARNED_FSM_MEMORY } from "../scripts/learned-memory.js";
import { SYNTH_CANDIDATES, TV_START_ON, main, memoryAfter, seedHistory, weekMarks } from "../scripts/seed-history.js";

afterEach(() => { vi.restoreAllMocks(); });

const END = "2026-11-08";
const DAYS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
const WEEKDAYS = DAYS.slice(0, 5);
const hourOf = (r: HistoryRow) => new Date(r.at_ms + 540 * 60_000).getUTCHours() + new Date(r.at_ms + 540 * 60_000).getUTCMinutes() / 60;
const memorySources = (db: HistoryDb) => db.db.prepare("SELECT version, source FROM memories ORDER BY version").all() as { version: number; source: string }[];
/** 한양목련 180B 합성 일주일(scripted). */
const seedWeek = () => { const db = HistoryDb.open(":memory:", 540); seedHistory(db, { home: "mokryeon_180b", end: END }); return db; };
/** memoryAfter가 읽는 집 자료(식탁 이름). */
const HOME = { table: { label: "거실·복도 식탁" } };
const pins = (db: HistoryDb) => Object.fromEntries((db.db.prepare("SELECT key, value FROM meta WHERE key LIKE 'memory_day:%'").all() as { key: string; value: string }[]).map((r) => [r.key.slice(11), Number(r.value)]));

describe("합성 기록 넣기", () => {
  it("기록 DB API로만 쓰고, 모든 줄에 data.synthetic, 모든 기억 판본에 source synthetic을 단다. 어제까지 7일이고 AI를 부르지 않는다", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const add = vi.spyOn(HistoryDb.prototype, "add");
    const save = vi.spyOn(HistoryDb.prototype, "saveMemory");
    const db = HistoryDb.open(":memory:", 540);
    const r = seedHistory(db, { home: "mokryeon_180b", end: END });
    const rows = db.list({ limit: 1_000_000 });
    expect(r.days).toEqual(DAYS);
    expect(rows.length).toBeGreaterThan(500);
    expect(add).toHaveBeenCalledTimes(rows.length);
    expect(rows.filter((x) => (x.data as { synthetic?: unknown } | null)?.synthetic !== true)).toEqual([]);
    expect(new Set(rows.map((x) => x.day))).toEqual(new Set(DAYS));
    expect(new Set(rows.map((x) => x.kind))).toEqual(new Set(["mode", "device", "detection", "vlm", "world", "pam_text", "decision", "plan", "execution", "feedback", "reflection"]));
    expect(save.mock.calls.map((c) => c[0].source)).toEqual(Array(8).fill("synthetic"));
    expect(memorySources(db).map((m) => m.source)).toEqual(Array(8).fill("synthetic"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("우리 집 이름과 지금 규칙으로 쓴다: 방·면·가전 이름, 묻기 답 「치워 주세요」·「완료」 답, 컵 치우기 완료, 평일 낮 외출", () => {
    const db = HistoryDb.open(":memory:", 540);
    seedHistory(db, { home: "mokryeon_180b", end: END });
    const texts = (kind: HistoryRow["kind"]) => db.list({ kinds: [kind], limit: 1_000_000 }).map((x) => x.text);
    expect(texts("detection")).toContain("컵 cup_1 보임 · 거실·복도 식탁 위");
    expect(texts("world")).toContain("컵 cup_1 비어 있음");
    expect(texts("world").some((t) => t.startsWith("VLM: "))).toBe(true);
    expect(texts("device")).toEqual(expect.arrayContaining(["거실·복도 에어컨 켜짐", "거실·복도 에어컨 꺼짐", "침실 1 에어컨 켜짐"]));
    // 1·2일째 떠날 때 묻고 「치워 주세요」 답(승인은 묻지 않는다: 지금 서버처럼 처음 하는 일 묻기 끔)
    const feedback = db.list({ kinds: ["feedback"], limit: 1000 });
    expect(feedback.map((f) => f.text)).toEqual(expect.arrayContaining(["치워 주세요 · 질문: 컵을 치울까요?", "완료 · 부탁: 싱크대로 가 주세요"]));
    expect(feedback.filter((f) => f.text.endsWith("컵을 치울까요?")).map((f) => [f.day, (f.data as { choice: string }).choice])).toEqual([[DAYS[0], "clear"], [DAYS[1], "clear"]]);
    expect(feedback.some((f) => f.text.endsWith("할까요?"))).toBe(false);
    const exec = texts("execution");
    expect(exec).toEqual(expect.arrayContaining(["판단", "계획", "실행 중", "완료", "대기"]));
    expect(texts("plan")).toEqual(expect.arrayContaining(["컵 치우기 끝남"]));
    // 판단은 행동 목록 안에서 고르고, 보낸 관찰 텍스트는 World State 모양(시각 줄 + [지속] + [눈])
    const decisions = db.decisions(500);
    expect(new Set(decisions.map((d) => d.text))).toEqual(new Set(["대기", "컵 치우기", "사용자에게 물어보기", "에어컨 켜기"]));
    // PAM 판단(말 부탁 판단은 들은 말 한 줄)
    const cleared = decisions.find((d) => d.text === "컵 치우기" && !(d.text_sent ?? "").startsWith("사람이 말함"))!;
    expect(cleared.text_sent).toMatch(/^\d\d:\d\d:\d\d 사람 안 보임$/m);
    // 물건 [지속]은 면 줄 하나와 사실마다 한 줄(그 값이 처음 보인 시각부터, 짐작이면 (짐작))
    expect(cleared.text_sent).toMatch(/^\[지속\] 컵 cup_\d+ 거실·복도 식탁 위: /m);
    expect(cleared.text_sent).toMatch(/^\[지속\] 컵 cup_\d+ 비어 있음(\(짐작\))?: \d\d:\d\d:\d\d부터 /m);
    expect(cleared.text_sent).toMatch(/\n\[눈\] 클로이드 눈: 거실·복도$/);
    // 평일 9시~18시는 집에 없어 관찰이 없다
    const seen = db.list({ kinds: ["detection", "world", "vlm"], limit: 1_000_000 });
    for (const day of WEEKDAYS) expect(seen.filter((x) => x.day === day && hourOf(x) >= 9 && hourOf(x) < 18)).toEqual([]);
    // 하루 요약(반성 입력)에 판단·실행·사용자 말이 들어간다
    const s = daySummary(db, "2026-11-03");
    expect(s.action_summary).toContain("클로이드 판단: 컵 치우기");
    expect(s.observation_text).toMatch(/\[하루\] VLM 분석 \d+장/);
  });

  it("반성은 날마다 다음 날부터 쓰는 판본을 남기고, 오늘 쓸 판본은 마시다 떠나면 치우고 밤에는 묻지 않기를 바란다는 기억이다", () => {
    const db = HistoryDb.open(":memory:", 540);
    const r = seedHistory(db, { home: "mokryeon_180b", end: END });
    expect(db.list({ kinds: ["reflection"] }).map((x) => x.text)).toEqual(DAYS.map((d, i) => `반성 완료: 기억 ${i + 2}판, ${i < 6 ? DAYS[i + 1] : "2026-11-09"}부터`));
    expect(DAYS.map((d) => pins(db)[d])).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const today = db.memoryFor("2026-11-09")!;
    expect(today.version).toBe(8);
    expect(r.today).toEqual({ day: "2026-11-09", version: 8 });
    const m = validateMemory(today.memory, "fsm") as FsmMemory;
    expect(m.states.find((s) => s.id === "drinking")!.next.find((e) => e.to === ANY_STATE)!.action).toBe("컵 치우기");
    const text = JSON.stringify(today.memory);
    expect(text).toMatch(/22시가 넘으면 폰으로 묻지 않기를 바란다/);
    expect(text).toContain("거실·복도 식탁");
    // 밤(22시 넘어)에는 묻지 않는다
    expect(db.decisions(500).filter((d) => d.text === "사용자에게 물어보기" && hourOf({ at_ms: d.at_ms } as HistoryRow) >= 22)).toEqual([]);
  });

  const versions = (db: HistoryDb) => (db.db.prepare("SELECT version FROM memories ORDER BY version").all() as { version: number }[]).map((r) => db.memoryVersion(r.version)!);

  it("합성 일주일: 상태는 seed 넷, 떠날 때 1·2일째는 묻고 둘째 밤 채택 검사를 지나 3일째부터 치운다. 로봇이 치운 날은 못 봄이라 셈이 그대로다", () => {
    const db = seedWeek();
    for (const v of db.memoryVersions()) {
      expect(isOldFsm(v.memory)).toBe(false);
      expect((validateMemory(v.memory, "fsm") as FsmMemory).states.map((s) => s.id)).toEqual(["drinking", "watching_tv", "cooking", "away"]);
    }
    const leave = (m: FsmMemory) => m.states.find((s) => s.id === "drinking")!.next.find((e) => e.to === ANY_STATE)!.action;
    // n일째 쓰는 기억: 1일째 seed, n일째(n ≥ 2)는 (n-1)번째 밤이 남긴 memoryAfter(n - 2)
    const used = [CUP_FSM_MEMORY, ...[0, 1, 2, 3, 4, 5].map((i) => memoryAfter(i, HOME))];
    expect(used.map(leave)).toEqual(["사용자에게 물어보기", "사용자에게 물어보기", "컵 치우기", "컵 치우기", "컵 치우기", "컵 치우기", "컵 치우기"]);
    expect(memoryAfter(1, HOME).states.map((s) => s.next)).toEqual(LEARNED_FSM_MEMORY.states.map((s) => s.next));
    // 합성 반성이 내는 후보 FSM은 반성 답 코드 검사를 지난다
    expect(validateCandidateFsm(SYNTH_CANDIDATES, CUP_FSM_MEMORY)).toEqual(SYNTH_CANDIDATES);
    // 하루 한 번 떠남: 1·2일째 「치워 주세요」 답(따라옴), 3일째부터 로봇이 바로 치움(못 봄)
    const nights = [1, 2, 3, 4, 5, 6, 7].map((n) => checkCandidate(weekMarks(n)));
    expect(nights.map((r) => r.passed)).toEqual([false, true, true, true, true, true, true]);
    expect(nights.map((r) => [r.n, r.k, r.unknown])).toEqual([[1, 1, 0], [2, 2, 0], [2, 2, 1], [2, 2, 2], [2, 2, 3], [2, 2, 4], [2, 2, 5]]);
    // 합성 판단도 쓰는 기억을 따른다(날마다 마시는 중에서 떠나는 판단 하나)
    const leaves = db.list({ kinds: ["decision"], limit: 5000 }).filter((r) => (r.data as { fsm?: FsmStep | null }).fsm?.from === "drinking" && (r.data as { fsm: FsmStep }).fsm.to === ANY_STATE);
    expect(leaves.map((r) => r.text)).toEqual(["사용자에게 물어보기", "사용자에게 물어보기", "컵 치우기", "컵 치우기", "컵 치우기", "컵 치우기", "컵 치우기"]);
  });

  it("합성 일주일 말없이 에어컨(데모 「2-습관」): 1일째 「아 덥다」는 로봇이 켜서 못 봄, 2·3일째 사람이 켬, 셋째 밤 통과해 4일째부터 말없이 켠다. 덥다·부채질 화살표는 날마다 그대로다", () => {
    const db = seedWeek();
    const HOT = CUP_FSM_MEMORY.states.find((s) => s.id === "watching_tv")!.next[1]!;
    const tv = (m: FsmMemory) => m.states.find((s) => s.id === "watching_tv")!.next;
    const away = (m: FsmMemory) => m.states.find((s) => s.id === "away")!.next;
    const used = [CUP_FSM_MEMORY, ...[0, 1, 2, 3, 4, 5].map((i) => memoryAfter(i, HOME))];
    expect(used.map((m) => away(m).some((e) => e.to === "watching_tv" && e.on === TV_START_ON && e.action === "에어컨 켜기"))).toEqual([false, false, false, true, true, true, true]);
    expect(used.every((m) => tv(m).some((e) => e.on === HOT.on && e.action === "에어컨 켜기"))).toBe(true);
    const nights = [1, 2, 3, 4, 5, 6, 7].map((n) => checkCandidate(weekMarks(n, "aircon")));
    expect(nights.map((r) => r.passed)).toEqual([false, false, true, true, true, true, true]);
    expect(nights.map((r) => [r.n, r.k, r.unknown])).toEqual([[0, 0, 1], [1, 1, 1], [2, 2, 1], [2, 2, 2], [2, 2, 3], [2, 2, 4], [2, 2, 5]]);
    // 합성 판단: 1일째 덥다 화살표(정한 습관), 4일째부터 자리에 없음 → TV 보는 중 진입 화살표(배운 것)
    const airs = db.list({ kinds: ["decision"], limit: 5000 }).filter((r) => r.text === "에어컨 켜기").map((r) => (r.data as { fsm: FsmStep }).fsm.on);
    expect(airs).toEqual([HOT.on, TV_START_ON, TV_START_ON, TV_START_ON, TV_START_ON]);
    // 배운 뒤에도 TV 앞에서 마시다 떠나면 묻는다(사용자 답 2026-11-19)
    expect(tv(memoryAfter(5, HOME)).find((e) => e.to === ANY_STATE)!.action).toBe("사용자에게 물어보기");
  });

  it("합성 판단의 화살표는 그날 고정한 판본의 화살표다(행동도 같다). 판본의 화살표 행동은 모두 행동 목록 안이고, 서버가 이 DB로 판단하면 오늘은 마지막 합성 판본을 쓴다", () => {
    const db = seedWeek();
    const steps = db.list({ kinds: ["decision"], limit: 5000 }).filter((r) => (r.data as { fsm?: FsmStep | null }).fsm?.from);
    expect(steps.length).toBeGreaterThan(20);
    for (const r of steps) {
      const f = (r.data as { fsm: FsmStep }).fsm;
      const pinned = db.memoryVersion(db.pinnedMemory(r.day)!)!.memory as FsmMemory;
      expect(pinned.states.find((s) => s.id === f.from)!.next[f.next_index], `${r.day} ${r.text}`).toEqual({ to: f.to, on: f.on, ...(f.when ? { when: f.when } : {}), ...(f.action ? { action: f.action } : {}) });
      expect(f.action ?? "대기").toBe(r.text);
    }
    for (const v of versions(db)) for (const s of (v.memory as FsmMemory).states) for (const e of s.next) if (e.action) expect(TASK_NAMES, `${v.version}판 ${s.id}: ${e.action}`).toContain(e.action);
    expect(memoryForDay(db, "2026-11-09").version).toBe(8);
  });

  it("날마다 TV 장면 뒤 1분 안에 거실 에어컨이 켜진다. 1일차에는 「사람이 말함」 줄과 에어컨 켜기 판단이 있고, 4일차부터는 말 없이 에어컨 켜기 판단이 있다", () => {
    const db = HistoryDb.open(":memory:", 540);
    seedHistory(db, { home: "mokryeon_180b", end: END });
    const rows = db.list({ limit: 1_000_000 });
    const onSoon = DAYS.filter((day) => {
      const scenes = rows.filter((r) => r.day === day && r.kind === "world" && r.text.includes("watching TV"));
      return scenes.some((s) => rows.some((r) => r.kind === "device" && r.text === "거실·복도 에어컨 켜짐" && r.at_ms > s.at_ms && r.at_ms - s.at_ms <= 60_000));
    });
    expect(onSoon).toEqual(DAYS);
    const first = rows.filter((r) => r.day === DAYS[0]);
    expect(first.some((r) => r.kind === "world" && r.text.includes("사람이 말함: 「아 덥다」"))).toBe(true);
    expect(db.decisions(500).filter((d) => d.text === "에어컨 켜기").map((d) => [d.day, (d.text_sent ?? "").includes("사람이 말함: 「아 덥다」")]))
      .toEqual([[DAYS[0], true], ...DAYS.slice(3).map((d) => [d, false])]);
  });

  it("memories none이면 판본은 seed 하나, 반성 줄 0, 2~7일 날 고정이 없고, 합성 판단 기록의 memory_version은 seed 판본이다", () => {
    const db = HistoryDb.open(":memory:", 540);
    const r = seedHistory(db, { home: "mokryeon_180b", end: END, memories: "none" });
    expect(versions(db).map((v) => [v.version, v.source])).toEqual([[1, "synthetic"]]);
    expect(versions(db)[0]!.memory).toEqual(CUP_FSM_MEMORY);
    expect(db.list({ kinds: ["reflection"] })).toEqual([]);
    for (const day of DAYS.slice(1)) expect(pins(db)[day], day).toBeUndefined();
    // 말 부탁 판단(묻기 답)은 PAM을 부르지 않아 기억 판본이 없다(0)
    const pamRows = db.list({ kinds: ["decision"], limit: 100_000 }).filter((x) => (x.data as { source?: string }).source !== "speech");
    expect(new Set(pamRows.map((x) => (x.data as { memory_version: number }).memory_version))).toEqual(new Set([1]));
    expect(r.versions).toEqual([1]);
    expect(r.latest).toBeNull();
  });

  it("하루 마치기로 날을 넘긴 기록 DB에는 합성 기록을 넣지 않고 멈춘다", () => {
    const dir = mkdtempSync(join(tmpdir(), "seed-"));
    const real = HistoryDb.open(join(dir, "noonchi.db"), 540);
    const t = Date.parse("2026-11-09T12:00:00Z");
    real.skipDay(t, real.dayOf(t));
    real.close();
    expect(() => main(["--end", END, "--home", "mokryeon_180b"], { RUNTIME_DIR: dir, HISTORY_TZ_MINUTES: "540" }, () => {})).toThrow(/하루를 넘긴 폴더예요/);
    const db = HistoryDb.open(join(dir, "noonchi.db"), 540);
    expect(db.list({ limit: 10 })).toEqual([]);
    db.close();
  });

  it("--clear는 합성 줄·판본·그 판본 고정만 지우고 실제 기록·판본·고정은 그대로 둔다. 다시 넣으면 앞 합성 기록을 바꾼다", () => {
    const dir = mkdtempSync(join(tmpdir(), "seed-"));
    const path = join(dir, "noonchi.db");
    const real = HistoryDb.open(path, 540);
    const t = Date.parse("2026-11-09T12:00:00Z");
    real.add("world", t, "VLM: An empty room corner is visible.", { data: { kind: "vlm" } });
    real.add("vlm", t, "An empty room corner is visible.", { subject: "e1", data: { captured_at_ms: t - 1000, missing: null } });
    expect(memoryForDay(real, "2026-11-09").version).toBe(1); // 실제 판단이 오늘 판본(1판 seed)을 정함
    real.close();
    const logs: string[] = [];
    const env = { RUNTIME_DIR: dir, HISTORY_TZ_MINUTES: "540" };
    main(["--end", END, "--home", "mokryeon_180b"], env, (l) => logs.push(l));
    main(["--end", END, "--home", "mokryeon_180b"], env, (l) => logs.push(l)); // 다시 넣기: 앞 합성 기록을 지우고 새로
    let db = HistoryDb.open(path, 540);
    const once = db.list({ limit: 1_000_000 }).length;
    expect(db.list({ kinds: ["reflection"] })).toHaveLength(7);
    // 오늘은 실제 판단이 이미 1판으로 정해 합성 기억은 내일부터. 다시 넣으면 지운 판본 번호(2~9)를 다시 쓴다
    expect(db.list({ kinds: ["reflection"] }).at(-1)!.text).toBe("반성 완료: 기억 9판, 2026-11-10부터");
    expect(logs.join("\n")).toContain("2026-11-10");
    db.close();
    expect(once).toBeGreaterThan(500);
    main(["--clear"], env, (l) => logs.push(l));
    db = HistoryDb.open(path, 540);
    expect(db.list({ limit: 1_000_000 }).map((x) => x.text)).toEqual(["VLM: An empty room corner is visible.", "An empty room corner is visible."]);
    expect(memorySources(db)).toEqual([{ version: 1, source: "seed" }]);
    expect(pins(db)).toEqual({ "2026-11-09": 1 });
    db.close();
  }, 60_000);
});
