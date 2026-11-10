// 카메라로 가전 상태 맞추기: World State가 본 가전 설비(TV·냉장고·전자레인지·싱크대)를 그 사진의 방·시야·상자 방향으로 트윈 가전 하나에 맞추고,
// 같은 값이 연속 두 번이면 허브(SignalHub.observe)에 넘긴다. 허브는 실제 출처(ThinQ 읽기·명령한 가상 기기)가 있으면 실제 상태를 두고 다름을 한 번만 알린다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyRules } from "../scripts/lint-ui-copy.js";
import type { Detection } from "../src/brain/detector.js";
import type { WorldChange } from "../src/contract/world.js";
import { MemoryHub } from "../src/hub/memory.js";
import { SignalHub, type SignalSource } from "../src/hub/signals.js";
import type { DeviceSpec, DeviceState } from "../src/hub/types.js";
import { loadLayout } from "../src/layout/load.js";
import { DEFAULT_TWIN_DIR, loadTwin } from "../src/model/devices.js";
import { resolveHome } from "../src/model/homes.js";
import { describeDevice } from "../src/model/mapping.js";
import { loadScene } from "../src/model/scene.js";
import { sha256, type EngineFrame } from "../src/observe/ring.js";
import type { CameraView } from "../src/phone/session.js";
import { floorPlanFrom, roomNamedAt } from "../src/plan/route.js";
import { ThinqClient, thinqConfig } from "../src/thinq/client.js";
import { ThinqLink } from "../src/thinq/link.js";
import { WorldState } from "../src/world/state.js";
import { textFromWorld } from "../src/world/text.js";
import { FAKE_FRIDGE, startFakeThinq, type FakeThinq } from "./helpers/thinq.js";

type V3 = [number, number, number];
type Quat = [number, number, number, number];
type Box = Detection["box"];

// 90° 시야 투영(열 우선). tests/world-state.test.ts와 같다
const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
const mul = (a: number[], b: number[]) => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!, a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
/** 눈 자리(트윈 [x, 높이, y])에서 target을 화면 한가운데로 보는 카메라. */
function aim(eye: V3, target: V3): CameraView {
  const dx = target[0] - eye[0], dh = target[1] - eye[1], dz = target[2] - eye[2];
  const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dh, Math.hypot(dx, dz));
  return { origin: eye, orientation: mul([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)]) as Quat, theta: 0, projection: P };
}
const W = 480, H = 360;
/** 화면 좌표(nx·ny, -1..1) 자리가 가운데인 상자. */
const boxAt = (nx = 0, ny = 0, w = 120, h = 120): Box => [((nx + 1) / 2) * W - w / 2, ((1 - ny) / 2) * H - h / 2, w, h];
const det = (label: Detection["label"], box: Box = boxAt()): Detection => ({ label, score: 0.9, cls: 0, box });
const eyeOf = (p: V3) => ({ position: [p[0], p[2]] as [number, number], height_m: p[1], yaw_deg: 0, pitch_deg: 0 });
/** 엔진 프레임 i: 2초 간격 촬영 시각. */
const frame = (i: number, view: CameraView | null, eye: V3 | null): EngineFrame => ({
  id: `e${i}`, capturedAtMs: i * 2000, latestAtMs: i * 2000, jpeg: Buffer.from(`${i}`), sha256: sha256(Buffer.from(`${i}`)), width: W, height: H,
  eye: eye && eyeOf(eye), view,
});
type Obs = { object_id: string; state: string };
/** 프레임 하나: 감지 → VLM 답(obs가 null이면 답 없음). 두 쪽의 World State 변화를 돌려준다. */
function look(w: WorldState, i: number, view: CameraView | null, eye: V3 | null, dets: Detection[], obs: Obs[] | null): WorldChange[] {
  const f = frame(i, view, eye);
  const { changes, ids } = w.applyDetections(f, dets);
  if (!obs) return [...changes, ...w.applyMissing(f.id, f.capturedAtMs, { vlm: "timeout" })];
  return [...changes, ...w.applyScene(f.id, f.capturedAtMs, { scene: "room", observations: obs as never, summary: "" }, ids)];
}

function spec(id: string, label: string, room: string, twinType: string, twinAttrs: Record<string, unknown[]>): DeviceSpec {
  return { id, label, room, roomLabel: room, twinType, twinAttrs, ...describeDevice(twinType, twinAttrs)! };
}

/** 허브(가상 MemoryHub + 신호 출처)와 World State를 서버처럼 잇는다: 허브가 알린 상태는 World State 가전 변화가 된다. */
function wire(o: { devices: DeviceSpec[]; sources?: Record<string, SignalSource>; roomAt: (p: [number, number]) => { id: string; label: string } | null; place: (id: string) => V3 | null; world?: MemoryHub }) {
  const inner = o.world ?? new MemoryHub(o.devices);
  const hub = new SignalHub(inner, o.sources ?? {});
  const states: DeviceState[] = [];
  const changes: WorldChange[] = [];
  let clock = 0;
  const world = new WorldState({
    surfaces: () => [], floorAt: () => 0, roomAt: o.roomAt, devices: () => hub.list(), place: o.place,
    see: (id, twin, at) => hub.observe(id, twin, at),
  });
  for (const s of hub.states()) world.applyDevice(s, 0);
  hub.subscribe((s) => {
    states.push(s);
    changes.push(...world.applyDevice(s, clock));
  });
  return { inner, hub, world, states, changes, at: (ms: number) => { clock = ms; } };
}

/** 한양목련 실제 자료: 방·가전·배치(가전 가운데 자리). */
function mokryeon(sources: Record<string, SignalSource> = {}) {
  const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
  const twin = loadTwin(undefined, { home: "mokryeon_180b" });
  const { editor } = loadLayout(home, { runtimeDir: mkdtempSync(join(tmpdir(), "rt-")), log: () => {} })!;
  const roomAt = roomNamedAt(floorPlanFrom(loadScene(home) ?? {}), twin.rooms);
  return wire({ devices: twin.devices, sources, roomAt, place: (id) => editor.center(id)?.position ?? null, world: MemoryHub.fromTwin(twin) });
}

const FRIDGE_ID = "fridge_bbc363a3";
// 냉장고 가운데 [5.9191, 0.925, 2.4596]에서 +x로 1.5m 떨어진 주방·식당
const KITCHEN_EYE: V3 = [7.4, 1.5, 2.46];

describe("카메라로 냉장고 문 맞추기(한양목련)", () => {
  it("냉장고 열림이 두 장 이어지면 트윈 냉장고 문이 열림이 되고, 한 장으로는 바꾸지 않는다", () => {
    const h = mokryeon();
    const fridge = loadLayoutCenter(FRIDGE_ID);
    const view = aim(KITCHEN_EYE, fridge);
    h.at(2000);
    look(h.world, 1, view, KITCHEN_EYE, [det("refrigerator")], [{ object_id: "d1", state: "open" }]);
    expect(h.hub.get(FRIDGE_ID)!.twin.door).toBe("closed");
    expect(h.hub.get(FRIDGE_ID)!.vision).toBeUndefined();
    h.at(4000);
    look(h.world, 2, view, KITCHEN_EYE, [det("refrigerator")], [{ object_id: "d1", state: "open" }]);
    expect(h.hub.get(FRIDGE_ID)).toMatchObject({ twin: { door: "open" }, vision: { twin: { door: "open" }, applied: true } });
    expect(h.hub.get(FRIDGE_ID)!.vision!.at).toBe(new Date(4000).toISOString());
    expect(h.states.filter((s) => s.id === FRIDGE_ID).map((s) => s.twin.door)).toEqual(["open"]);
    expect(h.changes).toEqual([expect.objectContaining({ kind: "device", subject: FRIDGE_ID, meaningful: true, text: "주방·식당 냉장고 문 열림 · 카메라로 봄" })]);
    const v = h.world.view(4000);
    expect(v.devices.find((d) => d.id === FRIDGE_ID)).toMatchObject({ state: ["door_open"], vision: { at_ms: 4000 } });
    expect(v.fixtures).toEqual([expect.objectContaining({ cls: "refrigerator", room: "kitchen", link: { device: FRIDGE_ID, miss: null, at_ms: 4000 } })]);
  });

  it("시야 밖으로 나가도 마지막 상태를 두고, 다른 값도 두 장 이어야 바뀐다", () => {
    const h = mokryeon();
    const view = aim(KITCHEN_EYE, loadLayoutCenter(FRIDGE_ID));
    const away = aim(KITCHEN_EYE, [9, 1.5, 2.46]);
    for (let i = 1; i <= 2; i++) look(h.world, i, view, KITCHEN_EYE, [det("refrigerator")], [{ object_id: "d1", state: "open" }]);
    expect(h.hub.get(FRIDGE_ID)!.twin.door).toBe("open");
    for (let i = 3; i <= 8; i++) look(h.world, i, away, KITCHEN_EYE, [], []);
    expect(h.hub.get(FRIDGE_ID)!.twin.door).toBe("open");
    expect(h.world.view(16_000).devices.find((d) => d.id === FRIDGE_ID)).toMatchObject({ state: ["door_open"], vision: { at_ms: 4000 } });
    look(h.world, 9, view, KITCHEN_EYE, [det("refrigerator")], [{ object_id: "d1", state: "closed" }]);
    expect(h.hub.get(FRIDGE_ID)!.twin.door).toBe("open");
    h.changes.length = 0;
    look(h.world, 10, view, KITCHEN_EYE, [det("refrigerator")], [{ object_id: "d1", state: "closed" }]);
    expect(h.hub.get(FRIDGE_ID)!.twin.door).toBe("closed");
    expect(h.changes.map((c) => c.text)).toEqual(["주방·식당 냉장고 문 닫힘 · 카메라로 봄"]);
  });

  it("가렸다(not_visible)·답 없음은 값이 아니고 셈을 끊지도 않는다. 앞 값과 4초 넘게 떨어지면 처음부터 센다", () => {
    const view = aim(KITCHEN_EYE, loadLayoutCenter(FRIDGE_ID));
    const open = [{ object_id: "d1", state: "open" }];
    for (const between of [[{ object_id: "d1", state: "not_visible" }], null]) {
      const h = mokryeon();
      look(h.world, 1, view, KITCHEN_EYE, [det("refrigerator")], open);
      look(h.world, 2, view, KITCHEN_EYE, [det("refrigerator")], between);
      expect(h.hub.get(FRIDGE_ID)!.twin.door).toBe("closed");
      look(h.world, 3, view, KITCHEN_EYE, [det("refrigerator")], open); // 앞 값과 4초
      expect(h.hub.get(FRIDGE_ID)!.twin.door).toBe("open");
    }
    const late = mokryeon();
    look(late.world, 1, view, KITCHEN_EYE, [det("refrigerator")], open);
    look(late.world, 4, view, KITCHEN_EYE, [det("refrigerator")], open); // 6초 뒤
    expect(late.hub.get(FRIDGE_ID)!.twin.door).toBe("closed");
    look(late.world, 5, view, KITCHEN_EYE, [det("refrigerator")], open);
    expect(late.hub.get(FRIDGE_ID)!.twin.door).toBe("open");
  });

  it("관찰 텍스트: 변화 줄과 [지속] 줄이 카메라로 본 것을 말하고, 글은 화면 글 검사를 지난다", () => {
    const h = mokryeon();
    const view = aim(KITCHEN_EYE, loadLayoutCenter(FRIDGE_ID));
    const recent: WorldChange[] = [];
    for (let i = 1; i <= 3; i++) {
      h.at(i * 2000);
      recent.push(...look(h.world, i, view, KITCHEN_EYE, [det("refrigerator")], [{ object_id: "d1", state: "open" }]));
    }
    recent.push(...h.changes);
    const text = textFromWorld(h.world.view(8000), recent, { nowMs: 8000, offsetMinutes: 0 });
    expect(text).toContain("00:00:04 주방·식당 냉장고 문 열림 · 카메라로 봄");
    expect(text).toContain("[지속] 주방·식당 냉장고 fridge_bbc363a3: 문 열림, 00:00:04부터 4초째, 카메라로 봄, 마지막 확인 00:00:06");
    for (const line of ["주방·식당 냉장고 문 열림 · 카메라로 봄", "카메라로 봄, 마지막 확인 00:00:06"]) expect(copyRules(line), line).toEqual([]);
  });
});

describe("카메라로 TV 맞추기(마곡 아파트 거실)", () => {
  function apartment(sources: Record<string, SignalSource> = {}) {
    const home = resolveHome(DEFAULT_TWIN_DIR, "apartment");
    const twin = loadTwin(undefined, { home: "apartment" });
    const { editor } = loadLayout(home, { runtimeDir: mkdtempSync(join(tmpdir(), "rt-")), log: () => {} })!;
    const roomAt = roomNamedAt(floorPlanFrom(loadScene(home) ?? {}), twin.rooms);
    return { ...wire({ devices: twin.devices, sources, roomAt, place: (id) => editor.center(id)?.position ?? null, world: MemoryHub.fromTwin(twin) }), editor };
  }
  const EYE: V3 = [6.4, 1.2, 8.7];

  it("거실에서 TV 화면 켜짐을 두 장 보면 신호 없는 거실 TV가 켜짐이 된다", () => {
    const h = apartment({ tv_living: { kind: "none" } });
    expect(h.hub.get("tv_living")).toMatchObject({ signal: "none", twin: {} });
    const view = aim(EYE, h.editor.center("tv_living")!.position);
    for (let i = 1; i <= 2; i++) look(h.world, i, view, EYE, [det("tv", boxAt(0, 0, 160, 90))], [{ object_id: "d1", state: "screen_on" }]);
    const s = h.hub.get("tv_living")!;
    expect(s.signal).toBeUndefined();
    expect(s).toMatchObject({ twin: { power: "on" }, matter: { onOff: true }, vision: { twin: { power: "on" }, applied: true } });
    expect(h.changes.map((c) => c.text)).toEqual(["거실 TV 켜짐 · 카메라로 봄"]);
  });

  it("TV를 켜라고 명령한 뒤 카메라가 꺼짐을 보면 켜짐을 두고, 다름은 한 번만 알린다", async () => {
    const h = apartment();
    await h.hub.command("tv_living", { type: "on" });
    const view = aim(EYE, h.editor.center("tv_living")!.position);
    const out: WorldChange[] = [];
    for (let i = 1; i <= 4; i++) out.push(...look(h.world, i, view, EYE, [det("tv", boxAt(0, 0, 160, 90))], [{ object_id: "d1", state: "screen_off" }]));
    expect(h.hub.get("tv_living")).toMatchObject({ twin: { power: "on" }, vision: { twin: { power: "off" }, applied: false } });
    const mismatch = out.filter((c) => c.kind === "device");
    expect(mismatch).toEqual([expect.objectContaining({ subject: "tv_living", meaningful: false, text: "거실 TV 카메라로는 꺼짐 · 기기 값은 켜짐" })]);
    expect(copyRules(mismatch[0]!.text)).toEqual([]);
  });
});

describe("맞추지 못하면 고르지 않는다", () => {
  // 거실 하나에 TV 둘: 카메라 (0, 1.5, 0)에서 +x를 보면 3m 앞 좌우 0.3m(화면 가로 ∓0.1)
  const tvA = spec("tv_a", "왼쪽 TV", "living", "tv", { power: ["off", "on"] });
  const tvB = spec("tv_b", "오른쪽 TV", "living", "tv", { power: ["off", "on"] });
  const AT: Record<string, V3> = { tv_a: [3, 1.5, -0.3], tv_b: [3, 1.5, 0.3] };
  const EYE: V3 = [0, 1.5, 0];
  const front = aim(EYE, [3, 1.5, 0]);
  const two = (devices = [tvA, tvB]) => wire({ devices, roomAt: () => ({ id: "living", label: "거실" }), place: (id) => AT[id] ?? null });
  const linkOf = (h: ReturnType<typeof two>) => h.world.view(0).fixtures[0]!.link;

  it("같은 방 같은 종류 둘이 상자 방향으로 가려지지 않으면 애매함으로 남기고 넘기지 않는다", () => {
    const h = two();
    for (let i = 1; i <= 3; i++) look(h.world, i, front, EYE, [det("tv", boxAt(0, 0, 40, 30))], [{ object_id: "d1", state: "screen_on" }]);
    expect(linkOf(h)).toMatchObject({ device: null, miss: "ambiguous" });
    expect(h.hub.get("tv_a")!.vision).toBeUndefined();
    expect(h.hub.get("tv_b")!.vision).toBeUndefined();
  });

  it("상자가 한쪽 TV를 가리키면 그 TV만", () => {
    const h = two();
    for (let i = 1; i <= 2; i++) look(h.world, i, front, EYE, [det("tv", boxAt(-0.1, 0, 40, 30))], [{ object_id: "d1", state: "screen_on" }]);
    expect(linkOf(h)).toMatchObject({ device: "tv_a", miss: null });
    expect(h.hub.get("tv_a")!.twin.power).toBe("on");
    expect(h.hub.get("tv_b")!.twin.power).toBe("off");
  });

  it("맞추기 전(카메라 없음), 그 방에 같은 종류가 없음, 시야 밖, 상자가 가전과 먼 방향이면 고르지 않는다", () => {
    const noView = two();
    for (let i = 1; i <= 2; i++) look(noView.world, i, null, EYE, [det("tv")], [{ object_id: "d1", state: "screen_on" }]);
    expect(linkOf(noView)).toMatchObject({ device: null, miss: "no_view" });
    expect(noView.hub.get("tv_a")!.twin.power).toBe("off");

    const other = wire({ devices: [tvA], roomAt: () => ({ id: "kitchen", label: "주방" }), place: (id) => AT[id] ?? null });
    look(other.world, 1, front, EYE, [det("tv")], [{ object_id: "d1", state: "screen_on" }]);
    expect(other.world.view(0).fixtures[0]!.link).toMatchObject({ device: null, miss: "no_device" });

    const back = two([tvA]);
    look(back.world, 1, aim(EYE, [-3, 1.5, 0]), EYE, [det("tv")], [{ object_id: "d1", state: "screen_on" }]);
    expect(linkOf(back)).toMatchObject({ device: null, miss: "out_of_view" });

    const off = two([tvA]);
    look(off.world, 1, front, EYE, [det("tv", boxAt(0.9, 0, 40, 30))], [{ object_id: "d1", state: "screen_on" }]);
    expect(linkOf(off)).toMatchObject({ device: null, miss: "off_box" });
  });
});

describe("전자레인지·싱크대: 쓰는 중이 답에 없으면 꺼짐", () => {
  const mw = spec("mw_1", "전자레인지", "kitchen", "microwave", { power: ["off", "on"] });
  const sink = spec("sink_1", "싱크대", "kitchen", "sink_counter", { faucet: ["off", "on"] });
  const AT: Record<string, V3> = { mw_1: [3, 1.2, -0.6], sink_1: [3, 0.9, 0.6] };
  const EYE: V3 = [0, 1.5, 0];
  const front = aim(EYE, [3, 1.2, 0]);
  const kitchen = () => wire({ devices: [mw, sink], roomAt: () => ({ id: "kitchen", label: "주방" }), place: (id) => AT[id] ?? null });
  /** 그 가전 가운데가 이 카메라 화면에서 있는 자리의 상자. */
  const boxOn = (p: V3) => {
    const rel = [p[0] - EYE[0], p[1] - EYE[1], p[2] - EYE[2]];
    const yaw = Math.atan2(rel[2]!, rel[0]!), pitch = Math.atan2(rel[1]!, Math.hypot(rel[0]!, rel[2]!));
    const fwd = Math.atan2(1.2 - 1.5, 3);
    return boxAt(Math.tan(yaw), Math.tan(pitch - fwd), 30, 30);
  };

  it("전자레인지 쓰는 중 두 장이면 켜짐, 다른 사실만 말한 답 두 장이면 꺼짐(문 속성이 없으면 문은 넘기지 않는다)", () => {
    const h = kitchen();
    const seen: Record<string, unknown>[] = [];
    h.hub.subscribe((s) => { if (s.id === "mw_1" && s.vision) seen.push(s.vision.twin); });
    for (let i = 1; i <= 2; i++) look(h.world, i, front, EYE, [det("microwave", boxOn(AT.mw_1!))], [{ object_id: "d1", state: "in_use" }, { object_id: "d1", state: "closed" }]);
    expect(h.hub.get("mw_1")!.twin.power).toBe("on");
    for (let i = 3; i <= 4; i++) look(h.world, i, front, EYE, [det("microwave", boxOn(AT.mw_1!))], [{ object_id: "d1", state: "closed" }]);
    expect(h.hub.get("mw_1")!.twin.power).toBe("off");
    expect(seen).toEqual([{ power: "on" }, { power: "off" }]);
  });

  it("싱크대 물이 흐름 두 장이면 물 나옴, 쓰는 중만 말하면 넘기지 않는다", () => {
    const h = kitchen();
    for (let i = 1; i <= 2; i++) look(h.world, i, front, EYE, [det("sink", boxOn(AT.sink_1!))], [{ object_id: "d1", state: "water_running" }]);
    expect(h.hub.get("sink_1")!.twin.faucet).toBe("on");
    for (let i = 3; i <= 4; i++) look(h.world, i, front, EYE, [det("sink", boxOn(AT.sink_1!))], [{ object_id: "d1", state: "in_use" }]);
    expect(h.hub.get("sink_1")!.twin.faucet).toBe("on");
    for (let i = 5; i <= 6; i++) look(h.world, i, front, EYE, [det("sink", boxOn(AT.sink_1!))], []);
    expect(h.hub.get("sink_1")!.twin.faucet).toBe("off");
  });
});

describe("SignalHub.observe 우선", () => {
  const tv = spec("tv_living", "거실 TV", "living_room", "tv", { power: ["off", "on"] });
  const fridge = spec("fridge_1", "냉장고", "kitchen", "fridge", { door: ["closed", "open"] });
  let fake: FakeThinq | undefined;
  let link: ThinqLink | undefined;
  afterEach(async () => {
    link?.stop();
    link = undefined;
    await fake?.close();
    fake = undefined;
  });

  it("명령 받은 적 없는 가상 기기는 본 값이 상태이고, 명령을 받으면 실제 상태가 이긴다", async () => {
    const hub = new SignalHub(new MemoryHub([tv]));
    const seen: DeviceState[] = [];
    hub.subscribe((s) => seen.push(s));
    expect(hub.observe("tv_living", { power: "on" }, 1000)).toEqual({ kind: "applied" });
    expect(hub.get("tv_living")).toMatchObject({ twin: { power: "on" }, vision: { applied: true } });
    expect(hub.observe("tv_living", { power: "on" }, 3000)).toEqual({ kind: "applied" });
    expect(seen).toHaveLength(1); // 마지막 본 시각만 바뀌면 다시 알리지 않는다
    expect(hub.get("tv_living")!.vision!.at).toBe(new Date(3000).toISOString());
    await hub.command("tv_living", { type: "off" });
    expect(hub.get("tv_living")).toMatchObject({ twin: { power: "off" }, vision: { twin: { power: "on" }, applied: false } });
    expect(seen.at(-1)).toMatchObject({ twin: { power: "off" }, vision: { applied: false } });
    expect(hub.observe("tv_living", { power: "on" }, 5000)).toEqual({ kind: "mismatch", real: { power: "off" } });
    expect(hub.observe("tv_living", { power: "on" }, 7000)).toEqual({ kind: "seen" });
    expect(hub.observe("tv_living", { power: "off" }, 9000)).toEqual({ kind: "seen" });
    expect(hub.observe("tv_living", { power: "on" }, 11_000)).toEqual({ kind: "mismatch", real: { power: "off" } });
    expect(hub.get("tv_living")!.twin.power).toBe("off");
  });

  it("모르는 기기·속성·값은 넘기지 않는다", () => {
    const hub = new SignalHub(new MemoryHub([tv]));
    expect(hub.observe("nope", { power: "on" }, 1)).toEqual({ kind: "ignored" });
    expect(hub.observe("tv_living", { door: "open" }, 1)).toEqual({ kind: "ignored" });
    expect(hub.observe("tv_living", { power: "loud" }, 1)).toEqual({ kind: "ignored" });
    expect(hub.get("tv_living")!.vision).toBeUndefined();
  });

  it("ThinQ 짝 냉장고: 읽기 전에는 본 값이 상태, 읽은 뒤에는 실제 값을 두고 다름을 한 번 알린다", async () => {
    fake = await startFakeThinq();
    const cfg = thinqConfig({ THINQ_TOKEN: "test-token", THINQ_BASE_URL: fake.url });
    if (!cfg.ok) throw new Error(cfg.error);
    const world = new MemoryHub([tv, fridge]);
    const hub = new SignalHub(world, { fridge_1: { kind: "thinq", deviceId: FAKE_FRIDGE } });
    const seen: DeviceState[] = [];
    hub.subscribe((s) => seen.push(s));
    link = new ThinqLink({ client: new ThinqClient(cfg.config), world, pairs: { fridge_1: FAKE_FRIDGE }, pollMs: 0, readbackMs: [0, 5] });
    hub.setLink(link);
    expect(hub.get("fridge_1")).toMatchObject({ signal: "none" });
    expect(hub.observe("fridge_1", { door: "open" }, 1000)).toEqual({ kind: "applied" });
    expect(hub.get("fridge_1")).toMatchObject({ twin: { door: "open" }, vision: { applied: true } });
    expect(hub.get("fridge_1")!.signal).toBeUndefined();
    await link.start();
    expect(hub.get("fridge_1")).toMatchObject({ twin: { door: "closed" }, readback: { deviceId: FAKE_FRIDGE }, vision: { twin: { door: "open" }, applied: false } });
    expect(seen.at(-1)).toMatchObject({ id: "fridge_1", twin: { door: "closed" } });
    expect(hub.observe("fridge_1", { door: "open" }, 3000)).toEqual({ kind: "mismatch", real: { door: "closed" } });
    expect(hub.observe("fridge_1", { door: "open" }, 5000)).toEqual({ kind: "seen" });
    expect(hub.get("fridge_1")!.twin.door).toBe("closed");
  });
});

/** 한양목련 배치의 가전 가운데 자리. */
function loadLayoutCenter(id: string): V3 {
  const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
  return loadLayout(home, { runtimeDir: mkdtempSync(join(tmpdir(), "rt-")), log: () => {} })!.editor.center(id)!.position;
}
