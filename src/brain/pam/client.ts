// 판단(pam-predict/3)·반성(pam-reflect/3)을 서버 안 함수로 한다. 계약은 docs/pam-interface.md(사진 칸 없음).
// 차례(Python PAM과 같다): 사진 칸 검사 → 요청 모양(PamRequestError) → 메시지 → 문맥 길이(PamBudgetError) → LLM(PamLinkError) → 답 검사(PamAnswerError).
import type { CandidateFsm, PamPredictContract, PamPredictRequest, PamReflectContract, PamReflectRequest, Prediction } from "../../contract/pam.js";
import { ContractError, CUP_FSM_MEMORY, checkInput, validateCandidateFsm, validateMemory, type DecisionInput, type DecisionModel, type FsmMemory, type ListMemory } from "../decision.js";
import { PyJsonFail, readPyJson } from "./pyjson.js";
import { parseMemory, parsePrediction } from "./answer.js";
import { estimateTokens, pamLimits, type PamLimits } from "./budget.js";
import { PamAnswerError, PamBudgetError, PamRequestError } from "./errors.js";
import { PamLlm, type CallOptions } from "./llm.js";
import { buildPredictMessages, buildReflectMessages, generation } from "./prompt.js";
import { UNREADABLE, memoryCheckMessages, parseVerdict, type MemoryVerdict } from "./memoryCheck.js";
import { markMessages, type MarkInput } from "./night.js";
import { clock, validateMarks, type Marks } from "./marks.js";
import { FOLLOW_SECONDS } from "./adopt.js";
import { headWithin } from "../../shared/cut.js";
import { predictRequest, reflectRequest } from "./request.js";
import type { PamSettings } from "./settings.js";

export const PAM_PREDICT: PamPredictContract = "pam-predict/3";
export const PAM_REFLECT: PamReflectContract = "pam-reflect/3";
const IMAGE_KEY = /^(image|images|frames|image_url|base64|jpeg|png)$/i;

/** 어느 깊이든 사진 칸이나 data:image 값이 있으면 막는다. */
export function assertTextOnly(body: unknown, path = "body"): void {
  if (typeof body === "string") {
    if (/data:image\//i.test(body)) throw new PamRequestError(`${path}: PAM에는 사진을 넘기지 않습니다`);
    return;
  }
  if (Array.isArray(body)) {
    body.forEach((v, i) => assertTextOnly(v, `${path}[${i}]`));
    return;
  }
  if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body)) {
      if (IMAGE_KEY.test(k)) throw new PamRequestError(`${path}.${k}: PAM에는 사진을 넘기지 않습니다`);
      assertTextOnly(v, `${path}.${k}`);
    }
  }
}

export class PamClient {
  private readonly llm: PamLlm;

  constructor(private readonly o: { settings: PamSettings; timeoutMs?: number; fetchImpl?: typeof fetch }) {
    this.llm = new PamLlm(o.settings, { fetchImpl: o.fetchImpl });
  }

  /** 판단·반성에 넣을 수 있는 UTF-8 바이트(문맥 길이 PAM_MAX_MODEL_LEN에서 계산). */
  async limits(): Promise<PamLimits> {
    return pamLimits(this.o.settings);
  }

  /** call.signal로 끊고(PamLinkError), call.onUsage로 이번 LLM 사용량을 받는다. */
  async predict(r: Omit<PamPredictRequest, "contract">, call: CallOptions = {}): Promise<Prediction> {
    assertTextOnly(r);
    const req = predictRequest({ contract: PAM_PREDICT, ...r });
    const built = buildPredictMessages(req);
    assertTextOnly(built.messages);
    const raw = await this.llm.complete(built.messages, built.generation, "predictor", Math.min(this.o.timeoutMs ?? 30_000, this.o.settings.timeoutMs), call);
    const parsed = parsePrediction(raw, req.tasks, req.memory_kind === "fsm" ? { memory: validateMemory(req.memory, "fsm") as FsmMemory, lastState: req.last_state } : undefined);
    if (parsed.status !== "valid" || !parsed.prediction) throw new PamAnswerError(`PAM 답이 계약에 맞지 않음(대기와 다름): ${parsed.errors.join("; ") || "이유 없음"}`);
    return parsed.prediction;
  }

  /** 반성. fsm_candidates면 답은 후보 FSM이고 seed 상태(CUP_FSM_MEMORY)를 지켰는지까지 본다(validateCandidateFsm). 모양 오류는 PamAnswerError. */
  async reflect(r: Omit<PamReflectRequest, "contract">, kind: "fsm_candidates", call?: CallOptions): Promise<CandidateFsm>;
  async reflect(r: Omit<PamReflectRequest, "contract">, kind: "list", call?: CallOptions): Promise<ListMemory>;
  async reflect(r: Omit<PamReflectRequest, "contract">, kind: "list" | "fsm_candidates", call: CallOptions = {}): Promise<CandidateFsm | ListMemory> {
    assertTextOnly(r);
    const req = reflectRequest({ contract: PAM_REFLECT, ...r });
    const built = buildReflectMessages(req);
    assertTextOnly(built.messages);
    const raw = await this.llm.complete(built.messages, built.generation, "reflector", this.o.settings.timeoutMs, call);
    if (kind === "list") {
      const parsed = parseMemory(raw, "list");
      if (!parsed.ok) throw new PamAnswerError(`PAM 반성 실패: ${parsed.error}`);
      return validateMemory(parsed.memory, "list") as ListMemory;
    }
    try {
      return validateCandidateFsm(readPyJson(raw), CUP_FSM_MEMORY);
    } catch (e) {
      if (e instanceof PyJsonFail || e instanceof ContractError) throw new PamAnswerError(`PAM 반성 실패: ${e.message}`);
      throw e;
    }
  }

  /** 시각 찾기(밤 흐름): 물은 (상태, 후보)·행동마다 그날 일어난 때와 사람이 안 보인 구간. 시각은 그날 줄 시각만 받는다. 답이 틀리면 PamAnswerError.
   *  한 요청이 문맥 길이를 넘으면 맡은 구간으로 나눠 여러 번 묻는다(planMark): 조각은 앞뒤 검사 창의 맥락 줄을 함께 받고, 답은 맡은 구간 안의 시각만 남긴다.
   *  요청 수가 MARK_MAX_REQUESTS를 넘거나 줄 하나로도 넘으면 PamBudgetError. log: 맥락을 줄인 조각마다 한 줄. */
  async mark(i: MarkInput, call: CallOptions = {}, log?: (line: string) => void): Promise<Marks> {
    const parts = planMark(i, (x) => estimateTokens(markMessages(x).messages) + this.o.settings.maxTokens.reflector <= this.o.settings.maxModelLen, log);
    const got: Marks[] = [];
    for (const part of parts) got.push(owned(await this.markOne(part.input, call), part.own));
    if (got.length === 1) return got[0]!;
    const first = got[0]!;
    const times = (pick: (m: Marks) => string[]) => got.flatMap(pick).sort();
    return {
      candidates: first.candidates.map((c) => ({ ...c, times: times((m) => m.candidates.find((x) => x.state === c.state && x.candidate === c.candidate)!.times) })),
      actions: first.actions.map((x) => ({ ...x, times: times((m) => m.actions.find((y) => y.action === x.action)!.times) })),
      unseen: got.flatMap((m) => m.unseen),
    };
  }

  private async markOne(i: MarkInput, call: CallOptions): Promise<Marks> {
    const { messages, asked } = markMessages(i);
    assertTextOnly(messages);
    const raw = await this.llm.complete(messages, generation("reflector"), "reflector", this.o.settings.timeoutMs, call);
    try {
      return validateMarks(readPyJson(raw), asked, i.actions, i.lines.map((l) => l.substring(0, 8)));
    } catch (e) {
      if (e instanceof PyJsonFail || e instanceof ContractError) throw new PamAnswerError(`PAM 시각 찾기 실패: ${e.message}`);
      throw e;
    }
  }

  /** 기억 뜻 검사(LLM): 같은 PAM LLM 통로로 한 번(반성 생성 설정·시간 제한). 답을 읽을 수 없으면 거절 판정이다. 연결 오류(PamLinkError)는 그대로 던진다. */
  async checkMemory(memory: CandidateFsm, call: CallOptions = {}): Promise<MemoryVerdict> {
    const messages = memoryCheckMessages(memory);
    assertTextOnly(messages);
    const raw = await this.llm.complete(messages, generation("reflector"), "reflector", this.o.settings.timeoutMs, call);
    try {
      return parseVerdict(raw);
    } catch (e) {
      if (e instanceof PyJsonFail || e instanceof ContractError) return UNREADABLE;
      throw e;
    }
  }
}

/** 기록 줄 일부의 시각 찾기 요청. */
function markPart(i: MarkInput, lines: string[]): MarkInput {
  return { ...i, lines };
}

/** 하루 시각 찾기 요청 수 상한: 넘으면 묻기 전에 PamBudgetError(밤 흐름이 그날만 빼고 다음 밤에 다시 묻는다). */
export const MARK_MAX_REQUESTS = 32;
/** 시각 찾기 조각 하나: 요청(맥락 줄 포함)과 맡은 구간(첫·끝 맡은 줄의 HH:MM:SS, 양끝 포함). */
export interface MarkPartPlan { input: MarkInput; own: readonly [string, string] }

/** 시각 찾기 나누기(Codex be8a98c0): 하루 기록을 겹치지 않는 맡은 구간으로 나누고, 조각마다 맡은 구간 앞뒤 검사 창(FOLLOW_SECONDS)의 맥락 줄을 붙인다.
 *  맥락을 붙인 조각이 한도(fits)를 넘으면 맡은 구간만 반으로 나눈다(같은 초 줄은 한 구간). 맡은 구간이 한 초 줄 묶음인데도 넘으면 맥락을 반씩 줄여 맞추고 log 한 줄
 *  (맥락 0초로도 넘으면 그대로 두어 보낼 때 PamBudgetError). 조각이 MARK_MAX_REQUESTS를 넘으면 PamBudgetError. */
export function planMark(i: MarkInput, fits: (x: MarkInput) => boolean, log?: (line: string) => void): MarkPartPlan[] {
  const secs = i.lines.map(lineSec);
  const time = (k: number) => headWithin(i.lines[k]!, 8);
  const out: MarkPartPlan[] = [];
  // 맡은 줄 [a, b)와 앞뒤 ctx초 맥락 줄
  const build = (a: number, b: number, ctx: number): MarkInput => {
    let lo = a, hi = b;
    while (lo > 0 && secs[lo - 1]! >= secs[a]! - ctx) lo--;
    while (hi < secs.length && secs[hi]! <= secs[b - 1]! + ctx) hi++;
    return markPart(i, i.lines.slice(lo, hi));
  };
  // [a, b) 안에서 가운데에 가까운, 앞 줄과 초가 다른 줄(없으면 -1)
  const middle = (a: number, b: number) => {
    const m = a + Math.floor((b - a) / 2);
    for (let d = 0; d < b - a; d++) for (const k of [m + d, m - d]) if (k > a && k < b && secs[k - 1] !== secs[k]) return k;
    return -1;
  };
  const walk = (a: number, b: number): void => {
    if (out.length > MARK_MAX_REQUESTS) return;
    const own = [time(a), time(b - 1)] as const;
    const whole = build(a, b, FOLLOW_SECONDS);
    if (fits(whole)) return void out.push({ input: whole, own });
    const m = middle(a, b);
    if (m !== -1) {
      walk(a, m);
      walk(m, b);
      return;
    }
    for (let ctx = FOLLOW_SECONDS >> 1; ; ctx >>= 1) {
      const part = build(a, b, ctx);
      if (fits(part) || ctx === 0) {
        log?.(`시각 찾기: ${own[0]} 줄은 앞뒤 맥락을 ${ctx}초로 줄여 물어요`);
        return void out.push({ input: part, own });
      }
    }
  };
  if (i.lines.length) walk(0, i.lines.length);
  else out.push({ input: i, own: ["00:00:00", "23:59:59"] });
  if (out.length > MARK_MAX_REQUESTS) throw new PamBudgetError(`시각 찾기 요청이 ${MARK_MAX_REQUESTS}번을 넘어요(그날 기록 ${i.lines.length}줄)`);
  return out;
}

/** 조각 답에서 맡은 구간의 것만: 후보·행동 시각은 맡은 구간 안, 안 보인 구간은 맡은 구간과 겹친 부분(맥락의 답은 그 구간을 맡은 이웃 조각이 남긴다). */
function owned(m: Marks, own: readonly [string, string]): Marks {
  const inside = (t: string) => t >= own[0] && t <= own[1];
  return {
    candidates: m.candidates.map((c) => ({ ...c, times: c.times.filter(inside) })),
    actions: m.actions.map((x) => ({ ...x, times: x.times.filter(inside) })),
    unseen: m.unseen.flatMap((u) => {
      const start = u.start > own[0] ? u.start : own[0], end = u.end < own[1] ? u.end : own[1];
      return start <= end ? [{ start, end }] : [];
    }),
  };
}

/** 기록 줄(`HH:MM:SS | 글`)의 자정부터 초. */
const lineSec = (line: string) => clock(headWithin(line, 8), "line");

export class PamDecision implements DecisionModel {
  readonly name = "pam";
  constructor(private readonly pam: PamClient) {}

  decide(input: DecisionInput): Promise<Prediction> {
    try {
      checkInput(input);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.pam.predict({ final_time: input.finalTime, observation_text: input.text, memory_kind: input.memoryKind, memory: input.memory, tasks: input.tasks, last_state: input.lastState });
  }
}
