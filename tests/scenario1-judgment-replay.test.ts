import { describe, expect, it } from "vitest";
import { composedPhotos, map, phoneCamera, replayScenario } from "./helpers/scenario1-replay.js";
import { inView, ndc } from "../src/world/place.js";
import { judgeScenario1, scenarioRank, type ScenarioEvent } from "../scripts/scenario1-judge.js";
import { earlyTvEvidence } from "../scripts/scenario1-live.js";

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
    expect(parseArgs([...flags, "--step", "go:sofa:walk-tv.mp4", "--left", "walk-tv.mp4:3.5"])).toMatchObject({ left: { clip: "walk-tv.mp4", ms: 3500 } });
    for (const left of [[], ["--left"], ["--left", "-1"], ["--left", "x"], ["--left", "walk tv.mp4:3"], ["--left", "walk-tv.mp4:"]])
      expect(typeof parseArgs([...flags, ...left])).toBe("string");
    expect(parseArgs(["--clip", "run.mp4"])).not.toHaveProperty("left");
    // --clip·--step에 없는 영상 이름이면 떠남 단계가 영원히 채워지지 않는다
    expect(typeof parseArgs([...flags, "--left", "other.mp4:3"])).toBe("string");
    expect(parseArgs([...flags, "--step", "go:sofa:other.mp4", "--left", "other.mp4:3"])).toMatchObject({ left: { clip: "other.mp4", ms: 3000 } });
  });
  it("떠난 때가 그 영상 길이를 넘으면 서버 시각으로 옮기지 않는다(붙잡은 장면·다음 영상 시각이 되지 않게)", () => {
    const record = { t0: 1000, sync: [[1000, 0]] as [number, number][], clips: [{ video_ms: 4000, clip: "walk-tv.mp4", duration_ms: 2000 }] };
    expect(leftServerAt({ clip: "walk-tv.mp4", ms: 2000 }, "run.mp4", record, 1)).toBe(7000);
    expect(leftServerAt({ clip: "walk-tv.mp4", ms: 2001 }, "run.mp4", record, 1)).toBeNull();
    expect(leftServerAt({ clip: "run.mp4", ms: 3001 }, "run.mp4", record, 1, 3000)).toBeNull();
  });
  it("떠난 때는 그 영상이 이어 붙은 영상 시각에서 시작한 자리에 초를 더해 서버 시각으로 옮긴다", () => {
    // 서버 5~9초 동안 첫 영상 끝 장면을 붙잡았다가 단계 영상 walk-tv.mp4를 영상 시각 4초에서 틀었다
    const record = {
      t0: 1000,
      sync: [[1000, 0], [5000, 4000], [9000, 4000], [12000, 7000]] as [number, number][],
      clips: [{ video_ms: 4000, clip: "walk-tv.mp4" }],
    };
    expect(leftServerAt({ clip: "run.mp4", ms: 2000 }, "run.mp4", record, 1, 4000)).toBe(3000);
    expect(leftServerAt({ clip: "walk-tv.mp4", ms: 1000 }, "run.mp4", { ...record, clips: [{ ...record.clips[0]!, duration_ms: 3000 }] }, 1)).toBe(10000);
    expect(leftServerAt({ clip: "other.mp4", ms: 0 }, "run.mp4", record, 1)).toBeNull();
    // 영상 길이를 모르면 범위를 확인할 수 없어 옮기지 않는다
    expect(leftServerAt({ clip: "walk-tv.mp4", ms: 1000 }, "run.mp4", record, 1)).toBeNull();
    expect(leftServerAt({ clip: "run.mp4", ms: 2000 }, "run.mp4", record, 1)).toBeNull();
  });
  it("중간 판정은 되돌릴 수 없는 실패(늦은 끄기·다른 기기·다른 컵·수동 끈 TV 켜기)면 바로 끝내고, 아직 오지 않은 단계는 기다린다", () => {
    for (const m of ["late:tv_off", "wrong_tv", "wrong_cup:pick", "manual_off_then_on"])
      expect(scenarioSettled({ passed: false, firstMismatch: m })).toBe(true);
    for (const m of ["missing:empty", "unexpected:tv_off", "unconfirmed:tv_off_ack"])
      expect(scenarioSettled({ passed: false, firstMismatch: m })).toBe(false);
    // 대기 전 끔→켬 묶음은 대기 자리에 도착한 뒤에는 더 채워지지 않는다
    expect(scenarioSettled({ passed: false, firstMismatch: "early_tv:not_back_on", events: [{ kind: "standby" }] })).toBe(true);
    expect(scenarioSettled({ passed: false, firstMismatch: "early_tv:not_back_on", events: [] })).toBe(false);
  });
  it("합성 사진의 카메라는 그 촬영 때 폰이 선 자리에서 그 자리의 바라볼 곳을 비춘 카메라다(집 전체를 보는 고정 카메라가 아니다)", () => {
    const photos = composedPhotos("normal");
    expect(new Set(photos.map((p) => p.phone.join())).size).toBeGreaterThan(1);
    for (const p of photos) {
      expect([p.camera.origin[0], p.camera.origin[2]]).toEqual(p.phone);
      // 바라볼 곳이 화면 가운데 세로줄에 온다
      expect(ndc(p.camera, [p.look[0], 0.8, p.look[1]])![0]).toBeCloseTo(0, 6);
    }
  });
  it("가로로 든 폰은 거실 대기 자리에서 소파 시청 구역 전체를, 식탁 관찰 자리에서 식탁에 앉은 사람을 본다. 주방 입구에서는 식탁이 등 뒤라 안 보인다", () => {
    const zone = (id: string) => map.zones.find((z) => z.id === id)!;
    const whole = (cam: ReturnType<typeof phoneCamera>, id: string) =>
      zone(id).polygon.every((p) => [0, 1.2].every((h) => inView(cam, [p[0], h, p[1]])));
    const middle = (id: string): [number, number, number] => {
      const ps = zone(id).polygon;
      return [ps.reduce((a, p) => a + p[0], 0) / ps.length, 0.9, ps.reduce((a, p) => a + p[1], 0) / ps.length];
    };
    expect(whole(phoneCamera("living_standby"), "sofa_watch")).toBe(true);
    expect(inView(phoneCamera("meal_watch"), middle("dining_seat"))).toBe(true);
    expect(ndc(phoneCamera("kitchen_entry"), middle("dining_seat"))).toBeNull();
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
    // 떠남(74.55초) → 다음 촬영 74.7초(빈 구역) → 2초 이어진 빈 사진(76.7초 촬영) → 그 답이 1.5초 뒤 도착해 끔
    expect(v.leftToOffMs).toBe(3650);
    expect(v.noViewerToOffMs).toBe(1700);
    expect(v.noViewerToAckMs).toBeGreaterThanOrEqual(v.noViewerToOffMs!);
    expect(judgeScenario1(trace.map((e) => (e.kind === "left" ? { ...e, at: e.at - 1351 } : e))).firstMismatch).toBe(
      "late:tv_off",
    );
    expect(judgeScenario1(trace.filter((e) => e.kind !== "left")).firstMismatch).toBe("unexpected:empty");
    // 폰이 식탁·싱크대에 있는 동안은 소파가 화면 밖이라 TV 규칙이 시청 구역을 보지 못한다: 대기 자리 도착 전 끔·켬이 없다
    const standby = trace.find((e) => e.kind === "standby")!;
    expect(v.earlyTvCycles).toBe(0);
    expect(trace.filter((e) => e.at < standby.at && e.kind.startsWith("tv_"))).toEqual([]);
    // 대기 전 끔→켬(예: 폰이 대기 자리에 먼저 와 소파로 걷는 사람을 보는 경우)은 근거 사진이 있고 다시 켜 확인돼야 통과한다(2026-11-21 사용자: 「왔을때 다시 켜주면 되는거 아녀?」)
    const tv = trace.find((e) => e.kind === "tv_off")!.id,
      t0 = standby.at - 9000;
    const cycle: ScenarioEvent[] = [
      { kind: "early_empty", at: t0, id: tv },
      { kind: "tv_off", at: t0 + 2100, id: tv, command: "early:1" },
      { kind: "tv_off_ack", at: t0 + 2100, id: tv, command: "early:1" },
      { kind: "early_viewer", at: t0 + 3000, id: tv },
      { kind: "tv_on", at: t0 + 4500, id: tv, command: "early:2" },
      { kind: "tv_on_ack", at: t0 + 4500, id: tv, command: "early:2" },
    ];
    const withCycle = (c: ScenarioEvent[]) =>
      judgeScenario1([...trace, ...c].sort((a, b) => a.at - b.at || scenarioRank(a.kind) - scenarioRank(b.kind)));
    expect(withCycle(cycle)).toMatchObject({ passed: true, earlyTvCycles: 1 });
    // 다시 켜지 않거나 허브가 켜짐을 확인하지 않으면 실패
    for (const drop of ["tv_on", "tv_on_ack"]) expect(withCycle(cycle.filter((e) => e.kind !== drop)).firstMismatch).toMatch(/^early_tv:/);
    // 끄기 전 시청 구역이 2초 비었다는 사진, 다시 켜기 전 앉아 보는 사진이 있어야 한다(계속 보는데 껐다 켜거나, 오기 전에 켜면 실패)
    expect(withCycle(cycle.filter((e) => e.kind !== "early_empty")).firstMismatch).toBe("early_tv:no_vacancy");
    expect(withCycle(cycle.map((e) => (e.kind === "early_empty" ? { ...e, at: t0 + 101 } : e))).firstMismatch).toBe(
      "early_tv:no_vacancy",
    );
    expect(withCycle(cycle.filter((e) => e.kind !== "early_viewer")).firstMismatch).toBe("early_tv:no_viewer");
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
  it("합성 기록의 폰 도착은 그 자리로 보낸 가기 명령 뒤, 걸어서 닿는 시간 뒤여야 한다", async () => {
    // 식탁 관찰 자리로 가라는 명령(9.1초) 뒤 4.2m를 0.8m/s로 걸어도 14.4초인데 12초에 도착한 기록
    await expect(replayScenario("arrive_early")).rejects.toThrow("가기 명령");
  });
  it("대기 전 끔→켬 근거는 끌 때 이미 받은 사진에서 빈 구간의 첫 사진, 끈 확인 뒤 찍혀 다시 켜기 전에 온 앉아 보는 사진이다", () => {
    const tv = "tv_1",
      at = (kind: ScenarioEvent["kind"], t: number, command?: string): ScenarioEvent => ({ kind, at: t, id: tv, command });
    const events = [at("tv_off", 5000, "c1"), at("tv_off_ack", 5100, "c1"), at("tv_on", 9000, "c2"), at("tv_on_ack", 9100, "c2"), { kind: "standby", at: 20000 } as ScenarioEvent];
    const photo = (t: number, arrived: number, empty: boolean, watching = false) => ({ at: t, arrived, tv, empty, watching });
    const photos = [
      photo(1000, 2800, false),
      photo(2000, 3600, true),
      photo(3000, 4900, true),
      // 끈 뒤에 도착한 앞선 촬영은 그 끄기의 근거가 아니다
      photo(1500, 5200, false),
      photo(6000, 7800, false, true),
      // 다시 켠 뒤에 도착한 사진도 근거가 아니다
      photo(8000, 9500, false, true),
    ];
    expect(earlyTvEvidence(events, photos)).toEqual([
      { kind: "early_empty", at: 2000, id: tv },
      { kind: "early_viewer", at: 6000, id: tv },
    ]);
    expect(earlyTvEvidence(events, photos.filter((p) => p.at !== 6000))).toEqual([{ kind: "early_empty", at: 2000, id: tv }]);
  });
  it("합성 기록의 사진 줄은 모두 VLM 답 지연(lag)을 실어야 한다", async () => {
    // 지연 없는 사진은 촬영 순간 도착한 증거가 되고 간격 검사도 건너뛴다
    await expect(replayScenario("lag_missing")).rejects.toThrow("lag");
    // 촬영 순간 도착하는 답(lag 0)도 지연 조건을 건너뛴다
    await expect(replayScenario("lag_zero")).rejects.toThrow("lag");
  });
  it("같은 식탁에서 식사를 이어가면 목표를 거두고 컵 명령을 내지 않는다", async () => {
    const trace = await replayScenario("back");
    expect(trace.map((e) => e.kind)).toEqual(expect.arrayContaining(["ready", "checking", "back"]));
    expect(trace.filter((e) => ["pick", "table_go", "find_cup"].includes(e.kind))).toEqual([]);
  });
  it("시청자가 잠깐 일어섰다가 돌아오면 TV 끄기를 보내지 않는다", async () => {
    const trace = await replayScenario("brief");
    const standby = trace.find((e) => e.kind === "standby")!;
    expect(standby).toBeDefined();
    expect(trace.filter((e) => e.kind === "tv_off" && e.at > standby.at)).toEqual([]);
  });
  it("직접 끈 TV 앞에 앉아도 자동 켜기를 보내지 않는다", async () => {
    const trace = await replayScenario("manual");
    expect(trace.map((e) => e.kind)).toEqual(expect.arrayContaining(["standby", "manual_off", "viewer_returned"]));
    const manual = trace.find((e) => e.kind === "manual_off")!;
    expect(trace.filter((e) => e.kind === "tv_on" && e.at > manual.at)).toEqual([]);
    expect(
      judgeScenario1([
        ...trace,
        { kind: "tv_on", at: 99000, id: trace.find((e) => e.kind === "manual_off")!.id, command: "x" },
      ]).firstMismatch,
    ).toBe("manual_off_then_on");
  });
});
