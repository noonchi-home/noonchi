// 하루 요약(src/brain/history/summary.ts): 반성 입력이 되는 하루 관찰 텍스트와 행동 요약.
import { describe, expect, it } from "vitest";
import { HistoryDb } from "../src/brain/history/db.js";
import { daySummary } from "../src/brain/history/summary.js";

const t = (h: number, m: number, s = 0) => Date.UTC(2026, 10, 7, h - 9, m, s); // 서울 시각
const bytes = (s: string) => Buffer.byteLength(s, "utf8");

describe("하루 요약", () => {
  it("관찰 텍스트는 감지·World State·가전 변화와 하루 분석 수, 행동 요약은 판단·실행·피드백을 시각 순으로", () => {
    const db = HistoryDb.open(":memory:");
    db.add("detection", t(7, 58), "사람 보임");
    db.add("vlm", t(7, 59), "컵이 식탁 위");
    db.add("yolo", t(7, 59, 1), "감지 오류로 YOLO 분석 없음");
    db.add("world", t(8, 0), "VLM: 컵이 식탁 위");
    db.add("device", t(8, 5), "식기세척기 running true");
    db.add("decision", t(8, 10), "컵 치우기");
    db.add("execution", t(8, 11), "컵 치우기 완료");
    db.add("feedback", t(8, 12), "다 마신 뒤에만 치워 줘");
    db.add("pam_text", t(8, 10), "보낸 텍스트");
    db.add("plan", t(8, 10), "컵 치우기 진행 중");
    db.add("detection", t(7, 0) - 86_400_000, "어제 사람 보임");
    const s = daySummary(db, "2026-11-07");
    expect(s.observation_text).toBe("07:58:00 사람 보임\n08:00:00 VLM: 컵이 식탁 위\n08:05:00 식기세척기 running true\n[하루] VLM 분석 1장 · VLM 분석 없음 0장 · YOLO 분석 없음 1장");
    expect(s.action_summary).toBe("08:10:00 클로이드 판단: 컵 치우기\n08:11:00 클로이드 실행: 컵 치우기 완료\n08:12:00 사용자: 다 마신 뒤에만 치워 줘");
    expect(s.counts).toEqual({ detection: 1, vlm: 1, yolo: 1, world: 1, device: 1, decision: 1, execution: 1, feedback: 1, pam_text: 1, plan: 1 });
    expect(s.dropped).toEqual({ observation: 0, action: 0 });
  });

  it("VLM 분석 없음은 vlm 줄의 이유와 대기열 초과 yolo 줄로 센다. 이어진 같은 줄은 묶는다", () => {
    const db = HistoryDb.open(":memory:");
    db.add("vlm", t(9, 0), "가짜 장면", { data: { missing: null } });
    db.add("vlm", t(9, 0, 1), "시간 초과로 VLM 분석 없음", { data: { missing: "timeout" } });
    db.add("yolo", t(9, 0, 2), "요청이 몰려 YOLO·VLM 분석 없음", { data: { yolo_missing: "cap", vlm_missing: "cap" } });
    db.add("yolo", t(9, 0, 3), "감지 오류로 YOLO 분석 없음", { data: { yolo_missing: "error", vlm_missing: null } });
    for (const s of [10, 11, 12]) db.add("decision", t(9, 0, s), "대기");
    const s = daySummary(db, "2026-11-07");
    expect(s.observation_text).toBe("[하루] VLM 분석 1장 · VLM 분석 없음 2장 · YOLO 분석 없음 2장");
    expect(s.action_summary).toBe("09:00:10~09:00:12 클로이드 판단: 대기 3번");
  });

  it("한도 안이면 줄이지 않고, 한쪽이 작으면 남는 몫을 다른 쪽이 쓴다", () => {
    const db = HistoryDb.open(":memory:");
    for (let i = 0; i < 200; i++) db.add("world", t(10, 0, i), `컵 cup_1 상태 ${i}`);
    db.add("decision", t(11, 0), "대기");
    const full = daySummary(db, "2026-11-07");
    const total = bytes(full.observation_text) + bytes(full.action_summary);
    expect(daySummary(db, "2026-11-07", { maxBytes: total })).toEqual(full);
    const tight = daySummary(db, "2026-11-07", { maxBytes: Math.floor(total * 0.8) });
    expect(bytes(tight.observation_text) + bytes(tight.action_summary)).toBeLessThanOrEqual(Math.floor(total * 0.8));
    expect(tight.action_summary).toBe(full.action_summary);
    expect(tight.dropped.observation).toBeGreaterThan(0);
    expect(bytes(tight.observation_text)).toBeGreaterThan(Math.floor(total * 0.7));
  });

  it("1초 간격 3시간치 기록도 반성 입력 한도 안에 든다. 한도가 작으면 오래된 줄부터 뺀다", () => {
    const db = HistoryDb.open(":memory:");
    const start = t(7, 0);
    for (let i = 0; i < 3 * 3600; i++) {
      db.add("vlm", start + i * 1000, i % 7 ? "사람이 식탁 앞에 앉아 컵을 들고 있음" : "VLM 분석 없음", { data: { missing: i % 7 ? null : "cap" } });
      if (i % 20 === 0) db.add("world", start + i * 1000, `컵 cup_${i % 3} ${i % 40 ? "비어 있음" : "내용물 있음"}`);
      if (i % 90 === 0) db.add("detection", start + i * 1000, i % 180 ? "사람 안 보임" : "사람 보임");
      if (i % 300 === 0) db.add("decision", start + i * 1000, i % 600 ? "대기" : "컵 치우기");
    }
    // PAM /health reflect_input_bytes(문맥 32768이면 약 4만)에서 기억 JSON을 뺀 값 정도면 3시간치가 다 든다
    const whole = daySummary(db, "2026-11-07", { maxBytes: 30_000 });
    expect(bytes(whole.observation_text) + bytes(whole.action_summary)).toBeLessThanOrEqual(30_000);
    expect(whole.dropped).toEqual({ observation: 0, action: 0 });
    expect(whole.observation_text.split("\n")[0]).toBe("07:00:00 컵 cup_0 내용물 있음");
    const maxBytes = 12_000;
    const s = daySummary(db, "2026-11-07", { maxBytes });
    expect(bytes(s.observation_text) + bytes(s.action_summary)).toBeLessThanOrEqual(maxBytes);
    expect(s.observation_text).not.toContain("사람이 식탁 앞에 앉아"); // 프레임마다 쓴 VLM 줄은 빠진다
    expect(s.observation_text.split("\n").at(-1)).toBe(`[하루] VLM 분석 ${10800 - Math.ceil(10800 / 7)}장 · VLM 분석 없음 ${Math.ceil(10800 / 7)}장 · YOLO 분석 없음 0장`);
    expect(s.observation_text.split("\n")[0]).toMatch(/^앞선 기록 \d+줄 생략$/);
    expect(s.observation_text).toContain("09:59:40"); // 최근 줄은 남는다
    expect(s.counts.vlm).toBe(10800);
  });
});
