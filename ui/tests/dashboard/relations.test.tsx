import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PendingGoal } from "../../../src/contract/goal";
import type { WorldObject, WorldView } from "../../../src/contract/world";
import { EMPTY_DASH, type DashData } from "../../src/dashboard/data";
import { planAt } from "./fixtures";
import { relationsOf } from "../../src/dashboard/relations";
import { RelationGraph } from "../../src/dashboard/RelationGraph";

const now = 61_000;
const plan = { ...planAt(3), id: "plan:pam-4" };
const goal: PendingGoal = {
  id: "goal-1", object: "cup_2", cls: "cup", action: "컵 치우기", state: "away", trigger: "개인 발화",
  status: "armed", prep: "ready", reason: null, text: null, armed_ms: 40_000,
  ready_ms: 41_000, gone_ms: null, fired_ms: null, plan: { ...plan, id: "plan:goal-1" },
};
const decision: NonNullable<DashData["decision"]> = {
  type: "decision", at_ms: now - 500, id: "pam-4", seq: 4, status: "valid", text_sent: "사용자 개인 발화",
  action: "컵 치우기", prediction: null, memory_version: 1,
  world: { objects: [], person_visible: true, vlm_missing: 0, yolo_missing: 0 },
};
const cup: WorldObject = {
  id: "cup_2", cls: "cup", position: [1, 0.8, 3], surface: "table", surface_label: "식탁",
  room: "kitchen", error_m: null, status: "present", first_seen_ms: 40_000, last_seen_ms: now,
  last_in_view_ms: now, facts: {}, answered_ms: now, devices: [], closer_hold: false, followed_by: null,
};
const world: WorldView = {
  at_ms: now, objects: [cup], fixtures: [], devices: [], eye: null, frame_ms: now,
  person: { visible: true, since_ms: now, last_seen_ms: now, count: 1, position: null, position_ms: null,
    room: null, room_label: null, near: [], holding: [], facts: {}, answered_ms: null },
  vlm_missing: 0, yolo_missing: 0,
};
const names = new Map([["sink", "싱크대"]]);

describe("판단 관계", () => {
  it("같은 판단의 관찰과 열린 계획의 현재 단계·목적지를 잇는다", () => {
    const graph = relationsOf({ ...EMPTY_DASH, plan, decision }, world, now, names);
    expect(graph.nodes.map(n => n.label)).toEqual(expect.arrayContaining(["컵 치우기", "사람 보임", "싱크대"]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      { from: "observation", to: "focus" }, { from: "focus", to: "step" }, { from: "step", to: "destination" },
    ]));
    expect(graph.anchors).toContainEqual({ id: "destination", label: "싱크대", target: plan.steps[2]!.target });
  });

  it("같은 행동 이름이라도 다른 판단과 다른 목표의 대상은 현재 계획에 붙이지 않는다", () => {
    const graph = relationsOf({ ...EMPTY_DASH, plan, goal, decision: { ...decision, id: "pam-3" } }, world, now, names);
    expect(graph.nodes.map(n => n.id)).toEqual(["focus", "step", "destination"]);
    expect(graph.anchors.map(a => a.id)).toEqual(["destination"]);
  });

  it("서 있는 목표의 컵만 표시하고 사라졌거나 오래된 관찰로 현재 위치를 그리지 않는다", () => {
    const data = { ...EMPTY_DASH, goal };
    const seen = relationsOf(data, world, now);
    expect(seen.nodes.map(n => n.label)).toEqual(expect.arrayContaining(["컵", "식탁"]));
    expect(seen.anchors.some(a => a.target.objectId === "cup_2")).toBe(true);
    for (const objects of [[{ ...cup, status: "gone" as const }], [{ ...cup, last_seen_ms: 100 }], [{ ...cup, id: "cup_3" }]]) {
      const g = relationsOf(data, { ...world, objects }, now);
      expect(g.anchors).toEqual([]);
      expect(g.nodes.map(n => n.label)).not.toContain("식탁");
    }
  });

  it("열린 계획의 집기 대상과 현재 목적지가 다르면 지정된 컵의 관찰만 이어 준다", () => {
    const steps = plan.steps.map(s => s.id === "cup:2" ? { ...s, target: { objectId: "cup_2" } } : s);
    const other = { ...cup, id: "cup_7", surface_label: "책상" };
    const graph = relationsOf({ ...EMPTY_DASH, plan: { ...plan, steps } }, { ...world, objects: [other, cup] }, now, names);
    expect(graph.nodes.map(n => n.label)).toEqual(expect.arrayContaining(["컵", "식탁", "싱크대"]));
    expect(graph.nodes.map(n => n.label)).not.toContain("책상");
    expect(graph.edges).toContainEqual({ from: "observation", to: "target" });
    expect(graph.anchors.map(a => a.target.objectId)).toEqual(["cup_2", "sink"]);
  });

  it("움직이는 물건은 현재 관찰 없이 계획의 옛 좌표에 표시하지 않고 고정 설비는 표시한다", () => {
    const graphAt = (id: string, view: WorldView | null) => {
      const steps = [{ ...plan.steps[1]!, target: { objectId: id, position: [9, 8] as [number, number] }, status: "active" as const }];
      return relationsOf({ ...EMPTY_DASH, plan: { ...plan, steps } }, view, now);
    };
    for (const id of ["cup_2", "cell_phone_12"]) {
      expect(graphAt(id, null).anchors).toEqual([]);
      expect(graphAt(id, { ...world, objects: [] }).anchors).toEqual([]);
    }
    expect(graphAt("cup_2", { ...world, objects: [{ ...cup, status: "gone" }] }).anchors).toEqual([]);
    expect(graphAt("cup_2", { ...world, objects: [{ ...cup, last_seen_ms: 100 }] }).anchors).toEqual([]);
    expect(graphAt("cup_2", world).anchors.find(a => a.id === "destination")?.target.position).toEqual([1, 3]);
    expect(graphAt("sink_12", null).anchors[0]?.target.position).toEqual([9, 8]);
  });

  it("오래된 판단·메시지와 원문은 읽기용 그래프에 남지 않는다", () => {
    const privateData = { ...EMPTY_DASH, talk: [{ id: "1", text: "사용자 개인 발화" }] };
    const graph = relationsOf({ ...privateData, decision }, world, now + 120_000);
    expect(graph.nodes).toEqual([]);
    const { rerender } = render(<RelationGraph graph={graph} />);
    expect(screen.getByText("기다리는 중")).toBeTruthy();
    rerender(<RelationGraph graph={relationsOf({ ...privateData, plan: { ...plan, judgment: "가공 안 한 추론" }, decision }, world, now, names)} />);
    expect(screen.getByRole("img", { name: /컵 치우기/ })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/개인 발화|가공 안 한 추론/);
    expect(document.querySelector("button,input,textarea")).toBeNull();
  });
});
