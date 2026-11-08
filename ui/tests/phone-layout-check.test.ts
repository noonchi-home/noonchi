// 실제 폰 덮개 배치 검사(layout-check.ts): 화면 사진 페이지(shots.tsx)가 크롬에서 잰 자리로 부른다.
// 단추는 화면 안(또는 화면 안 스크롤 칸 안)에 있어야 하고, 세로 화면에서 엄지 자리 단추(완료·답·기록)는 엄지가 닿는 아래 1/3 안에 있어야 한다.
// 위 줄·엄지 자리는 가운데 조준점(28px)과 그 칸 밖 단추를 가리면 안 된다(모달 안 단추는 그 위에 뜨므로 보지 않는다).
// 화면 밖 화살표는 칸과 단추에 겹치지 않아야 한다. 명령·비전 상태 글은 잘리지 않아야 한다. 처음 화면은 AR 시작 단추가 첫 화면 안.
import { describe, expect, it } from "vitest";
import { clipIssues, introIssues, layoutIssues } from "../src/phone/layout-check";

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const top = { name: "위 줄", box: box(16, 8, 374, 72) };
const thumb = { name: "엄지 자리", box: box(16, 712, 374, 828) };
const meerkat = { name: "설정", box: box(16, 8, 64, 56), scroller: null, zone: "위 줄" };
const done = { name: "완료", box: box(26, 770, 364, 818), scroller: null, zone: "엄지 자리" };

describe("실제 폰 덮개 배치 검사", () => {
  it("미어캣·명령은 위, 비전 상태·완료는 아래 엄지 자리: 문제 없음", () => {
    expect(layoutIssues(PORTRAIT, [meerkat, done], [top, thumb])).toEqual([]);
  });

  it("화면 밖으로 밀린 단추는 문제. 스크롤 칸 안 단추는 그 칸이 화면 안이면 괜찮다", () => {
    expect(layoutIssues(PORTRAIT, [{ ...done, box: box(26, 830, 364, 878) }], [])).toEqual(["「완료」 단추가 화면 밖이에요(26,830–364,878 / 390×844)"]);
    expect(layoutIssues(PORTRAIT, [{ name: "닫기", box: box(16, 830, 374, 878), scroller: box(0, 300, 390, 800) }], [])).toEqual([]);
  });

  it("세로 화면의 엄지 자리 단추는 아래 1/3 안. 위로 올라가면 문제, 가로 화면은 보지 않는다", () => {
    expect(layoutIssues(PORTRAIT, [{ ...done, box: box(26, 500, 364, 548) }], [])).toEqual(["「완료」 단추가 엄지가 닿는 아래 1/3 밖이에요(26,500–364,548 / 390×844)"]);
    expect(layoutIssues(LANDSCAPE, [{ ...done, box: box(470, 200, 830, 248) }], [])).toEqual([]);
    // 위 줄 미어캣·모달 단추는 이 검사에 넣지 않는다
    expect(layoutIssues(PORTRAIT, [meerkat, { name: "닫기", box: box(16, 400, 374, 448), scroller: null, zone: "모달" }], [])).toEqual([]);
  });

  it("칸이 가운데 조준점(28px)이나 그 칸 밖 단추를 가리면 문제. 모달 안 단추는 칸 위에 뜨므로 괜찮다", () => {
    expect(layoutIssues(PORTRAIT, [], [{ name: "엄지 자리", box: box(16, 400, 374, 828) }])).toEqual(["「엄지 자리」 칸이 조준점을 가려요"]);
    expect(layoutIssues(PORTRAIT, [meerkat], [{ name: "엄지 자리", box: box(16, 40, 374, 300) }])).toEqual(["「엄지 자리」 칸이 「설정」 단추를 가려요"]);
    expect(layoutIssues(PORTRAIT, [{ name: "닫기", box: box(16, 720, 374, 768), scroller: null, zone: "모달" }], [thumb])).toEqual([]);
  });

  it("화면 밖 화살표가 칸이나 단추와 겹치면 문제(모달 안 단추는 빼고)", () => {
    expect(layoutIssues(PORTRAIT, [meerkat, done], [top, thumb], [{ name: "싱크대", box: box(340, 400, 382, 440) }])).toEqual([]);
    expect(layoutIssues(PORTRAIT, [meerkat, done], [top, thumb], [
      { name: "에어컨", box: box(140, 40, 180, 90) },
      { name: "TV", box: box(200, 700, 240, 740) },
    ])).toEqual(["「에어컨」 화살표가 「위 줄」 칸과 겹쳐요", "「TV」 화살표가 「엄지 자리」 칸과 겹쳐요"]);
  });
});

describe("글 잘림 검사", () => {
  const text = (line: number, scrollW: number, scrollH: number, clientW: number, clientH: number) => ({ name: "명령", line, scroll: { width: scrollW, height: scrollH }, client: { width: clientW, height: clientH } });

  it("글이 칸 안에 다 들어가면 문제 없음(폭 1px 반올림, 줄 높이 절반보다 작은 글자 넘침은 괜찮다)", () => {
    expect(clipIssues([text(14, 240, 17, 249, 14), text(20, 250, 40, 249, 40)])).toEqual([]);
  });

  it("옆으로 넘치거나 아래 줄이 잘리면 문제", () => {
    expect(clipIssues([text(14, 277, 17, 168, 14)])).toEqual(["「명령」 글이 잘려요(277×17 / 168×14)"]);
    expect(clipIssues([text(20, 249, 60, 249, 40)])).toEqual(["「명령」 글이 잘려요(249×60 / 249×40)"]);
  });
});

describe("처음 화면 배치 검사", () => {
  it("AR 시작 단추는 스크롤하지 않은 첫 화면 안", () => {
    expect(introIssues(PORTRAIT, box(32, 470, 358, 518))).toEqual([]);
    expect(introIssues({ width: 360, height: 780 }, box(32, 760, 328, 808))).toEqual(["「AR 시작」 단추가 첫 화면 밖이에요(32,760–328,808 / 360×780)"]);
    expect(introIssues(LANDSCAPE, box(216, 379, 628, 427))).toEqual(["「AR 시작」 단추가 첫 화면 밖이에요(216,379–628,427 / 844×390)"]);
    expect(introIssues(PORTRAIT, null)).toEqual(["「AR 시작」 단추가 없어요"]);
  });
});
