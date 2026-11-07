// PAM 관찰 텍스트: 시각이 붙은 줄(오래된 것부터) + [지속] 오래 이어진 사실 + [눈] 클로이드 눈 위치.
import { describe, expect, it } from "vitest";
import type { WorldChange, WorldView } from "../src/contract/world.js";
import { buildPamText, clock, collapseLines, textFromWorld } from "../src/world/text.js";

const T = (h: number, m: number, s: number) => Date.UTC(2026, 10, 7, h - 9, m, s);
describe("PAM 관찰 텍스트", () => {
  it("시각이 붙은 줄을 오래된 것부터, 오래 이어진 사실과 눈 위치를 뒤에 둔다", () => {
    const text = buildPamText({ offsetMinutes: 540, lines: [{ atMs: T(21, 0, 4), text: "사람 안 보임" }, { atMs: T(21, 0, 0), text: "사람 보임" }],
      facts: ["컵 cup_1 식탁 위: 21:00:00부터 8초째"], eye: "클로이드 눈: 거실, 식탁 쪽" });
    expect(text).toBe("21:00:00 사람 보임\n21:00:04 사람 안 보임\n[지속] 컵 cup_1 식탁 위: 21:00:00부터 8초째\n[눈] 클로이드 눈: 거실, 식탁 쪽");
  });

  it("줄이 많으면 최근 maxLines줄만 둔다", () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({ atMs: T(21, 0, i), text: `줄${i}` }));
    expect(buildPamText({ offsetMinutes: 540, lines, facts: [], maxLines: 3 }).split("\n")).toEqual(["21:00:47 줄47", "21:00:48 줄48", "21:00:49 줄49"]);
  });

  it("이어진 같은 줄은 시각 범위와 횟수로 묶는다", () => {
    const lines = [0, 1, 2].map((s) => ({ atMs: T(21, 0, s), text: "요청이 몰려 VLM 분석 없음" })).concat([{ atMs: T(21, 0, 3), text: "사람 보임" }]);
    expect(collapseLines(lines, 540)).toEqual(["21:00:00~21:00:02 요청이 몰려 VLM 분석 없음 3번", "21:00:03 사람 보임"]);
  });

  it("떨어진 같은 줄은 묶지 않고, 빈 입력은 빈 글이다", () => {
    const lines = [{ atMs: T(21, 0, 0), text: "a" }, { atMs: T(21, 0, 1), text: "b" }, { atMs: T(21, 0, 2), text: "a" }];
    expect(collapseLines(lines, 540)).toEqual(["21:00:00 a", "21:00:01 b", "21:00:02 a"]);
    expect(buildPamText({ offsetMinutes: 540, lines: [], facts: [] })).toBe("");
  });

  it("시각은 그 시간대(분)의 시:분:초", () => {
    expect(clock(T(23, 59, 59), 540)).toBe("23:59:59");
    expect(clock(Date.UTC(2026, 10, 7, 0, 0, 5), 0)).toBe("00:00:05");
  });

  it("textFromWorld는 최근 창의 변화 줄(바뀐 VLM 요약·분석 없음 포함, 같은 줄은 묶음), 오래 이어진 사실, 남은 시간이 있는 가전, 눈 위치를 담는다", () => {
    const view: WorldView = {
      at_ms: T(21, 10, 0),
      objects: [
        { id: "cup_1", cls: "cup", position: [1, 0.75, 2], surface: "table_1", surface_label: "식탁", room: "kitchen", error_m: 0.1, status: "present",
          first_seen_ms: T(21, 0, 0), last_seen_ms: T(21, 9, 58), last_in_view_ms: T(21, 9, 58), facts: { contents: { value: "empty", at_ms: T(21, 9, 58), certainty: "confirmed" } }, devices: ["dishwasher_1"] },
        { id: "bowl_1", cls: "bowl", position: null, surface: null, surface_label: null, room: null, error_m: null, status: "out_of_view",
          first_seen_ms: T(21, 9, 30), last_seen_ms: T(21, 9, 40), last_in_view_ms: T(21, 9, 40), facts: { place: { value: "in_sink", at_ms: T(21, 9, 40), certainty: "inferred" } }, devices: [] },
        { id: "cup_2", cls: "cup", position: null, surface: null, surface_label: null, room: null, error_m: null, status: "gone",
          first_seen_ms: T(21, 0, 0), last_seen_ms: T(21, 1, 0), last_in_view_ms: T(21, 1, 0), facts: {}, devices: [] },
      ],
      person: { visible: false, since_ms: T(21, 5, 0), last_seen_ms: T(21, 4, 58), facts: {} },
      devices: [{ id: "dishwasher_1", kind: "dishwasher", label: "식기세척기", status: "작동 중", changed_ms: T(21, 0, 0), started_ms: T(21, 0, 0), remaining_min: 42, history: [] }],
      eye: { position: [1, 2], height_m: 1.5, yaw_deg: 0, pitch_deg: -30, room: "kitchen", at_ms: T(21, 9, 59) }, vlm_missing: 3, yolo_missing: 0,
    };
    const c = (kind: WorldChange["kind"], at: number, text: string): WorldChange => ({ kind, at_ms: at, subject: "x", text, meaningful: false });
    const recent = [c("appeared", T(21, 0, 0), "컵 cup_1 보임 · 식탁 위"), c("vlm", T(21, 9, 10), "VLM: 컵이 식탁 위"),
      ...[20, 21, 22].map((sec) => c("vlm_missing", T(21, 9, sec), "요청이 몰려 VLM 분석 없음"))];
    expect(textFromWorld(view, recent, { nowMs: T(21, 10, 0), offsetMinutes: 540 }).split("\n")).toEqual([
      "21:09:10 VLM: 컵이 식탁 위",
      "21:09:20~21:09:22 요청이 몰려 VLM 분석 없음 3번",
      "[지속] 컵 cup_1 식탁 위 · 비어 있음: 21:00:00부터 10분째, 마지막 확인 21:09:58",
      "[지속] 그릇 bowl_1 싱크대 안: 21:09:30부터 30초째, 마지막 확인 21:09:40, 지금 시야 밖",
      "[지속] 사람 안 보임: 21:05:00부터 5분째",
      "[지속] 식기세척기 dishwasher_1: 작동 중, 21:00:00에 바뀜, 남은 시간 42분",
      "[눈] 클로이드 눈: kitchen",
    ]);
  });

  it("첫 프레임 전이면 사람 줄에 시각을 붙이지 않는다", () => {
    const view: WorldView = { at_ms: 0, objects: [], person: { visible: false, since_ms: null, last_seen_ms: null, facts: {} }, devices: [], eye: null, vlm_missing: 0, yolo_missing: 0 };
    expect(textFromWorld(view, [], { nowMs: 0, offsetMinutes: 540 })).toBe("[지속] 사람 안 보임");
  });
});
