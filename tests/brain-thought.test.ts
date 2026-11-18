// 메시지 상자 문장(src/brain/thought.ts): 모델 없이 판단 기록·실행 추적이 가진 사실로만 만든다(2026-11-18 사용자 결정: 작은 모델이 PAM·계획에 없는
// 「물기를 닦을게요」를 지어냈다). 행동을 고른 판단은 맞은 FSM 규칙으로 「<상태 조건> <행동 허락> 된다고 하셨어요」 한 줄이고, 이어지는 「컵을 치울게요.」·단계 줄은 말풍선 말(say)이다.
// 메시지는 기록 DB(thought, 집 id 포함)에 남아 다시 붙은 대시보드·다시 띄운 서버에도 최근 것을 다시 보낸다.
import { describe, expect, it } from "vitest";
import { HistoryDb } from "../src/brain/history/db.js";
import * as thought from "../src/brain/thought.js";
import { THOUGHT_KEEP, THOUGHT_KEEP_MS, decisionLines, lastStoredThoughts, storeThought, thoughtFeed } from "../src/brain/thought.js";
import { SAY_TEXT } from "../src/act/labels.js";
import { TASK_NAMES, TASK_SAY } from "../src/act/tasks.js";
import { RULE_IF } from "../src/world/labels.js";
import { CUP_FSM_MEMORY } from "../src/brain/decision.js";
import type { BrainLog, ThoughtEvent, ThoughtMessage } from "../src/contract/events.js";

type Decision = Extract<BrainLog, { type: "decision" }>;
const LEFT_CUP = "사용자가 컵을 식탁 등에 두고 자리를 비웠고, 아무도 컵을 들거나 만지지 않는다.";
const decision = (id: string, action: string | null, fsm: Decision["fsm"] = null, status: "valid" | "failed" = "valid"): Decision => ({
  type: "decision", at_ms: 1, id, seq: Number(id.split("-")[1]), text_sent: "", status,
  prediction: status === "valid" ? { observation: "관찰", reasoning: "물기도 닦아 두면 좋겠다", task_index: action ? 0 : -1 } : null,
  action, fsm, memory_version: 1, world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
});
const rule = (state: string | null, trigger: string | null = LEFT_CUP) => ({ state, trigger, learned: false, matched: true });
const texts = (events: ThoughtEvent[]) => events.flatMap((e) => e.messages.map((m) => m.text));
const RULE_LINE = "컵을 식탁 등에 두고 자리를 비웠고 아무도 컵을 들거나 만지지 않으면 치워도 된다고 하셨어요";

describe("메시지 상자 문장(사실로만)", () => {
  it("규칙대로 고른 행동은 「<맞은 규칙의 조건> <행동 허락> 된다고 하셨어요」 한 줄이다: 조건은 그 규칙 트리거의 뜻을 다 담는다(컵을 두고 자리를 비웠고 아무도 만지지 않음)", () => {
    expect(decisionLines(decision("pam-1", "컵 치우기", rule("left_cup")))).toEqual([RULE_LINE]);
    expect(RULE_LINE).toContain("아무도 컵을 들거나 만지지 않으면");
  });

  // Codex(b78b518 thought.ts:30): 상태 이름(「컵을 두고 자리를 뜨면」)으로 써서 「아무도 만지지 않을 때」 같은 규칙 조건을 빼고 허락한 것처럼 말했다
  it("시연 기억의 규칙마다 조건형이 있고 트리거의 조건을 빼지 않는다. 표에 없는 트리거(배운 새 규칙)는 줄이지 않고 그대로 조건으로 쓴다", () => {
    for (const st of CUP_FSM_MEMORY.states) for (const r of st.rules) {
      const line = decisionLines(decision("pam-1", r.action, rule(st.id, r.trigger)))[0]!;
      expect(RULE_IF[r.action], r.trigger).toBeTruthy();
      expect(line, r.trigger).toBe(`${RULE_IF[r.action]} ${TASK_SAY[r.action]!.may} 된다고 하셨어요`);
      for (const word of ["비어", "만지지", "부채질", "알려 달라고", "모르겠다", "어떻게", "자리를 비웠"].filter((x) => r.trigger.includes(x))) expect(line, r.trigger).toContain(word);
    }
    expect(decisionLines(decision("pam-1", "컵 치우기", { ...rule("night_rest", "사용자가 밤 열한 시 넘어 거실 불을 끄고 컵을 소파 옆에 둔다."), learned: true })))
      .toEqual(["사용자가 밤 열한 시 넘어 거실 불을 끄고 컵을 소파 옆에 둔다면 치워도 된다고 하셨어요"]);
    expect(decisionLines(decision("pam-1", "춤추기", { ...rule("left_cup", "음악이 나옴"), learned: true }))).toEqual(["「음악이 나옴」일 때 춤추기를 해도 된다고 하셨어요"]);
  });

  it("규칙을 특정하지 못하면(규칙 여럿: 트리거 없음, 규칙 없이 고른 행동) 허락 문장은 없고, 대기·실패 판단도 줄이 없다", () => {
    expect(decisionLines(decision("pam-1", "컵 치우기", { state: "left_cup", trigger: null, learned: false, matched: true }))).toEqual([]);
    expect(decisionLines(decision("pam-1", "컵 치우기", { state: null, trigger: null, learned: true, matched: true }))).toEqual([]);
    expect(decisionLines(decision("pam-1", "컵 치우기", { state: "left_cup", trigger: null, learned: false, matched: false }))).toEqual([]);
    expect(decisionLines(decision("pam-1", "컵 치우기", null))).toEqual([]);
    expect(decisionLines(decision("pam-1", null, { state: "drinking", trigger: null, learned: false, matched: false }))).toEqual([]);
    expect(decisionLines(decision("pam-1", "컵 치우기", rule("left_cup"), "failed"))).toEqual([]);
  });

  it("행동 목록의 모든 행동은 허락형·클로이드 말(「~게요」)이 있고, 문장은 판단 기록의 사실(규칙·행동)로만 만들어 PAM 생각 글이나 목록에 없는 행동(물기 닦기)이 나오지 않는다", () => {
    for (const action of TASK_NAMES) {
      expect(TASK_SAY[action]?.will, action).toMatch(/게요$/);
      const [line] = decisionLines(decision("pam-1", action, rule("left_cup")));
      expect(line, action).toBe(`${RULE_IF[action] ?? "사용자가 컵을 식탁 등에 두고 자리를 비웠고, 아무도 컵을 들거나 만지지 않는다면"} ${TASK_SAY[action]!.may} 된다고 하셨어요`);
      expect(`${line} ${SAY_TEXT.decided(action)}`, action).not.toMatch(/물기|닦/);
    }
  });

  it("생각 모델을 부르는 길이 없다: 모듈에 모델 쓰기·지시문이 없다", () => {
    for (const k of ["ThoughtWriter", "thoughtMessages", "parseThought", "THOUGHT_SCHEMA", "THOUGHT_TIMEOUT_MS"]) expect(k in thought, k).toBe(false);
  });
});

describe("메시지 상자 문장 보내기(thoughtFeed)", () => {
  it("유효 판단의 사실 문장을 바로 id(판단 id@시각:차례)·판단 id·시각을 붙여 보내고 하나씩 기록하며, 최근 것은 다시 보낼 수 있다", () => {
    const sent: ThoughtEvent[] = [];
    const kept: ThoughtMessage[] = [];
    const feed = thoughtFeed({ send: (m) => sent.push(m), record: (m) => kept.push(m), clock: () => 2000 });
    feed.decision(decision("pam-2", "컵 치우기", rule("left_cup")));
    expect(sent).toEqual([{ type: "thought", messages: [{ id: "pam-2@2000:0", text: RULE_LINE, at_ms: 2000, decision: "pam-2" }] }]);
    expect(kept.map((m) => m.text)).toEqual([RULE_LINE]);
    expect(feed.last()).toEqual({ type: "thought", messages: kept });
  });

  it("같은 행동 판단이 이어지면(이미 올린 말) 다시 보내지 않는다. 대기 판단은 줄을 보내지 않는다", () => {
    const sent: ThoughtEvent[] = [];
    let now = 1000;
    const feed = thoughtFeed({ send: (m) => sent.push(m), clock: () => now });
    feed.decision(decision("pam-1", "컵 치우기", rule("left_cup")));
    now = 2000;
    feed.decision(decision("pam-2", "컵 치우기", rule("left_cup")));
    feed.decision(decision("pam-3", null, { state: "left_cup", trigger: null, learned: false, matched: false }));
    expect(texts(sent)).toEqual([RULE_LINE]);
  });

  it("상태 줄(note): 그 글을 바로 보내고 기록하며 최근 메시지에 넣는다. 바로 앞과 같은 말은 다시 보내지 않고, 닫으면 보내지 않는다", () => {
    const sent: ThoughtEvent[] = [];
    const kept: ThoughtMessage[] = [];
    let now = 1000;
    const feed = thoughtFeed({ send: (m) => sent.push(m), record: (m) => kept.push(m), clock: () => now });
    feed.note("컵이 안 보여서 식탁 쪽을 다시 볼게요", "pam-3");
    expect(sent).toEqual([{ type: "thought", messages: [{ id: "pam-3@1000:note", text: "컵이 안 보여서 식탁 쪽을 다시 볼게요", at_ms: 1000, decision: "pam-3" }] }]);
    feed.note("컵이 안 보여서 식탁 쪽을 다시 볼게요", "pam-4");
    expect(sent).toHaveLength(1);
    now = 2000;
    feed.note("컵을 찾았어요", "pam-5");
    expect(sent.at(-1)!.messages.map((m) => m.text)).toEqual(["컵을 찾았어요"]);
    feed.close();
    feed.note("컵을 못 찾았어요", "pam-6");
    feed.decision(decision("pam-7", "컵 치우기", rule("left_cup")));
    expect(sent).toHaveLength(2);
    expect(kept.map((m) => m.text)).toEqual(["컵이 안 보여서 식탁 쪽을 다시 볼게요", "컵을 찾았어요"]);
  });

  it("최근 메시지는 THOUGHT_KEEP개까지 둔다", () => {
    const feed = thoughtFeed({ send: () => {} });
    for (let i = 1; i <= 7; i++) feed.note(`메시지 ${i}`, `pam-${i}`);
    expect(THOUGHT_KEEP).toBe(5);
    expect(feed.last()!.messages.map((m) => m.text)).toEqual(["메시지 3", "메시지 4", "메시지 5", "메시지 6", "메시지 7"]);
  });

  it("닫힌 기록 DB에 쓰다 던지거나 보내기가 던져도 문장은 남고 처리되지 않은 거절이 생기지 않는다", () => {
    const db = HistoryDb.open(":memory:");
    db.close();
    const feed = thoughtFeed({ send: () => { throw new Error("끊긴 소켓"); }, record: (m) => storeThought(db, "mokryeon_180b", m) });
    feed.decision(decision("pam-1", "컵 치우기", rule("left_cup")));
    expect(feed.last()!.messages.map((m) => m.text)).toEqual([RULE_LINE]);
  });

  it("기록에서 읽은 최근 메시지(seed)로 시작해 바로 다시 보낼 수 있고, 이미 올린 말은 되풀이하지 않는다. THOUGHT_KEEP_MS보다 오래된 메시지는 다시 보내지 않는다", () => {
    let now = 1_000_000;
    const seed: ThoughtMessage[] = [{ id: "pam-9@1000000:0", text: RULE_LINE, at_ms: 1_000_000, decision: "pam-9" }];
    const sent: ThoughtEvent[] = [];
    const feed = thoughtFeed({ send: (m) => sent.push(m), seed, clock: () => now });
    expect(feed.last()).toEqual({ type: "thought", messages: seed });
    feed.decision(decision("pam-1", "컵 치우기", rule("left_cup")));
    expect(sent).toEqual([]);
    now += THOUGHT_KEEP_MS + 10;
    feed.decision(decision("pam-2", "컵 치우기", rule("left_cup")));
    expect(texts(sent)).toEqual([RULE_LINE]);
    now += THOUGHT_KEEP_MS + 10;
    expect(feed.last()).toBeNull();
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

  it("다른 집 메시지가 그 뒤에 많이 쌓여도(250건) 10분 안의 이 집 메시지를 되살린다: 집을 먼저 거르고 개수를 센다", () => {
    const db = HistoryDb.open(":memory:");
    storeThought(db, HOME, msg(1, 1_000_000));
    for (let n = 0; n < 250; n++) storeThought(db, "apartment", { id: `a${n}`, text: `다른 집 ${n}`, at_ms: 1_000_001 + n, decision: "pam-a" });
    expect(lastStoredThoughts(db, HOME, 1_000_300)).toEqual([msg(1, 1_000_000)]);
  });
});
