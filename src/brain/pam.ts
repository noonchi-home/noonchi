// PAM 서비스(services/pam/)를 HTTP로 부르는 어댑터. 계약은 docs/pam-interface.md(pam-predict/2·pam-reflect/2, 사진 칸 없음).
// 받은 답은 우리 쪽에서 원문(raw_response)부터 다시 검사한다. invalid는 대기(-1)와 구분해 판단 실패로 둔다.
// 연결 실패·5xx 등은 PamLinkError(PAM 연결 끊김), 우리 요청이 계약에 맞지 않음(400)·문맥 길이 넘음(413)·답 형식 오류는 ContractError.
import type { PamPredictContract, PamPredictRequest, PamPredictResponse, PamReflectContract, PamReflectRequest, PamReflectResponse, Prediction } from "../contract/pam.js";
import { fetchRetry } from "../shared/net.js";
import { ContractError, checkInput, parsePrediction, validateMemory, type DecisionInput, type DecisionModel, type PamMemory } from "./decision.js";

export const PAM_PREDICT: PamPredictContract = "pam-predict/2";
export const PAM_REFLECT: PamReflectContract = "pam-reflect/2";

const IMAGE_KEY = /^(image|images|frames|image_url|base64|jpeg|png)$/i;

/** 어느 깊이든 사진 칸이나 data:image 값이 있으면 막는다. */
export function assertTextOnly(body: unknown, path = "body"): void {
  if (typeof body === "string") {
    if (/data:image\//i.test(body)) throw new ContractError(`${path}: PAM에는 사진을 넘기지 않습니다`);
    return;
  }
  if (Array.isArray(body)) {
    body.forEach((v, i) => assertTextOnly(v, `${path}[${i}]`));
    return;
  }
  if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body)) {
      if (IMAGE_KEY.test(k)) throw new ContractError(`${path}.${k}: PAM에는 사진을 넘기지 않습니다`);
      assertTextOnly(v, `${path}.${k}`);
    }
  }
}

/** PAM 서비스에 닿지 않거나 HTTP 오류(5xx 등). 답 형식 오류(ContractError)와 나눠 연결 끊김으로 기록한다. */
export class PamLinkError extends Error {}
export interface PamLimits { max_model_len: number; predict_input_bytes: number; reflect_input_bytes: number }

export class PamClient {
  constructor(private readonly o: { url: string; timeoutMs?: number; fetchImpl?: typeof fetch }) {}

  private async send(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    let res: Response;
    try {
      res = await fetchRetry(`${this.o.url}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) }, { fetchImpl: this.o.fetchImpl });
    } catch (e) {
      throw new PamLinkError(`PAM 연결 실패: ${(e as Error).message}`);
    }
    if (res.status === 400) throw new ContractError(`PAM이 요청을 거절함(계약에 맞지 않음): ${await res.text()}`);
    if (res.status === 413) throw new ContractError(`PAM 입력이 문맥 길이를 넘음: ${await res.text()}`);
    if (!res.ok) {
      await res.body?.cancel();
      throw new PamLinkError(`PAM HTTP ${res.status}`);
    }
    return res;
  }

  private async post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
    assertTextOnly(body);
    const res = await this.send(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);
    try {
      return (await res.json()) as T;
    } catch {
      throw new ContractError("PAM 답이 JSON이 아닙니다");
    }
  }

  /** GET {url}/health의 입력 한도(판단·반성에 넣을 수 있는 UTF-8 바이트). */
  async limits(): Promise<PamLimits> {
    const res = await this.send("/health", {}, 5000);
    const b = (await res.json()) as { limits?: PamLimits };
    if (!b.limits || !(b.limits.reflect_input_bytes > 0) || !(b.limits.predict_input_bytes > 0)) throw new ContractError("PAM /health에 입력 한도가 없습니다");
    return b.limits;
  }

  async predict(r: Omit<PamPredictRequest, "contract">): Promise<Prediction> {
    const body: PamPredictRequest = { contract: PAM_PREDICT, ...r };
    const res = await this.post<PamPredictResponse>("/predict", body, this.o.timeoutMs ?? 30_000);
    if (res.status === "invalid") throw new ContractError(`PAM 답이 계약에 맞지 않음(대기와 다름): ${res.errors?.join("; ") || "이유 없음"}`);
    if (res.status !== "valid" || typeof res.raw_response !== "string") throw new ContractError("PAM 답: status·raw_response가 계약 모양이 아닙니다");
    const again = parsePrediction(res.raw_response, r.tasks);
    if (again.status !== "valid" || !again.prediction) throw new ContractError(`PAM 원문이 우리 검사에서 틀림: ${again.errors.join("; ")}`);
    const p = res.prediction;
    if (!p || p.task_index !== again.prediction.task_index || p.observation !== again.prediction.observation || p.reasoning !== again.prediction.reasoning
      || (res.selected_action ?? null) !== again.selected_action) throw new ContractError("PAM 답: prediction·selected_action이 원문과 다릅니다");
    return again.prediction;
  }

  async reflect(r: Omit<PamReflectRequest, "contract">, kind: "list" | "fsm"): Promise<PamMemory> {
    const res = await this.post<PamReflectResponse>("/reflect", { contract: PAM_REFLECT, ...r }, 300_000);
    if (res.status !== "valid" || !res.memory) throw new ContractError(`PAM 반성 실패: ${res.errors?.join("; ") || "이유 없음"}`);
    return validateMemory(res.memory, kind);
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
