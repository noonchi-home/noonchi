import { expect, it } from "vitest";
import { BusNode, MemoryBus, VirtualClock, TOPICS } from "../src/bus/index.js";
import { HistoryDb } from "../src/brain/index.js";
import { goalRoutes } from "../src/goal/node.js";
import { managerRoutes } from "../src/manage/node.js";
import { Bag, replay, startRecorder, settle } from "../src/record/index.js";

it("관리자와 목표의 상태는 각 노드만 내고 폰 명령은 로봇만 낸다", () => {
  expect(TOPICS["/brain/person"].from).toEqual(["brain"]);
  expect(TOPICS["/brain/person_changes"].from).toEqual(["brain"]);
  expect(TOPICS["/brain/nudge"].from).toEqual(["goal"]);
  expect(TOPICS["/goal/state"].from).toEqual(["goal"]);
  expect(TOPICS["/manager/order"].from).toEqual(["manager"]);
  expect(TOPICS["/manager/state"].from).toEqual(["manager"]);
  expect(TOPICS["/act/phone_command"].from).toEqual(["act"]);
});

it("같은 입력을 다시 흘리면 목표·관리자의 전이와 마지막 상태가 같다", async () => {
  const epoch = { boot: "b", home: "h" };
  const bag = Bag.open(":memory:");
  const work = { at_ms: 1, goal: null, plan: null, active: false, requested: false, emergency: false,
    handling: null, activeAction: null, docking: false, mode: "noonchi" as const, tasks: ["컵 치우기"] };
  const g = { id: "g", action: "컵 치우기", status: "armed" as const,
    prep: "waiting" as const, reason: null, gone_ms: null };
  const bus = new MemoryBus(), clock = new VirtualClock(1);
  const db = HistoryDb.open(":memory:");
  const nodes = (["act", "goal", "manager"] as const).map((name) => new BusNode({ name, bus, epoch, clock }));
  const [act, goal, manager] = nodes;
  goalRoutes(goal, clock);
  managerRoutes(manager, clock);
  const rec = await startRecorder({ bus, epoch, db, bag, clock });
  try {
    for (const n of nodes) await n.prepare();
    for (const n of [...nodes, rec]) n.start();
    for (const [i, w] of [work, { ...work, goal: g }, { ...work, goal: g, emergency: true }].entries()) {
      await clock.advanceTo(i + 1, async () => {});
      await act.publish("/act/work", { ...w, at_ms: i + 1 });
      await settle(bus, [...nodes, rec]);
    }
  } finally {
    for (const n of [...nodes, rec]) await n.stop();
    await bus.close();
    db.close();
  }
  const run = async () => {
    const rows: string[] = [], state: Record<string, string> = {};
    await replay({ bag, from: 0, to: 4, topics: ["/act/work"], launch: async (bus, clock) => {
      const goal = new BusNode({ name: "goal", epoch, bus, clock });
      const manager = new BusNode({ name: "manager", epoch, bus, clock });
      goalRoutes(goal, clock);
      managerRoutes(manager, clock);
      const record = new BusNode({ name: "recorder", epoch, bus, clock });
      record.on("/goal/state", (m) => { state.goal = m.state; });
      record.on("/manager/state", (m) => { state.manager = m.owner; });
      record.on("/goal/changes", (g) => { rows.push("goal:" + g.state); });
      record.on("/manager/changes", (m) => { rows.push("manager:" + m.owner); });
      return [record, goal, manager];
    } });
    return { rows, state };
  };
  try {
    const result = await run();
    expect(result.rows.filter((s) => s.startsWith("goal:"))).toEqual(["goal:idle", "goal:armed"]);
    expect(result.rows.filter((s) => s.startsWith("manager:"))).toEqual(["manager:idle", "manager:goal", "manager:safety"]);
    expect(result.state).toEqual({ goal: "armed", manager: "safety" });
    const live = bag.range(0, 4).flatMap(({ e }) =>
      e.topic === "/goal/changes" && "state" in e.body ? ["goal:" + e.body.state]
        : e.topic === "/manager/changes" && "owner" in e.body ? ["manager:" + e.body.owner] : []);
    for (const prefix of ["goal:", "manager:"]) {
      expect(result.rows.filter((x) => x.startsWith(prefix))).toEqual(live.filter((x) => x.startsWith(prefix)));
    }
  } finally { bag.close(); }
});


it("판단 메시지는 집별 기록에 한 번 남기고 연결 변화는 빠짐없이 기록한다", async () => {
  const epoch = { boot: "b", home: "h#1" };
  const db = HistoryDb.open(":memory:"), bus = new MemoryBus();
  const rec = await startRecorder({ bus, epoch, db });
  const brain = new BusNode({ name: "brain", bus, epoch });
  try {
    await brain.prepare(); brain.start(); rec.start();
    await brain.publish("/brain/thought", { type: "thought", home: "h", messages: [{ id: "m", decision: "d", at_ms: 1, text: "컵을 치울게요." }] });
    for (const up of [false, true]) {
      const event = { type: "link" as const, target: "pam" as const, up, text: up ? "연결됨" : "끊김", at_ms: up ? 3 : 2 };
      await brain.publish("/brain/link", event);
      await brain.publish("/brain/link_changes", event);
    }
    await settle(bus, [brain, rec]);
    expect(db.list({ kinds: ["thought"] }).map((r) => r.data)).toEqual([{ home: "h", id: "m" }]);
    expect(db.list({ kinds: ["link"] }).map((r) => r.text)).toEqual(["끊김", "연결됨"]);
  } finally { await brain.stop(); await rec.stop(); await bus.close(); db.close(); }
});


it("가린 말은 같은 집·기동에서 실제로 받은 답 글만 되살린다", async () => {
  const { HEARD_MARK } = await import("../src/world/labels.js");
  const bag = Bag.open(":memory:");
  const epoch = { boot: "b", home: "h#1" };
  try {
    for (const [boot, choice] of [["b", "stop"], ["next", "done"]]) {
      const header = { boot, home: epoch.home, stamp: 1, inst: "one", seq: 1 };
      bag.write({ topic: "/phone/progress", key: "p1", header: { ...header, node: "phone" },
        body: { kind: "voice", req: "p1", expires_ms: 100, text: HEARD_MARK } }, 1);
      bag.write({ topic: "/act/progress_result", key: "p1", header: { ...header, node: "act" },
        body: { req: "p1", status: "answer", choice_id: choice } }, 2);
    }
    const heard: string[] = [];
    await replay({ bag, from: 0, to: 4, topics: ["/phone/progress"], launch: async (bus, clock) => {
      const n = new BusNode({ name: "act", bus, epoch, clock });
      n.on("/phone/progress", (m) => { if (m.kind === "voice") heard.push(m.text); });
      return [n];
    } });
    expect(heard).toEqual(["그만"]);
  } finally { bag.close(); }
});
