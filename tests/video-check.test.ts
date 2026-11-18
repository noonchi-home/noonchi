// scripts/video-check.ts의 순수 함수: 영상 시각 글, 앞 판이 남긴 서버 알아보기, 끝까지 돌지 않은 판의 markdown,
// 인자(--step·--record), 트윈 줄, 영상 줄, 단계 판정 줄, 영상 끝 뒤 더 보기.
// scripts/video-record.ts: 시연 영상 이름, ffmpeg concat 목록·명령, ack 간격, 가짜 페이지로 프레임 받기, ffmpeg가 없을 때.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HistoryRow } from "../src/contract/history.js";
import type { WorldEye, WorldObject, WorldView } from "../src/contract/world.js";
import { dockId, isDockStep } from "../src/act/dock-step.js";
import { SEND_SAY, clickChoice, clock, costLine, judgeInput, judgeState, markdown, parseArgs, phoneUrl, plannedClicks, sendStartPose, mainPlan, planState, stepPlaces, stepVerdict, timeline, verdict, twinRows, usedServer, roomLabels, ownAssetFailures, videoClock, runTimeline, clipEnd, syncWarning, mustStop, openDashboard, waitLoaded, waitTwinReady, frameGapLine, type ClickRule, type Row, type VideoCommand } from "../scripts/video-check.js";
import { createServer, type Server } from "node:http";
import { listenRetry } from "../src/shared/net.js";
import type { SceneJson } from "../src/contract/layout.js";
import { ackAt, concatList, demoFile, encodeDemo, ffmpegArgs, startRecording, type ScreencastPage } from "../scripts/video-record.js";
import { chromeFlags } from "../scripts/twin3d/cdp.js";

const eye = (room: string | null, room_label: string | null, x: number, y: number): WorldEye => ({ position: [x, y], height_m: 1.4, yaw_deg: 0, pitch_deg: -20, room, room_label, at_ms: 0 });
const cup = (id: string, place: string | null, o: Partial<WorldObject> = {}): WorldObject => ({
  id, cls: "cup", position: [9.96, 0.75, 3.92], surface: "dining_table_1", surface_label: "식탁", room: "living", error_m: 0.1, status: "present",
  first_seen_ms: 0, last_seen_ms: 0, last_in_view_ms: 0,
  facts: place ? { place: { value: place, at_ms: 0, since_ms: 0, certainty: "confirmed" } } : {},
  answered_ms: null, devices: [], closer_hold: false, followed_by: null, ...o,
});
const ROOMS = new Map([["living", "거실·복도"], ["kitchen", "주방·식당"]]);
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
  it("--fov·--pitch·--h는 폰 주소에 fov=·pitch=·h=로 붙고, 준 것만 붙인다(없으면 폰 페이지 기본값)", () => {
    const a = parseArgs(["--clip", "wide.mp4", "--fov", "40", "--pitch", "-10", "--h", "1.15"]);
    if (typeof a === "string") throw new Error(a);
    expect(a.camera).toEqual({ fov: 40, pitch: -10, h: 1.15 });
    expect(phoneUrl("http://127.0.0.1:8210", "wide.mp4", a.steps, a.camera)).toBe("http://127.0.0.1:8210/phone/?clip=wide.mp4&fov=40&pitch=-10&h=1.15");
    const one = parseArgs(["--clip", "wide.mp4", "--pitch", "-10", "--step", "go:table:go-table.mp4"]);
    if (typeof one === "string") throw new Error(one);
    expect(one.camera).toEqual({ pitch: -10 });
    expect(phoneUrl("http://127.0.0.1:8210/", "wide.mp4", one.steps, one.camera)).toBe("http://127.0.0.1:8210/phone/?clip=wide.mp4&step=go%3Atable%3Ago-table.mp4&pitch=-10");
    const plain = parseArgs(["--clip", "cup-demo.mp4"]);
    if (typeof plain === "string") throw new Error(plain);
    expect(plain.camera).toEqual({});
    expect(phoneUrl("http://127.0.0.1:8210", "cup-demo.mp4", plain.steps, plain.camera)).toBe("http://127.0.0.1:8210/phone/?clip=cup-demo.mp4");
  });
  it("폰 페이지 범위 밖이거나 숫자가 아닌 --fov(20~120)·--pitch(-89~89)·--h(0.2~3)면 그 범위를 알려 준다", () => {
    for (const bad of [["--fov", "10"], ["--fov", "130"], ["--fov", "넓게"], ["--pitch", "-90"], ["--pitch", "95"], ["--h", "0.1"], ["--h", "3.5"], ["--h"], ["--fov", "--fake"]]) {
      expect(parseArgs(["--clip", "a.mp4", ...bad]), bad.join(" ")).toMatch(/--fov는 20~120.*--pitch는 -89~89.*--h는 0\.2~3/);
    }
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
    const b = twinRows(a.seen, world(2000, e, [cup("cup_1", "in_hand", { surface: null, surface_label: null })]), t0, ROOMS);
    // 면이 없으면 방 이름(장면의 방 label)을 쓴다. 방 id(living)는 쓰지 않는다
    expect(b.rows).toEqual([{ ms: 2000, kind: "트윈", text: "컵 cup_1 거실·복도 · 손에 있음", n: 1 }]);
    // 방 이름을 모르면 「방 모름」
    expect(texts(twinRows(a.seen, world(2000, e, [cup("cup_1", "in_hand", { surface: null, surface_label: null })]), t0).rows)).toEqual(["컵 cup_1 방 모름 · 손에 있음"]);
    const c = twinRows(b.seen, world(3000, e, [cup("cup_1", "in_sink", { surface: "sink_kitchen", surface_label: "싱크대", room: "kitchen" })]), t0);
    expect(texts(c.rows)).toEqual(["컵 cup_1 싱크대 · 싱크대 안"]);
    // 옮긴 컵에 새 id가 붙음: 앞 컵은 그대로라 줄 없음, 새 컵 한 줄
    const sinkCup = cup("cup_9", "in_sink", { surface: "sink_kitchen", surface_label: "싱크대", room: "kitchen" });
    const d = twinRows(b.seen, world(3000, e, [cup("cup_1", "in_hand", { surface: null, surface_label: null }), sinkCup]), t0);
    expect(texts(d.rows)).toEqual(["컵 cup_9 싱크대 · 싱크대 안"]);
  });
  it("장면(/api/scene)의 방 목록으로 방 id → 이름 표를 만든다. 이름이 없는 방은 표에 넣지 않아 컵 줄에 「방 모름」이 나온다(id를 쓰지 않음)", () => {
    const rooms = roomLabels({ scene: { plan: { rooms: [{ id: "living", label: "거실·복도" }, { id: "kitchen" }, { id: "bath", label: "  " }] } } });
    expect(rooms).toEqual(new Map([["living", "거실·복도"]]));
    const e = eye("living", "거실", 8.46, 3.92);
    expect(texts(twinRows(null, world(1000, e, [cup("cup_1", "in_hand", { surface: null, surface_label: null, room: "kitchen" })]), 0, rooms).rows))
      .toEqual(["눈 거실 (8.5, 3.9)", "컵 cup_1 방 모름 · 손에 있음"]);
    expect(roomLabels(null)).toEqual(new Map());
    expect(roomLabels({ scene: { plan: {} } })).toEqual(new Map());
  });
  it("폰 페이지 자기 자원(<폰 주소>/assets/…)을 받지 못한 오류만 찾는다: 다른 주소·favicon·자원 아닌 오류는 아니다", () => {
    const base = "http://127.0.0.1:8210";
    const errors = [
      "받기 실패: net::ERR_CONNECTION_FAILED",
      "log: Failed to load resource: net::ERR_CONNECTION_FAILED http://127.0.0.1:8210/assets/alert-dialog-PYGbO-i9.js",
      "log: Failed to load resource: net::ERR_CONNECTION_FAILED http://127.0.0.1:8210/favicon.ico",
      "log: Failed to load resource: the server responded with a status of 404 (Not Found) http://127.0.0.1:8200/api/x",
      "console.error: 무엇",
    ];
    expect(ownAssetFailures(errors, base)).toEqual(["http://127.0.0.1:8210/assets/alert-dialog-PYGbO-i9.js"]);
    expect(ownAssetFailures(errors.filter((e) => !e.includes("/assets/")), base)).toEqual([]);
  });
  it("자기 자원 견주기는 주소를 정규화한 origin으로 한다: 기본 포트를 적은 --phone, 끝 슬래시, 대소문자가 달라도 같은 곳이다", () => {
    const fail = (url: string) => `log: Failed to load resource: net::ERR_CONNECTION_FAILED ${url}`;
    // 크롬은 기본 포트를 뺀 주소를 적는다
    expect(ownAssetFailures([fail("https://win-pc.tail0c3e15.ts.net/assets/a.js")], "https://win-pc.tail0c3e15.ts.net:443")).toEqual(["https://win-pc.tail0c3e15.ts.net/assets/a.js"]);
    expect(ownAssetFailures([fail("http://127.0.0.1/assets/a.js")], "http://127.0.0.1:80/")).toEqual(["http://127.0.0.1/assets/a.js"]);
    expect(ownAssetFailures([fail("http://127.0.0.1:8210/assets/a.js")], "HTTP://127.0.0.1:8210///")).toEqual(["http://127.0.0.1:8210/assets/a.js"]);
    expect(ownAssetFailures([fail("http://win-pc:8210/assets/a.js")], "http://WIN-PC:8210")).toEqual(["http://win-pc:8210/assets/a.js"]);
    // 다른 포트·호스트·자원 밖 경로는 아니다
    expect(ownAssetFailures([fail("http://127.0.0.1:8200/assets/a.js"), fail("http://127.0.0.1:8210/phone/x.js"), fail("not a url")], "http://127.0.0.1:8210")).toEqual([]);
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

  // 2026-11-17 cup-empty --fake: 영상이 처음 17초 동안 여러 번 멈칫해(waiting) 영상 시각이 서버 시계보다 6.6초 늦어졌는데, 서버 사건을 t0 하나로 옮겨
  // 폰 명령·누름(영상 시각)보다 늘 약 8초 늦게 찍혔다(명령 00:28.0 ↔ 계획 00:35.6)
  describe("서버 시각 → 영상 시각(videoClock): 폰 페이지가 남긴 짝(sync: [서버 시각, 영상 시각])으로 옮긴다", () => {
    it("짝이 없으면(옛 기록) t0를 뺀다", () => {
      expect(videoClock(1000, [])(5000)).toBe(4000);
    });
    it("짝 사이는 잇고(멈칫한 구간은 그 사이에 몰린다), 첫 짝 앞과 마지막 짝 뒤는 1:1로 센다", () => {
      // 서버 10 000에 영상 0, 13 000에 3 000(1:1), 그 뒤 2초 멈칫해 15 100에 영상 3 100
      const at = videoClock(10_000, [[10_000, 0], [13_000, 3_000], [15_100, 3_100]]);
      expect(at(9_000)).toBe(-1_000);
      expect(at(12_000)).toBe(2_000);
      expect(at(14_050)).toBeCloseTo(3_050, 0);
      expect(at(20_100)).toBe(8_100);
    });
    it("시각표의 서버 기록·트윈 줄은 그 짝으로 옮겨 폰 명령(영상 시각)과 한 시계에 선다", () => {
      // 영상 시각 7 600ms만큼 멈칫한 뒤: 폰 명령 28 000(영상 시각)은 서버 시각 1 035 600 무렵에 받았고 그때 계획이 생겼다
      const clockOf = videoClock(1_000_000, [[1_000_000, 0], [1_004_000, 4_000], [1_011_600, 4_000]]);
      const plan: HistoryRow = { id: 1, at_ms: 1_035_600, day: "2026-11-17", kind: "plan", subject: "plan:pam-1", text: "컵 치우기 계획됨", data: { status: "planned", steps: [] } };
      const rows = timeline(clockOf, [plan], [{ video_ms: 28_000, id: "plan:pam-1", step: "s1", text: "식탁으로 가 주세요" }], null, { twin: [{ ms: clockOf(1_035_600), kind: "트윈", text: "눈 거실 (8.5, 3.9)", n: 1 }] });
      expect(Object.fromEntries(rows.map((r) => [r.kind, clock(r.ms)]))).toEqual({ 명령: "00:28.0", 계획: "00:28.0", 트윈: "00:28.0" });
    });
  });

  // Codex(f5ff586): --say의 「말」 줄은 벽시계 경과 시간을 써서, 영상이 멈칫하면 짝으로 옮긴 서버 사건과 다시 어긋났다
  it("판 끝 시각표(runTimeline): 서버 시각으로 둔 트윈 줄·누름·말을 모두 같은 짝으로 영상 시각에 옮긴다", () => {
    // 영상 시각 4초에서 7.6초 멈칫: 서버 시각 1 011 600 뒤부터는 7.6초를 뺀다
    const sync: [number, number][] = [[1_000_000, 0], [1_004_000, 4_000], [1_011_600, 4_000]];
    const rows = runTimeline({
      t0: 1_000_000, sync, history: [], commands: [{ video_ms: 28_000, id: "plan:pam-1", step: "s1", text: "식탁으로 가 주세요" }], endMs: null, clips: [],
      twin: [{ ms: 1_035_600, kind: "트윈", text: "눈 거실 (8.5, 3.9)", n: 1 }],
      says: [{ at: 1_035_600, text: "아 덥다" }], clicks: [{ at: 1_039_600, label: "완료", text: "식탁으로 가 주세요" }],
    });
    expect(Object.fromEntries(rows.map((r) => [r.kind, clock(r.ms)]))).toEqual({ 명령: "00:28.0", 트윈: "00:28.0", 말: "00:28.0", 누름: "00:32.0" });
  });

  // Codex(b89b077): 짝이 상한을 넘으면 틀린 시각을 보이는 대신 시각표 위에 알리고 판정을 실패로 한다
  it("짝 넘침(record.syncFull)이면 경고 글을 내고, 시각표 위(표 머리 앞)에 적는다", () => {
    expect(syncWarning(null)).toBeNull();
    expect(syncWarning({ syncFull: false })).toBeNull();
    const warn = syncWarning({ syncFull: true })!;
    expect(warn).toMatch(/짝 넘침/);
    const md = markdown({ clip: "long.mp4", mode: "가짜 서버", ranAt: "2026-11-17 10:00:00", rows: [], notes: [], verdict: "판정: 명령 없음", cost: "VLM 0장", warnings: [warn] });
    expect(md.indexOf(warn)).toBeGreaterThan(0);
    expect(md.indexOf(warn)).toBeLessThan(md.indexOf("| 영상 시각 |"));
  });

  // 2026-11-17 녹화 시작 실패(4번 중 2번 「녹화 시작 응답(dash) 오류: Not attached to an active page」): Page.navigate 답은 새 문서가 들어서기(commit) 전에 와서
  // 바로 Page.startScreencast를 보내면 실패한다(따로 재현: navigate 답 바로 뒤 12번 중 11번 실패, 불러오기 끝을 기다리면 12번 모두 됨)
  describe("대시보드 창 열기(openDashboard)는 대시보드 문서가 다 불러와질 때까지 기다린다", () => {
    const fakeTab = (answers: (unknown[] | null)[]) => {
      const calls: string[] = [];
      let i = 0;
      return {
        calls,
        send: async (method: string) => {
          calls.push(method);
          if (method !== "Runtime.evaluate") return {};
          const v = answers[Math.min(i++, answers.length - 1)];
          return v === null ? { error: { message: "Not attached to an active page" } } : { result: { result: { value: v } } };
        },
      };
    };
    it("크기 → 옮기기 뒤, 옛 빈 문서(about:blank)·붙지 못함·불러오는 중을 지나 대시보드 주소가 complete일 때 돌아온다", async () => {
      const tab = fakeTab([["null", "complete"], null, ["http://127.0.0.1:8200", "loading"], ["http://127.0.0.1:8200", "complete"]]);
      await openDashboard(tab as never, "http://127.0.0.1:8200", { waitMs: 5_000, everyMs: 1 });
      expect(tab.calls.slice(0, 2)).toEqual(["Emulation.setDeviceMetricsOverride", "Page.navigate"]);
      expect(tab.calls.filter((c) => c === "Runtime.evaluate")).toHaveLength(4);
    });
    it("정한 시간 안에 다 불러오지 못하면 던진다", async () => {
      const tab = fakeTab([["null", "complete"]]);
      await expect(openDashboard(tab as never, "http://127.0.0.1:8200", { waitMs: 50, everyMs: 5 })).rejects.toThrow(/대시보드/);
    });
    // Codex(9e88b73): Runtime.evaluate 답 자체에 시간 제한이 없어, 답이 멈추면 상한도 안 걸리고 크롬 정리까지 못 갔다
    it("확인 답이 오지 않아도(멈춤) 남은 대기 시간이 지나면 던진다", async () => {
      const tab = { send: (method: string) => (method === "Runtime.evaluate" ? new Promise(() => {}) : Promise.resolve({})) };
      const t0 = Date.now();
      await expect(openDashboard(tab as never, "http://127.0.0.1:8200", { waitMs: 200, everyMs: 5 })).rejects.toThrow(/대시보드/);
      expect(Date.now() - t0).toBeLessThan(2000);
    });
    // Codex(9e88b73): 폰 문서 로드는 녹화 시작 뒤에 기다려, 폰 탐색이 늦으면 폰에서도 같은 「Not attached to an active page」가 났다
    it("폰 페이지도 같은 기다리기(waitLoaded)로 그 origin 문서가 다 뜬 뒤 녹화를 시작한다", async () => {
      const tab = fakeTab([["null", "complete"], ["http://127.0.0.1:8210", "interactive"], ["http://127.0.0.1:8210", "complete"]]);
      await waitLoaded(tab as never, "http://127.0.0.1:8210/phone/?clip=cup-empty.mp4", { what: "폰 페이지", waitMs: 5_000, everyMs: 1 });
      expect(tab.calls.filter((c) => c === "Runtime.evaluate")).toHaveLength(3);
      const src = readFileSync(new URL("../scripts/video-check.ts", import.meta.url), "utf8");
      expect(src.indexOf("await waitLoaded(cdp, url")).toBeGreaterThan(0);
      expect(src.indexOf("await waitLoaded(cdp, url")).toBeLessThan(src.indexOf("rec = await startRecording("));
    });
  });

  // Codex(2f54d81): 짝 넘침 뒤에도 마지막 짝에서 1:1로 이어 세어 --say를 보냈다(영상이 멈추면 예정보다 먼저 승인·완료 말이 나가고, 끝 코드로 되돌릴 수 없다)
  it("짝 넘침을 읽으면 판정 루프를 그 자리에서 멈춘다: 루프는 읽은 바로 뒤 mustStop을 보고, 말·누름 보내기는 그 뒤에 있다", () => {
    expect(mustStop(null)).toBeNull();
    expect(mustStop({ syncFull: false })).toBeNull();
    expect(mustStop({ syncFull: true })).toBe("sync_full");
    const src = readFileSync(new URL("../scripts/video-check.ts", import.meta.url), "utf8");
    const loop = src.slice(src.indexOf("      for (;;) {"));
    const at = (s: string) => loop.indexOf(s);
    expect(at("mustStop(seen.record)")).toBeGreaterThan(0);
    expect(at("mustStop(seen.record)")).toBeLessThan(at("sendSay(cdp"));
    expect(at("mustStop(seen.record)")).toBeLessThan(at("clickChoice(d)"));
    // 넘침이면 시각표·판정을 만들지 않고 실패로 끝낸다: 기록을 받아 판정하기 전에 돌아간다
    expect(at("판정: 짝 넘침으로 하지 않음")).toBeGreaterThan(0);
    expect(at("판정: 짝 넘침으로 하지 않음")).toBeLessThan(at("/api/history?since="));
  });

  // Codex(f5ff586): --fake --step은 단계 영상으로 바뀐 뒤 record.ended가 계속 거짓이라, 끝까지 돌아도 영상 끝이 없었다
  it("영상 끝(clipEnd): 붙잡기(hold)면 붙잡기 시작 영상 시각, 첫 영상이 끝났는데 붙잡기 전이면 지금 영상 시작 + 길이, 도는 중이면 null", () => {
    const rec = (over: Record<string, unknown> = {}) => ({ t0: 0, ended: false, hold: null, commands: [], clips: [], sync: [], ...over }) as never;
    expect(clipEnd({ record: rec({ hold: { clip: "place-sink.mp4", since: 96_400 } }), time: 3.1, duration: 3.1, ended: true }, 93_300, 3.1)).toBe(96_400);
    expect(clipEnd({ record: rec({ ended: true }), time: 74.1, duration: 74.12, ended: true }, 0, 74.12)).toBe(74_120);
    expect(clipEnd({ record: rec(), time: 30, duration: 74.12, ended: false }, 0, 74.12)).toBeNull();
    expect(clipEnd({ record: null, time: 74.1, duration: 74.12, ended: true }, 0, 74.12)).toBe(74_120);
    expect(clipEnd({ record: null, time: 10, duration: 74.12, ended: false }, 0, 74.12)).toBeNull();
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

  // 2026-11-18 wide-glass q2 거짓 실패: 첫 명령이 찾기(「식탁 위를 비춰 주세요」, find:1)라 컵 치우기 계획이 끝나고 컵이 싱크대 안인데 「계획 안 끝남 · 단계 0/0개」였다
  describe("판정 기준 계획(mainPlan): 찾기·충전 자리·다른 계획이 끼어도 컵 치우기 계획 하나", () => {
    const steps4 = (done: number) => ["식탁으로 가기", "컵 집기", "싱크대로 가기", "컵 내려놓기"].map((label, i) => ({ id: `plan:pam-2:${i + 1}`, label, status: i < done ? "done" : "active" }));
    const row = (id: number, subject: string, text: string, status: string, done: number): HistoryRow =>
      ({ id, at_ms: id * 1000, day: "2026-11-18", kind: "plan", subject, text, data: { status, steps: steps4(done) } });
    const history = [row(1, "plan:pam-1", "사용자에게 물어보기 계획됨", "done", 0), row(2, "plan:pam-2", "컵 치우기 계획됨", "running", 0), row(3, "plan:pam-2", "컵 치우기 끝남", "done", 4)];
    const commands: VideoCommand[] = [
      { video_ms: 17_600, id: "find:1", step: "find:1:aim:1", text: "식탁 위를 비춰 주세요" },
      { video_ms: 20_000, id: "plan:pam-1", step: "plan:pam-1:1", text: "어떻게 할까요?" },
      { video_ms: 29_200, id: "plan:pam-2", step: "plan:pam-2:1", text: "식탁으로 가 주세요" },
      { video_ms: 75_000, id: "dock:1", step: "dock:1:1", text: "충전 자리로 가 주세요" },
    ];
    it("찾기(find:)·충전 자리(dock:)는 계획이 아니고, 계획이 여럿이면 컵 치우기 계획이다", () => {
      expect(mainPlan(commands, history)).toBe("plan:pam-2");
      expect(mainPlan(commands.filter((c) => c.id !== "plan:pam-2"), history)).toBe("plan:pam-1");
      expect(mainPlan(commands.filter((c) => c.id.startsWith("find") || c.id.startsWith("dock")), [])).toBeNull();
      // 계획 명령이 하나도 없으면 기록의 마지막 컵 치우기 계획(명령 없이 실패한 판도 판정한다)
      expect(mainPlan([], history)).toBe("plan:pam-2");
      expect(planState("plan:pam-2", history)).toBe("done");
      expect(planState(null, history)).toBeNull();
      // wide-glass c1: 「컵 치우기 계획됨」→ 실행 실패(대상 물건이 보이지 않아 실행하지 않아요) → 「컵 치우기 실패」, 명령 0개
      const exec = (id: number, subject: string, state: string): HistoryRow => ({ id, at_ms: id * 1000, day: "2026-11-18", kind: "execution", subject, text: "대상 물건이 보이지 않아 실행하지 않아요", data: { state } });
      const c1 = [row(32, "plan:pam-4", "컵 치우기 계획됨", "planned", 0), exec(35, "plan:pam-4", "failed"), row(36, "plan:pam-4", "컵 치우기 실패", "failed", 0)];
      expect(mainPlan([], c1)).toBe("plan:pam-4");
      expect(planState("plan:pam-4", c1)).toBe("failed");
      // wide-tall m1: 「컵 치우기 계획됨」뒤 명령 없이 영상이 끝남
      const m1 = [row(34, "plan:pam-6", "컵 치우기 계획됨", "planned", 0)];
      expect(planState(mainPlan([], m1), m1)).toBe("planned");
      expect(mainPlan([], [])).toBeNull();
    });
    it("판정 줄의 계획 끝남과 단계 판정 줄의 단계 수는 그 계획 하나로 센다(첫 명령 시각은 처음 나간 명령 그대로)", () => {
      const v = verdict([], commands, history, 36_300);
      expect(v.done).toBe(true);
      expect(v.text).toBe("판정: 첫 명령 00:17.6 「식탁 위를 비춰 주세요」 · 36.3초 전 명령 3개 있음 · 계획 끝남");
      expect(stepVerdict(history, commands, 0, null)).toBe("단계: 4/4개 끝남 · 누른 단추 0번 · 트윈 눈 모름 · 컵 없음");
    });
  });

  // 2026-11-18 tall q1 거짓 통과: 첫 명령이 「세탁기로 가 주세요」(발코니 유령 컵)였는데 단계 영상이 차례로 돌아 「계획 끝남 · 4/4」였다
  describe("단계 자리 판정(stepPlaces)", () => {
    const STEPS = ["go:table:go-table.mp4", "pick:cup:pick-cup.mp4", "go:sink:go-sink.mp4", "place:sink:place-cup.mp4"];
    const command = (n: number, kind: string, id: string, label: string, plan = "plan:pam-3"): VideoCommand =>
      ({ video_ms: n * 1000, id: plan, step: `${plan}:${n}`, text: `${label} 명령`, kind, target: { id, label } });
    const RIGHT = [
      command(1, "go", "dining_table_978b20c7", "거실·복도 식탁"), command(2, "pick", "cup_3", "컵"),
      command(3, "go", "sink_counter_kitchen", "주방·식당 싱크대"), command(4, "place", "sink_counter_kitchen", "주방·식당 싱크대"),
    ];
    const sunk = world(9000, null, [cup("cup_3", "in_sink", { surface: "sink_counter_kitchen", surface_label: "싱크대", surface_part: "basin" })]);
    /** 그 계획의 사람 단계(기록의 계획 단계, 명령 단계 id와 같다). */
    const PLAN_STEPS = [["move", "식탁으로 가기"], ["act", "컵 집기"], ["move", "싱크대로 가기"], ["act", "컵 내려놓기"]].map(([kind, label], i) => ({ id: `plan:pam-3:${i + 1}`, kind: kind!, label: label! }));
    it("각 --step의 자리(go:table 식탁, pick:cup 컵, go:sink·place:sink 싱크대)와 실제로 나간 명령의 대상이 맞고 치운 컵이 싱크대 안이면 통과다", () => {
      expect(stepPlaces(STEPS, RIGHT, sunk, { cupClear: true })).toEqual({ ok: true, text: "단계 자리: 4/4 맞음 · 치운 컵 싱크대 안", problems: [] });
    });
    it("명령 대상이 그 단계 자리가 아니면 「단계 자리 틀림: 세탁기 ≠ 식탁」으로 실패다(단계 영상이 차례로 돌아도)", () => {
      const wrong = [command(1, "go", "washer_balcony", "세탁기"), ...RIGHT.slice(1)];
      const r = stepPlaces(STEPS, wrong, sunk, { cupClear: true });
      expect(r.ok).toBe(false);
      expect(r.problems).toEqual(["단계 자리 틀림: 세탁기 ≠ 식탁"]);
      expect(r.text).toBe("단계 자리: 3/4 맞음 · 단계 자리 틀림: 세탁기 ≠ 식탁 · 치운 컵 싱크대 안");
    });
    it("그 단계의 명령이 없거나 치운 컵이 싱크대 안이 아니면 실패다. 계획 밖 명령(충전 자리·끄기 안내·질문)은 세지 않는다", () => {
      const extra = [...RIGHT.slice(0, 3), { video_ms: 9000, id: "dock:1", step: "dock:1:1", text: "충전 자리로 가 주세요", kind: "go", target: { id: "dock", label: "충전 자리" } }];
      const onTable = world(9000, null, [cup("cup_3", "on_table")]);
      const r = stepPlaces(STEPS, extra, onTable, { cupClear: true, planSteps: PLAN_STEPS });
      expect(r.ok).toBe(false);
      expect(r.problems).toEqual(["단계 명령 없음: 컵 내려놓기", "치운 컵이 싱크대 안이 아님: 식탁 위"]);
      expect(stepPlaces(STEPS, RIGHT, null, { cupClear: true }).problems).toEqual(["치운 컵이 싱크대 안이 아님: 컵 모름"]);
    });

    // 2026-11-18 wide-tall q3(Redis 4c1d66e) 거짓 실패: 명령 넷이 모두 맞고 cup_3이 cup_1로 이어져 싱크대 안인데, 찾기용 단계 영상 go:cup이 「싱크대로 가 주세요」를
    // 먹어 「단계 자리 2/5 · 주방·식당 싱크대 ≠ 컵 · pick:cup 명령 없음」으로 실패했다. 계획 단계와 명령을 차례로 맞추고, 계획에 없는 --step은 선택이다
    it("wide-tall q3: 계획 단계 넷과 명령이 차례로 맞으면 통과다. 찾기에만 쓰는 --step(go:cup)은 선택이라 세지 않는다", () => {
      const steps = ["go:table:wide-tall-go-table.mp4", "go:cup:wide-tall-go-cup.mp4", "pick:cup:wide-tall-pick-cup.mp4", "go:sink:wide-tall-go-sink.mp4", "place:sink:wide-tall-place-sink.mp4"];
      const P = "plan:pam-9";
      const planSteps = PLAN_STEPS.map((x, i) => ({ ...x, id: `${P}:${i + 1}` }));
      const commands: VideoCommand[] = [
        { video_ms: 29_400, id: P, step: `${P}:1`, text: "식탁으로 가 주세요", kind: "go", target: { id: "dining_table_978b20c7", label: "거실·복도 식탁" } },
        { video_ms: 29_700, id: P, step: `${P}:2`, text: "컵을 들어 주세요", kind: "pick", target: { id: "cup_1", label: "컵" } },
        { video_ms: 54_500, id: P, step: `${P}:3`, text: "싱크대로 가 주세요", kind: "go", target: { id: "sink_counter_kitchen", label: "주방·식당 싱크대" } },
        { video_ms: 64_800, id: P, step: `${P}:4`, text: "컵을 싱크대에 넣어 주세요", kind: "place", target: { id: "sink_counter_kitchen", label: "주방·식당 싱크대" } },
      ];
      const end = world(79_200, null, [
        cup("cup_3", "in_sink", { status: "gone", surface: "sink_counter_kitchen", surface_part: "basin", followed_by: "cup_1" }),
        cup("cup_1", "in_sink", { surface: "sink_counter_kitchen", surface_label: "싱크대", surface_part: "basin" }),
      ]);
      expect(stepPlaces(steps, commands, end, { plan: P, cupClear: true, planSteps })).toEqual({ ok: true, text: "단계 자리: 4/4 맞음 · 치운 컵 싱크대 안", problems: [] });
      // 계획의 첫 명령이 다른 곳(세탁기)이면 여전히 틀림이다(tall q1)
      const wrong = [{ ...commands[0]!, target: { id: "washer_balcony", label: "세탁기" } }, ...commands.slice(1)];
      expect(stepPlaces(steps, wrong, end, { plan: P, cupClear: true, planSteps }).problems).toEqual(["단계 자리 틀림: 세탁기 ≠ 식탁"]);
    });

    // 2026-11-18 wide-mug g1 거짓 실패: 내용물 보기(「컵 가까이 가 주세요」)·실행 전 찾기(계획 줄의 「식탁으로 가 주세요」·「식탁 위를 비춰 주세요」)가 끼고
    // 같은 단계 명령(식탁으로 가 주세요)이 두 번 나가 「단계 자리 2/3 · 거실·복도 식탁 ≠ 싱크대」였다. 마지막 컵 치우기 계획의 단계마다 마지막 명령으로 맞추고 계획 밖 명령은 뺀다
    it("wide-mug g1: 계획 밖 명령(내용물 보기 peek:, 계획 줄의 찾기 :find:, 충전 자리)은 빼고 단계마다 마지막 명령으로 맞춘다", () => {
      const steps = ["go:table:wide-mug-go-table.mp4", "pick:cup:wide-mug-pick-cup.mp4", "go:sink:wide-mug-go-sink.mp4", "place:sink:wide-mug-place-sink.mp4"];
      const P = "plan:pam-7";
      const TABLE = { id: "dining_table_978b20c7", label: "거실·복도 식탁" };
      const SINK = { id: "sink_counter_kitchen", label: "주방·식당 싱크대" };
      const commands: VideoCommand[] = [
        { video_ms: 14_400, id: "peek:1", step: "peek:1:go:1", text: "컵 가까이 가 주세요", kind: "go", target: { id: "cup_1", label: "컵" } },
        { video_ms: 28_500, id: P, step: `${P}:find:${TABLE.id}:go:1`, text: "식탁으로 가 주세요", kind: "go", target: TABLE },
        { video_ms: 31_100, id: P, step: `${P}:find:${TABLE.id}:aim:2`, text: "식탁 위를 비춰 주세요", kind: "do", target: TABLE },
        { video_ms: 34_300, id: P, step: `${P}:1`, text: "식탁으로 가 주세요", kind: "go", target: TABLE },
        { video_ms: 34_500, id: P, step: `${P}:2`, text: "컵을 들어 주세요", kind: "pick", target: { id: "cup_1", label: "컵" } },
        { video_ms: 55_400, id: P, step: `${P}:3`, text: "싱크대로 가 주세요", kind: "go", target: SINK },
        { video_ms: 65_600, id: P, step: `${P}:4`, text: "컵을 싱크대에 넣어 주세요", kind: "place", target: SINK },
        { video_ms: 102_900, id: "dock:1", step: "dock:1:1", text: "충전 자리로 가 주세요", kind: "go", target: { id: "dock", label: "충전 자리" } },
      ];
      const planRow = (id: number, text: string, status: string): HistoryRow => ({
        id, at_ms: id * 1000, day: "2026-11-18", kind: "plan", subject: P, text,
        data: { status, steps: ["식탁으로 가기", "컵 집기", "싱크대로 가기", "컵 내려놓기"].map((label, i) => ({ id: `${P}:${i + 1}`, label, status: status === "done" ? "done" : "pending" })) },
      });
      const history = [planRow(1, "컵 치우기 계획됨", "planned"), planRow(2, "컵 치우기 끝남", "done")];
      const end = world(102_200, null, [cup("cup_1", "in_sink", { surface: "sink_counter_kitchen", surface_label: "싱크대", surface_part: "basin" })]);
      expect(mainPlan(commands, history)).toBe(P);
      expect(stepPlaces(steps, commands, end, { plan: mainPlan(commands, history), cupClear: true })).toEqual({ ok: true, text: "단계 자리: 4/4 맞음 · 치운 컵 싱크대 안", problems: [] });
    });

    it("컵 치우기 계획이 여럿이면 마지막으로 실행된 것을 본다", () => {
      const cmd = (plan: string, n: number): VideoCommand => ({ video_ms: n, id: plan, step: `${plan}:1`, text: "식탁으로 가 주세요" });
      const row = (subject: string): HistoryRow => ({ id: 1, at_ms: 1, day: "2026-11-18", kind: "plan", subject, text: "컵 치우기 계획됨", data: { status: "planned", steps: [] } });
      expect(mainPlan([cmd("plan:pam-2", 1), cmd("plan:pam-5", 2)], [row("plan:pam-2"), row("plan:pam-5")])).toBe("plan:pam-5");
    });

    // 2026-11-18 wide-glass c1·wide-tall m1 거짓 통과: 컵 치우기 계획이 명령 없이 실패하거나(c1) 계획만 되고 명령이 없었는데(m1) 「판정 통과 · 단계 자리: 0/0 맞음」이었다
    it("wide-glass c1·wide-tall m1: --step 판에서 단계 명령이 하나도 없거나 판정 기준 계획이 끝남이 아니면(실패·취소·안 끝남·없음) 실패다", () => {
      const steps = ["go:table:a.mp4", "pick:cup:b.mp4", "go:sink:c.mp4", "place:sink:d.mp4"];
      const end = world(35_500, null, [cup("bottle_1", "on_table", { cls: "bottle" })]);
      // c1: 「대상 물건이 보이지 않아 실행하지 않아요 · 컵 치우기 실패」, 명령 0개
      const c1 = stepPlaces(steps, [], end, { plan: "plan:pam-4", cupClear: true, planStatus: "failed" });
      expect(c1.ok).toBe(false);
      expect(c1.text).toBe("계획 실패 · 단계 자리: 0/0 맞음 · 단계 명령 없음 · 치운 컵이 싱크대 안이 아님: 컵 모름");
      // m1: 「컵 치우기 계획됨」뒤 명령 없이 영상이 끝남
      const m1 = stepPlaces(steps, [], end, { plan: "plan:pam-6", cupClear: true, planStatus: "planned" });
      expect(m1.problems.slice(0, 2)).toEqual(["계획 안 끝남", "단계 명령 없음"]);
      // 계획이 아예 없음
      expect(stepPlaces(steps, [], end, { plan: null, planStatus: null }).problems).toEqual(["계획 없음", "단계 명령 없음"]);
      // 취소
      expect(stepPlaces(steps, RIGHT, sunk, { cupClear: true, planStatus: "cancelled" }).problems).toEqual(["계획 취소"]);
      expect(stepPlaces(steps, RIGHT, sunk, { cupClear: true, planStatus: "done" }).ok).toBe(true);
    });

    // Codex(2705c21 video-check.ts:335): 모든 --step 판에 컵이 싱크대에 있기를 요구해 정상으로 끝난 전자레인지·라면 시연도 실패했다
    it("컵이 싱크대 안인지는 컵 치우기 판에만 본다: 라면 시연은 단계 자리만 맞으면 통과다", () => {
      const ramen = ["go:cabinet:go-cabinet.mp4", "pick:cabinet:pick-pot.mp4"];
      const commands = [command(1, "go", "kitchen_cabinet_1", "주방수납장"), command(2, "pick", "kitchen_cabinet_1", "주방수납장")];
      expect(stepPlaces(ramen, commands, world(9000, null, []))).toEqual({ ok: true, text: "단계 자리: 2/2 맞음", problems: [] });
    });

    // Codex(2705c21 video-check.ts:333): 집은 컵이 사라지면 상관없는 컵(원래 싱크대에 있던 컵)으로 대신 판정해 통과했다
    it("집은 컵은 옮김 표시(followed_by)만 따라간다: 사라진 컵이 이어진 새 컵이 싱크대 안이면 통과, 이어진 것이 없으면 상관없는 싱크대 컵으로 대신하지 않는다", () => {
      const moved = world(9000, null, [
        cup("cup_3", "on_table", { status: "gone", followed_by: "cup_7" }),
        cup("cup_7", "in_sink", { surface: "sink_counter_kitchen", surface_part: "basin" }),
      ]);
      expect(stepPlaces(STEPS, RIGHT, moved, { cupClear: true }).ok).toBe(true);
      const unrelated = world(9000, null, [
        cup("cup_3", "on_table", { status: "gone" }),
        cup("cup_9", "in_sink", { surface: "sink_counter_kitchen", surface_part: "basin" }),
      ]);
      expect(stepPlaces(STEPS, RIGHT, unrelated, { cupClear: true }).problems).toEqual(["치운 컵이 싱크대 안이 아님: 식탁 위"]);
      const noPick = RIGHT.filter((c) => c.kind !== "pick");
      expect(stepPlaces(STEPS, noPick, unrelated, { cupClear: true, planSteps: PLAN_STEPS }).problems).toEqual(["단계 명령 없음: 컵 집기", "치운 컵이 싱크대 안이 아님: 컵 모름"]);
    });
  });

  it("단계 판정 줄: 첫 명령의 계획 단계 중 끝난 수, 누른 단추 수, 마지막 트윈 눈 방과 컵 놓인 곳", () => {
    const steps = (done: number) => ["식탁으로 가기", "컵 집기", "싱크대로 가기", "컵 내려놓기"].map((label, i) => ({ id: `s${i + 1}`, label, status: i < done ? "done" : i === done ? "active" : "pending" }));
    const plan = (id: number, at_ms: number, subject: string, done: number, status = "running"): HistoryRow => ({ id, at_ms, day: "2026-11-11", kind: "plan", subject, text: "컵 치우기", data: { status, steps: steps(done) } });
    const history = [plan(1, 1000, "plan:pam-1", 0), plan(2, 2000, "plan:pam-2", 4, "done"), plan(3, 3000, "plan:pam-1", 3)];
    const commands = [{ video_ms: 34_500, id: "plan:pam-1", step: "s1", text: "식탁으로 가 주세요" }];
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
    it("스스로 시험(--fake)은 영상 끝까지 본다(untilEnd): 계획이 닫혀도 첫 영상이 도는 중이면 watch, 멈추면(끝·붙잡기) done", () => {
      expect(judgeState({ ...base, planStatus: "done", untilEnd: true })).toBe("watch");
      expect(judgeState({ ...base, planStatus: "done", untilEnd: true, stillForMs: 0 })).toBe("done");
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

    // 2026-11-18: 계획이 끝나면 서버가 「충전 자리로 가 주세요」(명령 id dock:<번호>)를 보낸다. 판정은 계획이 끝나면 끝내고, 그 명령에는 단추를 누르지 않는다
    it("계획이 끝난 뒤 오는 충전 자리 명령(dock:)에는 어떤 누르기도 예약하지 않아, 단계 영상이 없어도 계획이 끝나면 판정이 끝난다", () => {
      const dock = cmd(`${dockId(1)}:1`, "충전 자리로 가 주세요", dockId(1));
      expect(isDockStep(dock.step)).toBe(true);
      for (const r of [rule({ doneAfterMs: 3000 }), rule({ approveAfterMs: 2000, doneOn: [{ afterMs: 1000, text: "충전 자리로 가 주세요" }] })]) expect(plannedClicks(dock, r, 0)).toEqual([]);
      const due = plannedClicks(dock, rule({ doneAfterMs: 3000 }), 0).length;
      expect(judgeState({ stillForMs: null, clipPlayedMs: 5_000, clipDurationMs: 60_000, due, planStatus: "done", tailMs: 30_000, totalMs: 60_000, maxMs: 1_800_000, offOpen: false })).toBe("done");
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

// 2026-11-18 사용자: 「렉이 너무 걸린다. 폰 화면은 안 해도 되니까 트윈 화면만 띄우고, 트윈이 온전히 뜨면 영상을 시작해」
describe("녹화는 대시보드 한 화면만, 트윈이 다 뜬 뒤 시작", () => {
  it("--record는 기본으로 대시보드만 녹화하고(--record-phone이면 폰도), --chrome은 그리기 방식(기본 headless-gpu)이다", () => {
    const a = parseArgs(["--clip", "cup-demo.mp4", "--record", "demo-backup"]);
    expect(a).toMatchObject({ record: "demo-backup", recordPhone: false, chrome: "headless-gpu" });
    expect(parseArgs(["--clip", "cup-demo.mp4", "--record", "demo-backup", "--record-phone", "--chrome", "swiftshader"])).toMatchObject({ recordPhone: true, chrome: "swiftshader" });
    expect(parseArgs(["--clip", "cup-demo.mp4", "--chrome", "metal"])).toMatch(/--chrome/);
  });

  it("크롬 그리기 방식: swiftshader는 지금 플래그, headless-gpu는 화면 없이 그래픽 카드(ANGLE D3D11), window는 창", () => {
    expect(chromeFlags("swiftshader")).toEqual(["--headless=new", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]);
    expect(chromeFlags("headless-gpu")).toEqual(expect.arrayContaining(["--headless=new", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"]));
    expect(chromeFlags("headless-gpu")).not.toContain("--enable-unsafe-swiftshader");
    expect(chromeFlags("window")).toEqual([]);
  });

  it("ffmpeg 명령: 폰이 없으면 대시보드 한 화면을 높이 800에 맞춘다(나란히 붙이지 않는다)", () => {
    const args = ffmpegArgs({ dash: "dash.txt", out: "o.mp4", seconds: 2, dashSize: [1280, 800] });
    expect(args.filter((x) => x === "-i")).toHaveLength(1);
    expect(args).toContain("dash.txt");
    expect(args.join(" ")).not.toMatch(/hstack|phone/);
    expect(args[args.indexOf("-filter_complex") + 1]).toBe("[0:v]fps=10,scale=1280:800:force_original_aspect_ratio=decrease:force_divisible_by=2:out_range=tv,pad=1280:800:(ow-iw)/2:(oh-ih)/2,setsar=1[d];[d]format=yuv420p[v]");
  });

  it("대시보드 프레임만 있으면 대시보드 한 화면으로 만든다(폰 프레임이 없다고 실패하지 않는다)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "video-record-"));
    try {
      mkdirSync(join(dir, "dash"));
      writeFileSync(join(dir, "dash", "000001.jpg"), "d");
      const r = await encodeDemo(dir, { endMs: 1000, frames: { dash: [{ file: "dash/000001.jpg", ms: 0 }] }, lost: 0 }, join(dir, "x.demo.mp4"), { dashSize: [1280, 800], ffmpeg: "ffmpeg-not-installed-video-check" });
      expect(r.ok ? "" : r.why).toMatch(/ffmpeg가 없어요/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("트윈이 다 뜰 때(main data-ready, 그 뒤 그림 몇 장)까지 기다리고, 시간 한도를 넘기면 던진다", async () => {
    const answers: unknown[] = [false, false, true, 5];
    let i = 0;
    const tab = { evaluate: async () => answers[Math.min(i++, answers.length - 1)] };
    await waitTwinReady(tab as never, { waitMs: 5_000, everyMs: 1 });
    expect(i).toBe(4);
    const never = { evaluate: async () => false };
    await expect(waitTwinReady(never as never, { waitMs: 50, everyMs: 5 })).rejects.toThrow(/트윈/);
  });

  it("녹화하는 동안 잰 대시보드 그림 간격을 한 줄로 적는다(중앙값·p90·최대·초당 장 수). 자료가 없으면 null", () => {
    expect(frameGapLine([17, 17, 16, 18, 333])).toBe("대시보드 그림 간격: 중앙값 17ms · p90 333ms · 최대 333ms · 초당 12.5장");
    expect(frameGapLine(null)).toBeNull();
    expect(frameGapLine([5])).toBeNull();
  });

  it("녹화 차례: 폰 페이지를 불러온 뒤 대시보드를 열고 트윈이 다 뜬 것을 본 다음 녹화를 시작하고, 그 뒤에 「AR 시작」을 누른다", () => {
    const src = readFileSync(new URL("../scripts/video-check.ts", import.meta.url), "utf8");
    const at = (needle: string) => {
      const k = src.indexOf(needle);
      expect(k, needle).toBeGreaterThan(0);
      return k;
    };
    expect(at("await waitLoaded(cdp, url")).toBeLessThan(at("await waitTwinReady(dash"));
    expect(at("await waitTwinReady(dash")).toBeLessThan(at("rec = await startRecording("));
    expect(at("rec = await startRecording(")).toBeLessThan(at("cdp.evaluate(CLICK_START"));
  });
});
