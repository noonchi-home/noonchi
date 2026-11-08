// 폰 화면(PhoneScreen.tsx)을 상태마다 그린다: 처음 화면, 카메라 중, 덮개(판단 줄·알림·초점), 메뉴, 사진 요청·행동 부탁, 묻고 답하기, 오류.
// 영상 위 글은 14px 이상(label·caption 토큰 없음), 누르는 것은 48px 이상(h-12·h-16·size-12)인지도 본다.
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SHOTS } from "../src/phone/fixtures";
import { PhoneScreen } from "../src/phone/PhoneScreen";
import type { PhoneActions, PhoneView, Support } from "../src/phone/state";

const actions = (): PhoneActions => ({
  startAr: vi.fn(), stopAr: vi.fn(), takePhoto: vi.fn(), recordAnchor: vi.fn(), resetAnchors: vi.fn(), setMenu: vi.fn(),
  say: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), brainReply: vi.fn(), talkDown: vi.fn(), talkUp: vi.fn(),
});
function show(view: PhoneView) {
  const act = actions();
  const r = render(<PhoneScreen view={view} act={act} />);
  const overlay = r.container.querySelector<HTMLElement>("[data-phone-overlay]")!;
  return { act, overlay, o: within(overlay), ...r };
}
const words = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);

describe("처음 화면", () => {
  it("마스코트·제목·AR 지원 줄·안내 둘. 준비되면 AR 시작을 누를 수 있다. 덮개는 숨어 있다", async () => {
    const { act, overlay, container } = show(SHOTS.intro.view);
    expect(overlay.hidden).toBe(true);
    expect(container.querySelector('img[src="/brand/mascot@1x.webp"]')).toHaveAttribute("alt", "");
    expect(screen.getByRole("heading", { name: "클로이드의 눈" })).toBeInTheDocument();
    expect(screen.getByText("준비됐어요. 첫 기준점 근처에서 AR을 시작하세요.")).toHaveAttribute("data-support", "ready");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "A 거실 창 오른쪽 벽, B 반대편 벽 바로 아래 바닥에 조준점을 맞추고 기록을 눌러요. 초록이면 닿은 거예요",
      '물건 아래 바닥을 조준하고 말하기를 누른 채 "냉장고 여기로"라고 말해요',
    ]);
    await userEvent.click(screen.getByRole("button", { name: "AR 시작" }));
    expect(act.startAr).toHaveBeenCalledOnce();
  });

  it("기준점 상태 전이면 「방 모서리」, 바닥 기준점이면 「지점 기록」", () => {
    show({ ...SHOTS.intro.view, mode: "floor", anchors: null });
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("방 모서리 바닥에 차례로 조준점을 맞추고 지점 기록을 눌러요");
  });

  it("음성 인식이 없으면 말하기 단추 없이 글 입력만", () => {
    show({ ...SHOTS.intro.view, speech: false });
    expect(screen.queryByRole("button", { name: /누르고 말하기/ })).toBeNull();
    expect(screen.getByRole("textbox", { name: "클로이드에게 할 말" })).toHaveAttribute("maxlength", "500");
  });
});

describe("카메라 중(AR)", () => {
  it("덮개에 상태 줄·보낸 장 수·메뉴·기준점·큰 단추 셋. 처음 화면은 숨는다", async () => {
    const { act, overlay, o } = show(SHOTS.camera.view);
    expect(overlay.hidden).toBe(false);
    expect(screen.queryByRole("heading", { name: "클로이드의 눈" })).toBeNull();
    expect(o.getByText("맞추기 전 · 벽 지점 1/2 기록")).toBeInTheDocument();
    expect(o.getByText("11.5 fps")).toHaveAttribute("title", "최근 2초 동안 대시보드로 보낸 화면 장 수");
    expect(o.getByRole("button", { name: "메뉴" })).toHaveAttribute("aria-expanded", "false");
    expect(overlay.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
    await userEvent.click(o.getByRole("button", { name: "✓ A 거실 창 오른쪽 벽 아래 바닥 조준하고 기록" }));
    expect(act.recordAnchor).toHaveBeenCalledWith("A");
    await userEvent.click(o.getByRole("button", { name: "사진 찍기" }));
    await userEvent.click(o.getByRole("button", { name: "끝내기" }));
    await userEvent.click(o.getByRole("button", { name: "메뉴" }));
    expect([act.takePhoto, act.stopAr].map((f) => vi.mocked(f).mock.calls.length)).toEqual([1, 1]);
    expect(act.setMenu).toHaveBeenCalledWith(true);
    expect(o.getByRole("button", { name: "사진 찍기" })).toHaveTextContent("사진");
  });

  it("누르고 말하기: 누르면 talkDown, 떼거나 벗어나면 talkUp(AR 자리)", () => {
    const { act, o } = show(SHOTS.camera.view);
    const talk = o.getByRole("button", { name: "누르고 말하기" });
    fireEvent.pointerDown(talk);
    fireEvent.pointerUp(talk);
    fireEvent.pointerLeave(talk);
    expect(act.talkDown).toHaveBeenCalledWith("ar");
    expect(act.talkUp).toHaveBeenCalledWith("ar");
  });

  it("맞추면 기준점 단추가 사라진다", () => {
    const { o } = show(SHOTS.overlay.view);
    expect(o.queryByRole("button", { name: /조준하고 기록/ })).toBeNull();
  });

  it("영상 위 글은 14px 이상(label·caption 토큰 없음), 누르는 것은 48px 이상", () => {
    for (const name of ["camera", "overlay", "menu", "request", "busy", "busy-anchors"] as const) {
      const { overlay, unmount } = show(SHOTS[name].view);
      const small = [...overlay.querySelectorAll("[class]")].filter((el) => words(el).some((w) => w === "text-label" || w === "text-caption"));
      expect(small.map((el) => el.textContent), name).toEqual([]);
      const tiny = [...overlay.querySelectorAll("button")].filter((b) => !words(b).some((w) => ["h-12", "h-16", "size-12"].includes(w)));
      expect(tiny.map((b) => b.getAttribute("aria-label") ?? b.textContent), name).toEqual([]);
      unmount();
    }
  });
});

describe("덮개: 판단 줄·알림·메뉴", () => {
  it("판단 줄과 알림은 role=status, 맞춤이면 근사 맞춤과 거리 차이", () => {
    const { o } = show(SHOTS.overlay.view);
    expect(o.getByText("식탁 위 컵을 보고 있어요").closest("[role=status]")).not.toBeNull();
    expect(o.getByText("A 지점을 기록했어요").closest("[role=status]")).not.toBeNull();
    expect(o.getByText("근사 맞춤 ✓ · 거리 차이 6cm")).toBeInTheDocument();
  });

  it("메뉴: 글 입력·기준점 다시 찍기·측정 글·닫기. 글을 보내면 say하고 칸을 비운다", async () => {
    const { act, overlay, o } = show(SHOTS.menu.view);
    expect(o.getByRole("button", { name: "메뉴" })).toHaveAttribute("aria-expanded", "true");
    const menu = within(overlay.querySelector<HTMLElement>("#phone-menu")!);
    const input = menu.getByRole("textbox", { name: "클로이드에게 할 말" });
    await userEvent.type(input, "TV 켜줘");
    await userEvent.click(menu.getByRole("button", { name: "보내기" }));
    expect(act.say).toHaveBeenCalledWith("TV 켜줘");
    expect(input).toHaveValue("");
    await userEvent.click(menu.getByRole("button", { name: "기준점 다시 찍기" }));
    expect(act.resetAnchors).toHaveBeenCalledOnce();
    expect(menu.getByText(/보낸 화면 11\.5 \/ 목표 12 fps/)).toBeInTheDocument();
    await userEvent.click(menu.getByRole("button", { name: "닫기" }));
    expect(act.setMenu).toHaveBeenCalledWith(false);
  });
});

describe("사진 요청·행동 부탁", () => {
  it("판단 줄·알림·사진 요청은 위 줄, 승인 대기·행동 부탁은 아래 엄지 자리(큰 단추 위)에 차례로 쌓는다", () => {
    const { o, overlay } = show(SHOTS.busy.view);
    const top = overlay.querySelector<HTMLElement>("[data-phone-zone=top]")!;
    const thumb = overlay.querySelector<HTMLElement>("[data-phone-zone=thumb]")!;
    const order = (zone: HTMLElement, els: HTMLElement[]) => els.map((el) => [...zone.children].findIndex((c) => c.contains(el)));
    expect(order(top, [o.getByText("식탁 위 컵을 보고 있어요"), o.getByText("사진을 위치와 함께 보냈어요"), o.getByRole("alert")])).toEqual([0, 1, 2]);
    expect(within(top).queryAllByRole("button")).toEqual([]);
    expect(order(thumb, [o.getByText("현관문: 현관문 잠금 해제"), o.getByText("식탁 위 컵을 치워 주세요")])).toEqual([0, 1]);
    expect(within(thumb).getAllByRole("button").map((b) => b.textContent)).toEqual(["승인", "취소", "치웠어요", "나중에"]);
    // 위 줄은 터치를 받지 않고 조준점 위에서 잘린다. 엄지 자리는 조준점 아래까지만 크고, 넘치면 그 칸만 스크롤한다
    expect(words(top)).toEqual(expect.arrayContaining(["pointer-events-none", "overflow-hidden", "max-h-[calc(50dvh-86px)]"]));
    expect(words(thumb)).toEqual(expect.arrayContaining(["bottom-24", "overflow-y-auto", "max-h-[calc(50dvh-120px)]"]));
    expect(words(thumb)).not.toContain("pointer-events-none");
    // 가로 화면: 엄지 자리는 조준점 왼쪽, 위 줄은 조준점 오른쪽
    expect(words(thumb)).toEqual(expect.arrayContaining(["landscape:right-[calc(50vw+24px)]", "landscape:max-h-[calc(100dvh-76px)]"]));
    expect(words(top)).toEqual(expect.arrayContaining(["landscape:left-[calc(50vw+24px)]", "landscape:right-24"]));
    for (const zone of [top, thumb]) expect([...zone.querySelectorAll("[class]")].filter((el) => words(el).includes("fixed"))).toEqual([]);
  });

  it("맞추기 전에는 기준점 단추도 엄지 자리 맨 아래에 쌓는다", () => {
    const { o, overlay } = show(SHOTS["busy-anchors"].view);
    const thumb = within(overlay.querySelector<HTMLElement>("[data-phone-zone=thumb]")!);
    expect(thumb.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "승인", "취소", "치웠어요", "나중에", "✓ A 거실 창 오른쪽 벽 아래 바닥 조준하고 기록", "B 반대편 벽 아래 바닥 조준하고 기록",
    ]);
    expect(o.getByText("식탁 위 컵을 보고 있어요")).toBeInTheDocument();
  });

  it("엄지 자리에 놓을 것이 없으면 그 칸을 그리지 않는다", () => {
    const { overlay } = show(SHOTS.overlay.view);
    expect(overlay.querySelector("[data-phone-zone=thumb]")).toBeNull();
  });

  it("사진 요청은 큰 글 알림(role=alert), 사진 단추는 「컵 안」", () => {
    const { o } = show(SHOTS.request.view);
    expect(o.getByRole("alert")).toHaveTextContent("컵 안을 비춰 주세요");
    expect(o.getByRole("button", { name: "사진 찍기" })).toHaveTextContent("컵 안");
  });

  it("행동 부탁 카드: 모의 표·부탁·클로이드라면 줄. 첫 선택이 주 단추, 누르면 brainReply", async () => {
    const { act, o } = show(SHOTS.request.view);
    expect(o.getByText("모의")).toBeInTheDocument();
    expect(o.getByText("식탁 위 컵을 치워 주세요")).toBeInTheDocument();
    expect(o.getByText("클로이드라면: 로봇이 식탁의 컵을 싱크대로 옮긴다 · 기기 명령은 보내지 않아요")).toBeInTheDocument();
    expect(words(o.getByRole("button", { name: "치웠어요" }))).toContain("bg-primary");
    expect(words(o.getByRole("button", { name: "나중에" }))).toContain("border-input");
    await userEvent.click(o.getByRole("button", { name: "치웠어요" }));
    await userEvent.click(o.getByRole("button", { name: "나중에" }));
    expect(vi.mocked(act.brainReply).mock.calls).toEqual([["a1", "done"], ["a1", "later"]]);
  });
});

describe("묻고 답하기", () => {
  it("답 줄(role=status)과 승인 대기: 승인·취소는 그 토큰으로", async () => {
    const { act } = show(SHOTS.talk.view);
    expect(screen.getByText("현관문 잠금 해제는 승인이 필요해요.").closest("[role=status]")).not.toBeNull();
    expect(screen.getByText("현관문: 현관문 잠금 해제")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "승인" }));
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect([vi.mocked(act.confirm).mock.calls, vi.mocked(act.cancel).mock.calls]).toEqual([[["t1"]], [["t1"]]]);
  });

  it("듣는 중이면 그 단추가 destructive에 「듣는 중… 손을 떼면 보내요」, 떼면 talkUp(처음 화면 자리)", () => {
    const { act } = show(SHOTS.listening.view);
    const b = screen.getByRole("button", { name: "듣는 중… 손을 떼면 보내요" });
    expect(words(b)).toContain("bg-destructive");
    fireEvent.pointerUp(b);
    expect(act.talkUp).toHaveBeenCalledWith("intro");
  });

  it("처음 화면 글 입력을 보내면 say하고 칸을 비운다", async () => {
    const { act } = show(SHOTS.intro.view);
    const input = screen.getByRole("textbox", { name: "클로이드에게 할 말" });
    await userEvent.type(input, "불 꺼줘{Enter}");
    expect(act.say).toHaveBeenCalledWith("불 꺼줘");
    expect(input).toHaveValue("");
  });
});

describe("오류", () => {
  it.each([
    [{ kind: "checking" }, "AR 지원을 확인하는 중…", true],
    [{ kind: "insecure" }, "보안 연결이 아니라 AR을 켤 수 없어요. https 주소로 여세요.", true],
    [{ kind: "no-ar" }, "이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.", true],
    [{ kind: "failed", message: "NotAllowedError" }, "AR을 시작하지 못했어요: NotAllowedError", false],
  ] as [Support, string, boolean][])("%o: 까닭을 보이고, 시작 실패만 다시 누를 수 있다", (support, text, disabled) => {
    show({ ...SHOTS.intro.view, support });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AR 시작" }).hasAttribute("disabled")).toBe(disabled);
  });

  it("마이크 권한 오류는 답 줄에", () => {
    show(SHOTS.error.view);
    expect(screen.getByText("마이크 권한이 없어요. 크롬 사이트 설정에서 마이크를 허용해 주세요.").closest("[role=status]")).not.toBeNull();
  });
});
