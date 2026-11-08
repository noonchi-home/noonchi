// 폰 덮개 배치 검사(layout-check.ts): 화면 사진 페이지(shots.tsx)가 크롬에서 잰 자리로 부른다.
// 단추는 화면 안(또는 화면 안 스크롤 칸 안)에 있어야 하고, 위 줄·말풍선·엄지 자리는 가운데 조준점(28px)과 그 칸 밖 단추(큰 단추·⋯)를 가리면 안 된다.
// 세로 화면에서 큰 단추 셋(말하기·사진·끝내기)은 엄지가 닿는 아래 1/3 안에 있어야 한다. 위 상태 줄 글은 잘리지 않아야 한다.
// 화면 밖 화살표 묶음(세모+이름표)은 위 줄·말풍선·엄지 자리 칸과 단추에 겹치지 않아야 한다.
import { describe, expect, it } from "vitest";
import { clipIssues, introIssues, layoutIssues } from "../src/phone/layout-check";

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const PORTRAIT = { width: 390, height: 844 };
const PORTRAIT_SMALL = { width: 360, height: 780 };
const LANDSCAPE = { width: 844, height: 390 };

describe("폰 덮개 배치 검사", () => {
  it("화면 안 단추·조준점을 비킨 칸이면 문제 없음", () => {
    expect(layoutIssues(PORTRAIT, [{ name: "치웠어요", box: box(16, 620, 190, 668), scroller: null, zone: "엄지 자리" }], [{ name: "엄지 자리", box: box(16, 484, 374, 748) }])).toEqual([]);
  });

  it("화면 밖으로 밀린 단추(세로 화면 아래)는 문제", () => {
    expect(layoutIssues(PORTRAIT, [{ name: "치웠어요", box: box(16, 830, 190, 878), scroller: null }], [])).toEqual(["「치웠어요」 단추가 화면 밖이에요(16,830–190,878 / 390×844)"]);
  });

  it("스크롤 칸 안 단추는 그 칸이 화면 안이면 스크롤해서 누를 수 있다", () => {
    const scroller = box(16, 446, 374, 748);
    expect(layoutIssues(PORTRAIT, [{ name: "나중에", box: box(200, 760, 374, 808), scroller }], [])).toEqual([]);
    expect(layoutIssues(PORTRAIT, [{ name: "나중에", box: box(200, 760, 374, 808), scroller: box(16, 446, 374, 860) }], [])).toEqual(["「나중에」 단추가 화면 밖이에요(16,446–374,860 / 390×844)"]);
  });

  it("칸이 그 칸 밖 단추(큰 단추·⋯)에 닿으면 문제. 그 칸 안 단추는 괜찮다", () => {
    const photo = { name: "사진 찍기", box: box(157, 764, 233, 828), scroller: null };
    expect(layoutIssues(PORTRAIT, [photo], [{ name: "엄지 자리", box: box(16, 446, 374, 770) }])).toEqual(["「엄지 자리」 칸이 「사진 찍기」 단추를 가려요"]);
    expect(layoutIssues(PORTRAIT, [photo], [{ name: "엄지 자리", box: box(16, 446, 374, 748) }])).toEqual([]);
    const inside = { name: "치웠어요", box: box(16, 600, 190, 648), scroller: null, zone: "엄지 자리" };
    expect(layoutIssues(PORTRAIT, [inside], [{ name: "엄지 자리", box: box(16, 446, 374, 748) }])).toEqual([]);
  });

  it("가로 화면에서도 칸이 오른쪽 큰 단추 줄을 가리면 문제", () => {
    const photo = { name: "사진 찍기", box: box(758, 163, 834, 227), scroller: null };
    expect(layoutIssues(LANDSCAPE, [photo], [{ name: "말풍선", box: box(520, 150, 770, 212) }])).toEqual(["「말풍선」 칸이 「사진 찍기」 단추를 가려요"]);
    expect(layoutIssues(LANDSCAPE, [photo], [{ name: "말풍선", box: box(520, 150, 748, 212) }])).toEqual([]);
  });

  it("가운데 조준점(28px)에 닿는 칸은 문제", () => {
    expect(layoutIssues(PORTRAIT, [], [{ name: "엄지 자리", box: box(16, 308, 374, 492) }])).toEqual(["「엄지 자리」 칸이 조준점을 가려요"]);
    // 조준점 바로 위·아래(14px 밖)는 괜찮다
    expect(layoutIssues(PORTRAIT, [], [{ name: "위 줄", box: box(16, 64, 374, 400) }, { name: "엄지 자리", box: box(16, 446, 374, 748) }])).toEqual([]);
    expect(layoutIssues(LANDSCAPE, [], [{ name: "엄지 자리", box: box(16, 64, 408, 378) }, { name: "위 줄", box: box(436, 64, 748, 300) }])).toEqual([]);
  });

  it("세로 화면의 큰 단추는 엄지가 닿는 아래 1/3 안. 위로 올라가면 문제, 가로 화면은 보지 않는다", () => {
    const big = (top: number) => ["누르고 말하기", "사진 찍기", "끝내기"].map((name, i) => ({ name, box: box(67 + i * 90, top, 143 + i * 90, top + 64), scroller: null }));
    expect(layoutIssues(PORTRAIT, big(764), [])).toEqual([]);
    expect(layoutIssues(PORTRAIT_SMALL, big(700), [])).toEqual([]);
    expect(layoutIssues(PORTRAIT, big(390), [])).toEqual([
      "「누르고 말하기」 단추가 엄지가 닿는 아래 1/3 밖이에요(67,390–143,454 / 390×844)",
      "「사진 찍기」 단추가 엄지가 닿는 아래 1/3 밖이에요(157,390–233,454 / 390×844)",
      "「끝내기」 단추가 엄지가 닿는 아래 1/3 밖이에요(247,390–323,454 / 390×844)",
    ]);
    // 승인·부탁 단추는 엄지 자리 안에서 스크롤하므로 이 검사에 넣지 않는다
    expect(layoutIssues(PORTRAIT, [{ name: "치웠어요", box: box(16, 460, 190, 508), scroller: null }], [])).toEqual([]);
    const column = ["누르고 말하기", "사진 찍기", "끝내기"].map((name, i) => ({ name, box: box(758, 49 + i * 74, 834, 113 + i * 74), scroller: null }));
    expect(layoutIssues(LANDSCAPE, column, [])).toEqual([]);
  });
});

describe("화면 밖 화살표 검사", () => {
  const top = { name: "위 줄", box: box(16, 64, 374, 128) };
  const thumb = { name: "엄지 자리", box: box(16, 564, 374, 748) };
  const talk = { name: "누르고 말하기", box: box(67, 764, 143, 828), scroller: null };

  it("위 줄 아래·엄지 자리 위에 있는 화살표 묶음은 문제 없음", () => {
    expect(layoutIssues(PORTRAIT, [talk], [top, thumb], [{ name: "에어컨", box: box(140, 143, 250, 192) }, { name: "로봇청소기", box: box(220, 500, 382, 556) }])).toEqual([]);
  });

  it("화살표 묶음이 위 줄(말풍선 글 위에 그려짐)이나 엄지 자리(그 아래 깔림), 큰 단추와 겹치면 문제", () => {
    expect(layoutIssues(PORTRAIT, [talk], [top, thumb], [
      { name: "에어컨", box: box(140, 71, 250, 120) },
      { name: "로봇청소기", box: box(220, 700, 382, 756) },
      { name: "TV", box: box(60, 760, 170, 800) },
    ])).toEqual([
      "「에어컨」 화살표가 「위 줄」 칸과 겹쳐요",
      "「로봇청소기」 화살표가 「엄지 자리」 칸과 겹쳐요",
      "「TV」 화살표가 「누르고 말하기」 단추와 겹쳐요",
    ]);
  });
});

describe("글 잘림 검사", () => {
  // 줄 높이가 글자보다 좁으면(예: 14px 글에 줄 높이 14px) 한글 글자 위아래가 줄 상자를 3px쯤 넘어 scroll 높이가 그만큼 크다
  const text = (line: number, scrollW: number, scrollH: number, clientW: number, clientH: number) => ({ name: "상태 줄", line, scroll: { width: scrollW, height: scrollH }, client: { width: clientW, height: clientH } });

  it("글이 칸 안에 다 들어가면 문제 없음(폭 1px 반올림, 줄 높이 절반보다 작은 글자 넘침은 괜찮다)", () => {
    expect(clipIssues([text(14, 240, 17, 249, 14), text(20, 250, 40, 249, 40), text(14, 249, 31, 249, 28)])).toEqual([]);
  });

  it("한 줄에서 옆으로 넘치거나(…로 잘림) 두 줄을 넘쳐 아래 줄이 잘리면 문제", () => {
    expect(clipIssues([text(14, 277, 17, 168, 14)])).toEqual(["「상태 줄」 글이 잘려요(277×17 / 칸 168×14)"]);
    expect(clipIssues([text(20, 249, 60, 249, 40)])).toEqual(["「상태 줄」 글이 잘려요(249×60 / 칸 249×40)"]);
  });
});

describe("처음 화면 배치 검사", () => {
  it("AR 시작 단추는 스크롤하지 않은 첫 세로 화면 안에 있어야 한다(390×844·412×915·360×780)", () => {
    expect(introIssues(PORTRAIT, box(32, 470, 358, 518))).toEqual([]);
    expect(introIssues({ width: 412, height: 915 }, box(32, 470, 380, 518))).toEqual([]);
    expect(introIssues(PORTRAIT_SMALL, box(32, 500, 328, 548))).toEqual([]);
    expect(introIssues(PORTRAIT_SMALL, box(32, 760, 328, 808))).toEqual(["「AR 시작」 단추가 첫 화면 밖이에요(32,760–328,808 / 360×780)"]);
  });

  it("가로로 들어도 AR 시작 단추가 첫 화면 안이어야 한다", () => {
    expect(introIssues(LANDSCAPE, box(216, 247, 628, 295))).toEqual([]);
    expect(introIssues(LANDSCAPE, box(216, 379, 628, 427))).toEqual(["「AR 시작」 단추가 첫 화면 밖이에요(216,379–628,427 / 844×390)"]);
  });

  it("AR 시작 단추가 없으면 문제", () => {
    expect(introIssues(PORTRAIT, null)).toEqual(["「AR 시작」 단추가 없어요"]);
  });
});
