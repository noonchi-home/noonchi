import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TraceRow } from "../../../src/contract/trace.ts";
import { DashboardScreen, type ScreenProps } from "../../src/dashboard/DashboardScreen";
import { screenAt } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

const names = ["Vision", "Digital Twin", "Action Conditions", "Agent Trace"];
const panel = (name: string) => screen.getByRole("group", { name });
const conditions = () => within(panel("Action Conditions"));
const base = {
  activity_id: "home:a1", rev: 1, refs: {},
  started_ms: 100, ended_ms: 250, state: "done",
} as const satisfies Omit<TraceRow, "id" | "kind" | "name" | "input" | "output">;
const attempt = { boot: "boot", homeEpoch: "home", attemptId: "pam-3", gen: 1 };
const emptyCup: TraceRow = {
  ...base, id: "home:1", kind: "TOOL", name: "컵 안 확인", input: "컵 2 · 식탁", output: "빈 컵 확인",
  refs: { plan_id: "cup", object_id: "cup", attempt, evidence: { source: "photo", subjectId: "cup", originId: "frame", observedMs: 200 } },
};
const picking: TraceRow = {
  ...base, id: "home:2", kind: "EXECUTION", name: "집기 안내", input: "컵 2 · 식탁", output: "시연자 수행 대기",
  refs: { plan_id: "cup", step_id: "cup:2", object_id: "cup", attempt }, state: "pending", started_ms: 300, ended_ms: null,
};
const scene = (over: Partial<ScreenProps> = {}) => ({
  ...screenAt(2, { command: "컵을 들어 주세요.", trace: [], ...over }),
  view: "scene" as const,
});

function size(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width, height }));
}

function box(name: string) {
  const { left, top, width, height } = panel(name).style;
  return { x: parseFloat(left), y: parseFloat(top), w: parseFloat(width), h: parseFloat(height) };
}

describe("장면 중심 대시보드", () => {
  it("네 제목은 흰 글씨와 브랜드 빨강 토큰을 쓰고 영상마다 테두리는 한 겹이다", () => {
    size(1440, 900);
    render(<DashboardScreen {...scene()} />);
    for (const name of names) expect(panel(name).firstElementChild).toHaveAttribute("data-scene-legend");
    const css = (name: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src", `${name}.css`), "utf8");
    const styles = css("styles"), tokens = css("tokens");
    expect(styles).toMatch(/\[data-scene-legend\]\s*\{[^}]*background:\s*var\(--brand-portal\)[^}]*color:\s*var\(--on-brand\)/s);
    expect(styles).toMatch(/\[data-scene-panel\]\s*\{[^}]*border:\s*1px solid var\(--line\)/s);
    expect(tokens).toContain("--brand-portal: #a50034");
    expect(tokens).toContain("--on-brand: #ffffff");
  });

  it.each([[1280, 720], [1440, 900], [1920, 1080], [1024, 300]])(
    "%d×%d에서 위쪽 두 칸과 아래쪽 두 칸을 배치하고 다음 단계에서도 미디어를 유지한다",
    (width, height) => {
      size(width, height);
      const mounted = render(<DashboardScreen {...scene()} />);
      const phone = box("Vision"), twin = box("Digital Twin"), fact = box("Action Conditions"), trace = box("Agent Trace");
      expect([...document.querySelectorAll("fieldset > legend")].map(e => e.textContent)).toEqual(names);
      expect(phone.x + phone.w).toBeLessThan(twin.x);
      expect(phone.w / (phone.w + twin.w)).toBeCloseTo(0.62, 2);
      expect([phone.y, phone.h]).toEqual([twin.y, twin.h]);
      expect(fact.w / (fact.w + trace.w)).toBeCloseTo(0.30, 2);
      expect(fact.y).toBe(trace.y);
      expect(fact.y).toBeGreaterThan(twin.y + twin.h);
      expect(trace.x + trace.w).toBeLessThanOrEqual(width);
      expect(phone.h).toBeGreaterThan(0);
      const camera = screen.getByRole("region", { name: "폰 카메라" });
      mounted.rerender(<DashboardScreen {...scene(screenAt(3))} />);
      expect(screen.getByRole("region", { name: "폰 카메라" })).toBe(camera);
      expect(box("Vision")).toEqual(phone);
      expect(box("Digital Twin")).toEqual(twin);
    },
  );

  it.each([[1280, 720, 960, 720], [1440, 900, 1280, 720], [1920, 1080, 720, 1280]])(
    "%d×%d에서 %d×%d 영상과 트윈의 위·아래 선이 같고 영상 위아래에 빈 띠가 없다",
    (width, height, fw, fh) => {
      size(width, height);
      render(<DashboardScreen {...scene({ phone: { kind: "image", src: "/sample.png", width: fw, height: fh } })} />);
      const camera = box("Vision"), twin = box("Digital Twin");
      expect([camera.y, camera.h]).toEqual([twin.y, twin.h]);
      expect(camera.h).toBeLessThanOrEqual(camera.w * fh / fw + 0.5);
    },
  );

  it("390px에서 네 칸을 세로로 읽고 폰 명령·QR과 설정을 쓸 수 있다", () => {
    size(390, 340);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.tagName === "MAIN" ? 373 : 0;
    });
    const url = "https://hub.example.ts.net/mobile/";
    const mounted = render(<DashboardScreen {...scene({ phone: { kind: "qr", url } })} />);
    const rectangles = names.map(box);
    for (const [index, rect] of rectangles.entries()) {
      expect(rect.x + rect.w).toBeLessThanOrEqual(373);
      if (index > 0) expect(rect.y).toBeGreaterThan(rectangles[index - 1]!.y + rectangles[index - 1]!.h);
    }
    expect(document.querySelector("main")).toHaveClass("overflow-y-auto");
    expect(within(panel("Vision")).getByRole("img", { name: "폰 연결 QR" })).toBeVisible();
    expect(within(panel("Vision")).getByText(url)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    mounted.rerender(<DashboardScreen {...scene()} />);
    expect(screen.getByText("컵을 들어 주세요.").closest("[data-video]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "연결" })).toBeNull();
  });

  it("폰 연결을 모르는 첫 화면에는 QR과 폰 명령을 만들지 않는다", () => {
    size(390, 340);
    render(<DashboardScreen {...scene({ phone: { kind: "none" }, connected: null, command: null, plan: null, step: null })} />);
    const vision = within(panel("Vision"));
    expect(vision.queryByRole("img", { name: "폰 연결 QR" })).toBeNull();
    expect(vision.queryByText("컵을 들어 주세요.")).toBeNull();
    expect(conditions().queryByText("컵 안이 비었어요")).toBeNull();
  });

  it("같은 컵의 실제 사진 결과, 집기 대기와 다음 계획 단계를 표시한다", () => {
    size(1440, 900);
    render(<DashboardScreen {...scene({ trace: [emptyCup, picking] })} />);
    const action = conditions();
    for (const text of ["확인한 사실", "확인 중", "확인 후", "컵 안이 비었어요", "컵을 든 모습", "싱크대로 가기"]) {
      expect(action.getByText(text, { exact: true })).toBeVisible();
    }
    expect(document.body).not.toHaveTextContent(/컵 안 확인 중|작업 종료 후|식탁 컵을 치우기로 했어요/);
  });

  it("다른 작업·다른 컵·다른 활동·증거 없는 결과와 종료·연결 끊김의 오래된 사실을 숨긴다", () => {
    size(1440, 900);
    const old = [
      { ...emptyCup, id: "old-plan", refs: { ...emptyCup.refs, plan_id: "old" } },
      { ...emptyCup, id: "other-cup", refs: { ...emptyCup.refs, object_id: "other" } },
      { ...emptyCup, id: "other-activity", activity_id: "home:old" },
      { ...emptyCup, id: "old-attempt", refs: { ...emptyCup.refs, attempt: { ...attempt, gen: 0 } } },
      { ...emptyCup, id: "no-proof", refs: { ...emptyCup.refs, evidence: undefined } },
      { ...emptyCup, id: "proof-other-cup", refs: { ...emptyCup.refs, evidence: { ...emptyCup.refs.evidence!, subjectId: "other" } } },
    ];
    const mounted = render(<DashboardScreen {...scene({ trace: [...old, picking] })} />);
    expect(conditions().queryByText("컵 안이 비었어요")).toBeNull();
    const active = scene({ trace: [emptyCup, picking] });
    mounted.rerender(<DashboardScreen {...active} />);
    expect(conditions().getByText("컵 안이 비었어요")).toBeVisible();
    mounted.rerender(<DashboardScreen {...active} connected={false} />);
    expect(conditions().queryByText(/컵 안이 비었어요|컵을 든 모습|싱크대로 가기/)).toBeNull();
    for (const status of ["done", "cancelled", "failed"] as const) {
      mounted.rerender(<DashboardScreen {...active} plan={{ ...active.plan!, status }} />);
      expect(conditions().queryByText(/컵 안이 비었어요|컵을 든 모습|싱크대로 가기/)).toBeNull();
    }
    mounted.rerender(<DashboardScreen {...scene({ plan: null, step: null, trace: [] })} />);
    expect(conditions().queryByText("컵 안이 비었어요")).toBeNull();
  });

  it("나중 조회의 결과 미확인과 확인된 종료가 이전 빈 컵과 대기 문구를 지운다", () => {
    size(1440, 900);
    const missed = { ...emptyCup, id: "home:3", output: "확인하지 못함", started_ms: 301, ended_ms: 400,
      refs: { ...emptyCup.refs, evidence: undefined } };
    const mounted = render(<DashboardScreen {...scene({ trace: [emptyCup, picking, missed] })} />);
    expect(conditions().queryByText("컵 안이 비었어요")).toBeNull();
    const finished: TraceRow = { ...picking, id: "home:4", name: "활동 종료", output: "활동 취소", state: "cancelled", ended_ms: 480,
      refs: { plan_id: picking.refs.plan_id } };
    mounted.rerender(<DashboardScreen {...scene({ trace: [emptyCup, picking, finished] })} />);
    expect(conditions().queryByText(/컵 안이 비었어요|컵을 든 모습|싱크대로 가기/)).toBeNull();
  });

  it("현재 수행 단계의 사진 도구가 대기 중이면 관찰 결과를 먼저 만들지 않는다", () => {
    size(1440, 900);
    const watching: TraceRow = { ...emptyCup, state: "pending", output: "결과 대기 중", ended_ms: null,
      refs: { ...emptyCup.refs, evidence: undefined } };
    render(<DashboardScreen {...scene({ trace: [watching, { ...picking, name: "수행 안내" }] })} />);
    expect(conditions().getByText("컵 안 확인", { exact: true })).toBeVisible();
    expect(conditions().queryByText(/컵 안이 비었어요|컵을 든 모습/)).toBeNull();
  });

  it("가전 계획은 실제 가전 단계만 쓰고 끝 단계에 다음 동작을 만들지 않는다", () => {
    size(1440, 900);
    const plan = {
      ...scene().plan!, id: "lamp", goal: "조명 설정", judgment: "공개하지 않을 판단 원문",
      steps: [{ id: "lamp:1", kind: "device", label: "거실등 켜기", target: { deviceId: "light" }, status: "active" }],
    } as const;
    const props = scene({ plan: { ...plan, steps: [...plan.steps] }, step: plan.steps[0], trace: [emptyCup, picking] });
    const mounted = render(<DashboardScreen {...props} />);
    expect(conditions().getByText("거실등 켜기", { exact: true })).toBeVisible();
    expect(conditions().queryByText(/컵 안이 비었어요|싱크대로 가기|공개하지 않을 판단 원문/)).toBeNull();
    const reply: TraceRow = { ...base, id: "home:device", kind: "TOOL", name: "가전 도구", input: "거실등", output: "가전 응답 확인",
      refs: { plan_id: plan.id, step_id: plan.steps[0].id, object_id: "light" } };
    mounted.rerender(<DashboardScreen {...props} trace={[reply]} />);
    expect(conditions().getByText("가전 응답 확인")).toBeVisible();
    expect(conditions().queryByText("거실등 켜기")).toBeNull();
  });

  it("Trace 보존 해제 뒤에도 같은 활동의 실행과 준비 차례를 유지한다", () => {
    size(1440, 900);
    const prepared: TraceRow = { ...base, id: "home:1", kind: "AGENT", name: "목표 준비", input: "컵 치우기", output: "준비 시작", retained: true };
    const placed: TraceRow = { ...base, id: "home:2", kind: "EXECUTION", name: "배치 안내", input: "컵 · 싱크대", output: "배치 확인" };
    const mounted = render(<DashboardScreen {...scene({ trace: [prepared, placed] })} />);
    const output = () => Array.from(panel("Agent Trace").querySelectorAll("[data-slot=trace-step]"), row => row.textContent);
    const before = output();
    expect(before).toHaveLength(2);
    expect(before[0]).toContain("준비 시작");
    expect(before[1]).toContain("배치 확인");
    mounted.rerender(<DashboardScreen {...scene({ trace: [{ ...prepared, rev: 2, retained: undefined }, placed] })} />);
    expect(output()).toEqual(before);
  });

  it("겹치는 활동과 관련 안전 근거를 함께 갱신하고 알약과 활동 펼치기 단추만 둔다", () => {
    size(390, 740);
    const pendingAc: TraceRow = { ...base, id: "home:3", activity_id: "home:a2", kind: "AGENT", name: "행동 선택", input: "에어컨", output: "에어컨 켜기", state: "pending", ended_ms: null };
    const safety: TraceRow = { ...base, id: "home:4", activity_id: "home:a3", kind: "GUARDRAIL", name: "안전 상태", input: "안전 검사", output: "쓰러짐 의심" };
    const guard: TraceRow = { ...base, id: "home:5", cause_id: "home:4", kind: "GUARDRAIL", name: "실행 보류", input: "실행 전 검사", output: "안전 조치 우선" };
    const mounted = render(<DashboardScreen {...scene({ trace: [picking, pendingAc, safety, guard] })} />);
    const trace = within(panel("Agent Trace"));
    expect(trace.getAllByText(/에어컨 켜기/).length).toBeGreaterThan(0);
    expect(trace.getAllByText(/쓰러짐 의심/).length).toBeGreaterThan(0);
    const steps = Array.from(panel("Agent Trace").querySelectorAll<HTMLElement>("[data-slot=trace-step]"));
    expect(steps.find(row => /실행 보류.*안전 조치 우선.*쓰러짐 의심/.test(row.textContent ?? ""))).toBeVisible();
    const buttons = trace.getAllByRole("button", { hidden: true });
    expect(buttons.filter(button => button.getAttribute("data-slot") === "scroll-to-bottom")).toHaveLength(1);
    expect(buttons.filter(button => button.getAttribute("data-slot") !== "scroll-to-bottom")
      .every(button => button.hasAttribute("aria-expanded"))).toBe(true);
    mounted.rerender(<DashboardScreen {...scene({ trace: [{ ...picking, rev: 2, state: "done", ended_ms: 450, output: "수행 확인" }, pendingAc, safety, guard] })} />);
    expect(trace.getAllByText(/수행 확인/).length).toBeGreaterThan(0);
    expect(trace.queryByText(/시연자 수행 대기/)).toBeNull();
  });
});
