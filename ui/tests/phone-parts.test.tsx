// 실제 폰 화면이 쓰는 부품: 글 크기는 부품 원래 크기라 폰용 큰 글 변형(Button·Status touch, Status scrim, Alert brand·lg)이 없다.
// Alert Dialog는 container 안에 그린다(AR DOM 오버레이 뿌리 안이어야 AR 중에 보인다).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from "../src/components/ui/alert-dialog";
import { Button } from "../src/components/ui/button";
import { Status, StatusLabel } from "../src/components/ui/status";

const words = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);
/** 부품 원본(ui 폴더에서 돈다: npm --prefix ui test). jsdom 시험은 import.meta.url이 파일 주소가 아니다. */
const part = (f: string) => readFileSync(join(process.cwd(), "src/components/ui", f), "utf8");

describe("실제 폰 화면이 쓰는 부품", () => {
  it("폰용 큰 글 변형이 없다: 부품 원래 크기만", () => {
    expect(part("button.tsx")).not.toMatch(/\btouch:/);
    expect(part("status.tsx")).not.toMatch(/\b(touch|scrim):/);
    expect(part("alert.tsx")).not.toMatch(/\b(lg|brand):/);
  });

  it("Alert Dialog는 container 안에 그린다", () => {
    const root = document.createElement("div");
    document.body.append(root);
    render(<AlertDialog open><AlertDialogContent container={root} aria-describedby={undefined}><AlertDialogTitle>설정</AlertDialogTitle></AlertDialogContent></AlertDialog>);
    expect(root.contains(screen.getByRole("alertdialog", { name: "설정" }))).toBe(true);
    root.remove();
  });

  it("기본 변형은 그대로다", () => {
    render(<><Button>설정</Button><Status><StatusLabel>연결됨</StatusLabel></Status></>);
    expect(words(screen.getByRole("button", { name: "설정" }))).toEqual(expect.arrayContaining(["text-label", "h-9"]));
    expect(words(screen.getByText("연결됨").closest("[data-slot=status]")!)).toContain("text-label");
  });
});
