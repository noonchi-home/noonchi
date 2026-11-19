// 흐름 시험: 놓기 단계에서 전체 사진은 싱크대 안 컵을 못 봐도, 멈춘 단계(A) → 관찰 모드가 고른 가까이 보기 → 최근 다섯 장에서 컵을 찾고 VLM이 싱크대 안이라 답해
// 「완료」 없이 계획이 끝난다. 진짜 WorldState·ObservationPipeline·ExecutionTracker·Planner·Observer·Looker를 쓰고, 모델은 가짜 OpenAI 서버 하나다
// (계획 모드 대본 CUP_SCRIPTS, 관찰 모드 대본 look_closer sink_1, 가까이 본 사진의 VLM 답 싱크대 안).
import { testTracker } from "./helpers/tracker-ports.js";
import { pipelineOn } from "./helpers/world-port.js";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { Looker } from "../src/act/look.js";
import { lookTargets } from "../src/act/tasks.js";

import { ApprovalStore } from "../src/agent/approval.js";
import { Observer } from "../src/agent/observer.js";
import { Planner } from "../src/agent/planner.js";
import { createProvider } from "../src/agent/providers/index.js";
import type { Detection } from "../src/contract/observe.js";
import type { BrainLog, DecisionRecord } from "../src/contract/events.js";
import type { PlannedCommandMessage } from "../src/contract/phone.js";
import { VlmClient } from "../src/infer/vlm.js";
import { cropJpeg } from "../src/observe/crop.js";
import { ObservationPipeline } from "../src/observe/pipeline.js";
import { sha256 } from "../src/observe/ring.js";
import { PlanHub } from "../src/act/hub.js";
import { decisionWorld } from "../src/brain/decide.js";
import { WorldState } from "../src/world/state/world.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frameJpeg, LOOK_EYE, LOOK_SIZE, LOOK_VIEW } from "./helpers/camera.js";
import { seenDetector, det } from "./helpers/detectors.js";
import { smallFloor } from "./helpers/floor.js";
import { closerVlmReply } from "./helpers/look.js";
import { observerRespond } from "./helpers/observer.js";
import { CUP_SCRIPTS, planContext, plannerRespond } from "./helpers/planner.js";

let fake: FakeServer | undefined;
afterEach(async () => { await fake?.close(); fake = undefined; });

// 싱크대 윗면(높이 0.9)은 LOOK_VIEW 그림 가운데다. 전체 사진의 컵 [60, 300, 40, 20]은 바닥, 잘라 키운 사진의 컵 [220, 160, 40, 20]은 엔진 프레임 [230, 170, 20, 10], 싱크대 위다.
const SINK_SURFACE = { id: "sink_1", label: "싱크대", center: [0.6, 0] as [number, number], top: 0.9, radius: 0.5 };
const PLACES: Record<string, { label: string; position: [number, number, number] }> = {
  sink_1: { label: "싱크대", position: [0.6, 0.9, 0] }, table_1: { label: "식탁", position: [7, 0.75, 3] },
};
const cupFull: Detection = det("cup", 0.8, [60, 300, 40, 20], 41);
const cupCrop: Detection = det("cup", 0.72, [220, 160, 40, 20], 41);
/** 가까이 보기가 싱크대 윗면을 잘라 보는 자리(엔진 프레임 픽셀). */
const CROP = [120, 90, 240, 180] as [number, number, number, number];

async function setup(o: { stalled: boolean }) {
  fake = await startFakeOpenAI({
    reply: closerVlmReply(),
    respond: (b) => plannerRespond(CUP_SCRIPTS)(b) ?? observerRespond(() => [["look_closer", { target: "sink_1", reason: "싱크대 안을 더 보려고" }]])(b),
  });
  const env = { OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1`, OPENAI_MODEL: "gpt-5.4-mini" };
  const clock = { t: 0, now() { return this.t; } };
  const logs: BrainLog[] = [];
  const phone: PlannedCommandMessage[] = [];
  // 사진마다 그 촬영 때의 감지: 컵은 바닥에 있다가(전체 사진) 놓기 단계에서 싱크대 안으로 옮겨진다(잘라 키운 사진만 본다)
  const seen = new Map<string, Detection[]>();
  const dets = { full: [cupFull], crop: [] as Detection[] };
  const world = new WorldState({ surfaces: () => [SINK_SURFACE], floorAt: () => 0, roomAt: () => null, devices: () => [] });
  const plans = new PlanHub(smallFloor(), () => {}, () => "t");
  const approvals = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "look-flow-")), "homes", "h", "approvals.json"), () => "t");
  approvals.answer("task:컵 치우기", "approve");
  const planner = new Planner({ provider: createProvider(env).provider });
  let looker: Looker | null = null;
  const tracker = testTracker({
    plans, world: () => world.view(clock.now()), check: () => ({ ok: true }), floor: () => plans.floor(), approvals, clock,
    planner: (d, signal) => planner.plan(planContext({ decision: d, world: world.view(clock.now()), floor: plans.floor() }), signal),
    toPhone: (m) => phone.push(m), emit: (l) => logs.push(l), locate: (id) => PLACES[id],
    ...(o.stalled ? { stalled: (s) => looker?.stalled(s) ?? false } : {}),
  });
  const pipeline = pipelineOn({
    config: { engineMs: 2000, vlmMaxInflight: 4, vlmTimeoutMs: 5000, detectQueueMax: 8, keepMs: 20_000 },
    detector: seenDetector(seen), vlm: new VlmClient({ baseUrl: `${fake.url}/v1`, model: "m", apiKey: "", extraBody: {} }), world,
    emit: (l) => logs.push(l), broadcastWorld: () => {}, onChanges: () => tracker.onWorld(), clock,
  });
  looker = new Looker({
    observer: new Observer({ provider: createProvider(env).provider }), closer: (spot, signal) => pipeline.closer(spot, signal), frame: () => pipeline.latest(),
    world: () => world.view(clock.now()), emit: (l) => logs.push(l),
    targets: lookTargets, clock,
  });
  let n = 0;
  /** 엔진 프레임 하나(받은 시각 at + 5ms까지 시계를 옮긴다)를 넣고 감지·VLM이 끝날 때까지 기다린다. */
  const frame = async (atMs: number) => {
    const jpeg = frameJpeg(++n, [[0, 0, 8, 8]]);
    seen.set(sha256(jpeg), dets.full);
    seen.set(sha256(cropJpeg(jpeg, CROP, LOOK_SIZE)), dets.crop);
    clock.t = Math.max(clock.t, atMs + 5);
    pipeline.onEngine(jpeg, { kind: "engine", width: 480, height: 360, captured_at: atMs, time_err_ms: 0 }, LOOK_EYE, LOOK_VIEW, atMs + 5);
    await pipeline.idle();
  };
  const exec = () => logs.flatMap((l) => (l.type === "execution" ? [l] : []));
  const looks = () => logs.flatMap((l) => (l.type === "look" ? [l] : []));
  return { clock, logs, phone, dets, world, tracker, pipeline, looker, frame, exec, looks, fake: fake!, close: () => pipeline.close() };
}

/** 컵 치우기 판단(그 시각의 World State 요약). */
const decisionAt = (world: WorldState, atMs: number): DecisionRecord => ({
  id: "pam-1", seq: 1, atMs, textSent: "t", finalTime: "x", status: "valid", prediction: { observation: "o", reasoning: "r", task_index: 0 },
  action: "컵 치우기", memoryVersion: 1, world: decisionWorld(world.view(atMs)),
});

/** 컵이 보인 뒤 계획을 받아 1~3단계를 「완료」로 넘기고, 놓기 단계에서 컵 없는 전체 사진을 2초마다 8초 넣은 뒤 실행 추적 tick.
 *  놓기 단계 사진을 잘라 키우면 cropFrom(촬영 시각) 뒤 장에서만 컵이 보인다. */
async function toPlaceStall(t: Awaited<ReturnType<typeof setup>>, cropFrom = 8000) {
  for (let i = 1; i <= 3; i++) await t.frame(i * 2000);
  expect(t.world.view(t.clock.now()).objects.map((o) => [o.id, o.status])).toEqual([["cup_1", "present"]]);
  t.tracker.onDecision(decisionAt(t.world, t.clock.now()));
  await t.tracker.idle();
  for (let i = 0; i < 3; i++) {
    const cmd = t.tracker.openCommand()!;
    expect(t.tracker.onAnswer(cmd.planId, cmd.stepId, "done")).toBe(true);
  }
  const place = t.tracker.openCommand()!;
  expect(place).toMatchObject({ stepId: "plan:pam-1:4", text: "컵을 싱크대에 넣어 주세요" });
  const stepAt = t.clock.now();
  t.dets.full = [];
  for (let at = 8000; at <= 14000; at += 2000) {
    t.dets.crop = at >= cropFrom ? [cupCrop] : [];
    await t.frame(at);
  }
  expect(t.world.view(t.clock.now()).objects.find((o) => o.id === "cup_1")?.status).toBe("gone");
  expect(t.clock.now() - stepAt).toBeGreaterThanOrEqual(8000);
  t.tracker.tick();
  await t.looker.idle();
  await t.pipeline.idle();
  return place;
}

describe("가까이 보기 흐름(놓기 단계)", () => {
  it("놓기 단계에서 전체 사진은 싱크대 안 컵을 못 봐도, 8초 뒤 관찰 모드가 고른 가까이 보기가 최근 다섯 장에서 컵을 찾고 VLM이 싱크대 안이라 답해 「완료」 없이 계획이 끝난다", async () => {
    const t = await setup({ stalled: true });
    try {
      await toPlaceStall(t);
      expect(t.phone.at(-1)).toEqual({ type: "command_clear", id: "plan:pam-1" });
      expect(t.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "done" });
      const moved = t.world.view(t.clock.now()).objects.find((o) => o.id === "cup_2");
      expect(moved).toMatchObject({ status: "present", surface: "sink_1" });
      expect(moved!.facts.place?.value).toBe("in_sink");
      expect(t.looks()).toEqual([expect.objectContaining({
        trigger: "stalled", tool: "look_closer", target: "sink_1", text: "싱크대 쪽을 가까이 봄 · 컵 보임", plan_id: "plan:pam-1", step_id: "plan:pam-1:4",
        result: expect.objectContaining({ ok: true, frames: 5, found: [expect.objectContaining({ id: "cup_2", cls: "cup", facts: ["in_sink"] })] }),
      })]);
      // 4단계 「완료」는 누르지 않았다: 실제 폰에 보낸 놓기 명령은 처음 한 번뿐이다
      expect(t.phone.filter((m) => m.type === "command" && m.step === "plan:pam-1:4" && m.speak)).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it("가까이 보기 한 번이 다섯 장 중 가장 새 장에서만 컵을 찾아도 VLM이 그 상자에 싱크대 안이라 답하면 그 컵이 생겨 「완료」 없이 계획이 끝난다", async () => {
    const t = await setup({ stalled: true });
    try {
      await toPlaceStall(t, 14_000);
      expect(t.phone.at(-1)).toEqual({ type: "command_clear", id: "plan:pam-1" });
      expect(t.exec().at(-1)).toMatchObject({ plan_id: "plan:pam-1", state: "done" });
      const moved = t.world.view(t.clock.now()).objects.find((o) => o.id === "cup_2");
      expect(moved).toMatchObject({ status: "present", surface: "sink_1", first_seen_ms: 14_000, closer_hold: true });
      expect(moved!.facts.place?.value).toBe("in_sink");
      expect(t.looks()).toEqual([expect.objectContaining({
        trigger: "stalled", tool: "look_closer", target: "sink_1", plan_id: "plan:pam-1", step_id: "plan:pam-1:4",
        result: expect.objectContaining({ ok: true, frames: 5, captured_at_ms: 14_000, found: [expect.objectContaining({ id: "cup_2", cls: "cup", facts: ["in_sink"] })] }),
      })]);
      expect(t.phone.filter((m) => m.type === "command" && m.step === "plan:pam-1:4" && m.speak)).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it("멈춘 단계 알림이 없으면 같은 사진으로 놓기 단계가 끝나지 않는다", async () => {
    const t = await setup({ stalled: false });
    try {
      const place = await toPlaceStall(t);
      expect(t.tracker.openCommand()).toMatchObject({ stepId: place.stepId });
      expect(t.exec().at(-1)).toMatchObject({ state: "running" });
      expect(t.looks()).toEqual([]);
      expect(t.world.view(t.clock.now()).objects.map((o) => o.id)).toEqual(["cup_1"]);
    } finally {
      await t.close();
    }
  });
});
