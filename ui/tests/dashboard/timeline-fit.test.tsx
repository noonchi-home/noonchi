// 시간 줄 카드는 메시지 상자와 같은 높이(TALK_H 128)다(2026-11-19 사용자 「응」: 예상 줄을 빼면서 세로 크기 맞추기).
// 들어가는 것: 맨 위 시간 눈금 한 줄, 사람 줄, 로봇 줄, 두 줄을 가로지르는 구간 위의 「N.N초」. 글은 부품 원래 크기이고 줄 높이·여백만 줄인다.
// 가장 작은 대시보드(1280×720·1280×800)에서 줄 높이와 글 줄 높이(text-xs 16, text-sm 20)를 견줘 글이 위아래로 잘리지 않는지,
// 줄 이름·눈금 글·반응 간격 글이 옆으로 잘리지 않는지 본다(jsdom은 재지 못하므로 그린 class를 픽셀로 옮겨 센다).
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pageLayout, TALK_H } from "../../src/dashboard/layout";
import { TimelineCard, TIMELINE_SPAN_S, TIMELINE_TICK_S } from "../../src/dashboard/TimelineCard";
import { WORDS } from "../../src/dashboard/words";
import { MASCOT } from "../../src/lib/mascot-image";
import { TIMELINE_CLEAR, TIMELINE_NOW } from "./fixtures";

/** Tailwind 크기 class → px(h-N·py-N·inset-N은 N×4). */
const unit = (el: Element, prefix: string): number | null => {
  const c = el.className.split(/\s+/).find((x) => new RegExp(`^${prefix}-\\d+(\\.\\d+)?$`).test(x));
  return c ? Number(c.slice(prefix.length + 1)) * 4 : null;
};
/** 글 크기 class의 줄 높이(px). */
const LINE: Record<string, number> = { "text-xs": 16, "text-sm": 20 };
const lineOf = (el: Element) => {
  const own = el.className.split(/\s+/).find((x) => x in LINE);
  return own ? LINE[own]! : null;
};
/** 글 하나의 넉넉한 너비(px): 한글은 글자 크기, 그 밖은 반. */
const widthOf = (text: string, font: number) => [...text].reduce((w, ch) => w + (/[가-힯]/.test(ch) ? font : font / 2), 0);

describe("시간 줄 카드 세로 크기(메시지 상자와 같음)", () => {
  it.each([[1280, 720], [1280, 800]])("%i×%i: 카드는 메시지 상자와 위·아래 선이 같고, 눈금 한 줄 + 사람 줄 + 로봇 줄이 테 안에 다 들며 글이 위아래·옆으로 잘리지 않는다", (width, height) => {
    const L = pageLayout({ width, height }, MASCOT);
    expect(L.timeline.top).toBe(L.bubble.top);
    expect(L.timeline.height).toBe(TALK_H);
    const { container, unmount } = render(<TimelineCard data={TIMELINE_CLEAR} box={{ width: L.timeline.width, height: L.timeline.height }} now={TIMELINE_NOW} />);
    const card = container.querySelector("[data-timeline-card]")!;
    // 줄은 눈금 + 사람 + 로봇 셋이고(예상 줄 없음), 높이 합(각 줄 아래 선 1px 포함) + 판 테(2)가 카드 높이 안이다
    const header = card.querySelector("[data-slot=timeline-header] > div")!;
    const rows = [...card.querySelectorAll<HTMLElement>("[data-slot=timeline-row]")];
    expect(rows.map((r) => r.dataset.row)).toEqual(["person", "robot"]);
    const headerH = unit(header, "h")!;
    const column = parseFloat(card.querySelector<HTMLElement>("[style*='--timeline-column-width']")!.style.getPropertyValue("--timeline-column-width"));
    const rowH = rows.map((r) => unit(r, "h")!);
    expect(headerH + 1 + rowH.reduce((a, b) => a + b + 1, 0) + 2).toBeLessThanOrEqual(TALK_H);
    // 눈금 글·지금 이름표는 머리 줄 안
    for (const m of card.querySelectorAll("[data-slot=timeline-hour-marker]")) expect(lineOf(m)!).toBeLessThanOrEqual(headerH);
    const nowTag = card.querySelector("[data-slot=timeline-current-time] > div")!;
    expect(lineOf(nowTag)! + 2 * (unit(nowTag, "py") ?? 0)).toBeLessThanOrEqual(headerH);
    // 줄 이름(14px)과 칸 글(12px, 칸은 inset-1 안, 글 칸 py-1)은 줄 안
    for (const r of rows) {
      const name = r.querySelector("[data-slot=timeline-row-name]")!;
      expect(lineOf(name)! + 2 * (unit(name.parentElement!, "py") ?? 0), r.dataset.row).toBeLessThanOrEqual(unit(r, "h")!);
      for (const label of r.querySelectorAll("[data-slot=timeline-slot-label]")) {
        expect(lineOf(label)! + 2 * (unit(label.parentElement!, "py") ?? 0), r.dataset.row).toBeLessThanOrEqual(unit(r, "h")! - 2 * 4);
      }
      // 줄 이름은 실제 이름 열에서 양쪽 여백을 뺀 너비 안
      expect(widthOf(name.textContent!, 14)).toBeLessThanOrEqual(column - 2 * (unit(name.parentElement!, "px") ?? 0));
    }
    // 「N.N초」는 따로 줄 없이 두 줄을 가로지르는 구간 위에 얹고, 두 줄 높이 안에 든다
    const gap = card.querySelector("[data-slot=timeline-region-label]")!;
    expect(gap).toHaveTextContent(TIMELINE_CLEAR.gap!.text);
    expect(lineOf(gap)! + 2 * (unit(gap, "py") ?? 0)).toBeLessThanOrEqual(rowH.reduce((a, b) => a + b, 0));
    expect(gap.className).not.toMatch(/(^|\s)bottom-/);
    // 눈금 글 「20초 전」은 눈금 사이(TICK초 너비) 안
    const ppx = (L.timeline.width - column - 2 - 6) / TIMELINE_SPAN_S;
    expect(widthOf(WORDS.timeline.ago(TIMELINE_SPAN_S - TIMELINE_TICK_S), 12) + 8).toBeLessThanOrEqual(ppx * TIMELINE_TICK_S);
    unmount();
  });
});
