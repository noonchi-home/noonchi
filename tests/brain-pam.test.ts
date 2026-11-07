// PAM 서비스 연결(pam-predict/2·pam-reflect/2): 요청 본문, 원문 다시 검사, invalid·틀린 답, 연결 실패(PamLinkError)와 형식 오류(ContractError), 입력 한도.
import { afterEach, describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY, CUP_TASKS, ContractError, validateMemory, type DecisionInput } from "../src/brain/decision.js";
import { PamClient, PamDecision, PamLinkError } from "../src/brain/pam.js";
import { PAM_PREDICT, PAM_REFLECT } from "../src/contract/pam.js";
import { startFakePam, type FakePam } from "./helpers/pam.js";

let pam: FakePam | undefined;
afterEach(async () => { await pam?.close(); pam = undefined; });

const input = (over: Partial<DecisionInput> = {}): DecisionInput => ({
  text: "21:00:00 사람 보임\n21:00:04 사람 안 보임", finalTime: "2026-11-07T21:00:08.000+09:00",
  memory: CUP_FSM_MEMORY, memoryKind: "fsm", tasks: [...CUP_TASKS], facts: { contents: "unknown" }, ...over,
});
const predictArgs = () => ({ final_time: "2026-11-07T21:00:08.000+09:00", observation_text: "t", memory_kind: "fsm" as const, memory: CUP_FSM_MEMORY, tasks: [...CUP_TASKS] });

describe("컵 FSM 기억", () => {
  it("PAM fsm 기억 모양이다", () => {
    expect(() => validateMemory(CUP_FSM_MEMORY, "fsm")).not.toThrow();
  });
});

describe("PamDecision ↔ PAM 서비스", () => {
  it("관찰 텍스트·최종 시각·기억·작업 목록을 pam-predict/2로 보낸다", async () => {
    pam = await startFakePam({ predict: () => ({ observation: "o", reasoning: "r", task_index: 0 }) });
    const p = await new PamDecision(new PamClient({ url: pam.url })).decide(input());
    expect(p.task_index).toBe(0);
    expect(pam.paths).toEqual(["POST /predict"]);
    expect(pam.bodies[0]).toEqual({
      contract: PAM_PREDICT, final_time: "2026-11-07T21:00:08.000+09:00", observation_text: "21:00:00 사람 보임\n21:00:04 사람 안 보임",
      memory_kind: "fsm", memory: CUP_FSM_MEMORY, tasks: [...CUP_TASKS],
    });
  });

  it("보내기 전에 입력을 검사한다: 빈 관찰 텍스트·시간대 없는 시각·틀린 기억은 보내지 않는다", async () => {
    pam = await startFakePam();
    const d = new PamDecision(new PamClient({ url: pam.url }));
    await expect(d.decide(input({ text: " " }))).rejects.toThrow(ContractError);
    await expect(d.decide(input({ finalTime: "2026-11-07T21:00:08" }))).rejects.toThrow(/시간대/);
    await expect(d.decide(input({ memory: { rules: [] }, memoryKind: "fsm" }))).rejects.toThrow(ContractError);
    expect(pam.bodies).toHaveLength(0);
  });

  it("PAM 원문이 틀리면(invalid) 대기와 구분해 판단 실패", async () => {
    pam = await startFakePam({ predict: () => "```json {}```" });
    await expect(new PamDecision(new PamClient({ url: pam.url })).decide(input())).rejects.toThrow(/대기와 다름/);
  });
});

describe("PamClient 답 검사", () => {
  const reply = (body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  const raw = JSON.stringify({ observation: "o", reasoning: "r", task_index: 0 });
  const client = (fetchImpl: typeof fetch) => new PamClient({ url: "http://pam.invalid", fetchImpl });

  it("valid면 원문을 다시 검사한 예측(키 순서만 다른 같은 예측도 받는다)", async () => {
    const p = await client(reply({ status: "valid", raw_response: raw, prediction: { task_index: 0, reasoning: "r", observation: "o" }, selected_action: "컵 치우기", errors: [] })).predict(predictArgs());
    expect(p).toEqual({ observation: "o", reasoning: "r", task_index: 0 });
  });

  it("prediction·selected_action이 원문과 다르면 실패", async () => {
    await expect(client(reply({ status: "valid", raw_response: raw, prediction: { observation: "o", reasoning: "r", task_index: 1 }, selected_action: "사용자에게 물어보기", errors: [] })).predict(predictArgs()))
      .rejects.toThrow(/원문과 다릅니다/);
    await expect(client(reply({ status: "valid", raw_response: raw, prediction: JSON.parse(raw), selected_action: null, errors: [] })).predict(predictArgs()))
      .rejects.toThrow(/원문과 다릅니다/);
  });

  it("원문이 우리 검사에서 틀리면 실패", async () => {
    const bad = JSON.stringify({ observation: "o", reasoning: "r", task_index: 0, task_index2: 1 });
    await expect(client(reply({ status: "valid", raw_response: bad, prediction: { observation: "o", reasoning: "r", task_index: 0 }, selected_action: "컵 치우기", errors: [] })).predict(predictArgs()))
      .rejects.toThrow(/우리 검사/);
  });
});

describe("연결 실패와 형식 오류", () => {
  it("닿지 않는 주소는 PamLinkError", async () => {
    const e = await new PamClient({ url: "http://127.0.0.1:9" }).predict(predictArgs()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PamLinkError);
  });

  it("HTTP 5xx는 PamLinkError, 400·413은 ContractError", async () => {
    pam = await startFakePam({ status: { "/predict": 502 } });
    await expect(new PamClient({ url: pam.url }).predict(predictArgs())).rejects.toBeInstanceOf(PamLinkError);
    await pam.close();
    pam = await startFakePam({ status: { "/predict": 400, "/reflect": 413 } });
    const c = new PamClient({ url: pam.url });
    const bad400 = await c.predict(predictArgs()).catch((x: unknown) => x);
    expect(bad400).toBeInstanceOf(ContractError);
    expect(bad400).not.toBeInstanceOf(PamLinkError);
    const bad413 = await c.reflect({ day: "2026-11-07", memory_kind: "fsm", memory: CUP_FSM_MEMORY, observation_text: "t", action_summary: "a", feedback: null }, "fsm").catch((x: unknown) => x);
    expect(bad413).toBeInstanceOf(ContractError);
    expect(String(bad413)).toMatch(/문맥 길이/);
  });

  it("답이 늦으면 시간 초과로 PamLinkError", async () => {
    // 답하지 않는 PAM: 소켓 없이 신호(abort)만 기다린다(전체 시험 중 부하에도 흔들리지 않게)
    const hang: typeof fetch = (_url, init) => new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)));
    await expect(new PamClient({ url: "http://pam.invalid", timeoutMs: 200, fetchImpl: hang }).predict(predictArgs())).rejects.toBeInstanceOf(PamLinkError);
  });
});

describe("반성과 입력 한도", () => {
  it("pam-reflect/2로 보내고 고친 기억을 검사해 돌려준다", async () => {
    pam = await startFakePam();
    const m = await new PamClient({ url: pam.url }).reflect({ day: "2026-11-07", memory_kind: "fsm", memory: CUP_FSM_MEMORY, observation_text: "07:58:02 사람 보임", action_summary: "08:10:40 컵 치우기 부탁", feedback: null }, "fsm");
    expect(m).toEqual(CUP_FSM_MEMORY);
    expect(pam.bodies[0]).toMatchObject({ contract: PAM_REFLECT, day: "2026-11-07", feedback: null });
  });

  it("limits()는 /health의 입력 한도를 읽고, 없으면 ContractError", async () => {
    pam = await startFakePam();
    expect(await new PamClient({ url: pam.url }).limits()).toEqual({ max_model_len: 32768, predict_input_bytes: 80_000, reflect_input_bytes: 40_000 });
    await pam.close();
    pam = await startFakePam({ limits: null });
    await expect(new PamClient({ url: pam.url }).limits()).rejects.toBeInstanceOf(ContractError);
    await expect(new PamClient({ url: "http://127.0.0.1:9" }).limits()).rejects.toBeInstanceOf(PamLinkError);
  });
});
