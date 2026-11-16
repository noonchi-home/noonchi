// 합성 기록(scripts/seed-history.ts): 한 사람이 사는 한양목련 180B의 지난 7일을 기록 DB API(HistoryDb.add·saveMemory)로만 쓰고,
// 줄마다 data.synthetic, 기억 판본마다 source synthetic을 단다. --clear는 그것만 지우고 실제 기록·판본·고정은 그대로 둔다. PAM·OpenAI를 부르지 않는다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CUP_FSM_MEMORY, validateMemory, type FsmMemory } from "../src/brain/decision.js";
import { TASK_NAMES } from "../src/act/tasks.js";
import { HistoryDb, type HistoryRow } from "../src/brain/history/db.js";
import { memoryForDay } from "../src/brain/history/reflect.js";
import { daySummary } from "../src/brain/history/summary.js";
import { main, seedHistory } from "../scripts/seed-history.js";

afterEach(() => { vi.restoreAllMocks(); });

const END = "2026-11-08";
const DAYS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
const WEEKDAYS = DAYS.slice(0, 5);
const hourOf = (r: HistoryRow) => new Date(r.at_ms + 540 * 60_000).getUTCHours() + new Date(r.at_ms + 540 * 60_000).getUTCMinutes() / 60;
const memorySources = (db: HistoryDb) => db.db.prepare("SELECT version, source FROM memories ORDER BY version").all() as { version: number; source: string }[];
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

  it("우리 집 이름과 지금 규칙으로 쓴다: 방·면·가전 이름, 컵 치우기 완료·「거절」·「완료」 답, 승인·거절 두 답, 평일 낮 외출", () => {
    const db = HistoryDb.open(":memory:", 540);
    seedHistory(db, { home: "mokryeon_180b", end: END });
    const texts = (kind: HistoryRow["kind"]) => db.list({ kinds: [kind], limit: 1_000_000 }).map((x) => x.text);
    expect(texts("detection")).toContain("컵 cup_1 보임 · 거실·복도 식탁 위");
    expect(texts("world")).toContain("컵 cup_1 비어 있음");
    expect(texts("world").some((t) => t.startsWith("VLM: "))).toBe(true);
    expect(texts("device")).toEqual(expect.arrayContaining(["거실·복도 에어컨 켜짐", "거실·복도 에어컨 꺼짐", "침실 1 에어컨 켜짐"]));
    // 승인은 처음 한 번 묻고(거절은 기억하지 않아 또 묻는다), 답은 승인·거절 둘
    const feedback = db.list({ kinds: ["feedback"], limit: 1000 });
    expect(feedback.map((f) => f.text)).toEqual(expect.arrayContaining([
      "거절 · 질문: 컵 치우기를 할까요?", "승인 · 질문: 컵 치우기를 할까요?", "완료 · 부탁: 싱크대로 가 주세요",
    ]));
    expect(feedback.filter((f) => f.text.endsWith("컵 치우기를 할까요?")).map((f) => (f.data as { choice: string }).choice)).toEqual(["reject", "approve"]);
    expect(feedback.some((f) => /밤에는 묻지 마세요 · 질문: 컵을 치울까요\?$/.test(f.text))).toBe(true);
    const exec = texts("execution");
    expect(exec).toEqual(expect.arrayContaining(["판단", "계획", "실행 중", "완료", "대기", "사용자가 거절한 일"]));
    expect(texts("plan")).toEqual(expect.arrayContaining(["컵 치우기 끝남", "컵 치우기 취소됨"]));
    // 판단은 행동 목록 안에서 고르고, 보낸 관찰 텍스트는 World State 모양(시각 줄 + [지속] + [눈])
    const decisions = db.decisions(500);
    expect(new Set(decisions.map((d) => d.text))).toEqual(new Set(["대기", "컵 치우기", "사용자에게 물어보기", "에어컨 켜기"]));
    const cleared = decisions.find((d) => d.text === "컵 치우기")!;
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

  it("반성은 날마다 다음 날부터 쓰는 판본을 남기고, 오늘 쓸 판본은 자리를 뜨면 컵을 치우고 밤에는 묻지 않는다는 기억이다", () => {
    const db = HistoryDb.open(":memory:", 540);
    const r = seedHistory(db, { home: "mokryeon_180b", end: END });
    expect(db.list({ kinds: ["reflection"] }).map((x) => x.text)).toEqual(DAYS.map((d, i) => `반성 완료: 기억 ${i + 2}판, ${i < 6 ? DAYS[i + 1] : "2026-11-09"}부터`));
    expect(DAYS.map((d) => pins(db)[d])).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const today = db.memoryFor("2026-11-09")!;
    expect(today.version).toBe(8);
    expect(r.today).toEqual({ day: "2026-11-09", version: 8 });
    validateMemory(today.memory, "fsm");
    const text = JSON.stringify(today.memory);
    expect(text).toMatch(/자리를 뜨면 컵을 치워 주기를 바란다/);
    expect(text).toMatch(/밤에는 폰으로 묻지 않기를 바란다/);
    expect(text).toContain("거실·복도 식탁");
    // 첫날 밤 질문 뒤로는 22시 넘어 묻지 않는다
    const asked = db.decisions(500).filter((d) => d.text === "사용자에게 물어보기" && hourOf({ at_ms: d.at_ms } as HistoryRow) >= 22);
    expect(asked.map((d) => d.day)).toEqual(["2026-11-02"]);
  });

  // 말없이 에어컨을 켜는 규칙: seed 덥다 규칙이 아닌 에어컨 켜기 규칙
  const HOT = CUP_FSM_MEMORY.states.flatMap((s) => s.rules).find((r) => r.action === "에어컨 켜기")!.trigger;
  const silentAircon = (m: FsmMemory) => m.states.flatMap((s) => s.rules.map((r) => ({ state: s.id, ...r }))).filter((r) => r.action === "에어컨 켜기" && r.trigger !== HOT);
  const versions = (db: HistoryDb) => (db.db.prepare("SELECT version FROM memories ORDER BY version").all() as { version: number }[]).map((r) => db.memoryVersion(r.version)!);

  it("scripted 판본마다 지금 FSM의 seed 규칙(컵 갈래·묻기·덥다·요리)이 상태 자리 그대로 남아 있다", () => {
    const db = HistoryDb.open(":memory:", 540);
    seedHistory(db, { home: "mokryeon_180b", end: END });
    const all = versions(db);
    expect(all).toHaveLength(8);
    for (const v of all) {
      const m = validateMemory(v.memory, "fsm") as FsmMemory;
      for (const s of CUP_FSM_MEMORY.states) for (const r of s.rules) expect(m.states.find((x) => x.id === s.id)?.rules, `${v.version}판 ${s.id}`).toContainEqual(r);
    }
  });

  it("합성 판본의 규칙 행동은 모두 행동 목록 안이다. 밤 상태에는 규칙이 없고 아침까지 컵을 그대로 두고 묻지 않는다는 것은 상태 설명에 있다", () => {
    const db = HistoryDb.open(":memory:", 540);
    seedHistory(db, { home: "mokryeon_180b", end: END, habit: true });
    for (const v of versions(db)) {
      const m = v.memory as FsmMemory;
      for (const s of m.states) for (const r of s.rules) expect(TASK_NAMES, `${v.version}판 ${s.id}: ${r.action}`).toContain(r.action);
      const night = m.states.find((s) => s.id === "night");
      if (!night) continue;
      expect(night.rules, `${v.version}판`).toEqual([]);
      expect(night.description).toMatch(/컵을 그대로 두고 아침까지 기다린다/);
    }
  });

  it("habit 없이는 어느 판본에도 말없는 에어컨 규칙이 없고, habit: true면 마지막 판본의 watching_tv에만 있다", () => {
    const plain = HistoryDb.open(":memory:", 540);
    seedHistory(plain, { home: "mokryeon_180b", end: END });
    expect(versions(plain).flatMap((v) => silentAircon(v.memory as FsmMemory))).toEqual([]);
    const db = HistoryDb.open(":memory:", 540);
    seedHistory(db, { home: "mokryeon_180b", end: END, habit: true });
    const all = versions(db);
    expect(all.slice(0, -1).flatMap((v) => silentAircon(v.memory as FsmMemory))).toEqual([]);
    expect(silentAircon(all.at(-1)!.memory as FsmMemory)).toEqual([{ state: "watching_tv", trigger: "사용자가 소파에 앉아 TV를 보기 시작한다.", action: "에어컨 켜기" }]);
  });

  it("7일 중 6일 이상 TV 장면 뒤 1분 안에 거실 에어컨이 켜진다. 1일차에는 「사람이 말함」 줄과 에어컨 켜기 판단이 있다", () => {
    const db = HistoryDb.open(":memory:", 540);
    seedHistory(db, { home: "mokryeon_180b", end: END });
    const rows = db.list({ limit: 1_000_000 });
    const onSoon = DAYS.filter((day) => {
      const scenes = rows.filter((r) => r.day === day && r.kind === "world" && r.text.includes("watching TV"));
      return scenes.some((s) => rows.some((r) => r.kind === "device" && r.text === "거실·복도 에어컨 켜짐" && r.at_ms > s.at_ms && r.at_ms - s.at_ms <= 60_000));
    });
    expect(onSoon.length).toBeGreaterThanOrEqual(6);
    const first = rows.filter((r) => r.day === DAYS[0]);
    expect(first.some((r) => r.kind === "world" && r.text.includes("사람이 말함: 「아 덥다」"))).toBe(true);
    expect(db.decisions(500).filter((d) => d.text === "에어컨 켜기").map((d) => [d.day, (d.text_sent ?? "").includes("사람이 말함: 「아 덥다」")])).toEqual([[DAYS[0], true]]);
  });

  it("memories none이면 판본은 seed 하나, 반성 줄 0, 2~7일 날 고정이 없고, 합성 판단 기록의 memory_version은 seed 판본이다", () => {
    const db = HistoryDb.open(":memory:", 540);
    const r = seedHistory(db, { home: "mokryeon_180b", end: END, memories: "none" });
    expect(versions(db).map((v) => [v.version, v.source])).toEqual([[1, "synthetic"]]);
    expect(versions(db)[0]!.memory).toEqual(CUP_FSM_MEMORY);
    expect(db.list({ kinds: ["reflection"] })).toEqual([]);
    for (const day of DAYS.slice(1)) expect(pins(db)[day], day).toBeUndefined();
    expect(new Set(db.list({ kinds: ["decision"], limit: 100_000 }).map((x) => (x.data as { memory_version: number }).memory_version))).toEqual(new Set([1]));
    expect(r.versions).toEqual([1]);
    expect(r.latest).toBeNull();
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
