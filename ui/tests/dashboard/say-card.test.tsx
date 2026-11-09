// 대시보드 말풍선 카드: 트윈 아래쪽, 마스코트 왼쪽에 꼬리 없는 카드 하나(Item say: 글 16px 굵게 가운데).
// 크기는 글 두 줄 높이로 정해져 있어 말 길이가 자리·크기를 바꾸지 않는다. 말이 바뀌면 앞 말은 가려 둔 채(aria-hidden) 사라지고 새 말이 보인다.
// 보기만 하는 카드라 마우스를 받지 않는다.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pageLayout } from "../../src/dashboard/layout";
import { MASCOT } from "../../src/dashboard/mascot-image";
import { SayCard } from "../../src/dashboard/SayCard";

const L = pageLayout({ width: 1920, height: 1080 }, MASCOT);
const SHORT = "식탁을 보고 있어요.";
const LONG = "식탁 컵을 치우기로 했어요. 컵을 들라고 했어요. 싱크대로 가라고 했어요. 싱크대에 넣으라고 했어요. 다 됐다고 폰에 알렸어요.";

const card = () => document.querySelector<HTMLElement>("[data-say-card]")!;
const boxOf = (el: HTMLElement) => [el.style.left, el.style.top, el.style.width, el.style.height];
const words = (el: Element) => el.className.split(/\s+/);
const lines = () => [...document.querySelectorAll<HTMLElement>("[data-say-line]")];

describe("말풍선 카드", () => {
  it("Item say(data-size=say) 카드이고 마우스를 받지 않는다", () => {
    render(<SayCard say={SHORT} box={L.bubble} animate={false} />);
    expect(card()).not.toBeNull();
    expect(words(card())).toContain("pointer-events-none");
    const item = card().querySelector("[data-slot=item]")!;
    expect(item).toHaveAttribute("data-size", "say");
  });

  it("글 칸은 두 줄 높이로 고정이고, 말은 두 줄까지만 보인다", () => {
    render(<SayCard say={LONG} box={L.bubble} animate={false} />);
    const say = card().querySelector<HTMLElement>("[data-say]")!;
    expect(words(say)).toContain("h-[2lh]");
    for (const line of lines()) expect(words(line)).toContain("line-clamp-2");
  });

  it("카드 자리·크기는 layout의 말풍선 자리이고 말 길이와 상관없이 같다", () => {
    const { rerender } = render(<SayCard say={SHORT} box={L.bubble} animate={false} />);
    const before = boxOf(card());
    expect(before).toEqual([L.bubble.left, L.bubble.top, L.bubble.width, L.bubble.height].map((v) => `${v}px`));
    rerender(<SayCard say={LONG} box={L.bubble} animate={false} />);
    expect(boxOf(card())).toEqual(before);
    rerender(<SayCard say="" box={L.bubble} animate={false} />);
    expect(boxOf(card())).toEqual(before);
  });

  it("말이 바뀌면 앞 말은 aria-hidden으로 남아 사라지고, 새 말이 [data-say-line]으로 보인다", () => {
    const { rerender } = render(<SayCard say={SHORT} box={L.bubble} animate />);
    expect(lines().map((l) => l.textContent)).toEqual([SHORT]);
    expect(lines()[0]).not.toHaveAttribute("aria-hidden");

    rerender(<SayCard say="식탁 컵을 치우기로 했어요." box={L.bubble} animate />);
    const [old, now] = lines();
    expect(old).toHaveTextContent(SHORT);
    expect(old).toHaveAttribute("aria-hidden", "true");
    expect(now).toHaveTextContent("식탁 컵을 치우기로 했어요.");
    expect(now).not.toHaveAttribute("aria-hidden");

    rerender(<SayCard say="컵을 들라고 했어요." box={L.bubble} animate />);
    expect(lines().map((l) => [l.textContent, l.getAttribute("aria-hidden")])).toEqual([
      ["식탁 컵을 치우기로 했어요.", "true"],
      ["컵을 들라고 했어요.", null],
    ]);
  });

  it("같은 말이 다시 오면 아무것도 바뀌지 않는다", () => {
    const { rerender } = render(<SayCard say={SHORT} box={L.bubble} animate />);
    const first = lines()[0];
    rerender(<SayCard say={SHORT} box={L.bubble} animate />);
    expect(lines()).toEqual([first]);
  });
});
