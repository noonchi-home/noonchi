// 메시지 상자 문장 칸(TalkBox): 최근 세 줄이 굴러간다. 가장 새 줄이 맨 아래(진하게), 위 두 줄은 지난 줄(흐리게, 맨 위가 더 흐리게)이다.
// 새 줄이 오면 세 줄이 한 줄 높이만큼 위로 올라가고 맨 위 줄은 사라지며 새 줄이 아래에서 떠오른다. 움직임은 transform·opacity만이고,
// 짧은 사이에 여러 줄이 와도 차례대로 하나씩 굴러간다. 끝에 붙지 않은 바뀜(안전 알림이 최신 줄로 끼어듦)은 굴리지 않고 바로 바꾼다.
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Talk } from "../../src/dashboard/data";
import { TALK_ROW_STEP, TalkBox } from "../../src/dashboard/TalkBox";

const ALLOWED = new Set(["transform", "opacity", "offset", "easing", "composite"]);
const BOX = { left: 0, top: 0, width: 900, height: 128 };
type Call = { el: Element; keyframes: Record<string, unknown>[]; finish: () => void };
let calls: Call[] = [];
let restore: (() => void)[] = [];

/** 움직임 줄이기를 끈 화면(실제 허브 화면과 같다). jsdom 기본값(tests/setup.ts)은 줄이기 켬. */
const motionOn = () => {
  const media = window.matchMedia;
  window.matchMedia = ((q: string) => ({ ...media(q), matches: false })) as typeof window.matchMedia;
  restore.push(() => { window.matchMedia = media; });
};

beforeEach(() => {
  calls = [];
  restore = [];
  // Element.animate 기록(jsdom에는 없다): 끝은 시험이 finish로 낸다
  const proto = Element.prototype as unknown as { animate?: unknown };
  const had = proto.animate;
  proto.animate = function (this: Element, kf: Keyframe[] | PropertyIndexedKeyframes) {
    let done!: () => void;
    const finished = new Promise<void>((r) => { done = r; });
    calls.push({ el: this, keyframes: (Array.isArray(kf) ? kf : [kf]) as Record<string, unknown>[], finish: () => done() });
    return { finished, cancel: () => {}, finish: () => done(), playState: "running" } as unknown as Animation;
  };
  restore.push(() => { proto.animate = had; });
});
afterEach(() => { for (const r of restore.reverse()) r(); });

const line = (id: string) => ({ id, text: `줄 ${id}` });
const talkOf = (...ids: string[]): Talk => ({ lines: ids.map(line), fsm: null, mode: null });
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-talk-line]")];
const texts = () => rows().map((r) => r.textContent);
/** 지금 굴리기의 움직임을 끝낸다. */
const finishAll = async () => {
  const now = calls.splice(0);
  await act(async () => { for (const c of now) c.finish(); await Promise.resolve(); });
};

describe("메시지 상자 세 줄 굴리기", () => {
  it("최근 세 줄을 보이고, 가장 새 줄이 맨 아래(진하게 ItemTitle)이며 위 두 줄은 지난 줄(ItemDescription)이고 맨 위 줄이 더 흐리다", () => {
    render(<TalkBox talk={talkOf("a", "b", "c")} box={BOX} />);
    expect(texts()).toEqual(["줄 a", "줄 b", "줄 c"]);
    expect(rows().map((r) => [r.dataset.talkLine, r.getAttribute("data-slot")])).toEqual([["old", "item-description"], ["old", "item-description"], ["new", "item-title"]]);
    const [top, mid, last] = rows();
    expect(Number(top!.style.opacity)).toBeLessThan(Number(mid!.style.opacity || 1));
    expect(last!.style.opacity === "" || Number(last!.style.opacity) === 1).toBe(true);
  });

  it("새 줄이 오면 한 줄 높이만큼 위로 굴러간다: 움직임은 transform·opacity만이고, 끝나면 맨 위 줄은 사라지고 새 줄이 맨 아래다", async () => {
    motionOn();
    const view = render(<TalkBox talk={talkOf("a", "b", "c")} box={BOX} />);
    calls = [];
    view.rerender(<TalkBox talk={talkOf("b", "c", "d")} box={BOX} />);
    // 굴리는 동안은 사라질 줄과 새 줄이 함께 있다
    expect(texts()).toEqual(["줄 a", "줄 b", "줄 c", "줄 d"]);
    const move = calls.find((c) => c.keyframes.some((k) => "transform" in k))!;
    expect(move.keyframes.map((k) => k.transform)).toEqual([`translateY(${TALK_ROW_STEP}px)`, "translateY(0px)"]);
    for (const c of calls) for (const k of c.keyframes) for (const p of Object.keys(k)) expect(ALLOWED.has(p), p).toBe(true);
    await finishAll();
    expect(texts()).toEqual(["줄 b", "줄 c", "줄 d"]);
    expect(rows().at(-1)!.dataset.talkLine).toBe("new");
  });

  it("짧은 사이에 두 줄이 와도 겹치거나 건너뛰지 않고 차례대로 한 줄씩 굴러간다", async () => {
    motionOn();
    const view = render(<TalkBox talk={talkOf("a", "b", "c")} box={BOX} />);
    calls = [];
    view.rerender(<TalkBox talk={talkOf("b", "c", "d")} box={BOX} />);
    view.rerender(<TalkBox talk={talkOf("c", "d", "e")} box={BOX} />);
    expect(texts()).toEqual(["줄 a", "줄 b", "줄 c", "줄 d"]);
    await finishAll();
    expect(texts()).toEqual(["줄 b", "줄 c", "줄 d", "줄 e"]);
    await finishAll();
    expect(texts()).toEqual(["줄 c", "줄 d", "줄 e"]);
  });

  it("끝에 붙지 않은 바뀜(안전 알림이 최신 줄로 남고 그 앞에 생각이 끼어듦)은 굴리지 않고 바로 바꾸며, 안전 알림이 맨 아래 최신 줄이다", async () => {
    motionOn();
    const view = render(<TalkBox talk={talkOf("a", "b", "safe")} box={BOX} />);
    calls = [];
    view.rerender(<TalkBox talk={talkOf("b", "t", "safe")} box={BOX} />);
    expect(calls.some((c) => c.keyframes.some((k) => "transform" in k))).toBe(false);
    expect(texts()).toEqual(["줄 b", "줄 t", "줄 safe"]);
    expect(rows().at(-1)!.dataset.talkLine).toBe("new");
  });

  it("움직임 줄이기면 굴리지 않고 바로 새 세 줄이다", () => {
    const view = render(<TalkBox talk={talkOf("a", "b", "c")} box={BOX} />);
    view.rerender(<TalkBox talk={talkOf("b", "c", "d")} box={BOX} />);
    expect(calls.some((c) => c.keyframes.some((k) => "transform" in k))).toBe(false);
    expect(texts()).toEqual(["줄 b", "줄 c", "줄 d"]);
  });
});
