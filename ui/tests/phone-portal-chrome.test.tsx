import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import { PhoneHomePeek, PhoneLaunchHero, PhonePortalHeader, PhonePortalNav } from "../src/components/phone-portal-chrome";

afterEach(() => vi.useRealTimers());

async function expectLargeMascot(image: Element | null | undefined) {
  expect(image).toBeVisible();
  const source = image!.getAttribute("src")!;
  const asset = resolve(dirname(fileURLToPath(import.meta.url)), "../public", source.slice(1));
  const { width, height, hasAlpha } = await sharp(asset).metadata();
  expect(hasAlpha).toBe(true);
  expect(width * height).toBeGreaterThanOrEqual(618 * 1080);
  expect(width / height).toBeCloseTo(206 / 360, 3);
  expect(image).toHaveAttribute("src", "/brand/mascot-large.webp");
  expect(Number(image!.getAttribute("width")) / Number(image!.getAttribute("height"))).toBeCloseTo(206 / 360, 3);
}

it("폰 메뉴의 주소를 제공하고 현재 탭 하나만 표시한다", () => {
  const { rerender } = render(<PhonePortalNav active="home" />);
  const nav = within(screen.getByRole("navigation", { name: "폰 메뉴" }));
  const home = nav.getByRole("link", { name: "홈" });
  const scan = nav.getByRole("link", { name: "집 관리" });
  const settings = nav.getByRole("link", { name: "설정" });
  expect(within(nav.getByRole("list")).getAllByRole("listitem")).toHaveLength(3);
  expect(home).toHaveAttribute("href", "/mobile/?tab=home");
  expect(scan).toHaveAttribute("href", "/mobile/?tab=house");
  expect(settings).toHaveAttribute("href", "/mobile/settings/");
  expect(home.querySelector("svg")).toHaveClass("lucide-house");
  expect(scan.querySelector("svg")).toHaveClass("lucide-map");
  expect(settings.querySelector("svg")).toHaveClass("lucide-settings");
  expect(home).toHaveAttribute("aria-current", "page");
  expect(scan).not.toHaveAttribute("aria-current");
  expect(settings).not.toHaveAttribute("aria-current");
  rerender(<PhonePortalNav active="scan" />);
  expect(home).not.toHaveAttribute("aria-current");
  expect(scan).toHaveAttribute("aria-current", "page");
});

it("클릭과 키보드 Enter를 같은 페이지 전환에 전달한다", async () => {
  const onTab = vi.fn();
  render(<PhonePortalNav active="home" onTab={onTab} />);
  expect(fireEvent.click(screen.getByRole("link", { name: "집 관리" }))).toBe(false);
  screen.getByRole("link", { name: "설정" }).focus();
  await userEvent.keyboard("{Enter}");
  expect(onTab.mock.calls).toEqual([["scan"], ["settings"]]);
});

it("보조 클릭·수정 키 클릭과 이미 취소된 클릭은 가로채지 않는다", () => {
  const onTab = vi.fn();
  render(<PhonePortalNav active="home" onTab={onTab} />);
  const scan = screen.getByRole("link", { name: "집 관리" });
  const observed: boolean[] = [];
  // Allow React to handle the event before observing and stopping jsdom navigation.
  const stopNavigation = (event: MouseEvent) => {
    observed.push(event.defaultPrevented);
    event.preventDefault();
  };
  document.addEventListener("click", stopNavigation);
  try {
    for (const options of [{ button: 1 }, { button: 2 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
      fireEvent.click(scan, options);
    }
    const cancelled = createEvent.click(scan);
    cancelled.preventDefault();
    fireEvent(scan, cancelled);
  } finally {
    document.removeEventListener("click", stopNavigation);
  }
  expect(observed).toEqual([false, false, false, false, false, false, true]);
  expect(onTab).not.toHaveBeenCalled();
});

it("폰 헤더는 공식 워드마크만 표시하고 제목은 한 번 읽힌다", () => {
  render(<PhonePortalHeader />);
  const banner = screen.getByRole("banner");
  const heading = within(banner).getByRole("heading", { name: "NOONCHI" });
  const mark = within(heading).getByRole("img", { name: "NOONCHI" });
  expect(mark).toBeVisible();
  expect(mark).toHaveAttribute("src", "/brand/noonchi-wordmark.svg");
  expect(Array.from(banner.querySelectorAll("img"))).toEqual([mark]);
});

it("홈에서 팀 얼굴을 장식으로만 보여 주고 버튼이나 포커스 대상을 추가하지 않는다", async () => {
  const user = userEvent.setup();
  const { container } = render(<><PhoneHomePeek /><PhonePortalNav active="home" /></>);
  const peek = container.querySelector(".phone-home-peek");
  expect(peek).toHaveAttribute("aria-hidden", "true");
  const face = peek?.querySelector("img");
  expect(face).toHaveAttribute("src", "/brand/face-peek.webp");
  expect(face).toHaveAttribute("width", "768");
  expect(face).toHaveAttribute("height", "252");
  expect(peek?.querySelector('[data-slot="message-bubble"]')).toBeNull();
  expect(screen.queryByRole("button", { hidden: true })).not.toBeInTheDocument();
  await user.tab();
  expect(screen.getByRole("link", { name: "홈" })).toHaveFocus();
});

it("등록된 집에서는 고밀도 전신 브랜드 그림을 얼굴 마스크에 쓴다", async () => {
  const { container } = render(<PhoneHomePeek registered />);
  const peek = container.querySelector(".phone-home-peek");
  expect(peek).toHaveAttribute("aria-hidden", "true");
  await expectLargeMascot(peek?.querySelector(".phone-home-peek__crop img"));
});

it("NOONCHI 로고와 고밀도 마스코트를 보여주고 이미지 로드 없이 약 1초 뒤 한 번 완료한다", async () => {
  vi.useFakeTimers();
  const onDone = vi.fn();
  const { container } = render(<StrictMode><PhoneLaunchHero onDone={onDone} /></StrictMode>);
  const mark = screen.getByRole("img", { name: "NOONCHI" });
  expect(mark).toBeVisible();
  expect(mark).toHaveAttribute("src", "/brand/noonchi-wordmark.svg");
  expect(container.querySelectorAll(".phone-launch-hero__logo img")).toHaveLength(1);
  await expectLargeMascot(container.querySelector(".phone-launch-hero__mascot"));
  act(() => vi.advanceTimersByTime(900));
  expect(onDone).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1200));
  expect(onDone).toHaveBeenCalledTimes(1);
});

it("첫 진입 화면을 내리면 예약된 완료 콜백도 취소한다", () => {
  vi.useFakeTimers();
  const onDone = vi.fn();
  const { unmount } = render(<PhoneLaunchHero onDone={onDone} />);
  unmount();
  act(() => vi.advanceTimersByTime(1200));
  expect(onDone).not.toHaveBeenCalled();
});
