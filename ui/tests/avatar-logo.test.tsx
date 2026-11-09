import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar, AvatarImage } from "../src/components/ui/avatar";

describe("로고 얼굴 상자(Avatar shape logo)", () => {
  it("안 여백을 부모 너비 %로 주지 않는다(머리줄 안에서 얼굴이 점이 되던 문제)", () => {
    const { container } = render(<Avatar shape="logo" className="size-[34px]"><AvatarImage src="/brand/face-128.png" alt="" /></Avatar>);
    const root = container.querySelector<HTMLElement>("[data-shape=logo]")!;
    expect(root).not.toBeNull();
    expect(root.className).not.toMatch(/(^|\s)p-\[\d+%\]/);
  });
});
