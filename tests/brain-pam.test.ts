// PAM HTTP 연결 자리: 요청 본문, 모의 PAM 서버와 왕복, invalid·틀린 답·시간 초과.

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createMockPamServer } from "../scripts/pam-mock-server.js";
import { CUP_FSM_MEMORY, CUP_TASKS, ContractError, validateMemory, type DecisionInput } from "../src/brain/decision.js";
import { PAM_CONTRACT, PamDecision, buildPamRequest, checkPamResponse } from "../src/brain/pam.js";
import { listenRetry } from "../src/server/net.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const frames = () => [0, 2, 4, 6, 8].map((s) => ({ timestamp: `2026-11-04T21:00:0${s}.000+09:00`, jpeg: JPEG }));
const input = (over: Partial<DecisionInput> = {}): DecisionInput => ({
  frames: frames(), memory: CUP_FSM_MEMORY, memoryKind: "fsm", tasks: [...CUP_TASKS], facts: { contents: "unknown" }, ...over,
});
const answerPhoto = { kind: "cup_contents" as const, value: "empty" as const, certain: true, timestamp: "2026-11-04T21:00:07.400+09:00", source: "request_answer_photo" as const, jpeg: JPEG };

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

/** 이 PC는 127.0.0.1 listen·connect가 가끔 EFAULT로 실패해 다시 시도한다(src/server/net.ts). */
async function serve(s: Server): Promise<string> {
  server = s;
  const addr: AddressInfo = await listenRetry(s, 0, "127.0.0.1");
  return `http://127.0.0.1:${addr.port}/predict`;
}

describe("컵 FSM 기억", () => {
  it("PAM fsm 기억 모양이다", () => {
    expect(() => validateMemory(CUP_FSM_MEMORY, "fsm")).not.toThrow();
  });
});

describe("buildPamRequest", () => {
  it("한 카메라 사진 5장(base64)·fsm 기억·작업 목록·장면 밖 근거(답 사진)를 담는다", () => {
    const body = buildPamRequest(input({ evidence: [answerPhoto] }));
    expect(body).toMatchObject({ contract: PAM_CONTRACT, camera: "single", memory_kind: "fsm", tasks: [...CUP_TASKS], final_frame_time: "2026-11-04T21:00:08.000+09:00" });
    expect(body.frames).toHaveLength(5);
    expect(body.frames[0]!.image).toEqual({ mime_type: "image/jpeg", base64: JPEG.toString("base64") });
    expect(body.evidence[0]).toMatchObject({ kind: "cup_contents", value: "empty", source: "request_answer_photo", image: { mime_type: "image/jpeg" } });
    expect("jpeg" in body.evidence[0]!).toBe(false);
  });

  it("사진이 4장이거나 간격이 틀리면 보내기 전에 막는다", () => {
    expect(() => buildPamRequest(input({ frames: frames().slice(1) }))).toThrow(ContractError);
  });
});

describe("checkPamResponse", () => {
  const tasks = [...CUP_TASKS];
  const raw = JSON.stringify({ observation: "o", reasoning: "r", task_index: 0 });
  it("valid면 원문을 다시 검사한 예측", () => {
    expect(checkPamResponse({ status: "valid", raw_response: raw, prediction: JSON.parse(raw), selected_action: "컵 치우기", errors: [] }, tasks)).toMatchObject({ task_index: 0 });
  });
  it("invalid는 대기와 구분해 실패", () => {
    expect(() => checkPamResponse({ status: "invalid", raw_response: "```json", prediction: null, selected_action: null, errors: ["bad"] }, tasks)).toThrow(/대기와 다름/);
  });
  it("키 순서만 다른 같은 예측은 받는다", () => {
    expect(checkPamResponse({ status: "valid", raw_response: raw, prediction: { task_index: 0, reasoning: "r", observation: "o" }, selected_action: "컵 치우기", errors: [] }, tasks)).toMatchObject({ task_index: 0 });
  });
  it("prediction이 원문과 다르면 실패", () => {
    expect(() => checkPamResponse({ status: "valid", raw_response: raw, prediction: { observation: "o", reasoning: "r", task_index: 1 }, selected_action: "사용자에게 물어보기", errors: [] }, tasks)).toThrow(/원문과 다릅니다/);
  });
});

describe("PamDecision ↔ 모의 PAM 서버", () => {
  it("답 사진 근거가 빈 컵이면 컵 치우기", async () => {
    const url = await serve(createMockPamServer());
    const p = await new PamDecision({ url }).decide(input({ evidence: [answerPhoto] }));
    expect(p.task_index).toBe(0);
  });

  it("근거가 없으면 사용자에게 물어보기", async () => {
    const url = await serve(createMockPamServer());
    expect((await new PamDecision({ url }).decide(input())).task_index).toBe(1);
  });

  it("PAM 원문이 틀리면(invalid) 판단 실패", async () => {
    const url = await serve(createMockPamServer({ answer: () => "```json {}```" }));
    await expect(new PamDecision({ url }).decide(input())).rejects.toThrow(/대기와 다름/);
  });

  it("PAM_URL이 없으면 실패", async () => {
    await expect(new PamDecision().decide(input())).rejects.toThrow(/PAM_URL/);
  });

  it("답이 늦으면 시간 초과로 실패", async () => {
    // 답하지 않는 PAM: 소켓 없이 신호(abort)만 기다린다(전체 시험 중 부하에도 흔들리지 않게)
    const hang: typeof fetch = (_url, init) => new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)));
    await expect(new PamDecision({ url: "http://pam.invalid/predict", timeoutMs: 200, fetchImpl: hang }).decide(input())).rejects.toThrow();
  });
});
