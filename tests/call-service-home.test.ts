// 서버의 외부 연락 연결(src/server/home.ts): 실제 폰 말 「세탁기 AS 불러 줘」 → 에이전트 call_service → 실제 폰 승인 질문 → 답 →
// 전화 서비스(CALL_SERVICE_URL, 가짜 HTTP 서버) → 실제 폰 답·대시보드 말풍선 카드·기록 DB service 줄. 주소가 없으면 부르지 않고 연결 없음으로 남긴다.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startServer, type RunningServer } from "../src/server/start.js";
import { HEARD_MARK } from "../src/world/labels.js";
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

/** 원룸 서버를 띄우고 대시보드·실제 폰 소켓을 연다. contacts: 서버에 등록한 받는 이(RUNTIME_DIR/homes/oneroom/contacts.json, undefined면 파일 없음). */
async function home(extra: Record<string, string>, contacts?: unknown) {
  const runtime = mkdtempSync(join(tmpdir(), "rt-svc-"));
  if (contacts !== undefined) {
    mkdirSync(join(runtime, "homes", "oneroom"), { recursive: true });
    writeFileSync(join(runtime, "homes", "oneroom", "contacts.json"), JSON.stringify(contacts));
  }
  srv = await startServer({
    env: { HUB: "memory", PORT: "0", ...llm.env, HOME_ID: "oneroom", RUNTIME_DIR: runtime, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", ...extra },
    log: () => {},
  });
  const dash = await listen(`${srv.url.replace(/^http/, "ws")}/events`);
  const phoneUrl = new URL(srv.phoneUrls[0]!);
  const phone = await listen(`ws://${phoneUrl.host}/phone/events`);
  return { runtime, dash, phone };
}

/** 등록한 AS센터(기본 「AS센터」)로 폰이 「세탁기 AS 불러 줘」라고 말하고 승인 질문을 받을 때까지. ask: 실제 폰 승인 줄(받는 이·보낼 내용). */
async function asked(extra: Record<string, string>, contacts: unknown = { as_center: { name: "AS센터", phone: "1588-0000" } }, ask = "탈수할 때 멈춤 · 에러 UE. AS센터에 전화할까요?") {
  const { runtime, dash, phone } = await home(extra, contacts);
  phone.ws.send(JSON.stringify({ type: "say", text: "세탁기 AS 불러 줘" }));
  const reply = await phone.waitFor((m) => m.type === "reply" && Array.isArray(m.pending) && m.pending.length > 0, "승인 질문");
  expect(reply.pending).toEqual([{ token: expect.any(String), deviceLabel: "세탁기", reason: ask, choices: BOTH }]);
  return { runtime, dash, phone, token: reply.pending[0].token as string };
}

describe("서버: 실제 폰 말 → 외부 연락 승인 → 전화 서비스 → 기록 DB·말풍선 카드", () => {
  it("등록한 받는 이로 묻고, 승인하면 전화 서비스에 보내고(집 id·이름 포함) 실제 폰 답과 대시보드 말풍선 카드가 「AS센터에 전화를 요청했어요.」, 기록 DB에 service 줄(보냄, 받는 이·내용은 가림)", async () => {
    fake = await startFakeCallService();
    const to = { name: "LG전자 서비스센터", phone: "1544-7777" };
    const { dash, phone, token } = await asked({ CALL_SERVICE_URL: fake.url }, { as_center: to }, "탈수할 때 멈춤 · 에러 UE. LG전자 서비스센터에 전화할까요?");
    expect(fake.requests).toEqual([]);
    phone.ws.send(JSON.stringify({ type: "confirm", token, choice: "approve" }));
    await phone.waitFor((m) => m.type === "reply" && m.text === "AS센터에 전화를 요청했어요.", "폰 답");
    expect(fake.requests).toHaveLength(1);
    const body = fake.requests[0]!.body;
    expect(body).toMatchObject({ version: 1, kind: "as_center", to, home: { id: "oneroom", name: "원룸 예시 (테스트용)" }, device: { id: "washer_1", label: "세탁기", kind: "washer" }, error_code: "UE" });
    await dash.waitFor((m) => m.type === "say" && m.text === "AS센터에 전화를 요청했어요.", "말풍선 카드");
    const rows = srv!.history.list({ kinds: ["service"] });
    expect(rows).toEqual([expect.objectContaining({
      kind: "service", subject: "washer_1", text: "세탁기 AS센터 전화 · 보냄",
      data: { id: body.id, kind: "as_center", outcome: "sent", device: { id: "washer_1", label: "세탁기", kind: "washer" }, detail: HEARD_MARK },
    })]);
    expect(JSON.stringify(rows)).not.toMatch(/탈수|UE|1544|LG전자/);
    // 대시보드 /events 사본에는 받는 이·보낼 내용이 없다(실제 폰 승인 질문에는 있다)
    expect(JSON.stringify(dash.messages.filter((m) => m.type === "agent"))).not.toMatch(/탈수|UE|1544|LG전자/);
    expect(dash.messages.some((m) => m.type === "agent" && m.event === "pending")).toBe(true);
  }, SLOW);

  it("연락처를 등록하지 않았으면 묻지도 보내지도 않고 실제 폰 답이 「AS센터 연락처가 등록되지 않았어요.」다", async () => {
    fake = await startFakeCallService();
    const { phone } = await home({ CALL_SERVICE_URL: fake.url });
    phone.ws.send(JSON.stringify({ type: "say", text: "세탁기 AS 불러 줘" }));
    const reply = await phone.waitFor((m) => m.type === "reply" && m.text !== "", "폰 답");
    expect(reply).toMatchObject({ text: "AS센터 연락처가 등록되지 않았어요.", pending: [] });
    expect(fake.requests).toEqual([]);
    expect(srv!.history.list({ kinds: ["service"] })).toEqual([]);
  }, SLOW);

  it("보낸 뒤 답이 없어 확인 불가인 연락은 집 폴더(RUNTIME_DIR/homes/oneroom/service-retry.json)에 남는다", async () => {
    fake = await startFakeCallService();
    fake.answer = "drop";
    const { runtime, phone, token } = await asked({ CALL_SERVICE_URL: fake.url });
    phone.ws.send(JSON.stringify({ type: "confirm", token, choice: "approve" }));
    await phone.waitFor((m) => m.type === "reply" && m.text === "AS센터 전화 요청이 접수됐는지 확인하지 못했어요.", "폰 답");
    const saved = readFileSync(join(runtime, "homes", "oneroom", "service-retry.json"), "utf8");
    expect(saved).toContain(fake.requests[0]!.body.id);
    expect(saved).not.toMatch(/탈수|UE|1588/);
  }, SLOW);

  it("KEEP_HEARD_TEXT=1이면 기록 DB service 줄에 받는 이·내용을 그대로 남긴다", async () => {
    const { phone, token } = await asked({ KEEP_HEARD_TEXT: "1" });
    phone.ws.send(JSON.stringify({ type: "confirm", token, choice: "approve" }));
    await phone.waitFor((m) => m.type === "reply" && m.text === "전화 서비스가 아직 연결되지 않았어요.", "폰 답");
    expect(srv!.history.list({ kinds: ["service"] })[0]!.data).toMatchObject({ outcome: "unconnected", to: { name: "AS센터", phone: "1588-0000" }, problem: "탈수할 때 멈춤", error_code: "UE" });
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
    expect(JSON.stringify(srv!.history.list({ kinds: ["service"] }))).not.toMatch(/탈수|UE/);
    await new Promise((r) => setTimeout(r, 1200));
    expect(dash.messages.filter((m) => m.type === "say").map((m) => m.text)).not.toContain("AS센터 전화는 하지 않을게요.");
  }, SLOW);
});
