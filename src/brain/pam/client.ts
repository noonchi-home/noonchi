// 판단(pam-predict/3)·반성(pam-reflect/3)을 서버 안 함수로 한다. 계약은 docs/pam-interface.md(사진 칸 없음).
// 차례(Python PAM과 같다): 사진 칸 검사 → 요청 모양(PamRequestError) → 메시지 → 문맥 길이(PamBudgetError) → LLM(PamLinkError) → 답 검사(PamAnswerError).
import type { CandidateFsm, PamPredictContract, PamPredictRequest, PamReflectContract, PamReflectRequest, Prediction } from "../../contract/pam.js";
import { ContractError, CUP_FSM_MEMORY, checkInput, validateCandidateFsm, validateMemory, type DecisionInput, type DecisionModel, type ListMemory, type PamMemory } from "../decision.js";
import { PyJsonFail, readPyJson } from "./pyjson.js";
import { parseMemory, parsePrediction } from "./answer.js";
import { pamLimits, type PamLimits } from "./budget.js";
import { PamAnswerError, PamRequestError } from "./errors.js";
import { PamLlm, type CallOptions } from "./llm.js";
import { buildPredictMessages, buildReflectMessages, generation } from "./prompt.js";
import { UNREADABLE, memoryCheckMessages, parseVerdict, type MemoryVerdict } from "./memoryCheck.js";
import { chunkMessages, markMessages, type MarkInput } from "./night.js";
import { validateChunks, validateMarks, type Chunks, type Marks } from "./marks.js";
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
    const parsed = parsePrediction(raw, req.tasks, req.memory_kind === "fsm" ? (validateMemory(req.memory, "fsm") as PamMemory) : undefined);
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

  /** 시각 찾기(밤 흐름): 물은 (상태, 후보)·행동마다 그날 일어난 때와 사람이 안 보인 구간. 시각은 그날 줄 시각만 받는다. 답이 틀리면 PamAnswerError. */
  async mark(i: MarkInput, call: CallOptions = {}): Promise<Marks> {
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

export class PamDecision implements DecisionModel {
  readonly name = "pam";
  constructor(private readonly pam: PamClient) {}

  decide(input: DecisionInput): Promise<Prediction> {
    try {
      checkInput(input);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.pam.predict({ final_time: input.finalTime, observation_text: input.text, memory_kind: input.memoryKind, memory: input.memory, tasks: input.tasks, last_state: null });
  }
}
