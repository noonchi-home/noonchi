import { describe, expect, it, vi } from "vitest";
import { TraceJournal } from "../src/record/index.js";

describe("home trace journal", () => {
  it("revises a pending row, links the actual decision to the goal and rejects late completion", () => {
    let now = 100;
    const publish = vi.fn();
    const trace = new TraceJournal("boot/home#1", () => now, publish);
    const goal = trace.event("goal", { goal_id: "g1" }, "goal_armed")!;
    const row = trace.start("pam", { decision_id: "pam-1" });
    expect(trace.snapshot().rows.map(r => r.activity_id)).toEqual([goal.activity_id, expect.not.stringMatching(goal.activity_id)]);
    now = 337;
    trace.finish(row, "done", "model_answer");
    trace.link({ decision_id: "pam-1" }, { goal_id: "g1" });
    trace.finish(row, "cancelled", "stopped");
    const saved = trace.snapshot().rows.find(r => r.id === row)!;
    expect(saved).toMatchObject({ activity_id: goal.activity_id, rev: 3, started_ms: 100, ended_ms: 337, state: "done" });
    expect(publish.mock.calls.flatMap(([m]) => m.rows).filter(r => r.id === row).map(r => r.state)).toEqual(["pending", "done", "done"]);
  });

  it("separates unrelated cups and discards callbacks after the home's journal closes", () => {
    const send = vi.fn();
    const trace = new TraceJournal("boot/home#2", () => 700, send);
    const first = trace.event("goal", { goal_id: "g1", object_id: "cup1" }, "goal_armed")!;
    const other = trace.event("goal", { goal_id: "g2", object_id: "cup2" }, "goal_armed")!;
    const guard = trace.event("safety", {}, "safety_fall")!;
    expect(new Set([first.activity_id, other.activity_id, guard.activity_id]).size).toBe(3);
    const row = trace.start("closer", { goal_id: "g1", request_id: "look-1" });
    trace.close();
    trace.finish(row, "done", "cup_empty");
    expect(trace.snapshot().rows.find(r => r.id === row)?.state).toBe("cancelled");
  });

  it("refs가 빈 장면 해석·사용자 상태 변화·안전 상태 줄은 한 지켜보기 활동에 모이고 서로를 원인으로 잇지 않는다", () => {
    const trace = new TraceJournal("h4", () => 5, () => {});
    const goal = trace.event("goal", { goal_id: "g1" }, "goal_armed")!;
    const scene = trace.start("vlm");
    trace.finish(scene, "done", "scene_people");
    const person = trace.event("person_changed", {}, "person_seen")!;
    const safety = trace.event("safety", {}, "safety_cleared")!;
    const later = trace.start("vlm");
    const closer = trace.start("closer_vlm", { request_id: "look-1" });
    const rows = new Map(trace.snapshot().rows.map(row => [row.id, row]));
    const watch = rows.get(scene)!.activity_id;
    expect([person.activity_id, safety.activity_id, rows.get(later)!.activity_id]).toEqual([watch, watch, watch]);
    expect(new Set([goal.activity_id, watch, rows.get(closer)!.activity_id]).size).toBe(3);
    expect([person, safety, rows.get(later)!].map(row => row.cause_id)).toEqual([undefined, undefined, undefined]);
  });

  it("replays an in-flight execution through 300 unrelated model calls and keeps its final revision", () => {
    let now = 1;
    const trace = new TraceJournal("h3", () => now, () => {});
    const waiting = trace.start("move", { plan_id: "p1", step_id: "s1" });
    for (let n = 0; n < 300; n++) {
      const id = trace.start("vlm");
      trace.finish(id, "done", "model_answer", ++now);
    }
    expect(trace.snapshot().rows).toHaveLength(240);
    expect(trace.snapshot().rows.find(row => row.id === waiting)).toMatchObject({ state: "pending", rev: 1 });
    const safety = trace.event("safety", {}, "safety_fall")!;
    trace.finish(waiting, "cancelled", "stopped", ++now, safety.id);
    trace.finish(waiting, "done", "move_done", ++now);
    expect(trace.snapshot().rows.at(-1)).toMatchObject({ id: waiting, cause_id: safety.id, state: "cancelled", started_ms: 1, ended_ms: 302, rev: 2 });
  });
});
