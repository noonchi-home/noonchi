import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceRefs, TraceRow } from "../../../src/contract/trace.ts";
import { TraceTable } from "../../src/dashboard/TraceTable";

const cup = "boot:home#1:activity-7";
const watch = "boot:home#1:activity-12";
const safety = "boot:home#1:activity-16";
const nextCup = "boot:home#1:activity-20";
const id = (n: number) => `boot:home#1:${n}`;
const attempt = { boot: "boot", homeEpoch: "home#1", attemptId: "pam-3", gen: 0 };
const plan: TraceRefs = { attempt, plan_id: "plan:pam-3", goal_id: "goal-1" };

function trace(n: number, patch: Partial<TraceRow> & Pick<TraceRow, "kind" | "name">): TraceRow {
  return {
    id: id(n), activity_id: cup, rev: 1, refs: {}, input: "컵 1 · 식탁", output: "결과 대기 중",
    started_ms: null, ended_ms: null, state: "done", ...patch,
  };
}

const goal = trace(8, {
  kind: "AGENT", name: "목표 준비", input: "컵 치우기 · 컵 1 · 식탁", output: "준비 시작",
  refs: { goal_id: "goal-1" }, retained: true,
});
const departure = trace(22, { kind: "OBSERVATION", name: "사용자 자리 이탈", output: "자리 이탈 확인", cause_id: goal.id });
const chosen = trace(26, {
  kind: "AGENT", name: "행동 선택", output: "컵 치우기", input: "집 상태 · 행동 목록",
  cause_id: goal.id, refs: plan, started_ms: 100, ended_ms: 110,
});
const looking = trace(34, {
  kind: "TOOL", name: "컵 안 확인", cause_id: goal.id, refs: { ...plan, request_id: "look" },
  started_ms: 200, state: "pending",
});
const toolDone: TraceRow = { ...looking, rev: 2, state: "done", ended_ms: 540, output: "빈 컵 확인" };
const firstPhoto = trace(35, {
  kind: "LLM", name: "VLM 근접 해석", input: "근접 프레임", output: "물건 관찰",
  cause_id: looking.id, refs: { request_id: "look" }, rev: 2, started_ms: 300, ended_ms: 330,
});
const secondPhoto: TraceRow = { ...firstPhoto, id: id(36), started_ms: 490, ended_ms: 510 };
const pick = trace(38, {
  kind: "EXECUTION", name: "집기 안내", output: "시연자 수행 대기", cause_id: goal.id,
  refs: { ...plan, step_id: "plan:pam-3:3" }, state: "pending", started_ms: 550,
});
const place = trace(45, {
  kind: "EXECUTION", name: "배치 안내", input: "컵 1 · 싱크대", output: "배치 확인", cause_id: goal.id,
  refs: { ...plan, step_id: "plan:pam-3:5" }, rev: 2, started_ms: 850, ended_ms: 990,
});
const finished = trace(51, {
  kind: "EXECUTION", name: "활동 종료", input: "컵 치우기 · 컵 1 · 싱크대", output: "활동 완료",
  cause_id: place.id, refs: plan, started_ms: 115, ended_ms: 1000,
});
const waiting = trace(17, {
  activity_id: watch, kind: "AGENT", name: "대기 판단", input: "집 상태 · 행동 목록",
  output: "지켜보기", rev: 2, started_ms: 160, ended_ms: 174,
});

const feed = () => within(screen.getByRole("log", { name: "Agent Trace" }));
/** 활동 머리 줄(펼치기 단추). */
const group = (text: RegExp) => feed().getByRole("button", { name: text });
/** 화면 위에서 아래 차례의 활동 id. */
const order = () => Array.from(document.querySelectorAll("[data-activity]"), el => el.getAttribute("data-activity"));
/** 펼친 활동 안의 단계 줄. */
const steps = () => Array.from(document.querySelectorAll<HTMLElement>("[data-slot=trace-step]"));
/** 단계 줄 자신의 글(안에 접어 넣은 모델 줄 글은 뺀다). */
const ownText = (row: HTMLElement) => {
  const copy = row.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[data-slot=trace-step]").forEach(nested => nested.remove());
  return copy.textContent ?? "";
};
const step = (text: RegExp) => {
  const found = steps().filter(row => text.test(ownText(row)));
  expect(found, `단계 줄 ${text}`).toHaveLength(1);
  return found[0]!;
};

describe("공개 Trace의 자동 활동 트리", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(10_000);
  });
  afterEach(() => vi.useRealTimers());

  it("같은 도구의 두 모델 호출을 한 단계 더 표시하고 새 단계에서 확인 결과만 남긴다", () => {
    const earlier = [goal, waiting, departure, chosen];
    const photos = [firstPhoto, secondPhoto, { ...firstPhoto, rev: 1, state: "pending" as const, ended_ms: null }];
    const { rerender } = render(<TraceTable rows={[...earlier, looking, ...photos]} />);
    expect(step(/컵 안 확인.*결과 대기 중/)).toHaveAttribute("data-current", "true");
    expect(step(/VLM 근접 해석.*30\sms/)).toHaveAttribute("data-depth", "1");
    expect(step(/VLM 근접 해석.*20\sms/)).toHaveAttribute("data-depth", "1");
    expect(feed().getAllByText("VLM 근접 해석", { exact: true })).toHaveLength(2);
    expect(group(/대기 판단.*지켜보기/)).toBeVisible();
    expect(group(/컵 치우기.*컵 안 확인 · 컵 1 · 식탁/)).toHaveAttribute("aria-expanded", "true");

    rerender(<TraceTable rows={[...earlier, ...photos, toolDone]} />);
    expect(step(/컵 안 확인.*빈 컵 확인.*340\sms/)).toBeVisible();
    expect(feed().getAllByText("VLM 근접 해석", { exact: true })).toHaveLength(2);
    rerender(<TraceTable rows={[...earlier, ...photos, toolDone, pick]} />);
    expect(feed().queryByText("VLM 근접 해석", { exact: true })).toBeNull();
    expect(step(/컵 안 확인.*빈 컵 확인.*340\sms/)).toBeVisible();
    expect(step(/집기 안내.*시연자 수행 대기/)).toHaveAttribute("data-current", "true");
    act(() => vi.advanceTimersByTime(15_000));
    expect(step(/집기 안내.*시연자 수행 대기/)).toBeVisible();
  });

  it("명시적 종료 후 2초에 접고 같은 종료와 옛 목표 갱신은 시간을 늘리지 않는다", () => {
    const running = [goal, waiting, departure, chosen, toolDone, { ...pick, output: "수행 확인", state: "done" as const, ended_ms: 700 }, place];
    const { rerender } = render(<TraceTable rows={running} />);
    act(() => vi.advanceTimersByTime(2400));
    expect(step(/배치 안내.*배치 확인/)).toBeVisible();
    expect(feed().queryByText(/활동 완료/)).toBeNull();

    rerender(<TraceTable rows={[...running, finished]} />);
    act(() => vi.advanceTimersByTime(1000));
    const released = { ...goal, rev: 2, retained: undefined };
    rerender(<TraceTable rows={[...running.slice(1), { ...finished, rev: 2 }, released]} />);
    act(() => vi.advanceTimersByTime(999));
    expect(group(/컵 치우기.*배치 확인.*활동 완료/)).toHaveAttribute("aria-expanded", "true");
    act(() => vi.advanceTimersByTime(1));
    expect(group(/컵 치우기.*배치 확인.*활동 완료/)).toHaveAttribute("aria-expanded", "false");
    rerender(<TraceTable rows={[...running, finished, { ...released, rev: 3 }]} />);
    expect(group(/컵 치우기.*배치 확인.*활동 완료/)).toHaveAttribute("aria-expanded", "false");
    expect(group(/대기 판단.*지켜보기/)).toBeVisible();
  });

  it("접힌 활동을 눌러 펼치면 단계 줄을 다시 보고, 다시 눌러 접는다", () => {
    render(<TraceTable rows={[goal, place, finished]} />);
    const done = group(/컵 치우기.*배치 확인.*활동 완료/);
    expect(done).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(done);
    expect(done).toHaveAttribute("aria-expanded", "true");
    expect(step(/배치 안내.*컵 1 · 싱크대 → 배치 확인/)).toBeVisible();
    fireEvent.click(done);
    expect(done).toHaveAttribute("aria-expanded", "false");
  });

  it("같은 이름의 다음 활동은 지난 종료와 별개로 표시하며 이전 집의 만료 시각을 지운다", () => {
    const { rerender, unmount } = render(<TraceTable rows={[]} />);
    expect(feed().getByText("아직 기록된 활동이 없어요.")).toBeVisible();
    rerender(<TraceTable rows={[goal, place, finished]} />);
    expect(group(/컵 치우기.*배치 확인.*활동 완료/)).toHaveAttribute("aria-expanded", "false");

    const newPick = { ...pick, id: id(54), activity_id: nextCup, refs: { plan_id: "other-plan", step_id: "other-plan:1" } };
    const newChoice = { ...chosen, id: id(53), activity_id: nextCup, refs: { decision_id: "different-attempt" } };
    const newFinish = { ...finished, id: id(55), activity_id: nextCup, cause_id: newPick.id, refs: { plan_id: "other-plan" } };
    rerender(<TraceTable rows={[goal, place, finished, newChoice, newPick]} />);
    expect(step(/집기 안내.*시연자 수행 대기/)).toBeVisible();
    expect(group(/컵 치우기.*배치 확인.*활동 완료/)).toBeVisible();
    rerender(<TraceTable rows={[goal, place, finished, newChoice, newPick, newFinish]} />);
    expect(vi.getTimerCount()).toBe(1);
    rerender(<TraceTable rows={[]} />);
    expect(vi.getTimerCount()).toBe(0);
    const otherHome = { ...newPick, id: "boot:home#2:1", activity_id: "boot:home#2:activity-1" };
    rerender(<TraceTable rows={[otherHome]} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(step(/집기 안내/)).toBeVisible();
    expect(feed().queryByText(/활동 완료/)).toBeNull();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("다른 활동의 안전 근거를 중단 사유에 표시하고 안전 줄은 지켜보기 활동에 남긴다", () => {
    const emergency = trace(37, { activity_id: safety, kind: "GUARDRAIL", name: "안전 상태", input: "안전 검사", output: "쓰러짐 의심" });
    const block = trace(39, {
      kind: "GUARDRAIL", name: "실행 보류", input: "실행 전 검사", output: "안전 조치 우선", cause_id: emergency.id,
    });
    const stop: TraceRow = { ...pick, state: "cancelled", rev: 2, cause_id: block.id, output: "중단", ended_ms: 600 };
    const cancelled: TraceRow = { ...finished, state: "cancelled", output: "활동 취소", cause_id: stop.id };
    const { rerender } = render(<TraceTable rows={[goal, waiting, emergency, pick]} />);
    rerender(<TraceTable rows={[goal, waiting, emergency, block, stop, cancelled]} />);
    expect(step(/실행 보류.*안전 조치 우선.*관련 안전 개입 · 쓰러짐 의심/)).toBeVisible();
    expect(group(/지켜보기.*안전 상태 · 쓰러짐 의심/)).toBeVisible();
    act(() => vi.advanceTimersByTime(2000));
    expect(group(/컵 치우기.*안전 조치 우선.*쓰러짐 의심.*활동 취소/)).toHaveAttribute("aria-expanded", "false");
    expect(group(/지켜보기.*안전 상태 · 쓰러짐 의심/)).toBeVisible();
    expect(group(/대기 판단.*지켜보기/)).toBeVisible();
  });

  it("부분 목록의 유실·순환 원인과 가전의 실패를 실제 행과 종료로 구분한다", () => {
    const appliance = trace(60, { activity_id: nextCup, kind: "AGENT", name: "행동 선택", output: "에어컨 끄기", cause_id: id(62) });
    const orphan = { ...firstPhoto, cause_id: id(999) };
    const malformed = trace(62, {
      activity_id: nextCup, kind: "TOOL", name: "가전 도구", output: "응답 시간 초과",
      cause_id: appliance.id, started_ms: 650, ended_ms: 850, state: "failed",
    });
    const failure = { ...finished, id: id(65), activity_id: nextCup, state: "failed" as const,
      input: "에어컨 끄기 · 거실", cause_id: malformed.id, output: "활동 실패" };
    const rows = [orphan, appliance, malformed];
    const { rerender } = render(<TraceTable rows={rows} />);
    expect(step(/VLM 근접 해석.*30\sms/)).toHaveAttribute("data-depth", "0");
    expect(step(/행동 선택.*에어컨 끄기/)).toBeVisible();
    expect(step(/가전 도구.*응답 시간 초과/)).toHaveAttribute("data-depth", "0");
    act(() => vi.advanceTimersByTime(2000));
    expect(step(/가전 도구.*응답 시간 초과.*Failed/)).toHaveAttribute("data-trace-status", "error");
    expect(feed().queryByText(/활동 실패/)).toBeNull();
    rerender(<TraceTable rows={[...rows, failure]} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(group(/에어컨 끄기.*응답 시간 초과.*활동 실패/)).toHaveAttribute("aria-expanded", "false");
    expect(group(/에어컨 끄기.*응답 시간 초과.*활동 실패/).closest("[data-activity]")).toHaveAttribute("data-trace-status", "error");
    expect(step(/VLM 근접 해석/)).toBeVisible();
  });

  it("활동은 옛것이 위·새것이 아래이고, 진행 중 활동을 맨 위로 올리지 않으며, 보존 해제로 차례가 바뀌지 않는다", () => {
    const first = trace(1, { activity_id: "boot:home#1:activity-1", kind: "AGENT", name: "대기 판단", output: "지켜보기" });
    const second = trace(2, { activity_id: "boot:home#1:activity-2", kind: "TOOL", name: "가전 도구", output: "가전 응답 대기", state: "pending", started_ms: 5 });
    const third = trace(3, { activity_id: "boot:home#1:activity-3", kind: "AGENT", name: "행동 선택", output: "에어컨 끄기" });
    const simple = render(<TraceTable rows={[third, second, first]} />);
    expect(order()).toEqual(["boot:home#1:activity-1", "boot:home#1:activity-2", "boot:home#1:activity-3"]);
    simple.unmount();

    const other = trace(60, { activity_id: nextCup, kind: "TOOL", name: "가전 도구", output: "가전 응답 대기", state: "pending", started_ms: 560 });
    const old = [goal, departure, chosen, waiting, pick, other];
    const { rerender } = render(<TraceTable rows={old} />);
    expect(order()).toEqual([cup, watch, nextCup]);
    const cupSteps = () => steps().filter(row => row.closest("[data-activity]")?.getAttribute("data-activity") === cup)
      .map(row => row.getAttribute("data-row"));
    expect(cupSteps()).toEqual([goal.id, departure.id, chosen.id, pick.id]);
    rerender(<TraceTable rows={[...old.slice(1), { ...goal, rev: 2, retained: undefined }]} />);
    expect(order()).toEqual([cup, watch, nextCup]);
    expect(cupSteps()).toEqual([goal.id, departure.id, chosen.id, pick.id]);
  });

  it("refs가 빈 장면 해석·사용자 상태 변화·안전 상태 줄은 접힌 「지켜보기」 활동 하나로 보인다", () => {
    const scene = trace(70, { activity_id: watch, kind: "LLM", name: "VLM 장면 해석", input: "카메라 프레임", output: "사람 관찰", started_ms: 10, ended_ms: 40 });
    const person = trace(71, { activity_id: watch, kind: "OBSERVATION", name: "사용자 상태 변화", input: "사용자 관찰", output: "사용자 관찰" });
    const clear = trace(72, { activity_id: watch, kind: "GUARDRAIL", name: "안전 상태", input: "안전 검사", output: "안전 알림 해제" });
    render(<TraceTable rows={[scene, person, clear]} />);
    expect(order()).toEqual([watch]);
    expect(group(/지켜보기.*안전 상태 · 안전 알림 해제/)).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(group(/지켜보기/));
    expect(steps().map(row => row.getAttribute("data-row"))).toEqual([scene.id, person.id, clear.id]);
  });

  it("요청 번호가 같아도 원인이 다른 모델과 다른 활동의 모델을 도구 아래에 넣지 않는다", () => {
    const wrongCause = { ...firstPhoto, cause_id: chosen.id };
    const wrongActivity = { ...secondPhoto, activity_id: nextCup };
    render(<TraceTable rows={[goal, chosen, looking, wrongCause, wrongActivity]} />);
    expect(step(/컵 안 확인/)).toBeVisible();
    expect(step(/VLM 근접 해석.*30\sms/)).toHaveAttribute("data-depth", "0");
    expect(step(/VLM 근접 해석.*20\sms/)).toHaveAttribute("data-depth", "0");
  });

  it("타이머가 남은 상태로 다른 집이 들어오거나 화면을 닫으면 만료 예약을 취소한다", () => {
    const current = [goal, place];
    const futureGoal = { ...goal, id: "boot:home#2:8", activity_id: "boot:home#2:activity-7" };
    const futureResult = { ...finished, id: "boot:home#2:51", activity_id: futureGoal.activity_id, cause_id: undefined };
    const { rerender, unmount } = render(<TraceTable rows={current} />);
    rerender(<TraceTable rows={[...current, finished]} />);
    expect(vi.getTimerCount()).toBe(1);
    rerender(<TraceTable rows={[futureGoal]} />);
    expect(vi.getTimerCount()).toBe(0);
    rerender(<TraceTable rows={[futureGoal, futureResult]} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Agent Trace 바닥 따라가기", () => {
  const CLIENT = 300;
  let height = 0;
  let observers: { callback: ResizeObserverCallback; targets: Element[]; live: boolean }[] = [];

  beforeEach(() => {
    height = 0;
    observers = [];
    // jsdom은 높이를 재지 않는다: 크기 바뀜 알림을 시험이 직접 보낸다.
    vi.stubGlobal("ResizeObserver", class {
      private readonly entry: (typeof observers)[number];
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, targets: [], live: true };
        observers.push(this.entry);
      }
      observe(target: Element) { this.entry.targets.push(target); }
      unobserve() {}
      disconnect() { this.entry.live = false; }
    });
    // 움직임 줄이기: 바닥으로 갈 때 프레임마다 다가가지 않고 바로 간다.
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const viewport = () => screen.getByRole("log", { name: "Agent Trace" });
  function layout(next: number) {
    height = next;
    const el = viewport();
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => height });
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => CLIENT });
    act(() => observers.filter(o => o.live && o.targets.includes(el))
      .forEach(o => o.callback([], o as unknown as ResizeObserver)));
  }
  const frame = () => act(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  const newActivity = (n: number) => trace(n, { activity_id: `boot:home#1:activity-${n}`, kind: "AGENT", name: "행동 선택", output: "에어컨 끄기" });

  it("바닥에 있을 때 새 활동이 오면 바닥으로 따라간다", async () => {
    const { rerender } = render(<TraceTable rows={[goal]} />);
    layout(1000);
    expect(viewport().scrollTop).toBe(1000 - CLIENT);
    await frame();
    rerender(<TraceTable rows={[goal, newActivity(90)]} />);
    await act(async () => {});
    layout(1400);
    expect(viewport().scrollTop).toBe(1400 - CLIENT);
  });

  it("위로 올린 뒤 새 활동이 오면 자리를 지키고 「1 new」 알약을 띄우며, 알약을 누르면 바닥으로 간다", async () => {
    const { rerender } = render(<TraceTable rows={[goal]} />);
    layout(1000);
    await frame();
    expect(screen.queryByRole("button", { name: /scroll to latest/i })).toBeNull();
    fireEvent.wheel(viewport(), { deltaY: -120 });
    viewport().scrollTop = 0;
    fireEvent.scroll(viewport());
    rerender(<TraceTable rows={[goal, newActivity(90)]} />);
    await act(async () => {});
    layout(1400);
    expect(viewport().scrollTop).toBe(0);
    const pill = screen.getByRole("button", { name: /1 new message, scroll to latest/ });
    expect(pill).toHaveTextContent("1 new");
    fireEvent.click(pill);
    expect(viewport().scrollTop).toBe(1400 - CLIENT);
  });
});
