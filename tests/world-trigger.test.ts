import { describe, expect, it } from "vitest";
import { Trigger, type TriggerConfig } from "../src/world/trigger.js";

const ch = (kind: string, meaningful = true, at_ms = 0) => ({ kind, at_ms, subject: "x", text: "t", meaningful }) as never;
const periodic = (o: Partial<TriggerConfig> = {}) =>
  new Trigger({ mode: "periodic", minGapMs: 3000, periodMs: 5000, idleStopMs: 1_800_000, liveMs: 10_000, maxInflight: 1, ...o }, 0);

describe("PAM 호출 시점", () => {
  it("이벤트 기반: 의미 있는 변화가 있을 때만, 최소 간격과 동시 1개를 지킨다", () => {
    const t = new Trigger({ mode: "event", minGapMs: 3000, periodMs: 5000, idleStopMs: 1_800_000, liveMs: 10_000, maxInflight: 1 }, 0);
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

  // 2026-11-20 pfsm12: 1초 주기 판단이 늘 하나 나가 있어 목표가 부른 판단이 그 답을 기다렸다(사람이 떠난 뒤 첫 명령 3초)
  it("nudge: 다음 한 번은 주기·최소 간격을 기다리지 않고, 나가 있는 판단이 동시 상한만큼 있어도 하나 더 나간다(그 위로는 아니다). 프레임 없음은 지키고, 부르면 풀린다(미리 세운 목표의 사람이 떠남)", () => {
    const t = periodic();
    t.onFrame(1000);
    t.called(1000);
    expect(t.due(1250, false, 0)).toBe(false);
    t.nudge();
    expect(t.due(1250, false, 2)).toBe(false);
    expect(t.due(1250, false, 1)).toBe(true);
    expect(t.due(1250, false, 0)).toBe(true);
    t.called(1250);
    expect(t.due(1500, false, 0)).toBe(false);
    t.nudge();
    expect(t.due(20_000, false, 0)).toBe(false);
    const e = new Trigger({ mode: "event", minGapMs: 3000, periodMs: 5000, idleStopMs: 1_800_000, liveMs: 10_000, maxInflight: 1 }, 0);
    e.called(0);
    e.nudge();
    expect(e.due(100, false, 0)).toBe(true);
  });

  it("주기: 엔진 프레임이 오는 동안 변화와 상관없이 5초마다, 동시 1개", () => {
    const t = periodic();
    t.onFrame(1000);
    expect(t.due(1000, true, 0)).toBe(true);
    expect(t.due(1000, true, 1)).toBe(false);
    t.called(1000);
    t.onFrame(3000);
    expect(t.due(5999, true, 0)).toBe(false);
    t.onFrame(5000);
    expect(t.due(6000, true, 0)).toBe(true);
  });

  it("주기: 사람이 떠난 뒤에도(컵이 남은 때) 프레임이 오면 계속 부르고, 사람 없음·등장 사라짐 없음 30분이면 멈췄다가 등장이면 다시", () => {
    const t = periodic();
    t.onChanges([ch("person_gone", true, 10_000)]);
    t.called(10_000);
    for (let at = 15_000; at < 1_810_000; at += 5000) {
      t.onFrame(at);
      expect(t.due(at, false, 0), `${at}`).toBe(true);
      t.called(at);
    }
    t.onFrame(1_815_000);
    expect(t.pause(1_815_000, false)).toBe("idle");
    expect(t.due(1_815_000, false, 0)).toBe(false);
    expect(t.due(1_815_000, true, 0)).toBe(true);   // 사람이 보이면 멈추지 않는다
    t.onChanges([ch("appeared", true, 1_815_500)]);
    expect(t.pause(1_816_000, false)).toBeNull();
  });

  it("주기: 프레임이 liveMs(10초) 넘게 오지 않으면 부르지 않는다(폰이 없으면 호출·비용 없음), 다시 오면 부른다", () => {
    const t = periodic();
    expect(t.pause(0, false)).toBe("no_frames");
    expect(t.due(60_000, true, 0)).toBe(false);
    t.onFrame(60_000);
    expect(t.due(60_000, true, 0)).toBe(true);
    t.called(60_000);
    expect(t.due(70_000, true, 0)).toBe(true);
    t.called(70_000);
    expect(t.pause(70_001, true)).toBe("no_frames");
    expect(t.due(75_001, true, 0)).toBe(false);
    t.onFrame(80_000);
    expect(t.due(80_000, true, 0)).toBe(true);
  });

  it("event 모드는 멈추지 않는다", () => {
    expect(new Trigger({ mode: "event", minGapMs: 0, periodMs: 1000, idleStopMs: 1000, liveMs: 1000, maxInflight: 1 }, 0).pause(1e9, false)).toBeNull();
  });
});

describe("호출 시점 설정", () => {
  it("기본은 periodic(5초, 프레임 10초 안, 동시 1개), event도 고를 수 있고, 틀린 값이면 시작을 막는다", async () => {
    const { loadTriggerConfig } = await import("../src/world/trigger.js");
    expect(loadTriggerConfig({})).toEqual({ mode: "periodic", minGapMs: 3000, periodMs: 5000, idleStopMs: 1_800_000, liveMs: 10_000, maxInflight: 1 });
    expect(loadTriggerConfig({ PAM_TRIGGER: "event" })).toMatchObject({ mode: "event", minGapMs: 3000, maxInflight: 1 });
    expect(loadTriggerConfig({ PAM_PERIOD_MS: "2000", PAM_LIVE_MS: "4000", PAM_MAX_INFLIGHT: "2" })).toMatchObject({ periodMs: 2000, liveMs: 4000, maxInflight: 2 });
    expect(() => loadTriggerConfig({ PAM_TRIGGER: "sometimes" })).toThrow(/PAM_TRIGGER/);
    expect(() => loadTriggerConfig({ PAM_MIN_GAP_MS: "-1" })).toThrow(/PAM_MIN_GAP_MS/);
    expect(() => loadTriggerConfig({ PAM_LIVE_MS: "x" })).toThrow(/PAM_LIVE_MS/);
  });

  // 2026-11-20 사용자 「NANO면 1초마다 해 그냥」
  it("PAM_PERIOD_MS를 따로 주지 않으면 PAM 모델 이름에 nano가 들 때 기본 주기 1초, 아니면 5초다. PAM_PERIOD_MS를 주면 늘 그 값이다", async () => {
    const { loadTriggerConfig } = await import("../src/world/trigger.js");
    expect(loadTriggerConfig({}, { pamModel: "gpt-5.4-nano" }).periodMs).toBe(1000);
    expect(loadTriggerConfig({}, { pamModel: "GPT-5.4-NANO-2026-03-17" }).periodMs).toBe(1000);
    expect(loadTriggerConfig({}, { pamModel: "gpt-5.4-mini" }).periodMs).toBe(5000);
    expect(loadTriggerConfig({}, { pamModel: "pam" }).periodMs).toBe(5000);
    expect(loadTriggerConfig({}).periodMs).toBe(5000);
    expect(loadTriggerConfig({ PAM_PERIOD_MS: "3000" }, { pamModel: "gpt-5.4-nano" }).periodMs).toBe(3000);
    expect(loadTriggerConfig({ PAM_PERIOD_MS: "5000" }, { pamModel: "gpt-5.4-nano" }).periodMs).toBe(5000);
    expect(loadTriggerConfig({ PAM_PERIOD_MS: "800" }, { pamModel: "gpt-5.4-mini" }).periodMs).toBe(800);
    // 동시 상한은 그대로 1이다
    expect(loadTriggerConfig({}, { pamModel: "gpt-5.4-nano" }).maxInflight).toBe(1);
  });

  it("서버는 PAM_LLM_MODEL을 반영한 최종 PAM 모델(loadEndpoints)로 주기를 고른다: nano면 1초, 기본 openai(mini)·vllm(pam)이면 5초, PAM_PERIOD_MS가 늘 이긴다", async () => {
    const { triggerConfigOf } = await import("../src/server/home/act.js");
    expect(triggerConfigOf({ INFERENCE_MODE: "openai", PAM_LLM_MODEL: "gpt-5.4-nano" }).periodMs).toBe(1000);
    expect(triggerConfigOf({ INFERENCE_MODE: "openai" }).periodMs).toBe(5000);
    expect(triggerConfigOf({ INFERENCE_MODE: "vllm" }).periodMs).toBe(5000);
    expect(triggerConfigOf({ INFERENCE_MODE: "openai", PAM_LLM_MODEL: "gpt-5.4-nano", PAM_PERIOD_MS: "4000" }).periodMs).toBe(4000);
  }, 60_000);

  it("주기 1초여도 답이 늦으면 앞 판단이 끝날 때까지 부르지 않고(동시 1개), 끝나면 바로 다음을 부른다: 실제 간격은 답 시간이다", () => {
    const t = periodic({ periodMs: 1000 });
    t.onFrame(0);
    t.called(0);
    t.onFrame(1000);
    expect(t.due(1000, true, 1)).toBe(false);
    t.onFrame(2500);
    expect(t.due(2500, true, 1)).toBe(false);
    // 2.5초에 답이 왔다: 바로 다음
    expect(t.due(2500, true, 0)).toBe(true);
    t.called(2500);
    // 답이 0.3초에 오면 주기 1초를 지킨다
    t.onFrame(2800);
    expect(t.due(2800, true, 0)).toBe(false);
    t.onFrame(3500);
    expect(t.due(3500, true, 0)).toBe(true);
  });
});
