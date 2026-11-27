// 「FSM 바뀜」 칸(FsmPane.tsx): 상태 원·짧은 이름, 실선·점선 화살표, 화살표 칩, 단계 칩. 어느 상태로든(*) 화살표는 자리에 없음 원으로 간다.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FsmPane } from "../../src/dashboard/FsmPane";
import type { FsmPaneState } from "../../src/dashboard/reflection";

const PANE: FsmPaneState = { step: "후보", states: ["drinking", "away"], edges: [
  { key: "cur:away>drinking", from: "away", to: "drinking", line: "solid", tone: "current", chips: [] },
  { key: "cur:drinking>*", from: "drinking", to: "*", line: "solid", tone: "current", chips: [] },
  { key: "cand:drinking>*:컵 치우기", from: "drinking", to: "*", line: "dashed", tone: "candidate", chips: ["컵 치우기?"] },
] };

describe("「FSM 바뀜」 칸", () => {
  it("상태 짧은 이름, 단계 칩, 후보 칩을 보이고 후보 화살표만 점선이다. 「다른 상태」 원은 없다", () => {
    const { container } = render(<FsmPane pane={PANE} />);
    for (const t of ["마시는 중", "자리에 없음", "후보", "컵 치우기?"]) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.queryByText("다른 상태")).toBeNull();
    expect(container.querySelectorAll('[data-line="dashed"] path[stroke-dasharray]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-line="solid"] path[stroke-dasharray]')).toHaveLength(0);
  });

  it("어느 상태로든 화살표는 자리에 없음 원으로 가고, 자리에 없음이 상태 목록에 없어도 원을 그린다", () => {
    const { container } = render(<FsmPane pane={{ ...PANE, states: ["drinking"], edges: PANE.edges.slice(1) }} />);
    expect(container.querySelector('[data-edge="cand:drinking>*:컵 치우기"]')).toHaveAttribute("data-to", "away");
    expect(container.querySelector('[data-state="away"]')).not.toBeNull();
    expect(screen.getByText("자리에 없음")).toBeTruthy();
  });
});
