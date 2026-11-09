// @vitest-environment node
// cn(tailwind-merge)은 디자인 토큰 글 크기(text-label·text-far…)를 글자색과 다른 무리로 봐야 한다.
// 모르면 text-label을 글자색으로 보고 같은 cn 안의 text-primary-foreground·text-muted-foreground를 지운다(주 단추 sm 글이 숯색이 됐다).
import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const words = (s: string) => s.split(/\s+/);

describe("cn과 디자인 토큰", () => {
  it("토큰 글 크기와 글자색을 둘 다 남긴다", () => {
    expect(words(cn("text-label text-muted-foreground"))).toEqual(["text-label", "text-muted-foreground"]);
    expect(words(cn("text-muted-foreground line-clamp-2 text-body-sm"))).toEqual(["text-muted-foreground", "line-clamp-2", "text-body-sm"]);
    expect(words(cn("text-ink text-far"))).toEqual(["text-ink", "text-far"]);
  });

  it("토큰 글 크기끼리는 뒤에 온 것만 남긴다", () => {
    expect(cn("text-label text-caption")).toBe("text-caption");
  });

  it("토큰 그림자·모서리끼리도 뒤에 온 것만 남긴다", () => {
    expect(cn("shadow-card shadow-float")).toBe("shadow-float");
    expect(cn("rounded-chip rounded-panel")).toBe("rounded-panel");
  });

  it("주 단추 sm은 글자색 text-primary-foreground를 지킨다", () => {
    // Button은 cn(buttonVariants(…))로 class를 만든다
    const sm = words(cn(buttonVariants({ variant: "default", size: "sm" })));
    expect(sm).toContain("text-primary-foreground");
    expect(sm).toContain("text-xs");
  });
});
