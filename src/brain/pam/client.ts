// 판단(pam-predict/3)·반성(pam-reflect/3)을 서버 안 함수로 한다. 계약은 docs/pam-interface.md(사진 칸 없음).
// 차례(Python PAM과 같다): 사진 칸 검사 → 요청 모양(PamRequestError) → 메시지 → 문맥 길이(PamBudgetError) → LLM(PamLinkError) → 답 검사(PamAnswerError).
import type { CandidateFsm, PamPredictContract, PamPredictRequest, PamReflectContract, PamReflectRequest, Prediction } from "../../contract/pam.js";
import { ContractError, CUP_FSM_MEMORY, checkInput, validateCandidateFsm, validateMemory, type DecisionInput, type DecisionModel, type FsmMemory, type ListMemory } from "../decision.js";
import { PyJsonFail, readPyJson } from "./pyjson.js";
import { parseMemory, parsePrediction } from "./answer.js";
import { estimateTokens, pamLimits, type PamLimits } from "./budget.js";
import { PamAnswerError, PamRequestError } from "./errors.js";
import { PamLlm, type CallOptions } from "./llm.js";
import { buildPredictMessages, buildReflectMessages, generation } from "./prompt.js";
import { UNREADABLE, memoryCheckMessages, parseVerdict, type MemoryVerdict } from "./memoryCheck.js";
import { chunkMessages, markMessages, type MarkInput } from "./night.js";
import { clock, validateChunks, validateMarks, type Chunks, type Marks } from "./marks.js";
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

  /** 덩어리 기록(밤 흐름): 그날 기록 줄(`HH:MM:SS | 글`) → 하는 일 덩어리. 시각은 그 줄 시각만 받는다. 답이 틀리면 PamAnswerError. */
  async chunk(lines: string[], call: CallOptions = {}): Promise<Chunks> {
    const messages = chunkMessages(lines);
    assertTextOnly(messages);
    const raw = await this.llm.complete(messages, generation("reflector"), "reflector", this.o.settings.timeoutMs, call);
    try {
      return validateChunks(readPyJson(raw), lines.map((l) => l.substring(0, 8)));
    } catch (e) {
      if (e instanceof PyJsonFail || e instanceof ContractError) throw new PamAnswerError(`PAM 덩어리 기록 실패: ${e.message}`);
      throw e;
    }
  }

  /** 시각 찾기(밤 흐름): 물은 (상태, 후보)·행동마다 그날 일어난 때와 사람이 안 보인 구간. 시각은 그날 줄 시각만 받는다. 답이 틀리면 PamAnswerError.
   *  한 요청이 문맥 길이를 넘으면 기록 줄을 차례대로 반씩 나눠(그 줄 구간에 걸친 덩어리만 붙여) 여러 번 묻고 답을 합친다(Codex 1b07d3e2 P2).
   *  뒤 조각은 새로 맡은 첫 줄 앞 검사 창(FOLLOW_SECONDS)의 줄도 함께 받는다: 걷기 시작과 행동 완료가 경계를 넘어도 시작 줄 시각으로 답한다(Codex 81d209ef P2).
   *  줄 하나로도 넘으면 PamBudgetError. */
  async mark(i: MarkInput, call: CallOptions = {}): Promise<Marks> {
    const parts: Marks[] = [];
    for (const part of this.markParts(i)) parts.push(await this.markOne(part, call));
    return mergeMarks(parts);
  }

  /** 문맥 길이 안에 드는 시각 찾기 요청들(기록 줄 차례대로). */
  private markParts(i: MarkInput): MarkInput[] {
    const fits = estimateTokens(markMessages(i).messages) + this.o.settings.maxTokens.reflector <= this.o.settings.maxModelLen;
    if (fits || i.lines.length <= 1) return [i];
    const half = Math.ceil(i.lines.length / 2);
    const cut = lineSec(i.lines[half]!) - FOLLOW_SECONDS;
    // 뒤 조각의 첫 줄: 검사 창 안의 앞 줄부터. 앞 조각 전체가 창 안이어도 한 줄은 줄여 나누기가 끝나게 한다
    const from = Math.min(half, Math.max(1, i.lines.findIndex((l) => lineSec(l) >= cut)));
    return [...this.markParts(markPart(i, i.lines.slice(0, half))), ...this.markParts(markPart(i, i.lines.slice(from)))];
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

/** 기록 줄 일부의 시각 찾기 요청: 그 줄 구간(첫 줄 ~ 끝 줄 시각)에 걸친 덩어리 줄(`HH:MM:SS~HH:MM:SS …`)만 붙인다. */
function markPart(i: MarkInput, lines: string[]): MarkInput {
  const first = lines[0]!.substring(0, 8), last = lines.at(-1)!.substring(0, 8);
  return { ...i, lines, chunks: i.chunks.filter((c) => c.substring(0, 8) <= last && c.substring(9, 17) >= first) };
}

/** 기록 줄(`HH:MM:SS | 글`)의 자정부터 초. */
const lineSec = (line: string) => clock(headWithin(line, 8), "line");
/** 같은 후보·행동이 이만큼(초) 안에 다시 맞으면 한 번이다(시각 찾기 지시문 marking.txt와 같다). */
const SAME_EVENT_SECONDS = 10;

/** 나눠 물은 시각 찾기 답 합치기: 후보·행동마다 시각을 차례대로 합친다. 같은 시각은 하나이고, 다른 조각이 SAME_EVENT_SECONDS 안에 다시 답한 시각은
 *  앞 시각 하나로 센다(겹친 구간을 두 조각이 함께 본다. 한 조각 안의 답은 모델이 이미 그 규칙으로 냈으니 그대로, Codex 81d209ef P2).
 *  안 보인 구간은 시각 차례로 잇고 같은 구간은 하나다. */
export function mergeMarks(parts: Marks[]): Marks {
  if (parts.length === 1) return parts[0]!;
  const times = (lists: string[][]) => {
    const all = lists.flatMap((ts, part) => ts.map((t) => ({ t, part, s: clock(t, "time") }))).sort((a, b) => a.s - b.s || a.part - b.part);
    const kept: typeof all = [];
    for (const x of all) {
      const prev = kept.at(-1);
      if (prev && (prev.t === x.t || (prev.part !== x.part && x.s - prev.s <= SAME_EVENT_SECONDS))) continue;
      kept.push(x);
    }
    return kept.map((x) => x.t);
  };
  const first = parts[0]!;
  const unseen = [...new Map(parts.flatMap((p) => p.unseen).map((u) => [`${u.start}|${u.end}`, u])).values()].sort((a, b) => (a.start === b.start ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start)));
  return {
    candidates: first.candidates.map((c) => ({ ...c, times: times(parts.map((p) => p.candidates.find((x) => x.state === c.state && x.candidate === c.candidate)!.times)) })),
    actions: first.actions.map((a) => ({ ...a, times: times(parts.map((p) => p.actions.find((x) => x.action === a.action)!.times)) })),
    unseen,
  };
}

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
