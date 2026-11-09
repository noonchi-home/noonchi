// 글 크기 검사(scripts/lint-ui-type.ts): 대시보드 화면 입구에서 닿는 화면 코드와 21st.dev 부품이 멀리서 읽는 far 글,
// 화면 너비로 커지는 허브 글 크기 토큰, 부품 원래 크기보다 큰 글을 쓰면 실패하고 쓸 크기를 알려 준다.
// 예시는 실제로 들어갔던 줄이다(8cd9981: 카드 글이 카드를 망가뜨릴 만큼 컸다. 트윈 말풍선 far는 ea477ca에서 한 번 바로잡혔다).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileProblems, lintUiType, USER_SIZES } from "../scripts/lint-ui-type.js";

const head = (name: string, size: string) => `// 21st.dev「${name}」(id 1, a/b) 받은 코드.\n// 바꾼 것: 없음.\n// 원래 글 크기: ${size}\n`;
const texts = (ps: { text: string }[]) => ps.map((p) => p.text);

describe("부품 글 크기", () => {
  it("Item 제목의 허브 글 크기(body-sm)와 far를 잡고 원래 크기 text-sm(14px)을 알려 준다", () => {
    const src = `${head("Basic Item", "text-sm(14px)")}const t = cn("flex w-fit items-center gap-2 text-body-sm leading-snug font-medium group-data-[size=far]/item:text-far", className)`;
    const got = fileProblems("ui/src/components/ui/item.tsx", src, "part");
    expect(texts(got)).toEqual(["text-body-sm", "text-far"]);
    for (const p of got) expect(p.fix).toContain("text-sm(14px)");
    expect(got[0]!.line).toBe(4);
  });

  it("Tooltip 큰 말풍선의 허브 글 크기(트윈 기기 이름·확인 칩·상태 줄)와 far를 잡는다", () => {
    const src = `${head("Tooltip", "text-sm(14px)")}const SIZE = {
  lg: "text-caption [&_[data-part=title]]:text-body-sm [&_[data-part=title]]:font-medium [&_[data-part=title]_[data-slot=status]]:text-body-sm",
  say: "text-body",
  far: "text-far",
} as const;`;
    expect(texts(fileProblems("ui/src/components/ui/tooltip.tsx", src, "part"))).toEqual(["text-caption", "text-body-sm", "text-body-sm", "text-body", "text-far"]);
  });

  it("Status·Avatar에 더한 큰 글(body, far)을 잡는다", () => {
    expect(texts(fileProblems("status.tsx", `${head("Status", "text-xs(12px)")}size: { default: "", body: "text-body" },`, "part"))).toEqual(["text-body"]);
    expect(texts(fileProblems("avatar.tsx", `${head("Avatar", "text-xs(12px)")}"group-data-[size=lg]/avatar:text-far",`, "part"))).toEqual(["text-far"]);
  });

  it("부품 원래 크기보다 큰 Tailwind 글 크기·px 글 크기를 잡고, 원래 크기 이하는 둔다", () => {
    const src = `${head("Status", "text-xs(12px)")}a = "text-xs font-medium"; b = "text-sm"; c = "text-[16px]"; d = "text-[11px]";`;
    const got = fileProblems("status.tsx", src, "part");
    expect(texts(got)).toEqual(["text-sm", "text-[16px]"]);
    expect(got[0]!.fix).toContain("text-xs(12px)");
    expect(fileProblems("dialog.tsx", `${head("Dialog", "text-lg(18px)")}t = "text-lg font-semibold"; d = "text-sm";`, "part")).toEqual([]);
  });

  it("글자색·정렬 class와 주석은 글 크기가 아니다", () => {
    const src = `${head("Tooltip", "text-sm(14px)")}// 예전에는 text-far였다\nconst a = "text-popover-foreground text-ink-2 text-balance text-center max-sm:text-center text-muted-foreground text-sm";`;
    expect(fileProblems("tooltip.tsx", src, "part")).toEqual([]);
  });

  it("머리에 원래 글 크기 줄이 없는 부품은 실패한다", () => {
    const got = fileProblems("x.tsx", `// 21st.dev「X」(id 1, a/b) 받은 코드.\n// 바꾼 것: 없음.\nconst a = "text-sm";`, "part");
    expect(got.map((p) => p.rule)).toContain("원래 글 크기 없음");
  });
});

describe("사용자가 허락한 큰 글", () => {
  /** item.tsx 모양: 크기 변형 줄과 제목 줄. */
  const item = (say: string, title = "text-sm") => `${head("Basic Item", "text-sm(14px)")}const itemVariants = cva("group/item flex items-center text-sm", {
  variants: {
    size: {
      default: "p-4 gap-4 ",
      sm: "py-3 px-4 gap-2.5",
      ${say}
    },
  },
})
const title = cn("flex w-fit items-center gap-2 ${title} leading-snug font-medium", className)`;

  it("설정 1~3단계 큰 글: Button·Alert setup 줄 text-lg, Status setup 줄 text-base만 되고 다른 줄·더 큰 글은 잡는다", () => {
    const quote = "1,2,3 글씨 더 키워도될거같고";
    for (const part of ["components/ui/button.tsx", "components/ui/alert.tsx", "components/ui/status.tsx", "components/ui/card.tsx", "components/ui/radio-group.tsx", "components/ui/input.tsx", "components/ui/badge.tsx", "components/ui/select-native.tsx"]) {
      expect(USER_SIZES.filter((u) => u.part === part).every((u) => u.quote === quote && u.date === "2026-11-09")).toBe(true);
      expect(USER_SIZES.some((u) => u.part === part)).toBe(true);
    }
    const button = (line: string) => `${head("Button", "text-sm(14px)")}const buttonVariants = cva("text-sm", {
  variants: {
    size: {
      ${line}
    },
  },
})`;
    expect(fileProblems("ui/src/components/ui/button.tsx", button(`setup: "h-12 px-5 py-2 text-lg",`), "part")).toEqual([]);
    expect(texts(fileProblems("ui/src/components/ui/button.tsx", button(`setup: "h-12 px-5 py-2 text-xl",`), "part"))).toEqual(["text-xl"]);
    expect(texts(fileProblems("ui/src/components/ui/button.tsx", button(`lg: "h-12 px-5 py-2 text-lg",`), "part"))).toEqual(["text-lg"]);
    const status = (line: string) => `${head("Status", "text-xs(12px)")}const statusVariants = cva("text-xs", {
  variants: {
    size: {
      ${line}
    },
  },
})`;
    expect(fileProblems("ui/src/components/ui/status.tsx", status(`setup: "text-base",`), "part")).toEqual([]);
    expect(texts(fileProblems("ui/src/components/ui/status.tsx", status(`setup: "text-lg",`), "part"))).toEqual(["text-lg"]);
    expect(texts(fileProblems("ui/src/components/ui/alert.tsx", `${head("Alert", "text-sm(14px)")}const a = {
  size: {
    big: "text-lg",
  },
}`, "part"))).toEqual(["text-lg"]);
  });

  it("마스코트 말풍선 카드 글(item.tsx say 크기 줄) text-base(16px), 사용자 말과 날짜가 있다", () => {
    expect(USER_SIZES[0]).toMatchObject({
      part: "components/ui/item.tsx", size: "text-base", px: 16, date: "2026-11-09",
      quote: "말풍선 안에 글씨만 가운데 정렬 + 좀 더 크게 + 굵은글씨 가자",
    });
  });

  it("item.tsx say 크기 줄의 text-base는 된다", () => {
    expect(fileProblems("ui/src/components/ui/item.tsx", item(`say: "py-3 px-4 gap-2.5 text-base font-bold text-center",`), "part")).toEqual([]);
  });

  it("그 밖의 큰 글은 그대로 잡는다: say 줄의 더 큰 글, item.tsx 다른 줄의 text-base, 다른 부품 say 줄의 text-base, 화면 코드의 text-base", () => {
    expect(texts(fileProblems("ui/src/components/ui/item.tsx", item(`say: "py-3 px-4 gap-2.5 text-lg font-bold",`), "part"))).toEqual(["text-lg"]);
    expect(texts(fileProblems("ui/src/components/ui/item.tsx", item(`say: "py-3 px-4 gap-2.5 text-[16px] font-bold",`), "part"))).toEqual(["text-[16px]"]);
    const title = fileProblems("ui/src/components/ui/item.tsx", item(`say: "py-3 px-4 gap-2.5 text-base font-bold",`, "text-base"), "part");
    expect(texts(title)).toEqual(["text-base"]);
    expect(title[0]!.fix).toContain("text-sm(14px)");
    expect(texts(fileProblems("ui/src/components/ui/tooltip.tsx", `${head("Tooltip", "text-sm(14px)")}const SIZE = {\n  say: "text-base",\n} as const;`, "part"))).toEqual(["text-base"]);
    expect(texts(fileProblems("ui/src/proto/a/SayCard.tsx", `<Item size="sm" className="size-full text-base">`, "screen"))).toEqual(["text-base"]);
  });
});

describe("화면 코드 글 크기", () => {
  it("부품의 far 크기를 고르면 잡는다", () => {
    const src = `<Item size="far" data-fsm={fsm} className="flex-nowrap py-1">`;
    expect(fileProblems("ui/src/proto/a/PhonePane.tsx", src, "screen").map((p) => p.rule)).toEqual(["far 크기"]);
  });

  it("디자인 토큰 글 크기(tokens.type)로 자리를 재면 잡는다", () => {
    const src = `const farLine = wide ? tokens.type.far.lineHeight.hub1920 : tokens.type.far.lineHeight.hub1440;`;
    const got = fileProblems("ui/src/proto/a/layout.ts", src, "screen");
    expect(got.map((p) => p.rule)).toEqual(["토큰 글 크기로 자리 재기", "토큰 글 크기로 자리 재기"]);
    expect(got[0]!.fix).toContain("text-sm");
  });

  it("화면 코드는 글 크기 class를 쓰지 않는다", () => {
    expect(texts(fileProblems("ui/src/proto/a/x.tsx", `<p className="text-sm text-body">`, "screen"))).toEqual(["text-sm", "text-body"]);
    expect(fileProblems("ui/src/proto/a/x.tsx", `<p className="truncate text-balance">`, "screen")).toEqual([]);
  });
});

describe("저장소", () => {
  it("대시보드 입구(ui/src/dashboard/main.tsx)에서 닿는 파일만 본다: 닿는 화면 코드의 큰 글은 잡고, 닿지 않는 파일은 보지 않는다", () => {
    const src = mkdtempSync(join(tmpdir(), "lint-ui-type-"));
    try {
      mkdirSync(join(src, "dashboard"));
      mkdirSync(join(src, "phone"));
      writeFileSync(join(src, "dashboard", "main.tsx"), `import { Screen } from "./Screen";
export const x = Screen;
`);
      writeFileSync(join(src, "dashboard", "Screen.tsx"), `export const Screen = () => <p className="text-body">a</p>;
`);
      writeFileSync(join(src, "phone", "Far.tsx"), `export const Far = () => <p className="text-far">a</p>;
`);
      const got = lintUiType(src);
      expect(got.map((p) => `${p.file.split("/").slice(-2).join("/")} ${p.text}`)).toEqual(["dashboard/Screen.tsx text-body"]);
    } finally { rmSync(src, { recursive: true, force: true }); }
  });

  it("대시보드 입구에서 닿는 화면·부품 코드에 글 크기 문제가 없다", () => {
    const got = lintUiType();
    expect(got.map((p) => `${p.file}:${p.line} ${p.text}`)).toEqual([]);
  });
});
