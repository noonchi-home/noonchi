// 대시보드 자료 리듀서(data.ts): 서버 메시지 → 단계 번호·마스코트 방향·말·생각 말풍선. 자료는 가짜 단계(fake-run.json, scripts/twin3d/fake-run.ts).
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { EMPTY_DASH, facingOf, reduceDash, stepIndex, thoughtOf } from "../../src/dashboard/data";
import run from "../../src/dashboard/fake-run.json";

const feed = (ms: ServerMessage[], now = 0) => ms.reduce((s, m) => reduceDash(s, m, now), EMPTY_DASH);
const at = (i: number) => feed(run.moments[i]!.messages as ServerMessage[]);

describe("대시보드 자료", () => {
  it("지켜보기: 계획 없음, 마스코트는 그림 그대로, PAM이 대기라 생각 말풍선이 없다", () => {
    const s = at(0);
    expect([stepIndex(s.plan), facingOf(s.plan), thoughtOf(s)]).toEqual([0, "video", null]);
    expect(thoughtOf(EMPTY_DASH)).toBeNull();
  });
  it("생각 말풍선: 행동을 고른 판단의 생각 한 문장, FSM 상태 이름표(영어 id가 아닌 화면 글), 행동 이름", () => {
    expect(thoughtOf(at(1))).toEqual({ reasoning: "사람이 자리를 비운 뒤에도 컵이 식탁에 남아 있어요.", state: "컵을 두고 자리를 뜸", action: "컵 치우기" });
  });
  it("서버가 상태를 못 찾았거나(fsm null·없음) 이름표가 없는 상태면 상태는 null이다(칩을 숨긴다)", () => {
    const s = at(1);
    const d = s.decision!;
    expect(thoughtOf({ ...s, decision: { ...d, fsm: null } })?.state).toBeNull();
    expect(thoughtOf({ ...s, decision: { ...d, fsm: undefined } })?.state).toBeNull();
    expect(thoughtOf({ ...s, decision: { ...d, fsm: { state: "made_by_reflector", trigger: "t" } } })).toMatchObject({ state: null, action: "컵 치우기" });
  });
  it("계획 단계마다 번호·마스코트·말이 따라간다", () => {
    const says = ["식탁으로 가라고 했어요.", "컵을 들라고 했어요.", "싱크대로 가라고 했어요.", "컵을 싱크대에 넣으라고 했어요."];
    for (let n = 1; n <= 4; n++) {
      const s = at(n);
      expect([stepIndex(s.plan), facingOf(s.plan), s.say, thoughtOf(s)?.action]).toEqual([n, "twin", says[n - 1], "컵 치우기"]);
    }
  });
  it("추정 눈은 버리고, 같은 계획의 옛 번호도 버린다", () => {
    const s = at(2);
    const eye = reduceDash(s, { type: "eye", eye: { ...s.eye!, position: [0, 0], estimated: true } }, 0);
    expect(eye.eye!.position).toEqual(s.eye!.position);
    const old = reduceDash(s, { type: "plan", plan: { ...s.plan!, revision: s.plan!.revision - 1 } }, 0);
    expect(old.plan).toBe(s.plan);
  });
  it("물체 모양(seen)은 대시보드 자료에 넣지 않는다(초당 10번 와도 화면 전체를 다시 그리지 않게, masks.ts 저장소가 든다). 가짜 단계에는 컵 모양 seen이 있다", () => {
    const s = at(1);
    const seen = (run.moments[1]!.messages as ServerMessage[]).find((m) => m.type === "seen")!;
    expect(seen).toMatchObject({ type: "seen", frame: { width: 405, height: 720 }, shapes: [{ label: "cup" }] });
    expect(reduceDash(s, seen, 5)).toBe(s);
    expect(Object.keys(s).sort()).toEqual(["decision", "eye", "plan", "say"]);
  });
  it("hello면 처음으로 돌린다(접속 스냅숏이 뒤따름)", () => {
    expect(reduceDash(at(3), { type: "hello", devices: 1, provider: null, hub: "memory", home: "mokryeon_180b" }, 0)).toEqual(EMPTY_DASH);
  });
});
