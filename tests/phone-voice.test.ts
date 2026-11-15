// 실제 폰 말: 명령·질문이 떠 있으면 폰의 말(say)을 먼저 답으로 맞춰 보고(「완료」「다 했어」, 질문 답, 「그만」), 맞으면 에이전트로 보내지 않는다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { matchChoice } from "../src/act/tasks.js";
import { ASK_PROMPT, STEP_DONE, STOP } from "../src/act/prompts.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { createPhoneServer, type PhoneServer } from "../src/phone/server.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { ScriptedDetector, det } from "./helpers/detectors.js";
import { HOME_SCRIPT, startFakeLlm, type FakeLlm } from "./helpers/llm.js";
import { CUP_SCRIPTS, planCalls } from "./helpers/planner.js";
import { startFakePam, type FakePam } from "./helpers/pam.js";
import { BOX_START, BOX_WALLS } from "./helpers/align.js";
import { heardAtOf, openPhone, openWebSocket } from "./helpers/ws.js";


type Msg = Record<string, any>;
const SYNC = { landmarks: [], walls: BOX_WALLS, start: BOX_START };
let phone: PhoneServer | undefined;
let ws: WebSocket | undefined;
afterEach(async () => {
  ws?.close();
  ws = undefined;
  await phone?.close();
  phone = undefined;
});

async function until(list: Msg[], n: number, ms = 3000): Promise<void> {
  for (const end = Date.now() + ms; list.length < n; ) {
    if (Date.now() > end) throw new Error("답이 오지 않았습니다");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("폰 음성 질문", () => {
  it("명령이 떠 있으면 말을 답으로 받고 에이전트로 보내지 않는다. 맞지 않는 말은 에이전트로 간다", async () => {
    const said: string[] = [];
    const answered: string[] = [];
    phone = createPhoneServer({
      sync: SYNC, onEye: () => {}, log: () => {},
      onSay: async (t) => { said.push(t); return { reply: "에이전트", pending: [] }; },
      onAnswer: (t) => { answered.push(t); return t.includes("완료") ? { handled: true, reply: "" } : { handled: false }; },
    });
    const { port } = await phone.listen(0, "127.0.0.1");
    const replies: Msg[] = [];
    ws = await openPhone(`ws://127.0.0.1:${port}/phone/events`, { setup: (s) => s.on("message", (d) => {
      const m = JSON.parse(String(d)) as Msg;
      if (m.type === "reply") replies.push(m);
    }) });
    ws.send(JSON.stringify({ type: "say", text: "  완료 " }));
    await until(replies, 1);
    ws.send(JSON.stringify({ type: "say", text: "불 꺼 줘" }));
    await until(replies, 2);
    expect(replies.map((m) => m.text)).toEqual(["", "에이전트"]);
    // 명령의 답에는 승인 대기 칸을 싣지 않는다(실제 폰이 승인 대기 목록을 그대로 둔다)
    expect(replies[0]).not.toHaveProperty("pending");
    expect(replies[1]).toMatchObject({ pending: [] });
    expect(answered).toEqual(["완료", "불 꺼 줘"]);
    expect(said).toEqual(["불 꺼 줘"]);
  });
});

describe("말과 선택지 맞추기", () => {
  const step = [STEP_DONE];
  const ask = ASK_PROMPT.choices;
  it("버튼 글이나 그 선택지의 말이 들어 있으면 그 선택지", () => {
    expect(matchChoice("완료", step)?.id).toBe("done");
    expect(matchChoice("응 다 했어", step)?.id).toBe("done");
    expect(matchChoice("이제 그만", [STOP])?.id).toBe("stop");
    expect(matchChoice("이따가 나중에 할게", step)).toBeNull();
    expect(matchChoice("치워 줘", ask)?.id).toBe("clear");
    expect(matchChoice("그냥 그대로 둬", ask)?.id).toBe("keep");
  });
  it("「완료」「다 했어」「그만」은 짧은 말 전체일 때만 맞춘다(늘 듣기의 주변 말에 걸리지 않게)", () => {
    for (const said of ["다 했어요", "응, 완료", "그만해요", "그만둬", "이제 그만!"]) expect(matchChoice(said, [STEP_DONE, STOP]), said).not.toBeNull();
    for (const said of ["그만큼 좋아", "그만이야", "숙제 다 했어?", "완료 버튼 어디 있어", "다 했어 그럼 밥 먹자"]) expect(matchChoice(said, [STEP_DONE, STOP]), said).toBeNull();
  });
  it("맞는 선택지가 없거나 빈 말이면 null", () => {
    expect(matchChoice("불 꺼 줘", step)).toBeNull();
    expect(matchChoice("  ", ask)).toBeNull();
  });
});

describe("startServer(BRAIN=1): 클로이드 질문을 폰 말로 답한다", () => {
  let srv: RunningServer | undefined;
  let fake: FakeServer | undefined;
  let pam: FakePam | undefined;
  let llm: FakeLlm | undefined;
  afterEach(async () => {
    await srv?.close();
    srv = undefined;
    await fake?.close();
    fake = undefined;
    await pam?.close();
    pam = undefined;
    await llm?.close();
    llm = undefined;
  });

  it("질문이 소리로 오고, 말한 답은 에이전트로 가지 않고 실행을 끝내며 반성 피드백으로 남는다. 답이 아닌 말은 피드백으로 남기지 않는다", async () => {
    fake = await startFakeOpenAI();
    llm = await startFakeLlm({ "TV 소리 좀 줄여 봐": ["알겠어요"] });
    pam = await startFakePam({ predict: () => ({ observation: "컵이 식탁에 있음", reasoning: "치울지 묻는다", task_index: 1 }) });
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, PAM_URL: pam.url, ...llm.env },
      brain: { detector: new ScriptedDetector(() => [det("cup", 0.9, [1, 1, 2, 1], 41)]) }, log: () => {},
    });
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const box: Msg[] = [];
    ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (s) => s.on("message", (d, bin) => { if (!bin) box.push(JSON.parse(String(d)) as Msg); }) });
    let n = 0;
    const asked = async () => {
      for (const end = Date.now() + 10_000; Date.now() < end; ) {
        const m = box.find((x) => x.type === "command");
        if (m) return m;
        ws!.send(encodeFramePacket({ kind: "engine", width: 4, height: 3, captured_at: Date.now(), time_err_ms: 0 }, Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("질문이 오지 않았습니다");
    };
    const ask = await asked();
    expect(ask).toEqual({ type: "command", id: expect.stringMatching(/^plan:pam-\d+$/), step: `${ask.id}:1`, text: "컵을 치울까요?", vision: null, target: null, speak: true,
      choices: [{ id: "clear", label: "치워 주세요" }, { id: "keep", label: "그대로 둬요" }] });
    const replies = async (n: number) => {
      for (const end = Date.now() + 5000; box.filter((m) => m.type === "reply").length < n; ) {
        if (Date.now() > end) throw new Error("답이 오지 않았습니다");
        await new Promise((r) => setTimeout(r, 20));
      }
      return box.filter((m) => m.type === "reply");
    };
    // 질문이 떠 있는 동안 들은 답이 아닌 말: 에이전트로 가고 피드백으로 남지 않는다
    ws.send(JSON.stringify({ type: "say", text: "TV 소리 좀 줄여 봐" }));
    expect((await replies(1))[0]).toMatchObject({ text: "알겠어요" });
    ws.send(JSON.stringify({ type: "say", text: "그냥 그대로 둬", at: heardAtOf(box) }));
    expect((await replies(2))[1]).toMatchObject({ text: "알겠어요. 그대로 둘게요" });
    const rows = srv.history.list({ kinds: ["feedback", "execution"] });
    expect(rows.filter((r) => r.kind === "feedback").map((r) => r.text)).toEqual(["그냥 그대로 둬 · 질문: 컵을 치울까요?"]);
    expect(rows.some((r) => r.kind === "execution" && r.subject === ask.id && r.text === "완료: 그대로 둬요")).toBe(true);
    expect(box.some((m) => m.type === "command_clear" && m.id === ask.id)).toBe(true);
  }, 30_000);
});

describe("startServer(BRAIN=1): 말 답은 말할 때 떠 있던 명령에만", () => {
  let srv: RunningServer | undefined;
  let fake: FakeServer | undefined;
  let pam: FakePam | undefined;
  let llm: FakeLlm | undefined;
  afterEach(async () => {
    await srv?.close();
    srv = undefined;
    await fake?.close();
    fake = undefined;
    await pam?.close();
    pam = undefined;
    await llm?.close();
    llm = undefined;
  });

  it("판본 없는 폰 탭은 실행을 막고 새로 고침을 안내한다: 그 탭에는 「화면을 새로 고쳐 주세요」가 가고 계획 명령은 가지 않으며 그 탭의 「완료」·confirm은 받지 않는다. 그 탭만 붙어 있으면 폰이 필요한 계획은 시작하지 않고 실행 기록에 남는다. 맞는 판본 탭이 붙으면 시작해 명령이 그 탭에 간다", async () => {
    fake = await startFakeOpenAI();
    llm = await startFakeLlm({});
    pam = await startFakePam({ predict: () => ({ observation: "컵이 식탁에 있음", reasoning: "치울지 묻는다", task_index: 1 }) });
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, PAM_URL: pam.url, ...llm.env },
      brain: { detector: new ScriptedDetector(() => [det("cup", 0.9, [1, 1, 2, 1], 41)]) }, log: () => {},
    });
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const old: Msg[] = [];
    const tab = await openWebSocket(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (s) => s.on("message", (d, bin) => { if (!bin) old.push(JSON.parse(String(d)) as Msg); }) });
    try {
      const rows = () => srv!.history.list({ kinds: ["execution"] });
      let n = 0;
      for (const end = Date.now() + 15_000; !rows().some((r) => r.text === "폰 화면 새로 고침 전이라 새 일을 미룸") && Date.now() < end; ) {
        tab.send(encodeFramePacket({ kind: "engine", width: 4, height: 3, captured_at: Date.now(), time_err_ms: 0 }, Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
        await new Promise((r) => setTimeout(r, 100));
      }
      for (const end = Date.now() + 3000; !old.some((m) => m.type === "command") && Date.now() < end; ) await new Promise((r) => setTimeout(r, 50));
      expect(old.filter((m) => m.type === "command")).toEqual([{ type: "command", id: "refresh", step: "refresh", text: "화면을 새로 고쳐 주세요", choices: [], vision: null, target: null, speak: true }]);
      const plan = rows().find((r) => r.text === "폰 화면 새로 고침 전이라 새 일을 미룸")!.subject!;
      tab.send(JSON.stringify({ type: "answer", id: plan, step: `${plan}:1`, choice: "keep" }));
      tab.send(JSON.stringify({ type: "confirm", token: "x", choice: "approve" }));
      await new Promise((r) => setTimeout(r, 300));
      expect(old.filter((m) => m.type === "reply")).toEqual([]);
      expect(rows().some((r) => r.subject === plan && r.text === "실행 중")).toBe(false);
      // 맞는 판본 탭이 붙으면 미뤘던 계획이 시작되고 명령이 그 탭에 간다(옛 탭에는 가지 않는다)
      const box: Msg[] = [];
      ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (s) => s.on("message", (d, bin) => { if (!bin) box.push(JSON.parse(String(d)) as Msg); }) });
      for (const end = Date.now() + 5000; !box.some((m) => m.type === "command" && m.id === plan) && Date.now() < end; ) await new Promise((r) => setTimeout(r, 50));
      expect(box.find((m) => m.type === "command" && m.id === plan)).toMatchObject({ text: "컵을 치울까요?" });
      expect(old.filter((m) => m.type === "command" && m.id !== "refresh")).toEqual([]);
    } finally {
      tab.close();
    }
  }, 40_000);

  it("말하는 사이 명령이 바뀌어 at이 다른 답 말은 버린다: 질문이 넘어가지 않고 에이전트로도 가지 않으며 들은 말로 남고 실행 기록에 「늦은 답이라 쓰지 않음」. at이 그 질문이면 받는다", async () => {
    fake = await startFakeOpenAI();
    llm = await startFakeLlm({});
    pam = await startFakePam({ predict: () => ({ observation: "컵이 식탁에 있음", reasoning: "치울지 묻는다", task_index: 1 }) });
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, PAM_URL: pam.url, ...llm.env },
      brain: { detector: new ScriptedDetector(() => [det("cup", 0.9, [1, 1, 2, 1], 41)]) }, log: () => {},
    });
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const box: Msg[] = [];
    ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (s) => s.on("message", (d, bin) => { if (!bin) box.push(JSON.parse(String(d)) as Msg); }) });
    let n = 0;
    let ask: Msg | undefined;
    for (const end = Date.now() + 10_000; !ask && Date.now() < end; ) {
      ask = box.find((x) => x.type === "command");
      ws.send(encodeFramePacket({ kind: "engine", width: 4, height: 3, captured_at: Date.now(), time_err_ms: 0 }, Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(ask).toMatchObject({ text: "컵을 치울까요?" });
    const replies = () => box.filter((m) => m.type === "reply");
    const agentCalls = llm.bodies().length;
    ws.send(JSON.stringify({ type: "say", text: "그냥 그대로 둬", at: { kind: "command", id: ask!.id, step: `${ask!.id}:0`, pending: [] } }));
    for (const end = Date.now() + 5000; replies().length < 1 && Date.now() < end; ) await new Promise((r) => setTimeout(r, 20));
    expect(replies()[0]).toEqual({ type: "reply", text: "" });
    expect(llm.bodies()).toHaveLength(agentCalls);
    const rows = () => srv!.history.list({ kinds: ["execution", "world"] });
    expect(rows().some((r) => r.kind === "execution" && r.subject === ask!.id && r.text === "완료: 그대로 둬요")).toBe(false);
    expect(rows().some((r) => r.kind === "execution" && r.text === "늦은 답이라 쓰지 않음")).toBe(true);
    expect(rows().some((r) => r.kind === "world" && r.text === "들은 말 있음")).toBe(true);
    ws.send(JSON.stringify({ type: "say", text: "그냥 그대로 둬", at: heardAtOf(box) }));
    for (const end = Date.now() + 5000; replies().length < 2 && Date.now() < end; ) await new Promise((r) => setTimeout(r, 20));
    expect(replies()[1]).toMatchObject({ text: "알겠어요. 그대로 둘게요" });
    expect(rows().some((r) => r.kind === "execution" && r.subject === ask!.id && r.text === "완료: 그대로 둬요")).toBe(true);
  }, 30_000);
});

describe("startServer(BRAIN=1): 말로 하는 승인은 at의 승인 token에만", () => {
  let srv: RunningServer | undefined;
  let fake: FakeServer | undefined;
  let pam: FakePam | undefined;
  let llm: FakeLlm | undefined;
  afterEach(async () => {
    ws?.close();
    ws = undefined;
    await srv?.close();
    srv = undefined;
    await fake?.close();
    fake = undefined;
    await pam?.close();
    pam = undefined;
    await llm?.close();
    llm = undefined;
  });

  it("현관문 승인 대기가 보이는 동안 「승인」이라고 하면 at에 계획 승인 질문이 같이 실려 와도 현관문만 확정되고, 계획 승인 질문·에어컨은 그대로다", async () => {
    fake = await startFakeOpenAI();
    llm = await startFakeLlm({ ...HOME_SCRIPT }, { ...CUP_SCRIPTS, "에어컨 켜기": () => [planCalls([{ kind: "device", label: "거실 에어컨 켜기", target: "ac_living", tool: "turn_on", timeout_s: 60 }])] });
    pam = await startFakePam({ predict: () => ({ observation: "더움", reasoning: "에어컨을 켠다", task_index: 3 }) });
    const rt = mkdtempSync(join(tmpdir(), "rt-"));
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: rt, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, PAM_URL: pam.url, ...llm.env },
      brain: { detector: new ScriptedDetector(() => [det("cup", 0.9, [1, 1, 2, 1], 41)]) }, log: () => {},
    });
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const box: Msg[] = [];
    ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (s) => s.on("message", (d, bin) => { if (!bin) box.push(JSON.parse(String(d)) as Msg); }) });
    let n = 0;
    let ask: Msg | undefined;
    for (const end = Date.now() + 10_000; !ask && Date.now() < end; ) {
      ask = box.find((x) => x.type === "command" && /:approve$/.test(x.step));
      ws.send(encodeFramePacket({ kind: "engine", width: 4, height: 3, captured_at: Date.now(), time_err_ms: 0 }, Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(ask).toMatchObject({ text: "에어컨 켜기를 할까요?" });
    const replies = () => box.filter((m) => m.type === "reply");
    const count = replies().length;
    ws.send(JSON.stringify({ type: "say", text: "현관문 열어줘", at: { kind: "command", id: ask!.id, step: ask!.step, pending: [] } }));
    for (const end = Date.now() + 5000; replies().length < count + 1 && Date.now() < end; ) await new Promise((r) => setTimeout(r, 20));
    const door = replies().at(-1)!.pending[0].token as string;
    // 예전 폰처럼 승인 대기와 그 뒤에 숨은 명령을 같이 실은 at
    ws.send(JSON.stringify({ type: "say", text: "승인", at: { kind: "command", id: ask!.id, step: ask!.step, pending: [door] } }));
    for (const end = Date.now() + 5000; replies().length < count + 2 && Date.now() < end; ) await new Promise((r) => setTimeout(r, 20));
    expect(srv.hub.get("door_main")?.twin.lock).toBe("unlocked");
    expect(srv.hub.get("ac_living")?.twin.power).toBe("off");
    expect(srv.history.list({ kinds: ["execution"] }).some((r) => r.subject === ask!.id && r.text === "실행 중")).toBe(false);
  }, 40_000);
});

describe("startServer: 실제 폰의 말로 하는 승인", () => {
  let srv: RunningServer | undefined;
  let llm: FakeLlm | undefined;
  afterEach(async () => {
    ws?.close();
    ws = undefined;
    await srv?.close();
    srv = undefined;
    await llm?.close();
    llm = undefined;
  });

  it("실제 폰은 늘 들으므로 주변의 '네'·'어'로는 가전 승인을 확정하지 않는다. '승인'은 말할 때 보인 대기 token이 하나일 때만 그 token을 확정하고, 그 밖에는 버린다(에이전트로도 가지 않음)", async () => {
    llm = await startFakeLlm({ ...HOME_SCRIPT });
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", ...llm.env }, log: () => {},
    });
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const replies: Msg[] = [];
    ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (s) => s.on("message", (d, bin) => {
      const m = bin ? null : (JSON.parse(String(d)) as Msg);
      if (m?.type === "reply") replies.push(m);
    }) });
    const lock = async () => srv!.hub.get("door_main")?.twin.lock;
    const say = (text: string, pending?: string[]) => ws!.send(JSON.stringify({ type: "say", text, ...(pending ? { at: { kind: "none", pending } } : {}) }));
    say("현관문 열어줘", []);
    await until(replies, 1, 5000);
    expect(replies[0]!.pending).toHaveLength(1);
    const door = replies[0]!.pending[0].token as string;
    for (const [i, said] of ["네", "어"].entries()) {
      say(said, [door]);
      await until(replies, i + 2, 5000);
      expect(await lock()).toBe("locked");
    }
    // 승인 대기 token을 싣지 않은 말(옛 탭)·보인 대기가 없는 말: 버린다
    const asked = llm.bodies().length;
    say("승인");
    say("승인", []);
    await until(replies, 5, 5000);
    expect(replies.slice(3).map((m) => m.text)).toEqual(["", ""]);
    expect(await lock()).toBe("locked");
    expect(llm.bodies()).toHaveLength(asked);
    say("승인", [door]);
    await until(replies, 6, 5000);
    expect(await lock()).toBe("unlocked");
  }, 30_000);

  it("들은 승인은 말할 때 보인 대기 token 하나만 답한다: 그사이 그 대기가 끝나고 다른 대기가 생겼으면 확정하지 않고, 둘 이상 보였으면 버린다. 보인 token이 아직 대기면 그것만 확정한다", async () => {
    llm = await startFakeLlm({ ...HOME_SCRIPT });
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", ...llm.env }, log: () => {},
    });
    const risky = srv.hub.list().find((d) => d.kind === "cooktop" || d.kind === "microwave")!;
    llm.script["그것도 켜 줘"] = [[["turn_on", { device_id: risky.id, reason: "켜 달라고 해서" }]], "켤까요?"];
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const replies: Msg[] = [];
    ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (s) => s.on("message", (d, bin) => {
      const m = bin ? null : (JSON.parse(String(d)) as Msg);
      if (m?.type === "reply") replies.push(m);
    }) });
    const say = (text: string, pending: string[]) => ws!.send(JSON.stringify({ type: "say", text, at: { kind: "none", pending } }));
    const power = () => srv!.hub.get(risky.id)?.twin.power;
    say("현관문 열어줘", []);
    await until(replies, 1, 5000);
    const a = replies[0]!.pending[0].token as string;
    // A는 단추로 거절해 끝나고, 그 뒤 B가 대기
    ws.send(JSON.stringify({ type: "confirm", token: a, choice: "reject" }));
    await until(replies, 2, 5000);
    say("그것도 켜 줘", []);
    await until(replies, 3, 5000);
    const b = (replies[2]!.pending as { token: string }[]).map((p) => p.token);
    expect(b).toHaveLength(1);
    const asked = llm.bodies().length;
    // A가 보일 때 말한 늦은 「승인」: B는 확정되지 않고 에이전트로도 가지 않는다
    say("승인", [a]);
    await until(replies, 4, 5000);
    expect(replies[3]).toEqual({ type: "reply", text: "" });
    expect(power()).not.toBe("on");
    // 둘 이상 보였으면 버린다
    say("승인", [a, b[0]!]);
    await until(replies, 5, 5000);
    expect(power()).not.toBe("on");
    expect(llm.bodies()).toHaveLength(asked);
    // 보인 token이 아직 대기면 그것만 확정한다
    say("승인", [b[0]!]);
    await until(replies, 6, 5000);
    expect(power()).toBe("on");
    expect(srv.hub.get("door_main")?.twin.lock).toBe("locked");
  }, 30_000);
});
