// 대시보드 설정 창: 화면 바탕 위 마스코트를 누르면(마우스·키보드) 설정 창(21st.dev Dialog)이 뜬다. 창에는 연결 상태, 시험 모드·실제 제어,
// 허브, 에이전트, 지금 집 이름, 「집 다시 설정하기」(설정 화면으로 감), 폰 연결 QR이 있다. 입력칸은 없고 Esc·바깥 누르기·닫기 단추로 닫힌다.
// 닫으면 초점이 마스코트로 돌아온다.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { HealthView } from "../../../src/contract/events.ts";
import { hubOf } from "../../src/lib/hub";
import { pageLayout } from "../../src/dashboard/layout";
import { Mascot } from "../../src/dashboard/Mascot";
import { MASCOT } from "../../src/lib/mascot-image";

const HEALTH: HealthView = {
  ok: true, devices: 12, hub: "matter", transport: "network", provider: "openai", model: "gpt-5.5", twin: true, eye: true,
  home: { id: "mokryeon_180b", name: "한양목련 180B" },
  phone_urls: ["http://172.20.0.5:8443/phone/", "https://192.168.0.21:8443/phone/"],
  brain: true, mode: "test",
  ready: {
    ok: true, inference_mode: "openai",
    vlm: { base_url: "http://127.0.0.1:1/v1", model: "vlm", key: true, reachable: true },
    pam: { base_url: "http://127.0.0.1:2/v1", model: "pam", key: true, reachable: true },
    agent: { provider: "openai", base_url: "http://127.0.0.1:3/v1", model: "gpt-5.5", key: true, reachable: true },
    db: true,
  },
};
const HUB = hubOf(HEALTH, true);

const FIELDS = "input, textarea, select, form, [contenteditable], [role=textbox], [role=searchbox], [role=combobox]";
const mascotButton = () => within(screen.getByRole("region", { name: "마스코트" })).getByRole("button", { name: "설정 열기" });
const dialog = () => screen.queryByRole("dialog", { name: "설정" });

function show(hub = HUB, width = 1920, height = 1080) {
  const L = pageLayout({ width, height }, MASCOT);
  return render(<Mascot image={MASCOT} hub={hub} box={L.mascot} imageBox={L.image} logoBox={L.logo} />);
}

describe("허브 상태(hubOf)", () => {
  it("/api/health 값에서 설정 창에 보일 것만 고른다: 폰 주소는 https·집 공유기 대역을 먼저", () => {
    expect(HUB).toEqual({
      connected: true, mode: "test", hub: "matter · network", agent: "openai · gpt-5.5", home: "한양목련 180B",
      phoneUrl: "https://192.168.0.21:8443/phone/", setupHref: "/setup/",
    });
  });

  it("실제 제어 모드는 live, 연결이 끊겼거나 모르면 connected가 아니다", () => {
    expect(hubOf({ ...HEALTH, mode: "live" }, false)).toMatchObject({ mode: "live", connected: false });
    expect(hubOf(HEALTH, null).connected).toBe(false);
  });

  it("집 이름은 괄호 덧붙임을 뺀 짧은 이름만 보인다", () => {
    expect(hubOf({ ...HEALTH, home: { id: "mokryeon_180b", name: "한양목련 180B (도면 기준 · 방 4·욕실 3)" } }, true).home).toBe("한양목련 180B");
    expect(hubOf({ ...HEALTH, home: { id: "oneroom", name: "원룸 예시 (테스트용)" } }, true).home).toBe("원룸 예시");
  });

  it("health를 아직 못 받았으면 빈 값과 시험 모드다", () => {
    expect(hubOf(null, null)).toEqual({ connected: false, mode: "test", hub: "", agent: "", home: "", phoneUrl: "", setupHref: "/setup/" });
  });
});

describe("대시보드 설정 창", () => {
  it("마스코트는 누를 수 있는 단추다: 마우스를 올리면 바탕이 바뀌고 손가락 모양이 되며, 키보드 초점 고리가 보인다", () => {
    show();
    const button = mascotButton();
    expect(button.tagName).toBe("BUTTON");
    expect(button.querySelector('img[src*="brand/mascot"]')).not.toBeNull();
    expect(button.className).toMatch(/(^|\s)hover:bg-hover(\s|$)/);
    expect(button.className).toMatch(/(^|\s)cursor-pointer(\s|$)/);
    expect(button.className).toMatch(/(^|\s)focus-visible:outline-2(\s|$)/);
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(dialog()).toBeNull();
  });

  it("마스코트는 늘 왼쪽을 본다(그림과 가슴 표시 원 모두 같은 뒤집기)", () => {
    const L = pageLayout({ width: 1920, height: 1080 }, MASCOT);
    const { rerender } = render(<Mascot image={MASCOT} hub={HUB} box={L.mascot} imageBox={L.image} logoBox={L.logo} />);
    const region = screen.getByRole("region", { name: "마스코트" });
    expect(region.querySelector<HTMLElement>("[data-mascot-turn]")!.style.transform).toBe("scaleX(-1)");
    expect(region.querySelector<HTMLElement>("[data-mascot-logo]")!.style.transform).toBe("scaleX(-1)");
    rerender(<Mascot image={MASCOT} hub={HUB} box={L.mascot} imageBox={L.image} logoBox={L.logo} />);
    expect(region.querySelector<HTMLElement>("[data-mascot-turn]")!.style.transform).toBe("scaleX(-1)");
  });

  it.each([[1920, 1080], [1440, 900]])("%i×%i: 마스코트 단추는 판 없이 화면 바탕 위에 있고, 가운데가 트윈·영상 나눔선 위, 아래 끝은 화면 밑 선이다. 위·왼쪽·오른쪽 초점 고리(선 굵기 + 띄움)는 화면 안, 말풍선 밖에 그려진다", (width, height) => {
    show(HUB, width, height);
    const button = mascotButton();
    expect(button.className.split(/\s+/)).toContain("size-full");
    expect(button.closest("[data-glass]")).toBeNull();
    // Tailwind 값: outline-N·outline-offset-N은 Npx
    const num = (cls: string, prefix: string) => Number(cls.match(new RegExp(String.raw`(?:^|\s)${prefix}-(\d+(?:\.\d+)?)(?:\s|$)`))?.[1] ?? 0);
    const ring = num(button.className, "focus-visible:outline") + num(button.className, "outline-offset");
    expect(ring).toBe(4);
    const box = button.closest<HTMLElement>("[data-mascot]")!;
    const [left, top, w, h] = [box.style.left, box.style.top, box.style.width, box.style.height].map(Number.parseFloat);
    const L = pageLayout({ width, height }, MASCOT);
    expect(left).toBeCloseTo(L.mascot.left, 5);
    expect(left).toBeGreaterThanOrEqual(ring);
    expect(top! - ring).toBeGreaterThanOrEqual(0);
    expect(L.bubble.left + L.bubble.width).toBeLessThanOrEqual(left! - ring + 1e-6);
    expect(left! + w! + ring).toBeLessThanOrEqual(width);
    expect(top! + h!).toBeCloseTo(height, 5);
  });

  it("화면 바탕 위에서도 마우스 올림·초점이 보인다: 그림과 가슴 LG 표시 원이 함께 transform으로 살짝 올라오고, 움직임 줄이기면 바로 바뀐다", () => {
    show();
    const button = mascotButton();
    const lift = button.querySelector("img")!.parentElement!;
    const has = (el: Element, name: string) => el.className.split(/\s+/).includes(name);
    expect(has(button, "group")).toBe(true);
    expect(lift.querySelector("[data-mascot-logo]")).not.toBeNull();
    for (const c of ["group-hover:-translate-y-2", "group-focus-visible:-translate-y-2", "transition-transform", "motion-reduce:transition-none"]) {
      expect(has(lift, c), c).toBe(true);
    }
  });

  it("마스코트 그림은 단추 상자 안에서 잘린다: 그림이 초점 고리 위에 그려지지 않는다", () => {
    show();
    const button = mascotButton();
    const img = button.querySelector("img")!;
    const has = (el: Element, name: string) => el.className.split(/\s+/).includes(name);
    expect(has(img, "absolute")).toBe(true);
    // 그림(absolute)에서 단추까지 위치 있는 조상은 모두 absolute(단추 안 판)다: 단추 overflow-hidden이 그림을 자른다(고리는 단추 바깥에 그려진다)
    const chain: Element[] = [];
    for (let el = img.parentElement; el && el !== button; el = el.parentElement) chain.push(el);
    expect(button.contains(img)).toBe(true);
    for (const el of chain) expect(["fixed", "sticky"].some((p) => has(el, p))).toBe(false);
    expect(chain.filter((el) => has(el, "absolute")).length).toBe(chain.length);
    expect(has(button, "relative")).toBe(true);
    expect(has(button, "overflow-hidden")).toBe(true);
  });

  it("마우스로 연다", async () => {
    const user = userEvent.setup();
    show();
    await user.click(mascotButton());
    expect(dialog()).toBeInTheDocument();
  });

  it("키보드로 연다: Enter와 스페이스", async () => {
    const user = userEvent.setup();
    show();
    mascotButton().focus();
    await user.keyboard("{Enter}");
    expect(dialog()).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(dialog()).toBeNull());
    mascotButton().focus();
    await user.keyboard(" ");
    expect(dialog()).toBeInTheDocument();
  });

  it("창에는 연결 상태·시험 모드·허브·에이전트·집 이름·「집 다시 설정하기」·폰 QR이 있고 입력칸이 없다", async () => {
    const user = userEvent.setup();
    const { container } = show();
    await user.click(mascotButton());
    const d = dialog()!;
    expect(d).toHaveTextContent("실시간 연결됨");
    expect(d).toHaveTextContent("시험 모드");
    expect(d).toHaveTextContent("matter · network");
    expect(d).toHaveTextContent("openai · gpt-5.5");
    expect(d).toHaveTextContent("한양목련 180B");
    expect(d).toHaveTextContent("https://192.168.0.21:8443/phone/");
    expect(within(d).getByRole("link", { name: "집 다시 설정하기" })).toHaveAttribute("href", "/setup/");
    expect(within(d).getByRole("img", { name: "폰 연결 QR" })).toBeInTheDocument();
    expect(d.querySelectorAll(FIELDS)).toHaveLength(0);
    expect(container.querySelectorAll(FIELDS)).toHaveLength(0);
    expect(document.querySelectorAll(FIELDS)).toHaveLength(0);
  });

  it("연결이 끊기면 창에 「연결 끊김」, 실제 제어면 「실제 제어」다", async () => {
    const user = userEvent.setup();
    show(hubOf({ ...HEALTH, mode: "live" }, false));
    await user.click(mascotButton());
    const d = dialog()!;
    expect(d).toHaveTextContent("연결 끊김");
    expect(d).toHaveTextContent("실제 제어");
  });

  it("health를 아직 못 받았어도 창이 열린다: 폰 주소가 없으면 QR은 없고 「집 다시 설정하기」는 있다", async () => {
    const user = userEvent.setup();
    show(hubOf(null, null));
    await user.click(mascotButton());
    const d = dialog()!;
    expect(within(d).queryByRole("img", { name: "폰 연결 QR" })).toBeNull();
    expect(d).not.toHaveTextContent("폰 카메라로 찍으세요");
    expect(within(d).getByRole("link", { name: "집 다시 설정하기" })).toHaveAttribute("href", "/setup/");
  });

  it("닫으면(Esc·닫기 단추) 초점이 마스코트 단추로 돌아온다", async () => {
    const user = userEvent.setup();
    show();
    await user.click(mascotButton());
    expect(dialog()).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(mascotButton());
    await user.click(mascotButton());
    await user.click(within(dialog()!).getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(mascotButton());
  });

  it("닫기 단추로 닫힌다", async () => {
    const user = userEvent.setup();
    show();
    await user.click(mascotButton());
    await user.click(within(dialog()!).getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it("창 바깥을 누르면 닫힌다", async () => {
    const user = userEvent.setup();
    show();
    await user.click(mascotButton());
    expect(dialog()).toBeInTheDocument();
    // 바깥 누름은 Radix가 문서의 pointerdown·click으로 받는다(창이 뜬 다음 차례부터)
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    await act(async () => {
      fireEvent.pointerDown(document.body, { button: 0 });
      fireEvent.pointerUp(document.body, { button: 0 });
      fireEvent.click(document.body, { button: 0 });
      await new Promise((r) => setTimeout(r, 10));
    });
    await waitFor(() => expect(dialog()).toBeNull());
  });
});
