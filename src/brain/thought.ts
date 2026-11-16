// 생각 말풍선 두 줄: 행동을 고른 PAM 판단의 관찰·생각(observation·reasoning)과 고른 행동을 작은 모델 한 번으로
// 「본 것」(seen, 무엇을 봤는지)·「그래서」(why, 결정적인 근거 하나와 그래서 할 일) 두 줄로 고친다. 대시보드 생각 말풍선이 보인다.
// 모델은 VLM과 같은 OpenAI 호환 통로(src/infer/ createInference().thought: 같은 주소·키·요청 칸에 THOUGHT_MODEL, mock gpt-5.4-nano)다.
// 판단·계획은 기다리지 않는다(thoughtFeed): 판단 기록을 낸 뒤 따로 부르고, 두 줄이 오면 대시보드로 보내고 기록 DB(thought)에 한 번 남긴다.
// 같은 행동이 이어지는 동안(PAM은 계획이 도는 동안에도 같은 행동을 다시 고른다)은 다시 부르지 않고 처음 두 줄을 새 판단 id로 다시 보낸다:
// 왜 이 행동을 시작했는지가 실행 내내 남는다. 행동이 바뀌거나 대기 판단이 오면 지운다.
// 늦거나(THOUGHT_TIMEOUT_MS) 실패하거나 글이 틀리면(영어 낱말·밑줄 이름·빈 줄) 보내지 않고, 다음 같은 행동 판단에서 다시 부른다.
// 행동이 바뀌거나 대기 판단이 오거나 닫으면(close, 집·서버 종료) 나가 있는 요청을 끊고 늦은 답은 버린다. 보내기·기록 오류는 받아 넘긴다.
// 기록은 집 id와 함께 남기고, 다시 띄울 때 같은 집이고 그 뒤 대기·다른 행동 판단이 없을 때만 되살린다.
// 판단 기록 DB 줄에는 원래 생각이 그대로 남는다.
import type { BrainLog, ThoughtEvent } from "../contract/events.js";
import type { ChatMessage, OpenAICompatClient } from "../infer/openai-compat.js";
import { headWithin } from "../shared/cut.js";
import type { HistoryDb } from "./history/db.js";

export interface ThoughtLines { seen: string; why: string }
export interface ThoughtInput { observation: string; reasoning: string; action: string }
/** 기록에서 읽은 마지막 두 줄과 그 행동(서버를 다시 띄운 뒤 같은 행동이면 이어 쓴다). */
export type ThoughtSeed = ThoughtLines & { action: string };

/** 두 줄 모델 호출 제한 시간(ms). */
export const THOUGHT_TIMEOUT_MS = 8000;
/** 다시 띄울 때 이어 쓰는 기록 두 줄의 나이 상한(ms). 더 오래된 두 줄은 새 판단에 쓰지 않는다. */
export const THOUGHT_KEEP_MS = 10 * 60_000;
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
  "너는 집안일 도우미 「눈치」의 생각 말풍선 글을 쓴다. 판단 모듈이 남긴 관찰·생각과 고른 행동을 읽고, 보는 사람이 눈치가 왜 이 행동을 하는지 한눈에 알 수 있는 두 줄로 바꾼다.",
  "- seen(본 것): 무엇을 봤는지 한 문장. 예: 사람이 컵을 식탁에 두고 자리를 떠났어요",
  "- why(그래서): 배운 습관이나 지금 장면 중 이 행동을 고른 결정적인 근거 하나와, 그래서 무엇을 할지를 함께 쓴 한 문장. 예: 컵을 두고 자리를 비우면 치우는 습관이라 바로 컵을 치울게요",
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

/** 모델에 한 번 묻는다. 기억해 두지 않는다(같은 행동이 이어지는 동안 다시 묻지 않는 것은 thoughtFeed가 맡는다). */
export class ThoughtWriter {
  constructor(private readonly o: { chat: Pick<OpenAICompatClient, "chat">; timeoutMs?: number }) {}

  /** 두 줄. 실패·늦음·끊김(signal)·틀린 글이면 null. */
  async write(t: ThoughtInput, signal?: AbortSignal): Promise<ThoughtLines | null> {
    try {
      const limit = AbortSignal.timeout(this.o.timeoutMs ?? THOUGHT_TIMEOUT_MS);
      const r = await this.o.chat.chat({
        messages: thoughtMessages(t), schema: THOUGHT_SCHEMA, maxTokens: 200, signal: signal ? AbortSignal.any([signal, limit]) : limit,
      });
      return parseThought(r.text);
    } catch {
      return null;
    }
  }
}

type Decision = Extract<BrainLog, { type: "decision" }>;

export interface ThoughtFeed {
  /** 판단 기록 하나(대시보드에 보낸 그대로). 모델 답을 기다리지 않고 바로 돌아온다. */
  decision(e: Decision): void;
  /** 마지막 유효 판단의 두 줄(새로 붙은 대시보드에 다시 보낸다). 없으면 null. */
  last(): ThoughtEvent | null;
  /** 집·서버를 닫을 때: 나가 있는 요청을 끊고, 늦은 답과 그 뒤 판단은 버린다. */
  close(): void;
}

/**
 * 판단 기록 → 두 줄 보내기. 행동을 고른 유효 판단에서 그 행동의 두 줄이 없으면 한 번 부르고, 두 줄이 오면 그때 마지막 판단 id로 보내고 기록한다(record).
 * 같은 행동이 이어지면(부르는 중이어도) 다시 부르지 않고, 두 줄이 있으면 새 판단 id로 바로 다시 보낸다. 행동이 바뀌면 지우고 새로 부른다(늦게 온 앞 행동의 두 줄은 버린다).
 * 대기 판단은 지운다. 실패 판단은 대시보드가 버리므로 아무것도 바꾸지 않는다. seed는 기록에서 읽은 마지막 두 줄이다(같은 행동이면 이어 쓴다).
 * 이어지던 행동이 끝나면(다른 행동·대기·close) 나가 있는 요청을 끊는다. 보내기·기록이 던져도 받아 넘긴다(닫힌 기록 DB 등).
 */
export function thoughtFeed(o: { writer: Pick<ThoughtWriter, "write">; send: (m: ThoughtEvent) => void; record?: (m: ThoughtEvent) => void; seed?: ThoughtSeed | null }): ThoughtFeed {
  type Streak = { action: string; lines: ThoughtLines | null; stop: AbortController };
  let latest: string | null = null;
  let last: ThoughtEvent | null = null;
  let closed = false;
  /** 지금 이어지는 행동과 그 두 줄(부르는 중이면 null). */
  let streak: Streak | null = o.seed ? { action: o.seed.action, lines: { seen: o.seed.seen, why: o.seed.why }, stop: new AbortController() } : null;
  const end = () => { streak?.stop.abort(); streak = null; };
  const show = (id: string, action: string, lines: ThoughtLines): ThoughtEvent => (last = { type: "thought", id, action, ...lines });
  const deliver = (m: ThoughtEvent, record: boolean) => {
    try { o.send(m); } catch { /* 보내기 오류는 두 줄을 버리지 않는다 */ }
    if (record) try { o.record?.(m); } catch { /* 닫힌 기록 DB 등: 기록만 빠진다 */ }
  };
  return {
    decision(e) {
      if (closed || e.status !== "valid") return;
      latest = e.id;
      last = null;
      const action = e.action;
      if (!action || !e.prediction) { end(); return; }
      if (streak?.action === action) {
        if (streak.lines) deliver(show(e.id, action, streak.lines), false);
        return;
      }
      end();
      const mine: Streak = { action, lines: null, stop: new AbortController() };
      streak = mine;
      o.writer.write({ observation: e.prediction.observation, reasoning: e.prediction.reasoning, action }, mine.stop.signal).then((lines) => {
        if (closed || streak !== mine) return;
        if (!lines) { streak = null; return; }
        mine.lines = lines;
        deliver(show(latest!, action, lines), true);
      }).catch(() => { if (streak === mine) streak = null; });
    },
    last: () => last,
    close() {
      closed = true;
      end();
      last = null;
    },
  };
}

/** 두 줄을 기록 DB에 남긴다(kind thought, subject는 판단 id, data에 집 id·행동·두 줄). 기록 DB는 집을 바꿔도 하나라 집 id를 함께 둔다. */
export function storeThought(db: Pick<HistoryDb, "add">, home: string, m: ThoughtEvent, atMs: number): void {
  db.add("thought", atMs, `${m.seen} · ${m.why}`, { subject: m.id, data: { home, action: m.action, seen: m.seen, why: m.why } });
}

/**
 * 다시 띄울 때 이어 쓸 두 줄: 기록 DB의 마지막 thought 줄(THOUGHT_KEEP_MS 안)이 이 집 것이고, 그 뒤 유효 판단 줄(기록기 decision: 글은 고른 행동·대기)이
 * 모두 같은 행동일 때만(행동 연속 구간이 이어질 때만). 대기·다른 행동 판단이 있었으면 null. 판단 실패 줄은 연속을 끊지 않는다.
 */
export function lastStoredThought(db: Pick<HistoryDb, "list">, home: string, nowMs: number): ThoughtSeed | null {
  const row = db.list({ kinds: ["thought"], since: nowMs - THOUGHT_KEEP_MS, latest: true, limit: 1 })[0];
  const d = (row?.data ?? null) as (Partial<ThoughtSeed> & { home?: unknown }) | null;
  if (!row || !d || d.home !== home || typeof d.action !== "string" || typeof d.seen !== "string" || typeof d.why !== "string") return null;
  const later = db.list({ kinds: ["decision"], since: row.at_ms }).filter((r) => r.id > row.id && (r.data as { status?: unknown } | null)?.status === "valid");
  return later.every((r) => r.text === d.action) ? { action: d.action, seen: d.seen, why: d.why } : null;
}
