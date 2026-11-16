import { afterEach, describe, expect, it } from "vitest";
import { TASK_NAMES } from "../src/act/tasks.js";
import { CUP_FSM_MEMORY, CUP_TASKS } from "../src/brain/decision.js";
import { PamClient } from "../src/brain/pam.js";
import type { BrainLog, DecisionRecord } from "../src/contract/events.js";
import { Decider } from "../src/brain/decide.js";
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

  describe("들은 말", () => {
    const SAID = "라면 끓이는 법 알려 줘";
    const setup = async (over: { keepHeard?: boolean; predict?: Parameters<typeof startFakePam>[0] } = {}) => {
      pam = await startFakePam(over.predict ?? {});
      const logs: BrainLog[] = [];
      const records: DecisionRecord[] = [];
      const clock = { t: Date.parse("2026-11-13T03:00:00Z"), now() { return this.t; } };
      const world = emptyWorld();
      const d = new Decider({ pam: new PamClient({ url: pam.url }), world, trigger: event(), tasks: () => [...CUP_TASKS], memory,
        emit: (l) => logs.push(l), onDecision: (r) => records.push(r), offsetMinutes: 540, clock, ...(over.keepHeard ? { keepHeard: () => true } : {}) });
      const sent = () => (pam!.bodies.at(-1) as { observation_text: string }).observation_text;
      const decisions = () => logs.flatMap((l) => (l.type === "decision" ? [l] : []));
      return { d, world, clock, logs, records, sent, decisions };
    };

    it("event 계기 모드에서 들은 말이 판단을 부르고, 60초 안의 관찰 텍스트에 「HH:MM:SS 사람이 말함: 「…」」 줄이 있다. 60초 뒤에는 없다", async () => {
      const s = await setup();
      s.d.tick();
      expect(pam!.bodies).toEqual([]);
      s.d.onChanges(s.world.heard(SAID, s.clock.t));
      s.d.tick();
      await s.d.idle();
      expect(pam!.bodies).toHaveLength(1);
      expect(s.sent().split("\n")).toContain("12:00:00 사람이 말함: 「라면 끓이는 법 알려 줘」");
      // PAM 본문은 글뿐이다(사진 칸 없음, 칸 여섯)
      expect(Object.keys(pam!.bodies[0]!).sort()).toEqual(["contract", "final_time", "memory", "memory_kind", "observation_text", "tasks"]);
      expect(JSON.stringify(pam!.bodies[0])).not.toMatch(/data:image|base64|"frames"|"image"/);
      s.clock.t += 59_000;
      s.d.onChanges([{ kind: "appeared", at_ms: s.clock.t, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }]);
      s.d.tick();
      await s.d.idle();
      expect(s.sent()).toContain("사람이 말함: 「라면 끓이는 법 알려 줘」");
      s.clock.t += 2_000;
      s.d.onChanges([{ kind: "gone", at_ms: s.clock.t, subject: "cup_1", text: "컵 cup_1 사라짐", meaningful: true }]);
      s.d.tick();
      await s.d.idle();
      expect(pam!.bodies).toHaveLength(3);
      expect(s.sent()).not.toContain("사람이 말함");
    });

    it("들은 말은 그 순간 판단(PAM 요청·실행 추적에 넘기는 판단)에만 쓰고, 기록에 남는 판단 줄에는 내용 없이 「들은 말 있음」만 둔다. PAM이 그 말을 그대로 옮긴 생각 글에서도 뺀다", async () => {
      const s = await setup({ predict: { predict: () => ({ observation: `사용자가 「${SAID}」라고 말함`, reasoning: `${SAID} 라고 해서 알려 준다`, task_index: 0 }) } });
      s.d.onChanges(s.world.heard(SAID, s.clock.t));
      s.d.tick();
      await s.d.idle();
      expect(s.sent()).toContain(SAID);
      expect(s.records[0]!.textSent).toContain(SAID);
      const log = s.decisions()[0]!;
      expect(log.text_sent.split("\n")).toContain("12:00:00 들은 말 있음");
      expect(JSON.stringify(s.logs)).not.toContain("라면");
      expect(log.prediction).toEqual({ observation: "사용자가 「들은 말」라고 말함", reasoning: "들은 말 라고 해서 알려 준다", task_index: 0 });
      // 계획 화면·기록에 가는 판단 이유(계획 judgment)도 뺀 글이다
      expect(JSON.stringify(s.records[0]!.prediction)).not.toContain("라면");
    });

    it("행동을 고른 판단이 쓴 들은 말은 다음 판단의 관찰 텍스트에 다시 넣지 않는다(「그만」 뒤 같은 말로 그 일을 다시 시작하지 않게). 대기 판단이면 60초 동안 남는다", async () => {
      let index = -1;
      const s = await setup({ predict: { predict: () => ({ observation: "o", reasoning: "r", task_index: index }) } });
      s.d.onChanges(s.world.heard(SAID, s.clock.t));
      s.d.tick();
      await s.d.idle();
      expect(s.sent()).toContain(SAID);
      // 대기였으니 다음 판단에도 남아 있다
      index = 0;
      s.clock.t += 5_000;
      s.d.onChanges([{ kind: "appeared", at_ms: s.clock.t, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }]);
      s.d.tick();
      await s.d.idle();
      expect(s.sent()).toContain(SAID);
      expect(s.records.at(-1)!.action).toBe("컵 치우기");
      // 행동을 골랐으니 그 말은 썼다: 그 뒤에 들은 말만 남는다
      s.clock.t += 5_000;
      s.d.onChanges(s.world.heard("고마워", s.clock.t));
      s.d.tick();
      await s.d.idle();
      expect(pam!.bodies).toHaveLength(3);
      expect(s.sent()).not.toContain(SAID);
      expect(s.sent()).toContain("사람이 말함: 「고마워」");
    });

    it("들은 말 남기기 설정을 켜면(기본 꺼짐) 기록에 남는 판단 줄에도 그 말이 그대로 있다", async () => {
      const s = await setup({ keepHeard: true });
      s.d.onChanges(s.world.heard(SAID, s.clock.t));
      s.d.tick();
      await s.d.idle();
      expect(s.decisions()[0]!.text_sent).toContain("사람이 말함: 「라면 끓이는 법 알려 줘」");
    });
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
    const fsm = { state: "left_cup", trigger: CUP_FSM_MEMORY.states.find((x) => x.id === "left_cup")!.rules[0]!.trigger, learned: false };
    expect(logs.filter((l) => l.type === "decision").map((l) => l.type === "decision" && [l.action, l.fsm])).toEqual([["컵 치우기", fsm], [null, null]]);
    expect(records.map((r) => r.fsm)).toEqual([fsm, null]);
  });

  it("판단 사건에 고른 행동의 종류를 붙인다: 라면 끓이기 알려 주기는 coach, 에어컨 켜기는 noonchi, 대기·실패는 null", async () => {
    const tasks = [...TASK_NAMES];
    let index = tasks.indexOf("라면 끓이기 알려 주기");
    pam = await startFakePam({ predict: () => ({ observation: "o", reasoning: "r", task_index: index }) });
    const logs: BrainLog[] = [];
    let now = 10_000;
    const d = new Decider({ pam: new PamClient({ url: pam.url }), world: emptyWorld(), trigger: event(),
      tasks: () => tasks, memory, emit: (l) => logs.push(l), offsetMinutes: 540, clock: { now: () => now } });
    const poke = async () => { d.onChanges([{ kind: "appeared", at_ms: now, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }]); d.tick(); await d.idle(); now += 1000; };
    await poke();
    index = tasks.indexOf("에어컨 켜기");
    await poke();
    index = -1;
    await poke();
    expect(logs.filter((l) => l.type === "decision").map((l) => l.type === "decision" && [l.action, l.assist])).toEqual([
      ["라면 끓이기 알려 주기", "coach"], ["에어컨 켜기", "noonchi"], [null, null],
    ]);
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
