import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { EMPTY_DASH, reduceDash, type DashboardMessage, type DashboardRobotMessage } from "../../src/dashboard/data";
import { currentStatusRowsOf } from "../../src/dashboard/timeline";
import type { ServerMessage } from "../../../src/contract/events";
import { planAt } from "./fixtures";
import { MOMENTS } from "../../src/dashboard/debug";

const feed = (...messages: DashboardMessage[]) => messages.reduce((dash, m) => reduceDash(dash, m, 0), EMPTY_DASH);
const robot = (state: DashboardRobotMessage["state"], at: number): DashboardRobotMessage => ({ type: "robot", state, since_ms: at, step: null });
const person = (name: string, at: number): ServerMessage => ({ type: "person", state: name, name, source: "world", since_ms: at, decision_id: null });

it("한쪽 상태만 도착해도 해당 행을 채우고 같은 상태의 반복은 전이로 세지 않는다", () => {
  expect(currentStatusRowsOf(feed(robot("idle", 10), robot("move", 20), robot("move", 30)))).toEqual([
    { id: "person", previous: null, current: null, since: null },
    { id: "robot", previous: "지켜봄", current: "이동 중", since: 20 },
  ]);
  expect(currentStatusRowsOf(feed(person("읽는 중", 100)))).toEqual([
    { id: "person", previous: null, current: "읽는 중", since: 100 },
    { id: "robot", previous: null, current: null, since: null },
  ]);
});

it("계획 스냅숏은 마지막 실행 단계와 바로 전 단계를 선별하고 아직 시작하지 않은 단계를 빼 준다", () => {
  const plan = planAt(2);
  const [first, second, ...next] = plan.steps;
  const recorded = { ...plan, steps: [
    { ...first!, status: "done" as const, started_ms: 100, ended_ms: 200 },
    { ...second!, status: "active" as const, started_ms: 200 }, ...next,
  ] };
  expect(currentStatusRowsOf(feed({ type: "plan", plan: recorded }))[1]).toEqual({
    id: "robot", previous: first!.label, current: second!.label, since: 200,
  });
  expect(currentStatusRowsOf(feed({ type: "plan", plan }))[1]).toEqual({
    id: "robot", previous: first!.label, current: second!.label, since: null,
  });
  const partial = { ...plan, steps: [first!, { ...second!, started_ms: 200 }, ...next] };
  expect(currentStatusRowsOf(feed({ type: "plan", plan: partial }))[1]).toEqual({
    id: "robot", previous: first!.label, current: second!.label, since: 200,
  });
});

it("저장된 2단계와 과거 계획 재전송 뒤에도 공개 사용자·로봇 전이를 각각 유지한다", () => {
  const sample = MOMENTS[2]!.messages;
  const plan = sample.find(m => m.type === "plan")!;
  expect(currentStatusRowsOf(feed(...sample))).toMatchObject([
    { previous: "먹거나 마시는 중", current: "자리에 없음" },
    { previous: "식탁으로 가기", current: "컵 집기" },
  ]);
  const step = { plan_id: plan.plan!.id, number: 2, label: "컵 집기" };
  const running = { ...robot("run", 200), step };
  const blocked = { ...robot("recover", 300), step };
  const events = [person("읽는 중", 100), running, person("공부 중", 220), blocked];
  const expected = [
    { id: "person", previous: "읽는 중", current: "공부 중", since: 220 },
    { id: "robot", previous: "컵 집기", current: "다시 확인하는 중", since: 300 },
  ];
  expect(currentStatusRowsOf(feed(...events, running, blocked, person("읽는 중", 100), plan, plan))).toEqual(expected);
  expect(currentStatusRowsOf(feed(...events, person("쉬는 중", 400)))[1]).toEqual(expected[1]);
  expect(currentStatusRowsOf(feed(...events, robot("idle", 450)))[0]).toEqual(expected[0]);
});

it("서로 다른 계획이 역순으로 오면 진행 단계가 있는 최신 계획을 표시한다", () => {
  const newer = { ...planAt(2), id: "new", updatedAt: "2026-11-22T10:00:15Z" };
  const older = { ...planAt(1), id: "old", updatedAt: "2026-11-22T10:00:10Z" };
  const oldMessage = { type: "plan", plan: older } as const;
  const newMessage = { type: "plan", plan: newer } as const;
  for (const order of [[oldMessage, newMessage], [newMessage, oldMessage, oldMessage]]) {
    expect(currentStatusRowsOf(feed(...order))[1]).toEqual({
      id: "robot", previous: newer.steps[0]!.label, current: newer.steps[1]!.label, since: null,
    });
  }
});

it("같은 밀리초에 바뀐 상태는 받은 차례로 표시하고 앞선 전이의 재전송은 건너뛴다", () => {
  const reading = person("읽는 중", 50);
  const moving = robot("move", 50);
  const rows = currentStatusRowsOf(feed(reading, moving, person("공부 중", 50), robot("recover", 50), reading, moving));
  expect(rows).toEqual([
    { id: "person", previous: "읽는 중", current: "공부 중", since: 50 },
    { id: "robot", previous: "이동 중", current: "다시 확인하는 중", since: 50 },
  ]);
});

it("계획 없음 스냅숏을 받으면 이력의 열린 단계를 현재 칸에서 내린다", () => {
  const plan = planAt(1);
  const steps = plan.steps.map((s, i) => i === 0 ? { ...s, started_ms: 100 } : s);
  const rows = currentStatusRowsOf(feed({ type: "plan", plan: { ...plan, steps } }, { type: "plan", plan: null }));
  expect(rows[1]).toEqual({ id: "robot", previous: steps[0]!.label, current: "지켜봄", since: null });
});

it("옛 계획의 실행 기록만 있어도 새 예정 계획이나 종료된 계획에서는 지켜봄으로 돌아간다", () => {
  const older = planAt(1);
  const oldMessage = { type: "plan", plan: {
    ...older, steps: older.steps.map((s, i) => i === 0 ? { ...s, started_ms: 100 } : s),
  } } as const;
  const next = { ...planAt(2), id: "next", updatedAt: "2026-11-22T10:00:15Z" };
  const planned = { ...next, status: "planned" as const, steps: next.steps.map(s => ({ ...s, status: "pending" as const })) };
  const closed = { ...next, status: "done" as const, steps: next.steps.map(s => ({ ...s, status: "done" as const })) };
  for (const messages of [[oldMessage, { type: "plan", plan: planned }], [{ type: "plan", plan: planned }, oldMessage]] satisfies ServerMessage[][]) {
    expect(currentStatusRowsOf(feed(...messages))[1]).toEqual({ id: "robot", previous: older.steps[0]!.label, current: "지켜봄", since: null });
  }
  expect(currentStatusRowsOf(feed({ type: "plan", plan: closed }))[1]).toEqual({
    id: "robot", previous: closed.steps.at(-1)!.label, current: "지켜봄", since: null,
  });
});

it("좁은 표에서도 두 행의 현재 상태와 바뀐 시각을 읽고 이전 상태를 반복하지 않는다", async () => {
  const { StatusTable } = await import("../../src/dashboard/StatusTable");
  const box = { left: 0, top: 0, width: 275, height: 128 };
  const at = Date.UTC(2026, 10, 22, 1, 2, 3);
  const first = person("읽는 중", at);
  const view = render(<StatusTable box={box} tzMinutes={540} rows={currentStatusRowsOf(feed(first))} />);
  const table = screen.getByRole("table", { name: /상태/ });
  expect(within(table).getAllByRole("columnheader").map(c => c.textContent)).toEqual(["대상", "지금 상태", "바뀐 시각"]);
  const user = within(table).getByRole("row", { name: /사용자/ });
  expect(user).toHaveAttribute("aria-live", "polite");
  expect(within(user).getByText("10:02:03")).toHaveAttribute("datetime", new Date(at).toISOString());
  expect(within(table).getByRole("row", { name: /클로이드/ })).toHaveTextContent("—");
  view.rerender(<StatusTable box={box} tzMinutes={540} rows={currentStatusRowsOf(feed(first, person("주방 식탁에 앉아 저녁 식사를 준비하는 중", at + 4000), robot("return_room", at + 5000)))} />);
  expect(user).toHaveTextContent("주방 식탁에 앉아 저녁 식사를 준비하는 중");
  expect(user).not.toHaveTextContent("읽는 중");
  expect(within(user).getByText("10:02:07")).toBeVisible();
  expect(within(table).getByRole("row", { name: /클로이드/ })).toHaveTextContent("대기 자리로 가는 중");
});
