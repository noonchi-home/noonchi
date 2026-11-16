// 생각 말풍선 두 줄(src/brain/thought.ts): 행동을 고른 PAM 판단의 관찰·생각·행동을 작은 모델 한 번으로 「본 것」·「그래서」 두 줄로 고친다.
// 모델은 VLM과 같은 OpenAI 호환 통로(src/infer/)에 모델 이름만 바꾼 것이고, 시험은 그 주소 자리에 가짜 서버(tests/helpers/thought.ts)를 붙인다.
// 판단 처리(thoughtFeed)는 모델 답을 기다리지 않고, 두 줄이 오면 그 판단 id로 대시보드에 보낸다. 같은 행동이 이어지는 동안은 다시 부르지 않고
// 그 두 줄(왜 이 행동을 시작했는지)을 새 판단 id로 다시 보낸다. 두 줄은 기록 DB(thought)에도 남아 서버를 다시 띄워도 이어진다.
import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { HistoryDb } from "../src/brain/history/db.js";
import { THOUGHT_KEEP_MS, THOUGHT_TIMEOUT_MS, ThoughtWriter, lastStoredThought, storeThought, thoughtFeed, type ThoughtLines } from "../src/brain/thought.js";
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

  it("지시문은 「본 것」(무엇을 봤는지)·「그래서」(배운 습관이나 지금 장면 중 결정적인 근거 하나와 그래서 무엇을 할지)를 줄마다 40자 안팎 쉬운 한국어로 쓰고, 규칙 id·영어·따옴표를 빼라고 한다", async () => {
    const replies = thoughtReplies();
    await (await writerOn(replies)).write(REAL);
    const system = String(replies.bodies[0]!.messages[0].content);
    for (const word of ["본 것", "그래서", "결정적인 근거 하나", "무엇을 할지", "40자", "쉬운 한국어", "규칙 id", "영어", "따옴표"]) expect(system, word).toContain(word);
    // 시험 모델 답도 그 모양이다: 근거(습관)와 할 일
    expect(LINES.why).toMatch(/습관이라 .+게요$/);
  });

  it("쓰기는 기억해 두지 않는다: 부를 때마다 모델에 한 번 묻는다(같은 행동이 이어지는 동안 다시 묻지 않는 것은 thoughtFeed가 맡는다)", async () => {
    const writer = await writerOn(thoughtReplies());
    await Promise.all([writer.write(REAL), writer.write(REAL)]);
    expect(thoughtRequests()).toHaveLength(2);
  });

  it("모델 글의 따옴표·끝 마침표·겹친 빈칸은 정리하고, 영어 낱말·밑줄 이름이 남거나 빈 줄이면 쓰지 않는다(null)", async () => {
    const answers: Record<string, unknown> = {
      quoted: { seen: " 사람이 「컵」을  식탁에 두고 떠났어요. ", why: "\"치우는 습관\"이라 컵을 치울게요" },
      english: { seen: "left_cup 상태예요", why: "컵을 치울게요" },
      word: { seen: "사람이 cup을 두고 떠났어요", why: "컵을 치울게요" },
      empty: { seen: "  ", why: "컵을 치울게요" },
      tv: { seen: "사람이 TV를 보고 있어요", why: "더워 보여 에어컨을 켤게요" },
    };
    const writer = await writerOn(thoughtReplies((b) => JSON.stringify(answers[/생각: (\w+)/.exec(String(b.messages[1].content))![1]!])));
    const of = (k: string) => writer.write({ ...REAL, reasoning: k });
    expect(await of("quoted")).toEqual({ seen: "사람이 컵을 식탁에 두고 떠났어요", why: "치우는 습관이라 컵을 치울게요" });
    for (const k of ["english", "word", "empty"]) expect(await of(k), k).toBeNull();
    expect(await of("tv")).toEqual(answers.tv);
  });

  it("형식이 틀리거나 연결이 안 되거나 늦으면(제한 시간) null이다", async () => {
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
const CLEAR = "컵 치우기";
const WATER_TASK = "컵에 물 채워 주기";
const WATER = { seen: "사람이 먹는 중인데 컵이 비어 있어요", why: "식사 중 빈 컵이라 물을 채우라고 할게요" };
const shown = (id: string, action = CLEAR, lines: ThoughtLines = LINES): ThoughtEvent => ({ type: "thought", id, action, ...lines });

describe("생각 말풍선 두 줄 보내기(thoughtFeed)", () => {
  it("행동을 고른 유효 판단은 그 자리에서 끝나고(모델 답을 기다리지 않음), 두 줄이 오면 그 판단 id·행동으로 보내고 기록에 한 번 남긴다", async () => {
    const w = manualWriter();
    const sent: ThoughtEvent[] = [];
    const kept: ThoughtEvent[] = [];
    const feed = thoughtFeed({ writer: w, send: (m) => sent.push(m), record: (m) => kept.push(m) });
    expect(feed.decision(decision("pam-1", CLEAR))).toBeUndefined();
    expect(w.calls.map((c) => c.input)).toEqual([{ observation: REAL.observation, reasoning: `${REAL.reasoning} pam-1`, action: CLEAR }]);
    expect([sent, feed.last()]).toEqual([[], null]);
    w.calls[0]!.done(LINES);
    await tick();
    expect(sent).toEqual([shown("pam-1")]);
    expect(kept).toEqual([shown("pam-1")]);
    expect(feed.last()).toEqual(shown("pam-1"));
  });

  it("같은 행동이 이어지는 동안은 다시 부르지 않고, 처음 두 줄(왜 이 행동을 시작했는지)을 새 판단 id로 바로 다시 보낸다. 기록은 처음 한 번이다", async () => {
    const w = manualWriter();
    const sent: ThoughtEvent[] = [];
    const kept: ThoughtEvent[] = [];
    const feed = thoughtFeed({ writer: w, send: (m) => sent.push(m), record: (m) => kept.push(m) });
    feed.decision(decision("pam-1", CLEAR));
    w.calls[0]!.done(LINES);
    await tick();
    // 실행 중 장면(싱크대 바닥의 컵)으로 관찰·생각이 바뀌어도 같은 행동이면 처음 두 줄 그대로
    feed.decision({ ...decision("pam-2", CLEAR), prediction: { observation: "싱크대 바닥에 컵이 보인다", reasoning: "컵을 옮기는 중이다", task_index: 0 } });
    expect(sent).toEqual([shown("pam-1"), shown("pam-2")]);
    expect(feed.last()).toEqual(shown("pam-2"));
    // 실패 판단은 아무것도 바꾸지 않는다
    feed.decision(decision("pam-3", null, "failed"));
    expect(feed.last()).toEqual(shown("pam-2"));
    feed.decision(decision("pam-4", CLEAR));
    expect(sent.at(-1)).toEqual(shown("pam-4"));
    expect(w.calls).toHaveLength(1);
    expect(kept).toEqual([shown("pam-1")]);
  });

  it("두 줄을 기다리는 동안 같은 행동 판단이 또 오면 다시 부르지 않고, 답이 오면 마지막 판단 id로 보낸다", async () => {
    const w = manualWriter();
    const sent: ThoughtEvent[] = [];
    const feed = thoughtFeed({ writer: w, send: (m) => sent.push(m) });
    feed.decision(decision("pam-1", CLEAR));
    feed.decision(decision("pam-2", CLEAR));
    expect(w.calls).toHaveLength(1);
    w.calls[0]!.done(LINES);
    await tick();
    expect(sent).toEqual([shown("pam-2")]);
  });

  it("행동이 바뀌면 지우고 새로 부르며, 늦게 온 앞 행동의 두 줄은 보내지 않는다. 대기 판단이 오면 지우고, 그다음 행동 판단은 같은 행동이어도 새로 부른다", async () => {
    const w = manualWriter();
    const sent: ThoughtEvent[] = [];
    const feed = thoughtFeed({ writer: w, send: (m) => sent.push(m) });
    feed.decision(decision("pam-1", CLEAR));
    feed.decision(decision("pam-2", WATER_TASK));
    expect(feed.last()).toBeNull();
    w.calls[0]!.done(LINES);
    await tick();
    expect(sent).toEqual([]);
    w.calls[1]!.done(WATER);
    await tick();
    expect(sent).toEqual([shown("pam-2", WATER_TASK, WATER)]);
    feed.decision(decision("pam-3", null));
    expect(feed.last()).toBeNull();
    feed.decision(decision("pam-4", WATER_TASK));
    expect(w.calls).toHaveLength(3);
    expect(sent).toHaveLength(1);
  });

  it("두 줄을 못 만들면(null) 보내지 않고, 다음 같은 행동 판단에서 다시 부른다", async () => {
    const w = manualWriter();
    const sent: ThoughtEvent[] = [];
    const feed = thoughtFeed({ writer: w, send: (m) => sent.push(m) });
    feed.decision(decision("pam-1", CLEAR));
    w.calls[0]!.done(null);
    await tick();
    expect([sent, feed.last()]).toEqual([[], null]);
    feed.decision(decision("pam-2", CLEAR));
    expect(w.calls).toHaveLength(2);
    w.calls[1]!.done(LINES);
    await tick();
    expect(sent).toEqual([shown("pam-2")]);
  });

  it("기록에서 읽은 마지막 두 줄(seed)이 있으면 같은 행동 판단에 부르지 않고 바로 보낸다. 행동이 다르면 쓰지 않는다", () => {
    const w = manualWriter();
    const sent: ThoughtEvent[] = [];
    const feed = thoughtFeed({ writer: w, send: (m) => sent.push(m), seed: { action: CLEAR, ...LINES } });
    feed.decision(decision("pam-1", CLEAR));
    expect([w.calls.length, sent]).toEqual([0, [shown("pam-1")]]);
    const other = thoughtFeed({ writer: w, send: () => {}, seed: { action: CLEAR, ...LINES } });
    other.decision(decision("pam-1", WATER_TASK));
    expect(w.calls).toHaveLength(1);
  });
});

describe("생각 두 줄 기록", () => {
  it("두 줄은 기록 DB에 그 판단 id·행동과 함께 남고(thought), 다시 띄울 때 THOUGHT_KEEP_MS 안의 마지막 것을 읽는다", () => {
    const db = HistoryDb.open(":memory:");
    expect(lastStoredThought(db, 1_000_000)).toBeNull();
    storeThought(db, shown("pam-1"), 1_000_000);
    storeThought(db, shown("pam-7", WATER_TASK), 1_000_500);
    const [row] = db.list({ kinds: ["thought"], latest: true, limit: 1 });
    expect(row).toMatchObject({ kind: "thought", subject: "pam-7", text: `${LINES.seen} · ${LINES.why}`, data: { action: WATER_TASK, ...LINES } });
    expect(lastStoredThought(db, 1_000_500 + THOUGHT_KEEP_MS)).toEqual({ action: WATER_TASK, ...LINES });
    expect(lastStoredThought(db, 1_000_501 + THOUGHT_KEEP_MS)).toBeNull();
    expect(THOUGHT_KEEP_MS).toBe(10 * 60_000);
  });
});
