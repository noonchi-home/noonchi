// 낮 판단의 맥락(요일·시각) 걸러내기: PAM은 지금 요일·시각에 맞는 화살표만 맥락 칸 없이 받고, 답 해석과 판단 기록도 그 기억 기준이다(src/brain/decide.ts tick).
import { afterEach, describe, expect, it } from "vitest";
import { CUP_TASKS, type FsmMemory } from "../src/brain/decision.js";
import type { DecisionRecord } from "../src/contract/events.js";
import { Decider } from "../src/brain/decide.js";
import { WorldState } from "../src/world/state/world.js";
import { Trigger } from "../src/world/trigger.js";
import { startFakePamLlm, type FakePamLlm, pamClientFor, type PredictView } from "./helpers/pam.js";

let pam: FakePamLlm | undefined;
afterEach(async () => { await pam?.close(); pam = undefined; });
const emptyWorld = () => new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
const eventAt = (now: number) => new Trigger({ mode: "event", minGapMs: 0, periodMs: 1000, idleStopMs: 1e9, liveMs: 10_000, maxInflight: 1 }, now);

const LEAVE = "사용자가 떠난다.";
/** 자리에 없음에서 떠나면 묻기(맥락 없음), 토요일 18~21시에는 컵 치우기(맥락 있음). 둘 다 자리에 없음 안의 화살표다. */
const MEMORY: FsmMemory = { initial_state: "away", states: [{ id: "away", description: "사용자가 카메라에 보이지 않는다.", activity: [], next: [
  { to: "away", on: LEAVE, action: "사용자에게 물어보기" },
  { to: "away", on: LEAVE, action: "컵 치우기", ctx: { dow: 5, slot: 6 } },
] }] };

async function decideAt(iso: string): Promise<{ record: DecisionRecord; sent: PredictView; stored: FsmMemory }> {
  const now = Date.parse(iso);
  // PAM은 받은 기억의 첫 화살표(next_index 0)를 고른다
  pam = await startFakePamLlm({ predict: () => ({ observation: "o", reasoning: "r", state: "away", from: "away", next_index: 0 }) });
  const records: DecisionRecord[] = [];
  const stored = structuredClone(MEMORY);
  const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: eventAt(now - 5000), tasks: () => [...CUP_TASKS],
    memory: () => ({ memory: stored, kind: "fsm" as const, version: 3 }), emit: () => {}, onDecision: (r) => records.push(r), offsetMinutes: 540, clock: { now: () => now } });
  d.onChanges([{ kind: "person_gone", at_ms: now - 1000, subject: "person", text: "사람 안 보임", meaningful: true }]);
  d.tick();
  await d.idle();
  return { record: records[0]!, sent: pam.bodies[0] as PredictView, stored };
}

describe("낮 판단 맥락 걸러내기", () => {
  it("토요일 19시(18~21시 칸)에는 맥락 있는 화살표만 맥락 칸 없이 PAM에 가고, 그 화살표로 컵 치우기를 고른다", async () => {
    const { record, sent, stored } = await decideAt("2026-11-21T19:00:00+09:00");
    expect((sent.memory as FsmMemory).states[0]!.next).toEqual([{ to: "away", on: LEAVE, action: "컵 치우기" }]);
    expect(record).toMatchObject({ status: "valid", action: "컵 치우기", memoryVersion: 3, fsm: { from: "away", next_index: 0, on: LEAVE, action: "컵 치우기" } });
    expect(stored).toEqual(MEMORY);   // 저장된 기억은 바꾸지 않는다
  });
  it("일요일 19시에는 맥락 화살표가 빠지고 묻기가 간다", async () => {
    const { record, sent } = await decideAt("2026-11-22T19:00:00+09:00");
    expect((sent.memory as FsmMemory).states[0]!.next).toEqual([{ to: "away", on: LEAVE, action: "사용자에게 물어보기" }]);
    expect(record).toMatchObject({ action: "사용자에게 물어보기", fsm: { action: "사용자에게 물어보기" } });
  });
  it("토요일이어도 시각 칸이 다르면(10시) 묻기가 간다", async () => {
    const { record, sent } = await decideAt("2026-11-21T10:00:00+09:00");
    expect((sent.memory as FsmMemory).states[0]!.next.map((e) => e.action)).toEqual(["사용자에게 물어보기"]);
    expect(record.action).toBe("사용자에게 물어보기");
  });
  it("기록 시간대로 센다: 서울 토요일 19시는 UTC 10시이고, 서울 일요일 새벽 1시는 UTC로는 토요일이지만 일요일로 본다", async () => {
    const sun = await decideAt("2026-11-22T01:00:00+09:00");   // UTC 11-21 16:00(토요일)이지만 서울은 일요일 새벽
    expect(sun.record.action).toBe("사용자에게 물어보기");
  });
});
