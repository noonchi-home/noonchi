// PAM(서버 안 함수, src/brain/pam/) ↔ PAM LLM: 판단·반성 요청 값, 답 검사, invalid·틀린 답(PamAnswerError), 계약 밖 요청(PamRequestError),
// 연결 실패·HTTP 오류·시간 초과(PamLinkError), 문맥 길이(PamBudgetError), 입력 한도.
import { afterEach, describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY, CUP_TASKS, ContractError, validateMemory, type DecisionInput } from "../src/brain/decision.js";
import { PamAnswerError, PamBudgetError, PamClient, PamDecision, PamLinkError, PamRequestError, pamSettings } from "../src/brain/pam/index.js";
import { pamClientFor, startFakePamLlm, type FakePamLlm } from "./helpers/pam.js";
import { candidateFsmOf } from "../src/brain/pam/adopt.js";

let pam: FakePamLlm | undefined;
afterEach(async () => { await pam?.close(); pam = undefined; });

const input = (over: Partial<DecisionInput> = {}): DecisionInput => ({
  text: "21:00:00 사람 보임\n21:00:04 사람 안 보임", finalTime: "2026-11-07T21:00:08.000+09:00",
  memory: CUP_FSM_MEMORY, memoryKind: "fsm", tasks: [...CUP_TASKS], facts: { contents: "unknown" }, ...over,
});
const predictArgs = () => ({ final_time: "2026-11-07T21:00:08.000+09:00", observation_text: "t", memory_kind: "fsm" as const, memory: CUP_FSM_MEMORY, tasks: [...CUP_TASKS], last_state: null });
const reflectArgs = { day: "2026-11-07", memory_kind: "fsm_candidates" as const, memory: candidateFsmOf(CUP_FSM_MEMORY), observation_text: "07:58:02 사람 보임", action_summary: "08:10:40 컵 치우기 부탁", feedback: null };

describe("컵 FSM 기억", () => {
  it("PAM fsm 기억 모양이다", () => {
    expect(() => validateMemory(CUP_FSM_MEMORY, "fsm")).not.toThrow();
  });
});

describe("PamDecision ↔ PAM LLM", () => {
  it("관찰 텍스트·최종 시각·기억·작업 목록을 판단 메시지로 보낸다", async () => {
    pam = await startFakePamLlm({ predict: () => ({ observation: "o", reasoning: "r", state: "away", from: "drinking", next_index: 0 }) });
    const p = await new PamDecision(pamClientFor(pam)).decide(input());
    // 화살표(마시는 중 → 떠남)의 행동(seed는 묻기)을 서버가 행동 번호로 만든다
    expect(p).toEqual({ observation: "o", reasoning: "r", task_index: CUP_TASKS.indexOf("사용자에게 물어보기"), state: "away", from: "drinking", next_index: 0 });
    expect(pam.calls).toEqual(["predict"]);
    expect(pam.bodies[0]).toEqual({
      role: "predict", final_time: "2026-11-07T21:00:08+09:00", observation_text: "21:00:00 사람 보임\n21:00:04 사람 안 보임",
      memory_kind: "fsm", memory: CUP_FSM_MEMORY, tasks: [...CUP_TASKS], last_state: null,
    });
  });

  it("보내기 전에 입력을 검사한다: 빈 관찰 텍스트·시간대 없는 시각·틀린 기억은 보내지 않는다", async () => {
    pam = await startFakePamLlm();
    const d = new PamDecision(pamClientFor(pam));
    await expect(d.decide(input({ text: " " }))).rejects.toThrow(ContractError);
    await expect(d.decide(input({ finalTime: "2026-11-07T21:00:08" }))).rejects.toThrow(/시간대/);
    await expect(d.decide(input({ memory: { rules: [] }, memoryKind: "fsm" }))).rejects.toThrow(ContractError);
    expect(pam.requests).toHaveLength(0);
  });

  it("PAM 답이 틀리면(invalid) 대기와 구분해 판단 실패(PamAnswerError)", async () => {
    pam = await startFakePamLlm({ predict: () => "```json {}```" });
    const e = await new PamDecision(pamClientFor(pam)).decide(input()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PamAnswerError);
    expect(String(e)).toMatch(/대기와 다름/);
  });
});

describe("PamClient 답 검사", () => {
  it("칸이 더 있거나 화살표 번호가 범위 밖인 답은 PamAnswerError", async () => {
    pam = await startFakePamLlm({ predict: () => JSON.stringify({ observation: "o", reasoning: "r", state: "away", from: null, next_index: -1, task_index: 0 }) });
    await expect(pamClientFor(pam).predict(predictArgs())).rejects.toBeInstanceOf(PamAnswerError);
    await pam.close();
    pam = await startFakePamLlm({ predict: () => ({ observation: "o", reasoning: "r", state: "away", from: "drinking", next_index: 9 }) });
    await expect(pamClientFor(pam).predict(predictArgs())).rejects.toThrow(/state 'drinking' has 2 transitions/);
  });

  it("계약 밖 요청은 PamRequestError이고 LLM에 보내지 않는다", async () => {
    pam = await startFakePamLlm();
    const c = pamClientFor(pam);
    await expect(c.predict({ ...predictArgs(), tasks: [] })).rejects.toBeInstanceOf(PamRequestError);
    await expect(c.predict({ ...predictArgs(), observation_text: "가".repeat(20_001) })).rejects.toBeInstanceOf(PamRequestError);
    await expect(c.reflect({ ...reflectArgs, day: "2026-13-01" }, "fsm_candidates")).rejects.toBeInstanceOf(PamRequestError);
    expect(pam.requests).toHaveLength(0);
  });
});

describe("연결 실패와 형식 오류", () => {
  it("닿지 않는 주소는 PamLinkError", async () => {
    const e = await pamClientFor({ url: "http://127.0.0.1:9/v1" }).predict(predictArgs()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PamLinkError);
  });

  it("LLM HTTP 오류는 PamLinkError, 문맥 길이를 넘으면 보내지 않고 PamBudgetError", async () => {
    pam = await startFakePamLlm({ status: { predict: 502 } });
    await expect(pamClientFor(pam).predict(predictArgs())).rejects.toBeInstanceOf(PamLinkError);
    await pam.close();
    pam = await startFakePamLlm();
    const over = await pamClientFor(pam).reflect({ ...reflectArgs, observation_text: "가".repeat(90_000) }, "fsm_candidates").catch((x: unknown) => x);
    expect(over).toBeInstanceOf(PamBudgetError);
    expect(over).toBeInstanceOf(ContractError);
    expect(over).not.toBeInstanceOf(PamLinkError);
    expect(String(over)).toMatch(/문맥 길이/);
    expect(pam.requests).toHaveLength(0);
  });

  it("답이 늦으면 시간 초과로 PamLinkError", async () => {
    // 답하지 않는 LLM: 소켓 없이 신호(abort)만 기다린다(전체 시험 중 부하에도 흔들리지 않게)
    const hang: typeof fetch = (_url, init) => new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)));
    await expect(pamClientFor({ url: "http://pam.invalid/v1" }, { timeoutMs: 200, fetchImpl: hang }).predict(predictArgs())).rejects.toBeInstanceOf(PamLinkError);
  });
});

describe("반성과 입력 한도", () => {
  it("반성 메시지로 보내고 고친 기억을 검사해 돌려준다", async () => {
    pam = await startFakePamLlm();
    const m = await pamClientFor(pam).reflect(reflectArgs, "fsm_candidates");
    expect(m).toEqual(candidateFsmOf(CUP_FSM_MEMORY));
    expect(pam.bodies[0]).toMatchObject({ role: "reflect", memory_kind: "fsm_candidates", memory: candidateFsmOf(CUP_FSM_MEMORY), action_summary: "08:10:40 컵 치우기 부탁", feedback: null });
  });

  it("반성 답이 기억 모양이 아니면 PamAnswerError", async () => {
    pam = await startFakePamLlm({ reflect: () => "not json" });
    await expect(pamClientFor(pam).reflect(reflectArgs, "fsm_candidates")).rejects.toThrow(/PAM 반성 실패/);
  });

  it("limits()는 문맥 길이(PAM_MAX_MODEL_LEN)에서 판단·반성 입력 한도를 센다", async () => {
    const big = await new PamClient({ settings: pamSettings({ INFERENCE_MODE: "vllm" }) }).limits();
    const small = await new PamClient({ settings: pamSettings({ INFERENCE_MODE: "vllm", PAM_MAX_MODEL_LEN: "20000" }) }).limits();
    expect(big.max_model_len).toBe(32768);
    expect(small.max_model_len).toBe(20000);
    expect(small.reflect_input_bytes).toBeGreaterThan(0);
    expect(small.reflect_input_bytes).toBeLessThan(big.reflect_input_bytes);
    expect(big.predict_input_bytes).toBeGreaterThan(big.reflect_input_bytes);
  });
});
