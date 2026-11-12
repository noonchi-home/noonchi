import { describe, expect, it } from "vitest";
import type { PlannedCommand } from "../src/contract/phone.js";
import type { PlanView } from "../src/contract/plan.js";
import type { WorldView } from "../src/contract/world.js";
import { SAY_DONE_MS, SAY_LOOK_MS, sayLine } from "../src/act/say.js";
import { STEP_LABEL } from "../src/plan/labels.js";

const T = Date.parse("2026-11-09T00:00:00Z");
const plan = (status: PlanView["status"], goal = "컵 치우기", at = T): PlanView => ({
  id: "plan:d1", revision: 1, source: "brain", goal, judgment: "", dryRun: true, robot: { position: null, room: null }, path: [], legs: [], status, updatedAt: new Date(at).toISOString(),
  steps: [
    { id: "plan:d1:1", kind: "move", label: STEP_LABEL.goTable, status: "active" },
    { id: "plan:d1:2", kind: "act", label: STEP_LABEL.pickCup, status: "pending" },
    { id: "plan:d1:3", kind: "move", label: STEP_LABEL.goSink, status: "pending" },
    { id: "plan:d1:4", kind: "act", label: STEP_LABEL.placeCup, status: "pending" },
  ],
});
const cmd = (step: string, choices = [{ id: "done", label: "완료" }]): PlannedCommand => ({ type: "command", id: "plan:d1", step, text: "x", vision: null, choices, target: null, speak: true });
const world = (surface: string | null) => ({ objects: surface ? [{ id: "cup-1", cls: "cup", status: "seen", surface_label: surface, last_seen_ms: T }] : [] }) as unknown as WorldView;
const withCup = (p: PlanView): PlanView => ({ ...p, steps: p.steps.map((s, i) => (i === 1 ? { ...s, target: { objectId: "cup-1" } } : s)) });
const say = (o: Partial<Parameters<typeof sayLine>[0]>) => sayLine({ plan: null, command: null, world: null, nowMs: T, ...o });

describe("말풍선 카드 글", () => {
  it("계획이 없으면 지켜보거나 본 면을 말한다", () => {
    expect(say({})).toBe("지켜보고 있어요.");
    expect(say({ world: world("식탁") })).toBe("식탁을 보고 있어요.");
    expect(say({ world: world("싱크대") })).toBe("싱크대를 보고 있어요.");
  });
  it("정했고 명령 전이면 정한 것(대상 컵이 놓인 면을 알면 그 면)", () => {
    expect(say({ plan: plan("planned") })).toBe("컵을 치우기로 했어요.");
    expect(say({ plan: withCup(plan("planned")), world: world("식탁") })).toBe("식탁 컵을 치우기로 했어요.");
  });
  it("실제 폰에 낸 명령을 말한다", () => {
    expect(say({ plan: plan("running"), command: cmd("plan:d1:1") })).toBe("식탁으로 가라고 했어요.");
    expect(say({ plan: plan("running"), command: cmd("plan:d1:2") })).toBe("컵을 들라고 했어요.");
    expect(say({ plan: plan("running"), command: cmd("plan:d1:3") })).toBe("싱크대로 가라고 했어요.");
    expect(say({ plan: plan("running"), command: cmd("plan:d1:4") })).toBe("컵을 싱크대에 넣으라고 했어요.");
  });
  it("승인 질문 중에는 정한 것만 말한다", () => {
    expect(say({ plan: plan("planned"), command: cmd("plan:d1:approve", [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }]) })).toBe("컵을 치우기로 했어요.");
  });
  it("질문 명령이면 물어봤다고 한다", () => {
    expect(say({ plan: plan("running", "사용자에게 물어보기"), command: cmd("plan:d1:1", [{ id: "a", label: "네" }, { id: "b", label: "아니요" }]) })).toBe("폰으로 물어봤어요.");
  });
  it("끝난 뒤 20초는 끝낸 일, 그 뒤는 지켜보기", () => {
    expect(say({ plan: plan("done", "컵 치우기", T - 5000) })).toBe("컵을 다 치웠어요.");
    expect(say({ plan: plan("cancelled", "컵 치우기", T - 5000) })).toBe("컵 치우기를 그만뒀어요.");
    expect(say({ plan: plan("done", "컵 치우기", T - SAY_DONE_MS - 1) })).toBe("지켜보고 있어요.");
  });
  it("그대로 둔 지 20초 안이면 「컵을 그대로 두기로 했어요.」, 그 뒤에는 지켜보는 글. 열린 계획이나 그 뒤에 끝난 계획이 있으면 그 글이 먼저다", () => {
    const left = { atMs: T - 5000 };
    expect(say({ left })).toBe("컵을 그대로 두기로 했어요.");
    expect(say({ left, world: world("식탁") })).toBe("컵을 그대로 두기로 했어요.");
    expect(say({ left: { atMs: T - SAY_DONE_MS } })).toBe("컵을 그대로 두기로 했어요.");
    expect(say({ left: { atMs: T - SAY_DONE_MS - 1 } })).toBe("지켜보고 있어요.");
    expect(say({ left: { atMs: T - SAY_DONE_MS - 1 }, world: world("식탁") })).toBe("식탁을 보고 있어요.");
    expect(say({ left: null })).toBe("지켜보고 있어요.");
    expect(say({ left, plan: plan("running"), command: cmd("plan:d1:1") })).toBe("식탁으로 가라고 했어요.");
    // 앞서 끝난 계획보다 그대로 둔 것이 새것이면 그대로 둔 글, 그대로 둔 뒤에 끝난 계획이면 끝낸 일
    expect(say({ left, plan: plan("done", "컵 치우기", T - 8000) })).toBe("컵을 그대로 두기로 했어요.");
    expect(say({ left, plan: plan("done", "컵 치우기", T - 2000) })).toBe("컵을 다 치웠어요.");
    expect(say({ left, look: { place: "컵", atMs: T } })).toBe("컵을 가까이 보고 있어요.");
  });
  it("가까이 보는 중이면 6초 동안 계획이 있든 없든 「싱크대를 가까이 보고 있어요.」, 승인 질문 중에도 같다. 6초가 지나면 앞 글로 돌아간다", () => {
    const look = { place: "싱크대", atMs: T };
    expect(SAY_LOOK_MS).toBe(6000);
    expect(say({ look })).toBe("싱크대를 가까이 보고 있어요.");
    expect(say({ plan: plan("running"), command: cmd("plan:d1:4"), look, nowMs: T + SAY_LOOK_MS })).toBe("싱크대를 가까이 보고 있어요.");
    expect(say({ plan: plan("planned"), command: cmd("plan:d1:approve", [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }]), look })).toBe("싱크대를 가까이 보고 있어요.");
    expect(say({ look: { place: "컵", atMs: T } })).toBe("컵을 가까이 보고 있어요.");
    expect(say({ plan: plan("running"), command: cmd("plan:d1:4"), look, nowMs: T + SAY_LOOK_MS + 1 })).toBe("컵을 싱크대에 넣으라고 했어요.");
    expect(say({ world: world("식탁"), look, nowMs: T + SAY_LOOK_MS + 1 })).toBe("식탁을 보고 있어요.");
    expect(say({ look: null })).toBe("지켜보고 있어요.");
  });
});
