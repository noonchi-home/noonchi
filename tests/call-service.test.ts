// 외부 연락(전화 에이전트 자리): 에이전트 도구 call_service(AS센터 전화·보호자 연락)는 늘 실제 폰으로 승인을 먼저 묻고(답은 이번만),
// 승인되면 외부 API 통로(src/infer/call-service.ts)로 CALL_SERVICE_URL에 JSON을 보낸다. 주소가 없으면 부르지 않고 「전화 서비스가 아직 연결되지 않았어요.」.
// 결과(보냄·거절·연결 없음·실패)는 onService로 알린다(서버가 기록 DB·말풍선 카드에 남긴다, tests/call-service-home.test.ts).
// 모델 자리는 가짜 OpenAI 호환 서버, 전화 서비스 자리는 가짜 HTTP 서버(tests/helpers/call-service.ts)다.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Agent, type AgentEvent } from "../src/agent/agent.js";
import { ApprovalStore } from "../src/agent/approval.js";
import { Policy } from "../src/agent/policy.js";
import { AGENT_TOOLS, MCP_TOOLS } from "../src/agent/tools.js";
import type { ServiceCall, ServiceResult } from "../src/contract/service.js";
import { callServiceBody, callServiceFrom, type CallServiceClient } from "../src/infer/call-service.js";
import { ROOMS, makeHome } from "./helpers/home.js";
import { startFakeCallService } from "./helpers/call-service.js";
import { startFakeLlm, toolOutputs, type FakeLlm } from "./helpers/llm.js";

const BOTH = [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }];
const WASHER_CALL: ServiceCall = {
  kind: "as_center", to: "AS센터", device: { id: "washer_1", label: "세탁기", kind: "washer" }, problem: "탈수할 때 멈춤", errorCode: "UE", person: null,
};
const META = { id: "c1", approvedAt: "2026-11-17T01:00:00.000Z" };

describe("외부 연락 통로(src/infer/call-service.ts)", () => {
  it("CALL_SERVICE_URL이 없으면 통로가 없고, http(s) 주소가 아니면 시작하지 않는다", () => {
    expect(callServiceFrom({})).toBeNull();
    expect(callServiceFrom({ CALL_SERVICE_URL: "  " })).toBeNull();
    for (const bad of ["ftp://127.0.0.1/calls", "전화", "127.0.0.1:9000"]) expect(() => callServiceFrom({ CALL_SERVICE_URL: bad }), bad).toThrow(/CALL_SERVICE_URL/);
    expect(callServiceFrom({ CALL_SERVICE_URL: " http://127.0.0.1:9/calls " })?.url).toBe("http://127.0.0.1:9/calls");
  });

  it("승인한 연락 하나를 JSON으로 POST한다. 2xx면 보냄, 그 밖의 HTTP·연결 실패는 실패다", async () => {
    const fake = await startFakeCallService();
    const client = callServiceFrom({ CALL_SERVICE_URL: fake.url }, { id: "oneroom", name: "원룸" })!;
    try {
      expect(await client.send(WASHER_CALL, META)).toEqual({ ok: true, status: 200 });
      expect(fake.requests).toEqual([{
        method: "POST", path: "/calls", contentType: "application/json",
        body: {
          version: 1, id: "c1", kind: "as_center", to: "AS센터", home: { id: "oneroom", name: "원룸" },
          device: { id: "washer_1", label: "세탁기", kind: "washer" }, problem: "탈수할 때 멈춤", error_code: "UE", person: null, approved_at: "2026-11-17T01:00:00.000Z",
        },
      }]);
      fake.status = 503;
      expect(await client.send(WASHER_CALL, META)).toEqual({ ok: false, status: 503, error: "전화 서비스 HTTP 503" });
    } finally {
      await fake.close();
    }
    expect(await client.send(WASHER_CALL, META)).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it("docs/reference.md 「외부 연락」 요청 예시는 서버가 보내는 본문과 칸·값 모양이 같다(전화 서비스가 그대로 받아 구현한다)", () => {
    const md = readFileSync(new URL("../docs/reference.md", import.meta.url), "utf8");
    const section = md.slice(md.indexOf("### 외부 연락"));
    const blocks = [...section.matchAll(/```json\r?\n([\s\S]*?)```/g)].slice(0, 2).map((m) => JSON.parse(m[1]!) as Record<string, unknown>);
    expect(blocks).toHaveLength(2);
    const shape = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === null ? "null" : typeof x === "object" ? Object.keys(x as object).sort() : typeof x]));
    const asCenter = callServiceBody(WASHER_CALL, META, { id: "oneroom", name: "원룸" });
    expect(shape(blocks[0]!)).toEqual(shape(asCenter as unknown as Record<string, unknown>));
    const guardian = callServiceBody({ kind: "guardian", to: "딸", device: null, problem: null, errorCode: null, person: "넘어진 뒤 일어나지 못함" }, META, { id: "oneroom", name: "원룸" });
    expect(shape(blocks[1]!)).toEqual(shape(guardian as unknown as Record<string, unknown>));
    expect([blocks[0]!.kind, blocks[1]!.kind]).toEqual(["as_center", "guardian"]);
  });
});

describe("승인 정책: 외부 연락 대기", () => {
  it("외부 연락은 늘 묻고 승인을 기억하지 않는다. 대기는 가전 승인과 같은 시간 제한(5분)이고 실제 폰에서 가린 동안(pause)은 멈춘다", () => {
    let now = 0;
    const path = join(mkdtempSync(join(tmpdir(), "svc-ap-")), "approvals.json");
    const approvals = new ApprovalStore(path, () => "t");
    const policy = new Policy({ now: () => now, approvals });
    const a = policy.askService(WASHER_CALL);
    expect(a.reason).toBe("AS센터에 전화할까요?");
    expect(policy.services().map((p) => p.token)).toEqual([a.token]);
    expect(policy.pending()).toEqual([]);
    policy.pause(true);
    now += 10 * 60_000;
    policy.pause(false);
    expect(policy.services()).toHaveLength(1);
    now += 5 * 60_000;
    expect(policy.services()).toEqual([]);
    expect(policy.takeService(a.token)).toBeUndefined();
    const b = policy.askService({ ...WASHER_CALL, kind: "guardian", device: null, person: "넘어짐" });
    expect(b.reason).toBe("보호자에게 연락할까요?");
    expect(policy.takeService(b.token)?.call.kind).toBe("guardian");
    expect(policy.takeService(b.token)).toBeUndefined();
    expect(approvals.memory()).toEqual({ always: {} });
  });
});

describe("Agent + call_service(가짜 모델·가짜 전화 서비스)", () => {
  let llm: FakeLlm;
  beforeAll(async () => {
    llm = await startFakeLlm({
      "세탁기 AS 불러 줘": [
        [["call_service", { kind: "as_center", device_id: "washer_1", problem: "탈수할 때 멈춤", error_code: "UE", reason: "세탁기가 고장 나 AS센터 전화를 부탁해서" }]],
        "AS센터에 전화할지 폰에서 골라 주세요.",
      ],
      "보호자에게 연락해 줘": [
        [["call_service", { kind: "guardian", to: "딸", person: "거실에서 넘어진 뒤 일어나지 못함", reason: "보호자 연락을 부탁해서" }]],
        "보호자에게 연락할지 폰에서 골라 주세요.",
      ],
      "AS센터에 전화해 줘": [[["call_service", { kind: "as_center", reason: "AS센터 전화를 부탁해서" }]], "어느 가전이 고장 났나요?"],
      "보호자 불러 줘": [[["call_service", { kind: "guardian", reason: "보호자 연락을 부탁해서" }]], "어떤 상황인지 알려 주세요."],
      "전자레인지가 안 돼서 AS 불러 줘": [
        [["call_service", { kind: "as_center", device_id: "microwave_1", problem: "전자레인지가 데워지지 않음", reason: "전자레인지 고장으로 AS센터 전화를 부탁해서" }]],
        "전자레인지 AS센터에 전화할지 골라 주세요.",
      ],
    });
  });
  afterAll(async () => { await llm?.close(); });

  function serviceAgent(service: CallServiceClient | null) {
    const { hub } = makeHome();
    const approvals = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "svc-agent-")), "approvals.json"), () => "t");
    const policy = new Policy({ approvals });
    const results: ServiceResult[] = [];
    const events: AgentEvent[] = [];
    const agent = new Agent({ hub, policy, rooms: ROOMS, provider: llm.provider(), service, onService: (r) => results.push(r), onEvent: (e) => events.push(e) });
    return { agent, policy, approvals, results, events };
  }
  const sentFrom = () => {
    const from = llm.bodies().length;
    return () => llm.bodies().slice(from);
  };

  it("「세탁기 AS 불러 줘」 → 실제 폰 승인 대기 「세탁기: AS센터에 전화할까요?」(답 승인·거절), 모델에는 토큰 없이 승인 대기만. 승인하면 전화 서비스에 보내고 「AS센터에 전화를 요청했어요.」. 기억하지 않아 다음에 또 묻는다", async () => {
    const fake = await startFakeCallService();
    try {
      const { agent, approvals, results, events } = serviceAgent(callServiceFrom({ CALL_SERVICE_URL: fake.url })!);
      const bodies = sentFrom();
      const r = await agent.chat("phone", "세탁기 AS 불러 줘", { heard: true });
      expect(r.pendingConfirmations).toEqual([expect.objectContaining({ deviceId: "", deviceLabel: "세탁기", reason: "AS센터에 전화할까요?", service: "as_center", choices: BOTH })]);
      expect(r.pendingConfirmations[0]!.command).toBeUndefined();
      expect(r.actions).toEqual([expect.objectContaining({ tool: "call_service", ok: false, needsConfirmation: true })]);
      expect(r.actions[0]!.deviceId).toBeUndefined();
      expect(events.some((e) => e.event === "pending" && e.pending.service === "as_center")).toBe(true);
      const token = r.pendingConfirmations[0]!.token;
      expect(toolOutputs(bodies()[1])[0]).toMatchObject({ ok: false, pendingApproval: { reason: "AS센터에 전화할까요?" } });
      expect(JSON.stringify(bodies())).not.toContain(token);
      expect(fake.requests).toEqual([]);

      const c = await agent.confirm(token, "approve");
      expect(c).toMatchObject({ ok: true, reply: "AS센터에 전화를 요청했어요.", action: { tool: "call_service", ok: true } });
      expect(fake.requests).toHaveLength(1);
      expect(fake.requests[0]!.body).toMatchObject({
        kind: "as_center", to: "AS센터", device: { id: "washer_1", label: "세탁기", kind: "washer" }, problem: "탈수할 때 멈춤", error_code: "UE", person: null, home: null,
      });
      expect(results).toEqual([expect.objectContaining({ outcome: "sent", id: fake.requests[0]!.body.id, call: expect.objectContaining({ kind: "as_center" }) })]);
      expect(agent.pending("phone")).toEqual([]);
      expect((await agent.confirm(token, "approve")).ok).toBe(false);
      expect(fake.requests).toHaveLength(1);
      expect(approvals.memory()).toEqual({ always: {} });
      expect((await agent.chat("phone", "세탁기 AS 불러 줘", { heard: true })).pendingConfirmations).toHaveLength(1);
    } finally {
      await fake.close();
    }
  });

  it("거절·취소면 보내지 않는다: 「AS센터 전화는 하지 않을게요.」, 결과는 거절", async () => {
    const fake = await startFakeCallService();
    try {
      const { agent, results } = serviceAgent(callServiceFrom({ CALL_SERVICE_URL: fake.url })!);
      const t1 = (await agent.chat("phone", "세탁기 AS 불러 줘", { heard: true })).pendingConfirmations[0]!.token;
      expect(await agent.confirm(t1, "reject")).toMatchObject({ ok: false, reply: "AS센터 전화는 하지 않을게요." });
      const t2 = (await agent.chat("phone", "세탁기 AS 불러 줘", { heard: true })).pendingConfirmations[0]!.token;
      expect(agent.cancel(t2)).toEqual({ ok: true, reply: "AS센터 전화를 취소했어요." });
      const t3 = (await agent.chat("s", "세탁기 AS 불러 줘")).pendingConfirmations[0]!.token;
      expect((await agent.chat("s", "아니")).reply).toBe("AS센터 전화는 하지 않을게요.");
      expect(agent.pending()).toEqual([]);
      expect(fake.requests).toEqual([]);
      expect(results.map((x) => x.outcome)).toEqual(["refused", "refused", "refused"]);
      expect(t3).toBeTruthy();
    } finally {
      await fake.close();
    }
  });

  it("CALL_SERVICE_URL이 없으면 승인해도 부르지 않고 「전화 서비스가 아직 연결되지 않았어요.」, 결과는 연결 없음", async () => {
    const { agent, results } = serviceAgent(null);
    const r = await agent.chat("phone", "세탁기 AS 불러 줘", { heard: true });
    expect(r.pendingConfirmations[0]).toMatchObject({ reason: "AS센터에 전화할까요?" });
    const c = await agent.confirm(r.pendingConfirmations[0]!.token, "approve");
    expect(c).toMatchObject({ ok: false, reply: "전화 서비스가 아직 연결되지 않았어요." });
    expect(results.map((x) => x.outcome)).toEqual(["unconnected"]);
  });

  it("전화 서비스가 2xx로 답하지 않으면 「AS센터에 전화하지 못했어요.」, 결과는 실패(까닭 HTTP 500)", async () => {
    const fake = await startFakeCallService(500);
    try {
      const { agent, results } = serviceAgent(callServiceFrom({ CALL_SERVICE_URL: fake.url })!);
      const r = await agent.chat("phone", "세탁기 AS 불러 줘", { heard: true });
      expect(await agent.confirm(r.pendingConfirmations[0]!.token, "approve")).toMatchObject({ ok: false, reply: "AS센터에 전화하지 못했어요." });
      expect(fake.requests).toHaveLength(1);
      expect(results).toEqual([expect.objectContaining({ outcome: "failed", error: "전화 서비스 HTTP 500" })]);
    } finally {
      await fake.close();
    }
  });

  it("보호자 연락: 실제 폰에 「보호자에게 연락할까요?」(가전 이름 없음). 들은 말 승인(answerToken)으로 보내고 본문에 받는 이·사람 상태가 간다", async () => {
    const fake = await startFakeCallService();
    try {
      const { agent, results } = serviceAgent(callServiceFrom({ CALL_SERVICE_URL: fake.url })!);
      const r = await agent.chat("phone", "보호자에게 연락해 줘", { heard: true });
      expect(r.pendingConfirmations).toEqual([expect.objectContaining({ deviceId: "", deviceLabel: "", reason: "보호자에게 연락할까요?", service: "guardian", choices: BOTH })]);
      expect(await agent.answerToken(r.pendingConfirmations[0]!.token, "approve")).toEqual({ ok: true, reply: "보호자에게 연락을 요청했어요." });
      expect(fake.requests[0]!.body).toMatchObject({ kind: "guardian", to: "딸", device: null, problem: null, error_code: null, person: "거실에서 넘어진 뒤 일어나지 못함" });
      expect(results.map((x) => x.outcome)).toEqual(["sent"]);
    } finally {
      await fake.close();
    }
  });

  it("가전도 고장 설명도 없는 AS센터 전화, 사람 상태가 없는 보호자 연락은 묻지 않고 모델에게 까닭을 돌려준다", async () => {
    const { agent, results } = serviceAgent(null);
    for (const said of ["AS센터에 전화해 줘", "보호자 불러 줘"]) {
      const bodies = sentFrom();
      const r = await agent.chat("phone", said, { heard: true });
      expect(r.pendingConfirmations, said).toEqual([]);
      expect(r.actions[0], said).toMatchObject({ tool: "call_service", ok: false, error: expect.stringMatching(/device_id|problem|person/) });
      expect(toolOutputs(bodies()[1])[0], said).toMatchObject({ ok: false });
    }
    expect(results).toEqual([]);
  });

  it("위험 가전(전자레인지) AS 전화여도 실제 폰으로 가는 답은 정한 승인 질문이다(모델 글에 위험 가전 이름이 나와도)", async () => {
    const { agent } = serviceAgent(null);
    const r = await agent.chat("phone", "전자레인지가 안 돼서 AS 불러 줘", { heard: true });
    expect(r.pendingConfirmations).toEqual([expect.objectContaining({ deviceLabel: "전자레인지", reason: "AS센터에 전화할까요?" })]);
    expect(r.reply).toBe("AS센터에 전화할까요?");
  });

  it("call_service는 서버 안 에이전트에만 있다(MCP 목록에 없음). PAM 행동 목록(src/act/tasks.ts)에는 넣지 않는다", () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toContain("call_service");
    expect(MCP_TOOLS.map((t) => t.name)).not.toContain("call_service");
    expect(readFileSync(new URL("../src/act/tasks.ts", import.meta.url), "utf8")).not.toMatch(/call_service|AS센터|보호자/);
  });
});
