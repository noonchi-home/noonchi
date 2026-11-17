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
  it("주소의 talk는 find만 받는다", () => {
    expect(debugQuery("?debug=steps&talk=find")?.talk).toBe("find");
    expect(debugQuery("?debug=steps&talk=habit")?.talk).toBeNull();
    expect(debugQuery("?debug=steps&talk=x")?.talk).toBeNull();
    expect(debugQuery("?debug=steps")?.talk).toBeNull();
  });

  it("find: 최신 줄이 찾기 상태 줄이고 판단은 컵 치우기(알약 액션 · 컵 치우기)다. 지켜보기 순간의 알약은 처음 상태와 대기다", () => {
    const find = talkAt(talkMoment(MOMENTS[0]!, "find"))!;
    expect(find.lines.at(-1)!.text).toBe(FIND_LINE);
    expect(find.fsm).toEqual({ state: "컵을 두고 자리를 뜸", trigger: expect.any(String), action: "컵 치우기" });
    expect(talkAt(MOMENTS[0]!)!.fsm).toEqual({ state: "먹거나 마시는 중", trigger: "대기", action: "대기" });
    expect(talkMoment(MOMENTS[1]!, null)).toBe(MOMENTS[1]);
  });
});

describe("가짜 단계 메시지 상자 줄이 굴러간다", () => {
  it("계획 순간이 넘어가면 앞 순간의 줄 끝에 새 말 한 줄이 붙는다(같은 묶음을 다시 넣어도 줄 id가 같다)", () => {
    for (const n of [1, 2, 3]) {
      const now = talkAt(MOMENTS[n]!)!.lines;
      const next = talkAt(MOMENTS[n + 1]!)!.lines;
      expect(next.slice(0, -1)).toEqual(now.slice(1));
      expect(next.at(-1)!.id).not.toBe(now.at(-1)!.id);
    }
    expect(talkAt(MOMENTS[3]!)).toEqual(talkAt(MOMENTS[3]!));
  });
});

