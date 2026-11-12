// @vitest-environment node
// 가짜 단계(debug.ts) 주소 설정과 순간 자료.
import { describe, expect, it } from "vitest";
import { debugPhone, debugQuery, MOMENTS, WIDE_FRAME, WIDE_TOP, wideMoment } from "../../src/dashboard/debug";

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
