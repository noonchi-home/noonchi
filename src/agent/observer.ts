// 에이전트 관찰 모드: 비전이 판단할 만큼 못 볼 때 도구 하나(look_closer·ask_person·wait)를 고른다. 계획 모드(src/agent/planner.ts)와 같은 공급자(createProvider).
// 호출마다 새 대화. OpenAI는 도구를 꼭 부르게(required) 하고, Anthropic은 강제가 안 돼 글만 내면 한 번 더 묻는다(최대 maxRounds).
// 틀린 도구·인자(없는 id, 사진 밖 id, 「주세요」로 안 끝나거나 화면 글 규칙에 걸린 부탁)는 까닭을 도구 결과로 돌려주고 다시 받는다. 그래도 틀리면 기다리기(invalid).
// 도구를 실행하지 않는다: 고른 것만 돌려주고 실행은 src/act/look.ts가 한다. 넘긴 신호가 끊기면(단계 끝·그만·새 계획) 공급자 요청도 끊는다.
// 비용은 공급자 응답 사용량(StepResult.usage)을 가격표(src/infer/cost.ts)로 센다. 가격표에 없는 모델이나 사용량이 없는 응답이 있으면 비용은 모름(null)이다.
// 시험은 같은 OpenAI 공급자를 가짜 서버에 붙인다(tests/helpers/observer.ts).
import { z } from "zod";
import type { LookTool, LookTrigger } from "../contract/events.js";
import type { WorldView } from "../contract/world.js";
import { estimateCostUsd, hasPrice } from "../infer/cost.js";
import { copyRules } from "../plan/copy.js";
import type { LlmProvider, StepUsage, ToolCall } from "./agent.js";
import { worldLines } from "./planInput.js";
import type { ToolDef } from "./tools.js";

export const OBSERVER_PROMPT = `너는 이 집 스마트홈 에이전트의 관찰 모드다. 비전(YOLO 감지 + VLM)이 판단할 만큼 잘 보지 못할 때 도구 하나를 골라 부른다.

도구
- look_closer: 폰이 보낸 마지막 사진들에서 target 자리 둘레를 2배로 잘라 같은 감지기·VLM으로 다시 본다. 결과는 World State에 들어간다. target은 [가까이 볼 곳]에서 「지금 사진 안」인 id만 쓴다.
- ask_person: 사람에게 폰으로 가까이 비춰 달라고 부탁한다. 지금 명령 대신 폰에 뜨고 소리로 읽는다. text는 「주세요」로 끝나는 짧은 부탁이다(예: 싱크대 안이 보이게 폰을 가까이 대 주세요). 괄호·화살표 없이 60자 아래로 쓰고, 클로이드가 스스로 하는 말로 쓰지 않는다.
- wait: 아무것도 하지 않고 다음 사진을 기다린다.

고르는 법
- 대상이 지금 사진 안이고 아직 가까이 보지 않았으면 look_closer.
- 대상이 사진 밖이거나 가까이 봐도 못 찾았으면 ask_person(쓸 수 있을 때).
- 사람이 아직 하는 중으로 보이거나 방금 부탁했으면 wait.
- [앞서 한 일]과 같은 일을 같은 결과로 되풀이하지 않는다.
- 쓸 수 있는 도구는 [쓸 수 있는 도구] 안이다.
- reason은 왜 그 도구인지 한국어 한 문장. 도구는 하나만 부르고 답 글은 쓰지 않는다.
- 결과가 오류면 까닭이 온다. 고쳐서 도구 하나를 다시 부른다.`;

/** 기본값: 모델 차례 2번, 호출 하나 15초, 응답 하나 출력 1000토큰. */
export const OBSERVER_DEFAULTS = { maxRounds: 2, timeoutMs: 15_000, maxOutputTokens: 1000 } as const;

/** 가까이 볼 곳 하나: 평면도·World State id, 이름, 그 자리가 마지막 사진 안인가. src/observe/crop.ts LookSpot에 inView를 더한 것도 그대로 넘길 수 있다. */
export interface ObserveSpot {
  id: string;
  label: string;
  inView: boolean;
}

/** 관찰 모드 한 번의 상황. */
export interface ObserveSituation {
  trigger: LookTrigger;
  /** 확인할 것 한 줄(단계 이름·지금 명령·끝난 조건, 또는 모르는 사실). */
  goal: string;
  /** 단계가 시작된 뒤 지난 시간(A). 판단 전 보기(B)는 null. */
  stuckMs: number | null;
  spots: ObserveSpot[];
  world: WorldView;
  /** 같은 단계·물건에서 앞서 고른 것과 결과 글. */
  earlier: { atMs: number; tool: LookTool; target: string | null; text: string }[];
  /** 이번에 쓸 수 있는 도구(B는 ask_person 없음). */
  tools: readonly LookTool[];
  nowMs: number;
}

/** 고른 도구 하나. invalid는 맞는 도구를 받지 못해 기다리기로 둔 까닭이다. */
export type ObserveChoice =
  | { tool: "look_closer"; target: string; reason: string }
  | { tool: "ask_person"; text: string; reason: string }
  | { tool: "wait"; reason: string; invalid?: string };

/** calls 관찰 모드 호출(decide) 수, requests 답을 받은 모델 요청 수, costUsd 그 요청들의 비용(모르면 null). */
export interface ObserverStatus {
  calls: number;
  requests: number;
  costUsd: number | null;
}

export interface ObserverOptions {
  provider: LlmProvider;
  /** 모델 차례 상한(도구 호출·고친 호출·답 글만 낸 차례). */
  maxRounds?: number;
  /** 호출 하나의 시간 한도(ms). */
  timeoutMs?: number;
  /** 응답 하나의 출력 토큰 상한. */
  maxOutputTokens?: number;
}

const REASON = z.string().min(1).max(200).describe("왜 이 도구를 고르는지 한국어 한 문장");
const ARGS = {
  look_closer: z.object({ target: z.string().min(1).describe("[가까이 볼 곳]의 id 하나, 지금 사진 안"), reason: REASON }),
  ask_person: z.object({ text: z.string().min(1).max(60).describe("사람에게 하는 짧은 부탁, 「주세요」로 끝남"), reason: REASON }),
  wait: z.object({ reason: REASON }),
} satisfies Record<LookTool, z.ZodObject<z.ZodRawShape>>;
const ABOUT: Record<LookTool, { title: string; description: string }> = {
  look_closer: { title: "가까이 보기", description: "마지막 사진들에서 target 자리를 2배로 잘라 같은 감지기·VLM으로 다시 봅니다. 결과는 World State에 들어갑니다." },
  ask_person: { title: "사람에게 부탁", description: "실제 폰의 지금 명령 자리에 부탁 글을 띄우고 소리로 읽습니다. text는 「주세요」로 끝납니다." },
  wait: { title: "기다리기", description: "아무것도 하지 않고 다음 사진을 기다립니다." },
};

/** 이번에 쓸 수 있는 관찰 모드 도구. 실행은 src/act/look.ts가 하므로 run은 부르지 않는다. */
export const observerTools = (tools: readonly LookTool[]): ToolDef[] => tools.map((name) => ({
  name, ...ABOUT[name], schema: ARGS[name], readOnly: true,
  run: async () => ({ ok: false, error: "관찰 모드 도구는 src/act/look.ts가 실행합니다" }),
}));

/** 관찰 모드 한 번의 사용자 말. */
export function observerInput(s: ObserveSituation): string {
  const sec = (ms: number) => `${Math.max(0, Math.round(ms / 1000))}초`;
  return [
    `[확인할 것] ${s.goal}`,
    s.stuckMs === null ? "- 판단 전에 이 사실을 더 잘 보면 좋다" : `- 단계가 시작된 지 ${sec(s.stuckMs)} 지났는데 끝난 조건이 아직 참이 아니다`,
    "[가까이 볼 곳]",
    ...(s.spots.length ? s.spots.map((p) => `- ${p.id} ${p.label} · ${p.inView ? "지금 사진 안" : "지금 사진 밖"}`) : ["- 없음"]),
    "[World State]",
    ...worldLines(s.world),
    "[앞서 한 일]",
    ...(s.earlier.length ? s.earlier.map((e) => `- ${sec(s.nowMs - e.atMs)} 전 ${e.tool}${e.target ? ` ${e.target}` : ""} · ${e.text}`) : ["- 없음"]),
    `[쓸 수 있는 도구] ${s.tools.join(", ")}`,
  ].join("\n");
}

/** 도구 호출 하나 → 고른 것, 틀리면 까닭 글. */
function checkChoice(call: ToolCall, s: ObserveSituation): ObserveChoice | string {
  const name = call.name as LookTool;
  if (!s.tools.includes(name)) return `이번에는 ${s.tools.join("·")}만 부릅니다`;
  const a = ARGS[name].safeParse(call.args);
  if (!a.success) return `${name} 인자가 맞지 않습니다: ${a.error.issues.slice(0, 2).map((i) => `${i.path.join(".") || "(전체)"} ${i.message}`).join("; ")}`;
  const args = a.data as { reason: string; target?: string; text?: string };
  const reason = args.reason.trim();
  if (name === "look_closer") {
    const target = String(args.target).trim();
    const spot = s.spots.find((p) => p.id === target);
    if (!spot) return `[가까이 볼 곳]에 없는 id입니다: ${target}`;
    if (!spot.inView) return `${spot.id}는 지금 사진 밖이라 가까이 볼 수 없습니다`;
    return { tool: name, target: spot.id, reason };
  }
  if (name === "ask_person") {
    const text = String(args.text).trim();
    if (!/주세요$/.test(text)) return "text는 사람에게 하는 부탁이라 「주세요」로 끝나야 합니다. 예: 싱크대 안이 보이게 폰을 가까이 대 주세요";
    const hit = copyRules(text);
    if (hit.length) return `text가 화면 글 규칙(${hit.join(", ")})에 맞지 않습니다`;
    return { tool: name, text, reason };
  }
  return { tool: "wait", reason };
}

const NUDGE = "답 글 대신 도구 하나를 부르세요.";
const NO_CALL = "도구를 부르지 않음";

export class Observer {
  private calls = 0;
  private requests = 0;
  private cost = 0;
  private unknownCost = false;
  private readonly cfg: { maxRounds: number; timeoutMs: number; maxOutputTokens: number };

  constructor(private readonly o: ObserverOptions) {
    this.cfg = {
      maxRounds: o.maxRounds ?? OBSERVER_DEFAULTS.maxRounds, timeoutMs: o.timeoutMs ?? OBSERVER_DEFAULTS.timeoutMs,
      maxOutputTokens: o.maxOutputTokens ?? OBSERVER_DEFAULTS.maxOutputTokens,
    };
  }

  /** 고른 도구 하나. signal이 끊기면 공급자 요청을 끊고 그 까닭을 던지고, timeoutMs가 지나면 끊고 시간 한도 오류를 던진다. */
  async decide(s: ObserveSituation, signal?: AbortSignal): Promise<ObserveChoice> {
    this.calls++;
    signal?.throwIfAborted();
    const ac = new AbortController();
    const stop = () => ac.abort(signal?.reason);
    signal?.addEventListener("abort", stop, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, this.cfg.timeoutMs);
    timer.unref?.();
    try {
      return await this.loop(s, ac.signal);
    } catch (e) {
      if (timedOut && !signal?.aborted) throw new Error(`관찰 모드가 ${this.cfg.timeoutMs / 1000}초 안에 답하지 않음`);
      throw e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  }

  private async loop(s: ObserveSituation, signal: AbortSignal): Promise<ObserveChoice> {
    const { provider } = this.o;
    const state = provider.createState();
    provider.addUserMessage(state, observerInput(s));
    const tools = observerTools(s.tools);
    let why = NO_CALL;
    for (let round = 0; round < this.cfg.maxRounds; round++) {
      signal.throwIfAborted();
      const r = await provider.step(state, { system: OBSERVER_PROMPT, tools, allowTools: true, requireTool: true, signal, maxOutputTokens: this.cfg.maxOutputTokens });
      this.count(r.usage);
      signal.throwIfAborted();
      if (!r.calls.length) {
        why = NO_CALL;
        provider.addUserMessage(state, NUDGE);
        continue;
      }
      const c = checkChoice(r.calls[0]!, s);
      if (typeof c !== "string") return c;
      why = c;
      provider.addToolResults(state, r.calls.map((call) => ({ call, content: JSON.stringify({ ok: false, error: c }), isError: true, result: { ok: false, error: c } })));
    }
    return { tool: "wait", reason: why, invalid: why };
  }

  private count(usage: StepUsage | undefined): void {
    this.requests++;
    if (!usage || !hasPrice(usage.model)) {
      this.unknownCost = true;
      return;
    }
    this.cost += estimateCostUsd(usage.model, { prompt: usage.input, completion: usage.output, cached: usage.cached });
  }

  status(): ObserverStatus {
    return { calls: this.calls, requests: this.requests, costUsd: this.unknownCost ? null : Math.round(this.cost * 1e8) / 1e8 };
  }
}
