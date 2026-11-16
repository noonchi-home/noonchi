// 생각 말풍선 메시지(src/brain/thought.ts): 유효 판단마다(대기 포함) 작은 모델에 이번 판단(관찰·생각·행동 또는 대기)과 이미 올린 최근 메시지를 주고,
// 새로 올릴 짧은 문장 0~2개를 받는다. 카톡처럼 대시보드 말풍선에 차례로 쌓인다(2026-11-16 회의 「정한 것」 5).
// 모델은 VLM과 같은 OpenAI 호환 통로(src/infer/)에 모델 이름만 바꾼 것이고, 시험은 그 주소 자리에 가짜 서버(tests/helpers/thought.ts)를 붙인다.
// 판단 처리(thoughtFeed)는 모델 답을 기다리지 않는다. 메시지는 기록 DB(thought, 집 id 포함)에 남아 다시 붙은 대시보드·다시 띄운 서버에도 최근 것을 다시 보낸다.
import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { HistoryDb } from "../src/brain/history/db.js";
import {
  THOUGHT_KEEP, THOUGHT_KEEP_MS, THOUGHT_TIMEOUT_MS, ThoughtWriter, lastStoredThoughts, storeThought, thoughtFeed, type ThoughtInput,
} from "../src/brain/thought.js";
import type { BrainLog, ThoughtEvent, ThoughtMessage } from "../src/contract/events.js";
import { createInference } from "../src/infer/inference.js";
import { CUP_MESSAGES, WAIT_MESSAGE, chatAnswer, isThought, thoughtAsk, thoughtReplies, type ThoughtReplies } from "./helpers/thought.js";

/** 실제 PAM 판단에서 나온 글(2026-11-16): 안쪽 규칙 이름(left_cup)과 따옴표가 섞여 길다. */
const REAL = {
  observation: "사용자가 컵을 식탁에 두고 자리를 비웠고 컵 cup_1은 비어 있지 않다.",
  reasoning: "메모리의 left_cup 규칙은 '사용자가 컵을 두고 자리를 비웠고 아무도 컵을 들거나 만지지 않는다'일 때 컵 치우기를 실행하지만, 현재 컵이 비어 있지 않아도 치우기 조건은 충족되므로 즉시 컵 치우기가 적절하다.",
  action: "컵 치우기",
};
const ASK: ThoughtInput = { ...REAL, recent: [] };

let f: FakeServer | undefined;
afterEach(async () => { await f?.close(); f = undefined; });

async function writerOn(replies: ThoughtReplies, env: Record<string, string> = {}, timeoutMs?: number) {
  f = await startFakeOpenAI({ reply: (b) => replies.reply(b) });
  const { thought } = createInference({ VLM_BASE_URL: `${f.url}/v1`, ...env });
  return new ThoughtWriter({ chat: thought, ...(timeoutMs ? { timeoutMs } : {}) });
}
const thoughtRequests = () => f!.requests.filter((r) => r.method === "POST" && isThought(r.body));

describe("생각 말풍선 메시지 쓰기", () => {
  it.each(["mock", "live"])("%s: 이번 판단과 이미 올린 메시지를 글로만(사진 없음) 같은 VLM 주소 자리에 보내고 새 메시지를 받는다", async (mode) => {
    const replies = thoughtReplies();
    const writer = await writerOn(replies, { INFERENCE_MODE: mode });
    expect(await writer.write({ ...ASK, recent: [CUP_MESSAGES[0]!] })).toEqual([CUP_MESSAGES[1]]);
    const [req] = thoughtRequests();
    expect(req!.path).toBe("/v1/chat/completions");
    expect(req!.body.model).toBe(mode === "mock" ? "gpt-5.4-nano" : "vlm");
    // mock만 OpenAI 제공자 칸(reasoning_effort)을 더 보낸다
    expect(req!.body.reasoning_effort).toBe(mode === "mock" ? "none" : undefined);
    expect(req!.body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "thought_messages", strict: true } });
    expect(req!.body.response_format.json_schema.schema).toMatchObject({ required: ["messages"], additionalProperties: false, properties: { messages: { type: "array", items: { type: "string" } } } });
    const messages = req!.body.messages as { role: string; content: unknown }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    for (const m of messages) expect(typeof m.content, "글만 보낸다").toBe("string");
    expect(JSON.stringify(req!.body)).not.toMatch(/image_url|data:image/);
    const ask = thoughtAsk(req!.body);
    for (const part of [REAL.observation, REAL.reasoning]) expect(ask.text).toContain(part);
    expect([ask.decision, ask.recent]).toEqual([REAL.action, [CUP_MESSAGES[0]]]);
  });

  it("대기 판단은 「판단: 대기」로, 이미 올린 메시지가 없으면 「없음」으로 보낸다", async () => {
    const replies = thoughtReplies();
    const writer = await writerOn(replies);
    expect(await writer.write({ ...ASK, action: null })).toEqual([WAIT_MESSAGE]);
    const ask = thoughtAsk(replies.bodies[0]);
    expect(ask.decision).toBe("대기");
    expect(ask.text).toContain("이미 올린 메시지: 없음");
  });

  it("지시문: 메시지 0~2개, 30자 안팎 해요체, 바뀐 것이 없으면 빈 목록(같은 말 되풀이 안 함), 행동이면 본 것 → 결정적인 근거 → 무엇을 할지, 안쪽 이름·영어·따옴표 없음", async () => {
    const replies = thoughtReplies();
    await (await writerOn(replies)).write(ASK);
    const system = String(replies.bodies[0]!.messages[0].content);
    for (const word of ["0~2개", "30자", "해요체", "빈 목록", "되풀이", "무엇을 봤는지", "결정적인 근거 하나", "무엇을 할지", "대기", "규칙 id", "영어", "따옴표"]) {
      expect(system, word).toContain(word);
    }
  });

  it("모델 글은 따옴표·끝 마침표·겹친 빈칸을 정리하고, 영어 낱말·밑줄 이름이 남거나 빈 글은 그 메시지만 뺀다. 두 개까지, 이미 올린 것·서로 같은 것은 뺀다. 빈 목록은 빈 목록이다", async () => {
    const answers: Record<string, unknown> = {
      mixed: { messages: [" 사람이 「컵」을  두고 떠났어요. ", "left_cup 상태예요", "  "] },
      many: { messages: ["하나예요", "둘이에요", "셋이에요"] },
      again: { messages: ["사람이 컵을 두고 자리를 떠났어요", "하나예요", "하나예요."] },
      none: { messages: [] },
    };
    const writer = await writerOn(thoughtReplies((b) => JSON.stringify(answers[/생각: (\w+)/.exec(thoughtAsk(b).text)![1]!])));
    const of = (k: string, recent: string[] = []) => writer.write({ ...ASK, reasoning: k, recent });
    expect(await of("mixed")).toEqual(["사람이 컵을 두고 떠났어요"]);
    expect(await of("many")).toEqual(["하나예요", "둘이에요"]);
    expect(await of("again", ["사람이 컵을 두고 자리를 떠났어요"])).toEqual(["하나예요"]);
    expect(await of("none")).toEqual([]);
  });

  it("형식이 틀리거나 연결이 안 되거나 늦으면(제한 시간) null이다. 끊으면(signal) 바로 null이다", async () => {
    let bad = true;
    const replies = thoughtReplies((b) => (bad ? "메시지가 아님" : chatAnswer(b)));
    const writer = await writerOn(replies, {}, 300);
    expect(await writer.write(ASK)).toBeNull();
    bad = false;
    replies.hold();
    const t0 = Date.now();
    expect(await writer.write(ASK)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(3000);
    const stop = new AbortController();
    const going = writer.write(ASK, stop.signal);
    stop.abort();
    expect(await going).toBeNull();
    replies.release();
    expect(await writer.write(ASK)).toEqual(CUP_MESSAGES);
    const closed = new ThoughtWriter({ chat: createInference({ VLM_BASE_URL: "http://127.0.0.1:9/v1" }).thought });
    expect(await closed.write(ASK)).toBeNull();
    expect(THOUGHT_TIMEOUT_MS).toBe(8000);
  });
});

type Decision = Extract<BrainLog, { type: "decision" }>;
const decision = (id: string, action: string | null, status: "valid" | "failed" = "valid", observation = REAL.observation): Decision => ({
  type: "decision", at_ms: 1, id, seq: Number(id.split("-")[1]), text_sent: "", status,
  prediction: status === "valid" ? { observation, reasoning: `${REAL.reasoning} ${id}`, task_index: action ? 0 : -1 } : null,
  action, memory_version: 1, world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
});

/** 답을 손으로 내는 쓰기: 부른 차례대로 끝낼 수 있다. 받은 입력과 끊기 신호(signal)도 둔다. */
function manualWriter() {
  const calls: { input: ThoughtInput; signal?: AbortSignal; done: (m: string[] | null) => void }[] = [];
  return {
    calls,
    write: (input: ThoughtInput, signal?: AbortSignal) => new Promise<string[] | null>((done) => { calls.push({ input, signal, done }); }),
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const texts = (events: ThoughtEvent[]) => events.flatMap((e) => e.messages.map((m) => m.text));

describe("생각 말풍선 메시지 보내기(thoughtFeed)", () => {
  it("유효 판단(행동·대기)마다 모델을 부르고 그 자리에서 끝난다. 새 메시지가 오면 id·판단 id·시각을 붙여 보내고 하나씩 기록하며, 최근 것은 다시 보낼 수 있다", async () => {
    const w = manualWriter();
    const sent: ThoughtEvent[] = [];
    const kept: ThoughtMessage[] = [];
    let now = 1000;
    const feed = thoughtFeed({ writer: w, send: (m) => sent.push(m), record: (m) => kept.push(m), clock: () => now });
    expect(feed.decision(decision("pam-1", null))).toBeUndefined();
    expect(w.calls[0]!.input).toEqual({ observation: REAL.observation, reasoning: `${REAL.reasoning} pam-1`, action: null, recent: [] });
    expect([sent, feed.last()]).toEqual([[], null]);
    w.calls[0]!.done([WAIT_MESSAGE]);
    await tick();
    now = 2000;
    feed.decision(decision("pam-2", REAL.action));
    expect(w.calls[1]!.input.recent).toEqual([WAIT_MESSAGE]);
    w.calls[1]!.done(CUP_MESSAGES);
    await tick();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.messages).toEqual(CUP_MESSAGES.map((text, i) => ({ id: `pam-2@2000:${i}`, text, at_ms: 2000, decision: "pam-2" })));
    expect(kept.map((m) => m.text)).toEqual([WAIT_MESSAGE, ...CUP_MESSAGES]);
    expect(feed.last()).toEqual({ type: "thought", messages: kept });
  });

  it("바뀐 것이 없으면(빈 목록) 보내지 않는다. 이미 올린 말은 다시 보내지 않는다. 같은 판단 글(관찰·생각·행동)이 다시 오면 모델을 부르지 않는다", async () => {
    const w = manualWriter();
    const sent: ThoughtEvent[] = [];
    const feed = thoughtFeed({ writer: w, send: (m) => sent.push(m) });
    feed.decision(decision("pam-1", null));
    w.calls[0]!.done([WAIT_MESSAGE]);
    await tick();
    feed.decision({ ...decision("pam-2", null), prediction: decision("pam-1", null).prediction });
    expect(w.calls).toHaveLength(1);
    feed.decision(decision("pam-3", null));
    w.calls[1]!.done([]);
    await tick();
    feed.decision(decision("pam-4", null));
    w.calls[2]!.done([WAIT_MESSAGE]);
    await tick();
    expect(texts(sent)).toEqual([WAIT_MESSAGE]);
  });

  it("최근 메시지는 THOUGHT_KEEP개까지 두고 그만큼 모델에 준다", async () => {
    const w = manualWriter();
    const feed = thoughtFeed({ writer: w, send: () => {} });
    for (let i = 1; i <= 4; i++) {
      feed.decision(decision(`pam-${i}`, null, "valid", `관찰 ${i}`));
      w.calls[i - 1]!.done([`메시지 ${i}가`, `메시지 ${i}나`]);
      await tick();
    }
    expect(THOUGHT_KEEP).toBe(5);
    expect(feed.last()!.messages.map((m) => m.text)).toEqual(["메시지 2나", "메시지 3가", "메시지 3나", "메시지 4가", "메시지 4나"]);
    feed.decision(decision("pam-5", null, "valid", "관찰 5"));
    expect(w.calls[4]!.input.recent).toEqual(["메시지 2나", "메시지 3가", "메시지 3나", "메시지 4가", "메시지 4나"]);
  });

  it("부르는 중에 같은 행동(또는 대기) 판단이 오면 부르지 않는다. 다른 행동·대기로 바뀌면 앞 요청을 끊고(signal) 새로 부르며, 늦게 온 앞 답은 버린다", async () => {
    const w = manualWriter();
    const sent: ThoughtEvent[] = [];
    const feed = thoughtFeed({ writer: w, send: (m) => sent.push(m) });
    feed.decision(decision("pam-1", null));
    feed.decision(decision("pam-2", null));
    expect(w.calls).toHaveLength(1);
    feed.decision(decision("pam-3", REAL.action));
    expect(w.calls).toHaveLength(2);
    expect(w.calls[0]!.signal?.aborted).toBe(true);
    w.calls[0]!.done([WAIT_MESSAGE]);
    w.calls[1]!.done(CUP_MESSAGES);
    await tick();
    expect(texts(sent)).toEqual(CUP_MESSAGES);
    expect(sent[0]!.messages[0]!.decision).toBe("pam-3");
  });

  it("판단 실패는 부르지 않는다. 모델이 실패하면(null) 메시지 없이 넘어가고 다음 판단에서 다시 부른다", async () => {
    const w = manualWriter();
    const sent: ThoughtEvent[] = [];
    const feed = thoughtFeed({ writer: w, send: (m) => sent.push(m) });
    feed.decision(decision("pam-1", null, "failed"));
    expect(w.calls).toHaveLength(0);
    feed.decision(decision("pam-2", REAL.action));
    w.calls[0]!.done(null);
    await tick();
    expect(sent).toEqual([]);
    feed.decision(decision("pam-3", REAL.action));
    expect(w.calls).toHaveLength(2);
  });

  it("닫으면(close) 나가 있는 요청을 끊고(signal), 늦게 온 답은 보내지도 기록하지도 않는다. 닫은 뒤 판단은 부르지 않는다", async () => {
    const w = manualWriter();
    const sent: ThoughtEvent[] = [];
    const kept: ThoughtMessage[] = [];
    const feed = thoughtFeed({ writer: w, send: (m) => sent.push(m), record: (m) => kept.push(m) });
    feed.decision(decision("pam-1", REAL.action));
    expect(w.calls[0]!.signal?.aborted).toBe(false);
    feed.close();
    expect(w.calls[0]!.signal?.aborted).toBe(true);
    w.calls[0]!.done(CUP_MESSAGES);
    await tick();
    expect([sent, kept]).toEqual([[], []]);
    feed.decision(decision("pam-2", REAL.action));
    expect(w.calls).toHaveLength(1);
  });

  it("닫힌 기록 DB에 쓰다 던지거나, 보내기가 던지거나, 쓰기가 거절돼도 처리되지 않은 거절이 생기지 않는다", async () => {
    const rejected: unknown[] = [];
    const on = (e: unknown) => { rejected.push(e); };
    process.on("unhandledRejection", on);
    try {
      const db = HistoryDb.open(":memory:");
      db.close();
      const w = manualWriter();
      const feed = thoughtFeed({ writer: w, send: () => { throw new Error("끊긴 소켓"); }, record: (m) => storeThought(db, "mokryeon_180b", m) });
      feed.decision(decision("pam-1", REAL.action));
      w.calls[0]!.done(CUP_MESSAGES);
      const failing = thoughtFeed({ writer: { write: () => Promise.reject(new Error("끊김")) }, send: () => {} });
      failing.decision(decision("pam-1", REAL.action));
      await new Promise((r) => setTimeout(r, 30));
      expect(rejected).toEqual([]);
      expect(feed.last()!.messages.map((m) => m.text)).toEqual(CUP_MESSAGES);
    } finally {
      process.off("unhandledRejection", on);
    }
  });

  it("기록에서 읽은 최근 메시지(seed)로 시작한다: 바로 다시 보낼 수 있고 모델에도 이미 올린 메시지로 준다", () => {
    const w = manualWriter();
    const seed: ThoughtMessage[] = [{ id: "pam-9@1:0", text: CUP_MESSAGES[0]!, at_ms: 1, decision: "pam-9" }];
    const feed = thoughtFeed({ writer: w, send: () => {}, seed });
    expect(feed.last()).toEqual({ type: "thought", messages: seed });
    feed.decision(decision("pam-1", REAL.action));
    expect(w.calls[0]!.input.recent).toEqual([CUP_MESSAGES[0]]);
  });
});

describe("생각 메시지 기록", () => {
  const HOME = "mokryeon_180b";
  const msg = (n: number, at: number): ThoughtMessage => ({ id: `pam-${n}@${at}:0`, text: `메시지 ${n}`, at_ms: at, decision: `pam-${n}` });

  it("메시지는 하나씩 기록 DB(thought)에 집 id와 함께 남고, 다시 띄울 때 THOUGHT_KEEP_MS 안의 이 집 것 최근 THOUGHT_KEEP개를 차례대로 읽는다", () => {
    const db = HistoryDb.open(":memory:");
    expect(lastStoredThoughts(db, HOME, 1_000_000)).toEqual([]);
    for (let n = 1; n <= 7; n++) storeThought(db, HOME, msg(n, 1_000_000 + n));
    storeThought(db, "apartment", msg(8, 1_000_008));
    const [row] = db.list({ kinds: ["thought"], latest: true, limit: 1 });
    expect(row).toMatchObject({ kind: "thought", at_ms: 1_000_008, subject: "pam-8", text: "메시지 8", data: { home: "apartment", id: "pam-8@1000008:0" } });
    expect(lastStoredThoughts(db, HOME, 1_000_010)).toEqual([3, 4, 5, 6, 7].map((n) => msg(n, 1_000_000 + n)));
    expect(lastStoredThoughts(db, "apartment", 1_000_010)).toEqual([msg(8, 1_000_008)]);
    expect(lastStoredThoughts(db, HOME, 1_000_007 + THOUGHT_KEEP_MS)).toEqual([msg(7, 1_000_007)]);
    expect(lastStoredThoughts(db, HOME, 1_000_008 + THOUGHT_KEEP_MS)).toEqual([]);
    expect(THOUGHT_KEEP_MS).toBe(10 * 60_000);
  });
});
