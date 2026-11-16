// 서버의 외부 연락 연결(src/server/home.ts): 실제 폰 말 「세탁기 AS 불러 줘」 → 에이전트 call_service → 실제 폰 승인 질문 → 답 →
// 전화 서비스(CALL_SERVICE_URL, 가짜 HTTP 서버) → 실제 폰 답·대시보드 말풍선 카드·기록 DB service 줄. 주소가 없으면 부르지 않고 연결 없음으로 남긴다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startServer, type RunningServer } from "../src/server/start.js";
import { startFakeCallService, type FakeCallService } from "./helpers/call-service.js";
import { startFakeLlm, type FakeLlm } from "./helpers/llm.js";
import { openPhone, openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
const BOTH = [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }];
/** 서버를 띄우고 소켓을 여는 시험 하나의 한도. */
const SLOW = 20_000;

let llm: FakeLlm;
beforeAll(async () => {
  llm = await startFakeLlm({
    "세탁기 AS 불러 줘": [
      [["call_service", { kind: "as_center", device_id: "washer_1", problem: "탈수할 때 멈춤", error_code: "UE", reason: "세탁기가 고장 나 AS센터 전화를 부탁해서" }]],
      "AS센터에 전화할지 폰에서 골라 주세요.",
    ],
  });
});
afterAll(async () => { await llm?.close(); });

let srv: RunningServer | undefined;
let fake: FakeCallService | undefined;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await srv?.close();
  srv = undefined;
  await fake?.close();
  fake = undefined;
});

async function listen(url: string) {
  const messages: Msg[] = [];
  const ws = await (url.includes("/phone/events") ? openPhone : openWebSocket)(url, { setup: (s) => s.on("message", (d, bin) => { if (!bin) messages.push(JSON.parse(String(d)) as Msg); }) });
  sockets.push(ws);
  const waitFor = async (pred: (m: Msg) => boolean, what: string, ms = 5000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) {
      const m = messages.find(pred);
      if (m) return m;
    }
    throw new Error(`시간 초과: ${what} · ${JSON.stringify(messages.slice(-4))}`);
  };
  return { ws, messages, waitFor };
}

/** 원룸(세탁기 washer_1) 서버와 대시보드·실제 폰 소켓. 폰이 「세탁기 AS 불러 줘」라고 말하고 승인 질문을 받을 때까지. */
async function asked(extra: Record<string, string>) {
  srv = await startServer({
    env: { HUB: "memory", PORT: "0", ...llm.env, HOME_ID: "oneroom", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-svc-")), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", ...extra },
    log: () => {},
  });
  const dash = await listen(`${srv.url.replace(/^http/, "ws")}/events`);
  const phoneUrl = new URL(srv.phoneUrls[0]!);
  const phone = await listen(`ws://${phoneUrl.host}/phone/events`);
  phone.ws.send(JSON.stringify({ type: "say", text: "세탁기 AS 불러 줘" }));
  const reply = await phone.waitFor((m) => m.type === "reply" && Array.isArray(m.pending) && m.pending.length > 0, "승인 질문");
  expect(reply.pending).toEqual([{ token: expect.any(String), deviceLabel: "세탁기", reason: "AS센터에 전화할까요?", choices: BOTH }]);
  return { dash, phone, token: reply.pending[0].token as string };
}

describe("서버: 실제 폰 말 → 외부 연락 승인 → 전화 서비스 → 기록 DB·말풍선 카드", () => {
  it("승인하면 전화 서비스에 보내고(집 id·이름 포함) 실제 폰 답과 대시보드 말풍선 카드가 「AS센터에 전화를 요청했어요.」, 기록 DB에 service 줄(보냄)", async () => {
    fake = await startFakeCallService();
    const { dash, phone, token } = await asked({ CALL_SERVICE_URL: fake.url });
    expect(fake.requests).toEqual([]);
    phone.ws.send(JSON.stringify({ type: "confirm", token, choice: "approve" }));
    await phone.waitFor((m) => m.type === "reply" && m.text === "AS센터에 전화를 요청했어요.", "폰 답");
    expect(fake.requests).toHaveLength(1);
    const body = fake.requests[0]!.body;
    expect(body).toMatchObject({ version: 1, kind: "as_center", home: { id: "oneroom", name: "원룸 예시 (테스트용)" }, device: { id: "washer_1", label: "세탁기", kind: "washer" }, error_code: "UE" });
    await dash.waitFor((m) => m.type === "say" && m.text === "AS센터에 전화를 요청했어요.", "말풍선 카드");
    expect(srv!.history.list({ kinds: ["service"] })).toEqual([expect.objectContaining({
      kind: "service", subject: "washer_1", text: "세탁기 AS센터 전화 · 보냄",
      data: expect.objectContaining({ id: body.id, kind: "as_center", outcome: "sent", to: "AS센터", device: { id: "washer_1", label: "세탁기", kind: "washer" }, problem: "탈수할 때 멈춤", error_code: "UE" }),
    })]);
  }, SLOW);

  it("CALL_SERVICE_URL이 없으면 승인해도 부르지 않고, 실제 폰 답·말풍선 카드가 「전화 서비스가 아직 연결되지 않았어요.」, 기록 DB에 연결 없음", async () => {
    const { dash, phone, token } = await asked({});
    phone.ws.send(JSON.stringify({ type: "confirm", token, choice: "approve" }));
    await phone.waitFor((m) => m.type === "reply" && m.text === "전화 서비스가 아직 연결되지 않았어요.", "폰 답");
    await dash.waitFor((m) => m.type === "say" && m.text === "전화 서비스가 아직 연결되지 않았어요.", "말풍선 카드");
    expect(srv!.history.list({ kinds: ["service"] }).map((r) => [r.text, (r.data as Msg).outcome])).toEqual([["세탁기 AS센터 전화 · 연결 없음", "unconnected"]]);
  }, SLOW);

  it("거절이면 보내지 않고 기록 DB에 거절만 남긴다. 대시보드 말풍선 카드에는 승인 답을 보이지 않는다", async () => {
    fake = await startFakeCallService();
    const { dash, phone, token } = await asked({ CALL_SERVICE_URL: fake.url });
    phone.ws.send(JSON.stringify({ type: "confirm", token, choice: "reject" }));
    await phone.waitFor((m) => m.type === "reply" && m.text === "AS센터 전화는 하지 않을게요.", "폰 답");
    expect(fake.requests).toEqual([]);
    expect(srv!.history.list({ kinds: ["service"] }).map((r) => [r.text, (r.data as Msg).outcome])).toEqual([["세탁기 AS센터 전화 · 거절", "refused"]]);
    await new Promise((r) => setTimeout(r, 1200));
    expect(dash.messages.filter((m) => m.type === "say").map((m) => m.text)).not.toContain("AS센터 전화는 하지 않을게요.");
  }, SLOW);
});
