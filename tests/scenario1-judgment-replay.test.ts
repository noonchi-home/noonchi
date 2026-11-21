import { describe, expect, it } from "vitest";
import { replayScenario } from "./helpers/scenario1-replay.js";
import { judgeScenario1 } from "../scripts/scenario1-judge.js";

import { leftServerAt, parseArgs, scenarioSettled } from "../scripts/video-check.js";

describe("시나리오 1 합성(composed) 판단 재생", () => {
  it("실영상 모드는 수동 완료와 가짜 서버를 거부한다", () => {
    const flags = ["--clip", "run.mp4", "--scenario", "scenario1", "--left", "62.5"];
    expect(parseArgs(flags)).toMatchObject({ scenario: "scenario1", doneAfterMs: 0, left: { clip: "run.mp4", ms: 62500 } });
    for (const extra of [["--fake"], ["--done-after", "3"], ["--done-on", "2:가기"]])
      expect(typeof parseArgs([...flags, ...extra])).toBe("string");
  });
  it("실영상 모드는 시청자가 떠난 때(--left [영상:]초)를 받아야 TV 끄기 5초를 잴 수 있다", () => {
    const flags = ["--clip", "run.mp4", "--scenario", "scenario1"];
    expect(parseArgs([...flags, "--left", "walk-tv.mp4:3.5"])).toMatchObject({ left: { clip: "walk-tv.mp4", ms: 3500 } });
    for (const left of [[], ["--left"], ["--left", "-1"], ["--left", "x"], ["--left", "walk tv.mp4:3"], ["--left", "walk-tv.mp4:"]])
      expect(typeof parseArgs([...flags, ...left])).toBe("string");
    expect(parseArgs(["--clip", "run.mp4"])).not.toHaveProperty("left");
  });
  it("떠난 때는 그 영상이 이어 붙은 영상 시각에서 시작한 자리에 초를 더해 서버 시각으로 옮긴다", () => {
    // 서버 5~9초 동안 첫 영상 끝 장면을 붙잡았다가 단계 영상 walk-tv.mp4를 영상 시각 4초에서 틀었다
    const record = {
      t0: 1000,
      sync: [[1000, 0], [5000, 4000], [9000, 4000], [12000, 7000]] as [number, number][],
      clips: [{ video_ms: 4000, clip: "walk-tv.mp4" }],
    };
    expect(leftServerAt({ clip: "run.mp4", ms: 2000 }, "run.mp4", record, 1)).toBe(3000);
    expect(leftServerAt({ clip: "walk-tv.mp4", ms: 1000 }, "run.mp4", record, 1)).toBe(10000);
    expect(leftServerAt({ clip: "other.mp4", ms: 0 }, "run.mp4", record, 1)).toBeNull();
  });
  it("중간 판정은 되돌릴 수 없는 실패(늦은 끄기·다른 기기·다른 컵·수동 끈 TV 켜기)면 바로 끝내고, 아직 오지 않은 단계는 기다린다", () => {
    for (const m of ["late:tv_off", "wrong_tv", "wrong_cup:pick", "manual_off_then_on"])
      expect(scenarioSettled({ passed: false, firstMismatch: m })).toBe(true);
    for (const m of ["missing:empty", "unexpected:tv_off", "unconfirmed:tv_off_ack"])
      expect(scenarioSettled({ passed: false, firstMismatch: m })).toBe(false);
  });
  it("빈 판에서 빠진 첫 단계는 주방 입구 관찰이다", () => {
    expect(judgeScenario1([]).firstMismatch).toBe("missing:kitchen");
  });
  it("주방 관찰부터 TV를 다시 켤 때까지 11단계를 실제 명령과 기기 확인으로 채운다", async () => {
    let livePassed = false;
    const trace = await replayScenario("normal", (v) => {
      expect(v.firstMismatch, JSON.stringify(v.events)).toBeNull();
      livePassed = v.passed;
    });
    expect(livePassed).toBe(true);
    const v = judgeScenario1(trace);
    expect(v.firstMismatch, JSON.stringify(trace)).toBeNull();
    expect(v.passed).toBe(true);
    expect(v.tvConfirmToCupCommandMs).toBeGreaterThanOrEqual(0);
    // 떠남(16.55초) → 다음 촬영 17.5초 → 2초 이어진 빈 사진(19.5초 촬영) → 그 답이 1.9초 뒤 도착해 끔
    expect(v.leftToOffMs).toBe(4850);
    expect(v.noViewerToOffMs).toBe(2100);
    expect(v.noViewerToAckMs).toBeGreaterThanOrEqual(v.noViewerToOffMs!);
    expect(judgeScenario1(trace.map((e) => (e.kind === "left" ? { ...e, at: e.at - 151 } : e))).firstMismatch).toBe(
      "late:tv_off",
    );
    expect(judgeScenario1(trace.filter((e) => e.kind !== "left")).firstMismatch).toBe("unexpected:empty");
    expect(
      judgeScenario1(trace.map((e) => (e.kind === "pick" ? { ...e, id: "another_cup" } : e))).firstMismatch,
    ).toBe("wrong_cup:pick");
    expect(
      judgeScenario1(
        trace.slice(
          0,
          trace.findIndex((e) => e.kind === "standby"),
        ),
      ).passed,
    ).toBe(false);
    expect(judgeScenario1(trace.filter((e) => e.kind !== "tv_off_ack")).passed).toBe(false);
  });
  it("합성 기록의 지연 사진 간격이 그 촬영 때 VLM 간격(빠름 1초·보통 2초)과 다르면 재생을 멈춘다", async () => {
    // 직접 끈 TV는 TV 규칙이 지켜보지 않는데도 1초 간격 사진을 그대로 둔 기록
    await expect(replayScenario("cadence_wrong")).rejects.toThrow("VLM 간격");
  });
  it("같은 식탁에서 식사를 이어가면 목표를 거두고 컵 명령을 내지 않는다", async () => {
    const trace = await replayScenario("back");
    expect(trace.map((e) => e.kind)).toEqual(expect.arrayContaining(["ready", "checking", "back"]));
    expect(trace.filter((e) => ["pick", "table_go", "find_cup"].includes(e.kind))).toEqual([]);
  });
  it("시청자가 잠깐 일어섰다가 돌아오면 TV 끄기를 보내지 않는다", async () => {
    const trace = await replayScenario("brief");
    expect(trace.map((e) => e.kind)).toContain("standby");
    expect(trace.filter((e) => e.kind === "tv_off")).toEqual([]);
  });
  it("직접 끈 TV 앞에 앉아도 자동 켜기를 보내지 않는다", async () => {
    const trace = await replayScenario("manual");
    expect(trace.map((e) => e.kind)).toEqual(expect.arrayContaining(["standby", "manual_off", "viewer_returned"]));
    expect(trace.filter((e) => e.kind === "tv_on")).toEqual([]);
    expect(
      judgeScenario1([
        ...trace,
        { kind: "tv_on", at: 99000, id: trace.find((e) => e.kind === "manual_off")!.id, command: "x" },
      ]).firstMismatch,
    ).toBe("manual_off_then_on");
  });
});
