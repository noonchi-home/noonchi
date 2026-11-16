// 기록 DB(src/brain/history/db.ts): 런타임 볼륨의 SQLite 파일 하나. WAL, 잠금 대기 5초. 한 시간축 표(events)와 기록기(src/brain/history/recorder.ts).
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BrainLog } from "../src/contract/events.js";
import type { PlanView } from "../src/contract/plan.js";
import type { ControlMode } from "../src/contract/setup.js";
import type { DeviceState } from "../src/contract/devices.js";
import { HISTORY_KINDS, HistoryDb, historyTzMinutes, type HistoryKind } from "../src/brain/history/db.js";
import { attachRecorder, type DeviceNote } from "../src/brain/history/recorder.js";
import { daySummary } from "../src/brain/history/summary.js";

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

  it("한 시간축에 종류별로 쌓고 하루·종류·시각으로 꺼낸다", () => {
    const db = HistoryDb.open(":memory:");
    const t = Date.UTC(2026, 10, 7, 12); // 서울 21:00
    db.add("detection", t, "컵 보임", { subject: "cup_1" });
    db.add("decision", t + 1000, "대기", { data: { task_index: -1 } });
    db.add("vlm", Date.UTC(2026, 10, 7, 15), "다음 날 서울 0시");
    expect(db.dayOf(t)).toBe("2026-11-07");
    expect(db.dayOf(Date.UTC(2026, 10, 7, 15))).toBe("2026-11-08");
    expect(db.list({ day: "2026-11-07" }).map((r) => r.kind)).toEqual(["detection", "decision"]);
    expect(db.list({ kinds: ["decision"] })[0]).toMatchObject({ day: "2026-11-07", subject: null, text: "대기", data: { task_index: -1 } });
    expect(db.list({ since: t + 1, until: t + 1000 }).map((r) => r.kind)).toEqual(["decision"]);
    expect(db.list({ limit: 1 }).map((r) => r.text)).toEqual(["컵 보임"]);
    expect(db.list({ kinds: ["detection"] })[0]).toMatchObject({ subject: "cup_1", data: null });
  });

  it("같은 시각이면 넣은 순으로 꺼낸다(latest도 같은 순)", () => {
    const db = HistoryDb.open(":memory:");
    const t = Date.UTC(2026, 10, 7, 12);
    for (const [i, kind] of (["yolo", "device", "mode", "decision"] as HistoryKind[]).entries()) db.add(kind, t, String(i + 1));
    const q = { day: "2026-11-07", kinds: ["yolo", "device", "mode", "decision"] as HistoryKind[] };
    expect(db.list(q).map((r) => r.text)).toEqual(["1", "2", "3", "4"]);
    expect(db.list({ ...q, latest: true, limit: 2 }).map((r) => r.text)).toEqual(["3", "4"]);
    expect(db.list({ latest: true, limit: 3 }).map((r) => r.text)).toEqual(["2", "3", "4"]);
  });

  it("다시 열어도 기록이 남는다", () => {
    const path = join(mkdtempSync(join(tmpdir(), "db-")), "noonchi.db");
    const a = HistoryDb.open(path);
    a.add("feedback", 1, "다 마신 뒤에만 치워 줘");
    a.close();
    const b = HistoryDb.open(path);
    try {
      expect(b.list({}).map((r) => r.text)).toEqual(["다 마신 뒤에만 치워 줘"]);
    } finally {
      b.close();
    }
  });

  it("날짜는 HISTORY_TZ_MINUTES 시간대(기본 540)로 나눈다. 틀린 값이면 시작을 막는다", () => {
    expect(historyTzMinutes({})).toBe(540);
    expect(historyTzMinutes({ HISTORY_TZ_MINUTES: "0" })).toBe(0);
    expect(historyTzMinutes({ HISTORY_TZ_MINUTES: "-300" })).toBe(-300);
    expect(() => historyTzMinutes({ HISTORY_TZ_MINUTES: "9시" })).toThrow(/HISTORY_TZ_MINUTES/);
    expect(() => historyTzMinutes({ HISTORY_TZ_MINUTES: "900" })).toThrow(/HISTORY_TZ_MINUTES/);
    const utc = HistoryDb.open(":memory:", 0);
    expect(utc.offsetMinutes).toBe(0);
    expect(utc.dayOf(Date.UTC(2026, 10, 7, 23))).toBe("2026-11-07");
  });
});

describe("기록기", () => {
  // 시각을 고정한다. 실제 시계를 쓰면 날짜가 지나면서 고정 시각(updatedAt)으로 적는 줄과 순서가 바뀐다
  const NOW = Date.UTC(2026, 10, 7, 11); // 서울 20:00

  function wired() {
    const db = HistoryDb.open(":memory:");
    const subs: {
      device?: (s: DeviceState, o?: DeviceNote) => void; brain?: (l: BrainLog) => void; plan?: (p: PlanView) => void; mode?: (m: ControlMode) => void;
    } = {};
    const stop = attachRecorder(db, {
      onDevice: (cb) => ((subs.device = cb), () => {}), onBrain: (cb) => ((subs.brain = cb), () => {}),
      onPlan: (cb) => ((subs.plan = cb), () => {}), onMode: (cb) => ((subs.mode = cb), () => {}), now: () => NOW,
    });
    return { db, subs, stop };
  }

  it("관찰·판단·계획·모드·가전 변화·연결·멈춤을 받아 적는다(사진은 적지 않는다)", () => {
    const { db, subs } = wired();
    subs.brain!({ type: "observe", at_ms: 1, frame_id: "e1", captured_at_ms: 1, yolo: null, vlm: "컵이 식탁 위" });
    subs.brain!({ type: "observe", at_ms: 1, frame_id: "e1", captured_at_ms: 1, yolo: "컵 0.90", vlm: null }); // YOLO 결과 줄은 적지 않는다
    subs.brain!({ type: "observe", at_ms: 1, frame_id: "e2", captured_at_ms: 1, yolo: null, yolo_missing: "cap", vlm: null, vlm_missing: "cap" });
    subs.brain!({ type: "world_change", at_ms: 2, kind: "appeared", text: "컵 cup_1 보임" });
    subs.brain!({
      type: "decision", at_ms: 3, id: "pam-1", seq: 1, text_sent: "21:00:00 사람 보임", status: "valid", prediction: { observation: "o", reasoning: "r", task_index: -1 }, action: null, memory_version: 1,
      world: { objects: [], person_visible: true, vlm_missing: 0, yolo_missing: 0 },
    });
    subs.brain!({ type: "link", at_ms: 4, target: "pam", up: false, text: "PAM 연결 끊김" });
    subs.brain!({ type: "trigger", at_ms: 5, paused: true, text: "사람이 없어 판단을 멈춤" });
    subs.brain!({ type: "reflection", at_ms: 6, day: "2026-11-07", ok: true, version: 2, applies_day: "2026-11-08", text: "반성 완료" }); // 반성은 runReflection이 적는다
    subs.mode!("live");
    subs.device!({ id: "dishwasher_1", online: true, twin: { running: true }, matter: {}, updatedAt: "2026-11-07T12:00:00.000Z" });
    expect(db.list({}).map((r) => r.kind)).toEqual(["vlm", "yolo", "detection", "pam_text", "decision", "link", "trigger", "mode", "device"]);
    expect(db.list({ kinds: ["yolo"] })[0]).toMatchObject({ subject: "e2", text: "요청이 몰려 YOLO·VLM 분석 없음", data: { yolo_missing: "cap", vlm_missing: "cap" } });
    expect(db.list({ kinds: ["vlm"] })[0]).toMatchObject({ subject: "e1", text: "컵이 식탁 위", data: { captured_at_ms: 1, missing: null } });
    expect(db.list({ kinds: ["pam_text"] })[0]).toMatchObject({ subject: "pam-1", text: "21:00:00 사람 보임" });
    expect(db.list({ kinds: ["decision"] })[0]).toMatchObject({ subject: "pam-1", text: "대기", data: { seq: 1, memory_version: 1, status: "valid", prediction: { task_index: -1 } } });
    expect(db.list({ kinds: ["mode"] })[0]).toMatchObject({ at_ms: NOW, text: "실제 모드", data: { mode: "live" } });
    expect(db.list({ kinds: ["device"] })[0]).toMatchObject({ at_ms: Date.UTC(2026, 10, 7, 12), subject: "dishwasher_1", data: { attr: "running", from: null, to: true } });
    expect(JSON.stringify(db.list({}))).not.toMatch(/jpeg|base64/);
  });

  it("관찰 모드 기록은 look 줄로 대상·글과 까닭·도구·모델 까닭·결과·계획·단계 id를 적고, 하루 요약에는 넣지 않는다", () => {
    const { db, subs } = wired();
    const result = { ok: true as const, frame_id: "e3.c1", captured_at_ms: 6, crop: [120, 90, 240, 180] as [number, number, number, number], frames: 3, found: [], summary: null, vlm: "ok" as const };
    subs.brain!({
      type: "look", at_ms: NOW, trigger: "stalled", target: "sink_1", tool: "look_closer", reason: "싱크대 안을 보려고", text: "싱크대 쪽을 가까이 봄 · 컵 보임", result,
      plan_id: "plan:pam-1", step_id: "plan:pam-1:4",
    });
    subs.brain!({ type: "look", at_ms: NOW + 1, trigger: "unknown_fact", target: null, tool: "wait", reason: "다음 사진을 보려고", text: "기다림", result: null });
    const rows = db.list({ kinds: ["look"] });
    expect(HISTORY_KINDS).toContain("look");
    expect(rows[0]).toMatchObject({
      kind: "look", subject: "sink_1", text: "싱크대 쪽을 가까이 봄 · 컵 보임",
      data: { trigger: "stalled", target: "sink_1", tool: "look_closer", reason: "싱크대 안을 보려고", result: { ok: true, frames: 3 }, plan_id: "plan:pam-1", step_id: "plan:pam-1:4" },
    });
    expect(rows[1]).toMatchObject({ subject: null, text: "기다림", data: { trigger: "unknown_fact", target: null, tool: "wait", result: null, plan_id: null, step_id: null } });
    const day = daySummary(db, rows[0]!.day);
    expect(day.observation_text + day.action_summary).not.toContain("가까이");
  });

  it("VLM 분석 없음은 이유 글로, 감지 오류는 yolo 줄로 적는다", () => {
    const { db, subs } = wired();
    subs.brain!({ type: "observe", at_ms: 1, frame_id: "e1", captured_at_ms: 1, yolo: null, vlm: null, vlm_missing: "timeout" });
    subs.brain!({ type: "observe", at_ms: 2, frame_id: "e2", captured_at_ms: 2, yolo: null, yolo_missing: "error", vlm: null });
    expect(db.list({}).map((r) => [r.kind, r.text, r.data])).toEqual([
      ["vlm", "시간 초과로 VLM 분석 없음", { captured_at_ms: 1, missing: "timeout" }],
      ["yolo", "감지 오류로 YOLO 분석 없음", { captured_at_ms: 2, yolo_missing: "error", vlm_missing: null }],
    ]);
  });

  it("World State 변화: 등장·사라짐(사람 포함)은 detection, 나머지는 world", () => {
    const { db, subs } = wired();
    for (const kind of ["appeared", "gone", "person_appeared", "person_gone", "state", "device", "vlm", "out_of_view"] as const) {
      subs.brain!({ type: "world_change", at_ms: 1, kind, text: kind });
    }
    expect(db.list({}).map((r) => r.kind)).toEqual(["detection", "detection", "detection", "detection", "world", "world", "world", "world"]);
    expect(db.list({})[4]!.data).toEqual({ kind: "state" });
  });

  it("판단 실패는 이유와 함께, 고른 행동은 그 이름으로 적는다", () => {
    const { db, subs } = wired();
    const base = { type: "decision" as const, at_ms: 1, seq: 1, text_sent: "t", memory_version: 1, world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 } };
    subs.brain!({ ...base, id: "pam-1", status: "failed", prediction: null, action: null, error: "PAM 연결 실패" });
    subs.brain!({ ...base, id: "pam-2", status: "valid", prediction: { observation: "o", reasoning: "r", task_index: 0 }, action: "컵 치우기" });
    expect(db.list({ kinds: ["decision"] }).map((r) => r.text)).toEqual(["판단 실패: PAM 연결 실패", "컵 치우기"]);
  });

  it("가전: 처음 알린 상태는 적지 않고, 그 뒤 바뀐 값만 이름과 함께 적는다", () => {
    const { db, subs } = wired();
    const s = (twin: Record<string, unknown>, at: string): DeviceState => ({ id: "ac_1", online: true, twin, matter: {}, updatedAt: at });
    subs.device!(s({ power: false, setpoint: 24 }, "2026-11-07T00:00:00.000Z"), { initial: true, label: "에어컨" });
    subs.device!(s({ power: true, setpoint: 24 }, "2026-11-07T00:00:01.000Z"), { label: "에어컨" });
    subs.device!(s({ power: true, setpoint: 24 }, "2026-11-07T00:00:02.000Z"), { label: "에어컨" });
    expect(db.list({ kinds: ["device"] }).map((r) => [r.text, r.data])).toEqual([["에어컨 power true", { attr: "power", from: false, to: true }]]);
  });

  it("계획은 목표와 상태 글로, 단계는 data에 적는다", () => {
    const { db, subs } = wired();
    subs.plan!({
      id: "cup-1", revision: 2, source: "planner", goal: "컵 치우기", judgment: "", dryRun: true, robot: { position: null, room: null }, path: [], legs: [],
      steps: [{ id: "s1", kind: "wait", label: "기다리기", status: "active" }], status: "running", updatedAt: "2026-11-07T00:00:00.000Z",
    });
    expect(db.list({ kinds: ["plan"] })[0]).toMatchObject({
      at_ms: Date.UTC(2026, 10, 7), subject: "cup-1", text: "컵 치우기 진행 중", data: { revision: 2, status: "running", steps: [{ id: "s1", label: "기다리기", status: "active" }] },
    });
  });

  it("떼면 더 적지 않는다", () => {
    const db = HistoryDb.open(":memory:");
    let offs = 0;
    const stop = attachRecorder(db, {
      onDevice: () => () => { offs++; }, onBrain: () => () => { offs++; }, onPlan: () => () => { offs++; }, onMode: () => () => { offs++; },
    });
    stop();
    expect(offs).toBe(4);
  });
});
