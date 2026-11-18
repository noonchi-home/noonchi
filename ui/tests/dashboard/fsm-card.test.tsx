// 메시지 상자 FSM 카드(FsmCard)의 상태 바뀜: 판이 새 상태로 옮겨 가고(transform), 빨간 점이 방금 지나온 선을 따라가며(transform 자리 여럿, 끝에 사라짐),
// 새 상태 원이 빨갛게 차고(opacity) 앞 상태 원은 흐려진다(opacity). 움직임 줄이기면 움직이지 않는다. 움직이는 것은 transform·opacity만이다.
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsmCard, FSM_MOVE_MS } from "../../src/dashboard/FsmCard";
import { FSM_CLEAR, FSM_WATCH } from "./fixtures";

const ALLOWED = new Set(["transform", "opacity", "offset", "easing", "composite"]);
const BOX = { width: 460, height: 140 };
type Call = { el: Element; keyframes: Record<string, unknown>[]; ms: number };
let calls: Call[] = [];
let restore: (() => void)[] = [];

beforeEach(() => {
  calls = [];
  restore = [];
  const proto = Element.prototype as unknown as { animate?: unknown };
  const had = proto.animate;
  proto.animate = function (this: Element, kf: Keyframe[], o: KeyframeAnimationOptions) {
    calls.push({ el: this, keyframes: kf as Record<string, unknown>[], ms: Number(o?.duration ?? 0) });
    return { finished: Promise.resolve(), cancel: () => {} } as unknown as Animation;
  };
  restore.push(() => { proto.animate = had; });
});
afterEach(() => { for (const r of restore.reverse()) r(); });

const motionOn = () => {
  const media = window.matchMedia;
  window.matchMedia = ((q: string) => ({ ...media(q), matches: false })) as typeof window.matchMedia;
  restore.push(() => { window.matchMedia = media; });
};

describe("FSM 카드 상태 바뀜", () => {
  it("마시는 중 → 컵을 두고 자리를 뜸: 판이 옮겨 가고, 빨간 점이 지나온 선을 따라가 사라지고, 새 원이 차고 앞 원이 흐려진다(transform·opacity만)", () => {
    motionOn();
    const view = render(<FsmCard fsm={FSM_WATCH} box={BOX} />);
    expect(calls).toEqual([]);
    view.rerender(<FsmCard fsm={FSM_CLEAR} box={BOX} />);
    const c = view.container;
    const world = c.querySelector("[data-fsm-world]")!;
    const dot = c.querySelector("[data-fsm-dot]")!;
    const fill = c.querySelector('[data-fsm-state="left_cup"] [data-fsm-fill]')!;
    const prev = c.querySelector<HTMLElement>('[data-fsm-state="drinking"]')!;
    expect(calls.map((x) => x.el)).toEqual([world, dot, fill, prev]);
    for (const x of calls) {
      expect(x.ms).toBe(FSM_MOVE_MS);
      for (const k of x.keyframes) for (const p of Object.keys(k)) expect(ALLOWED.has(p), p).toBe(true);
    }
    const pan = calls[0]!.keyframes.map((k) => k.transform);
    expect(pan[0]).not.toBe(pan[1]);
    expect(pan[1]).toBe((world as HTMLElement).style.transform);
    const track = calls[1]!.keyframes;
    expect(track.length).toBeGreaterThan(8);
    expect(track.at(-1)!.opacity).toBe(0);
    expect(c.querySelector('[data-fsm-line="taken"]')).toHaveAttribute("data-from", "drinking");
    expect(c.querySelector('[data-fsm-label="taken"]')).toHaveTextContent("컵을 두고 떠남");
    expect(prev).toHaveAttribute("data-prev");
    expect(prev.style.opacity).toBe("0.5");
  });

  it("상자 밖 독립 카드로도 놓인다: 크기는 box, 자리는 놓는 쪽의 배치 class·left·top이고 안 그림은 같다", () => {
    const view = render(<FsmCard fsm={FSM_WATCH} box={{ width: 520, height: 200 }} className="absolute" style={{ left: 24, top: 300 }} />);
    const card = view.container.querySelector<HTMLElement>("[data-fsm-card]")!;
    expect(card.className.split(/\s+/)).toContain("absolute");
    expect(card.className.split(/\s+/)).not.toContain("relative");
    expect([card.style.left, card.style.top, card.style.width, card.style.height]).toEqual(["24px", "300px", "520px", "200px"]);
    expect(card.querySelector('[data-fsm-state="drinking"]')).toHaveAttribute("data-now");
    const world = card.querySelector<HTMLElement>("[data-fsm-world]")!;
    expect(world.style.transform).toMatch(/^translate\(\d+(\.\d+)?px, 100px\)$/);
  });

  it("같은 상태면 움직이지 않고, 움직임 줄이기면 상태가 바뀌어도 바로 바뀐다", () => {
    motionOn();
    const view = render(<FsmCard fsm={FSM_WATCH} box={BOX} />);
    view.rerender(<FsmCard fsm={{ ...FSM_WATCH }} box={BOX} />);
    expect(calls).toEqual([]);
    view.unmount();
    restore.pop()!();
    // 시험 기본(tests/setup.ts)은 움직임 줄이기 켬
    const still = render(<FsmCard fsm={FSM_WATCH} box={BOX} />);
    still.rerender(<FsmCard fsm={FSM_CLEAR} box={BOX} />);
    expect(calls).toEqual([]);
    expect(still.container.querySelector('[data-fsm-state="left_cup"]')).toHaveAttribute("data-now");
  });
});
