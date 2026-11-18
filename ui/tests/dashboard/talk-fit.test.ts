// @vitest-environment node
// 메시지 상자 줄은 한 줄로 잘린다(TalkBox truncate). 시연 기억 규칙의 허락 줄(src/brain/thought.ts 「<조건> <허락> 된다고 하셨어요」)이
// 가장 작은 대시보드(1280×720)의 메시지 상자 한 줄에 잘림 없이 다 들어가는지 본다(2026-11-18 조정자: 길면 끝이 안 보인다).
import { describe, expect, it } from "vitest";
import { TASK_SAY } from "../../../src/act/tasks.ts";
import { RULE_IF } from "../../../src/world/labels.ts";
import { pageLayout } from "../../src/dashboard/layout";
import { MASCOT } from "../../src/lib/mascot-image";

/** 줄 글자 크기(px, Item text-sm): 한글·전각은 한 글자 이만큼, 그 밖(빈칸·영문·숫자·문장 부호)은 그 반으로 넉넉히 잰다(굵은 최신 줄 포함). */
const FONT = 14;
const widthOf = (text: string) => [...text].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힯　-〿＀-￯]/.test(ch) ? FONT : FONT / 2), 0);
/** 상자 안 글 칸: Item sm 좌우 px-4(16씩), 오른쪽 아래 ▼ 자리(24)와 그 사이(gap-2.5 10). */
const INSET = 16 * 2 + 24 + 10;

describe("메시지 상자 한 줄", () => {
  it("시연 기억 규칙의 허락 줄은 1280×720 대시보드 메시지 상자(절반 너비) 한 줄에 잘림 없이 들어간다", () => {
    const room = pageLayout({ width: 1280, height: 720 }, MASCOT).bubble.width - INSET;
    expect(room).toBeGreaterThan(0);
    for (const [action, cond] of Object.entries(RULE_IF)) {
      const line = `${cond} ${TASK_SAY[action]!.may} 된다고 하셨어요`;
      expect(widthOf(line), line).toBeLessThanOrEqual(room);
    }
  });
});
