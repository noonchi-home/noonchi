// 폰 화면이 쓰는 부품 변형: 영상 위 글 14px(body-sm 토큰), 상태 줄 scrim 바탕, 사진 요청 brand 바탕·headline 글(제목 굵기 700).
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Alert, AlertTitle } from "../src/components/ui/alert";
import { Button } from "../src/components/ui/button";
import { Status, StatusLabel } from "../src/components/ui/status";

const words = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);

describe("폰용 부품 변형", () => {
  it("Button size touch는 body-sm 글이고, 키는 배치 class로 키운다", () => {
    render(<Button size="touch" className="h-12">AR 시작</Button>);
    const w = words(screen.getByRole("button", { name: "AR 시작" }));
    expect(w).toEqual(expect.arrayContaining(["text-body-sm", "h-12"]));
    expect(w).not.toContain("text-label");
    expect(w).not.toContain("h-9");
  });

  it("Status scrim은 scrim-phone 바탕에 on-scrim 글, size touch는 body-sm", () => {
    render(<Status variant="scrim" size="touch"><StatusLabel>맞추기 전</StatusLabel></Status>);
    const w = words(screen.getByText("맞추기 전").closest("[data-slot=status]")!);
    expect(w).toEqual(expect.arrayContaining(["bg-scrim-phone", "text-on-scrim", "text-body-sm"]));
    expect(w).not.toContain("text-label");
  });

  it("Alert brand는 brand 바탕에 on-brand 글, size lg는 headline 글. 제목도 headline 굵기(700)", () => {
    render(<Alert variant="brand" size="lg"><AlertTitle>컵 안을 비춰 주세요</AlertTitle></Alert>);
    const w = words(screen.getByRole("alert"));
    expect(w).toEqual(expect.arrayContaining(["bg-brand", "text-on-brand", "text-headline", "*:data-[slot=alert-title]:font-bold"]));
    expect(w).not.toContain("text-body-sm");
    // 제목 옆 아이콘은 18px(spec 6절 제목 아이콘), 아이콘 칸도 같은 너비
    expect(w).toEqual(expect.arrayContaining(["[&>svg]:w-4.5", "has-[>svg]:grid-cols-[calc(var(--spacing)*4.5)_1fr]"]));
    expect(w).not.toContain("[&>svg]:w-4");
    // 기본 크기 제목은 받은 그대로 font-medium
    render(<Alert><AlertTitle>연결됨</AlertTitle></Alert>);
    expect(words(screen.getByText("연결됨").closest("[role=alert]")!)).not.toContain("*:data-[slot=alert-title]:font-bold");
  });

  it("기본 변형은 그대로다", () => {
    render(<><Button>설정</Button><Status><StatusLabel>연결됨</StatusLabel></Status></>);
    expect(words(screen.getByRole("button", { name: "설정" }))).toEqual(expect.arrayContaining(["text-label", "h-9"]));
    expect(words(screen.getByText("연결됨").closest("[data-slot=status]")!)).toContain("text-label");
  });
});
