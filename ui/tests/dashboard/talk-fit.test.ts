// @vitest-environment node
// 메시지 상자 줄은 한 줄로 잘린다(TalkBox truncate). 시연 기억 규칙의 허락 줄(src/brain/thought.ts 「<조건> <허락> 된다고 하셨어요」)이
// 가장 작은 대시보드(1280×720·1280×800)의 메시지 상자 한 줄에 잘림 없이 다 들어가는지 본다(2026-11-18 조정자: 길면 끝이 안 보인다).
// 문장 줄은 사용자가 허락한 큰 글 16px(item.tsx talk 크기, 2026-11-18 「메시지박스 글씨 키워」)이다.
import { describe, expect, it } from "vitest";
import { TASK_SAY } from "../../../src/act/tasks.ts";
import { RULE_IF } from "../../../src/world/labels.ts";
import { pageLayout } from "../../src/dashboard/layout";
import { MASCOT } from "../../src/lib/mascot-image";

/** 줄 글자 크기(px, Item talk text-base): 한글·전각은 한 글자 이만큼, 그 밖(빈칸·영문·숫자·문장 부호)은 그 반으로 넉넉히 잰다(굵은 최신 줄 포함). */
const FONT = 16;
const widthOf = (text: string) => [...text].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힯　-〿＀-￯]/.test(ch) ? FONT : FONT / 2), 0);
/** 상자 안 글 칸: Item sm 좌우 px-4(16씩), 오른쪽 아래 ▼ 자리(24)와 그 사이(gap-2.5 10). */
const INSET = 16 * 2 + 24 + 10;

describe("메시지 상자 한 줄", () => {
  it.each([[1280, 720], [1280, 800]])("시연 기억 규칙의 허락 줄(16px)은 %i×%i 대시보드 메시지 상자 한 줄에 잘림 없이 들어간다", (width, height) => {
    const room = pageLayout({ width, height }, MASCOT).bubble.width - INSET;
    expect(room).toBeGreaterThan(0);
    expect(widthOf("컵을 두고 자리를 뜨면 치워도 된다고 하셨어요")).toBeLessThanOrEqual(room);
    for (const [action, cond] of Object.entries(RULE_IF)) {
      const line = `${cond} ${TASK_SAY[action]!.may} 된다고 하셨어요`;
      expect(widthOf(line), line).toBeLessThanOrEqual(room);
    }
  });
});
