// 생각 말풍선 메시지: 유효 판단마다(대기 포함) 작은 모델에 이번 판단(관찰·생각과 고른 행동 또는 대기)과 이미 올린 최근 메시지를 주고,
// 새로 올릴 짧은 문장 0~2개를 받는다. 대시보드 생각 말풍선에 카톡처럼 차례로 쌓인다(2026-11-16 회의 「정한 것」 5).
// 모델은 VLM과 같은 OpenAI 호환 통로(src/infer/ createInference().thought: 같은 주소·키·요청 칸에 THOUGHT_MODEL, mock gpt-5.4-nano)다.
// 판단·계획은 기다리지 않는다(thoughtFeed): 판단 기록을 낸 뒤 따로 부르고, 새 메시지가 오면 대시보드로 보내고 기록 DB(thought, 집 id 포함)에 하나씩 남긴다.
// 바뀐 것이 없으면(빈 목록·이미 올린 말) 보내지 않는다. 같은 판단 글이 다시 오면 부르지 않는다. 부르는 중에 같은 행동(또는 대기) 판단이 오면 부르지 않고,
// 다른 행동·대기로 바뀌면 앞 요청을 끊고 새로 부른다. 늦거나(THOUGHT_TIMEOUT_MS) 실패하면 그 판단은 메시지 없이 넘어간다.
// 닫으면(close, 집·서버 종료) 나가 있는 요청을 끊고 늦은 답은 버린다. 보내기·기록 오류는 받아 넘긴다.
// PAM의 원래 생각(reasoning)은 모델에만 주고 대시보드로 보내지 않는다. 판단 기록 DB 줄에는 원래 생각이 그대로 남는다.
import type { BrainLog, ThoughtEvent, ThoughtMessage } from "../contract/events.js";
import type { ChatMessage, OpenAICompatClient } from "../infer/openai-compat.js";
import { headWithin } from "../shared/cut.js";
import type { HistoryDb } from "./history/db.js";

/** 모델에 주는 이번 판단: 관찰·생각, 고른 행동(대기면 null), 이미 올린 최근 메시지(오래된 것부터). */
export interface ThoughtInput { observation: string; reasoning: string; action: string | null; recent: string[] }

/** 메시지 모델 호출 제한 시간(ms). */
export const THOUGHT_TIMEOUT_MS = 8000;
/** 최근 메시지를 두는 수: 모델에 이미 올린 메시지로 주고, 새로 붙은 대시보드·다시 띄운 서버에 다시 보낸다. 말풍선에는 3개 안팎이 보인다. */
export const THOUGHT_KEEP = 5;
/** 최근 메시지의 나이 상한(ms): 이보다 오래된 메시지는 다시 보내지도, 모델에 주지도, 다시 띄울 때 되살리지도 않는다. */
export const THOUGHT_KEEP_MS = 10 * 60_000;
/** 한 번에 새로 올리는 메시지 수 상한. */
const NEW_MAX = 2;
/** 메시지 하나의 글자 상한. 화면은 말풍선 안에서 줄을 바꾼다. */
const TEXT_MAX = 60;

export const THOUGHT_SCHEMA = {
  name: "thought_messages",
  schema: {
    type: "object", additionalProperties: false, required: ["messages"],
    properties: { messages: { type: "array", items: { type: "string" } } },
  },
};

const SYSTEM = [
  "너는 집안일 도우미 「눈치」가 지금 하는 생각을 대시보드 말풍선에 짧은 메시지로 올린다. 메시지는 카톡처럼 아래로 쌓이고 최근 3개쯤만 보인다.",
  "판단 모듈이 남긴 이번 판단(관찰·생각과 고른 행동, 또는 대기)과 이미 올린 메시지를 읽고, 새로 올릴 메시지 0~2개를 messages에 낸다.",
  "- 메시지 하나는 30자 안팎의 쉬운 한국어 해요체 한 문장이고, 끝에 마침표를 찍지 않는다.",
  "- 이미 올린 메시지와 같은 뜻이면 올리지 않는다. 바뀐 것이 없으면 빈 목록을 낸다. 대기가 이어져도 같은 말을 되풀이하지 않는다.",
  "- 행동을 고른 판단이면 무엇을 봤는지 → 왜 그 행동인지(배운 습관이나 지금 장면 중 결정적인 근거 하나) → 그래서 무엇을 할지가 메시지 흐름으로 드러나게, 이미 올린 메시지에 없는 다음 단계부터 쓴다.",
  "- 대기 판단이면 지금 무엇을 지켜보는지나 왜 아직 하지 않는지를 쓴다.",
  "- 규칙 id·물건 id·영어 낱말·변수 이름·따옴표·괄호를 쓰지 않는다. 메모리·규칙·조건 같은 안쪽 말 대신 습관이라고 쓴다.",
  "- 받은 글에 없는 사실을 지어내지 않는다.",
  "예: 사람이 컵을 두고 자리를 떠났어요 / 컵에 음료가 남아 있어 다시 마실 수도 있어요 / 지금은 치우지 않고 더 지켜볼게요",
].join("\n");

/** 모델에 보낼 글(사진 없음). */
export function thoughtMessages(t: ThoughtInput): ChatMessage[] {
  const recent = t.recent.length ? `\n${t.recent.map((m) => `- ${m}`).join("\n")}` : " 없음";
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: `관찰: ${t.observation}\n생각: ${t.reasoning}\n판단: ${t.action ?? "대기"}\n이미 올린 메시지:${recent}` },
  ];
}

const QUOTES = /["'`‘’“”「」『』]/g;
/** 같은 말인가(빈칸·끝 마침표 차이는 같다). */
const same = (a: string, b: string) => a.replace(/\s+/g, "") === b.replace(/\s+/g, "");

/** 모델 글 한 줄: 따옴표를 빼고 빈칸을 줄이고 끝 마침표를 뗀다. 영어 소문자 낱말·밑줄 이름(안쪽 이름)이 남거나 비면 null. */
function cleanLine(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(QUOTES, "").replace(/\s+/g, " ").trim().replace(/[.。]+$/, "").trim();
  if (!s || /[a-z_]/.test(s)) return null;
  return headWithin(s, TEXT_MAX);
}

/** 모델 답(JSON) → 새 메시지(못 쓰는 줄·이미 올린 말·겹친 말은 빼고 NEW_MAX개까지). 형식이 틀리면 null, 빈 목록은 빈 목록. */
export function parseThought(text: string, recent: string[] = []): string[] | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  const list = (v as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(list)) return null;
  const out: string[] = [];
  for (const raw of list) {
    const s = cleanLine(raw);
    if (s && ![...recent, ...out].some((m) => same(m, s))) out.push(s);
  }
  return out.slice(0, NEW_MAX);
}

/** 모델에 한 번 묻는다. */
export class ThoughtWriter {
  constructor(private readonly o: { chat: Pick<OpenAICompatClient, "chat">; timeoutMs?: number }) {}

  /** 새 메시지(바뀐 것이 없으면 빈 목록). 실패·늦음·끊김(signal)·틀린 형식이면 null. */
  async write(t: ThoughtInput, signal?: AbortSignal): Promise<string[] | null> {
    try {
      const limit = AbortSignal.timeout(this.o.timeoutMs ?? THOUGHT_TIMEOUT_MS);
      const r = await this.o.chat.chat({
        messages: thoughtMessages(t), schema: THOUGHT_SCHEMA, maxTokens: 200, signal: signal ? AbortSignal.any([signal, limit]) : limit,
      });
      return parseThought(r.text, t.recent);
    } catch {
      return null;
    }
  }
}

type Decision = Extract<BrainLog, { type: "decision" }>;

export interface ThoughtFeed {
  /** 판단 기록 하나(대시보드에 보낸 그대로). 모델 답을 기다리지 않고 바로 돌아온다. */
  decision(e: Decision): void;
  /** 최근 메시지(새로 붙은 대시보드에 다시 보낸다). 없으면 null. */
  last(): ThoughtEvent | null;
  /** 집·서버를 닫을 때: 나가 있는 요청을 끊고, 늦은 답과 그 뒤 판단은 버린다. */
  close(): void;
}

/**
 * 판단 기록 → 메시지 보내기. 유효 판단(행동·대기)마다 모델을 한 번 부르고, 새 메시지가 오면 id(판단 id@시각:차례)·판단 id·시각을 붙여 보내고(send) 하나씩 기록한다(record).
 * 최근 THOUGHT_KEEP개(THOUGHT_KEEP_MS 안)를 두고 다음 요청에 이미 올린 메시지로 주며 새로 붙은 대시보드에 다시 보낸다. seed는 기록에서 읽은 최근 메시지다.
 */
export function thoughtFeed(o: {
  writer: { write(t: ThoughtInput, signal?: AbortSignal): Promise<string[] | null> };
  send: (m: ThoughtEvent) => void; record?: (m: ThoughtMessage) => void; seed?: ThoughtMessage[]; clock?: () => number;
}): ThoughtFeed {
  const clock = o.clock ?? Date.now;
  let recent: ThoughtMessage[] = (o.seed ?? []).slice(-THOUGHT_KEEP);
  let closed = false;
  /** 나가 있는 요청: 그 판단의 행동(대기면 null)과 끊기. */
  let asking: { action: string | null; stop: AbortController } | null = null;
  /** 마지막으로 답을 받은 판단 글(같은 글이면 다시 부르지 않는다). */
  let asked: string | null = null;
  const stop = () => { asking?.stop.abort(); asking = null; };
  /** 나이 상한 안의 최근 메시지. */
  const fresh = () => recent.filter((m) => clock() - m.at_ms <= THOUGHT_KEEP_MS);
  return {
    decision(e) {
      if (closed || e.status !== "valid" || !e.prediction) return;
      const action = e.action;
      const key = JSON.stringify([e.prediction.observation, e.prediction.reasoning, action]);
      if (asking) {
        if (asking.action === action) return;
        stop();
      }
      if (key === asked) return;
      const mine = { action, stop: new AbortController() };
      asking = mine;
      o.writer.write({ observation: e.prediction.observation, reasoning: e.prediction.reasoning, action, recent: fresh().map((m) => m.text) }, mine.stop.signal)
        .then((texts) => {
          if (closed || asking !== mine) return;
          asking = null;
          if (!texts) return;
          asked = key;
          const kept = fresh();
          const novel = texts.filter((t, i) => !kept.some((m) => same(m.text, t)) && !texts.slice(0, i).some((u) => same(u, t)));
          if (!novel.length) return;
          const at = clock();
          const made = novel.map((text, i) => ({ id: `${e.id}@${at}:${i}`, text, at_ms: at, decision: e.id }));
          recent = [...kept, ...made].slice(-THOUGHT_KEEP);
          try { o.send({ type: "thought", messages: made }); } catch { /* 보내기 오류는 메시지를 버리지 않는다 */ }
          for (const m of made) try { o.record?.(m); } catch { /* 닫힌 기록 DB 등: 기록만 빠진다 */ }
        })
        .catch(() => { if (asking === mine) asking = null; });
    },
    last: () => {
      const kept = fresh();
      return kept.length ? { type: "thought", messages: kept } : null;
    },
    close() {
      closed = true;
      stop();
    },
  };
}

/** 메시지 하나를 기록 DB에 남긴다(kind thought, 시각은 메시지 시각, subject는 판단 id, data에 집 id·메시지 id). 기록 DB는 집을 바꿔도 하나라 집 id를 함께 둔다. */
export function storeThought(db: Pick<HistoryDb, "add">, home: string, m: ThoughtMessage): void {
  db.add("thought", m.at_ms, m.text, { subject: m.decision, data: { home, id: m.id } });
}

/** 다시 띄울 때 되살릴 메시지: 기록 DB의 이 집 thought 줄 가운데 THOUGHT_KEEP_MS 안의 최근 THOUGHT_KEEP개(오래된 것부터).
 *  기록 DB는 집을 바꿔도 하나라, 나이 안의 줄을 모두 읽어 이 집 것만 거른 뒤 개수를 센다(다른 집 메시지에 밀리지 않게). */
export function lastStoredThoughts(db: Pick<HistoryDb, "list">, home: string, nowMs: number): ThoughtMessage[] {
  return db.list({ kinds: ["thought"], since: nowMs - THOUGHT_KEEP_MS, latest: true })
    .flatMap((r) => {
      const d = (r.data ?? null) as { home?: unknown; id?: unknown } | null;
      return d?.home === home && typeof d.id === "string" ? [{ id: d.id, text: r.text, at_ms: r.at_ms, decision: r.subject ?? "" }] : [];
    })
    .slice(-THOUGHT_KEEP);
}
