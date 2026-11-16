// 생각 말풍선 두 줄(src/brain/thought.ts): 행동을 고른 PAM 판단의 관찰·생각·행동을 작은 모델 한 번으로 「본 것」·「그래서」 두 줄로 고친다.
// 모델은 VLM과 같은 OpenAI 호환 통로(src/infer/)에 모델 이름만 바꾼 것이고, 시험은 그 주소 자리에 가짜 서버(tests/helpers/thought.ts)를 붙인다.
// 판단 처리(thoughtFeed)는 모델 답을 기다리지 않고, 두 줄이 오면 그 판단 id로 대시보드에 보낸다.
import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { THOUGHT_TIMEOUT_MS, ThoughtWriter, thoughtFeed, type ThoughtLines } from "../src/brain/thought.js";
import type { BrainLog, ThoughtEvent } from "../src/contract/events.js";
import { createInference } from "../src/infer/inference.js";
import { LINES, isThought, thoughtReplies, type ThoughtReplies } from "./helpers/thought.js";

/** 실제 PAM 판단에서 나온 글(2026-11-16): 안쪽 규칙 이름(left_cup)과 따옴표가 섞여 길다. */
const REAL = {
  observation: "사용자가 컵을 식탁에 두고 자리를 비웠고 컵 cup_1은 비어 있지 않다.",
  reasoning: "메모리의 left_cup 규칙은 '사용자가 컵을 두고 자리를 비웠고 아무도 컵을 들거나 만지지 않는다'일 때 컵 치우기를 실행하지만, 현재 컵이 비어 있지 않아도 치우기 조건은 충족되므로 즉시 컵 치우기가 적절하다.",
  action: "컵 치우기",
};

let f: FakeServer | undefined;
afterEach(async () => { await f?.close(); f = undefined; });

async function writerOn(replies: ThoughtReplies, env: Record<string, string> = {}, timeoutMs?: number) {
  f = await startFakeOpenAI({ reply: (b) => replies.reply(b) });
  const { thought } = createInference({ VLM_BASE_URL: `${f.url}/v1`, ...env });
  return new ThoughtWriter({ chat: thought, ...(timeoutMs ? { timeoutMs } : {}) });
}
const thoughtRequests = () => f!.requests.filter((r) => r.method === "POST" && isThought(r.body));

describe("생각 말풍선 두 줄 쓰기", () => {
  it.each(["mock", "live"])("%s: 관찰·생각·행동을 글로만(사진 없음) 같은 VLM 주소 자리에 보내고 두 줄을 받는다", async (mode) => {
    const replies = thoughtReplies();
    const writer = await writerOn(replies, { INFERENCE_MODE: mode });
    expect(await writer.write(REAL)).toEqual(LINES);
    const [req] = thoughtRequests();
    expect(req!.path).toBe("/v1/chat/completions");
    expect(req!.body.model).toBe(mode === "mock" ? "gpt-5.4-nano" : "vlm");
    // mock만 OpenAI 제공자 칸(reasoning_effort)을 더 보낸다
    expect(req!.body.reasoning_effort).toBe(mode === "mock" ? "none" : undefined);
    expect(req!.body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "thought_lines", strict: true } });
    expect(req!.body.response_format.json_schema.schema).toMatchObject({ required: ["seen", "why"], additionalProperties: false });
    const messages = req!.body.messages as { role: string; content: unknown }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    for (const m of messages) expect(typeof m.content, "글만 보낸다").toBe("string");
    expect(JSON.stringify(req!.body)).not.toMatch(/image_url|data:image/);
    const user = String(messages[1]!.content);
    for (const part of [REAL.observation, REAL.reasoning, REAL.action]) expect(user).toContain(part);
  });

  it("지시문은 「본 것」(무엇을 봤는지)·「그래서」(왜 그 행동인지)를 줄마다 40자 안팎 쉬운 한국어로 쓰고, 규칙 id·영어·따옴표를 빼라고 한다", async () => {
    const replies = thoughtReplies();
    await (await writerOn(replies)).write(REAL);
    const system = String(replies.bodies[0]!.messages[0].content);
    for (const word of ["본 것", "그래서", "40자", "쉬운 한국어", "규칙 id", "영어", "따옴표"]) expect(system, word).toContain(word);
  });

  it("관찰·생각·행동이 모두 같으면 다시 부르지 않는다: 동시에 와도, 다 받은 뒤에 와도 한 번이다. 하나라도 다르면 새로 부른다", async () => {
    // 「본 것」은 받은 관찰을 따른다: 관찰이 다른 장면에 앞 장면의 「본 것」을 다시 쓰면 안 된다
    const seenOf = (o: string) => o.replace(/[a-z_\d.]/g, "").trim();
    const observed = (b: any) => String(b.messages[1].content).split("\n")[0]!.replace("관찰: ", "");
    const writer = await writerOn(thoughtReplies((b) => JSON.stringify({ seen: seenOf(observed(b)), why: LINES.why })));
    const [a, b] = await Promise.all([writer.write(REAL), writer.write(REAL)]);
    expect([a, b]).toEqual([{ seen: seenOf(REAL.observation), why: LINES.why }, { seen: seenOf(REAL.observation), why: LINES.why }]);
    expect(await writer.write(REAL)).toEqual(a);
    expect(thoughtRequests()).toHaveLength(1);
    const other = "사람이 컵을 싱크대 옆에 두고 떠났다";
    expect(await writer.write({ ...REAL, observation: other })).toEqual({ seen: other, why: LINES.why });
    expect(thoughtRequests()).toHaveLength(2);
    await writer.write({ ...REAL, reasoning: "컵이 비어 있어 치운다." });
    await writer.write({ ...REAL, action: "컵 그대로 두기" });
    expect(thoughtRequests()).toHaveLength(4);
  });

  it("모델 글의 따옴표·끝 마침표·겹친 빈칸은 정리하고, 영어 낱말·밑줄 이름이 남거나 빈 줄이면 쓰지 않는다(null)", async () => {
    const answers: Record<string, unknown> = {
      quoted: { seen: " 사람이 「컵」을  식탁에 두고 떠났어요. ", why: "\"치우는 습관\"대로 컵을 치울게요" },
      english: { seen: "left_cup 상태예요", why: "컵을 치울게요" },
      word: { seen: "사람이 cup을 두고 떠났어요", why: "컵을 치울게요" },
      empty: { seen: "  ", why: "컵을 치울게요" },
      tv: { seen: "사람이 TV를 보고 있어요", why: "더워 보여 에어컨을 켤게요" },
    };
    const writer = await writerOn(thoughtReplies((b) => JSON.stringify(answers[/생각: (\w+)/.exec(String(b.messages[1].content))![1]!])));
    const of = (k: string) => writer.write({ ...REAL, reasoning: k });
    expect(await of("quoted")).toEqual({ seen: "사람이 컵을 식탁에 두고 떠났어요", why: "치우는 습관대로 컵을 치울게요" });
    for (const k of ["english", "word", "empty"]) expect(await of(k), k).toBeNull();
    expect(await of("tv")).toEqual(answers.tv);
  });

  it("형식이 틀리거나 연결이 안 되거나 늦으면(제한 시간) null이다. 실패는 기억하지 않아 같은 생각이 다시 오면 다시 부른다", async () => {
    let bad = true;
    const replies = thoughtReplies((b) => (bad ? "두 줄이 아님" : JSON.stringify(LINES)));
    const writer = await writerOn(replies, {}, 300);
    expect(await writer.write(REAL)).toBeNull();
    bad = false;
    replies.hold();
    const t0 = Date.now();
    expect(await writer.write(REAL)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(3000);
    replies.release();
    expect(await writer.write(REAL)).toEqual(LINES);
    expect(thoughtRequests()).toHaveLength(3);
    const closed = new ThoughtWriter({ chat: createInference({ VLM_BASE_URL: "http://127.0.0.1:9/v1" }).thought });
    expect(await closed.write(REAL)).toBeNull();
    expect(THOUGHT_TIMEOUT_MS).toBe(8000);
  });
});

type Decision = Extract<BrainLog, { type: "decision" }>;
const decision = (id: string, action: string | null, status: "valid" | "failed" = "valid"): Decision => ({
  type: "decision", at_ms: 1, id, seq: Number(id.split("-")[1]), text_sent: "", status,
  prediction: status === "valid" ? { observation: REAL.observation, reasoning: `${REAL.reasoning} ${id}`, task_index: action ? 0 : -1 } : null,
  action, memory_version: 1, world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
});

/** 답을 손으로 내는 쓰기: 부른 차례대로 끝낼 수 있다. */
function manualWriter() {
  const calls: { input: { observation: string; reasoning: string; action: string }; done: (l: ThoughtLines | null) => void }[] = [];
  return { calls, write: (input: { observation: string; reasoning: string; action: string }) => new Promise<ThoughtLines | null>((done) => { calls.push({ input, done }); }) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("생각 말풍선 두 줄 보내기(thoughtFeed)", () => {
  it("행동을 고른 유효 판단은 그 자리에서 끝나고(모델 답을 기다리지 않음), 두 줄이 오면 그 판단 id로 보낸다. 마지막 두 줄은 새로 붙은 대시보드에 다시 보낼 수 있다", async () => {
    const w = manualWriter();
    const sent: ThoughtEvent[] = [];
    const feed = thoughtFeed({ writer: w, send: (m) => sent.push(m) });
    expect(feed.decision(decision("pam-1", "컵 치우기"))).toBeUndefined();
    expect(w.calls.map((c) => c.input)).toEqual([{ observation: REAL.observation, reasoning: `${REAL.reasoning} pam-1`, action: "컵 치우기" }]);
    expect(sent).toEqual([]);
    expect(feed.last()).toBeNull();
    w.calls[0]!.done(LINES);
    await tick();
    expect(sent).toEqual([{ type: "thought", id: "pam-1", ...LINES }]);
    expect(feed.last()).toEqual({ type: "thought", id: "pam-1", ...LINES });
  });

  it("대기 판단은 부르지 않고 지난 두 줄도 지운다. 실패 판단은 부르지 않고 지금 두 줄을 그대로 둔다(대시보드도 실패를 버린다)", async () => {
    const w = manualWriter();
    const sent: ThoughtEvent[] = [];
    const feed = thoughtFeed({ writer: w, send: (m) => sent.push(m) });
    feed.decision(decision("pam-1", "컵 치우기"));
    w.calls[0]!.done(LINES);
    await tick();
    feed.decision(decision("pam-2", null, "failed"));
    expect(feed.last()).toMatchObject({ id: "pam-1" });
    feed.decision(decision("pam-3", null));
    expect(feed.last()).toBeNull();
    expect(w.calls).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("다음 판단이 온 뒤에 늦게 온 앞 판단의 두 줄은 보내지 않는다. 못 만든 두 줄(null)도 보내지 않는다", async () => {
    const w = manualWriter();
    const sent: ThoughtEvent[] = [];
    const feed = thoughtFeed({ writer: w, send: (m) => sent.push(m) });
    feed.decision(decision("pam-1", "컵 치우기"));
    feed.decision(decision("pam-2", "컵 치우기"));
    w.calls[0]!.done(LINES);
    await tick();
    expect(sent).toEqual([]);
    w.calls[1]!.done(null);
    await tick();
    expect(sent).toEqual([]);
    expect(feed.last()).toBeNull();
  });
});
