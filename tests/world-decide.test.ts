import { afterEach, describe, expect, it } from "vitest";
import { TASK_NAMES } from "../src/act/tasks.js";
import { CUP_FSM_MEMORY, CUP_TASKS, type FsmMemory } from "../src/brain/decision.js";
import type { Prediction } from "../src/contract/pam.js";
import { LEARNED_FSM_MEMORY } from "../scripts/learned-memory.js";
import { PamClient } from "../src/brain/pam/index.js";
import type { BrainLog, DecisionRecord } from "../src/contract/events.js";
import { Decider } from "../src/brain/decide.js";
import { WorldState } from "../src/world/state/world.js";
import { Trigger } from "../src/world/trigger.js";
import { startFakePamLlm, type FakePamLlm, pamClientFor } from "./helpers/pam.js";

let pam: FakePamLlm | undefined;
afterEach(async () => { await pam?.close(); pam = undefined; });
const emptyWorld = () => new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
/** 배운 뒤 기억(치우기를 보는 판단). 배우기 전(seed)은 「배우기 전(seed) 기억이면…」 시험 하나가 본다. */
const memory = () => ({ memory: LEARNED_FSM_MEMORY, kind: "fsm" as const, version: 0 });
const event = () => new Trigger({ mode: "event", minGapMs: 0, periodMs: 1000, idleStopMs: 1e9, liveMs: 10_000, maxInflight: 1 }, 0);

describe("판단 호출", () => {
  it("의미 있는 변화에 PAM을 부르고, 보낸 관찰 텍스트·World State 요약·결과를 기록한다", async () => {
    pam = await startFakePamLlm();
    const records: DecisionRecord[] = [];
    const logs: BrainLog[] = [];
    const now = 10_000;
    const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: event(),
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
    expect(sent).toMatchObject({ final_time: "1970-01-01T09:00:10+09:00", memory_kind: "fsm", tasks: [...CUP_TASKS] });
    expect(records[0]!.textSent).toBe(sent.observation_text);
    expect(logs.filter((l) => l.type === "decision")).toEqual([expect.objectContaining({ id: "pam-1", seq: 1, text_sent: sent.observation_text, status: "valid" })]);
    d.tick();
    await d.idle();
    expect(pam.bodies).toHaveLength(1);   // 이미 부른 변화로 다시 부르지 않는다
  });

  it("fsmState는 마지막 유효 판단의 사람 상태(PAM 답 state)다(처음에는 null). 미리 세울 목표가 읽는다", async () => {
    pam = await startFakePamLlm({ predict: (v) => ({ observation: "o", reasoning: "r", task_index: v.tasks.indexOf("컵 치우기") }) });
    const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory, emit: () => {}, offsetMinutes: 540 });
    expect(d.fsmState()).toBeNull();
    d.onChanges([{ kind: "person_gone", at_ms: 0, subject: "person", text: "사람 안 보임", meaningful: true }]);
    d.tick();
    await d.idle();
    expect(d.fsmState()).toBe("away");
    d.stop();
  });

  it("habit은 판단이 마지막으로 PAM에 보낸 기억과 그 상태다: 판단 전에는 null이고 기억을 새로 읽지 않는다(그날 판본을 고정하지 않는다, demo-e2e 4 반성 적용 날)", async () => {
    pam = await startFakePamLlm({ predict: (v) => ({ observation: "o", reasoning: "r", task_index: v.tasks.indexOf("컵 치우기") }) });
    let reads = 0;
    const counted = () => { reads++; return memory(); };
    const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory: counted, emit: () => {}, offsetMinutes: 540 });
    expect(d.habit()).toBeNull();
    expect(reads).toBe(0);
    d.onChanges([{ kind: "person_gone", at_ms: 0, subject: "person", text: "사람 안 보임", meaningful: true }]);
    d.tick();
    await d.idle();
    expect(reads).toBe(1);
    expect(d.habit()).toMatchObject({ memory: LEARNED_FSM_MEMORY, kind: "fsm", version: 0, state: "away" });
    expect(reads).toBe(1);
    d.stop();
  });

  describe("들은 말", () => {
    const SAID = "라면 끓이는 법 알려 줘";
    const setup = async (over: { keepHeard?: boolean; predict?: Parameters<typeof startFakePamLlm>[0] } = {}) => {
      pam = await startFakePamLlm(over.predict ?? {});
      const logs: BrainLog[] = [];
      const records: DecisionRecord[] = [];
      const clock = { t: Date.parse("2026-11-13T03:00:00Z"), now() { return this.t; } };
      const world = emptyWorld();
      const d = new Decider({ pam: pamClientFor(pam), world, trigger: event(), tasks: () => [...CUP_TASKS], memory,
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
      // PAM 요청은 글뿐이다(사진 칸 없음). 실제 LLM 본문에도 사진이 없다
      expect(Object.keys(pam!.bodies[0]!).sort()).toEqual(["final_time", "last_state", "memory", "memory_kind", "observation_text", "role", "tasks"]);
      expect(JSON.stringify(pam!.requests[0])).not.toMatch(/data:image|base64|"image_url"|"type":"image/);
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
      expect(log.prediction).toEqual({ observation: "사용자가 「들은 말」라고 말함", reasoning: "들은 말 라고 해서 알려 준다", task_index: 0, state: "away", from: "drinking", next_index: 0 });
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

  it("PAM 답의 상태·화살표를 판단 기록 fsm에 그대로 싣고, 다음 요청에 직전 상태를 보낸다(거꾸로 찾지 않는다)", async () => {
    const answers = [
      { observation: "o", reasoning: "r", state: "away", from: "drinking", next_index: 0 },
      { observation: "o", reasoning: "r", state: "away", from: null, next_index: -1 },
    ];
    pam = await startFakePamLlm({ predict: () => answers.shift()! });
    const records: DecisionRecord[] = [];
    const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory, emit: () => {}, onDecision: (r) => records.push(r), offsetMinutes: 540, clock: { now: () => 10_000 } });
    for (let i = 0; i < 2; i++) {
      d.onChanges([{ kind: "person_gone", at_ms: 9000 + i, subject: "person", text: "사람 안 보임", meaningful: true }]);
      d.tick();
      await d.idle();
      // 첫 판단의 행동(컵 치우기)이 시작됐다: 기다리던 화살표가 풀려 다음 요청의 직전 상태는 넘어간 상태(away)다(아래 pending 시험과 같은 규칙)
      if (i === 0) d.onExecution("plan:pam-1", "running");
    }
    expect(records.map((r) => [r.action, r.fsm])).toEqual([
      ["컵 치우기", { state: "away", from: "drinking", next_index: 0, to: "*", on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", when: null, action: "컵 치우기", learned: true }],
      [null, { state: "away", from: null, next_index: -1, to: null, on: null, when: null, action: null, learned: false }],
    ]);
    expect((pam.bodies as { last_state: string | null }[]).map((b) => b.last_state)).toEqual([null, "away"]);
    expect(d.fsmState()).toBe("away");
  });

  it("배우기 전(seed) 기억이면 같은 떠남 화살표의 행동은 묻기다", async () => {
    pam = await startFakePamLlm({ predict: () => ({ observation: "o", reasoning: "r", state: "away", from: "drinking", next_index: 0 }) });
    const records: DecisionRecord[] = [];
    const seed = () => ({ memory: CUP_FSM_MEMORY, kind: "fsm" as const, version: 1 });
    const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory: seed, emit: () => {}, onDecision: (r) => records.push(r), offsetMinutes: 540, clock: { now: () => 10_000 } });
    d.onChanges([{ kind: "person_gone", at_ms: 9000, subject: "person", text: "사람 안 보임", meaningful: true }]);
    d.tick();
    await d.idle();
    expect(records[0]).toMatchObject({ action: "사용자에게 물어보기", fsm: { from: "drinking", next_index: 0, action: "사용자에게 물어보기", learned: false } });
  });

  it("행동이 붙은 화살표의 행동이 시작되지 않으면(목표가 맡아 기록만 함) 다음 요청의 직전 상태는 그 출발 상태다. 실행이 시작되거나 15초가 지나면 넘어간 상태다", async () => {
    const leave = { observation: "o", reasoning: "r", state: "away", from: "drinking", next_index: 0 };
    const none = { observation: "o", reasoning: "r", state: "away", from: null, next_index: -1 };
    const answers = [leave, leave, leave, none, leave, leave, none];
    pam = await startFakePamLlm({ predict: () => answers.shift()! });
    let now = 10_000;
    const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory, emit: () => {}, onDecision: () => {}, offsetMinutes: 540, clock: { now: () => now } });
    const call = async () => { d.onChanges([{ kind: "person_gone", at_ms: now, subject: "person", text: "사람 안 보임", meaningful: true }]); d.tick(); await d.idle(); };
    await call();                       // pam-1: drinking → * 컵 치우기, 실행 기록 없음(목표가 맡아 기록만)
    now += 6_000; await call();         // pam-2: 직전 상태 drinking, 같은 화살표를 다시 냄(처음 낸 때는 그대로)
    now += 6_000; await call();         // pam-3: 직전 상태 drinking, 또 같은 화살표
    now += 6_000; await call();         // pam-4: 처음 낸 때부터 18초 → 풀려 직전 상태 away(반복이 한도를 늘리지 않는다)
    await call();                       // pam-5: 다시 drinking → *
    await call();                       // pam-6: 직전 상태 drinking, 같은 화살표 반복
    d.onExecution("plan:pam-5", "running");   // 처음 판단(pam-5)의 실행이 시작돼도 푼다
    await call();                       // pam-7
    expect((pam.bodies as { last_state: string | null }[]).map((b) => b.last_state)).toEqual([null, "drinking", "drinking", "away", "away", "drinking", "away"]);
  });

  it("동시에 나간 판단(PAM_MAX_INFLIGHT=2)의 답이 거꾸로 와도 받은 가장 큰 번호보다 작은 답은 직전 상태·기다리는 화살표를 바꾸지 않는다(Codex 1b07d3e2 P2)", async () => {
    const mem: FsmMemory = { initial_state: "away", states: [
      { id: "away", description: "안 보임", activity: [], next: [{ to: "drinking", on: "돌아와 마신다." }] },
      { id: "drinking", description: "마시는 중", activity: ["drinking"], next: [{ to: "*", on: "떠난다.", action: "컵 치우기" }, { to: "watching_tv", on: "TV를 본다." }] },
      { id: "watching_tv", description: "TV 보는 중", activity: ["watching_tv"], next: [] },
    ] };
    const out: { last: string | null; done: (p: Prediction) => void }[] = [];
    const stub = { predict: (r: { last_state: string | null }) => new Promise<Prediction>((done) => out.push({ last: r.last_state, done })) } as unknown as PamClient;
    const two = new Trigger({ mode: "event", minGapMs: 0, periodMs: 1000, idleStopMs: 1e9, liveMs: 10_000, maxInflight: 2 }, 0);
    let now = 10_000;
    const d = new Decider({ pam: stub, world: emptyWorld(), trigger: two, tasks: () => [...CUP_TASKS], memory: () => ({ memory: mem, kind: "fsm", version: 0 }), emit: () => {}, offsetMinutes: 540, clock: { now: () => now } });
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const send = async () => { now += 100; d.onChanges([{ kind: "person_gone", at_ms: now, subject: "person", text: "사람 안 보임", meaningful: true }]); d.tick(); await flush(); };
    const p = (state: string, from: string | null, next_index: number, task_index = -1): Prediction => ({ observation: "o", reasoning: "r", task_index, state, from, next_index });
    await send();
    out[0]!.done(p("drinking", "away", 0));                 // pam-1: away → drinking
    await d.idle();
    await send(); await send();                             // pam-2, pam-3이 함께 나감
    out[2]!.done(p("watching_tv", "drinking", 1));          // pam-3 답이 먼저: drinking → watching_tv
    await flush();
    out[1]!.done(p("away", "drinking", 0, 0));              // pam-2 답이 늦게: 앞선 관찰의 drinking → * 컵 치우기
    await d.idle();
    expect(d.fsmState()).toBe("watching_tv");
    await send();                                           // pam-4: 직전 상태는 pam-3의 watching_tv(pam-2의 기다리는 화살표 출발 drinking이 아님)
    expect(out.map((o) => o.last)).toEqual([null, "drinking", "drinking", "watching_tv"]);
    d.stop();
  });

  describe("풀린 화살표의 늦은 답은 번호로 버린다", () => {
    const leave = { observation: "o", reasoning: "r", state: "away", from: "drinking", next_index: 0 };
    const none = { observation: "o", reasoning: "r", state: "away", from: null, next_index: -1 };
    async function run(between: (d: Decider, tick: (ms: number) => void) => void) {
      const answers = [leave, leave, none];
      pam = await startFakePamLlm({ predict: () => answers.shift()! });
      let now = 10_000;
      const records: DecisionRecord[] = [];
      const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory, emit: () => {}, onDecision: (r) => records.push(r), offsetMinutes: 540, clock: { now: () => now } });
      const send = () => { d.onChanges([{ kind: "person_gone", at_ms: now, subject: "person", text: "사람 안 보임", meaningful: true }]); d.tick(); };
      send(); await d.idle();                // pam-1: drinking → * 컵 치우기
      send();                                // pam-2를 보냄(답 전)
      between(d, (ms) => { now += ms; });
      await d.idle();                        // pam-2 답(같은 화살표)이 늦게 옴
      send(); await d.idle();                // pam-3
      return { records, lastStates: (pam!.bodies as { last_state: string | null }[]).map((b) => b.last_state) };
    }
    it("같은 밀리초에 보낸 요청과 running이어도 그 답은 버린다(행동 없이 late, 직전 상태는 away)", async () => {
      const r = await run((d) => d.onExecution("plan:pam-1", "running"));
      expect(r.records[1]).toMatchObject({ id: "pam-2", action: null, late: true });
      expect(r.lastStates).toEqual([null, "drinking", "away"]);
    });
    it("계획이 끝나고 15초가 지난 뒤 온 늦은 답도 버린다(같은 일을 다시 시작하지 않는다)", async () => {
      const r = await run((d, tick) => { d.onExecution("plan:pam-1", "running"); d.onExecution("plan:pam-1", "done"); tick(20_000); });
      expect(r.records[1]).toMatchObject({ id: "pam-2", action: null, late: true });
      expect(r.lastStates).toEqual([null, "drinking", "away"]);
    });
  });

  it("판단 사건에 고른 행동의 종류를 붙인다: 라면 끓이기 알려 주기는 coach, 에어컨 켜기는 noonchi, 대기·실패는 null", async () => {
    const tasks = [...TASK_NAMES];
    let index = tasks.indexOf("라면 끓이기 알려 주기");
    pam = await startFakePamLlm({ predict: () => ({ observation: "o", reasoning: "r", task_index: index }) });
    const logs: BrainLog[] = [];
    let now = 10_000;
    const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: event(),
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

  it("멈추면 나가 있는 판단 요청도 끊고 기록하지 않는다", async () => {
    let aborted = false;
    const hang = ((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => { aborted = true; reject(init!.signal!.reason); }))) as typeof fetch;
    const logs: BrainLog[] = [];
    const now = 10_000;
    const d = new Decider({ pam: pamClientFor({ url: "http://pam.invalid/v1" }, { fetchImpl: hang, timeoutMs: 60_000 }), world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory,
      emit: (l) => logs.push(l), offsetMinutes: 540, clock: { now: () => now } });
    d.onChanges([{ kind: "appeared", at_ms: now, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }]);
    d.tick();
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    d.stop();
    await d.idle();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(aborted).toBe(true);
    expect(logs.filter((l) => l.type === "decision")).toEqual([]);
  });

  it("판단 기록에 PAM 사용량(모델·토큰·비용)을 남긴다. 답이 틀려 실패해도 남긴다", async () => {
    const reply = (content: string) => (async () => Response.json({ model: "gpt-5.4-mini", choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 200 } } })) as unknown as typeof fetch;
    const usage = { model: "gpt-5.4-mini", prompt: 1000, completion: 50, cached: 200, cost_usd: (800 * 0.75 + 200 * 0.075 + 50 * 4.5) / 1e6 };
    for (const [content, status] of [['{"observation":"o","reasoning":"r","state":"away","from":null,"next_index":-1}', "valid"], ["```json {}```", "failed"]] as const) {
      const logs: BrainLog[] = [];
      const now = 10_000;
      const d = new Decider({ pam: pamClientFor({ url: "http://pam.invalid/v1" }, { env: { INFERENCE_MODE: "openai" }, fetchImpl: reply(content) }), world: emptyWorld(), trigger: event(),
        tasks: () => [...CUP_TASKS], memory, emit: (l) => logs.push(l), offsetMinutes: 540, clock: { now: () => now } });
      d.onChanges([{ kind: "appeared", at_ms: now, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }]);
      d.tick();
      await d.idle();
      const decision = logs.find((l) => l.type === "decision") as Extract<BrainLog, { type: "decision" }>;
      expect(decision.status, content).toBe(status);
      expect(decision.usage, content).toEqual(usage);
    }
  });

  it("PAM 행동 목록은 tasks(heard)로 받는다: 이번 관찰 텍스트에 사람이 한 말이 있으면 heard가 참이다. 판단 기록 assist는 mode(고른 행동)가 정한다(대기도 지금 모드)", async () => {
    const tasks = [...TASK_NAMES];
    let index = -1;
    pam = await startFakePamLlm({ predict: () => ({ observation: "o", reasoning: "r", task_index: index }) });
    const logs: BrainLog[] = [];
    const asked: boolean[] = [];
    const modes: (string | null)[] = [];
    let now = 10_000;
    const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: event(),
      tasks: (heard) => { asked.push(heard); return tasks; }, mode: (action) => { modes.push(action); return action === "라면 끓이기 알려 주기" ? "coach" : "noonchi"; },
      memory, emit: (l) => logs.push(l), offsetMinutes: 540, clock: { now: () => now } });
    d.onChanges([{ kind: "appeared", at_ms: now, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }]);
    d.tick();
    await d.idle();
    now += 1000;
    index = tasks.indexOf("라면 끓이기 알려 주기");
    d.onChanges([{ kind: "heard", at_ms: now, subject: "person", text: "사람이 말함: 「라면 끓이는 법 알려 줘」", meaningful: true }]);
    d.tick();
    await d.idle();
    expect(asked).toEqual([false, true]);
    expect(modes).toEqual([null, "라면 끓이기 알려 주기"]);
    expect(logs.filter((l) => l.type === "decision").map((l) => l.type === "decision" && [l.action, l.assist])).toEqual([[null, "noonchi"], ["라면 끓이기 알려 주기", "coach"]]);
  });

  it("PAM에 닿지 않다가 닿으면 연결 끊김·연결됨을 한 번씩 기록한다. 닿지 않은 판단은 실패로 남긴다", async () => {
    const logs: BrainLog[] = [];
    const records: DecisionRecord[] = [];
    let url = "http://127.0.0.1:9";
    const client = { predict: (r: Parameters<PamClient["predict"]>[0]) => pamClientFor({ url }).predict(r) } as unknown as PamClient;
    let now = 10_000;
    const d = new Decider({ pam: client, world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory,
      emit: (l) => logs.push(l), onDecision: (r) => records.push(r), offsetMinutes: 540, clock: { now: () => now } });
    const poke = async () => { d.onChanges([{ kind: "appeared", at_ms: now, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }]); d.tick(); await d.idle(); now += 1000; };
    await poke(); await poke();
    pam = await startFakePamLlm();
    url = pam.url;
    await poke();
    expect(logs.filter((l) => l.type === "link").map((l) => l.type === "link" && [l.up, l.text])).toEqual([[false, "PAM 연결 끊김"], [true, "PAM 연결됨"]]);
    expect(records.map((r) => r.status)).toEqual(["failed", "failed", "valid"]);
    expect(records[0]!.error).toMatch(/PAM LLM 연결 실패/);
  }, 20_000);

  it("주기 판단은 엔진 프레임이 와야 부르고, 멈춤(프레임 없음·사람 없음)과 다시 시작은 바뀔 때 한 번씩 기록한다", async () => {
    pam = await startFakePamLlm();
    const logs: BrainLog[] = [];
    let now = 0;
    const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(),
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
    pam = await startFakePamLlm();
    const logs: BrainLog[] = [];
    const d = new Decider({ pam: pamClientFor(pam), world: emptyWorld(), trigger: event(), tasks: () => [...CUP_TASKS], memory,
      emit: (l) => logs.push(l), offsetMinutes: 540, clock: { now: () => 10_000 } });
    d.onChanges([{ kind: "appeared", at_ms: 9000, subject: "cup_1", text: "컵 cup_1 보임", meaningful: true }]);
    d.tick();
    d.stop();
    await d.idle();
    expect(logs.filter((l) => l.type === "decision")).toEqual([]);
  });
});
