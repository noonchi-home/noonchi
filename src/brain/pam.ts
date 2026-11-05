// 박석준 PAM(2026-SWE/ai)을 HTTP로 부르는 판단 모델. 계약은 docs/pam-interface.md에 있다.
// 요청: 한 카메라 사진 5장(2초 간격, 시간대 있는 시각) + 기억(fsm) + 작업 목록 + 장면 밖 근거(evidence).
// 답: PAM parse_prediction 결과 모양 {status, raw_response, prediction, selected_action, errors}.
// 받은 답은 우리 쪽에서 원문(raw_response)부터 다시 검사한다. invalid는 대기(-1)와 구분해 판단 실패로 둔다.

import { fetchRetry } from "../server/net.js";
import {
  ContractError, checkInput, parsePrediction, type DecisionEvidence, type DecisionInput, type DecisionModel, type Prediction,
} from "./decision.js";

export const PAM_CONTRACT = "pam-predict/1";

export interface PamImage { mime_type: "image/jpeg"; base64: string }

export interface PamRequest {
  contract: typeof PAM_CONTRACT;
  camera: "single";
  final_frame_time: string;
  frames: { timestamp: string; image: PamImage }[];
  memory_kind: "list" | "fsm";
  memory: DecisionInput["memory"];
  tasks: string[];
  evidence: (Omit<DecisionEvidence, "jpeg"> & { image: PamImage | null })[];
}

export interface PamResponse {
  status: "valid" | "invalid";
  raw_response: string;
  prediction: Prediction | null;
  selected_action: string | null;
  errors: string[];
}

const image = (jpeg: Buffer): PamImage => ({ mime_type: "image/jpeg", base64: jpeg.toString("base64") });

/** 판단 입력 → PAM 요청 본문. 입력 규칙(사진 5장·2초 간격·시간대·기억 모양)은 보내기 전에 검사한다. */
export function buildPamRequest(input: DecisionInput): PamRequest {
  checkInput(input);
  const frames = input.frames.map((f, i) => {
    if (!f.jpeg) throw new ContractError(`frames[${i}]: 사진(jpeg)이 없습니다`);
    return { timestamp: f.timestamp, image: image(f.jpeg) };
  });
  return {
    contract: PAM_CONTRACT, camera: "single", final_frame_time: input.frames.at(-1)!.timestamp, frames,
    memory_kind: input.memoryKind, memory: input.memory, tasks: input.tasks,
    evidence: (input.evidence ?? []).map(({ jpeg, ...rest }) => ({ ...rest, image: jpeg ? image(jpeg) : null })),
  };
}

/** PAM 답을 검사한다: 모양, 원문 다시 파싱, prediction·selected_action이 원문과 같은지. */
export function checkPamResponse(body: unknown, tasks: string[]): Prediction {
  if (typeof body !== "object" || body === null) throw new ContractError("PAM 답: 객체가 아닙니다");
  const r = body as Partial<PamResponse>;
  if (typeof r.raw_response !== "string") throw new ContractError("PAM 답: raw_response가 없습니다");
  if (r.status === "invalid") throw new ContractError(`PAM 답이 계약에 맞지 않음(대기와 다름): ${(r.errors ?? []).join("; ") || "이유 없음"}`);
  if (r.status !== "valid") throw new ContractError("PAM 답: status는 valid 또는 invalid여야 합니다");
  const again = parsePrediction(r.raw_response, tasks);
  if (again.status !== "valid" || !again.prediction) throw new ContractError(`PAM 원문이 우리 검사에서 틀림: ${again.errors.join("; ")}`);
  const p = r.prediction;
  const same = !!p && p.observation === again.prediction.observation && p.reasoning === again.prediction.reasoning
    && p.task_index === again.prediction.task_index && again.selected_action === (r.selected_action ?? null);
  if (!same) throw new ContractError("PAM 답: prediction·selected_action이 원문과 다릅니다");
  return again.prediction;
}

export interface PamDecisionOptions {
  /** PAM 예측 주소(예: http://127.0.0.1:8300/predict). 없으면 decide가 실패한다. */
  url?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class PamDecision implements DecisionModel {
  readonly name = "pam";

  constructor(private readonly opts: PamDecisionOptions = {}) {}

  async decide(input: DecisionInput): Promise<Prediction> {
    if (!this.opts.url) throw new ContractError("PAM_URL이 없어 PAM을 부를 수 없습니다");
    const body = buildPamRequest(input);
    const res = await fetchRetry(this.opts.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
      body: JSON.stringify(body),
    }, { fetchImpl: this.opts.fetchImpl });
    if (!res.ok) throw new ContractError(`PAM HTTP ${res.status}`);
    return checkPamResponse(await res.json(), input.tasks);
  }
}
