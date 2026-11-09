// 대시보드 자료 리듀서(data.ts): 서버 메시지 → 단계 번호·마스코트 방향·말·FSM·YOLO 상자. 자료는 가짜 단계(fake-run.json, scripts/twin3d/fake-run.ts).
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { BOX_TTL_MS, EMPTY_DASH, facingOf, fsmOf, liveBoxes, reduceDash, stepIndex } from "../../src/dashboard/data";
import run from "../../src/dashboard/fake-run.json";

const feed = (ms: ServerMessage[], now = 0) => ms.reduce((s, m) => reduceDash(s, m, now), EMPTY_DASH);
const at = (i: number) => feed(run.moments[i]!.messages as ServerMessage[]);

describe("대시보드 자료", () => {
  it("지켜보기: 계획 없음, 마스코트는 영상, 행동 대기", () => {
    const s = at(0);
    expect([stepIndex(s.plan), facingOf(s.plan), fsmOf(s).action]).toEqual([0, "video", "대기"]);
  });
  it("계획 단계마다 번호·마스코트·말이 따라간다", () => {
    const says = ["식탁으로 가라고 했어요.", "컵을 들라고 했어요.", "싱크대로 가라고 했어요.", "컵을 싱크대에 넣으라고 했어요."];
    for (let n = 1; n <= 4; n++) {
      const s = at(n);
      expect([stepIndex(s.plan), facingOf(s.plan), s.say, fsmOf(s).action]).toEqual([n, "twin", says[n - 1], "컵 치우기"]);
    }
  });
  it("추정 눈은 버리고, 같은 계획의 옛 번호도 버린다", () => {
    const s = at(2);
    const eye = reduceDash(s, { type: "eye", eye: { ...s.eye!, position: [0, 0], estimated: true } }, 0);
    expect(eye.eye!.position).toEqual(s.eye!.position);
    const old = reduceDash(s, { type: "plan", plan: { ...s.plan!, revision: s.plan!.revision - 1 } }, 0);
    expect(old.plan).toBe(s.plan);
  });
  it("YOLO 상자는 3초 동안만, 이름은 한국어, 상자는 [왼쪽, 위, 오른쪽, 아래]", () => {
    const s = feed(run.moments[1]!.messages as ServerMessage[], 1000);
    const [cup] = liveBoxes(s, 1000);
    expect(cup!.label).toBe("컵");
    expect(cup!.box[2]).toBeGreaterThan(cup!.box[0]);
    expect(liveBoxes(s, 1000 + BOX_TTL_MS + 1)).toEqual([]);
  });
  it("hello면 처음으로 돌린다(접속 스냅숏이 뒤따름)", () => {
    expect(reduceDash(at(3), { type: "hello", devices: 1, provider: null, hub: "memory", home: "mokryeon_180b" }, 0)).toEqual(EMPTY_DASH);
  });
});
