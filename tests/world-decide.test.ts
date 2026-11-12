import { afterEach, describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY, CUP_TASKS } from "../src/brain/decision.js";
import { PamClient } from "../src/brain/pam.js";
import type { BrainLog } from "../src/contract/events.js";
import { Decider, type DecisionRecord } from "../src/world/decide.js";
import { WorldState } from "../src/world/state.js";
import { Trigger } from "../src/world/trigger.js";
import { startFakePam, type FakePam } from "./helpers/pam.js";

let pam: FakePam | undefined;
afterEach(async () => { await pam?.close(); pam = undefined; });
const emptyWorld = () => new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
const memory = () => ({ memory: CUP_FSM_MEMORY, kind: "fsm" as const, version: 0 });
const event = () => new Trigger({ mode: "event", minGapMs: 0, periodMs: 1000, idleStopMs: 1e9, liveMs: 10_000, maxInflight: 1 }, 0);

describe("판단 호출", () => {
  it("의미 있는 변화에 PAM을 부르고, 보낸 관찰 텍스트·World State 요약·결과를 기록한다", async () => {
    pam = await startFakePam();
    const records: DecisionRecord[] = [];
    const logs: BrainLog[] = [];
    const now = 10_000;
    const d = new Decider({ pam: new PamClient({ url: pam.url }), world: emptyWorld(), trigger: event(),
      tasks: () => [...CUP_TASKS], memory, emit: (l) => logs.push(l), onDecision: (r) => records.push(r), offsetMinutes: 540, clock: { now: () => now } });
    d.tick();
    expect(pam.bodies).toEqual([]);   // 변화가 없으면 부르지 않는다
    d.onChanges([{ kind: "person_gone", at_ms: 9000, subject: "person", text: "사람 안 보임", meaningful: true },
      { kind: "vlm", at_ms: 9100, subject: "e9", text: "VLM: 식탁에 컵 하나", meaningful: false }]);
    d.tick();
    await d.idle();
    expect(records[0]).toMatchObject({ seq: 1, status: "valid", action: null, memoryVersion: 0, world: { person_visible: false, objects: [] } });
    const sent = pam.bodies[0] as { observation_text: string; final_time: string; memory_kind: string; tasks: string[] };
    expect(sent.observation_text).toContain("사람 안 보임");
    expect(sent.observation_text).toContain("VLM: 식탁에 컵 하나");   // 바뀐 VLM 요약도 관찰 텍스트에 든다
    expect(sent).toMatchObject({ final_time: "1970-01-01T09:00:10.000+09:00", memory_kind: "fsm", tasks: [...CUP_TASKS] });
    expect(records[0]!.textSent).toBe(sent.observation_text);
    expect(logs.filter((l) => l.type === "decision")).toEqual([expect.objectContaining({ id: "pam-1", seq: 1, text_sent: sent.observation_text, status: "valid" })]);
    d.tick();
    await d.idle();
    expect(pam.bodies).toHaveLength(1);   // 이미 부른 변화로 다시 부르지 않는다
  });

  it("판단 기록에 고른 행동의 FSM 상태와 트리거를 붙인다. 대기·실패면 null이다", async () => {
    let index = 0;
    pam = await startFakePam({ predict: () => ({ observation: "o", reasoning: "r", task_index: index }) });
    const logs: BrainLog[] = [];
    const records: DecisionRecord[] = [];
    let now = 10_000;
    const d = new Decider({ pam: new PamClient({ url: pam.url }), world: emptyWorld(), trigger: event(),
      tasks: () => [...CUP_TASKS], memory, emit: (l) => logs.push(l), onDecision: (r) => records.push(r), offsetMinutes: 540, clock: { now: () => now } });
    const poke = async () => { d.onChanges([{ kind: "appeared", at_ms: now, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }]); d.tick(); await d.idle(); now += 1000; };
    await poke();
    index = -1;
    await poke();
    const fsm = { state: "left_cup", trigger: CUP_FSM_MEMORY.states[1]!.rules[0]!.trigger };
    expect(logs.filter((l) => l.type === "decision").map((l) => l.type === "decision" && [l.action, l.fsm])).toEqual([["컵 치우기", fsm], [null, null]]);
    expect(records.map((r) => r.fsm)).toEqual([fsm, null]);
  });

  it("PAM에 닿지 않다가 닿으면 연결 끊김·연결됨을 한 번씩 기록한다. 닿지 않은 판단은 실패로 남긴다", async () => {
    const logs: BrainLog[] = [];
    const records: DecisionRecord[] = [];
    let url = "http://127.0.0.1:9";
    const client = { predict: (r: Parameters<PamClient["predict"]>[0]) => new PamClient({ url }).predict(r) } as unknown as PamClient;
    let now = 10_000;
    const d = new Decider({ pam: client, world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory,
      emit: (l) => logs.push(l), onDecision: (r) => records.push(r), offsetMinutes: 540, clock: { now: () => now } });
    const poke = async () => { d.onChanges([{ kind: "appeared", at_ms: now, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }]); d.tick(); await d.idle(); now += 1000; };
    await poke(); await poke();
    pam = await startFakePam();
    url = pam.url;
    await poke();
    expect(logs.filter((l) => l.type === "link").map((l) => l.type === "link" && [l.up, l.text])).toEqual([[false, "PAM 연결 끊김"], [true, "PAM 연결됨"]]);
    expect(records.map((r) => r.status)).toEqual(["failed", "failed", "valid"]);
    expect(records[0]!.error).toMatch(/PAM 연결 실패/);
  }, 20_000);

  it("주기 판단은 엔진 프레임이 와야 부르고, 멈춤(프레임 없음·사람 없음)과 다시 시작은 바뀔 때 한 번씩 기록한다", async () => {
    pam = await startFakePam();
    const logs: BrainLog[] = [];
    let now = 0;
    const d = new Decider({ pam: new PamClient({ url: pam.url }), world: emptyWorld(),
      trigger: new Trigger({ mode: "periodic", minGapMs: 0, periodMs: 1000, idleStopMs: 5000, liveMs: 3000, maxInflight: 1 }, 0),
      tasks: () => [...CUP_TASKS], memory, emit: (l) => logs.push(l), offsetMinutes: 540, clock: { now: () => now } });
    d.tick(); d.tick();
    expect(pam.bodies).toHaveLength(0);   // 폰 프레임이 없으면 부르지 않는다
    now = 1000;
    d.onFrame();
    d.tick();
    await d.idle();
    expect(pam.bodies).toHaveLength(1);
    now = 6000;
    d.onFrame();
    d.tick(); d.tick();
    d.onChanges([{ kind: "appeared", at_ms: 6500, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }]);
    now = 7000;
    d.tick();
    await d.idle();
    expect(logs.filter((l) => l.type === "trigger").map((l) => l.type === "trigger" && [l.paused, l.text])).toEqual([
      [true, "폰 사진이 오지 않아 판단을 멈춤"], [false, "판단을 다시 시작함"], [true, "사람이 없어 판단을 멈춤"], [false, "판단을 다시 시작함"],
    ]);
    expect(pam.bodies).toHaveLength(2);
  });

  it("멈추면 늦게 온 답을 기록하지 않는다", async () => {
    pam = await startFakePam();
    const logs: BrainLog[] = [];
    const d = new Decider({ pam: new PamClient({ url: pam.url }), world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory,
      emit: (l) => logs.push(l), offsetMinutes: 540, clock: { now: () => 10_000 } });
    d.onChanges([{ kind: "appeared", at_ms: 9000, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }]);
    d.tick();
    d.stop();
    await d.idle();
    expect(logs.filter((l) => l.type === "decision")).toEqual([]);
  });
});
