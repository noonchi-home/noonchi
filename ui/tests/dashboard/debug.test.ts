// @vitest-environment node
// 가짜 단계(debug.ts) 주소 설정과 순간 자료.
import { describe, expect, it } from "vitest";
import { EMPTY_DASH, reduceDash, talkOf } from "../../src/dashboard/data";
import { debugPhone, debugQuery, FIND_LINE, MOMENTS, talkMoment, WIDE_FRAME, WIDE_TOP, wideMoment, type Moment } from "../../src/dashboard/debug";

/** 순간 메시지를 차례로 넣은 메시지 상자. */
const talkAt = (m: Moment) => talkOf(m.messages.reduce((s, x, i) => reduceDash(s, x, i), EMPTY_DASH));

describe("가짜 단계 가로 눈 그림(&wide=1)", () => {
  it("주소에 wide=1이 있을 때만 가로다", () => {
    expect(debugQuery("?debug=steps&wide=1")?.wide).toBe(true);
    expect(debugQuery("?debug=steps")?.wide).toBe(false);
  });

  it("가로 순간은 세로 눈 그림에서 잘라 낸 가로 프레임(405×228)이다: seen 프레임 크기와 컵 마스크 자리를 잘라 낸 만큼 올리고, 다른 메시지는 그대로다", () => {
    for (const m of MOMENTS) {
      const w = wideMoment(m);
      const top = WIDE_TOP[m.eye];
      const seen = (x: typeof m) => x.messages.find((y) => y.type === "seen")!;
      const [a, b] = [seen(m), seen(w)];
      if (a.type !== "seen" || b.type !== "seen") throw new Error("seen 없음");
      expect(b.frame).toEqual(WIDE_FRAME);
      expect(b.shapes).toHaveLength(a.shapes.length);
      a.shapes.forEach((s, i) => {
        const [x, y, cw, ch] = s.mask.at;
        expect(b.shapes[i]!.mask.at).toEqual([x, y - top, cw, ch]);
        // 컵이 가로 프레임 안에 다 들어온다
        expect(y - top).toBeGreaterThanOrEqual(0);
        expect(y - top + ch).toBeLessThanOrEqual(WIDE_FRAME.height);
      });
      expect(w.messages.filter((y) => y.type !== "seen")).toEqual(m.messages.filter((y) => y.type !== "seen"));
    }
  });

  it("가로면 대시보드 폰 칸 그림은 -wide 그림과 가로 크기다", () => {
    const q = debugQuery("?debug=steps&wide=1")!;
    expect(debugPhone(q, MOMENTS[2]!, "u")).toEqual({ kind: "image", src: "/debug-eye/eye-table-near-wide.webp", ...WIDE_FRAME });
  });
});

describe("가짜 단계 메시지 상자 상태(&talk)", () => {
  it("주소의 talk는 find·habit만 받는다", () => {
    expect(debugQuery("?debug=steps&talk=find")?.talk).toBe("find");
    expect(debugQuery("?debug=steps&talk=habit")?.talk).toBe("habit");
    expect(debugQuery("?debug=steps&talk=x")?.talk).toBeNull();
    expect(debugQuery("?debug=steps")?.talk).toBeNull();
  });

  it("find: 최신 줄이 찾기 상태 줄이고 습관 줄이 없다. habit: 행동을 고른 순간에 「배운 습관」 줄이 붙고 줄은 그대로다", () => {
    const find = talkAt(talkMoment(MOMENTS[0]!, "find"))!;
    expect(find.lines.at(-1)!.text).toBe(FIND_LINE);
    expect(find.habit).toBeNull();
    const plain = talkAt(MOMENTS[1]!)!;
    const habit = talkAt(talkMoment(MOMENTS[1]!, "habit"))!;
    expect(plain.habit).toBeNull();
    expect(habit.habit).toMatch(/^배운 습관: .+ · 컵 치우기$/);
    expect(habit.lines).toEqual(plain.lines);
    expect(talkMoment(MOMENTS[1]!, null)).toBe(MOMENTS[1]);
  });
});
