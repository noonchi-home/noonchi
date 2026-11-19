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
import { ASK_ACTION } from "../src/act/tasks.js";
import { CUP_FSM_MEMORY } from "../src/brain/decision.js";
import { LEARNED_FSM_MEMORY } from "../scripts/learned-memory.js";
import type { BrainLog, ThoughtEvent, ThoughtMessage } from "../src/contract/events.js";
import type { FsmStep } from "../src/contract/pam.js";

type Decision = Extract<BrainLog, { type: "decision" }>;
const LEFT_CUP = "사용자가 컵을 식탁 등에 두고 자리를 비웠고, 아무도 컵을 들거나 만지지 않는다.";
const decision = (id: string, action: string | null, fsm: Decision["fsm"] = null, status: "valid" | "failed" = "valid"): Decision => ({
  type: "decision", at_ms: 1, id, seq: Number(id.split("-")[1]), text_sent: "", status,
  prediction: status === "valid" ? { observation: "관찰", reasoning: "물기도 닦아 두면 좋겠다", task_index: action ? 0 : -1 } : null,
  action, fsm, memory_version: 1, world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
});
/** 판단 기록 fsm(PAM 답의 상태·화살표). 기본은 화살표 없음. */
const step = (o: Partial<FsmStep> = {}): FsmStep => ({ state: "away", from: null, next_index: -1, to: null, on: null, when: null, action: null, learned: false, ...o });
/** 배운 뒤 기억에서 마시는 중을 떠나는 컵 치우기 화살표(seed 묻기 자리를 바꾼 것). */
const LEAVE = LEARNED_FSM_MEMORY.states[0]!.next[0]!;
const clearStep = () => step({ from: "drinking", next_index: 0, to: "*", on: LEAVE.on, action: "컵 치우기", learned: true });
const texts = (events: ThoughtEvent[]) => events.flatMap((e) => e.messages.map((m) => m.text));
const RULE_LINE = "컵을 두고 자리를 뜨면 치워도 된다고 하셨어요";

describe("메시지 상자 문장(사실로만)", () => {
  it("규칙대로 고른 행동은 「<맞은 화살표의 조건> <행동 허락> 된다고 하셨어요」 한 줄이다: 배운 컵 치우기는 사용자가 정한 「컵을 두고 자리를 뜨면 치워도 된다고 하셨어요」", () => {
    expect(decisionLines(decision("pam-1", "컵 치우기", clearStep()))).toEqual([RULE_LINE]);
    // 사용자가 정한 짧은 꼴 그대로다(2026-11-18 사용자 바로잡음: 「아무도 안 만지면」 같은 덧조건은 넣지 않는다)
    expect(decisionLines(decision("pam-1", "컵 치우기", clearStep()))[0]).toBe("컵을 두고 자리를 뜨면 치워도 된다고 하셨어요");
  });

  it("허락 문장은 판단이 낸 화살표에서 만든다: seed 트리거면 RULE_IF(묻기 자리를 바꾼 배운 컵 치우기도), 새 트리거의 배운 화살표는 on·when을 줄이지 않고, 묻기·화살표 없음은 허락 문장이 없다", () => {
    expect(decisionLines(decision("pam-1", "컵 치우기", step({ from: "drinking", next_index: 0, to: "*", on: LEAVE.on, action: "컵 치우기", learned: true })))).toEqual(["컵을 두고 자리를 뜨면 치워도 된다고 하셨어요"]);
    // 배우기 전 떠날 때: 허락 문장 없이 로봇 말만(사용자 답 2026-11-19). 배운 뒤 컵 치우기는 허락 문장 다음 「컵을 치울게요.」
    expect(decisionLines(decision("pam-2", "사용자에게 물어보기", step({ from: "drinking", next_index: 0, to: "*", on: LEAVE.on, action: "사용자에게 물어보기" })))).toEqual([]);
    expect(SAY_TEXT.decided("사용자에게 물어보기")).toBe("컵을 치울지 여쭤볼게요.");
    expect(SAY_TEXT.decided("컵 치우기")).toBe("컵을 치울게요.");
    expect(decisionLines(decision("pam-3", "컵 치우기", step({ from: "drinking", next_index: 2, to: "*", on: "사용자가 외출하러 나간다.", when: "같이 마시는 중이었다.", action: "컵 치우기", learned: true })))[0]).toMatch(/^사용자가 외출하러 나간다\. 같이 마시는 중이었다면 /);
    expect(decisionLines(decision("pam-4", null, step({ state: "drinking" })))).toEqual([]);
  });

  /** 시연 기억 화살표마다 조건형에 있어야 하는 말(그 화살표의 상황). */
  const MUST: Record<string, string[]> = {
    "컵 치우기": ["컵", "자리를 뜨"],
    "컵에 물 채워 주기": ["식사", "비면"],
    "컵에 콜라 따라 주기": ["TV", "비면"],
    "에어컨 켜기": ["덥다", "부채질"],
    "라면 끓이기 알려 주기": ["라면", "묻거나", "막히"],
    "전자레인지로 데우기 알려 주기": ["전자레인지", "묻거나", "어떻게"],
  };

  it("시연 기억의 행동 화살표마다 사용자가 정한 짧은 꼴의 조건형이 있고 「아무도 안 만지면」 같은 덧조건은 없다. 새 트리거의 배운 화살표는 줄이지 않고 그대로 조건으로 쓴다", () => {
    for (const st of LEARNED_FSM_MEMORY.states) st.next.forEach((e, i) => {
      if (!e.action || e.action === ASK_ACTION) return;
      const learned = !CUP_FSM_MEMORY.states.find((x) => x.id === st.id)!.next.some((x) => x.on === e.on && x.action === e.action);
      const line = decisionLines(decision("pam-1", e.action, step({ from: st.id, next_index: i, to: e.to, on: e.on, when: e.when ?? null, action: e.action, learned })))[0]!;
      expect(RULE_IF[e.action], e.on).toBeTruthy();
      expect(line, e.on).toBe(`${RULE_IF[e.action]} ${TASK_SAY[e.action]!.may} 된다고 하셨어요`);
      // 짧은 꼴이다(메시지 상자 한 줄은 잘린다: 조건은 26자까지)
      expect([...RULE_IF[e.action]!].length, e.action).toBeLessThanOrEqual(26);
      for (const word of MUST[e.action] ?? []) expect(line, e.action).toContain(word);
      // 덧조건(「아무도 안 만지면」·「들거나 만지지 않으면」)은 넣지 않는다
      expect(line, e.action).not.toMatch(/아무도|만지/);
    });
    expect(decisionLines(decision("pam-1", "컵 치우기", step({ from: "drinking", next_index: 2, to: "*", on: "사용자가 밤 열한 시 넘어 거실 불을 끄고 컵을 소파 옆에 둔다.", action: "컵 치우기", learned: true }))))
      .toEqual(["사용자가 밤 열한 시 넘어 거실 불을 끄고 컵을 소파 옆에 둔다면 치워도 된다고 하셨어요"]);
    expect(decisionLines(decision("pam-1", "춤추기", step({ from: "drinking", next_index: 2, to: "drinking", on: "음악이 나옴", action: "춤추기", learned: true })))).toEqual(["「음악이 나옴」일 때 춤추기를 해도 된다고 하셨어요"]);
  });

  it("화살표 없음·화살표 행동과 고른 행동이 다름·묻기·대기·실패 판단은 허락 문장이 없다", () => {
    expect(decisionLines(decision("pam-1", "컵 치우기", step()))).toEqual([]);
    expect(decisionLines(decision("pam-1", "컵 치우기", step({ from: "drinking", next_index: 1, to: "drinking", on: "사용자가 마시던 것을 다 마시고 계속 먹는다.", when: "식탁에 앉아 있다.", action: "컵에 물 채워 주기" })))).toEqual([]);
    expect(decisionLines(decision("pam-1", "컵 치우기", null))).toEqual([]);
    expect(decisionLines(decision("pam-1", null, step({ state: "drinking" })))).toEqual([]);
    expect(decisionLines(decision("pam-1", "컵 치우기", clearStep(), "failed"))).toEqual([]);
  });

  it("행동 목록의 모든 행동은 허락형·클로이드 말(「~게요」)이 있고, 문장은 판단 기록의 사실(화살표·행동)로만 만들어 PAM 생각 글이나 목록에 없는 행동(물기 닦기)이 나오지 않는다", () => {
    for (const action of TASK_NAMES) {
      expect(TASK_SAY[action]?.will, action).toMatch(/게요$/);
      const lines = decisionLines(decision("pam-1", action, step({ from: "drinking", next_index: 0, to: "*", on: LEFT_CUP, action })));
      // 묻기는 허락 문장이 없다(로봇 말 「컵을 치울지 여쭤볼게요.」만)
      if (action === ASK_ACTION) expect(lines).toEqual([]);
      else expect(lines[0], action).toBe(`${RULE_IF[action] ?? "사용자가 컵을 식탁 등에 두고 자리를 비웠고, 아무도 컵을 들거나 만지지 않는다면"} ${TASK_SAY[action]!.may} 된다고 하셨어요`);
      expect(`${lines.join(" ")} ${SAY_TEXT.decided(action)}`, action).not.toMatch(/물기|닦/);
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
    feed.decision(decision("pam-2", "컵 치우기", clearStep()));
    expect(sent).toEqual([{ type: "thought", messages: [{ id: "pam-2@2000:0", text: RULE_LINE, at_ms: 2000, decision: "pam-2" }] }]);
    expect(kept.map((m) => m.text)).toEqual([RULE_LINE]);
    expect(feed.last()).toEqual({ type: "thought", messages: kept });
  });

  it("같은 행동 판단이 이어지면(이미 올린 말) 다시 보내지 않는다. 대기 판단은 줄을 보내지 않는다", () => {
    const sent: ThoughtEvent[] = [];
    let now = 1000;
    const feed = thoughtFeed({ send: (m) => sent.push(m), clock: () => now });
    feed.decision(decision("pam-1", "컵 치우기", clearStep()));
    now = 2000;
    feed.decision(decision("pam-2", "컵 치우기", clearStep()));
    feed.decision(decision("pam-3", null, step({ state: "away" })));
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
    feed.decision(decision("pam-7", "컵 치우기", clearStep()));
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
    feed.decision(decision("pam-1", "컵 치우기", clearStep()));
    expect(feed.last()!.messages.map((m) => m.text)).toEqual([RULE_LINE]);
  });

  it("기록에서 읽은 최근 메시지(seed)로 시작해 바로 다시 보낼 수 있고, 이미 올린 말은 되풀이하지 않는다. THOUGHT_KEEP_MS보다 오래된 메시지는 다시 보내지 않는다", () => {
    let now = 1_000_000;
    const seed: ThoughtMessage[] = [{ id: "pam-9@1000000:0", text: RULE_LINE, at_ms: 1_000_000, decision: "pam-9" }];
    const sent: ThoughtEvent[] = [];
    const feed = thoughtFeed({ send: (m) => sent.push(m), seed, clock: () => now });
    expect(feed.last()).toEqual({ type: "thought", messages: seed });
    feed.decision(decision("pam-1", "컵 치우기", clearStep()));
    expect(sent).toEqual([]);
    now += THOUGHT_KEEP_MS + 10;
    feed.decision(decision("pam-2", "컵 치우기", clearStep()));
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
