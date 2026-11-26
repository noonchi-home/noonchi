import { describe, expect, expectTypeOf, it } from "vitest";
import { BusNode, MemoryBus, TOPICS } from "../src/bus/index.js";
import { ProgressReplies, progressRoutes } from "../src/act/node.js";
import { emitRobotCommand } from "../src/act/robot/phone.js";
import { phoneCommandRoutes } from "../src/phone/node.js";
import type { PlannedCommandMessage } from "../src/contract/phone.js";

describe("로봇에서 폰으로", () => {
  it("계획과 첫 두 명령이 붙어 와도 폰이 첫 명령부터 받는다", async () => {
    const bus = new MemoryBus(), epoch = { boot: "b", home: "h" };
    const act = new BusNode({ name: "act", bus, epoch }), phone = new BusNode({ name: "phone", bus, epoch });
    const seen: string[] = [];
    phoneCommandRoutes(phone, (m) => { if (m.type === "command") seen.push(m.step); },
      { plan: () => { seen.push("plan"); }, status: () => {} });
    try {
      await act.prepare(); await phone.prepare(); act.start(); phone.start();
      await act.publish("/act/phone_changes", { plan: null });
      for (const step of ["first", "next"]) {
        await emitRobotCommand(act, { type: "command", id: "p", step, text: step, choices: [], speak: true, vision: null, target: null });
      }
      await expect.poll(() => seen).toEqual(["plan", "first", "next"]);
    } finally { await phone.stop(); await act.stop(); await bus.close(); }
  });
  it("마지막 단계의 지우기와 완료 문장을 붙여 보내도 폰은 둘 다 받는다", async () => {
    const bus = new MemoryBus(), epoch = { boot: "b", home: "main" };
    const act = new BusNode({ name: "act", bus, epoch }), phone = new BusNode({ name: "phone", bus, epoch });
    const received: PlannedCommandMessage[] = [];
    phoneCommandRoutes(phone, (m) => { received.push(m); });
    const c: PlannedCommandMessage = { type: "command", id: "p", step: "p:1", text: "마지막 단계", choices: [], speak: true, vision: null, target: null };
    try {
      await act.prepare(); await phone.prepare(); act.start(); phone.start();
      await emitRobotCommand(act, c);
      await expect.poll(() => received.length).toBe(1);
      await Promise.all([emitRobotCommand(act, { type: "command_clear", id: "p" }), emitRobotCommand(act, { ...c, step: "done", text: "다 했어요." })]);
      await expect.poll(() => received.map((m) => m.type)).toEqual(["command", "command_clear", "command"]);
    } finally { await phone.stop(); await act.stop(); await bus.close(); }
  });
  it("늦게 붙어도 지금 명령을 받고 다른 집의 명령은 받지 않는다", async () => {
    const epoch = { boot: "b", home: "main" };
    const bus = new MemoryBus();
    const act = new BusNode({ name: "act", bus, epoch });
    const phone = new BusNode({ name: "phone", bus, epoch });
    const other = new BusNode({ name: "act", bus, epoch: { ...epoch, home: "other" } });
    const received: PlannedCommandMessage[] = [];
    phoneCommandRoutes(phone, (m) => { received.push(m); });
    try {
      await act.prepare();
      act.start();
      await other.prepare();
      other.start();
      const cmd = { type: "command", id: "p", step: "p:1", text: "컵을 들어 주세요", speak: true, vision: null, choices: [], target: null } as const;
      await emitRobotCommand(act, { ...cmd, choices: [] });
      await phone.prepare();
      phone.start();
      await expect.poll(() => received.length).toBe(1);
      await emitRobotCommand(other, { type: "command_clear", id: "other" });
      await emitRobotCommand(act, { type: "command_clear", id: "p" });
      await expect.poll(() => received.length).toBe(2);
      expect(received).toEqual([{ ...cmd, speak: false, speech_id: { boot: epoch.boot, homeEpoch: epoch.home, publisher: act.inst, revision: 1 } },
        { type: "command_clear", id: "p" }]);
    } finally {
      await phone.stop();
      await other.stop();
      await act.stop();
      await bus.close();
    }
  });
});

it("두 번 받은 폰 답은 한 번만 실행하고 기한을 넘긴 답은 버린다", async () => {
  const epoch = { boot: "b", home: "one" };
  const bus = new MemoryBus();
  const act = new BusNode({ name: "act", bus, epoch });
  const phone = new BusNode({ name: "phone", bus, epoch });
  let calls = 0;
  const port = new ProgressReplies();
  progressRoutes(act, (b) => { calls++; return { req: b.req, status: "answer", reply: "처리했어요" }; }, () => 100);
  phone.on("/act/progress_result", (result) => port.receive(result));
  try {
    await act.prepare(); await phone.prepare(); act.start(); phone.start();
    const body = { req: "p:1", kind: "button", plan_id: "p", step: "1", choice: "done", expires_ms: 200 } as const;
    for (let i = 0; i < 2; i++) {
      const ack = port.wait(body.req);
      await phone.publish("/phone/progress", body);
      expect((await ack).status).toBe("answer");
    }
    const late = port.wait("expired");
    await phone.publish("/phone/progress", { ...body, req: "expired", expires_ms: 99 });
    expect((await late).status).toBe("stale");
    const closing = port.wait("closing");
    port.close();
    expect((await closing).status).toBe("stale");
    expect(calls).toBe(1);
  } finally { port.close(); await act.stop(); await phone.stop(); await bus.close(); }
});

it("대시보드 통로는 실제 계획·상태·실행 기록만 받는다", () => {
  expect(TOPICS["/act/plan"].body.safeParse({ plan: null }).success).toBe(true);
  expect(TOPICS["/act/plan"].body.safeParse({ plan: null, token: "x" }).success).toBe(false);
  expect(TOPICS["/act/log"].body.safeParse({ type: "execution", state: "unknown", plan_id: "p", at_ms: 1, text: "" }).success).toBe(false);
  expect(TOPICS["/act/status"].body.safeParse({ mode: "other" }).success).toBe(false);
});


it("실행 생성자에서 따로 받는 함수는 계획과 두 검사뿐이다", () => {
  type Options = import("../src/act/track/tracker.js").TrackerOptions;
  type Callbacks = { [K in keyof Options]-?: NonNullable<Options[K]> extends (...args: never[]) => unknown ? K : never }[keyof Options];
  expectTypeOf<Callbacks>().toEqualTypeOf<"planner" | "precheck" | "check">();
});
