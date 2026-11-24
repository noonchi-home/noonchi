import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { checkDecision } from "../src/act/index.js";
import { WATER_ACTION } from "../src/act/tasks.js";
import type { DecisionRecord } from "../src/contract/events.js";
import type { SceneObservation } from "../src/contract/observe.js";
import type { TraceMessage, TraceRow } from "../src/contract/trace.js";
import { decisionWorld } from "../src/world/index.js";
import { residentStudio } from "./fixtures/assistance/resident.js";
import { assistanceReplay } from "./helpers/assistance-replay.js";
import { cylinderBox, LOOK_SIZE, LOOK_VIEW, viewLooking } from "./helpers/camera.js";
import { det } from "./helpers/detectors.js";
import { cupSteps, planCalls, plannerRespond } from "./helpers/planner.js";
import { poseOf } from "./helpers/poses.js";
import { openWebSocket } from "./helpers/ws.js";

const HOME = "apartment";
const CUP = "cup_1";
const OTHER = "cup_2";
const TABLE = "table_1";
const DESK = "desk_2";
const CLEAR = "컵 치우기";
const WIDE = viewLooking([8.04, 1.85, 3.55], [8.04, .8, 2.7]);
const BY_CUP = viewLooking([6.75, 1.85, 3.55], [7.9, .8, 2.7]);
type Replay = Awaited<ReturnType<typeof assistanceReplay>>;

async function photo(replay: Replay, id: string, mode: "table" | "hidden" | "ambiguous" | "held" = "table") {
  const captured = replay.clock.now() + 2000;
  const view = mode === "held" ? BY_CUP : WIDE;
  const isHeld = mode === "held" || mode === "ambiguous";
  const person = det("person", .99, cylinderBox(view, [7.68, 0, 2.42], .14, 1.65));
  const cup = (id: string, center: [number, number, number]) => {
    const [x, y, w, h] = cylinderBox(view, center, .05, .13);
    return { id, cls: "cup", det: null, box: { x: x / LOOK_SIZE.width, y: y / LOOK_SIZE.height,
      w: w / LOOK_SIZE.width, h: h / LOOK_SIZE.height } };
  };
  const scene: SceneObservation = {
    scene: "dining", summary: "",
    household: { seats: mode === "hidden" ? "obscured" : "clear", dining_food: "unknown", people: [{ id: "d1", attention: "elsewhere" }] },
    objects: [cup("v1", isHeld ? [7.67, 1.1, 2.58] : [7.65, .75, 2.7]), cup("v2", [8.43, .75, 2.7])],
    observations: [
      { object_id: "v1", state: mode === "hidden" ? "not_visible" : isHeld ? "in_hand" : "on_table" },
      { object_id: "v1", state: "interior_visible" }, { object_id: "v1", state: "has_contents" },
      { object_id: "v2", state: "on_table" },
    ],
  };
  const arrived = captured + 400;
  await replay.advance(arrived);
  await replay.publish("perception", "/perception/scene", { kind: "frame", frame: {
    id, capturedAtMs: captured, latestAtMs: captured, ...LOOK_SIZE, eye: null, view,
  }, dets: [person] });
  await replay.publish("perception", "/perception/scene", { kind: "scene", frame_id: id, observed_ms: captured, scene,
    look: { view, ...LOOK_SIZE, fresh: true, eye: [view.origin[0], view.origin[2]], person_ids: ["d1"],
      dets: [{ id: "d1", box: person.box }] } });
  return { id, captured, arrived };
}

async function start() {
  const studio = residentStudio();
  mkdirSync(join(studio.studioDir, HOME));
  cpSync(resolve("twin/apartment/scene.json"), join(studio.studioDir, HOME, "scene.json"));
  writeFileSync(join(studio.studioDir, "homes.json"), JSON.stringify({
    default: HOME, homes: [{ id: HOME, name: "Replay apartment", data: "data/apartment", out: HOME, single_resident: "resident" }],
  }));
  const go = (target: string) => ({ kind: "go", act: "가기", target, until: { phone_near: target }, timeout_s: 60 });
  const planner = plannerRespond({
    [CLEAR]: () => [planCalls(cupSteps({ cup: CUP, table: TABLE, sink: "sink_1", basin: false }))],
    [WATER_ACTION]: () => [planCalls([
      go(TABLE), { kind: "do", act: "따르기", item: "물", target: CUP, timeout_s: 60 },
      { kind: "pick", act: "들기", target: CUP, timeout_s: 60 }, go(DESK),
      { kind: "place", act: "놓기", target: DESK, object: CUP, timeout_s: 60 },
    ])],
  });
  return assistanceReplay({ ...studio, home: HOME, askFirst: false, model: {
    respond: body => body.tools?.some((tool: { name: string }) => tool.name === "wait_for_new_photo")
      ? { calls: [{ name: "wait_for_new_photo", args: {} }] } : planner(body),
    reply: () => JSON.stringify({ observation: "장면 관찰", reasoning: "대기", state: "away", from: null, next_index: -1 }),
  } });
}

function worldOf(replay: Replay) {
  return replay.output("/world/state").at(-1)!.body.view;
}

async function decision(replay: Replay, id: string, action: string) {
  await photo(replay, "table-first");
  await photo(replay, "table-second");
  const world = worldOf(replay);
  expect(world.objects.filter(o => o.status === "present").map(o => [o.id, o.surface])).toEqual([[CUP, TABLE], [OTHER, TABLE]]);
  expect(world.person).toMatchObject({ count: 1, visible: true });
  const atMs = replay.clock.now();
  const d: DecisionRecord = { id, seq: 100, atMs, finalTime: new Date(atMs).toISOString(), status: "valid",
    action, prediction: null, memoryVersion: 1, textSent: "", tasks: [action], world: decisionWorld(world) };
  const check = checkDecision({ decision: d, tasks: [action], world });
  expect(check.ok).toBe(true);
  await replay.publish("phone", "/phone/link", { ready: true });
  await replay.publish("brain", "/brain/decision", { decision: d, rev: replay.output("/world/state").at(-1)!.body.rev,
    check, at_ms: atMs, assist: "noonchi" });
  await photo(replay, "after-decision");
  await replay.advance(replay.clock.now() + 250);
  expect(replay.phoneCommands().at(-1), JSON.stringify({
    orders: replay.output("/manager/order").filter(m => m.body.input.decision.id === id).map(m => m.body.gate),
    plans: replay.output("/brain/plan").filter(m => m.body.decision_id === id).map(m => m.body.result),
    actions: replay.output("/act/log").filter(m => m.body.type === "execution").map(m => m.body),
  })).toMatchObject({ type: "command", id: "plan:" + id, target: { id: TABLE } });
}

it("waits for the same cup after occlusion instead of picking the other cup on the table", async () => {
  const replay = await start();
  try {
    await replay.server.historyWriter.rememberCup(HOME, "resident", true);
    await decision(replay, "clear-cup", CLEAR);
    const initial = replay.phoneCommands().length;
    const hidden = await photo(replay, "target-occluded", "hidden");
    expect(worldOf(replay).objects.find(o => o.id === CUP)?.last_seen_ms).toBeLessThan(hidden.captured);
    expect(worldOf(replay).objects.find(o => o.id === OTHER)?.last_seen_ms).toBe(hidden.captured);
    await replay.answer("done");
    await replay.advance(replay.clock.now() + 500);
    expect(replay.phoneCommands().slice(initial).filter(c => c.type === "command")).toEqual([]);
    expect(replay.output("/act/assistance_outcome")).toEqual([]);
    const found = await photo(replay, "same-target-visible");
    await replay.advance(replay.clock.now() + 500);
    expect(worldOf(replay).objects.find(o => o.id === CUP)?.last_seen_ms).toBe(found.captured);
    const next = replay.phoneCommands().slice(initial).filter(c => c.type === "command");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: "plan:clear-cup", target: { id: CUP } });
    expect(replay.network).toEqual([]);
  } finally { await replay.close(); }
}, 20_000);

it("terminates the issued Trace step at actual fall detection and ignores an old phone answer", async () => {
  const replay = await start();
  const rows = new Map<string, TraceRow>();
  const ws = await openWebSocket(replay.server.url.replace(/^http/, "ws") + "/events", { setup: socket => socket.on("message", raw => {
    const msg: TraceMessage = JSON.parse(String(raw));
    if (msg.type === "trace") for (const row of msg.rows) rows.set(row.id, row);
  }) });
  const waitFor = async (predicate: () => boolean) => {
    for (let i = 0; i < 50 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(predicate()).toBe(true);
  };
  try {
    await replay.server.historyWriter.rememberCup(HOME, "resident", true);
    await decision(replay, "clear-before-fall", CLEAR);
    const sent = replay.phoneCommands().at(-1)!;
    if (sent.type !== "command") throw new Error("No active guide to interrupt");
    await waitFor(() => [...rows.values()].some(r => r.refs.step_id === sent.step && r.state === "pending"));
    const command = [...rows.values()].find(r => r.refs.step_id === sent.step && r.state === "pending")!;
    const standing = poseOf({ 5: [220, 100, .9], 6: [260, 100, .9], 11: [225, 200, .9], 12: [255, 200, .9], 13: [225, 280, .9], 14: [255, 280, .9] }, [200, 70, 80, 250]);
    const lying = poseOf({ 5: [140, 250, .9], 6: [140, 280, .9], 11: [240, 255, .9], 12: [240, 285, .9], 13: [320, 258, .9], 14: [320, 288, .9] }, [120, 230, 220, 80]);
    const person = det("person", .9, [40, 60, 400, 290]);
    for (let i = 0; i <= 15; i++) {
      const ms = replay.clock.now() + 300;
      await replay.advance(ms);
      await replay.publish("perception", "/perception/scene", { kind: "frame", frame: {
        id: "fall-" + i, capturedAtMs: ms, latestAtMs: ms, ...LOOK_SIZE, eye: null, view: LOOK_VIEW,
      }, dets: [person], poses: [i < 3 ? standing : lying] });
    }
    await replay.advance(replay.clock.now() + 500);
    expect(worldOf(replay).person.facts.posture?.value).toBe("fall_suspected");
    await waitFor(() => rows.get(command.id)?.state === "cancelled");
    const stopped = rows.get(command.id)!;
    const guard = rows.get(stopped.cause_id!)!;
    expect(guard).toMatchObject({ kind: "GUARDRAIL", activity_id: command.activity_id, output: "안전 조치 우선" });
    expect(rows.get(guard.cause_id!)).toMatchObject({ kind: "GUARDRAIL", output: "쓰러짐 의심" });
    const results = () => [...rows.values()].filter(row => row.activity_id === command.activity_id && row.name === "활동 종료");
    await waitFor(() => results().length > 0);
    const outcome = results()[0]!;
    expect(outcome).toMatchObject({ state: "cancelled", output: "활동 취소", cause_id: stopped.id });
    await replay.publish("phone", "/phone/progress", { req: "old-phone", expires_ms: replay.clock.now() + 2500,
      kind: "button", plan_id: sent.id, step: sent.step, choice: "done" });
    expect(rows.get(command.id)).toEqual(stopped);
    expect(results()).toEqual([outcome]);
    expect(replay.network).toEqual([]);
  } finally {
    ws.close();
    await replay.close();
  }
}, 20_000);

it("clears delivery before pickup when the resident resolves it and records the original confirming frame", async () => {
  const replay = await start();
  try {
    await decision(replay, "deliver-water", WATER_ACTION);
    const old = replay.phoneCommands().at(-1);
    if (old?.type !== "command") throw new Error("Expected the issued navigation step");
    const initial = replay.phoneCommands().length;
    await photo(replay, "ambiguous-cup", "ambiguous");
    expect(worldOf(replay).person.holding).toEqual([]);
    expect(replay.output("/act/assistance_outcome")).toEqual([]);
    await photo(replay, "first-unambiguous-cup", "held");
    expect(replay.output("/act/assistance_outcome")).toEqual([]);
    const proof = await photo(replay, "confirmed-held-cup", "held");
    expect(worldOf(replay).person.holding).toEqual([CUP]);
    expect(worldOf(replay).household_photo).toMatchObject({ id: proof.id, at_ms: proof.captured, answered_ms: proof.arrived,
      proof: { person_count: 1 } });
    await replay.publish("phone", "/phone/progress", { kind: "button", req: "old-arrival", plan_id: old.id, step: old.step,
      choice: "done", expires_ms: replay.clock.now() + 2500 });
    await replay.advance(replay.clock.now() + 250);
    const later = replay.phoneCommands().slice(initial);
    expect(later).toContainEqual({ type: "command_clear", id: old.id });
    expect(later.filter(c => c.type === "command" && (c.id === old.id || c.target !== null))).toEqual([]);
    expect(replay.output("/act/progress_result").at(-1)?.body).toMatchObject({ req: "old-arrival", status: "stale" });
    const outcomes = replay.output("/act/assistance_outcome").map(m => m.body);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ home: HOME, user: "resident", action: WATER_ACTION, execution: "done", reaction: "self_resolved",
      key: { homeEpoch: HOME + "#1", attemptId: "deliver-water", gen: 0 },
      proof: { kind: "self_resolved", user: "resident", evidence: {
        source: "resident_action", subjectId: CUP, observedMs: proof.captured, originId: proof.id,
      } } });
    expect(replay.server.history.list({ kinds: ["assistance_outcome"] }).map(row => row.data)).toEqual(outcomes);
    expect(replay.network).toEqual([]);
  } finally { await replay.close(); }
}, 20_000);

// 요구사항 ④(실행 중 다시 확인): 컵 치우기의 「식탁으로 가 주세요」를 보낸 뒤 사용자가 돌아와 그 컵을 들면 들기 명령으로 넘어가지 않는다
async function returnsAndHolds(replay: Replay) {
  await replay.server.historyWriter.rememberCup(HOME, "resident", true);
  await decision(replay, "clear-back", CLEAR);
  const old = replay.phoneCommands().at(-1);
  if (old?.type !== "command") throw new Error("Expected the issued navigation step");
  const initial = replay.phoneCommands().length;
  await photo(replay, "back-ambiguous", "ambiguous");
  await photo(replay, "back-held-1", "held");
  await photo(replay, "back-held-2", "held");
  expect(worldOf(replay).person.holding).toEqual([CUP]);
  const arrivedMs = replay.clock.now();
  await replay.publish("phone", "/phone/progress", { kind: "button", req: "arrive", plan_id: old.id, step: old.step,
    choice: "done", expires_ms: replay.clock.now() + 2500 });
  for (let i = 0; i < 20 && !replay.output("/act/assistance_outcome").length; i++) await photo(replay, "still-held-" + i, "held");
  const executions = replay.output("/act/log").flatMap(m => m.body.type === "execution" && m.body.plan_id === old.id ? [m.body] : []);
  const stoppedMs = replay.output("/act/assistance_outcome").at(0)?.header.stamp;
  return { old, later: replay.phoneCommands().slice(initial), executions, outcomes: replay.output("/act/assistance_outcome").map(m => m.body.execution),
    /** 도착 버튼(들기 첫 명령 차례) → 실행 결과까지(ms). */
    stopMs: stoppedMs === undefined ? null : stoppedMs - arrivedMs };
}

it("컵 치우기 실행 중(식탁으로 가는 중) 사용자가 돌아와 그 컵을 들면 들기 명령을 보내지 않고 가는 명령을 거둔 뒤 계획을 멈춘다", async () => {
  const replay = await start();
  try {
    const r = await returnsAndHolds(replay);
    expect(r.later).toEqual([{ type: "command_clear", id: r.old.id }]);
    expect(r.outcomes).toEqual(["cancelled"]);
    expect(r.executions.at(-1)).toMatchObject({ state: "failed" });
    expect(replay.network).toEqual([]);
  } finally { await replay.close(); }
}, 60_000);

it("컵 치우기 실행 중 사용자가 그 컵을 든 것이 확인되면 근거 찾기 한도를 기다리지 않고 「쓰는 중」 까닭으로 멈춘다", async () => {
  const replay = await start();
  try {
    const r = await returnsAndHolds(replay);
    expect(r.later).toEqual([{ type: "command_clear", id: r.old.id }]);
    expect(r.outcomes).toEqual(["cancelled"]);
    expect(r.executions.at(-1)).toMatchObject({ state: "failed", text: "사람이 그 물건을 쓰는 중이라 멈췄어요." });
    // 도착(들기 차례) 때 손에 있음은 한 번 본 상태(inferred)라 근거 찾기로 간다. 다음 사진(2.4초 뒤)에서 confirmed가 되면
    // 그때 멈춘다: 근거 찾기 한도를 다 쓰지 않는다(고치기 전 이 재생에서 5.1초)
    expect(r.stopMs).not.toBeNull();
    expect(r.stopMs!).toBeLessThan(3000);
    expect(replay.network).toEqual([]);
  } finally { await replay.close(); }
}, 60_000);

// 요구사항 ①(단서가 없으면 돕지 않음): 사용자가 식탁에 있기만 하고(마시지 않음) PAM이 행동 없는 답을 내면 계획·폰 명령이 없다
it("사용자가 식탁에 있기만 하고 PAM이 행동 없이 답하면 계획 모델을 부르지 않고 폰 명령도 내지 않는다", async () => {
  const replay = await start();
  try {
    await replay.publish("phone", "/phone/link", { ready: true });
    // 판단 주기는 엔진 프레임이 오는 동안만 돈다(src/brain/decide.ts onFrame): 사진마다 프레임 도착을 함께 낸다
    for (let i = 0; i < 6; i++) {
      await photo(replay, "quiet-" + i);
      await replay.publish("perception", "/perception/frame_seen", { at_ms: replay.clock.now() });
    }
    await replay.advance(replay.clock.now() + 2000);
    const decisions = replay.output("/brain/decision").map(m => m.body.decision);
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.filter(d => d.action)).toEqual([]);
    expect(replay.output("/brain/plan")).toEqual([]);
    expect(replay.phoneCommands().filter(c => c.type === "command")).toEqual([]);
    expect(replay.output("/act/log").filter(m => m.body.type === "execution" && m.body.state !== "decided")).toEqual([]);
  } finally { await replay.close(); }
}, 60_000);
