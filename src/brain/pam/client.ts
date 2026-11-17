// 판단(pam-predict/2)·반성(pam-reflect/2)을 서버 안 함수로 한다. 계약은 docs/pam-interface.md(사진 칸 없음).
// 차례(Python PAM과 같다): 사진 칸 검사 → 요청 모양(PamRequestError) → 메시지 → 문맥 길이(PamBudgetError) → LLM(PamLinkError) → 답 검사(PamAnswerError).
import type { PamPredictContract, PamPredictRequest, PamReflectContract, PamReflectRequest, Prediction } from "../../contract/pam.js";
import { checkInput, validateMemory, type DecisionInput, type DecisionModel, type PamMemory } from "../decision.js";
import { parseMemory, parsePrediction } from "./answer.js";
import { pamLimits, type PamLimits } from "./budget.js";
import { PamAnswerError, PamRequestError } from "./errors.js";
import { PamLlm, type CallOptions } from "./llm.js";
import { buildPredictMessages, buildReflectMessages } from "./prompt.js";
import { predictRequest, reflectRequest } from "./request.js";
import type { PamSettings } from "./settings.js";

export const PAM_PREDICT: PamPredictContract = "pam-predict/2";
export const PAM_REFLECT: PamReflectContract = "pam-reflect/2";
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
    const parsed = parsePrediction(raw, req.tasks);
    if (parsed.status !== "valid" || !parsed.prediction) throw new PamAnswerError(`PAM 답이 계약에 맞지 않음(대기와 다름): ${parsed.errors.join("; ") || "이유 없음"}`);
    return parsed.prediction;
  }

  async reflect(r: Omit<PamReflectRequest, "contract">, kind: "list" | "fsm", call: CallOptions = {}): Promise<PamMemory> {
    assertTextOnly(r);
    const req = reflectRequest({ contract: PAM_REFLECT, ...r });
    const built = buildReflectMessages(req);
    assertTextOnly(built.messages);
    const raw = await this.llm.complete(built.messages, built.generation, "reflector", this.o.settings.timeoutMs, call);
    const parsed = parseMemory(raw, req.memory_kind);
    if (!parsed.ok) throw new PamAnswerError(`PAM 반성 실패: ${parsed.error}`);
    return validateMemory(parsed.memory, kind);
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
    return this.pam.predict({ final_time: input.finalTime, observation_text: input.text, memory_kind: input.memoryKind, memory: input.memory, tasks: input.tasks });
  }
}
