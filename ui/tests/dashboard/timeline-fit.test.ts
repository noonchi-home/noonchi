// @vitest-environment node
// 시간 줄 예상 줄 글(「<조건> <행동> · <단계>」, 떠난 뒤 「· N초 먼저」)은 자르지 않는다(TimelineCard Caption, 말줄임 없음).
// 미리 세우는 목표가 되는 행동(TaskSpec.afterUse)의 시연 기억 조건 글이 가장 작은 대시보드(1280×720·1280×800)의 시간 줄 칸 한 줄에 다 들어가는지 본다
// (2026-11-19 조정자: 예상 줄 글이 막대 안에서 잘려 보였다). 글은 부품 원래 크기 12px(TimelineSlotLabel text-xs)이다.
import { describe, expect, it } from "vitest";
import { TASKS } from "../../../src/act/tasks.ts";
import { RULE_IF } from "../../../src/world/labels.ts";
import { TIMELINE_END_GAP } from "../../src/components/ui/timeline";
import { pageLayout } from "../../src/dashboard/layout";
import { TIMELINE_COLUMN_W } from "../../src/dashboard/TimelineCard";
import { WORDS } from "../../src/dashboard/words";
import { MASCOT } from "../../src/lib/mascot-image";

/** 글자 크기(px, text-xs): 한글·전각은 한 글자 이만큼, 그 밖(빈칸·숫자·문장 부호)은 그 반으로 넉넉히 잰다. */
const FONT = 12;
const widthOf = (text: string) => [...text].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힯　-〿＀-￯]/.test(ch) ? FONT : FONT / 2), 0);
/** 글 좌우 안 여백(px-1 4씩)과 지금 선 앞 띄움(4). */
const INSET = 4 * 2 + 4;
/** 가장 긴 단계 글: 목표를 세워 둘 수 있는 30분(1800초) 뒤에 떠난 때의 「1800초 먼저」와 단계 글 가운데 긴 것. */
const TAILS = [WORDS.timeline.lead(1800), ...Object.values(WORDS.timeline.stage)];

describe("시간 줄 예상 줄 한 줄", () => {
  it.each([[1280, 720], [1280, 800]])("미리 세우는 목표 행동의 예상 줄 글은 %i×%i 대시보드 시간 줄 칸 한 줄에 잘림 없이 들어간다", (width, height) => {
    const room = pageLayout({ width, height }, MASCOT).timeline.width - TIMELINE_COLUMN_W - 2 - TIMELINE_END_GAP - INSET;
    expect(room).toBeGreaterThan(0);
    const goals = Object.entries(TASKS).filter(([, t]) => t.afterUse).map(([name]) => name);
    expect(goals.length).toBeGreaterThan(0);
    for (const name of goals) {
      for (const tail of TAILS) {
        const line = `${RULE_IF[name] ?? ""} ${name} · ${tail}`;
        expect(widthOf(line), line).toBeLessThanOrEqual(room);
      }
    }
  });
});
