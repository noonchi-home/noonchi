import { describe, expect, it } from "vitest";
import { composedPhotos, composedStates, guideBetween, heldCupAt, map, personSight, phoneCamera, replayScenario, scene, walkProblem } from "./helpers/scenario1-replay.js";
import { edgeDistance, walkingGeometry } from "../src/layout/walk-guide.js";
import { stationSeen } from "../src/act/robot/station-arrival.js";
import type { TrackCore } from "../src/act/track/core.js";
import { floorPlanFrom } from "../src/layout/floor.js";
import { inView, ndc } from "../src/world/place.js";
import { yawPitchQuat } from "../ui/src/phone/core/video-math.js";
import { judgeScenario1, scenarioRank, type ScenarioEvent } from "../scripts/scenario1-judge.js";
import { earlyTvEvidence, LiveScenario, standbyTvEvidence } from "../scripts/scenario1-live.js";

import { leftServerAt, parseArgs, scenarioSettled } from "../scripts/video-check.js";
import type { HistoryRow } from "../src/contract/history.js";
import type { WorldDevice, WorldView } from "../src/contract/world.js";

// 재생 하나가 가상 100초(폰 자세 100ms·World State 250ms마다)를 실제 노드로 돌려 혼자 2초 남짓, 전체 시험과 함께면 5초를 넘는다(act-look·brain-detector처럼 시간을 준다)
describe("시나리오 1 합성(composed) 판단 재생", { timeout: 20_000 }, () => {
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
      // 바라볼 곳(걷는 중이면 도착할 자리)이 화면 가운데 세로줄에 온다
      expect(ndc(p.camera, [p.look[0], 0.8, p.look[1]])![0]).toBeCloseTo(0, 6);
    }
  });
  it("가는 명령을 받은 뒤 걷는 동안 찍힌 사진은 안내 길 위 걷는 자리에서 다음 경유점 쪽을 본다(앞 자리·방향에 머물지 않는다)", () => {
    const spots = [...map.stations.map((s) => s.position), ...map.surface_fronts.map((f) => f.position)];
    const walking = composedPhotos("normal").filter((p) => !spots.some((s) => Math.hypot(s[0] - p.phone[0], s[1] - p.phone[1]) < 1e-6));
    expect(walking.length).toBeGreaterThan(0);
    for (const p of walking) expect(Math.hypot(p.look[0] - p.phone[0], p.look[1] - p.phone[1])).toBeGreaterThan(0);
  });
  it("사진의 사람: 몸통이 화면 안이면 사람 수만, 발이 화면 아래 끝보다 위에 보여야 발 자리·방을 안다", () => {
    const middle = (id: string): [number, number] => {
      const ps = map.zones.find((z) => z.id === id)!.polygon;
      return [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length];
    };
    // 주방 입구에서 1.4m 앞 냉장고 앞 사람: 몸통은 보이지만 발이 화면 아래로 잘린다
    expect(personSight(phoneCamera("kitchen_entry"), middle("fridge_front"))).toEqual({ visible: true, located: false });
    expect(personSight(phoneCamera("living_standby"), middle("sofa_watch"))).toEqual({ visible: true, located: true });
    expect(personSight(phoneCamera("kitchen_entry"), middle("dining_seat"))).toEqual({ visible: false, located: false });
  });
  it("손에 든 컵은 폰을 든 사람이 카메라 앞에 들어 올린 자리다: 바라볼 곳을 비추면 화면 안, 위를 보는 폰에는 찍히지 않는다", () => {
    const at = { position: map.surface_fronts.find((f) => f.surface_id.startsWith("dining_table"))!.position, look: [0, 0] as [number, number] };
    at.look = map.surface_fronts.find((f) => f.surface_id.startsWith("dining_table"))!.look_at;
    const cup = heldCupAt(at);
    const cam = phoneCamera("table");
    expect(inView(cam, cup)).toBe(true);
    const up = { ...cam, orientation: yawPitchQuat(Math.atan2(-(at.look[0] - at.position[0]), -(at.look[1] - at.position[1])), 35) };
    expect(inView(up, cup)).toBe(false);
  });
  it("가로로 든 폰은 거실 대기 자리에서 소파 시청 구역 전체를, 식탁 관찰 자리에서 식탁에 앉은 사람을 본다. 주방 입구에서는 식탁이 등 뒤라 안 보인다", () => {
    const zone = (id: string) => map.zones.find((z) => z.id === id)!;
    const whole = (cam: ReturnType<typeof phoneCamera>, id: string) =>
      zone(id).polygon.every((p) => [0, 1.2].every((h) => inView(cam, [p[0], h, p[1]])));
    const middle = (id: string): [number, number, number] => {
      const ps = zone(id).polygon;
      return [ps.reduce((a, p) => a + p[0], 0) / ps.length, 0.9, ps.reduce((a, p) => a + p[1], 0) / ps.length];
    };
    const roomView=phoneCamera("living_standby");
    const tv = floorPlanFrom(scene).objects.get("tv_62442cb3")!;
    expect(inView(roomView,[tv.position[0],1,tv.position[1]])).toBe(true);
    const standby = map.stations.find(s=>s.id==="living_standby")!;
    const geometry = walkingGeometry(scene);
    const wall = geometry.walls.find(w=>w.id==="bath_center_bottom")!;
    expect(edgeDistance(standby.position,wall.a,wall.b)).toBeLessThanOrEqual(0.6);
    expect(geometry.walkable("living",standby.position)).toBe(true);
    const sink = map.surface_fronts.find(s=>s.surface_id.startsWith("sink_counter"))!;
    expect(guideBetween(sink.position,standby.position)?.remaining.at(-1)?.kind).toBe("stand");
    expect(whole(roomView, "sofa_watch")).toBe(true);
    const target={id:standby.id,position:[standby.position[0],0,standby.position[1]] as [number,number,number],
      look:{position:[standby.look_at[0],0.6,standby.look_at[1]] as [number,number,number]}};
    const proof={camera:roomView,person_count:0,person:null,dining_food:"unknown",seats:"clear"};
    const view={household_photo:{serial:1,id:"seen",at_ms:1000,proof},devices:[{id:tv.id,kind:"tv"}],
      fixtures:[{device:tv.id,last_seen_ms:1000,answered_ms:1000,facts:{screen:{at_ms:1000,value:"screen_on"}}}]};
    const core={o:{state:{view:()=>view},layout:{floor:()=>floorPlanFrom(scene)},stations:{map:()=>map}}} as unknown as TrackCore;
    expect(stationSeen(core,target,0.5,2500)).toBe(true);
    const towardTV=Math.atan2(-(tv.position[0]-standby.position[0]),-(tv.position[1]-standby.position[1]));
    proof.camera={...roomView,orientation:yawPitchQuat(towardTV,-10)};
    expect(inView(proof.camera,target.look.position)).toBe(true);
    expect(stationSeen(core,target,0.5,2500)).toBe(false);
    const offlineView = {...view, devices:[], fixtures:[], household_photo:{...view.household_photo,proof:{...proof,camera:roomView}}};
    const offline = {o:{...core.o,state:{view:()=>offlineView}}} as unknown as TrackCore;
    expect(stationSeen(offline,target,0.5,2500)).toBe(false);
    expect(inView(phoneCamera("meal_watch"), middle("dining_seat"))).toBe(true);
    expect(ndc(phoneCamera("kitchen_entry"), middle("dining_seat"))).toBeNull();
  });
  it("실영상 판정은 기록 DB의 집 사진 줄(사진마다 한 줄)로 시청 구역을 매기고, 빠진 serial이 있으면 photo_gap으로 실패한다(World State를 1초마다 읽으면 1초 간격 사진을 건너뛸 수 있다)", () => {
    const live = new LiveScenario(scene);
    const tv = { id: "tv_62442cb3", kind: "tv", label: "거실 TV", status: "켜짐", state: ["on"], history: [], changed_ms: 0, event_ms: null, started_ms: null, remaining_min: null, active: false } as WorldDevice;
    // 1초마다 읽은 World State에는 마지막 사진 하나뿐이다: 사진은 기록 줄에서만 매긴다
    live.sample({ at_ms: 0, objects: [], devices: [tv], household_photo: undefined } as unknown as WorldView);
    const sofa = map.zones.find((z) => z.id === "sofa_watch")!.polygon;
    const seat: [number, number] = [sofa.reduce((a, p) => a + p[0], 0) / sofa.length, sofa.reduce((a, p) => a + p[1], 0) / sofa.length];
    const camera = phoneCamera("living_standby");
    const row = (serial: number, at: number, empty: boolean): HistoryRow => ({
      id: serial, day: "2026-11-22", kind: "household", at_ms: at + 1500, text: "집 사진", subject: "photo-" + serial,
      data: { event: "photo", photo: { id: "photo-" + serial, serial, at_ms: at, answered_ms: at + 1500, proof: {
        camera, seats: "clear", person_count: empty ? 0 : 1, dining_food: "unknown",
        person: empty ? null : { room: "living", position: seat, seated: true, attention: "toward_tv" } } } },
    });
    const rows = [row(1, 1000, false), row(2, 2000, true), row(3, 3000, true)];
    expect(live.judge(rows, [], null).events.filter((e) => e.kind === "photo_gap")).toEqual([]);
    // since: 그 사진까지 TV 규칙이 센 부재의 시작(촬영 시각)
    expect(live.photoSamples().map((p) => [p.at, p.arrived, p.since, p.watching])).toEqual([
      [1000, 2500, null, true],
      [2000, 3500, 2000, false],
      [3000, 4500, 2000, false],
    ]);
    const epochRow = (epoch: string, r: HistoryRow) => ({ ...r, data: { ...r.data as object, epoch } });
    expect.soft(live.judge([epochRow("boot1/home1",rows[0]!),epochRow("boot1/home2",rows[0]!)],[],null).firstMismatch).toBe("photo_gap");
    const delayed = row(4, 4000, false);
    (delayed.data as {photo: {answered_ms: number}}).photo.answered_ms = delayed.at_ms = 8000;
    live.judge([delayed], [], null);
    expect(live.photoSamples()[0]?.watching).toBe(false);
    const gap = live.judge([rows[0]!, rows[2]!], [], null);
    expect(gap.firstMismatch).toBe("photo_gap");
    expect(gap.events.filter((e) => e.kind === "photo_gap")).toHaveLength(1);
    // 놓친 사진은 다시 받을 수 없다: 실영상 판정을 바로 끝낸다
    expect(scenarioSettled(gap)).toBe(true);
    expect(judgeScenario1([{ kind: "photo_gap", at: 5 }]).firstMismatch).toBe("photo_gap");
  });
  it("판정기는 시청자 부재를 TV 규칙과 같이 센다: 처리 상한으로 건너뛴 한 장은 이어 세고, 늦은 답이 같은 촬영의 빈 사진을 무효로 하면 끊는다", () => {
    const live = new LiveScenario(scene);
    const tv = { id: "tv_62442cb3", kind: "tv", label: "거실 TV", status: "켜짐", state: ["on"], history: [], changed_ms: 0, event_ms: null, started_ms: null, remaining_min: null, active: false } as WorldDevice;
    live.sample({ at_ms: 0, objects: [], devices: [tv], household_photo: undefined } as unknown as WorldView);
    const camera = phoneCamera("living_standby");
    const empty = { camera, seats: "clear", person_count: 0, dining_food: "unknown", person: null };
    const row = (serial: number, at: number, proof: object | null, extra: object = {}, id = "photo-" + serial): HistoryRow => ({
      id: serial, day: "2026-11-22", kind: "household", at_ms: at + 1500, text: "집 사진", subject: id,
      data: { event: "photo", photo: { id, serial, at_ms: at, answered_ms: at + 1500, proof, ...extra } },
    });
    // 2초 사진은 처리 상한으로 VLM에 보내지 않았다(proof 없음, 앞 촬영 1초를 이어 받음). 3초 사진도 그 1초를 이어 받는다(src/world/state/world.ts noteHousehold)
    live.judge([row(1, 1000, empty), row(2, 2000, null, { cap_from_ms: 1000 }), row(3, 3000, empty, { cap_from_ms: 1000 })], [], null);
    expect(live.photoSamples().map((p) => p.since)).toEqual([1000, null, 1000]);
    // 2초 빈 사진의 앞 촬영(1초)에 대한 늦은 답이 사람을 보여 그 빈 사진을 무효로 했다(같은 촬영 시각, 새 번호, proof 없음): 부재는 3초부터 다시 센다
    live.judge([row(1, 1000, empty), row(2, 2000, empty), row(3, 2000, null, {}, "photo-2"), row(4, 3000, empty)], [], null);
    expect(live.photoSamples().map((p) => p.since)).toEqual([1000, 1000, null, 3000]);
  });
  it("대기 뒤 다시 켜기의 시청자 근거는 그 사진의 답이 집 상태에 들어온 때다: 켠 뒤에 답이 온 사진은 근거가 아니다(촬영만 켜기 전이어도)", () => {
    const tv = "tv_1";
    const photo = (t: number, arrived: number, since: number | null, watching = false) => ({ at: t, arrived, until:t+3000, tv, since, watching });
    const photos = [photo(1000, 2500, null), photo(2000, 3500, 2000), photo(4000, 5500, 2000), photo(7000, 9800, null, true)];
    // 대기 0초, 끄기 6초, 끈 확인 6.1초: 끄기 전 마지막 사진(4초)에서 센 부재는 2초부터
    const evidence = standbyTvEvidence(photos, tv, 0, 6000, 6100);
    expect(evidence).toEqual([
      { kind: "empty", at: 2000, id: tv },
      { kind: "vacant", at: 4000, id: tv },
      { kind: "viewer_returned", at: 9800, id: tv },
    ]);
    expect(standbyTvEvidence(photos,tv,0,7500,7600).some(e=>e.kind==="vacant")).toBe(false);
    // 9초에 켰다면 앉아 보는 사진(7초 촬영)의 답은 9.8초에야 들어와 켜기의 근거가 아니다: 시청자 돌아옴(9.8초)이 켜기(9초)보다 늦어 판정이 실패한다
  });
  it("합성 재생의 World State는 집 상태 노드처럼 낸다: 사진·폰 눈만 바뀐 상태는 같은 rev이고, 바뀐 것이 없어도 250ms마다 다시 낸다", () => {
    const states = composedStates("normal");
    // 새 집 사진인데 rev는 그대로인 상태가 있다(목표 노드는 그때 조건 사실과 TV 규칙만 돌고, 사용자 찾기는 250ms 틱이나 새 rev에)
    expect(states.some((x, i) => i > 0 && x.serial !== null && x.serial !== states[i - 1]!.serial && x.rev === states[i - 1]!.rev)).toBe(true);
    expect(new Set(states.map((x) => x.rev)).size).toBeLessThan(new Set(states.map((x) => x.serial)).size);
    // 250ms를 넘게 비는 때가 없다
    expect(states.every((x, i) => i === 0 || x.at - states[i - 1]!.at <= 250)).toBe(true);
  });
  it("합성 재생의 폰은 가기 명령이 보낸 안내 길을 걷는다: 안내가 없거나(보류) 걸은 길과 다르면 그 걸음을 거부한다", () => {
    const from = map.stations.find((s) => s.id === "meal_watch")!.position,
      to = map.stations.find((s) => s.id === "living_standby")!.position;
    const guide = guideBetween(from, to)!;
    expect(walkProblem(from, to, guide)).toBeNull();
    expect(walkProblem(from, to, null, [{at:25,remaining:guide}], 50,100,0.05)).toBeNull();
    expect(walkProblem(from, to, null)).toMatch("보류");
    expect(walkProblem(from, to, guide, [{at:50, remaining:null}], 0, 100)).toMatch("보류");
    const displaced = { ...guide, remaining: guide.remaining.map(p=>({...p,position:[0,0,0]})) as typeof guide.remaining };
    expect(walkProblem(from, to, guide, [{at:50, remaining:displaced}], 0, 100)).toMatch("다름");
    // 다른 길(경유점이 0.5m 옆)
    const moved = guide.remaining.map((p) => ({ ...p, position: [p.position[0] + 0.5, p.position[1], p.position[2]] as [number, number, number] }));
    expect(walkProblem(from, to, { ...guide, remaining: moved as typeof guide.remaining })).toMatch("다름");
  });
  it("빈 판에서 빠진 첫 단계는 주방 입구 관찰이다", () => {
    expect(judgeScenario1([]).firstMismatch).toBe("missing:kitchen");
  });
  it("주방 관찰부터 TV를 다시 켤 때까지 11단계를 실제 명령과 기기 확인으로 채운다", async () => {
    const powerViews: {at:number;rev:number;power:string}[]=[];
    let livePassed = false;
    const trace = await replayScenario("normal", (v) => {
      expect(v.firstMismatch, JSON.stringify(v.events)).toBeNull();
      livePassed = v.passed;
    }, (at, rev, power) => powerViews.push({at,rev,power}));
    const changes = powerViews.filter((s,i) => i && s.power !== powerViews[i-1]!.power);
    expect(changes.map(x=>x.power)).toEqual(["off","on"]);
    for (const change of changes) {
      const index = powerViews.indexOf(change);
      expect(change.rev).toBeGreaterThan(powerViews[index - 1]!.rev);
      expect(change.at).toBe(trace.find(e=>e.kind === (change.power === "on" ? "tv_on_ack" : "tv_off_ack"))!.at);
    }
    expect(livePassed).toBe(true);
    const v = judgeScenario1(trace);
    expect(v.firstMismatch, JSON.stringify(trace)).toBeNull();
    expect(v.passed).toBe(true);
    expect(v.tvConfirmToCupCommandMs).toBeGreaterThanOrEqual(0);
    // 벽 쪽 복귀 후 떠남 82.05초, 빈 구역 82.5~84.5초 촬영, 마지막 답 86.4초에 도착.
    expect(v.leftToOffMs).toBe(4350);
    expect(v.noViewerToOffMs).toBe(3900);
    expect(v.noViewerToAckMs).toBeGreaterThanOrEqual(v.noViewerToOffMs!);
    expect(judgeScenario1(trace.map((e) => (e.kind === "left" ? { ...e, at: e.at - 651 } : e))).firstMismatch).toBe(
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
      { kind: "early_vacant", at: t0 + 2000, id: tv },
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
    expect(withCycle(cycle.map((e) => (e.kind === "early_empty" ? { ...e, at: t0 + 1 } : e))).firstMismatch).toBe(
      "early_tv:no_vacancy",
    );
    // 빈 사진 한 장의 답이 2초 늦게 와 바로 끈 것: 촬영 시각으로 빈 구간이 2초가 안 된다
    expect(withCycle(cycle.map((e) => (e.kind === "early_vacant" ? { ...e, at: t0 } : e))).firstMismatch).toBe("early_tv:no_vacancy");
    expect(withCycle(cycle.filter((e) => e.kind !== "early_vacant")).firstMismatch).toBe("early_tv:no_vacancy");
    // 대기 뒤 끄기도 같다: 빈 구간 첫 촬영(empty)과 끄기를 정한 빈 촬영(vacant)이 2초 넘게 떨어져야 한다
    const vacant = trace.find((e) => e.kind === "vacant")!,
      empty = trace.find((e) => e.kind === "empty")!;
    expect(vacant.at - empty.at).toBeGreaterThanOrEqual(2000);
    expect(judgeScenario1(trace.map((e) => (e.kind === "vacant" ? { ...e, at: empty.at + 1999 } : e))).firstMismatch).toBe("no_vacancy:tv_off");
    expect(judgeScenario1(trace.filter((e) => e.kind !== "vacant")).firstMismatch).toBe("unexpected:tv_off");
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
    // 시청자 돌아옴(앉아 보는 사진의 답이 들어온 때)이 다시 켜기보다 늦으면 실패한다
    const on = trace.find((e) => e.kind === "tv_on" && e.at > standby.at)!;
    const late = trace.map((e) => (e.kind === "viewer_returned" ? { ...e, at: on.at + 1 } : e)).sort((a, b) => a.at - b.at || scenarioRank(a.kind) - scenarioRank(b.kind));
    expect(judgeScenario1(late).firstMismatch).not.toBeNull();
  });
  it("합성 기록의 지연 사진 간격이 그 촬영 때 VLM 간격(빠름 1초·보통 2초)과 다르면 재생을 멈춘다", async () => {
    // 직접 끈 TV는 TV 규칙이 지켜보지 않는데도 1초 간격 사진을 그대로 둔 기록
    await expect(replayScenario("cadence_wrong")).rejects.toThrow("VLM 간격");
  });
  it("합성 기록의 폰 도착은 그 자리로 보낸 가기 명령 뒤, 걸어서 닿는 시간 뒤여야 한다", async () => {
    // 식탁 관찰 자리로 가라는 명령(9.1초) 뒤 9.2초에 출발해 안내 길(4.3m)을 0.8m/s로 걸어도 14.6초인데 12초에 도착한 기록
    await expect(replayScenario("arrive_early")).rejects.toThrow("가기 명령");
  });
  it("판정기가 늦게 조회해도 사진이 집 상태에 들어온 때는 그 집 사진의 VLM 답 시각(answered_ms)이다(기록 줄 시각·다시 낸 상태의 발행 시각이 아니다)", () => {
    const live = new LiveScenario(scene as never);
    const tv = { id: "tv_62442cb3", kind: "tv", label: "거실 TV", status: "켜짐", state: ["on"], history: [], changed_ms: 0 };
    live.sample({ at_ms: 9000, objects: [], devices: [tv], person: { visible: false } } as never);
    const photo = { id: "p1", serial: 1, at_ms: 5000, answered_ms: 6800, proof: null };
    live.judge([{ id: 1, day: "2026-11-22", kind: "household", at_ms: 9000, text: "집 사진", subject: "p1", data: { event: "photo", photo } }], [], null);
    expect(live.photoSamples().map((p) => p.arrived)).toEqual([6800]);
  });
  it("대기 전 끔→켬 근거는 끌 때 이미 받은 사진에서 빈 구간의 첫 사진, 끈 확인 뒤 찍혀 다시 켜기 전에 온 앉아 보는 사진이다", () => {
    const tv = "tv_1",
      at = (kind: ScenarioEvent["kind"], t: number, command?: string): ScenarioEvent => ({ kind, at: t, id: tv, command });
    const events = [at("tv_off", 5000, "c1"), at("tv_off_ack", 5100, "c1"), at("tv_on", 9000, "c2"), at("tv_on_ack", 9100, "c2"), { kind: "standby", at: 20000 } as ScenarioEvent];
    // since: 그 사진까지 TV 규칙이 센 부재의 시작(촬영 시각). 사진 번호 차례로 놓는다
    const photo = (t: number, arrived: number, since: number | null, watching = false) => ({ at: t, arrived, until:t+3000, tv, since, watching });
    const photos = [
      photo(1000, 2800, null),
      photo(2000, 3600, 2000),
      photo(3000, 4900, 2000),
      // 끈 뒤에 도착한 앞선 촬영은 그 끄기의 근거가 아니다
      photo(1500, 5200, null),
      photo(6000, 7800, null, true),
      // 다시 켠 뒤에 도착한 사진도 근거가 아니다
      photo(8000, 9500, null, true),
    ];
    // 빈 구간 첫 촬영(2초)과 끄기를 정한 마지막 빈 촬영(3초, 끄기 전에 도착)
    expect(earlyTvEvidence(events, photos)).toEqual([
      { kind: "early_empty", at: 2000, id: tv },
      { kind: "early_vacant", at: 3000, id: tv },
      { kind: "early_viewer", at: 6000, id: tv },
    ]);
    expect(earlyTvEvidence(events, photos.filter((p) => p.at !== 6000))).toEqual([
      { kind: "early_empty", at: 2000, id: tv },
      { kind: "early_vacant", at: 3000, id: tv },
    ]);
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
