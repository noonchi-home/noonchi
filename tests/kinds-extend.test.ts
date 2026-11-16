// 등록부를 이 시험 안에서만 넓혀(vi.mock, 시험 전용 등록부 확장) 본다: 제어 명령은 종류 이름이 아니라 프로필로 가르고,
// 새 종류는 등록부 한 줄 + 집 파일(added_devices.json) 한 줄이면 기기 목록에 생기고 대시보드 트윈에는 회색 상자로 그려진다.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/devices/kinds.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/devices/kinds.js")>();
  const extra = {
    test_lock: { label: "시험 잠금", synonyms: [], profile: real.KINDS.lock.profile, twinTypes: [{ types: ["test_lock_box"] }] },
    test_shade: { label: "시험 가림막", synonyms: [], profile: real.KINDS.covering.profile, twinTypes: [{ types: ["test_shade_box"] }] },
    test_heater: { label: "시험 난방기", synonyms: [], profile: real.KINDS.thermostat.profile, twinTypes: [{ types: ["test_heater_box"] }] },
  };
  const KINDS = { ...real.KINDS, ...extra };
  return { ...real, KINDS, KIND_ORDER: Object.keys(KINDS), kindEntry: (k: string) => (KINDS as Record<string, unknown>)[k] };
});

const { kindsSnapshot } = await import("../scripts/kinds-snapshot.js");
const { matterFromCommand, twinChange } = await import("../src/devices/mapping.js");
const { loadTwin } = await import("../src/layout/twin-files.js");
const { loadScene } = await import("../src/layout/scene.js");
// 대시보드 트윈이 모델 없는 물건을 그리는 상자(트윈 뷰어 layout.mjs, ui/src/twin/3d/live.ts가 그대로 쓴다)
const LAYOUT = "../twin/apartment/viewer/layout.mjs";
const { boxSpec } = (await import(/* @vite-ignore */ LAYOUT)) as { boxSpec: (o: Record<string, unknown>) => { size: [number, number, number] } };

type Kind = Parameters<typeof twinChange>[0]["kind"];
const spec = (kind: string, twinAttrs: Record<string, unknown[]>) => ({ kind: kind as Kind, label: "시험", sensors: [], twinAttrs });

describe("프로필로 가르기(시험 전용 등록부 확장)", () => {
  it("lock 프로필을 다시 쓰는 새 종류의 제어 attr을 바꾸면 lock/unlock 명령이 나간다(on/off가 아니다)", () => {
    const s = spec("test_lock", { lock: ["locked", "unlocked"] });
    expect(twinChange(s, "lock", "unlocked")).toEqual({ type: "command", command: { type: "unlock" }, value: "unlocked" });
    expect(twinChange(s, "lock", "locked")).toEqual({ type: "command", command: { type: "lock" }, value: "locked" });
  });

  it("covering 프로필을 다시 쓰는 새 종류면 covering 0·100%", () => {
    const s = spec("test_shade", { curtain: ["open", "closed"] });
    expect(twinChange(s, "curtain", "open")).toEqual({ type: "command", command: { type: "covering", openPercent: 100 }, value: "open" });
    expect(twinChange(s, "curtain", "closed")).toEqual({ type: "command", command: { type: "covering", openPercent: 0 }, value: "closed" });
  });

  it("thermostat 프로필을 다시 쓰는 새 종류도 난방 설정점을 쓴다", () => {
    const ops = matterFromCommand({ kind: "test_heater" as Kind }, { type: "climate", setpointC: 21 });
    expect(ops).toContainEqual({ cluster: "thermostat", attribute: "occupiedHeatingSetpoint", value: 2100 });
    expect(ops.some((o) => "attribute" in o && o.attribute === "occupiedCoolingSetpoint")).toBe(false);
  });

  it("지금 21종의 twinChange 결과는 바꾸기 전과 같다", () => {
    const before = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "kinds-before.json"), "utf8")) as { twinChange: Record<string, unknown> };
    const now = JSON.parse(JSON.stringify(kindsSnapshot().twinChange)) as Record<string, unknown>;
    expect(Object.fromEntries(Object.keys(before.twinChange).map((k) => [k, now[k]]))).toEqual(before.twinChange);
  });
});

describe("새 종류 한 줄 + 집 파일 한 줄", () => {
  const dirs: string[] = [];
  afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

  it("카탈로그도 3D 모델도 없는 새 type이면 기기 목록에 그 종류로 생기고, 속성은 프로필 제어·센서 속성의 기본값이며, 대시보드 트윈에는 회색 상자(바닥 넓이·높이)로 그려진다", () => {
    const studio = mkdtempSync(join(tmpdir(), "kinds-new-"));
    dirs.push(studio);
    mkdirSync(join(studio, "homes", "t"), { recursive: true });
    mkdirSync(join(studio, "data", "homes", "t"), { recursive: true });
    writeFileSync(join(studio, "homes.json"), JSON.stringify({ version: 1, default: "t", homes: [{ id: "t", name: "시험 집", data: "data/homes/t", out: "homes/t" }] }));
    const room = { id: "living", label: "거실", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] };
    writeFileSync(join(studio, "homes", "t", "scene.json"), JSON.stringify({ plan: { rooms: [room] }, objects: [] }));
    writeFileSync(join(studio, "data", "homes", "t", "added_devices.json"), JSON.stringify({
      source: "시험", items: [{ id: "heater_1", type: "test_heater_box", label: "거실 난방기", room: "living", position: [1, 2], facing_deg: 90, elevation: 0, footprint: [0.6, 0.3], height: 0.8 }],
    }));
    const twin = loadTwin(studio, { home: "t" });
    expect(twin.devices).toEqual([expect.objectContaining({ id: "heater_1", kind: "test_heater", twinType: "test_heater_box", label: "거실 난방기", room: "living", twinAttrs: { heating: ["off", "on"] } })]);
    expect(twin.initial.heater_1).toEqual({ heating: "off" });
    const o = (loadScene(twin.home)!.objects as Record<string, unknown>[]).find((x) => x.id === "heater_1")!;
    expect(o).toMatchObject({ asset: null, footprint: [0.6, 0.3], height: 0.8 });
    expect(boxSpec(o).size).toEqual([0.6, 0.8, 0.3]);
  });
});
