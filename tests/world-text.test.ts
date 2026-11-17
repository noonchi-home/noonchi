// PAM 관찰 텍스트: 시각이 붙은 줄(오래된 것부터) + [지속] 오래 이어진 사실 + [눈] 클로이드 눈 위치.
import { describe, expect, it } from "vitest";
import type { WorldChange, WorldView } from "../src/contract/world.js";
import { buildPamText, clock, collapseLines, textFromWorld } from "../src/world/text.js";
import { headWithin } from "../src/shared/cut.js";
import { MAX_OBSERVATION_TEXT, checkInput } from "../src/brain/decision.js";
import { readFileSync } from "node:fs";
import type { Detection, EngineFrame } from "../src/contract/observe.js";
import { sha256 } from "../src/observe/ring.js";
import { WorldState } from "../src/world/state/world.js";
import { det } from "./helpers/detectors.js";

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
          first_seen_ms: T(21, 0, 0), last_seen_ms: T(21, 9, 58), last_in_view_ms: T(21, 9, 58), facts: { contents: { value: "empty", at_ms: T(21, 9, 58), since_ms: T(21, 9, 58), certainty: "confirmed" } }, answered_ms: null, devices: ["dishwasher_1"], closer_hold: false, followed_by: null },
        { id: "bowl_1", cls: "bowl", position: null, surface: null, surface_label: null, room: null, error_m: null, status: "out_of_view",
          first_seen_ms: T(21, 9, 30), last_seen_ms: T(21, 9, 40), last_in_view_ms: T(21, 9, 40), facts: { place: { value: "in_sink", at_ms: T(21, 9, 40), since_ms: T(21, 9, 40), certainty: "inferred" } }, answered_ms: null, devices: [], closer_hold: false, followed_by: null },
        { id: "cup_2", cls: "cup", position: null, surface: null, surface_label: null, room: null, error_m: null, status: "gone",
          first_seen_ms: T(21, 0, 0), last_seen_ms: T(21, 1, 0), last_in_view_ms: T(21, 1, 0), facts: {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null },
      ],
      person: { visible: false, since_ms: T(21, 5, 0), last_seen_ms: T(21, 4, 58), count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} },
      fixtures: [], devices: [{ id: "dishwasher_1", kind: "dishwasher", label: "식기세척기", status: "작동 중", state: ["running"], active: true, changed_ms: T(21, 0, 0), event_ms: null, started_ms: T(21, 0, 0), remaining_min: 42, history: [] }],
      eye: { position: [1, 2], height_m: 1.5, yaw_deg: 0, pitch_deg: -30, room: "kitchen", room_label: "주방", at_ms: T(21, 9, 59) }, frame_ms: null, vlm_missing: 3, yolo_missing: 0,
    };
    const c = (kind: WorldChange["kind"], at: number, text: string): WorldChange => ({ kind, at_ms: at, subject: "x", text, meaningful: false });
    const recent = [c("appeared", T(21, 0, 0), "컵 cup_1 보임 · 식탁 위"), c("vlm", T(21, 9, 10), "VLM: 컵이 식탁 위"),
      ...[20, 21, 22].map((sec) => c("vlm_missing", T(21, 9, sec), "요청이 몰려 VLM 분석 없음"))];
    expect(textFromWorld(view, recent, { nowMs: T(21, 10, 0), offsetMinutes: 540 }).split("\n")).toEqual([
      "21:09:10 VLM: 컵이 식탁 위",
      "21:09:20~21:09:22 요청이 몰려 VLM 분석 없음 3번",
      "[지속] 컵 cup_1 식탁 위: 21:00:00부터 10분째, 마지막 확인 21:09:58",
      "[지속] 컵 cup_1 비어 있음: 21:09:58부터 2초째",
      "[지속] 그릇 bowl_1 자리 모름: 21:09:30부터 30초째, 마지막 확인 21:09:40, 지금 시야 밖",
      "[지속] 그릇 bowl_1 싱크대 안(짐작): 21:09:40부터 20초째",
      "[지속] 사람 안 보임: 21:05:00부터 5분째",
      "[지속] 식기세척기 dishwasher_1: 작동 중, 21:00:00부터 10분째, 남은 시간 42분",
      "[때] 11월 7일 토요일 밤",
      "[눈] 클로이드 눈: 주방",
    ]);
  });

  it("물건 [지속] 줄은 사실마다 그 값이 처음 보인 시각부터 세고 짐작이면 (짐작)을 붙인다: 한 장에서 짐작한 「비어 있음」을 물건을 처음 본 때부터 이어진 것처럼 쓰지 않는다(밤 판정 F)", () => {
    const view: WorldView = {
      at_ms: T(21, 0, 43),
      objects: [
        { id: "cup_1", cls: "cup", position: [9.9, 0, 4.7], surface: null, surface_label: null, room: "living", error_m: 0.12, status: "present",
          first_seen_ms: T(21, 0, 2), last_seen_ms: T(21, 0, 43), last_in_view_ms: T(21, 0, 43),
          facts: {
            place: { value: "on_table", at_ms: T(21, 0, 42), since_ms: T(21, 0, 30), certainty: "confirmed" },
            contents: { value: "empty", at_ms: T(21, 0, 41), since_ms: T(21, 0, 41), certainty: "inferred" },
          }, answered_ms: null, devices: [], closer_hold: false, followed_by: null },
      ],
      person: { visible: true, since_ms: T(21, 0, 4), last_seen_ms: T(21, 0, 43), count: 1, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} },
      fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
    };
    const lines = textFromWorld(view, [], { nowMs: T(21, 0, 43), offsetMinutes: 540 }).split("\n").filter((l) => l.startsWith("[지속] 컵"));
    expect(lines).toEqual([
      "[지속] 컵 cup_1 자리 모름: 21:00:02부터 41초째, 마지막 확인 21:00:43",
      "[지속] 컵 cup_1 식탁 위: 21:00:30부터 13초째",
      "[지속] 컵 cup_1 비어 있음(짐작): 21:00:41부터 2초째",
    ]);
  });

  it("불투명 컵은 「안이 안 보임」(짐작 아님)과 「불투명」 줄", () => {
    const cupWith = (facts: WorldView["objects"][number]["facts"]): WorldView => ({
      at_ms: T(21, 0, 9),
      objects: [{ id: "cup_1", cls: "cup", position: null, surface: null, surface_label: null, room: null, error_m: null, status: "present",
        first_seen_ms: T(21, 0, 0), last_seen_ms: T(21, 0, 9), last_in_view_ms: T(21, 0, 9), facts, answered_ms: null, devices: [], closer_hold: false, followed_by: null }],
      person: { visible: false, since_ms: null, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} },
      fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
    });
    const cupLines = (v: WorldView) => textFromWorld(v, [], { nowMs: T(21, 0, 9), offsetMinutes: 540 }).split("\n").filter((l) => l.startsWith("[지속] 컵"));
    const opaque = cupLines(cupWith({
      body: { value: "opaque", at_ms: T(21, 0, 5), since_ms: T(21, 0, 4), certainty: "confirmed" },
      contents: { value: "contents_unknown", at_ms: T(21, 0, 5), since_ms: T(21, 0, 4), certainty: "confirmed" },
    }));
    expect(opaque).toEqual(expect.arrayContaining(["[지속] 컵 cup_1 안이 안 보임: 21:00:04부터 5초째", "[지속] 컵 cup_1 불투명: 21:00:04부터 5초째"]));
  });

  it("면 자리와 같은 놓인 곳(식탁 위)도 사실 줄을 둔다: 그 값이 처음 보인 시각과 (짐작)을 잃지 않는다", () => {
    const view: WorldView = {
      at_ms: T(21, 10, 0),
      objects: [
        { id: "cup_1", cls: "cup", position: [1, 0.75, 2], surface: "table_1", surface_label: "식탁", room: "kitchen", error_m: 0.1, status: "present",
          first_seen_ms: T(21, 0, 0), last_seen_ms: T(21, 9, 58), last_in_view_ms: T(21, 9, 58),
          facts: { place: { value: "on_table", at_ms: T(21, 9, 58), since_ms: T(21, 9, 40), certainty: "inferred" } }, answered_ms: null, devices: [], closer_hold: false, followed_by: null },
      ],
      person: { visible: false, since_ms: null, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} },
      fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
    };
    expect(textFromWorld(view, [], { nowMs: T(21, 10, 0), offsetMinutes: 540 }).split("\n").filter((l) => l.startsWith("[지속] 컵"))).toEqual([
      "[지속] 컵 cup_1 식탁 위: 21:00:00부터 10분째, 마지막 확인 21:09:58",
      "[지속] 컵 cup_1 식탁 위(짐작): 21:09:40부터 20초째",
    ]);
  });

  it("관찰 텍스트는 PAM 상한(20,000자) 안이다: 물건이 많아 넘치면 오래된 시야 밖 물건부터 빼고, 보이는 물건과 사람·때·눈 줄은 남는다", () => {
    const old = (i: number): WorldView["objects"][number] => ({
      id: `book_${i}`, cls: "book", position: null, surface: null, surface_label: null, room: null, error_m: null, status: "out_of_view",
      first_seen_ms: T(20, 0, 0) + i * 1000, last_seen_ms: T(20, 0, 0) + i * 1000, last_in_view_ms: T(20, 0, 0) + i * 1000,
      facts: { place: { value: "on_table", at_ms: T(20, 0, 0) + i * 1000, since_ms: T(20, 0, 0) + i * 1000, certainty: "inferred" }, open: { value: "open", at_ms: T(20, 0, 0) + i * 1000, since_ms: T(20, 0, 0) + i * 1000, certainty: "inferred" } },
      answered_ms: null, devices: [], closer_hold: false, followed_by: null,
    });
    const cup: WorldView["objects"][number] = { id: "cup_1", cls: "cup", position: null, surface: null, surface_label: null, room: null, error_m: null, status: "present",
      first_seen_ms: T(21, 9, 0), last_seen_ms: T(21, 9, 58), last_in_view_ms: T(21, 9, 58),
      facts: { contents: { value: "empty", at_ms: T(21, 9, 58), since_ms: T(21, 9, 50), certainty: "confirmed" } }, answered_ms: null, devices: [], closer_hold: false, followed_by: null };
    const view: WorldView = {
      at_ms: T(21, 10, 0), objects: [...Array.from({ length: 400 }, (_, i) => old(i)), cup],
      person: { visible: false, since_ms: T(21, 5, 0), last_seen_ms: T(21, 4, 58), count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} },
      fixtures: [], devices: [], eye: { position: [1, 2], height_m: 1.5, yaw_deg: 0, pitch_deg: -30, room: "kitchen", room_label: "주방", at_ms: T(21, 9, 59) }, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
    };
    const c = (i: number): WorldChange => ({ kind: "vlm", at_ms: T(21, 9, 20) + i * 500, subject: "x", text: `VLM: ${"긴 요약 ".repeat(40)}${i}`, meaningful: false });
    const text = textFromWorld(view, Array.from({ length: 80 }, (_, i) => c(i)), { nowMs: T(21, 10, 0), offsetMinutes: 540 });
    expect(text.length).toBeLessThanOrEqual(MAX_OBSERVATION_TEXT);
    expect(() => checkInput({ text, finalTime: "2026-11-07T21:10:00+09:00", memory: { initial_state: "s", states: [{ id: "s", description: "d", rules: [], next: [] }] } as never, memoryKind: "fsm", tasks: ["컵 치우기"] })).not.toThrow();
    const lines = text.split("\n");
    expect(lines).toContain("[지속] 컵 cup_1 비어 있음: 21:09:50부터 10초째");
    expect(lines).toContain("[지속] 사람 안 보임: 21:05:00부터 5분째");
    expect(lines.at(-1)).toBe("[눈] 클로이드 눈: 주방");
    // 가장 새 시야 밖 물건은 남고 가장 오래된 것부터 빠진다
    expect(text).toContain("책 book_399 ");
    expect(text).not.toContain("책 book_0 ");
  });

  it("넘칠 때 빼는 차례: 시야 밖 오래된 물건 → 오래된 변화 줄 → 보이는 물건. 손에 든 물건과 사람 줄은 빼지 않는다(긴 VLM 요약이 쌓여도 지금 든 컵의 근거가 남는다)", () => {
    const fact = (value: string, since: number) => ({ value, at_ms: T(21, 9, 59), since_ms: since, certainty: "confirmed" as const });
    const thing = (id: string, cls: "cup" | "book", status: "present" | "out_of_view", last: number, facts: WorldView["objects"][number]["facts"]): WorldView["objects"][number] => ({
      id, cls, position: null, surface: null, surface_label: null, room: null, error_m: null, status, first_seen_ms: last - 60_000, last_seen_ms: last, last_in_view_ms: last,
      facts, answered_ms: null, devices: [], closer_hold: false, followed_by: null,
    });
    const view: WorldView = {
      at_ms: T(21, 10, 0),
      objects: [
        thing("book_1", "book", "out_of_view", T(21, 0, 0), { open: fact("open", T(21, 0, 0)) }),
        thing("book_2", "book", "present", T(21, 9, 59), { open: fact("open", T(21, 9, 0)) }),
        thing("cup_1", "cup", "present", T(21, 9, 59), { place: fact("in_hand", T(21, 9, 50)), contents: fact("has_contents", T(21, 9, 40)) }),
      ],
      person: { visible: true, since_ms: T(21, 9, 0), last_seen_ms: T(21, 9, 59), count: 1, room: null, room_label: null, position: null, near: [], holding: ["cup_1"], position_ms: null, answered_ms: null, facts: { holding: fact("holding_object", T(21, 9, 50)) } },
      fixtures: [], devices: [], eye: { position: [1, 2], height_m: 1.5, yaw_deg: 0, pitch_deg: -30, room: "kitchen", room_label: "주방", at_ms: T(21, 9, 59) }, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
    };
    // 긴 VLM 요약 40줄(줄마다 약 600자): 변화 줄만으로 상한을 넘는다
    const c = (i: number): WorldChange => ({ kind: "vlm", at_ms: T(21, 9, 20) + i * 1000, subject: "x", text: `VLM: ${"사람이 컵을 들고 식탁 옆에 서 있다 ".repeat(30)}${i}`, meaningful: false });
    const text = textFromWorld(view, Array.from({ length: 40 }, (_, i) => c(i)), { nowMs: T(21, 10, 0), offsetMinutes: 540 });
    expect(text.length).toBeLessThanOrEqual(MAX_OBSERVATION_TEXT);
    const lines = text.split("\n");
    // 시야 밖 오래된 물건은 빠지고, 오래된 변화 줄을 줄여 보이는 물건·손에 든 컵·사람 줄은 남는다. 가장 새 변화 줄은 남는다
    expect(text).not.toContain("책 book_1 ");
    expect(lines).toContain("[지속] 책 book_2 열림: 21:09:00부터 1분째");
    expect(lines).toContain("[지속] 컵 cup_1 손에 있음: 21:09:50부터 10초째");
    expect(lines).toContain("[지속] 컵 cup_1 내용물 있음: 21:09:40부터 20초째");
    expect(lines.some((l) => l.startsWith("[지속] 사람 보임"))).toBe(true);
    expect(lines.some((l) => l.endsWith(" 39"))).toBe(true);
    expect(lines.some((l) => l.endsWith(" 0"))).toBe(false);
  });

  it("지켜야 할 줄만으로도 넘치면(아주 긴 마지막 VLM 요약·가전 줄) 줄마다 길이를 잘라 상한을 꼭 지킨다", () => {
    const view: WorldView = {
      at_ms: T(21, 10, 0), objects: [],
      person: { visible: false, since_ms: T(21, 5, 0), last_seen_ms: T(21, 4, 58), count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} },
      fixtures: [], devices: Array.from({ length: 30 }, (_, i) => ({ id: `light_${i}`, kind: "light", label: `조명 ${"아주 긴 이름 ".repeat(60)}${i}`, status: "켜짐", state: ["on"], active: true, changed_ms: T(21, 0, 0), event_ms: null, started_ms: null, remaining_min: null, history: [] })),
      eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
    };
    const long: WorldChange = { kind: "vlm", at_ms: T(21, 9, 59), subject: "x", text: `VLM: ${"끝없이 긴 요약 ".repeat(3000)}`, meaningful: false };
    const text = textFromWorld(view, [long], { nowMs: T(21, 10, 0), offsetMinutes: 540 });
    expect(text.length).toBeLessThanOrEqual(MAX_OBSERVATION_TEXT);
    expect(() => checkInput({ text, finalTime: "2026-11-07T21:10:00+09:00", memory: { initial_state: "s", states: [{ id: "s", description: "d", rules: [], next: [] }] } as never, memoryKind: "fsm", tasks: ["컵 치우기"] })).not.toThrow();
    expect(text).toContain("[지속] 사람 안 보임: 21:05:00부터 5분째");
    expect(text.split("\n").at(-1)).toMatch(/^\[때\] /);
  });

  it("줄을 자를 때 이모지 같은 대리쌍 가운데를 자르지 않는다(짝 잃은 서로게이트는 PAM 요청 검증·UTF-8 인코딩에서 실패한다)", () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    // 앞에 붙이는 글자 수(0~3)를 바꿔 자르는 자리가 대리쌍 앞·가운데에 번갈아 걸리게 한다
    for (const pad of ["", "a", "ab", "abc"]) {
      const view: WorldView = {
        at_ms: T(21, 10, 0), objects: [],
        person: { visible: false, since_ms: T(21, 5, 0), last_seen_ms: T(21, 4, 58), count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} },
        fixtures: [], devices: Array.from({ length: 30 }, (_, i) => ({ id: `light_${i}`, kind: "light", label: `${pad}${"🍵☕".repeat(200 + i)}`, status: "켜짐", state: ["on"], active: true, changed_ms: T(21, 0, 0), event_ms: null, started_ms: null, remaining_min: null, history: [] })),
        eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
      };
      const long: WorldChange = { kind: "vlm", at_ms: T(21, 9, 59), subject: "x", text: `VLM: ${pad}${"🥤".repeat(12000)}`, meaningful: false };
      const text = textFromWorld(view, [long], { nowMs: T(21, 10, 0), offsetMinutes: 540 });
      // 길이는 brain 검사(checkInput)와 같은 UTF-16 단위로 센다. PAM은 코드 포인트로 세므로 이보다 짧거나 같다
      expect(text.length).toBeLessThanOrEqual(MAX_OBSERVATION_TEXT);
      expect(lone.test(text), `pad ${pad.length}`).toBe(false);
      expect(new TextDecoder().decode(new TextEncoder().encode(text))).toBe(text);
    }
  });

  it("앞에서 자르는 도움 함수도 대리쌍 가운데를 자르지 않는다", () => {
    expect(headWithin("a😀b", 2)).toBe("a");
    expect(headWithin("a😀b", 3)).toBe("a😀");
    expect(headWithin("abc", 5)).toBe("abc");
  });

  // 2026-11-16 23:48: 싱크볼 안 컵을 PAM이 「책상 위(짐작)」로 읽고 다시 치우기로 골랐다. 싱크대 컵의 VLM 자리 답은 22장 중 바닥·조리대 16장, 싱크대 안 0장이었다
  it("싱크볼 안 물건은 「<싱크대> 안 · 치움」으로 쓰고 VLM 자리 답은 쓰지 않는다. 손에 있으면 그 줄은 둔다", () => {
    const fact = (value: string, since: number, certainty: "inferred" | "confirmed" = "inferred") => ({ value, at_ms: T(23, 48, 49), since_ms: since, certainty });
    const cup = (facts: WorldView["objects"][number]["facts"]): WorldView["objects"][number] => ({
      id: "cup_28", cls: "cup", position: [5, 0.9, 1], surface: "sink_counter_kitchen", surface_label: "주방·식당 싱크대", surface_part: "basin", room: "kitchen", error_m: 0.06,
      status: "present", first_seen_ms: T(23, 36, 0), last_seen_ms: T(23, 48, 51), last_in_view_ms: T(23, 48, 51), facts, answered_ms: null, devices: [], closer_hold: false, followed_by: null,
    });
    const view = (o: WorldView["objects"][number]): WorldView => ({
      at_ms: T(23, 48, 52), objects: [o],
      person: { visible: false, since_ms: T(23, 46, 27), last_seen_ms: T(23, 46, 25), count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} },
      fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
    });
    const change = (s: number, text: string): WorldChange => ({ kind: "state", at_ms: T(23, 48, s), subject: "cup_28", text, meaningful: true });
    const recent = [change(36, "컵 cup_28 조리대 위"), change(36, "컵 cup_28 내용물 있음"), change(38, "컵 cup_28 바닥"), change(49, "컵 cup_28 책상 위")];
    const lines = (o: WorldView["objects"][number]) => textFromWorld(view(o), recent, { nowMs: T(23, 48, 52), offsetMinutes: 540 }).split("\n").filter((l) => l.includes("cup_28"));
    expect(lines(cup({ place: fact("on_desk", T(23, 48, 49)), contents: fact("has_contents", T(23, 48, 36)) }))).toEqual([
      "23:48:36 컵 cup_28 내용물 있음",
      "[지속] 컵 cup_28 주방·식당 싱크대 안 · 치움: 23:36:00부터 12분째, 마지막 확인 23:48:51",
      "[지속] 컵 cup_28 내용물 있음(짐작): 23:48:36부터 16초째",
    ]);
    // 싱크볼 밖(같은 싱크대 면)이면 자리 답과 변화 줄을 그대로 쓴다
    expect(lines({ ...cup({ place: fact("on_desk", T(23, 48, 49)) }), surface_part: undefined })).toContain("23:48:49 컵 cup_28 책상 위");
    expect(lines(cup({ place: fact("in_hand", T(23, 48, 49), "confirmed") }))).toEqual([
      "23:48:36 컵 cup_28 내용물 있음",
      "[지속] 컵 cup_28 주방·식당 싱크대 안 · 치움: 23:36:00부터 12분째, 마지막 확인 23:48:51",
      "[지속] 컵 cup_28 손에 있음: 23:48:49부터 3초째",
    ]);
  });

  it("눈 줄은 눈이 있는 방의 id가 아니라 방 이름을 쓴다", () => {
    const w = new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "living", label: "거실" }), devices: () => [] });
    w.setEye({ position: [1, 2], height_m: 1.4, yaw_deg: 90, pitch_deg: -10 }, T(21, 0, 0));
    expect(w.view(T(21, 0, 1)).eye).toMatchObject({ room: "living", room_label: "거실" });
    expect(textFromWorld(w.view(T(21, 0, 1)), [], { nowMs: T(21, 0, 1), offsetMinutes: 540 }).split("\n").at(-1)).toBe("[눈] 클로이드 눈: 거실");
  });

  it("첫 프레임 전이면 사람 줄에 시각을 붙이지 않는다", () => {
    const view: WorldView = { at_ms: 0, objects: [], person: { visible: false, since_ms: null, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} }, fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0 };
    expect(textFromWorld(view, [], { nowMs: 0, offsetMinutes: 540 })).toBe("[지속] 사람 안 보임\n[때] 1월 1일 목요일 오전");
  });

  it("새 상황 줄: TV 보는 중·약 먹는 중(VLM 하는 일), 세탁 멈춤(가전 사건), [지속] 사람 자세·하는 일, [때] 요일·하루 때", () => {
    const w = new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방·식당" }), devices: () => [{ id: "washer_d559f0ae", kind: "washer", label: "후면 발코니 세탁기" }] });
    const person: Detection = det("person", 0.9, [10, 10, 100, 300], 0);
    const frame = (i: number): EngineFrame => ({ id: `e${i}`, capturedAtMs: T(21, 4, i * 2), latestAtMs: T(21, 4, i * 2), jpeg: Buffer.from(`${i}`), sha256: sha256(Buffer.from(`${i}`)), width: 480, height: 360, eye: null, view: null });
    const changes: WorldChange[] = [];
    w.applyDevice({ id: "washer_d559f0ae", online: true, twin: { running: true }, matter: {}, updatedAt: "" }, T(21, 0, 0));
    let ids = new Map<string, string>();
    for (let i = 1; i <= 6; i++) {
      w.setEye({ position: [1, 2], height_m: 1.2, yaw_deg: 0, pitch_deg: -20 }, T(21, 4, i * 2));
      const r = w.applyDetections(frame(i), [person]);
      changes.push(...r.changes);
      ids = r.ids;
      if (i === 3) changes.push(...w.applyScene("e3", T(21, 4, 6), { scene: "living room", observations: [{ object_id: "d1", state: "sitting" }, { object_id: "d1", state: "on_sofa" }, { object_id: "d1", state: "watching_tv" }], summary: "사람이 소파에 앉아 TV를 본다" }, ids));
      if (i === 6) changes.push(...w.applyScene("e6", T(21, 4, 12), { scene: "living room", observations: [{ object_id: "d1", state: "sitting" }, { object_id: "d1", state: "taking_medicine" }], summary: "사람이 약을 입에 넣는다" }, ids));
    }
    changes.push(...w.applyDevice({ id: "washer_d559f0ae", online: true, twin: { running: false }, matter: {}, updatedAt: "" }, T(21, 4, 14)));
    const text = textFromWorld(w.view(T(21, 4, 20)), changes, { nowMs: T(21, 4, 20), offsetMinutes: 540 });
    // docs/world-vocabulary.md 「관찰 텍스트에서 보이는 모양」은 이 글이다
    expect(readFileSync(new URL("../docs/world-vocabulary.md", import.meta.url), "utf8").replace(/\r\n/g, "\n")).toContain(`\`\`\`\n${text}\n\`\`\``);
    expect(text.split("\n")).toEqual([
      "21:04:04 사람 보임",
      "21:04:06 VLM: 사람이 소파에 앉아 TV를 본다",
      "21:04:06 사람 앉아 있음",
      "21:04:06 사람 소파 위",
      "21:04:06 사람 TV 보는 중",
      "21:04:12 VLM: 사람이 약을 입에 넣는다",
      "21:04:12 사람 약 먹는 중",
      "21:04:14 후면 발코니 세탁기 세탁 멈춤",
      "[지속] 사람 보임: 21:04:04부터 16초째",
      "[지속] 사람 앉아 있음: 21:04:06부터 14초째",
      "[지속] 사람 약 먹는 중: 21:04:12부터 8초째",
      "[지속] 후면 발코니 세탁기 washer_d559f0ae: 멈춤, 21:04:14부터 6초째",
      "[때] 11월 7일 토요일 밤",
      "[눈] 클로이드 눈: 주방·식당",
    ]);
  });

  it("10초 넘은 지금만 맞는 사실(하는 일·쓰는 중)은 [지속]에 쓰지 않는다. 자세처럼 이어지는 사실은 쓴다", () => {
    const f = (value: string, at: number) => ({ value, at_ms: at, since_ms: at, certainty: "confirmed" as const });
    const view: WorldView = {
      at_ms: T(21, 1, 0), objects: [], fixtures: [], devices: [], eye: null, frame_ms: T(21, 1, 0), vlm_missing: 0, yolo_missing: 0,
      person: { visible: true, since_ms: T(21, 0, 0), last_seen_ms: T(21, 1, 0), count: 1, room: null, room_label: null, position: null, position_ms: null, near: [], holding: [],
        facts: { posture: f("sitting", T(21, 0, 1)), activity: f("drinking", T(21, 0, 1)) }, answered_ms: T(21, 0, 1) },
    };
    const lines = textFromWorld(view, [], { nowMs: T(21, 1, 0), offsetMinutes: 540 }).split("\n");
    expect(lines).toContain("[지속] 사람 앉아 있음: 21:00:01부터 59초째");
    expect(lines.some((l) => l.includes("마시는 중"))).toBe(false);
  });

  it("docs/pam-interface.md 예시 관찰 텍스트는 World State가 실제로 만드는 글이다", () => {
    expect(docExample()).toBe(exampleScenario());
  });
});

/** 사람이 식탁 앞에서 컵을 두고 떠나는 5장(21:00:00~21:00:04, 맞추기 전, 클로이드 눈은 주방)과 VLM 답 두 개. 21:00:08의 관찰 텍스트. */
function exampleScenario(): string {
  const w = new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
  const person: Detection = det("person", 0.9, [10, 10, 100, 300], 0);
  const cup: Detection = det("cup", 0.9, [220, 160, 40, 20], 41);
  const frame = (i: number): EngineFrame => ({ id: `e${i}`, capturedAtMs: T(21, 0, i - 1), latestAtMs: T(21, 0, i - 1), jpeg: Buffer.from(`${i}`), sha256: sha256(Buffer.from(`${i}`)), width: 480, height: 360, eye: null, view: null });
  const changes: WorldChange[] = [];
  let ids = new Map<string, string>();
  for (let i = 1; i <= 5; i++) {
    w.setEye({ position: [1, 2], height_m: 1.2, yaw_deg: 0, pitch_deg: -20 }, T(21, 0, i - 1));
    const r = w.applyDetections(frame(i), i <= 3 ? [person, cup] : [cup]);
    changes.push(...r.changes);
    ids = r.ids;
    if (i === 3) changes.push(...w.applyScene("e3", T(21, 0, 2), { scene: "kitchen", observations: [{ object_id: "d1", state: "standing" }, { object_id: "d2", state: "on_table" }], summary: "사람이 식탁 옆에 서 있고 컵이 식탁 위에 있다" }, ids));
    if (i === 5) changes.push(...w.applyScene("e5", T(21, 0, 4), { scene: "kitchen", observations: [{ object_id: "d1", state: "on_table" }, { object_id: "d1", state: "empty" }], summary: "식탁 위에 빈 컵이 있다" }, ids));
  }
  return textFromWorld(w.view(T(21, 0, 8)), changes, { nowMs: T(21, 0, 8), offsetMinutes: 540 });
}

function docExample(): string {
  const md = readFileSync(new URL("../docs/pam-interface.md", import.meta.url), "utf8");
  return JSON.parse(`"${/"observation_text": "((?:[^"\\]|\\.)*)"/.exec(md)![1]!}"`) as string;
}
