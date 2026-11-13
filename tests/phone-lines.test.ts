// 폰으로 나가는 사람용 글(src/agent/policy.ts phoneLineProblem): 위험 가전(인덕션·전자레인지)을 켜거나 조작하라는 글은 그 가전의 hand_device가 붙은 do 단계에서만 나간다.
// 위험 가전 이름이 나오거나 대상이 위험 가전인 글은 켜기가 아님이 분명한 말(가·올려·내려·닦아·넣어·꺼내·꺼 등, 허용 목록)만 다른 자리에서 통과한다.
// 글이 생기는 자리마다 같은 함수로 거르는지 자리 목록(PHONE_LINE_SITES)과 함께 본다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExecutionTracker } from "../src/act/track.js";
import { Agent, type LlmProvider, type StepOptions, type StepResult } from "../src/agent/agent.js";
import { ApprovalStore } from "../src/agent/approval.js";
import { Observer, type ObserveSituation } from "../src/agent/observer.js";
import { PlanDraft } from "../src/agent/planTools.js";
import { PHONE_LINE_SITES, RISKY_REPLY, phoneLineProblem, riskyUse } from "../src/agent/policy.js";
import type { PlannedCommandMessage } from "../src/contract/phone.js";
import type { WorldView } from "../src/contract/world.js";
import { PlanHub } from "../src/plan/hub.js";
import { floorPlanFrom } from "../src/plan/route.js";
import type { DecisionRecord } from "../src/world/decide.js";
import { SMALL_SCENE } from "./helpers/floor.js";
import { ROOMS, makeHome } from "./helpers/home.js";
import { startFakeObserver, type FakeObserver } from "./helpers/observer.js";
import { planContext } from "./helpers/planner.js";

const RISKY = "인덕션 전원 버튼을 눌러 주세요";

describe("위험 가전 글의 쓰임(riskyUse)", () => {
  it("이름이나 대상이 위험 가전이 아니면 null이다", () => {
    expect(riskyUse("에어컨 전원 버튼을 눌러 주세요")).toBeNull();
    expect(riskyUse("버튼을 눌러 주세요", "aircon")).toBeNull();
    expect(riskyUse("냄비에 물을 받아 주세요")).toBeNull();
  });
  it("켜는 말·조작하는 말(전원·버튼·누르기·작동·화력)은 켜기(on), 끄는 말은 끄기(off)", () => {
    for (const t of ["인덕션을 켜 주세요", RISKY, "인덕션을 작동시켜 주세요", "인덕션 화력을 높여 주세요", "인덕션 불을 올려 주세요", "전자레인지를 돌려 주세요", "전자레인지 시작 버튼을 눌러 주세요"]) {
      expect(riskyUse(t)?.use, t).toBe("on");
    }
    expect(riskyUse("버튼을 눌러 주세요", "cooktop")).toEqual({ kinds: ["cooktop"], use: "on" });
    expect(riskyUse("인덕션을 꺼 주세요")).toEqual({ kinds: ["cooktop"], use: "off" });
    expect(riskyUse("전원 버튼을 눌러 꺼 주세요", "cooktop")?.use).toBe("off");
  });
  it("허용 목록: 켜기가 아님이 분명한 말(가·올려·내려·닦아·넣어·꺼내·열어·기다려·켜지 마)만 safe, 모르는 말은 켜기로 본다", () => {
    for (const t of ["인덕션으로 가 주세요", "냄비를 인덕션에 올려 주세요", "냄비를 인덕션에서 내려 주세요", "인덕션을 닦아 주세요", "전자레인지에 넣어 주세요", "전자레인지에서 꺼내 주세요", "인덕션은 아직 켜지 마세요", "인덕션 버튼은 누르지 마세요", "인덕션으로 가기", "인덕션이 뜨거워요."]) {
      expect(riskyUse(t)?.use, t).toBe("safe");
    }
    expect(riskyUse("면과 스프를 넣어 주세요", "cooktop")?.use).toBe("safe");
    for (const t of ["인덕션을 써 주세요", "인덕션을 만져 주세요", "인덕션 켜기"]) expect(riskyUse(t)?.use, t).toBe("on");
    // 켜지 말라는 말 뒤에 켜라는 말이 있으면 켜기다
    expect(riskyUse("지금은 켜지 말고 물을 받은 뒤 인덕션을 켜 주세요")?.use).toBe("on");
  });
});

describe("폰으로 나가는 글 거르기(phoneLineProblem)", () => {
  const hand = (id: string, kind: string, to: "on" | "off" = "on") => ({ id, kind, to });
  it("켜기·조작은 그 가전의 hand_device(to on)가 있을 때만", () => {
    expect(phoneLineProblem(RISKY)).toMatch(/위험 가전을 켜라는 말/);
    expect(phoneLineProblem(RISKY, { hand: hand("induction_1", "cooktop") })).toBeNull();
    expect(phoneLineProblem(RISKY, { hand: hand("induction_1", "cooktop", "off") })).toMatch(/위험 가전을 켜라는 말/);
    expect(phoneLineProblem("인덕션을 꺼 주세요")).toBeNull();
    expect(phoneLineProblem("냄비를 인덕션에 올려 주세요")).toBeNull();
  });
  it("지시한 가전과 hand_device 가전이 같아야 한다: 글의 이름(종류)과 대상 id 둘 다", () => {
    expect(phoneLineProblem("인덕션을 켜 주세요", { hand: hand("microwave_1", "microwave") })).toMatch(/hand_device 가전이 다릅니다/);
    expect(phoneLineProblem("켜 주세요", { targetId: "induction_1", targetKind: "cooktop", hand: hand("microwave_1", "microwave") })).toMatch(/hand_device 가전이 다릅니다/);
    expect(phoneLineProblem("켜 주세요", { targetId: "induction_2", targetKind: "cooktop", hand: hand("induction_1", "cooktop") })).toMatch(/hand_device 가전이 다릅니다/);
    expect(phoneLineProblem("인덕션과 전자레인지를 켜 주세요", { hand: hand("induction_1", "cooktop") })).toMatch(/hand_device 가전이 다릅니다/);
    expect(phoneLineProblem("인덕션을 꺼 주세요", { hand: hand("microwave_1", "microwave", "off") })).toMatch(/hand_device 가전이 다릅니다/);
    expect(phoneLineProblem("켜 주세요", { targetId: "induction_1", targetKind: "cooktop", hand: hand("induction_1", "cooktop") })).toBeNull();
  });
});

// 자리마다 위험 가전을 켜라는 글을 넣어 거르는지 본다
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
/** 계획 단계 하나를 검사한 까닭(통과면 null). */
const planProblem = (step: Record<string, unknown>, action = RAMEN) => {
  const r = new PlanDraft(ctx(action)).add({ step: 1, ...step });
  return r.ok ? null : r.error;
};
const go = { kind: "go", label: "싱크대로 가기", target: "sink_1", command: "싱크대로 가 주세요", timeout_s: 120 };
const ask = (over: Record<string, unknown> = {}) => ({
  kind: "ask", label: "물어보기", question: "물을 받았나요?", choices: [{ id: "yes", label: "네", reply: "다음으로 가요" }, { id: "no", label: "아니요" }], timeout_s: 120, ...over,
});

/** 실행 추적: 물 받기(sink_1)·냄비 올리기(induction_1) 두 사람 단계 계획을 돌린다. */
function tracker() {
  const phone: PlannedCommandMessage[] = [];
  const plans = new PlanHub(floor(), () => {}, () => "t");
  const approvals = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "lines-")), "approvals.json"), () => "t");
  approvals.answer(`task:${RAMEN}`, "approve");
  const t = new ExecutionTracker({
    plans, world: () => WORLD, check: () => ({ ok: true }), floor: () => plans.floor(), approvals, toPhone: (m) => phone.push(m), emit: () => {},
    handDevices: () => [{ id: "induction_1", kind: "cooktop", label: "인덕션" }],
    planner: () => new PlanDraft(ctx()).submit({ steps: [
      { kind: "do", label: "물 받기", target: "sink_1", command: "냄비에 물을 받아 주세요", timeout_s: 120 },
      { kind: "place", label: "냄비 올리기", target: "induction_1", command: "냄비를 인덕션에 올려 주세요", timeout_s: 120 },
    ] }),
  });
  t.onDecision(decision);
  return { t, phone };
}

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
let observed = "";
beforeAll(async () => { obs = await startFakeObserver(() => [[observed.startsWith("ask:") ? "ask_person" : "tell_person", { text: observed.replace(/^ask:/, ""), reason: "알리려고" }]]); });
afterAll(async () => { await obs.close(); });
const situation = (tools: ObserveSituation["tools"]): ObserveSituation => ({
  trigger: tools.includes("ask_person") ? "stalled" : "off_track", goal: "물 받기 단계", stuckMs: 9_000, spots: [], world: WORLD, earlier: [], tools, nowMs: 10_000,
});
const observerProblem = async (tool: "tell_person" | "ask_person", text: string) => {
  observed = tool === "ask_person" ? `ask:${text}` : text;
  const c = await new Observer({ provider: obs.provider() }).decide(situation(tool === "ask_person" ? ["look_closer", "ask_person", "wait"] : ["tell_person", "wait"]));
  return c.tool === "wait" ? c.invalid ?? c.reason : null;
};

describe("폰으로 나가는 사람용 글이 생기는 자리는 모두 같은 함수로 거른다", () => {
  /** 자리 → 그 자리에 글 하나를 넣어 본 결과(거르면 까닭, 통과면 null). */
  const SITES: Record<(typeof PHONE_LINE_SITES)[number], (text: string) => Promise<string | null> | string | null> = {
    "step.label": (text) => planProblem({ ...go, label: text.slice(0, 30) }),
    "step.command": (text) => planProblem({ ...go, command: text }),
    "step.caution": (text) => planProblem({ kind: "do", label: "물 받기", target: "sink_1", command: "물을 받아 주세요", caution: text.replace(/ 주세요$/, "요.").slice(0, 30), timeout_s: 120 }),
    "say.text": (text) => planProblem({ kind: "say", label: "알림", text: text.replace(/ 주세요$/, "요."), timeout_s: 10 }),
    "ask.question": (text) => planProblem(ask({ question: `${text.replace(/ 주세요$/, "")} 볼까요?` }), ASK_TASK),
    "ask.choices.label": (text) => planProblem(ask({ choices: [{ id: "yes", label: text.slice(0, 20) }, { id: "no", label: "아니요" }] }), ASK_TASK),
    "ask.choices.reply": (text) => planProblem(ask({ choices: [{ id: "yes", label: "네", reply: text }, { id: "no", label: "아니요" }] }), ASK_TASK),
    "observer.tell_person": (text) => observerProblem("tell_person", text),
    "observer.ask_person": (text) => observerProblem("ask_person", text),
    "track.tell": (text) => { const { t } = tracker(); return t.tell("plan:pam-1", "plan:pam-1:1", text) ? null : "보내지 않음"; },
    "track.askCloser": (text) => { const { t } = tracker(); return t.askCloser("plan:pam-1", "plan:pam-1:1", text) ? null : "보내지 않음"; },
    "agent.reply": async (text) => { const reply = await agentReply([{ text, calls: [] }]); return reply === text ? null : reply; },
  };

  it("자리 목록은 이 시험이 보는 자리와 같다", () => {
    expect(Object.keys(SITES).sort()).toEqual([...PHONE_LINE_SITES].sort());
  });

  it.each([...PHONE_LINE_SITES])("%s: 위험 가전을 켜거나 조작하라는 글은 거르고, 켜기가 아닌 글은 통과한다", async (site) => {
    const run = SITES[site];
    expect(await run(RISKY), "거름").not.toBeNull();
    expect(await run("인덕션 켜기를 눌러 주세요"), "거름").not.toBeNull();
    expect(await run("냄비를 인덕션에 올려 주세요"), "통과").toBeNull();
  });

  it("말 요청 에이전트의 답: 거른 답은 정한 한 줄로 바꾼다. 이번 차례에 그 가전을 승인 길(도구)로 다룬 답은 그대로다", async () => {
    expect(await agentReply([{ text: "전원 버튼을 눌러 인덕션을 켜 보세요.", calls: [] }])).toBe(RISKY_REPLY);
    const viaTool = await agentReply([
      { text: "", calls: [{ id: "c1", name: "turn_on", args: { device_id: "induction_1", reason: "켜 달라고 해서" } }] },
      { text: "인덕션 켜기는 승인이 필요해요. 켤까요?", calls: [] },
    ], "인덕션 켜 줘");
    expect(viaTool).toBe("인덕션 켜기는 승인이 필요해요. 켤까요?");
  });
});
