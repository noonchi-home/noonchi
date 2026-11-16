// 외부 연락(전화 에이전트 자리): 에이전트 도구 call_service(AS센터 전화·보호자 연락)는 늘 실제 폰으로 승인을 먼저 묻고(답은 이번만),
// 승인되면 외부 API 통로(src/infer/call-service.ts)로 CALL_SERVICE_URL에 JSON을 보낸다. 주소가 없으면 부르지 않고 「전화 서비스가 아직 연결되지 않았어요.」.
// 받는 이는 서버에 등록한 연락처(runtime/homes/<집>/contacts.json)뿐이다. 등록이 없으면 묻지도 보내지도 않는다. 모델은 받는 이를 정하지 못한다.
// 보내는 칸은 승인 질문에 보이는 칸뿐이다(AS센터: 가전·고장 설명·에러 코드, 보호자: 사람 상태). 대시보드로 가는 사본은 KEEP_HEARD_TEXT가 꺼져 있으면 그 내용을 가린다.
// 접수했는지 모르는 실패(답 없음·연결 끊김)는 확인 불가이고, 접수가 확인될 때까지 같은 내용을 다시 승인하면 같은 id로 보낸다(집마다 파일에 남는다).
// 결과(보냄·거절·연결 없음·실패·확인 불가)는 onService로 알린다(서버가 기록 DB·말풍선 카드에 남긴다, tests/call-service-home.test.ts).
// 모델 자리는 가짜 OpenAI 호환 서버, 전화 서비스 자리는 가짜 HTTP 서버(tests/helpers/call-service.ts)다.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Agent, type AgentEvent, type LlmProvider, type ServiceLine, type StepOptions, type StepResult } from "../src/agent/agent.js";
import { ApprovalStore } from "../src/agent/approval.js";
import { Policy } from "../src/agent/policy.js";
import { SERVICE_RETRY_MS, ServiceRetryStore, contactsPath, loadContacts, serviceRecord, serviceRetryPath, type ServiceContacts } from "../src/agent/service.js";
import { AGENT_TOOLS, MCP_TOOLS } from "../src/agent/tools.js";
import type { ServiceCall, ServiceResult } from "../src/contract/service.js";
import { CallServiceClient, callServiceBody, callServiceFrom } from "../src/infer/call-service.js";
import { HEARD_MARK } from "../src/world/labels.js";
import { ROOMS, makeHome, twin } from "./helpers/home.js";
import { startFakeCallService } from "./helpers/call-service.js";
import { startFakeLlm, toolOutputs, type FakeLlm } from "./helpers/llm.js";

const BOTH = [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }];
const AS = { name: "LG전자 서비스센터", phone: "1544-7777" };
const DAUGHTER = { name: "딸", phone: "010-1234-5678" };
const CONTACTS: ServiceContacts = { as_center: AS, guardian: DAUGHTER };
const WASHER_CALL: ServiceCall = {
  kind: "as_center", to: AS, device: { id: "washer_1", label: "세탁기", kind: "washer" }, problem: "탈수할 때 멈춤", errorCode: "UE", person: null,
};
const META = { id: "c1", approvedAt: "2026-11-17T01:00:00.000Z" };
/** 대시보드로 가는 사본에 나오면 안 되는 내용(받는 이·고장 설명·에러 코드·사람 상태). 번호는 통째로, 에러 코드는 낱말로만 본다
 *  (기록 시각 1794859871544·uuid의 「-4010-」 같은 숫자 칸에 맞지 않게). */
const SECRET = /탈수|(?<![A-Za-z0-9])UE(?![A-Za-z0-9])|LG전자|1544-7777|딸|010-1234-5678|넘어진/;

describe("가림 확인 글(SECRET)", () => {
  it("가릴 내용에는 맞고, 기록 시각·uuid·숫자 칸에는 맞지 않는다", () => {
    for (const leak of ["탈수할 때 멈춤", '"error_code":"UE"', "에러 UE.", "LG전자 서비스센터", "1544-7777", "딸에게", "010-1234-5678", "넘어진 뒤"]) expect(leak, leak).toMatch(SECRET);
    for (const fine of ['{"at_ms":1794859871544}', '"id":"6f1c2a9e-3b7d-4010-9a52-0d8e4f7b21c3"', '"at":"2026-11-17T10:15:44.010Z"', "QUEUE", "true"]) expect(fine, fine).not.toMatch(SECRET);
  });
});

describe("외부 연락 통로(src/infer/call-service.ts)", () => {
  it("CALL_SERVICE_URL이 없으면 통로가 없고, http(s) 주소가 아니면 시작하지 않는다", () => {
    expect(callServiceFrom({})).toBeNull();
    expect(callServiceFrom({ CALL_SERVICE_URL: "  " })).toBeNull();
    for (const bad of ["ftp://127.0.0.1/calls", "전화", "127.0.0.1:9000"]) expect(() => callServiceFrom({ CALL_SERVICE_URL: bad }), bad).toThrow(/CALL_SERVICE_URL/);
    expect(callServiceFrom({ CALL_SERVICE_URL: " http://127.0.0.1:9/calls " })?.url).toBe("http://127.0.0.1:9/calls");
  });

  it("승인한 연락 하나를 JSON으로 POST한다. 2xx면 보냄, 2xx가 아닌 답과 닿지 못함은 실패, 보낸 뒤 답이 없거나 끊기면 확인 불가다", async () => {
    const fake = await startFakeCallService();
    const client = new CallServiceClient(fake.url, { home: { id: "oneroom", name: "원룸" }, timeoutMs: 400 });
    try {
      expect(await client.send(WASHER_CALL, META)).toEqual({ ok: true, status: 200 });
      expect(fake.requests).toEqual([{
        method: "POST", path: "/calls", contentType: "application/json",
        body: {
          version: 1, id: "c1", kind: "as_center", to: { name: "LG전자 서비스센터", phone: "1544-7777" }, home: { id: "oneroom", name: "원룸" },
          device: { id: "washer_1", label: "세탁기", kind: "washer" }, problem: "탈수할 때 멈춤", error_code: "UE", person: null, approved_at: "2026-11-17T01:00:00.000Z",
        },
      }]);
      fake.status = 503;
      expect(await client.send(WASHER_CALL, META)).toEqual({ ok: false, status: 503, error: "전화 서비스 HTTP 503" });
      fake.answer = "hang";
      expect(await client.send(WASHER_CALL, META)).toMatchObject({ ok: false, unknown: true });
      fake.answer = "drop";
      expect(await client.send(WASHER_CALL, META)).toMatchObject({ ok: false, unknown: true });
      expect(fake.requests).toHaveLength(4);
    } finally {
      await fake.close();
    }
    // 한 번도 잇지 않은 닫힌 포트: 연결 거부는 나가기 전 실패다(Windows는 거부까지 0.4초를 넘길 수 있어 기본 제한 시간으로 본다).
    // 이어 쓰던 연결이 끊긴 것은 나갔는지 몰라 확인 불가다(위 drop과 같다)
    const dead = await startFakeCallService();
    await dead.close();
    const gone = await new CallServiceClient(dead.url).send(WASHER_CALL, META);
    expect(gone).toMatchObject({ ok: false, error: expect.any(String) });
    expect(gone).not.toHaveProperty("unknown");
  });

  it("docs/reference.md 「외부 연락」 예시: 등록부와, 서버가 보내는 본문과 칸·값 모양이 같은 요청 둘(전화 서비스가 그대로 받아 구현한다)", () => {
    const md = readFileSync(new URL("../docs/reference.md", import.meta.url), "utf8");
    const section = md.slice(md.indexOf("### 외부 연락"));
    const blocks = [...section.matchAll(/```json\r?\n([\s\S]*?)```/g)].slice(0, 3).map((m) => JSON.parse(m[1]!) as Record<string, unknown>);
    expect(blocks).toHaveLength(3);
    const shape = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === null ? "null" : typeof x === "object" ? Object.keys(x as object).sort() : typeof x]));
    expect(Object.keys(blocks[0]!).sort()).toEqual(["as_center", "guardian"]);
    expect(loadContacts(writeTemp(JSON.stringify(blocks[0])))).toEqual({ contacts: blocks[0] });
    const asCenter = callServiceBody(WASHER_CALL, META, { id: "oneroom", name: "원룸" });
    expect(shape(blocks[1]!)).toEqual(shape(asCenter as unknown as Record<string, unknown>));
    const guardian = callServiceBody({ kind: "guardian", to: DAUGHTER, device: null, problem: null, errorCode: null, person: "넘어진 뒤 일어나지 못함" }, META, { id: "oneroom", name: "원룸" });
    expect(shape(blocks[2]!)).toEqual(shape(guardian as unknown as Record<string, unknown>));
    expect([blocks[1]!.kind, blocks[2]!.kind]).toEqual(["as_center", "guardian"]);
  });
});

/** 임시 contacts.json을 쓰고 그 경로. */
function writeTemp(text: string): string {
  const path = contactsPath(mkdtempSync(join(tmpdir(), "svc-contacts-")), "oneroom");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

describe("받는 이 등록부(runtime/homes/<집>/contacts.json)", () => {
  it("파일이 없으면 등록된 받는 이가 없다. 있으면 그 값, 깨졌거나 모양이 틀린 칸은 등록이 없는 것으로 두고 까닭을 알린다(일반 이름으로 채우지 않는다)", () => {
    expect(contactsPath("rt", "oneroom")).toBe(join("rt", "homes", "oneroom", "contacts.json"));
    expect(loadContacts(join(mkdtempSync(join(tmpdir(), "svc-none-")), "contacts.json"))).toEqual({ contacts: {} });
    expect(loadContacts(writeTemp(JSON.stringify(CONTACTS)))).toEqual({ contacts: CONTACTS });
    expect(loadContacts(writeTemp(JSON.stringify({ guardian: { name: "딸" } })))).toEqual({ contacts: { guardian: { name: "딸", phone: null } } });
    const broken = loadContacts(writeTemp("{ 딸"));
    expect(broken.contacts).toEqual({});
    expect(broken.warning).toMatch(/contacts\.json/);
    const wrong = loadContacts(writeTemp(JSON.stringify({ as_center: { name: "" }, guardian: { name: "딸", phone: "전화해" } })));
    expect(wrong.contacts).toEqual({});
    expect(wrong.warning).toMatch(/as_center.*guardian/);
  });
});

describe("기록 DB service 줄(serviceRecord): 들은 말·개인정보 가림", () => {
  const result: ServiceResult = { id: "c1", call: { ...WASHER_CALL, kind: "guardian", device: null, person: "거실에서 넘어짐", problem: null, errorCode: null, to: DAUGHTER }, outcome: "refused", atMs: 1 };
  it("KEEP_HEARD_TEXT가 꺼져 있으면(기본) 받는 이·고장 설명·에러 코드·사람 상태를 남기지 않는다. 거절도 같다", () => {
    const r = serviceRecord(result, false);
    expect(r).toEqual({ text: "보호자 연락 · 거절", data: { id: "c1", kind: "guardian", outcome: "refused", device: null, detail: HEARD_MARK } });
    expect(JSON.stringify(r)).not.toMatch(/딸|010-1234-5678|넘어짐/);
    const washer = serviceRecord({ id: "c2", call: WASHER_CALL, outcome: "failed", atMs: 1, error: "전화 서비스 HTTP 500" }, false);
    expect(washer).toEqual({
      text: "세탁기 AS센터 전화 · 실패", subject: "washer_1",
      data: { id: "c2", kind: "as_center", outcome: "failed", device: WASHER_CALL.device, detail: HEARD_MARK, error: "전화 서비스 HTTP 500" },
    });
    expect(JSON.stringify(washer)).not.toMatch(SECRET);
  });
  it("KEEP_HEARD_TEXT=1이면 그대로 남긴다", () => {
    expect(serviceRecord(result, true).data).toEqual({ id: "c1", kind: "guardian", outcome: "refused", device: null, to: DAUGHTER, problem: null, error_code: null, person: "거실에서 넘어짐" });
  });
});

describe("다시 보내기 기억(runtime/homes/<집>/service-retry.json)", () => {
  it("확인 불가인 연락은 접수가 확인될 때까지 같은 내용이면 같은 id. 내용(고장 설명·에러 코드·사람 상태·받는 이)이 다르면 다른 연락이다. 파일에 남아 다시 띄워도 같고, 내용 글은 파일에 쓰지 않는다. 30분이 지나면 잊는다", () => {
    let now = 1_000;
    const path = serviceRetryPath(mkdtempSync(join(tmpdir(), "svc-retry-")), "oneroom");
    expect(path).toMatch(/homes[\\/]oneroom[\\/]service-retry\.json$/);
    const a = new ServiceRetryStore(path, () => now);
    expect(a.idFor(WASHER_CALL)).toBeNull();
    a.unsure(WASHER_CALL, "c1");
    expect(a.idFor(WASHER_CALL)).toBe("c1");
    expect(a.idFor({ ...WASHER_CALL, problem: "문이 안 열림" })).toBeNull();
    expect(a.idFor({ ...WASHER_CALL, errorCode: "OE" })).toBeNull();
    const fall = { kind: "guardian", to: DAUGHTER, device: null, problem: null, errorCode: null, person: "거실에서 넘어짐" } as const;
    a.unsure(fall, "g1");
    expect(a.idFor({ ...fall, person: "약을 먹지 않음" })).toBeNull();
    expect(readFileSync(path, "utf8")).not.toMatch(SECRET);
    const b = new ServiceRetryStore(path, () => now);
    expect([b.idFor(WASHER_CALL), b.idFor(fall)]).toEqual(["c1", "g1"]);
    b.settled(WASHER_CALL);
    expect(new ServiceRetryStore(path, () => now).idFor(WASHER_CALL)).toBeNull();
    now += SERVICE_RETRY_MS + 1;
    expect(new ServiceRetryStore(path, () => now).idFor(fall)).toBeNull();
  });

  it("같은 집 파일을 쓰는 저장소가 둘이어도(집을 A→B→A로 바꿈) 서로의 기억을 덮어쓰거나 지우지 않는다: 쓸 때마다 파일을 다시 읽는다", () => {
    const path = serviceRetryPath(mkdtempSync(join(tmpdir(), "svc-retry-two-")), "oneroom");
    const old = new ServiceRetryStore(path);
    const fresh = new ServiceRetryStore(path);
    const fall = { kind: "guardian", to: DAUGHTER, device: null, problem: null, errorCode: null, person: "거실에서 넘어짐" } as const;
    old.unsure(WASHER_CALL, "c1");
    fresh.unsure(fall, "g1");
    expect([old.idFor(fall), fresh.idFor(WASHER_CALL)]).toEqual(["g1", "c1"]);
    old.settled(WASHER_CALL);
    expect(fresh.idFor(fall)).toBe("g1");
    expect(new ServiceRetryStore(path).idFor(fall)).toBe("g1");
    expect(new ServiceRetryStore(path).idFor(WASHER_CALL)).toBeNull();
  });

  it("파일이 없으면 빈 기억이고, 깨졌거나 읽을 수 없으면(폴더·권한 등) 빈 기억으로 두지 않고 그 까닭을 알린다(problem)", () => {
    const dir = mkdtempSync(join(tmpdir(), "svc-retry-bad-"));
    const path = serviceRetryPath(dir, "oneroom");
    expect(new ServiceRetryStore(path).problem()).toBeNull();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ 깨짐");
    const broken = new ServiceRetryStore(path);
    expect(broken.problem()).toMatch(/service-retry\.json/);
    expect(() => broken.idFor(WASHER_CALL)).toThrow(/service-retry\.json/);
    const folder = serviceRetryPath(dir, "folder");
    mkdirSync(folder, { recursive: true });
    expect(new ServiceRetryStore(folder).problem()).toMatch(/service-retry\.json/);
  });
});

describe("승인 정책: 외부 연락 대기", () => {
  it("외부 연락은 늘 묻고 승인을 기억하지 않는다. 대기는 가전 승인과 같은 시간 제한(5분)이고 실제 폰에서 가린 동안(pause)은 멈춘다", () => {
    let now = 0;
    const path = join(mkdtempSync(join(tmpdir(), "svc-ap-")), "approvals.json");
    const approvals = new ApprovalStore(path, () => "t");
    const policy = new Policy({ now: () => now, approvals });
    const a = policy.askService(WASHER_CALL);
    expect(a.reason).toBe("탈수할 때 멈춤 · 에러 UE. LG전자 서비스센터에 전화할까요?");
    expect(policy.services().map((p) => p.token)).toEqual([a.token]);
    expect(policy.pending()).toEqual([]);
    policy.pause(true);
    now += 10 * 60_000;
    policy.pause(false);
    expect(policy.services()).toHaveLength(1);
    now += 5 * 60_000;
    expect(policy.services()).toEqual([]);
    expect(policy.takeService(a.token)).toBeUndefined();
    const b = policy.askService({ kind: "guardian", to: DAUGHTER, device: null, problem: null, errorCode: null, person: "넘어짐." });
    expect(b.reason).toBe("넘어짐. 딸에게 연락할까요?");
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
      "세탁기 문이 안 열려 AS 불러 줘": [
        [["call_service", { kind: "as_center", device_id: "washer_1", problem: "문이 안 열림", reason: "세탁기 문 고장으로 AS센터 전화를 부탁해서" }]],
        "AS센터에 전화할지 폰에서 골라 주세요.",
      ],
      "보호자에게 연락해 줘": [
        [["call_service", { kind: "guardian", person: "거실에서 넘어진 뒤 일어나지 못함", reason: "보호자 연락을 부탁해서" }]],
        "보호자에게 연락할지 폰에서 골라 주세요.",
      ],
      "옆집 아저씨한테 연락해 줘": [
        [["call_service", { kind: "guardian", to: "옆집 아저씨 010-9999-9999", person: "도움이 필요함", reason: "연락을 부탁해서" }]],
        "연락할지 폰에서 골라 주세요.",
      ],
      "AS센터에 전화해 줘": [[["call_service", { kind: "as_center", reason: "AS센터 전화를 부탁해서" }]], "어느 가전이 고장 났나요?"],
      "보호자 불러 줘": [[["call_service", { kind: "guardian", reason: "보호자 연락을 부탁해서" }]], "어떤 상황인지 알려 주세요."],
      "인덕션 AS 불러 줘": [[["call_service", { kind: "as_center", problem: "인덕션이 꺼져 있어요. 전원 버튼을 눌러 주세요", reason: "AS센터 전화를 부탁해서" }]], "확인했어요."],
      "세탁기 AS에 엄마 상태도 알려 줘": [[["call_service", { kind: "as_center", device_id: "washer_1", problem: "탈수할 때 멈춤", person: "엄마가 어지러워함", reason: "AS센터 전화를 부탁해서" }]], "확인했어요."],
      "보호자에게 세탁기 고장도 알려 줘": [[["call_service", { kind: "guardian", person: "도움이 필요함", device_id: "washer_1", problem: "탈수할 때 멈춤", error_code: "UE", reason: "보호자 연락을 부탁해서" }]], "확인했어요."],
      "전자레인지가 안 돼서 AS 불러 줘": [
        [["call_service", { kind: "as_center", device_id: "microwave_1", problem: "데워지지 않음", reason: "전자레인지 고장으로 AS센터 전화를 부탁해서" }]],
        "전자레인지 AS센터에 전화할지 골라 주세요.",
      ],
      "어떤 내용으로 요청했지?": ["탈수할 때 멈춤 · 에러 UE로 LG전자 서비스센터에 요청했어요."],
      "거실 TV 켜 줘": [[["turn_on", { device_id: "tv_living", reason: "거실 TV를 켜 달라고 해서" }]], "거실 TV를 켰어요."],
      "현관문 열어 줘": [[["unlock", { device_id: "door_main", reason: "현관문을 열어 달라고 해서" }]], "열까요?"],
      // 까닭 200자 경계에 앞 연락 내용(「탈수할 때 멈춤」)이 걸린다
      "세탁기 다시 찾아 줘": [[["find_devices", { query: "세탁기", reason: `${"가".repeat(195)}탈수할 때 멈춤 문제라서 세탁기를 찾으려고` }]], "세탁기를 찾았어요."],
    });
  });
  afterAll(async () => { await llm?.close(); });

  function serviceAgent(service: ServiceLine | null, o: { contacts?: ServiceContacts; keepHeard?: boolean; retries?: ServiceRetryStore } = {}) {
    const { hub } = makeHome();
    lastHub = hub;
    const approvals = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "svc-agent-")), "approvals.json"), () => "t");
    const policy = new Policy({ approvals });
    const results: ServiceResult[] = [];
    const events: AgentEvent[] = [];
    const agent = new Agent({
      hub, policy, rooms: ROOMS, provider: llm.provider(), service, contacts: o.contacts ?? CONTACTS, keepHeard: o.keepHeard, retries: o.retries,
      onService: (r) => results.push(r), onEvent: (e) => events.push(e),
    });
    return { agent, policy, approvals, results, events };
  }
  /** 마지막으로 만든 에이전트의 가전 허브(닫은 뒤 가전이 바뀌지 않았는지 본다). */
  let lastHub: ReturnType<typeof makeHome>["hub"];
  const sentFrom = () => {
    const from = llm.bodies().length;
    return () => llm.bodies().slice(from);
  };
  const client = (url: string, timeoutMs?: number) => new CallServiceClient(url, { timeoutMs });

  it("「세탁기 AS 불러 줘」 → 실제 폰 승인 질문에 받는 이와 보낼 내용이 보이고(「세탁기: 탈수할 때 멈춤 · 에러 UE. LG전자 서비스센터에 전화할까요?」), 모델에는 토큰 없이 승인 대기만. 승인하면 보이는 그대로 보내고 기억하지 않는다", async () => {
    const fake = await startFakeCallService();
    try {
      const { agent, approvals, results } = serviceAgent(client(fake.url));
      const bodies = sentFrom();
      const r = await agent.chat("phone", "세탁기 AS 불러 줘", { heard: true });
      const ask = "탈수할 때 멈춤 · 에러 UE. LG전자 서비스센터에 전화할까요?";
      expect(r.pendingConfirmations).toEqual([expect.objectContaining({ deviceId: "", deviceLabel: "세탁기", reason: ask, service: "as_center", choices: BOTH })]);
      expect(r.pendingConfirmations[0]!.command).toBeUndefined();
      expect(r.actions).toEqual([expect.objectContaining({ tool: "call_service", ok: false, needsConfirmation: true })]);
      expect(r.actions[0]!.deviceId).toBeUndefined();
      const token = r.pendingConfirmations[0]!.token;
      expect(toolOutputs(bodies()[1])[0]).toMatchObject({ ok: false, pendingApproval: { reason: ask } });
      expect(JSON.stringify(bodies())).not.toContain(token);
      expect(fake.requests).toEqual([]);

      const c = await agent.confirm(token, "approve");
      expect(c).toMatchObject({ ok: true, reply: "AS센터에 전화를 요청했어요.", action: { tool: "call_service", ok: true } });
      expect(fake.requests).toHaveLength(1);
      expect(fake.requests[0]!.body).toMatchObject({
        kind: "as_center", to: AS, device: { id: "washer_1", label: "세탁기", kind: "washer" }, problem: "탈수할 때 멈춤", error_code: "UE", person: null, home: null,
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

  it("대시보드로 가는 사본(/events: action·pending·reply)은 KEEP_HEARD_TEXT가 꺼져 있으면 받는 이·보낼 내용을 가린다. 실제 폰이 받는 답(대기 목록)은 그대로다. 켜져 있으면 사본도 그대로다", async () => {
    const hidden = serviceAgent(null);
    const r = await hidden.agent.chat("phone", "세탁기 AS 불러 줘", { heard: true });
    expect(r.pendingConfirmations[0]!.reason).toBe("탈수할 때 멈춤 · 에러 UE. LG전자 서비스센터에 전화할까요?");
    await hidden.agent.confirm(r.pendingConfirmations[0]!.token, "approve");
    const g = await hidden.agent.chat("s", "보호자에게 연락해 줘");
    expect(g.pendingConfirmations[0]!.reason).toContain("딸에게");
    await hidden.agent.chat("s", "응");
    expect(hidden.events.map((e) => e.event)).toEqual(expect.arrayContaining(["action", "pending", "reply", "confirmed"]));
    expect(JSON.stringify(hidden.events)).not.toMatch(SECRET);
    const shown = serviceAgent(null, { keepHeard: true });
    await shown.agent.chat("phone", "세탁기 AS 불러 줘", { heard: true });
    expect(JSON.stringify(shown.events)).toMatch(/탈수할 때 멈춤 · 에러 UE\. LG전자 서비스센터에 전화할까요\?/);
  });

  it("받는 이는 모델이 정하지 못한다: 모델이 다른 받는 이를 넣어도 등록한 보호자에게만 묻고 보낸다", async () => {
    const fake = await startFakeCallService();
    try {
      const { agent } = serviceAgent(client(fake.url));
      const r = await agent.chat("phone", "옆집 아저씨한테 연락해 줘", { heard: true });
      expect(r.pendingConfirmations).toEqual([expect.objectContaining({ deviceLabel: "", reason: "도움이 필요함. 딸에게 연락할까요?" })]);
      await agent.confirm(r.pendingConfirmations[0]!.token, "approve");
      expect(fake.requests[0]!.body.to).toEqual(DAUGHTER);
      expect(JSON.stringify(fake.requests[0]!.body)).not.toContain("옆집");
    } finally {
      await fake.close();
    }
  });

  it("그 종류의 받는 이가 등록되지 않았으면 묻지도 보내지도 않고 실제 폰 답이 「보호자 연락처가 등록되지 않았어요.」다", async () => {
    const fake = await startFakeCallService();
    try {
      const { agent, results } = serviceAgent(client(fake.url), { contacts: { as_center: AS } });
      const bodies = sentFrom();
      const r = await agent.chat("phone", "보호자에게 연락해 줘", { heard: true });
      expect(r.pendingConfirmations).toEqual([]);
      expect(r.reply).toBe("보호자 연락처가 등록되지 않았어요.");
      expect(toolOutputs(bodies()[1])[0]).toMatchObject({ ok: false, error: "보호자 연락처가 등록되지 않았어요." });
      const none = serviceAgent(client(fake.url), { contacts: {} });
      expect((await none.agent.chat("phone", "세탁기 AS 불러 줘", { heard: true })).reply).toBe("AS센터 연락처가 등록되지 않았어요.");
      expect(fake.requests).toEqual([]);
      expect(results).toEqual([]);
    } finally {
      await fake.close();
    }
  });

  it("승인 질문에 보이지 않는 칸은 보내지 않는다: AS센터 전화에 사람 상태, 보호자 연락에 가전·고장 설명·에러 코드를 넣으면 묻지 않고 모델에게 까닭을 돌려준다", async () => {
    const { agent, results } = serviceAgent(null);
    for (const [said, why] of [["세탁기 AS에 엄마 상태도 알려 줘", /AS센터 전화에는 person/], ["보호자에게 세탁기 고장도 알려 줘", /보호자 연락에는 person만/]] as const) {
      const r = await agent.chat("phone", said, { heard: true });
      expect(r.pendingConfirmations, said).toEqual([]);
      expect(r.actions[0], said).toMatchObject({ tool: "call_service", ok: false, error: expect.stringMatching(why) });
    }
    expect(results).toEqual([]);
  });

  it("거절·취소면 보내지 않는다: 「AS센터 전화는 하지 않을게요.」, 결과는 거절", async () => {
    const fake = await startFakeCallService();
    try {
      const { agent, results } = serviceAgent(client(fake.url));
      const t1 = (await agent.chat("phone", "세탁기 AS 불러 줘", { heard: true })).pendingConfirmations[0]!.token;
      expect(await agent.confirm(t1, "reject")).toMatchObject({ ok: false, reply: "AS센터 전화는 하지 않을게요." });
      const t2 = (await agent.chat("phone", "세탁기 AS 불러 줘", { heard: true })).pendingConfirmations[0]!.token;
      expect(agent.cancel(t2)).toEqual({ ok: true, reply: "AS센터 전화를 취소했어요." });
      await agent.chat("s", "세탁기 AS 불러 줘");
      expect((await agent.chat("s", "아니")).reply).toBe("AS센터 전화는 하지 않을게요.");
      expect(agent.pending()).toEqual([]);
      expect(fake.requests).toEqual([]);
      expect(results.map((x) => x.outcome)).toEqual(["refused", "refused", "refused"]);
    } finally {
      await fake.close();
    }
  });

  it("CALL_SERVICE_URL이 없으면 승인해도 부르지 않고 「전화 서비스가 아직 연결되지 않았어요.」, 결과는 연결 없음", async () => {
    const { agent, results } = serviceAgent(null);
    const r = await agent.chat("phone", "세탁기 AS 불러 줘", { heard: true });
    const c = await agent.confirm(r.pendingConfirmations[0]!.token, "approve");
    expect(c).toMatchObject({ ok: false, reply: "전화 서비스가 아직 연결되지 않았어요." });
    expect(results.map((x) => x.outcome)).toEqual(["unconnected"]);
  });

  it("전화 서비스가 2xx가 아닌 답을 하면 「AS센터에 전화하지 못했어요.」, 결과는 실패(까닭 HTTP 500). 앞 연락이 확인 불가가 아니면 다시 승인할 때 새 id다", async () => {
    const fake = await startFakeCallService(500);
    try {
      const { agent, results } = serviceAgent(client(fake.url));
      for (let i = 0; i < 2; i++) {
        const r = await agent.chat("phone", "세탁기 AS 불러 줘", { heard: true });
        expect(await agent.confirm(r.pendingConfirmations[0]!.token, "approve")).toMatchObject({ ok: false, reply: "AS센터에 전화하지 못했어요." });
      }
      expect(results).toEqual([expect.objectContaining({ outcome: "failed", error: "전화 서비스 HTTP 500" }), expect.objectContaining({ outcome: "failed" })]);
      expect(fake.requests[0]!.body.id).not.toBe(fake.requests[1]!.body.id);
    } finally {
      await fake.close();
    }
  });

  it("보낸 뒤 답이 없으면 확인 불가(「AS센터 전화 요청이 접수됐는지 확인하지 못했어요.」). 같은 내용을 다시 승인하면 접수가 확인될 때까지(닿지 못함·2xx 아닌 답이 끼어도) 같은 id로 보낸다. 내용이 다른 고장은 새 id다", async () => {
    const fake = await startFakeCallService();
    const dead = await startFakeCallService();
    await dead.close();
    try {
      const live = client(fake.url, 400);
      const refused = new CallServiceClient(dead.url);
      let refuse = false;
      const line: ServiceLine = { send: (c, m) => (refuse ? refused : live).send(c, m) };
      const { agent, results } = serviceAgent(line);
      const once = async (said = "세탁기 AS 불러 줘") => {
        const r = await agent.chat("phone", said, { heard: true });
        return agent.confirm(r.pendingConfirmations[0]!.token, "approve");
      };
      fake.answer = "hang";
      expect(await once()).toMatchObject({ ok: false, reply: "AS센터 전화 요청이 접수됐는지 확인하지 못했어요." });
      fake.answer = "drop";
      expect(await once()).toMatchObject({ ok: false, reply: "AS센터 전화 요청이 접수됐는지 확인하지 못했어요." });
      refuse = true;
      expect(await once()).toMatchObject({ ok: false, reply: "AS센터에 전화하지 못했어요." });
      refuse = false;
      fake.answer = "reply";
      fake.status = 503;
      expect(await once()).toMatchObject({ ok: false, reply: "AS센터에 전화하지 못했어요." });
      fake.status = 200;
      expect(await once("세탁기 문이 안 열려 AS 불러 줘")).toMatchObject({ ok: true });
      expect(await once()).toMatchObject({ ok: true, reply: "AS센터에 전화를 요청했어요." });
      expect(await once()).toMatchObject({ ok: true });
      const ids = fake.requests.map((q) => q.body.id as string);
      expect(ids).toHaveLength(6);
      expect([ids[1], ids[2], ids[4]]).toEqual([ids[0], ids[0], ids[0]]);
      expect(ids[3]).not.toBe(ids[0]);
      expect(ids[5]).not.toBe(ids[0]);
      expect(results.map((x) => x.outcome)).toEqual(["unknown", "unknown", "failed", "failed", "sent", "sent", "sent"]);
      expect(results[2]!.id).toBe(ids[0]);
    } finally {
      await fake.close();
    }
  });

  it("다시 보내기 기억은 집 파일에 남는다: 서버를 다시 띄워도(새 에이전트) 같은 내용은 같은 id로 보낸다", async () => {
    const fake = await startFakeCallService();
    try {
      const path = serviceRetryPath(mkdtempSync(join(tmpdir(), "svc-restart-")), "oneroom");
      const first = serviceAgent(client(fake.url, 400), { retries: new ServiceRetryStore(path) });
      fake.answer = "hang";
      const r1 = await first.agent.chat("phone", "보호자에게 연락해 줘", { heard: true });
      expect((await first.agent.confirm(r1.pendingConfirmations[0]!.token, "approve")).reply).toBe("보호자 연락 요청이 접수됐는지 확인하지 못했어요.");
      expect(existsSync(path)).toBe(true);
      fake.answer = "reply";
      const again = serviceAgent(client(fake.url), { retries: new ServiceRetryStore(path) });
      const r2 = await again.agent.chat("phone", "보호자에게 연락해 줘", { heard: true });
      expect((await again.agent.confirm(r2.pendingConfirmations[0]!.token, "approve")).ok).toBe(true);
      expect(fake.requests[1]!.body.id).toBe(fake.requests[0]!.body.id);
    } finally {
      await fake.close();
    }
  });

  it("보내기 전에 id를 집 파일에 먼저 남긴다: 전화 서비스가 받고 답하기 전에 서버가 꺼져도, 다시 띄운 뒤 같은 내용은 같은 id다. 닿지 못한 새 연락은 남기지 않는다", async () => {
    const fake = await startFakeCallService();
    const path = serviceRetryPath(mkdtempSync(join(tmpdir(), "svc-before-")), "oneroom");
    try {
      fake.answer = "hang";
      const first = serviceAgent(client(fake.url, 60_000), { retries: new ServiceRetryStore(path) });
      const r1 = await first.agent.chat("phone", "보호자에게 연락해 줘", { heard: true });
      const waiting = first.agent.confirm(r1.pendingConfirmations[0]!.token, "approve");
      for (const end = Date.now() + 5000; fake.requests.length === 0 && Date.now() < end; await new Promise((r) => setTimeout(r, 20)));
      expect(fake.requests).toHaveLength(1);
      // 답을 기다리는 동안(서버가 여기서 꺼지면 다시 띄운 서버가 읽을) 집 파일에 이미 그 id가 있다
      const id = fake.requests[0]!.body.id as string;
      const fall = { kind: "guardian", to: DAUGHTER, device: null, problem: null, errorCode: null, person: "거실에서 넘어진 뒤 일어나지 못함" } as const;
      expect(new ServiceRetryStore(path).idFor(fall)).toBe(id);
      await fake.close();
      expect((await waiting).ok).toBe(false);
      // 다시 띄운 에이전트(새 저장소)는 같은 내용을 그 id로 보낸다
      const back = await startFakeCallService();
      try {
        const again = serviceAgent(client(back.url), { retries: new ServiceRetryStore(path) });
        const r2 = await again.agent.chat("phone", "보호자에게 연락해 줘", { heard: true });
        expect((await again.agent.confirm(r2.pendingConfirmations[0]!.token, "approve")).ok).toBe(true);
        expect(back.requests[0]!.body.id).toBe(id);
      } finally {
        await back.close();
      }
    } finally {
      await fake.close();
    }
    const dead = await startFakeCallService();
    await dead.close();
    const fresh = serviceRetryPath(mkdtempSync(join(tmpdir(), "svc-before-dead-")), "oneroom");
    const lone = serviceAgent(new CallServiceClient(dead.url), { retries: new ServiceRetryStore(fresh) });
    const r = await lone.agent.chat("phone", "세탁기 AS 불러 줘", { heard: true });
    expect((await lone.agent.confirm(r.pendingConfirmations[0]!.token, "approve")).reply).toBe("AS센터에 전화하지 못했어요.");
    expect(new ServiceRetryStore(fresh).idFor(WASHER_CALL)).toBeNull();
  });

  it("다시 보내기 기억 파일이 깨졌거나 읽을 수 없으면 묻지도 보내지도 않고 실제 폰 답이 「외부 연락 기록을 읽지 못해 연락하지 않았어요.」다", async () => {
    const fake = await startFakeCallService();
    try {
      const path = serviceRetryPath(mkdtempSync(join(tmpdir(), "svc-broken-")), "oneroom");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "{ 깨짐");
      const { agent, results } = serviceAgent(client(fake.url), { retries: new ServiceRetryStore(path) });
      const r = await agent.chat("phone", "세탁기 AS 불러 줘", { heard: true });
      expect(r.pendingConfirmations).toEqual([]);
      expect(r.reply).toBe("외부 연락 기록을 읽지 못해 연락하지 않았어요.");
      expect(fake.requests).toEqual([]);
      expect(results).toEqual([]);
      expect(readFileSync(path, "utf8")).toBe("{ 깨짐");
    } finally {
      await fake.close();
    }
  });

  it("앞 차례 외부 연락의 받는 이·내용은 같은 대화가 이어지는 동안 /events 답에서 계속 가린다(모델이 다음 차례에 그 내용을 다시 말해도). 실제 폰 답은 그대로다", async () => {
    const { agent, events } = serviceAgent(null);
    const r = await agent.chat("phone", "세탁기 AS 불러 줘", { heard: true });
    await agent.confirm(r.pendingConfirmations[0]!.token, "approve");
    const later = await agent.chat("phone", "어떤 내용으로 요청했지?", { heard: true });
    expect(later.reply).toBe("탈수할 때 멈춤 · 에러 UE로 LG전자 서비스센터에 요청했어요.");
    expect(JSON.stringify(events)).not.toMatch(SECRET);
    expect(events.some((e) => e.event === "reply" && e.reply.includes("요청했어요"))).toBe(true);
  });

  it("다음 차례 다른 도구의 까닭이 길어도 앞 연락 내용을 자르기 전에 가린다(자르는 경계에 걸린 일부가 /events로 새지 않는다). 까닭은 200자 안이다", async () => {
    const { agent, events } = serviceAgent(null);
    await agent.chat("s", "세탁기 AS 불러 줘");
    const r = await agent.chat("s", "세탁기 다시 찾아 줘");
    expect(r.actions[0]!.reason).toContain("탈수");
    const sent = events.filter((e) => e.event === "action" && e.action.tool === "find_devices").map((e) => (e as Extract<AgentEvent, { event: "action" }>).action);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.reason!.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(events)).not.toMatch(SECRET);
  });

  it("같은 내용의 연락 둘이 함께 승인되면 차례대로 보낸다: 먼저 승인된 새 연락이 닿지 못해 잊어도, 보내는 중인 다음 연락의 id는 집 파일에 남아 있다", async () => {
    const fake = await startFakeCallService();
    fake.answer = "hang";
    const dead = await startFakeCallService();
    await dead.close();
    const path = serviceRetryPath(mkdtempSync(join(tmpdir(), "svc-serial-")), "oneroom");
    try {
      let n = 0;
      const live = client(fake.url, 60_000);
      const refused = new CallServiceClient(dead.url);
      const line: ServiceLine = { send: (c, m) => (n++ === 0 ? refused : live).send(c, m) };
      const { agent } = serviceAgent(line, { retries: new ServiceRetryStore(path) });
      const a = (await agent.chat("s1", "세탁기 AS 불러 줘")).pendingConfirmations[0]!.token;
      const b = (await agent.chat("s2", "세탁기 AS 불러 줘")).pendingConfirmations[0]!.token;
      const first = agent.confirm(a, "approve");
      const second = agent.confirm(b, "approve");
      expect((await first).reply).toBe("AS센터에 전화하지 못했어요.");
      for (const end = Date.now() + 5000; fake.requests.length === 0 && Date.now() < end; await new Promise((r) => setTimeout(r, 20)));
      expect(fake.requests).toHaveLength(1);
      expect(new ServiceRetryStore(path).idFor(WASHER_CALL)).toBe(fake.requests[0]!.body.id);
      await fake.close();
      expect((await second).ok).toBe(false);
    } finally {
      await fake.close();
    }
  });

  it("같은 집 파일을 쓰는 에이전트 둘(집을 A→B→A로 바꿈)도 같은 내용의 보내기를 차례로 한다: 옛 에이전트의 새 연락이 닿지 못해 잊어도, 새 에이전트가 보내는 중인 id는 남는다", async () => {
    const fake = await startFakeCallService();
    fake.answer = "hang";
    const dead = await startFakeCallService();
    await dead.close();
    const path = serviceRetryPath(mkdtempSync(join(tmpdir(), "svc-two-agents-")), "oneroom");
    try {
      const old = serviceAgent(new CallServiceClient(dead.url), { retries: new ServiceRetryStore(path) });
      const fresh = serviceAgent(client(fake.url, 60_000), { retries: new ServiceRetryStore(path) });
      const a = (await old.agent.chat("s", "세탁기 AS 불러 줘")).pendingConfirmations[0]!.token;
      const b = (await fresh.agent.chat("s", "세탁기 AS 불러 줘")).pendingConfirmations[0]!.token;
      const first = old.agent.confirm(a, "approve");
      const second = fresh.agent.confirm(b, "approve");
      expect((await first).reply).toBe("AS센터에 전화하지 못했어요.");
      for (const end = Date.now() + 5000; fake.requests.length === 0 && Date.now() < end; await new Promise((r) => setTimeout(r, 20)));
      expect(fake.requests).toHaveLength(1);
      expect(new ServiceRetryStore(path).idFor(WASHER_CALL)).toBe(fake.requests[0]!.body.id);
      await fake.close();
      expect((await second).ok).toBe(false);
    } finally {
      await fake.close();
    }
  });

  it("집을 닫기 시작하면(에이전트·정책 닫기) 보내는 중인 연락을 기다리는 동안에도 새 요청·가전 명령·가전 승인은 하지 않는다. 그 연락의 답은 그대로 받는다", async () => {
    const fake = await startFakeCallService();
    fake.answer = "hang";
    try {
      const { agent, policy } = serviceAgent(client(fake.url, 60_000));
      const hub = lastHub;
      const door = (await agent.chat("d", "현관문 열어 줘")).pendingConfirmations[0]!.token;
      const a = (await agent.chat("s", "세탁기 AS 불러 줘")).pendingConfirmations[0]!.token;
      const sending = agent.confirm(a, "approve");
      for (const end = Date.now() + 5000; fake.requests.length === 0 && Date.now() < end; await new Promise((r) => setTimeout(r, 20)));
      policy.close();
      const closing = agent.close();
      const bodies = sentFrom();
      expect(await agent.chat("x", "거실 TV 켜 줘")).toMatchObject({ reply: "집을 닫는 중이라 요청을 받지 않았어요.", actions: [] });
      expect(bodies()).toEqual([]);
      expect(await agent.confirm(door, "approve")).toMatchObject({ ok: false });
      expect(await policy.guard(hub, "tv_living", { type: "on" })).toMatchObject({ ok: false, error: "집을 닫는 중이라 실행하지 않았어요." });
      expect(twin(hub, "tv_living").power).toBe("off");
      expect(twin(hub, "door_main").lock).toBe("locked");
      await fake.close();
      expect((await sending).reply).toBe("AS센터 전화 요청이 접수됐는지 확인하지 못했어요.");
      await closing;
    } finally {
      await fake.close();
    }
  });

  describe("닫는 중에는 남은 도구를 실행하지 않는다", () => {
    /** 차례마다 정한 결과를 내는 모델(시험 대역). gate가 있으면 그 차례는 gate가 풀릴 때 답한다(끊기 신호를 듣지 않는 모델). */
    class ScriptProvider implements LlmProvider {
      readonly name = "script";
      steps = 0;
      constructor(private readonly turns: { result: StepResult; gate?: Promise<void> }[]) {}
      createState() { return { round: 0 }; }
      addUserMessage(): void {}
      addToolResults(): void {}
      async step(state: unknown): Promise<StepResult> {
        const st = state as { round: number };
        const turn = this.turns[st.round++] ?? { result: { text: "끝", calls: [] } };
        this.steps++;
        await turn.gate;
        return turn.result;
      }
    }
    const gate = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; };
    const twoLights: StepResult = { text: "", calls: [
      { id: "c1", name: "turn_on", args: { device_id: "tv_living", reason: "켜 달라고 해서" } },
      { id: "c2", name: "turn_on", args: { device_id: "light_living", reason: "켜 달라고 해서" } },
    ] };

    it("첫 도구를 실행하는 동안 닫으면 그 뒤 도구는 실행하지 않고 모델을 다시 부르지 않는다. 답은 「집을 닫는 중이라 요청을 받지 않았어요.」", async () => {
      const base = makeHome().hub;
      const hold = gate();
      let commands = 0;
      // 첫 가전 명령을 붙잡는 허브(나머지는 그대로)
      const hub = new Proxy(base, {
        get(t, k) {
          if (k === "command") return async (...a: Parameters<typeof base.command>) => { if (commands++ === 0) await hold.p; return t.command(...a); };
          const v = Reflect.get(t, k) as unknown;
          return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
        },
      });
      const provider = new ScriptProvider([{ result: twoLights }, { result: { text: "켰어요.", calls: [] } }]);
      const agent = new Agent({ hub, policy: new Policy(), rooms: ROOMS, provider });
      const talking = agent.chat("s", "거실 불이랑 TV 켜 줘");
      for (const end = Date.now() + 2000; commands === 0 && Date.now() < end; await new Promise((r) => setTimeout(r, 10)));
      await agent.close();
      hold.open();
      expect((await talking).reply).toBe("집을 닫는 중이라 요청을 받지 않았어요.");
      expect(twin(base, "light_living").power).toBe("off");
      expect(commands).toBe(1);
      expect(provider.steps).toBe(1);
    });

    it("모델 응답을 기다리는 동안 닫혔는데 모델이 끊기를 듣지 않고 도구 호출을 내도 하나도 실행하지 않는다", async () => {
      const { hub } = makeHome();
      const hold = gate();
      const provider = new ScriptProvider([{ result: twoLights, gate: hold.p }]);
      const agent = new Agent({ hub, policy: new Policy(), rooms: ROOMS, provider });
      const talking = agent.chat("s", "거실 불이랑 TV 켜 줘");
      for (const end = Date.now() + 2000; provider.steps === 0 && Date.now() < end; await new Promise((r) => setTimeout(r, 10)));
      await agent.close();
      hold.open();
      expect((await talking).reply).toBe("집을 닫는 중이라 요청을 받지 않았어요.");
      expect(twin(hub, "tv_living").power).toBe("off");
      expect(twin(hub, "light_living").power).toBe("off");
    });
  });

  it("같은 세션의 모델 호출이 끝나지 않은 채 그 뒤에 승인 답이 기다려도, 닫으면 모델 호출을 끊고 승인 답은 바로 취소로 끝난다(닫기가 모델 응답을 기다리지 않는다)", async () => {
    /** 세션마다: 첫 차례 call_service → 글, 그다음 차례는 끊길 때까지 답하지 않는 모델(시험 대역). */
    class HangingProvider implements LlmProvider {
      readonly name = "hanging";
      aborted = 0;
      createState() { return { round: 0 }; }
      addUserMessage(): void {}
      addToolResults(): void {}
      step(state: unknown, opts: StepOptions): Promise<StepResult> {
        const st = state as { round: number };
        const round = st.round++;
        if (round === 0) return Promise.resolve({ text: "", calls: [{ id: "c1", name: "call_service", args: { kind: "as_center", device_id: "washer_1", problem: "탈수할 때 멈춤", reason: "AS센터 전화를 부탁해서" } }] });
        if (round === 1) return Promise.resolve({ text: "AS센터에 전화할지 골라 주세요.", calls: [] });
        return new Promise((_, reject) => {
          opts.signal?.addEventListener("abort", () => { this.aborted++; reject(new Error("끊김")); }, { once: true });
        });
      }
    }
    const provider = new HangingProvider();
    const { hub } = makeHome();
    const results: ServiceResult[] = [];
    const agent = new Agent({ hub, policy: new Policy(), rooms: ROOMS, provider, contacts: CONTACTS, onService: (r) => results.push(r) });
    const token = (await agent.chat("phone", "세탁기 AS 불러 줘", { heard: true })).pendingConfirmations[0]!.token;
    const talking = agent.chat("phone", "근데 그거 언제 와?", { heard: true });
    await new Promise((r) => setTimeout(r, 50));
    const answered = agent.confirm(token, "approve");
    const t0 = Date.now();
    await agent.close();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(provider.aborted).toBe(1);
    expect((await talking).reply).toBe("집을 닫는 중이라 요청을 받지 않았어요.");
    expect(await answered).toMatchObject({ ok: false, reply: "AS센터 전화를 취소했어요." });
    expect(results.map((r) => r.outcome)).toEqual(["cancelled"]);
  });

  it("에이전트를 닫으면(집을 닫음) 차례를 기다리던 연락은 보내지 않고 취소로 끝내고(결과 cancelled, 「AS센터 전화를 취소했어요.」), 보내는 중인 연락이 끝날 때까지 기다린다. 닫은 뒤 승인은 보내지 않는다", async () => {
    const fake = await startFakeCallService();
    fake.answer = "hang";
    try {
      const { agent, results } = serviceAgent(client(fake.url, 60_000));
      const a = (await agent.chat("s1", "세탁기 AS 불러 줘")).pendingConfirmations[0]!.token;
      const b = (await agent.chat("s2", "세탁기 AS 불러 줘")).pendingConfirmations[0]!.token;
      const c = (await agent.chat("s3", "보호자에게 연락해 줘")).pendingConfirmations[0]!.token;
      const sending = agent.confirm(a, "approve");
      const queued = agent.confirm(b, "approve");
      for (const end = Date.now() + 5000; fake.requests.length === 0 && Date.now() < end; await new Promise((r) => setTimeout(r, 20)));
      let closed = false;
      const closing = agent.close().then(() => { closed = true; });
      expect(await queued).toMatchObject({ ok: false, reply: "AS센터 전화를 취소했어요." });
      await new Promise((r) => setTimeout(r, 100));
      expect(closed).toBe(false);
      await fake.close();
      expect((await sending).reply).toBe("AS센터 전화 요청이 접수됐는지 확인하지 못했어요.");
      await closing;
      expect(await agent.confirm(c, "approve")).toMatchObject({ ok: false, reply: "보호자 연락을 취소했어요." });
      expect(fake.requests).toHaveLength(1);
      expect(results.map((r) => r.outcome).sort()).toEqual(["cancelled", "cancelled", "unknown"]);
    } finally {
      await fake.close();
    }
  });

  it("보호자 연락: 실제 폰에 사람 상태와 받는 이(「거실에서 넘어진 뒤 일어나지 못함. 딸에게 연락할까요?」). 들은 말 승인(answerToken)으로 보낸다", async () => {
    const fake = await startFakeCallService();
    try {
      const { agent, results } = serviceAgent(client(fake.url));
      const r = await agent.chat("phone", "보호자에게 연락해 줘", { heard: true });
      expect(r.pendingConfirmations).toEqual([expect.objectContaining({ deviceId: "", deviceLabel: "", reason: "거실에서 넘어진 뒤 일어나지 못함. 딸에게 연락할까요?", service: "guardian", choices: BOTH })]);
      expect(await agent.answerToken(r.pendingConfirmations[0]!.token, "approve")).toEqual({ ok: true, reply: "보호자에게 연락을 요청했어요." });
      expect(fake.requests[0]!.body).toMatchObject({ kind: "guardian", to: DAUGHTER, device: null, problem: null, error_code: null, person: "거실에서 넘어진 뒤 일어나지 못함" });
      expect(results.map((x) => x.outcome)).toEqual(["sent"]);
    } finally {
      await fake.close();
    }
  });

  it("가전도 고장 설명도 없는 AS센터 전화, 사람 상태가 없는 보호자 연락, 위험 가전 이름이 든 글은 묻지 않고 모델에게 까닭을 돌려준다", async () => {
    const { agent, results } = serviceAgent(null);
    for (const [said, why] of [["AS센터에 전화해 줘", /device_id|problem/], ["보호자 불러 줘", /person/], ["인덕션 AS 불러 줘", /위험 가전 이름/]] as const) {
      const bodies = sentFrom();
      const r = await agent.chat("phone", said, { heard: true });
      expect(r.pendingConfirmations, said).toEqual([]);
      expect(r.actions[0], said).toMatchObject({ tool: "call_service", ok: false, error: expect.stringMatching(why) });
      expect(toolOutputs(bodies()[1])[0], said).toMatchObject({ ok: false });
    }
    expect(results).toEqual([]);
  });

  it("위험 가전(전자레인지) AS 전화도 실제 폰으로 가는 답은 정한 승인 질문이다(모델 글에 위험 가전 이름이 나와도)", async () => {
    const { agent } = serviceAgent(null);
    const r = await agent.chat("phone", "전자레인지가 안 돼서 AS 불러 줘", { heard: true });
    expect(r.pendingConfirmations).toEqual([expect.objectContaining({ deviceLabel: "전자레인지", reason: "데워지지 않음. LG전자 서비스센터에 전화할까요?" })]);
    expect(r.reply).toBe("데워지지 않음. LG전자 서비스센터에 전화할까요?");
  });

  it("call_service는 서버 안 에이전트에만 있다(MCP 목록에 없음). 받는 이 칸이 없다. PAM 행동 목록(src/act/tasks.ts)에는 넣지 않는다", () => {
    const tool = AGENT_TOOLS.find((t) => t.name === "call_service")!;
    expect(Object.keys(tool.schema.shape).sort()).toEqual(["device_id", "error_code", "kind", "person", "problem"]);
    expect(MCP_TOOLS.map((t) => t.name)).not.toContain("call_service");
    expect(readFileSync(new URL("../src/act/tasks.ts", import.meta.url), "utf8")).not.toMatch(/call_service|AS센터|보호자/);
  });
});
