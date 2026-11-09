import { describe, expect, it } from "vitest";
import { Trigger } from "../src/world/trigger.js";

const ch = (kind: string, meaningful = true) => ({ kind, at_ms: 0, subject: "x", text: "t", meaningful }) as never;
describe("PAM 호출 시점", () => {
  it("이벤트 기반: 의미 있는 변화가 있을 때만, 최소 간격과 동시 1개를 지킨다", () => {
    const t = new Trigger({ mode: "event", minGapMs: 3000, periodMs: 1000, idleStopMs: 1_800_000, maxInflight: 1 }, 0);
    expect(t.due(1000, false, 0)).toBe(false);
    t.onChanges([ch("vlm", false)]);
    expect(t.due(1000, false, 0)).toBe(false);
    t.onChanges([ch("person_gone")]);
    expect(t.due(1000, false, 1)).toBe(false);
    expect(t.due(1000, false, 0)).toBe(true);
    t.called(1000);
    t.onChanges([ch("appeared")]);
    expect(t.due(2000, false, 0)).toBe(false);
    expect(t.due(4000, false, 0)).toBe(true);
  });
  it("주기: 사람이 보이면 1초마다, 사람 없음·등장 사라짐 없음 30분이면 멈추고 등장이면 다시", () => {
    const t = new Trigger({ mode: "periodic", minGapMs: 3000, periodMs: 1000, idleStopMs: 1_800_000, maxInflight: 4 }, 0);
    expect(t.due(1000, true, 3)).toBe(true);
    t.called(1000);
    expect(t.due(1500, true, 0)).toBe(false);
    expect(t.due(1_800_001, false, 0)).toBe(false);
    t.onChanges([ch("appeared")]);
    expect(t.due(1_800_002, false, 0)).toBe(true);
    expect(t.due(1_800_002, false, 4)).toBe(false);
  });
  it("주기 멈춤은 paused로 알 수 있고, event 모드는 멈추지 않는다", () => {
    const p = new Trigger({ mode: "periodic", minGapMs: 3000, periodMs: 1000, idleStopMs: 1000, maxInflight: 4 }, 0);
    expect(p.paused(500, false)).toBe(false);
    expect(p.paused(1500, false)).toBe(true);
    expect(p.paused(1500, true)).toBe(false);
    expect(new Trigger({ mode: "event", minGapMs: 0, periodMs: 1000, idleStopMs: 1000, maxInflight: 1 }, 0).paused(1e9, false)).toBe(false);
  });
});

describe("호출 시점 설정", () => {
  it("기본은 event(최소 간격 3초, 동시 1개), periodic은 동시 4개, 틀린 값이면 시작을 막는다", async () => {
    const { loadTriggerConfig } = await import("../src/world/trigger.js");
    expect(loadTriggerConfig({})).toEqual({ mode: "event", minGapMs: 3000, periodMs: 1000, idleStopMs: 1_800_000, maxInflight: 1 });
    expect(loadTriggerConfig({ PAM_TRIGGER: "periodic" })).toMatchObject({ mode: "periodic", maxInflight: 4 });
    expect(() => loadTriggerConfig({ PAM_TRIGGER: "sometimes" })).toThrow(/PAM_TRIGGER/);
    expect(() => loadTriggerConfig({ PAM_MIN_GAP_MS: "-1" })).toThrow(/PAM_MIN_GAP_MS/);
  });
});
