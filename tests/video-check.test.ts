// scripts/video-check.ts의 순수 함수: 영상 시각 글, 앞 판이 남긴 서버 알아보기, 끝까지 돌지 않은 판의 markdown,
// 인자(--step·--record), 트윈 줄, 영상 줄, 단계 판정 줄, 영상 끝 뒤 더 보기.
// scripts/video-record.ts: 시연 영상 이름, ffmpeg concat 목록·명령, ack 간격, 가짜 페이지로 프레임 받기, ffmpeg가 없을 때.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HistoryRow } from "../src/contract/history.js";
import type { WorldEye, WorldObject, WorldView } from "../src/contract/world.js";
import { SEND_SAY, clickChoice, clock, costLine, judgeInput, judgeState, markdown, parseArgs, phoneUrl, plannedClicks, sendStartPose, stepVerdict, timeline, twinRows, usedServer, type ClickRule, type Row, type VideoCommand } from "../scripts/video-check.js";
import { createServer, type Server } from "node:http";
import { listenRetry } from "../src/server/net.js";
import type { SceneJson } from "../src/contract/layout.js";
import { ackAt, concatList, demoFile, encodeDemo, ffmpegArgs, startRecording, type ScreencastPage } from "../scripts/video-record.js";

const eye = (room: string | null, room_label: string | null, x: number, y: number): WorldEye => ({ position: [x, y], height_m: 1.4, yaw_deg: 0, pitch_deg: -20, room, room_label, at_ms: 0 });
const cup = (id: string, place: string | null, o: Partial<WorldObject> = {}): WorldObject => ({
  id, cls: "cup", position: [9.96, 0.75, 3.92], surface: "dining_table_1", surface_label: "식탁", room: "living", error_m: 0.1, status: "present",
  first_seen_ms: 0, last_seen_ms: 0, last_in_view_ms: 0,
  facts: place ? { place: { value: place, at_ms: 0, since_ms: 0, certainty: "confirmed" } } : {},
  answered_ms: null, devices: [], closer_hold: false, followed_by: null, ...o,
});
const world = (at_ms: number, e: WorldEye | null, objects: WorldObject[]): WorldView => ({
  at_ms, objects, eye: e, fixtures: [], devices: [], frame_ms: null, vlm_missing: 0, yolo_missing: 0,
  person: { visible: false, since_ms: null, last_seen_ms: null, count: 0, position: null, position_ms: null, room: null, room_label: null, near: [], holding: [], facts: {}, answered_ms: null },
});
const texts = (rows: Row[]) => rows.map((r) => r.text);

describe("video-check", () => {
  it("영상 시각은 0.1초로 반올림한 뒤 분을 올린다", () => {
    expect([clock(0), clock(-5), clock(61_234), clock(59_960), clock(119_950), clock(76_300)]).toEqual(["00:00.0", "00:00.0", "01:01.2", "01:00.0", "02:00.0", "01:16.3"]);
  });
  it("끝나지 않은 계획이 있거나 엔진 프레임을 이미 받은 서버면 다시 띄우라고 하고, 새 서버면 null", () => {
    expect(usedServer({ status: "running", goal: "컵 치우기" }, { frames: 0 })).toMatch(/컵 치우기.*서버를 다시 띄우세요/);
    expect(usedServer({ status: "planned", goal: "컵 치우기" }, null)).toMatch(/서버를 다시 띄우세요/);
    expect(usedServer({ status: "done", goal: "컵 치우기" }, { frames: 38 })).toMatch(/엔진 프레임 38장.*서버를 다시 띄우세요/);
    expect(usedServer({ status: "done", goal: "컵 치우기" }, { frames: 0 })).toBeNull();
    expect(usedServer(null, null)).toBeNull();
  });
  it("끝까지 돌지 않은 판은 판정 줄 위에 그 까닭을 쓴다", () => {
    const md = markdown({ clip: "cup-demo.mp4", mode: "실제 서버", ranAt: "2026-11-11 10:00:00", rows: [], notes: ["끝까지 돌지 않음: 중단", "페이지 오류 2개"], verdict: "판정: 명령 없음 · 표 0줄", cost: "VLM 0장" });
    const lines = md.split("\n");
    expect(lines.indexOf("끝까지 돌지 않음: 중단")).toBeGreaterThan(-1);
    expect(lines.indexOf("페이지 오류 2개")).toBeGreaterThan(-1);
    expect(lines.indexOf("끝까지 돌지 않음: 중단")).toBeLessThan(lines.indexOf("판정: 명령 없음 · 표 0줄"));
  });

  it("--step은 여러 번 받아 폰 주소에 step=으로 하나씩 붙이고, 있으면 --done-after 기본이 0이다", () => {
    const a = parseArgs(["--clip", "cup-empty.mp4", "--step", "go:table:go-table.mp4", "--step", "pick:cup:pick-cup.mp4", "--step", "place:sink:place-sink.webm"]);
    if (typeof a === "string") throw new Error(a);
    expect(a.steps).toEqual(["go:table:go-table.mp4", "pick:cup:pick-cup.mp4", "place:sink:place-sink.webm"]);
    expect(a.doneAfterMs).toBe(0);
    expect(phoneUrl("http://127.0.0.1:8210", "cup-empty.mp4", a.steps))
      .toBe("http://127.0.0.1:8210/phone/?clip=cup-empty.mp4&step=go%3Atable%3Ago-table.mp4&step=pick%3Acup%3Apick-cup.mp4&step=place%3Asink%3Aplace-sink.webm");
    const plain = parseArgs(["--clip", "cup-demo.mp4"]);
    if (typeof plain === "string") throw new Error(plain);
    expect([plain.steps, plain.doneAfterMs, plain.fake]).toEqual([[], 3000, false]);
    expect(phoneUrl("http://127.0.0.1:8210", "cup-demo.mp4", [])).toBe("http://127.0.0.1:8210/phone/?clip=cup-demo.mp4");
    const pressed = parseArgs(["--clip", "cup-empty.mp4", "--step", "go:table:go-table.mp4", "--done-after", "2", "--fake"]);
    if (typeof pressed === "string") throw new Error(pressed);
    expect([pressed.doneAfterMs, pressed.fake]).toEqual([2000, true]);
  });
  it("그 자리에서 하는 일 단계 영상 --step do:cup:pour-water.mp4를 받는다(채워 주기 네 단계)", () => {
    const steps = ["go:fridge:go-fridge.mp4", "pick:fridge:pick-water.mp4", "go:table:go-table.mp4", "do:cup:pour-water.mp4"];
    const a = parseArgs(["--clip", "meal-empty-cup.mp4", ...steps.flatMap((s) => ["--step", s])]);
    if (typeof a === "string") throw new Error(a);
    expect(a.steps).toEqual(steps);
    expect(a.doneAfterMs).toBe(0);
    expect(phoneUrl("http://127.0.0.1:8210", "meal-empty-cup.mp4", a.steps)).toContain("&step=do%3Acup%3Apour-water.mp4");
    expect(parseArgs(["--clip", "a.mp4", "--step", "pour:cup:pour-water.mp4"])).toMatch(/--step은 <go\|pick\|place\|do>/);
  });
  it("모양이 틀린 --step·--clip이면 쓰는 법을 돌려준다", () => {
    for (const bad of ["jump:table:go-table.mp4", "go:Table:go-table.mp4", "go:table:../go-table.mp4", "go:table:go-table.mov", "go:table", "go::go-table.mp4"]) {
      expect(parseArgs(["--clip", "cup-empty.mp4", "--step", bad]), bad).toMatch(/--step/);
    }
    expect(parseArgs(["--clip", "cup-empty.mp4", "--step"])).toMatch(/--step/);
    expect(parseArgs(["--clip", "../cup.mp4"])).toMatch(/쓰는 법.*--step <종류>:<낱말>:<영상\.mp4>/);
    expect(parseArgs(["--clip", "cup.mp4", "--done-after", "-1"])).toMatch(/--done-after/);
  });

  it("트윈 줄: 처음에는 눈·컵 줄, 같은 값이면 없음, 눈은 마지막 눈 줄에서 0.5m 넘게 옮기거나 방이 바뀔 때만", () => {
    const t0 = 1_000_000;
    const a = twinRows(null, world(t0 + 1000, eye("living", "거실", 8.46, 3.92), [cup("cup_1", "on_table"), cup("bottle_1", "on_table", { cls: "bottle" })]), t0);
    expect(a.rows).toEqual([
      { ms: 1000, kind: "트윈", text: "눈 거실 (8.5, 3.9)", n: 1 },
      { ms: 1000, kind: "트윈", text: "컵 cup_1 식탁 · 식탁 위", n: 1 },
    ]);
    const b = twinRows(a.seen, world(t0 + 2000, eye("living", "거실", 8.46, 3.92), [cup("cup_1", "on_table")]), t0);
    expect(b.rows).toEqual([]);
    // 0.3m씩 두 번: 처음은 없고, 마지막 눈 줄에서 0.6m가 되면 한 줄
    const c = twinRows(b.seen, world(t0 + 3000, eye("living", "거실", 8.76, 3.92), [cup("cup_1", "on_table")]), t0);
    expect(c.rows).toEqual([]);
    const d = twinRows(c.seen, world(t0 + 4000, eye("living", "거실", 9.06, 3.92), [cup("cup_1", "on_table")]), t0);
    expect(d.rows).toEqual([{ ms: 4000, kind: "트윈", text: "눈 거실 (9.1, 3.9)", n: 1 }]);
    // 0.14m만 옮겨도 방이 바뀌면 한 줄
    const e = twinRows(d.seen, world(t0 + 5000, eye("kitchen", "주방", 9.2, 3.92), [cup("cup_1", "on_table")]), t0);
    expect(texts(e.rows)).toEqual(["눈 주방 (9.2, 3.9)"]);
    // 눈이 없으면 눈 줄이 없고, 다시 같은 자리로 오면 줄이 없다
    const f = twinRows(e.seen, world(t0 + 6000, null, [cup("cup_1", "on_table")]), t0);
    expect(f.rows).toEqual([]);
    expect(twinRows(f.seen, world(t0 + 7000, eye("kitchen", "주방", 9.2, 3.92), [cup("cup_1", "on_table")]), t0).rows).toEqual([]);
    // 방을 모르면 「방 모름」
    expect(texts(twinRows(null, world(t0, eye(null, null, 1, 2), []), t0).rows)).toEqual(["눈 방 모름 (1.0, 2.0)"]);
  });
  it("트윈 줄: 컵 놓인 곳이 식탁 위 → 손에 있음 → 싱크대 안이면 줄마다 하나, 새 id 컵이 싱크대에 생기면 한 줄", () => {
    const t0 = 0;
    const e = eye("living", "거실", 8.46, 3.92);
    const a = twinRows(null, world(1000, e, [cup("cup_1", "on_table")]), t0);
    const b = twinRows(a.seen, world(2000, e, [cup("cup_1", "in_hand", { surface: null, surface_label: null })]), t0);
    expect(b.rows).toEqual([{ ms: 2000, kind: "트윈", text: "컵 cup_1 living · 손에 있음", n: 1 }]);
    const c = twinRows(b.seen, world(3000, e, [cup("cup_1", "in_sink", { surface: "sink_kitchen", surface_label: "싱크대", room: "kitchen" })]), t0);
    expect(texts(c.rows)).toEqual(["컵 cup_1 싱크대 · 싱크대 안"]);
    // 옮긴 컵에 새 id가 붙음: 앞 컵은 그대로라 줄 없음, 새 컵 한 줄
    const sinkCup = cup("cup_9", "in_sink", { surface: "sink_kitchen", surface_label: "싱크대", room: "kitchen" });
    const d = twinRows(b.seen, world(3000, e, [cup("cup_1", "in_hand", { surface: null, surface_label: null }), sinkCup]), t0);
    expect(texts(d.rows)).toEqual(["컵 cup_9 싱크대 · 싱크대 안"]);
  });
  it("트윈 줄: 컵 상태가 시야 밖·사라짐이면 덧붙이고, 놓인 곳·자리를 모르면 그렇게 쓰고, 목록에서 빠졌다 같은 값으로 오면 줄이 없다", () => {
    const a = twinRows(null, world(1000, null, [cup("cup_1", null, { surface_label: null, room: null })]), 0);
    expect(texts(a.rows)).toEqual(["컵 cup_1 자리 모름 · 놓인 곳 모름"]);
    const b = twinRows(a.seen, world(2000, null, [cup("cup_1", null, { surface_label: null, room: null, status: "out_of_view" })]), 0);
    expect(texts(b.rows)).toEqual(["컵 cup_1 자리 모름 · 놓인 곳 모름 · 시야 밖"]);
    const c = twinRows(b.seen, world(3000, null, [cup("cup_1", null, { surface_label: null, room: null, status: "gone" })]), 0);
    expect(texts(c.rows)).toEqual(["컵 cup_1 자리 모름 · 놓인 곳 모름 · 사라짐"]);
    const d = twinRows(c.seen, world(4000, null, []), 0);
    expect(d.rows).toEqual([]);
    expect(twinRows(d.seen, world(5000, null, [cup("cup_1", null, { surface_label: null, room: null, status: "gone" })]), 0).rows).toEqual([]);
    // 면 이름만 바뀌어도 한 줄
    expect(texts(twinRows(d.seen, world(5000, null, [cup("cup_1", null, { surface_label: "조리대", room: null, status: "gone" })]), 0).rows)).toEqual(["컵 cup_1 조리대 · 놓인 곳 모름 · 사라짐"]);
  });

  it("시각표는 바꾼 단계 영상을 「영상」 줄로, 트윈 줄을 시각순으로 넣고 글이 다른 트윈 줄은 묶지 않는다", () => {
    const twin: Row[] = [
      { ms: 1000, kind: "트윈", text: "눈 거실 (8.5, 3.9)", n: 1 },
      { ms: 1000, kind: "트윈", text: "컵 cup_1 식탁 · 식탁 위", n: 1 },
      { ms: 37_000, kind: "트윈", text: "눈 거실 (9.1, 3.9)", n: 1 },
      { ms: 38_000, kind: "트윈", text: "눈 거실 (9.4, 3.9)", n: 1 },
    ];
    const commands = [{ video_ms: 34_500, id: "plan-1", step: "s1", text: "식탁으로 가 주세요" }];
    const rows = timeline(0, [], commands, 80_000, { clips: [{ video_ms: 36_000, clip: "go-table.mp4" }], twin });
    expect(rows.map((r) => [clock(r.ms), r.kind, r.text, r.n])).toEqual([
      ["00:01.0", "트윈", "눈 거실 (8.5, 3.9)", 1],
      ["00:01.0", "트윈", "컵 cup_1 식탁 · 식탁 위", 1],
      ["00:34.5", "명령", "식탁으로 가 주세요", 1],
      ["00:36.0", "영상", "단계 영상 go-table.mp4", 1],
      ["00:37.0", "트윈", "눈 거실 (9.1, 3.9)", 1],
      ["00:38.0", "트윈", "눈 거실 (9.4, 3.9)", 1],
      ["01:20.0", "끝", "영상 끝", 1],
    ]);
    // 영상·트윈이 없으면 앞과 같다
    expect(timeline(0, [], commands, null)).toEqual([{ ms: 34_500, kind: "명령", text: "식탁으로 가 주세요", n: 1 }]);
  });

  it("시각표는 관찰 모드 기록(look)을 「가까이 보기」 줄로 넣고 같은 글이 이어지면 묶는다", () => {
    const row = (id: number, at_ms: number, text: string): HistoryRow => ({ id, at_ms, day: "2026-11-11", kind: "look", subject: "sink_1", text, data: { trigger: "stalled", tool: "look_closer" } });
    const rows = timeline(0, [row(1, 40_000, "싱크대 쪽은 기다림"), row(2, 45_000, "싱크대 쪽은 기다림"), row(3, 52_000, "싱크대 쪽을 가까이 봄 · 컵 보임")], []);
    expect(rows.map((r) => [clock(r.ms), r.kind, r.text, r.n])).toEqual([
      ["00:40.0", "가까이 보기", "싱크대 쪽은 기다림", 2],
      ["00:52.0", "가까이 보기", "싱크대 쪽을 가까이 봄 · 컵 보임", 1],
    ]);
  });

  it("비용 줄: /api/brain이 없으면 모름, 가까이 보기·관찰 모드가 없으면 앞 글 그대로, 있으면 횟수와 비용(모르면 비용 모름)", () => {
    expect(costLine(null)).toBe("VLM 비용 모름(/api/brain 없음)");
    expect(costLine({ frames: 54, vlm: { sent: 54, costUsd: 0.0301 } })).toBe("VLM 54장 · $0.0301 · 엔진 프레임 54장 · PAM·계획 비용 빠짐");
    expect(costLine({ frames: 54, vlm: { sent: 54, costUsd: 0.0301 }, closer: { looks: 1 }, look: { calls: 2, costUsd: 0.0016 } }))
      .toBe("VLM 54장 · $0.0301 · 가까이 보기 1번 · 관찰 모드 2번 $0.0016 · 엔진 프레임 54장 · PAM·계획 비용 빠짐");
    expect(costLine({ frames: 54, vlm: { sent: 54, costUsd: 0.0301 }, closer: { looks: 0 }, look: { calls: 2, costUsd: null } }))
      .toBe("VLM 54장 · $0.0301 · 가까이 보기 0번 · 관찰 모드 2번 · 관찰 모드 비용 모름 · 엔진 프레임 54장 · PAM·계획 비용 빠짐");
  });

  it("비용 줄: 가까이 보기 모델 이름이 있으면 「가까이 보기 n번」 뒤에 붙인다", () => {
    expect(costLine({ frames: 54, vlm: { sent: 54, costUsd: 0.0301 }, closer: { looks: 2, model: "gpt-5.4-mini" }, look: { calls: 2, costUsd: 0.0016 } }))
      .toBe("VLM 54장 · $0.0301 · 가까이 보기 2번 gpt-5.4-mini · 관찰 모드 2번 $0.0016 · 엔진 프레임 54장 · PAM·계획 비용 빠짐");
  });

  it("단계 판정 줄: 첫 명령의 계획 단계 중 끝난 수, 누른 단추 수, 마지막 트윈 눈 방과 컵 놓인 곳", () => {
    const steps = (done: number) => ["식탁으로 가기", "컵 집기", "싱크대로 가기", "컵 내려놓기"].map((label, i) => ({ id: `s${i + 1}`, label, status: i < done ? "done" : i === done ? "active" : "pending" }));
    const plan = (id: number, at_ms: number, subject: string, done: number, status = "running"): HistoryRow => ({ id, at_ms, day: "2026-11-11", kind: "plan", subject, text: "컵 치우기", data: { status, steps: steps(done) } });
    const history = [plan(1, 1000, "plan-1", 0), plan(2, 2000, "plan-2", 4, "done"), plan(3, 3000, "plan-1", 3)];
    const commands = [{ video_ms: 34_500, id: "plan-1", step: "s1", text: "식탁으로 가 주세요" }];
    const last = world(9000, eye("kitchen", "주방", 11, 2), [
      cup("cup_1", "in_hand", { status: "gone", last_seen_ms: 8000 }),
      cup("cup_9", "in_sink", { surface_label: "싱크대", room: "kitchen", last_seen_ms: 7000 }),
      cup("cup_3", "on_table", { status: "out_of_view", last_seen_ms: 8500 }),
    ]);
    expect(stepVerdict(history, commands, 0, last)).toBe("단계: 3/4개 끝남 · 누른 단추 0번 · 트윈 눈 주방 · 컵 cup_9 싱크대 안");
    expect(stepVerdict(history, [], 2, world(9000, eye(null, null, 1, 1), [cup("cup_2", null)]))).toBe("단계: 명령 없음 · 누른 단추 2번 · 트윈 눈 방 모름 · 컵 cup_2 놓인 곳 모름");
    expect(stepVerdict([], commands, 1, null)).toBe("단계: 0/0개 끝남 · 누른 단추 1번 · 트윈 눈 모름 · 컵 없음");
  });
  it("markdown은 판정 줄 뒤에 더 쓸 줄을, 끝에 대시보드 사진 줄을 넣는다", () => {
    const md = markdown({ clip: "cup-empty.mp4", mode: "가짜 서버", ranAt: "2026-11-11 10:00:00", rows: [], notes: [], verdict: "판정: 명령 없음 · 표 0줄", extra: ["단계: 4/4개 끝남 · 누른 단추 0번 · 트윈 눈 주방 · 컵 cup_9 싱크대 안"], cost: "VLM 0장", image: "cup-empty.fake.twin.png" });
    const lines = md.split("\n");
    const at = (s: string) => lines.indexOf(s);
    expect(at("단계: 4/4개 끝남 · 누른 단추 0번 · 트윈 눈 주방 · 컵 cup_9 싱크대 안")).toBeGreaterThan(at("판정: 명령 없음 · 표 0줄"));
    expect(at("![트윈 대시보드](cup-empty.fake.twin.png)")).toBeGreaterThan(at("VLM 0장"));
  });

  it("영상이 멈춘 뒤에는 단추를 누르지 않는 판도 계획이 열려 있으면 tail(기본 30초)까지 더 본다", () => {
    const at = (stillForMs: number, due: number, planStatus: string | undefined) => judgeState({ stillForMs, clipPlayedMs: 0, clipDurationMs: 10_000, due, planStatus, tailMs: 30_000, totalMs: 60_000, maxMs: 1_800_000, offOpen: false });
    expect(at(5_000, 0, "running")).toBe("watch");
    expect(at(5_000, 0, "planned")).toBe("watch");
    expect(at(5_000, 1, undefined)).toBe("watch");
    expect(at(5_000, 0, "done")).toBe("done");
    // 계획이 아직 만들어지는 중이거나 조회가 실패한(undefined) 때는 닫힌 계획으로 보지 않고 tail까지 본다
    expect(at(5_000, 0, undefined)).toBe("watch");
    expect(at(30_001, 0, undefined)).toBe("tail_over");
    expect(at(30_001, 1, "running")).toBe("tail_over");
  });

  describe("끝내기(judgeState)", () => {
    const base = { stillForMs: null as number | null, clipPlayedMs: 10_000, clipDurationMs: 30_000 as number | null, due: 0, planStatus: "running" as string | undefined, tailMs: 300_000, totalMs: 100_000, maxMs: 1_800_000, offOpen: false };
    it("붙잡는 중 + 계획 열림 + 멈춘 지 100초, tail 300 → watch. 301초 → tail_over", () => {
      expect(judgeState({ ...base, stillForMs: 100_000 })).toBe("watch");
      expect(judgeState({ ...base, stillForMs: 301_000 })).toBe("tail_over");
    });
    it("영상 도는 중 + 계획 done + 답 없음 → done. 누를 답이 남았으면 더 본다", () => {
      expect(judgeState({ ...base, planStatus: "done" })).toBe("done");
      expect(judgeState({ ...base, planStatus: "done", due: 1 })).toBe("watch");
    });
    it("planStatus가 undefined(계획을 만드는 중·조회 실패)면 영상이 멈춰도 tail까지 본다. 명시적으로 닫힌 상태(done·failed·cancelled)만 바로 끝낸다", () => {
      expect(judgeState({ ...base, planStatus: undefined, stillForMs: 100_000 })).toBe("watch");
      expect(judgeState({ ...base, planStatus: undefined, stillForMs: 301_000 })).toBe("tail_over");
      for (const s of ["done", "failed", "cancelled"]) expect(judgeState({ ...base, planStatus: s, stillForMs: 1_000 }), s).toBe("done");
    });
    it("계획 상태와 끄기 추적은 GET /api/plan 한 답에서 함께 읽는다: 계획이 막 닫힌 답에 끄기 안내가 있으면 끝내지 않는다", () => {
      expect(judgeInput({ plan: { status: "cancelled" }, off: { hot: [], notices: ["induction_1"] } })).toEqual({ planStatus: "cancelled", offOpen: true });
      expect(judgeInput({ plan: { status: "done" }, off: { hot: ["induction_1"], notices: [] } })).toEqual({ planStatus: "done", offOpen: true });
      expect(judgeInput({ plan: { status: "done" }, off: { hot: [], notices: [] } })).toEqual({ planStatus: "done", offOpen: false });
      expect(judgeInput(null)).toEqual({ planStatus: undefined, offOpen: false });
      expect(judgeState({ ...base, ...judgeInput({ plan: { status: "cancelled" }, off: { hot: [], notices: ["induction_1"] } }) })).toBe("watch");
    });

    it("계획이 done이어도 끄기 안내(off: 명령)가 명령 줄에 남아 있으면 끝내지 않고 tail까지 본다. 안내가 풀리면 done", () => {
      expect(judgeState({ ...base, planStatus: "done", offOpen: true })).toBe("watch");
      expect(judgeState({ ...base, planStatus: "cancelled", offOpen: true, stillForMs: 100_000 })).toBe("watch");
      expect(judgeState({ ...base, planStatus: "done", offOpen: true, stillForMs: 301_000 })).toBe("tail_over");
      expect(judgeState({ ...base, planStatus: "done", offOpen: false, stillForMs: 100_000 })).toBe("done");
    });
    it("단계 영상이 20초짜리면 80초 넘게 돌 때 clip_over다(첫 영상 길이와 상관없다)", () => {
      expect(judgeState({ ...base, clipDurationMs: 20_000, clipPlayedMs: 80_000 })).toBe("watch");
      expect(judgeState({ ...base, clipDurationMs: 20_000, clipPlayedMs: 80_001 })).toBe("clip_over");
    });
    it("전체 1801초 → max_over", () => {
      expect(judgeState({ ...base, totalMs: 1_801_000 })).toBe("max_over");
    });
  });

  describe("말 넣기·시작 위치·끝내기 인자", () => {
    it("--say 5:아 덥다를 { atMs: 5000, text: 아 덥다 }로 받고, --tail·--max·--start-at·--home 기본값이 있다", () => {
      const a = parseArgs(["--clip", "tv-hot-say.mp4", "--say", "5:아 덥다", "--say", "12.5:이거 어떻게 하지"]);
      if (typeof a === "string") throw new Error(a);
      expect(a.says).toEqual([{ atMs: 5000, text: "아 덥다" }, { atMs: 12_500, text: "이거 어떻게 하지" }]);
      expect([a.tailMs, a.maxMs, a.startAt, a.home, a.approveAfterMs, a.doneOn]).toEqual([30_000, 1_800_000, null, "mokryeon_180b", 0, []]);
      const b = parseArgs(["--clip", "a.mp4", "--start-at", "microwave", "--tail", "120", "--max", "600", "--approve", "2", "--done-on", "8:그릇을 전자레인지에 넣어 주세요"]);
      if (typeof b === "string") throw new Error(b);
      expect([b.startAt, b.tailMs, b.maxMs, b.approveAfterMs, b.doneOn]).toEqual(["microwave", 120_000, 600_000, 2000, [{ afterMs: 8000, text: "그릇을 전자레인지에 넣어 주세요" }]]);
    });
    it("틀린 --say·--tail 5·--max 0·--start-at·--done-on 8:(빈 글)·--approve -1은 쓰는 법 글이다", () => {
      for (const bad of [["--say", "다섯:아 덥다"], ["--say", "5:"], ["--say", `5:${"가".repeat(61)}`], ["--tail", "5"], ["--max", "0"], ["--start-at", "garage"], ["--done-on", "8:"], ["--approve", "-1"]]) {
        expect(parseArgs(["--clip", "a.mp4", ...bad]), bad.join(" ")).toMatch(/쓰는 법/);
      }
    });
    it("시각표에 말 줄과 누름 줄이 그 시각에 있다", () => {
      const rows = timeline(0, [], [], null, { says: [{ atMs: 5000, text: "아 덥다" }], clicks: [{ ms: 9000, label: "승인", text: "인덕션을 켤까요?" }] });
      expect(rows.map((r) => [r.ms, r.kind, r.text])).toEqual([[5000, "말", "아 덥다"], [9000, "누름", "승인 · 인덕션을 켤까요?"]]);
    });
  });

  describe("장면 시작 위치(--start-at)", () => {
    let srv: Server | undefined;
    const fake = async (current: string) => {
      const got: unknown[] = [];
      srv = createServer(async (req, res) => {
        let raw = "";
        for await (const c of req) raw += c;
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url === "/api/homes") return res.end(JSON.stringify({ current, homes: [] }));
        got.push(JSON.parse(raw));
        res.end(JSON.stringify({ ok: true, start: { label: "전자레인지 앞" } }));
      });
      const { port } = await listenRetry(srv, 0, "127.0.0.1");
      return { url: `http://127.0.0.1:${port}`, got };
    };
    // 전자레인지가 있는 작은 장면(한양목련 장면에는 Task 11에서 들어간다)
    const scene: SceneJson = { plan: { rooms: [{ id: "kitchen", polygon: [[0, 0], [6, 0], [6, 4], [0, 4]] } as never] }, objects: [{ id: "microwave_kitchen", room: "kitchen", plan: { position: [1, 1] } }] };
    it("--start-at microwave면 페이지를 열기 전에 시작 위치를 보내고, 지금 집이 다르면 보내지 않고 까닭을 돌려준다", async () => {
      try {
        const ok = await fake("mokryeon_180b");
        expect(await sendStartPose(ok.url, "microwave", "mokryeon_180b", () => scene)).toBeNull();
        expect(ok.got).toEqual([expect.objectContaining({ home: "mokryeon_180b", position: expect.any(Array), yaw_deg: expect.any(Number) })]);
        srv!.close();
        const other = await fake("oneroom");
        expect(await sendStartPose(other.url, "microwave", "mokryeon_180b", () => scene)).toMatch(/oneroom/);
        expect(other.got).toEqual([]);
      } finally { srv?.close(); }
    });
  });

  describe("골라서 답하기(plannedClicks·clickChoice)", () => {
    const rule = (o: Partial<ClickRule> = {}): ClickRule => ({ approveAfterMs: 0, doneOn: [], doneAfterMs: 0, ...o });
    const cmd = (step: string, text: string, id = "plan:pam-3"): VideoCommand => ({ video_ms: 0, id, step, text });
    it("--approve 2면 :hand·:approve 질문에만 2초 뒤 「승인」, 전자레인지 문 명령에는 없음", () => {
      expect(plannedClicks(cmd("plan:pam-3:5:hand", "그릇이 뜨거워져요. 전자레인지를 켤까요?"), rule({ approveAfterMs: 2000 }), 100))
        .toEqual([{ at: 2100, label: "승인", id: "plan:pam-3", step: "plan:pam-3:5:hand", text: "그릇이 뜨거워져요. 전자레인지를 켤까요?" }]);
      expect(plannedClicks(cmd("plan:pam-3:approve", "라면 끓이기 알려 주기를 할까요?"), rule({ approveAfterMs: 2000 }), 0)).toHaveLength(1);
      expect(plannedClicks(cmd("plan:pam-3:2", "전자레인지 문을 열어 주세요"), rule({ approveAfterMs: 2000 }), 0)).toEqual([]);
    });
    it("단계 영상 없이 --approve나 --done-on만 주면 --done-after 기본은 0이다: :again 같은 다른 질문에는 예약이 없다", () => {
      for (const flags of [["--approve", "2"], ["--done-on", "8:그릇을 꺼내 주세요"]]) {
        const a = parseArgs(["--clip", "a.mp4", ...flags]);
        if (typeof a === "string") throw new Error(a);
        expect(a.doneAfterMs, flags.join(" ")).toBe(0);
        const r = { approveAfterMs: a.approveAfterMs, doneOn: a.doneOn, doneAfterMs: a.doneAfterMs };
        expect(plannedClicks(cmd("plan:pam-3:4:again", "물 받기를 계속할까요?"), r, 0), flags.join(" ")).toEqual([]);
      }
      const given = parseArgs(["--clip", "a.mp4", "--approve", "2", "--done-after", "3"]);
      if (typeof given === "string") throw new Error(given);
      expect(given.doneAfterMs).toBe(3000);
      const plain = parseArgs(["--clip", "a.mp4"]);
      if (typeof plain === "string") throw new Error(plain);
      expect(plain.doneAfterMs).toBe(3000);
    });

    it("--done-on 8:그릇을 전자레인지에 넣어 주세요면 그 글 명령에만 8초 뒤 「완료」. --step이 있고 --done-after가 없으면 그 밖 명령에는 없다", () => {
      const r = rule({ doneOn: [{ afterMs: 8000, text: "그릇을 전자레인지에 넣어 주세요" }] });
      expect(plannedClicks(cmd("plan:pam-3:3", "그릇을 전자레인지에 넣어 주세요"), r, 0)).toEqual([{ at: 8000, label: "완료", id: "plan:pam-3", step: "plan:pam-3:3", text: "그릇을 전자레인지에 넣어 주세요" }]);
      expect(plannedClicks(cmd("plan:pam-3:9", "그릇을 꺼내 주세요"), r, 0)).toEqual([]);
      expect(plannedClicks(cmd("plan:pam-3:9", "그릇을 꺼내 주세요"), rule({ doneAfterMs: 3000 }), 0)).toEqual([{ at: 3000, label: null, id: "plan:pam-3", step: "plan:pam-3:9", text: "그릇을 꺼내 주세요" }]);
    });

    /** 가짜 페이지: 지금 명령 기록과 위 줄·단추. clickChoice 식을 그 페이지에서 돌린다. */
    function page(o: { last: { id: string; step: string; text: string } | null; top: string | null; buttons: string[] }) {
      const clicked: string[] = [];
      const buttons = o.buttons.map((t) => ({ textContent: t, click: () => clicked.push(t) }));
      const g = globalThis as Record<string, unknown>;
      const run = (expr: string) => {
        const keep = { window: g.window, document: g.document };
        g.window = { __noonchiVideo: { commands: o.last ? [{ video_ms: 0, ...o.last }] : [] } };
        g.document = {
          querySelector: (sel: string) => (sel.includes("[data-phone-text]") ? (o.top === null ? null : { textContent: o.top }) : buttons[0] ?? null),
          querySelectorAll: () => buttons,
        };
        try { return (0, eval)(expr) as string | null; } finally { g.window = keep.window; g.document = keep.document; }
      };
      return { run, clicked };
    }
    const planned = { id: "plan:pam-3", step: "plan:pam-3:3", text: "그릇을 전자레인지에 넣어 주세요", label: "완료" };

    it("step이 off:인 끄기 안내 명령에는 --done-after·--done-on·--approve 어떤 누르기도 예약하지 않는다. 같은 글의 라면 12번 명령에는 --done-on이 눌린다", () => {
      const rule: ClickRule = { approveAfterMs: 1_000, doneOn: [{ afterMs: 10_000, text: "인덕션을 꺼 주세요" }], doneAfterMs: 3_000 };
      const off: VideoCommand = { video_ms: 0, id: "plan:pam-1", step: "off:plan:pam-1:induction_1:1", text: "인덕션을 꺼 주세요" };
      expect(plannedClicks(off, rule, 0)).toEqual([]);
      expect(plannedClicks({ ...off, step: "off:plan:pam-1:induction_1:1", text: "인덕션이 보이게 폰을 가까이 대 주세요" }, rule, 0)).toEqual([]);
      expect(plannedClicks({ ...off, step: "plan:pam-1:12" }, rule, 0)).toEqual([expect.objectContaining({ at: 10_000, label: "완료", step: "plan:pam-1:12" })]);
    });

    it("--say의 at은 페이지가 화면에 맞춰 남긴 at 기록(__noonchiVideo.at) 그대로다. 마지막 명령·따로 남은 대기 목록으로 만들지 않는다. 기록이 없으면 none", () => {
      const sent: string[] = [];
      const sockets = [{ readyState: 1, url: "ws://pc/phone/events?video=a.mp4", send: (d: string) => sent.push(d) }, { readyState: 1, url: "ws://pc/api/events", send: () => {} }];
      const g = globalThis as Record<string, unknown>;
      const keep = g.window;
      try {
        const send = (0, eval)(`(${SEND_SAY})`) as (this: unknown[], text: string) => boolean;
        g.window = { __noonchiVideo: { commands: [{ video_ms: 0, id: "plan:pam-1", step: "plan:pam-1:1", text: "a" }, { video_ms: 1, id: "plan:pam-1", step: "plan:pam-1:2", text: "b" }], at: { kind: "command", id: "plan:pam-1", step: "plan:pam-1:2", pending: [] } } };
        expect(send.call(sockets, "완료")).toBe(true);
        // 안전 명령이 승인 카드를 가린 동안: 승인 token은 기록에 없어 싣지 않는다
        g.window = { __noonchiVideo: { commands: [{ video_ms: 0, id: "plan:pam-1", step: "plan:pam-1:2", text: "b" }], at: { kind: "command", id: "plan:pam-0", step: "off:plan:pam-0:induction_1:1", pending: [] }, pending: ["t1"] } };
        expect(send.call(sockets, "승인")).toBe(true);
        g.window = {};
        expect(send.call(sockets, "불 꺼 줘")).toBe(true);
        expect(send.call([], "완료")).toBe(false);
      } finally { g.window = keep; }
      expect(sent.map((s) => JSON.parse(s))).toEqual([
        { type: "say", text: "완료", at: { kind: "command", id: "plan:pam-1", step: "plan:pam-1:2", pending: [] } },
        { type: "say", text: "승인", at: { kind: "command", id: "plan:pam-0", step: "off:plan:pam-0:induction_1:1", pending: [] } },
        { type: "say", text: "불 꺼 줘", at: { kind: "none", pending: [] } },
      ]);
    });

    it("지금 명령의 계획 id·단계 id·위 줄이 모두 같을 때만 그 글의 단추를 누른다", () => {
      const p = page({ last: planned, top: planned.text, buttons: ["완료"] });
      expect(p.run(clickChoice(planned))).toBe("완료");
      expect(p.clicked).toEqual(["완료"]);
    });
    it("누를 때 위 줄이 다른 명령으로 바뀌었으면 누르지 않는다", () => {
      const p = page({ last: planned, top: "그릇을 꺼내 주세요", buttons: ["완료"] });
      expect(p.run(clickChoice(planned))).toBeNull();
      expect(p.clicked).toEqual([]);
    });
    it("예약한 단계가 취소되고 같은 글의 새 단계(다른 계획 id)가 떠 있으면 누르지 않는다", () => {
      const p = page({ last: { ...planned, id: "plan:pam-4", step: "plan:pam-4:3" }, top: planned.text, buttons: ["완료"] });
      expect(p.run(clickChoice(planned))).toBeNull();
    });
    it("같은 계획에서 같은 글이 다른 단계 id로 다시 나오면 앞 예약은 누르지 않고 새 명령의 예약만 누른다", () => {
      const again = { ...planned, step: "plan:pam-3:5" };
      const p = page({ last: again, top: planned.text, buttons: ["완료"] });
      expect(p.run(clickChoice(planned))).toBeNull();
      expect(p.run(clickChoice(again))).toBe("완료");
    });
    it("취소 뒤 새 승인 질문(다른 계획 id, 같은 글)은 앞 「승인」 예약이 누르지 않는다", () => {
      const ask = { id: "plan:pam-3", step: "plan:pam-3:approve", text: "전자레인지로 데우기 알려 주기를 할까요?", label: "승인" };
      const p = page({ last: { ...ask, id: "plan:pam-5", step: "plan:pam-5:approve" }, top: ask.text, buttons: ["승인", "거절"] });
      expect(p.run(clickChoice(ask))).toBeNull();
      expect(p.clicked).toEqual([]);
    });
  });

  it("--record는 녹화 폴더를 받고, 없으면 녹화하지 않고, 폴더가 빠지면 --record <폴더>를 알려 준다", () => {
    const a = parseArgs(["--clip", "cup-demo.mp4", "--record", "runtime/demo", "--fake"]);
    if (typeof a === "string") throw new Error(a);
    expect([a.record, a.fake]).toEqual(["runtime/demo", true]);
    const plain = parseArgs(["--clip", "cup-demo.mp4"]);
    if (typeof plain === "string") throw new Error(plain);
    expect(plain.record).toBeUndefined();
    expect(parseArgs(["--clip", "cup-demo.mp4", "--record"])).toMatch(/--record <폴더>/);
    expect(parseArgs(["--clip", "cup-demo.mp4", "--record", "--fake"])).toMatch(/--record <폴더>/);
    expect(parseArgs(["--clip", "../cup.mp4"])).toMatch(/쓰는 법.*--record <폴더>/);
  });

  it("시연 영상은 녹화 폴더에 시각표 파일 이름 줄기 + .demo.mp4", () => {
    expect(demoFile("D:/rec", "C:/w/runtime/videos/cup-demo.20261112-101500.timeline.md")).toBe(join("D:/rec", "cup-demo.20261112-101500.demo.mp4"));
    expect(demoFile("rec", "out/check.md")).toBe(join("rec", "check.demo.mp4"));
  });

  it("concat 목록: 프레임마다 다음 프레임(마지막은 녹화 끝)까지, 첫 프레임은 0부터, 같은 시각은 뒤 프레임만, 끝 뒤 프레임은 빼고, 마지막 파일을 한 번 더", () => {
    const frames = [
      { file: "phone/000004.jpg", ms: 500 },
      { file: "phone/000001.jpg", ms: 120 },
      { file: "phone/000002.jpg", ms: 220 },
      { file: "phone/000003.jpg", ms: 220 },
      { file: "phone/000005.jpg", ms: 1000 },
    ];
    expect(concatList(frames, 1000)).toBe([
      "ffconcat version 1.0",
      "file 'phone/000001.jpg'", "duration 0.220",
      "file 'phone/000003.jpg'", "duration 0.280",
      "file 'phone/000004.jpg'", "duration 0.500",
      "file 'phone/000004.jpg'", "",
    ].join("\n"));
    expect(concatList([], 1000)).toBeNull();
    expect(concatList([{ file: "dash/000001.jpg", ms: 1200 }], 1000)).toBeNull();
  });

  it("ffmpeg 명령: 왼쪽 폰·오른쪽 대시보드를 높이 800에 맞춰 나란히, 10fps, H.264 yuv420p(JPEG 전체 범위를 보통 범위로), 녹화 길이만큼", () => {
    expect(ffmpegArgs({ phone: "phone.txt", dash: "dash.txt", out: "D:/rec/cup-demo.fake.demo.mp4", seconds: 95.4321, phoneSize: [390, 844], dashSize: [1280, 800] })).toEqual([
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "concat", "-safe", "0", "-i", "phone.txt",
      "-f", "concat", "-safe", "0", "-i", "dash.txt",
      "-filter_complex",
      "[0:v]fps=10,scale=370:800:force_original_aspect_ratio=decrease:force_divisible_by=2:out_range=tv,pad=370:800:(ow-iw)/2:(oh-ih)/2,setsar=1[p];"
        + "[1:v]fps=10,scale=1280:800:force_original_aspect_ratio=decrease:force_divisible_by=2:out_range=tv,pad=1280:800:(ow-iw)/2:(oh-ih)/2,setsar=1[d];"
        + "[p][d]hstack=inputs=2,format=yuv420p[v]",
      "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", "10",
      "-t", "95.432", "-movflags", "+faststart", "D:/rec/cup-demo.fake.demo.mp4",
    ]);
    // 높이가 다른 대시보드도 같은 높이로: 1280×720 → 1422×800
    expect(ffmpegArgs({ phone: "p.txt", dash: "d.txt", out: "o.mp4", seconds: 1, phoneSize: [390, 844], dashSize: [1280, 720] })[17]).toMatch(/\[1:v\]fps=10,scale=1422:800:.*pad=1422:800:/);
  });

  it("ack 시각: 처음은 바로, 그 뒤는 앞 ack에서 간격 뒤(이미 지났으면 바로)", () => {
    expect(ackAt(1000, null, 100)).toBe(1000);
    expect(ackAt(1010, 1000, 100)).toBe(1100);
    expect(ackAt(1300, 1100, 100)).toBe(1300);
  });

  it("녹화: 두 화면의 screencast 프레임을 받은 시각과 함께 폴더에 쓰고, 프레임마다 ack, 멈추면 stopScreencast와 끝 시각, 그 뒤 프레임은 버린다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "video-record-"));
    try {
      let now = 1000;
      const fakePage = () => {
        const sent: [string, object][] = [];
        const handlers = new Map<string, (p: Record<string, unknown>) => void>();
        const page: ScreencastPage & { sent: typeof sent; frame(text: string, sessionId: number): void } = {
          sent,
          async send(method, params = {}) { sent.push([method, params]); return {}; },
          on(method, fn) { handlers.set(method, fn); return () => handlers.delete(method); },
          frame(text, sessionId) { handlers.get("Page.screencastFrame")?.({ data: Buffer.from(text).toString("base64"), sessionId, metadata: {} }); },
        };
        return page;
      };
      const phone = fakePage();
      const dash = fakePage();
      const rec = await startRecording(dir, [{ name: "phone", page: phone, size: [390, 844] }, { name: "dash", page: dash, size: [1280, 800] }], { intervalMs: 0, now: () => now });
      expect(phone.sent[0]).toEqual(["Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 390, maxHeight: 844, everyNthFrame: 1 }]);
      expect(dash.sent[0]).toEqual(["Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 }]);
      now = 1150; phone.frame("p1", 7);
      now = 1200; dash.frame("d1", 3);
      now = 1260; phone.frame("p2", 8);
      await new Promise((r) => setTimeout(r, 20));
      now = 2000;
      const r = await rec.stop();
      now = 2100; phone.frame("p3", 9);
      await new Promise((r) => setTimeout(r, 20));
      expect(r).toEqual({
        endMs: 1000,
        frames: { phone: [{ file: "phone/000001.jpg", ms: 150 }, { file: "phone/000002.jpg", ms: 260 }], dash: [{ file: "dash/000001.jpg", ms: 200 }] },
        lost: 0,
      });
      expect(readFileSync(join(dir, "phone", "000002.jpg"), "utf8")).toBe("p2");
      expect(readFileSync(join(dir, "dash", "000001.jpg"), "utf8")).toBe("d1");
      expect(existsSync(join(dir, "phone", "000003.jpg"))).toBe(false);
      expect(phone.sent.filter(([m]) => m === "Page.screencastFrameAck").map(([, p]) => p)).toEqual([{ sessionId: 7 }, { sessionId: 8 }]);
      expect(phone.sent.at(-1)?.[0]).toBe("Page.stopScreencast");
      expect(dash.sent.at(-1)?.[0]).toBe("Page.stopScreencast");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("녹화 시작: 한 화면의 startScreencast 답이 제한 시간 안에 안 오면(CDP 끊김) 오류로 끝내고, 앞서 단 리스너·ack 타이머를 풀고 시작을 보낸 화면마다 stopScreencast를 보낸다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "video-record-"));
    try {
      const fakePage = (hang: boolean) => {
        const sent: [string, object][] = [];
        const handlers = new Map<string, (p: Record<string, unknown>) => void>();
        const page: ScreencastPage & { sent: typeof sent; handlers: typeof handlers; frame(text: string, sessionId: number): void } = {
          sent, handlers,
          send(method, params = {}) {
            sent.push([method, params]);
            return hang && method === "Page.startScreencast" ? new Promise<never>(() => {}) : Promise.resolve({});
          },
          on(method, fn) { handlers.set(method, fn); return () => handlers.delete(method); },
          frame(text, sessionId) { handlers.get("Page.screencastFrame")?.({ data: Buffer.from(text).toString("base64"), sessionId, metadata: {} }); },
        };
        return page;
      };
      const phone = fakePage(false);
      const dash = fakePage(true);
      let now = 1000;
      const started = startRecording(dir, [{ name: "phone", page: phone, size: [390, 844] }, { name: "dash", page: dash, size: [1280, 800] }], { intervalMs: 60_000, now: () => now, startTimeoutMs: 80 });
      // 대시보드 시작을 기다리는 사이 폰 프레임 둘: 첫 ack는 바로, 둘째 ack는 60초 뒤로 잡힌다
      await new Promise((r) => setTimeout(r, 10));
      now = 1100; phone.frame("p1", 7);
      now = 1200; phone.frame("p2", 8);
      await expect(started).rejects.toThrow(/녹화 시작.*dash/);
      expect(phone.handlers.size).toBe(0);
      expect(dash.handlers.size).toBe(0);
      expect(phone.sent.map(([m]) => m)).toEqual(["Page.startScreencast", "Page.screencastFrameAck", "Page.stopScreencast"]);
      expect(dash.sent.map(([m]) => m)).toEqual(["Page.startScreencast", "Page.stopScreencast"]);
      // 그 뒤 프레임은 쓰지 않는다
      now = 1300; phone.frame("p3", 9);
      expect(existsSync(join(dir, "phone", "000003.jpg"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["CDP 오류 답({error})", () => Promise.resolve({ error: { message: "Screencast is not supported" } }), /녹화 시작.*dash.*Screencast is not supported/],
    ["연결 끊김(Promise 거절)", () => Promise.reject(new Error("CDP 연결이 닫힘")), /CDP 연결이 닫힘/],
  ])("녹화 시작: startScreencast가 %s로 끝나도 같은 정리를 하고 그 오류를 낸다", async (_name, fail, msg) => {
    const dir = mkdtempSync(join(tmpdir(), "video-record-"));
    try {
      const sent: string[] = [];
      const handlers = new Set<string>();
      const page = (failing: boolean): ScreencastPage => ({
        send(method) {
          sent.push(method);
          return failing && method === "Page.startScreencast" ? fail() : Promise.resolve({});
        },
        on(method) { handlers.add(method); return () => handlers.delete(method); },
      });
      await expect(startRecording(dir, [{ name: "phone", page: page(false), size: [390, 844] }, { name: "dash", page: page(true), size: [1280, 800] }], { startTimeoutMs: 1000 }))
        .rejects.toThrow(msg);
      expect(handlers.size).toBe(0);
      expect(sent).toEqual(["Page.startScreencast", "Page.startScreencast", "Page.stopScreencast", "Page.stopScreencast"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ffmpeg가 없으면 프레임 폴더를 남기고 그 사실과 폴더를 알려 준다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "video-record-"));
    try {
      mkdirSync(join(dir, "phone"));
      mkdirSync(join(dir, "dash"));
      writeFileSync(join(dir, "phone", "000001.jpg"), "p");
      writeFileSync(join(dir, "dash", "000001.jpg"), "d");
      const frames = { phone: [{ file: "phone/000001.jpg", ms: 0 }], dash: [{ file: "dash/000001.jpg", ms: 10 }] };
      const r = await encodeDemo(dir, { endMs: 1000, frames, lost: 0 }, join(dir, "x.demo.mp4"), { phoneSize: [390, 844], dashSize: [1280, 800], ffmpeg: "ffmpeg-not-installed-video-check" });
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.why).toMatch(/ffmpeg가 없어요/);
      expect(r.ok ? "" : r.why).toContain(dir);
      expect(existsSync(join(dir, "phone", "000001.jpg"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
