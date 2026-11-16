// 위험 가전(인덕션·전자레인지)에 대한 폰 글은 기본 거부다(src/agent/policy.ts): 모델이 쓴 글에 위험 가전 이름이 나오거나 그 단계 대상이 위험 가전이면
// 그 글은 폰으로 보내지 않는다. 켜는 말인지 끄는 말인지 낱말로 가르지 않는다. 사람 단계 글은 모델이 고른 동작·대상·물건으로 서버가 만든다(src/act/labels.ts STEP_TEXT).
// 글이 생기는 자리마다 자리 목록(PHONE_LINE_SITES)과 함께 「모델이 쓴 위험 가전 글은 어느 자리에서도 폰으로 안 나간다」를 본다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExecutionTracker } from "../src/act/track/tracker.js";
import { Agent, type LlmProvider, type StepOptions, type StepResult } from "../src/agent/agent.js";
import { ApprovalStore } from "../src/agent/approval.js";
import { Observer, type ObserveSituation } from "../src/agent/observer.js";
import { PlanDraft, type AgentStep } from "../src/agent/planTools.js";
import { PHONE_LINE_SITES, RISKY_REPLY, riskyNames } from "../src/agent/policy.js";
import type { PlannedCommandMessage } from "../src/contract/phone.js";
import type { WorldView } from "../src/contract/world.js";
import { PlanHub } from "../src/act/hub.js";
import { CAUTION_LINE, CAUTION_TEXT, SAY_TEXT, type TellMode } from "../src/act/labels.js";
import { floorPlanFrom } from "../src/layout/route.js";
import type { DecisionRecord } from "../src/contract/events.js";
import { SMALL_SCENE } from "./helpers/floor.js";
import { ROOMS, makeHome } from "./helpers/home.js";
import { startFakeObserver, type FakeObserver } from "./helpers/observer.js";
import { planContext } from "./helpers/planner.js";

describe("다시 걸린 끄기 안내 글", () => {
  it("CAUTION_TEXT.rearmed(폰 소리)·SAY_TEXT.rearmed(말풍선)는 60자 아래이고 화살표·괄호가 없다", () => {
    expect(CAUTION_TEXT.rearmed("인덕션")).toBe("인덕션이 다시 켜졌어요. 꺼 주세요");
    expect(SAY_TEXT.rearmed("전자레인지")).toBe("전자레인지가 다시 켜졌어요.");
    for (const t of [CAUTION_TEXT.rearmed("인덕션"), CAUTION_TEXT.rearmed("전자레인지"), SAY_TEXT.rearmed("인덕션")]) {
      expect(t.length, t).toBeLessThan(60);
      expect(t, t).not.toMatch(/[→←⇒()（）[\]]/);
    }
  });
});

describe("위험 가전 이름(riskyNames)", () => {
  it("이름 표의 종류만 낸다. 켜는 말·끄는 말·상태 말을 가르지 않는다", () => {
    expect(riskyNames("인덕션이 꺼져 있어요. 전원 버튼을 눌러 주세요")).toEqual(["cooktop"]);
    expect(riskyNames("냄비를 인덕션에 올려 주세요")).toEqual(["cooktop"]);
    expect(riskyNames("전자레인지 문을 열어 주세요")).toEqual(["microwave"]);
    expect(riskyNames("전원 버튼을 눌러 주세요")).toEqual([]);
    expect(riskyNames("에어컨을 켜 주세요")).toEqual([]);
  });
});

// 자리마다 모델이 쓴 위험 가전 글을 넣어 폰으로 나가는 글을 본다
const SCENE = { ...structuredClone(SMALL_SCENE), objects: [...structuredClone(SMALL_SCENE.objects), { id: "induction_1", type: "induction_counter", room: "kitchen", plan: { position: [6, 0.5] } }] };
const floor = () => floorPlanFrom(structuredClone(SCENE));
const PERSON: WorldView["person"] = { visible: false, since_ms: 0, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} };
const WORLD: WorldView = { at_ms: 0, objects: [], person: PERSON, fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0 };
const RAMEN = "라면 끓이기 알려 주기";
const ASK_TASK = "사용자에게 물어보기";
const decision: DecisionRecord = {
  id: "pam-1", seq: 1, atMs: 8_000, textSent: "t", finalTime: "x", status: "valid", prediction: { observation: "o", reasoning: "r", task_index: 1 }, action: RAMEN, memoryVersion: 1,
  world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
};
const ctx = (action = RAMEN) => planContext({ decision: { ...decision, action }, world: WORLD, floor: floor(), hub: makeHome().hub });
/** 계획 단계 하나를 검사하고 통과한 단계(실행 추적이 폰에 쓰는 글)를 돌려준다. 버리면 null. */
const planStep = (step: Record<string, unknown>, action = RAMEN): Omit<AgentStep, "id"> | null => {
  const d = new PlanDraft(ctx(action));
  const r = d.add({ step: 1, ...step });
  return r.ok ? (d as unknown as { added: { step: Omit<AgentStep, "id"> }[] }).added[0]!.step : null;
};
const ask = (over: Record<string, unknown> = {}) => ({
  kind: "ask", question: "물을 받았나요?", choices: "yes_no", timeout_s: 120, ...over,
});

/** 실행 추적: 물 받기(sink_1)·냄비 올리기(induction_1) 두 사람 단계 계획. at: 몇 번째 단계에서 볼지. */
function tracker(at = 1) {
  const phone: PlannedCommandMessage[] = [];
  const plans = new PlanHub(floor(), () => {}, () => "t");
  const approvals = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "lines-")), "approvals.json"), () => "t");
  approvals.answer(`task:${RAMEN}`, "approve");
  const t = new ExecutionTracker({
    plans, world: () => WORLD, check: () => ({ ok: true }), floor: () => plans.floor(), approvals, toPhone: (m) => phone.push(m), emit: () => {},
    handDevices: () => [{ id: "induction_1", kind: "cooktop", label: "인덕션" }],
    planner: () => new PlanDraft(ctx()).submit({ steps: [
      { kind: "do", act: "물 받기", item: "냄비", target: "sink_1", timeout_s: 120 },
      { kind: "place", act: "올리기", item: "냄비", target: "induction_1", timeout_s: 120 },
    ] }),
  });
  t.onDecision(decision);
  if (at === 2) t.onAnswer("plan:pam-1", "plan:pam-1:1", "done");
  return { t, phone, step: `plan:pam-1:${at}` };
}
/** 실행 추적 자리: 보냈으면 실제 폰에 뜬 글, 아니면 null. */
const tracked = (send: (t: ExecutionTracker, step: string, text: string) => string | null, at: number) => (text: string) => {
  const { t, phone, step } = tracker(at);
  if (send(t, step, text) === null) return null;
  const last = phone.at(-1);
  return last?.type === "command" ? last.text : null;
};

/** 말 요청 에이전트: 모델이 정한 글(과 도구 호출)을 낸다. */
class LineProvider implements LlmProvider {
  readonly name = "lines";
  constructor(private readonly turns: StepResult[]) {}
  createState() { return { round: 0 }; }
  addUserMessage(): void {}
  async step(state: unknown, _opts: StepOptions): Promise<StepResult> {
    const s = state as { round: number };
    return this.turns[s.round++] ?? { text: "", calls: [] };
  }
  addToolResults(): void {}
}
const agentReply = async (turns: StepResult[], said = "라면 어떻게 끓여") => {
  const home = makeHome();
  return (await new Agent({ hub: home.hub, policy: home.policy, rooms: ROOMS, provider: new LineProvider(turns) }).chat("phone", said, { heard: true })).reply;
};

let obs: FakeObserver;
/** 관찰 모드 모델이 낼 도구 호출(인자 그대로). */
let call: [string, Record<string, unknown>] = ["wait", { reason: "기다리려고" }];
beforeAll(async () => { obs = await startFakeObserver(() => [call]); });
afterAll(async () => { await obs.close(); });
const situation = (tools: ObserveSituation["tools"]): ObserveSituation => ({
  trigger: tools.includes("ask_person") ? "stalled" : "off_track", goal: "물 받기 단계", stuckMs: 9_000,
  spots: [{ id: "sink_1", label: "싱크대", inView: false }], world: WORLD, earlier: [], tools, nowMs: 10_000,
});
const observe = async (c: [string, Record<string, unknown>]) => {
  call = c;
  return new Observer({ provider: obs.provider() }).decide(situation(c[0] === "ask_person" ? ["look_closer", "ask_person", "wait"] : ["tell_person", "wait"]));
};

/** 모델이 쓴 위험 가전 글(이름 있음)과 이름 없이 대상만 위험 가전인 글. 서버 글 틀에는 「전원」·「버튼」이 없다. */
const NAMED = "인덕션이 꺼져 있어요. 전원 버튼을 눌러 주세요";
const BARE = "전원 버튼을 눌러 주세요";
const SAFE = "냄비에 물을 받아 주세요";
const leaked = (out: string | null) => out !== null && /전원|버튼/.test(out);

describe("모델이 쓴 위험 가전 글은 어느 자리에서도 폰으로 안 나간다", () => {
  /** 자리 → 모델 글 하나를 넣었을 때 폰으로 나가는 글(안 나가면 null). onRisky: 대상이 위험 가전인 자리로 넣는다. */
  const SITES: Record<(typeof PHONE_LINE_SITES)[number], (text: string, onRisky: boolean) => Promise<string | null> | string | null> = {
    "ask.question": (text) => planStep(ask({ question: `${text.replace(/ 주세요$/, "")} 볼까요?` }), ASK_TASK)?.prompt?.text ?? null,
    "agent.reply": async (text) => agentReply([{ text, calls: [] }]),
    // 외부 연락 승인 줄: 모델이 쓴 고장 설명이 실제 폰 승인 질문에 그대로 보인다(보낼 내용)
    "service.ask": async (text) => {
      const home = makeHome();
      const call = { id: "c1", name: "call_service", args: { kind: "as_center", problem: text, reason: "AS센터 전화를 부탁해서" } };
      const agent = new Agent({
        hub: home.hub, policy: home.policy, rooms: ROOMS, provider: new LineProvider([{ text: "", calls: [call] }, { text: "", calls: [] }]),
        contacts: { as_center: { name: "AS센터", phone: null } },
      });
      return (await agent.chat("phone", "AS 불러 줘", { heard: true })).pendingConfirmations[0]?.reason ?? null;
    },
  };

  // 대상이 있는 자리는 없다(사람 단계·실행 추적 글은 모두 서버 글이다). 남은 자리는 이름으로만 본다
  const TARGETED = new Set<string>([]);

  it("자리 목록은 이 시험이 보는 자리와 같다", () => {
    expect(Object.keys(SITES).sort()).toEqual([...PHONE_LINE_SITES].sort());
  });

  it.each([...PHONE_LINE_SITES])("%s: 이름이 나오거나 대상이 위험 가전인 모델 글은 나가지 않고(서버 글로 바뀌거나 거름), 그렇지 않은 글은 그대로 나간다", async (site) => {
    const run = SITES[site];
    expect(leaked(await run(NAMED, false)), "이름").toBe(false);
    // 대상이 있는 자리(계획 단계·실행 추적)는 이름 없이 대상만 위험 가전인 글도 나가지 않는다. 대상이 없는 자리(알림·질문·관찰 모드·에이전트 답)는 이름으로만 본다
    if (TARGETED.has(site)) expect(leaked(await run(BARE, true)), "대상").toBe(false);
    const safe = await run(SAFE, false);
    expect(safe, "그 밖").not.toBeNull();
    expect(riskyNames(safe!)).toEqual([]);
  });
});

describe("서버 글 틀", () => {
  it("사람 단계 글은 동작·대상·물건으로 서버가 만든다. 모델이 함께 보낸 이름·명령·안전 문구는 쓰지 않는다", () => {
    const go = planStep({ kind: "go", act: "가기", label: "버튼 누르러 가기", target: "induction_1", command: BARE, timeout_s: 120 });
    expect([go?.label, go?.command]).toEqual(["인덕션으로 가기", "인덕션으로 가 주세요"]);
    const place = planStep({ kind: "place", act: "올리기", item: "냄비", label: "냄비 올리기", target: "induction_1", command: "냄비를 올리고 전원 버튼을 눌러 주세요", timeout_s: 120 });
    expect([place?.label, place?.command]).toEqual(["냄비 올리기", "냄비를 인덕션에 올려 주세요"]);
    const pick = planStep({ kind: "pick", act: "내리기", item: "냄비", target: "induction_1", command: BARE, timeout_s: 120 });
    expect([pick?.label, pick?.command]).toEqual(["냄비 내리기", "냄비를 인덕션에서 내려 주세요"]);
    const on = planStep({ kind: "do", act: "켜기", label: "시작 버튼", target: "induction_1", command: BARE, hand_device: { id: "induction_1", to: "on" }, caution: "인덕션 전원 버튼을 누르세요.", timeout_s: 120 });
    expect([on?.label, on?.command, on?.caution]).toEqual(["인덕션 켜기", "인덕션을 켜 주세요", CAUTION_LINE.cooktop]);
    const off = planStep({ kind: "do", act: "끄기", label: "끄기", target: "induction_1", command: NAMED, hand_device: { id: "induction_1", to: "off" }, timeout_s: 120 });
    expect([off?.label, off?.command, off?.caution]).toEqual(["인덕션 끄기", "인덕션을 꺼 주세요", null]);
    // 평면도에 없는 가전도 [가전] id로 손 조작 동작의 대상이 된다
    const open = planStep({ kind: "do", act: "열기", target: "microwave_1", command: BARE, hand_device: { id: "microwave_1", to: "open" }, timeout_s: 120 });
    expect([open?.label, open?.command]).toEqual(["전자레인지 문 열기", "전자레인지 문을 열어 주세요"]);
    const close = planStep({ kind: "do", act: "닫기", target: "microwave_1", hand_device: { id: "microwave_1", to: "close" }, timeout_s: 120 });
    expect([close?.label, close?.command]).toEqual(["전자레인지 문 닫기", "전자레인지 문을 닫아 주세요"]);
    // 문 상태가 없는 가전의 열기·닫기 끝 조건은 서버가 그 가전 설비(카메라)의 열림·닫힘 사실로 만든다(모델 until은 쓰지 않는다)
    expect([open?.until, close?.until]).toEqual([
      { fixture: "microwave", room: "kitchen_dining", facts: { open: "open" } }, { fixture: "microwave", room: "kitchen_dining", facts: { open: "closed" } },
    ]);
    expect(planStep({ kind: "do", act: "열기", target: "microwave_1", hand_device: { id: "microwave_1", to: "open" }, until: { elapsed_s: 1 }, timeout_s: 120 })?.until)
      .toEqual({ fixture: "microwave", room: "kitchen_dining", facts: { open: "open" } });
    // 가전 위에서 하는 그 밖의 일도 동작 틀로만 나간다
    const put = planStep({ kind: "do", act: "넣기", item: "면과 스프", target: "induction_1", command: NAMED, timeout_s: 120 });
    expect([put?.label, put?.command, put?.hand]).toEqual(["면과 스프 넣기", "면과 스프를 넣어 주세요", null]);
  });

  it("알림·기다리기 이름·질문 답은 서버 글이다: 모델이 함께 보낸 이름·알림 글·답 단추·답 말은 쓰지 않는다", () => {
    const say = planStep({ kind: "say", notice: "물 끓기", label: NAMED.slice(0, 30), text: NAMED, timeout_s: 10 });
    expect([say?.label, say?.text]).toEqual(["물 끓기 알림", "물이 끓을 때까지 기다려요."]);
    const end = planStep({ kind: "say", notice: "끝", item: "라면", timeout_s: 10 });
    expect(end?.text).toBe("라면이 다 됐어요.");
    const wait = planStep({ kind: "wait", notice: "익기", label: NAMED.slice(0, 30), until: { elapsed_s: 5 }, timeout_s: 60 });
    expect(wait?.label).toBe("익기 기다리기");
    const q = planStep({ ...ask(), label: NAMED.slice(0, 30), choices: "clear_keep" }, ASK_TASK);
    expect(q?.label).toBe("폰으로 물어보기");
    expect(q?.prompt?.choices.map((c) => [c.label, c.reply])).toEqual([["치워 주세요", "알겠어요. 치울게요"], ["그대로 둬요", "알겠어요. 그대로 둘게요"]]);
    // 예전 모양(답 단추 글을 모델이 쓰는 배열)은 받지 않는다
    expect(planStep(ask({ choices: [{ id: "yes", label: BARE.slice(0, 20) }, { id: "no", label: "아니요" }] }), ASK_TASK)).toBeNull();
    // 질문에는 부탁(「주세요」)을 섞지 않는다
    expect(planStep(ask({ question: "냄비를 올려 주세요?" }), ASK_TASK)).toBeNull();
  });

  it("관찰 모드의 다시 알리기·사람 부탁은 모델 글을 받지 않는다: 방식·가까이 볼 곳만 고르고 실행 추적이 서버 글로 보낸다(위험 가전이 대상인 단계도)", async () => {
    // 관찰 모드: 모델이 함께 낸 글(이름 있음)은 버리고 방식·곳만 돌려준다. 글만 내면 받지 않는다
    expect(await observe(["tell_person", { mode: "earlier", text: NAMED, reason: "알리려고" }])).toEqual({ tool: "tell_person", mode: "earlier", reason: "알리려고" });
    expect(await observe(["ask_person", { target: "sink_1", text: BARE, reason: "보려고" }])).toEqual({ tool: "ask_person", target: "sink_1", reason: "보려고" });
    expect(await observe(["tell_person", { text: NAMED, reason: "알리려고" }])).toMatchObject({ tool: "wait", invalid: expect.stringContaining("mode") });
    // 실행 추적: 물 받기(싱크대)와 냄비 올리기(인덕션이 대상) 모두 그 단계 서버 명령으로만 나간다
    expect(tracked((t, step) => t.tell("plan:pam-1", step, "repeat"), 1)("")).toBe("냄비에 물을 받아 주세요");
    expect(tracked((t, step) => t.tell("plan:pam-1", step, "earlier"), 2)("")).toBe("먼저 냄비를 인덕션에 올려 주세요");
    expect(tracked((t, step) => t.askCloser("plan:pam-1", step, "induction_1"), 2)("")).toBe("인덕션이 보이게 폰을 가까이 대 주세요");
    // 모델 글은 그 자리에 넣을 수 없다
    for (const at of [1, 2]) {
      expect(tracked((t, step, x) => t.tell("plan:pam-1", step, x as TellMode), at)(NAMED), String(at)).toBeNull();
      expect(tracked((t, step, x) => t.askCloser("plan:pam-1", step, x), at)(BARE), String(at)).toBeNull();
    }
  });

  it("손 조작 동작은 대상 가전과 hand_device가 같은 가전, 같은 동작이어야 한다(질문·끄기 안내가 다른 가전을 가리키지 않게)", () => {
    expect(planStep({ kind: "do", act: "켜기", target: "induction_1", hand_device: { id: "microwave_1", to: "on" }, timeout_s: 120 })).toBeNull();
    expect(planStep({ kind: "do", act: "켜기", target: "induction_1", hand_device: { id: "induction_1", to: "off" }, timeout_s: 120 })).toBeNull();
    const d = new PlanDraft(ctx());
    const r = d.add({ step: 1, kind: "do", act: "켜기", target: "induction_1", hand_device: { id: "microwave_1", to: "on" }, timeout_s: 120 });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/같은 대상, 같은 동작/) });
  });

  it("가전마다 할 수 있는 동작 밖이거나 hand_device가 없으면 버린다", () => {
    expect(planStep({ kind: "do", act: "켜기", target: "induction_1", timeout_s: 120 })).toBeNull();
    expect(planStep({ kind: "do", act: "열기", target: "induction_1", hand_device: { id: "induction_1", to: "open" }, timeout_s: 120 })).toBeNull();
    expect(planStep({ kind: "do", act: "켜기", target: "sink_1", hand_device: { id: "sink_1", to: "on" }, timeout_s: 120 })).toBeNull();
    // 손 조작이 아닌 동작에는 hand_device를 쓰지 않는다
    expect(planStep({ kind: "do", act: "넣기", item: "면과 스프", target: "induction_1", hand_device: { id: "induction_1", to: "on" }, timeout_s: 120 })).toBeNull();
    // 단계 종류에 없는 동작
    expect(planStep({ kind: "go", act: "켜기", target: "induction_1", timeout_s: 120 })).toBeNull();
  });

  it("말 요청 에이전트의 답에 위험 가전 이름이 나오면 도구를 썼어도 고정 글이다. 승인 대기면 정책 승인 안내 글이다", async () => {
    expect(await agentReply([{ text: "인덕션이 꺼져 있어요. 전원 버튼을 눌러 주세요.", calls: [] }])).toBe(RISKY_REPLY);
    // 별명·오타·띄어 쓴 이름도 같다
    for (const text of ["전자렌지 문을 열고 시작을 눌러 주세요.", "레인지를 돌려 주세요.", "인덕선 전원을 눌러 주세요.", "가스 렌지 불을 켜 주세요."]) {
      expect(await agentReply([{ text, calls: [] }]), text).toBe(RISKY_REPLY);
    }
    // 상태 조회를 한 뒤의 답도 그대로 두지 않는다
    expect(await agentReply([
      { text: "", calls: [{ id: "c1", name: "get_state", args: { device_id: "induction_1", reason: "상태를 보려고" } }] },
      { text: "인덕션이 꺼져 있어요. 인덕션을 켜 주세요.", calls: [] },
    ], "인덕션 켜져 있어?")).toBe(RISKY_REPLY);
    const pending = await agentReply([
      { text: "", calls: [{ id: "c1", name: "turn_on", args: { device_id: "induction_1", reason: "켜 달라고 해서" } }] },
      { text: "인덕션 켜려면 전원 버튼을 눌러 주세요.", calls: [] },
    ], "인덕션 켜 줘");
    expect(pending).toMatch(/^인덕션 켜기는 화재 위험이 있어 사용자 승인이 필요합니다\. 진행할까요\?/);
    expect(pending).not.toMatch(/전원|버튼을 눌러/);
  });
});
