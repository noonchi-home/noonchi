// scripts/video-check.ts의 순수 함수: 영상 시각 글, 앞 판이 남긴 서버 알아보기, 끝까지 돌지 않은 판의 markdown,
// 인자(--step), 트윈 줄, 영상 줄, 단계 판정 줄, 영상 끝 뒤 더 보기.
import { describe, expect, it } from "vitest";
import type { HistoryRow } from "../src/contract/history.js";
import type { WorldEye, WorldObject, WorldView } from "../src/contract/world.js";
import { clock, markdown, parseArgs, phoneUrl, stepVerdict, timeline, twinRows, usedServer, watchAfterEnd, type Row } from "../scripts/video-check.js";

const eye = (room: string | null, room_label: string | null, x: number, y: number): WorldEye => ({ position: [x, y], height_m: 1.4, yaw_deg: 0, pitch_deg: -20, room, room_label, at_ms: 0 });
const cup = (id: string, place: string | null, o: Partial<WorldObject> = {}): WorldObject => ({
  id, cls: "cup", position: [9.96, 0.75, 3.92], surface: "dining_table_1", surface_label: "식탁", room: "living", error_m: 0.1, status: "present",
  first_seen_ms: 0, last_seen_ms: 0, last_in_view_ms: 0,
  facts: place ? { place: { value: place, at_ms: 0, since_ms: 0, certainty: "confirmed" } } : {},
  answered_ms: null, devices: [], ...o,
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

  it("영상이 끝난 뒤에는 단추를 누르지 않는 판도 계획이 열려 있으면 30초까지 더 본다", () => {
    expect(watchAfterEnd(5_000, 0, "running")).toBe(true);
    expect(watchAfterEnd(5_000, 0, "planned")).toBe(true);
    expect(watchAfterEnd(5_000, 1, undefined)).toBe(true);
    expect(watchAfterEnd(5_000, 0, "done")).toBe(false);
    expect(watchAfterEnd(5_000, 0, undefined)).toBe(false);
    expect(watchAfterEnd(30_001, 1, "running")).toBe(false);
  });
});
