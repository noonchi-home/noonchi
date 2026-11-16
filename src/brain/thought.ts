// 생각 말풍선 두 줄: 행동을 고른 PAM 판단의 관찰·생각(observation·reasoning)과 고른 행동을 작은 모델 한 번으로
// 「본 것」(seen, 무엇을 봤는지)·「그래서」(why, 왜 그 행동인지) 두 줄로 고친다. 대시보드 생각 말풍선이 보인다.
// 모델은 VLM과 같은 OpenAI 호환 통로(src/infer/ createInference().thought: 같은 주소·키·요청 칸에 THOUGHT_MODEL, mock gpt-5.4-nano)다.
// 판단·계획은 기다리지 않는다(thoughtFeed): 판단 기록을 낸 뒤 따로 부르고, 두 줄이 오면 대시보드로만 보낸다. 기록 DB 판단 줄에는 원래 생각이 남는다.
// 같은 생각·행동은 다시 부르지 않는다(최근 KEEP개). 늦거나(THOUGHT_TIMEOUT_MS) 실패하거나 글이 틀리면(영어 낱말·밑줄 이름·빈 줄) null이고 기억하지 않는다:
// 대시보드는 원래 생각을 그대로 보인다.
import type { BrainLog, ThoughtEvent } from "../contract/events.js";
import type { ChatMessage, OpenAICompatClient } from "../infer/openai-compat.js";
import { headWithin } from "../shared/cut.js";

export interface ThoughtLines { seen: string; why: string }
export interface ThoughtInput { observation: string; reasoning: string; action: string }

/** 두 줄 모델 호출 제한 시간(ms). 넘으면 원래 생각을 그대로 둔다. */
export const THOUGHT_TIMEOUT_MS = 8000;
/** 기억해 두는 두 줄 수(같은 생각이 다시 오면 부르지 않는다). */
const KEEP = 64;
/** 줄 하나의 상한(글자). 화면은 줄마다 두 줄 높이에서 말줄임한다. */
const LINE_MAX = 80;

export const THOUGHT_SCHEMA = {
  name: "thought_lines",
  schema: {
    type: "object", additionalProperties: false, required: ["seen", "why"],
    properties: { seen: { type: "string" }, why: { type: "string" } },
  },
};

const SYSTEM = [
  "너는 집안일 도우미 「눈치」의 생각 말풍선 글을 쓴다. 판단 모듈이 남긴 관찰·생각과 고른 행동을 읽고, 집에 있는 사람이 한눈에 읽는 두 줄로 바꾼다.",
  "- seen(본 것): 무엇을 봤는지 한 문장. 예: 사람이 컵을 식탁에 두고 자리를 떠났어요",
  "- why(그래서): 왜 그 행동을 하는지 한 문장. 예: 컵을 두고 떠나면 치우는 습관대로 컵을 치울게요",
  "- 줄마다 40자 안팎의 쉬운 한국어 해요체로 쓰고, 끝에 마침표를 찍지 않는다.",
  "- 규칙 id·물건 id·영어 낱말·변수 이름·따옴표·괄호를 쓰지 않는다. 메모리·규칙·조건 같은 안쪽 말 대신 습관이라고 쓴다.",
  "- 받은 글에 없는 사실을 지어내지 않는다.",
].join("\n");

/** 모델에 보낼 글(사진 없음). */
export function thoughtMessages(t: ThoughtInput): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: `관찰: ${t.observation}\n생각: ${t.reasoning}\n고른 행동: ${t.action}` },
  ];
}

const QUOTES = /["'`‘’“”「」『』]/g;

/** 모델 글 한 줄: 따옴표를 빼고 빈칸을 줄이고 끝 마침표를 뗀다. 영어 소문자 낱말·밑줄 이름(안쪽 이름)이 남거나 비면 null. */
function cleanLine(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(QUOTES, "").replace(/\s+/g, " ").trim().replace(/[.。]+$/, "").trim();
  if (!s || /[a-z_]/.test(s)) return null;
  return headWithin(s, LINE_MAX);
}

/** 모델 답(JSON) → 두 줄. 형식이 틀리거나 한 줄이라도 못 쓰면 null. */
export function parseThought(text: string): ThoughtLines | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const seen = cleanLine(o.seen);
  const why = cleanLine(o.why);
  return seen && why ? { seen, why } : null;
}

export class ThoughtWriter {
  private readonly done = new Map<string, ThoughtLines>();
  private readonly going = new Map<string, Promise<ThoughtLines | null>>();

  constructor(private readonly o: { chat: Pick<OpenAICompatClient, "chat">; timeoutMs?: number }) {}

  /** 두 줄. 같은 생각·행동이면 기억한 것(나가 있으면 그 답)을 준다. 실패·늦음이면 null. */
  write(t: ThoughtInput): Promise<ThoughtLines | null> {
    const key = JSON.stringify([t.reasoning, t.action]);
    const hit = this.done.get(key);
    if (hit) {
      this.done.delete(key);
      this.done.set(key, hit);
      return Promise.resolve(hit);
    }
    const going = this.going.get(key);
    if (going) return going;
    const p = this.ask(t).then((lines) => {
      this.going.delete(key);
      if (lines) this.remember(key, lines);
      return lines;
    });
    this.going.set(key, p);
    return p;
  }

  private async ask(t: ThoughtInput): Promise<ThoughtLines | null> {
    try {
      const r = await this.o.chat.chat({
        messages: thoughtMessages(t), schema: THOUGHT_SCHEMA, maxTokens: 200, signal: AbortSignal.timeout(this.o.timeoutMs ?? THOUGHT_TIMEOUT_MS),
      });
      return parseThought(r.text);
    } catch {
      return null;
    }
  }

  private remember(key: string, lines: ThoughtLines): void {
    this.done.set(key, lines);
    while (this.done.size > KEEP) this.done.delete(this.done.keys().next().value!);
  }
}

type Decision = Extract<BrainLog, { type: "decision" }>;

export interface ThoughtFeed {
  /** 판단 기록 하나(대시보드에 보낸 그대로). 모델 답을 기다리지 않고 바로 돌아온다. */
  decision(e: Decision): void;
  /** 마지막 유효 판단의 두 줄(새로 붙은 대시보드에 다시 보낸다). 없으면 null. */
  last(): ThoughtEvent | null;
}

/** 판단 기록 → 두 줄 보내기. 행동을 고른 유효 판단만 부르고, 그 사이 다음 유효 판단이 왔으면 늦은 두 줄은 보내지 않는다.
 *  대기 판단은 지난 두 줄을 지운다. 실패 판단은 대시보드가 버리므로 아무것도 바꾸지 않는다. */
export function thoughtFeed(o: { writer: Pick<ThoughtWriter, "write">; send: (m: ThoughtEvent) => void }): ThoughtFeed {
  let latest: string | null = null;
  let last: ThoughtEvent | null = null;
  return {
    decision(e) {
      if (e.status !== "valid") return;
      latest = e.id;
      last = null;
      if (!e.action || !e.prediction) return;
      const id = e.id;
      void o.writer.write({ observation: e.prediction.observation, reasoning: e.prediction.reasoning, action: e.action }).then((lines) => {
        if (!lines || latest !== id) return;
        last = { type: "thought", id, ...lines };
        o.send(last);
      });
    },
    last: () => last,
  };
}
