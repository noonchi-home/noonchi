// 폰 덮개 배치 검사(layout-check.ts): 화면 사진 페이지(shots.tsx)가 크롬에서 잰 자리로 부른다.
// 단추는 화면 안(또는 화면 안 스크롤 칸 안)에 있어야 하고, 위 줄·말풍선·엄지 자리는 가운데 조준점(28px)과 그 칸 밖 단추(큰 단추·⋯)를 가리면 안 된다.
import { describe, expect, it } from "vitest";
import { layoutIssues } from "../src/phone/layout-check";

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

describe("폰 덮개 배치 검사", () => {
  it("화면 안 단추·조준점을 비킨 칸이면 문제 없음", () => {
    expect(layoutIssues(PORTRAIT, [{ name: "치웠어요", box: box(16, 620, 190, 668), scroller: null, zone: "엄지 자리" }], [{ name: "엄지 자리", box: box(16, 484, 374, 748) }])).toEqual([]);
  });

  it("화면 밖으로 밀린 단추(가로 화면 아래)는 문제", () => {
    expect(layoutIssues(LANDSCAPE, [{ name: "치웠어요", box: box(16, 403, 190, 451), scroller: null }], [])).toEqual(["「치웠어요」 단추가 화면 밖이에요(16,403–190,451 / 844×390)"]);
  });

  it("스크롤 칸 안 단추는 그 칸이 화면 안이면 스크롤해서 누를 수 있다", () => {
    const scroller = box(16, 64, 398, 378);
    expect(layoutIssues(LANDSCAPE, [{ name: "나중에", box: box(200, 403, 380, 451), scroller }], [])).toEqual([]);
    expect(layoutIssues(LANDSCAPE, [{ name: "나중에", box: box(200, 403, 380, 451), scroller: box(16, 64, 398, 468) }], [])).toEqual(["「나중에」 단추가 화면 밖이에요(16,64–398,468 / 844×390)"]);
  });

  it("칸이 그 칸 밖 단추(큰 단추·⋯)에 닿으면 문제. 그 칸 안 단추는 괜찮다", () => {
    const photo = { name: "사진 찍기", box: box(758, 163, 834, 227), scroller: null };
    expect(layoutIssues(LANDSCAPE, [photo], [{ name: "말풍선", box: box(520, 150, 770, 212) }])).toEqual(["「말풍선」 칸이 「사진 찍기」 단추를 가려요"]);
    expect(layoutIssues(LANDSCAPE, [photo], [{ name: "말풍선", box: box(520, 150, 748, 212) }])).toEqual([]);
    const inside = { name: "치웠어요", box: box(16, 300, 190, 348), scroller: null, zone: "엄지 자리" };
    expect(layoutIssues(LANDSCAPE, [inside], [{ name: "엄지 자리", box: box(16, 64, 398, 378) }])).toEqual([]);
  });

  it("가운데 조준점(28px)에 닿는 칸은 문제", () => {
    expect(layoutIssues(PORTRAIT, [], [{ name: "엄지 자리", box: box(16, 308, 374, 492) }])).toEqual(["「엄지 자리」 칸이 조준점을 가려요"]);
    // 조준점 바로 옆(14px 밖)은 괜찮다
    expect(layoutIssues(LANDSCAPE, [], [{ name: "엄지 자리", box: box(16, 64, 408, 378) }, { name: "위 줄", box: box(436, 64, 748, 300) }])).toEqual([]);
  });
});
