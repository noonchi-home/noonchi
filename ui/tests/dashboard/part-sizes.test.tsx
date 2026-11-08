// 21st.dev 부품 글 크기는 받은 코드의 원래 크기다(Tooltip·Item·Button text-sm, Status·Stepper 번호 text-xs, Dialog 제목 18px).
// 하나만 다르다: 마스코트 말풍선 카드 글(Item say)은 사용자가 허락한 text-base(16px) 굵게 가운데다(scripts/lint-ui-type.ts USER_SIZES).
// 화면 너비로 커지는 토큰 글 크기와 멀리서 읽는 far·body·lg 크기는 없다: 고르는 코드는 typecheck가 막는다(@ts-expect-error가 쓰이지 않으면 실패).
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar, AvatarFallback } from "../../src/components/ui/avatar";
import { Button } from "../../src/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../src/components/ui/dialog";
import { Item, ItemDescription, ItemTitle } from "../../src/components/ui/item";
import { Status } from "../../src/components/ui/status";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../src/components/ui/tooltip";

const HUB = /(^|:)text-(caption|label|body-sm|body|title-sm|title|headline|display|far)$/;
const classes = (el: Element) => el.className.split(/\s+/);

describe("부품 크기 고르기", () => {
  it("far·body·lg 같은 큰 크기는 고를 수 없다", () => {
    const picks = [
      // @ts-expect-error Item에 far 크기는 없다(원래 크기 text-sm)
      <Item key="item" size="far" />,
      // @ts-expect-error Tooltip에 far 크기는 없다(원래 크기 text-sm)
      <TooltipContent key="tip" size="far" />,
      // @ts-expect-error Status에 body 크기는 없다(원래 크기 text-xs)
      <Status key="status" size="body" />,
      // @ts-expect-error Avatar에 lg(44px, far 글) 크기는 없다
      <Avatar key="avatar" size="lg" />,
    ];
    expect(picks).toHaveLength(4);
  });
});

describe("부품 원래 글 크기", () => {
  it("Item 제목·설명은 text-sm이다", () => {
    render(<Item size="sm"><ItemTitle>제목</ItemTitle><ItemDescription>설명</ItemDescription></Item>);
    expect(classes(screen.getByText("제목"))).toContain("text-sm");
    expect(classes(screen.getByText("설명"))).toContain("text-sm");
  });

  it("Status는 text-xs, Button은 text-sm(sm은 text-xs), Avatar 번호(md)는 text-xs다", () => {
    render(<><Status>확인</Status><Button>열기</Button><Button size="sm">작게</Button><Avatar size="md"><AvatarFallback>1</AvatarFallback></Avatar></>);
    expect(classes(screen.getByText("확인"))).toContain("text-xs");
    expect(classes(screen.getByText("열기"))).toContain("text-sm");
    expect(classes(screen.getByText("작게"))).toContain("text-xs");
    expect(classes(screen.getByText("1"))).toContain("group-data-[size=md]/avatar:text-xs");
  });

  it("Tooltip: md는 text-xs, lg는 이름 줄 text-sm·나머지 text-xs, say는 text-sm이다", () => {
    const tip = (size: "md" | "lg" | "say") => {
      const { unmount } = render(
        <TooltipProvider><Tooltip open><TooltipTrigger>t</TooltipTrigger><TooltipContent size={size}>말</TooltipContent></Tooltip></TooltipProvider>,
      );
      const out = classes(document.querySelector('[data-slot="tooltip-content"]')!);
      unmount();
      return out;
    };
    expect(tip("md")).toContain("text-xs");
    expect(tip("lg")).toEqual(expect.arrayContaining(["text-xs", "[&_[data-part=title]]:text-sm"]));
    expect(tip("say")).toContain("text-sm");
  });

  it("Item say(마스코트 말풍선 카드)만 사용자가 허락한 text-base(16px)이고 굵게(font-bold)·가운데(text-center)다", () => {
    render(<Item size="say"><p>말</p></Item>);
    const item = document.querySelector("[data-slot=item]")!;
    expect(item).toHaveAttribute("data-size", "say");
    expect(classes(item)).toEqual(expect.arrayContaining(["text-base", "font-bold", "text-center", "py-3", "px-4"]));
    expect(classes(item)).not.toContain("text-sm");
  });

  it("Dialog 제목은 받은 text-lg와 같은 18px·줄 28px(text-[18px]/7), 설명은 text-sm이다", () => {
    render(<Dialog open><DialogContent><DialogTitle>설정</DialogTitle><DialogDescription>상태</DialogDescription></DialogContent></Dialog>);
    expect(classes(screen.getByText("설정"))).toContain("text-[18px]/7");
    expect(classes(screen.getByText("상태"))).toContain("text-sm");
  });

  it("어느 부품도 화면 너비로 커지는 토큰 글 크기를 쓰지 않는다", () => {
    render(
      <>
        <Item><ItemTitle>a</ItemTitle><ItemDescription>b</ItemDescription></Item>
        <Status>c</Status><Button>d</Button><Avatar size="md"><AvatarFallback>2</AvatarFallback></Avatar>
        <TooltipProvider><Tooltip open><TooltipTrigger>t</TooltipTrigger><TooltipContent size="lg">e</TooltipContent></Tooltip></TooltipProvider>
      </>,
    );
    const hits = [...document.querySelectorAll("*")].flatMap((el) => classes(el).filter((c) => HUB.test(c)));
    expect(hits).toEqual([]);
  });
});
