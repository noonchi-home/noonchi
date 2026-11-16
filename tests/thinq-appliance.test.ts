// ThinQ 상태 ↔ 트윈(src/devices/thinq/appliance.ts): 어댑터(air_conditioner·refrigerator)로 읽기, 트윈 명령 → ThinQ 단계, 읽은 값을 트윈에 비추기.
import { describe, expect, it } from "vitest";
import { MemoryHub } from "../src/devices/hub/memory.js";
import type { Command } from "../src/devices/hub/types.js";
import { PAIRABLE_KINDS, fitsKind, mirrorPlan, readAppliance, thinqAdapterOf, thinqSteps } from "../src/devices/thinq/appliance.js";
import { homeDevices } from "./helpers/home.js";
import { fakeAirconState } from "./helpers/thinq.js";

describe("readAppliance", () => {
  it("에어컨: 전원·모드·설정 온도(°C)·지금 온도·바람", () => {
    expect(readAppliance("air_conditioner", fakeAirconState())).toEqual({ power: "on", mode: "cool", setpointC: 24, currentC: 27, fan: "auto" });
    expect(readAppliance("air_conditioner", {
      operation: { airConOperationMode: "POWER_OFF" }, airConJobMode: { currentJobMode: "AIR_DRY" }, airFlow: { windStrength: "MID" },
    })).toEqual({ power: "off", mode: "dry", fan: "medium" });
  });

  it("에어컨 온도: temperatureInUnits 객체, temperature 대체, 화씨만 있으면 모름", () => {
    expect(readAppliance("air_conditioner", { temperatureInUnits: { targetTemperature: 22, unit: "C" } }).setpointC).toBe(22);
    expect(readAppliance("air_conditioner", { temperature: { targetTemperature: 23, currentTemperature: 26, unit: "C" } })).toEqual({ setpointC: 23, currentC: 26 });
    expect(readAppliance("air_conditioner", { temperatureInUnits: [{ unit: "F", targetTemperature: 75 }] }).setpointC).toBeUndefined();
  });

  it("모르는 값은 비워 둔다", () => {
    expect(readAppliance("air_conditioner", { operation: { airConOperationMode: "STANDBY" }, airConJobMode: { currentJobMode: "X" } })).toEqual({});
    expect(readAppliance("air_conditioner", {})).toEqual({});
  });

  it("냉장고: 문(MAIN) OPEN·CLOSE", () => {
    expect(readAppliance("refrigerator", { doorStatus: [{ locationName: "MAIN", doorState: "OPEN" }] })).toEqual({ door: "open" });
    expect(readAppliance("refrigerator", { doorStatus: [{ locationName: "MAIN", doorState: "CLOSE" }] })).toEqual({ door: "closed" });
    expect(readAppliance("refrigerator", { doorStatus: { doorState: "OPEN" } })).toEqual({ door: "open" });
    expect(readAppliance("refrigerator", {})).toEqual({});
  });

  it("짝지을 수 없는 종류는 어댑터가 없다(등록부 thinq.adapter): 에어컨·냉장고만", () => {
    expect(["aircon", "fridge", "light", "microwave"].map(thinqAdapterOf)).toEqual(["air_conditioner", "refrigerator", null, null]);
  });
});

describe("thinqSteps", () => {
  const names = (cmd: Command) => thinqSteps("air_conditioner", cmd)?.map((s) => s.name);

  it("켜기·끄기", () => {
    const [on] = thinqSteps("air_conditioner", { type: "on" })!;
    expect(on!.body).toEqual({ operation: { airConOperationMode: "POWER_ON" } });
    expect(on!.done({ power: "on" })).toBe(true);
    expect(on!.done({ power: "off" })).toBe(false);
    expect(thinqSteps("air_conditioner", { type: "off" })![0]!.body).toEqual({ operation: { airConOperationMode: "POWER_OFF" } });
  });

  it("냉난방 설정은 켜기를 먼저, 그다음 모드 · 온도 · 바람을 한 단계씩", () => {
    const steps = thinqSteps("air_conditioner", { type: "climate", mode: "cool", setpointC: 26, fan: "high" })!;
    expect(steps.map((s) => s.name)).toEqual(["전원 켜기", "모드 냉방", "설정 온도 26도", "바람 세게"]);
    expect(steps.map((s) => s.body)).toEqual([
      { operation: { airConOperationMode: "POWER_ON" } },
      { airConJobMode: { currentJobMode: "COOL" } },
      { temperatureInUnits: { targetTemperature: 26, unit: "C" } },
      { airFlow: { windStrength: "HIGH" } },
    ]);
    expect(steps[2]!.done({ setpointC: 26 })).toBe(true);
    expect(steps[2]!.done({ setpointC: 24 })).toBe(false);
    expect(steps[2]!.done({})).toBe(false);
    expect(names({ type: "climate", setpointC: 20 })).toEqual(["전원 켜기", "설정 온도 20도"]);
  });

  it("ThinQ로 보낼 수 없는 명령은 null", () => {
    expect(thinqSteps("air_conditioner", { type: "lock" })).toBeNull();
    expect(thinqSteps("refrigerator", { type: "on" })).toBeNull();
  });
});

describe("mirrorPlan", () => {
  const hub = () => MemoryHub.fromTwin({ devices: homeDevices(), initial: {} });
  const spec = (h: MemoryHub, id: string) => h.list().find((d) => d.id === id)!;

  it("에어컨: 달라진 값만 명령으로, 꺼진 채 읽혔으면 climate 뒤에 끈다", async () => {
    const h = hub();
    const ac = thinqAdapterOf(spec(h, "ac_living").kind)!;
    expect(h.get("ac_living")!.matter).toMatchObject({ onOff: false, setpointC: 24, systemMode: "cool", fanMode: "auto" });
    expect(mirrorPlan(ac, { power: "off", setpointC: 24, mode: "cool", fan: "auto" }, h.get("ac_living")!)).toEqual({ commands: [], sensors: [] });
    const plan = mirrorPlan(ac, { power: "off", setpointC: 26, fan: "high" }, h.get("ac_living")!);
    expect(plan).toEqual({ commands: [{ type: "climate", setpointC: 26, fan: "high" }, { type: "off" }], sensors: [] });
    for (const c of plan.commands) await h.command("ac_living", c);
    expect(h.get("ac_living")!.matter).toMatchObject({ onOff: false, setpointC: 26, fanMode: "high" });
    expect(mirrorPlan(ac, { power: "on" }, h.get("ac_living")!)).toEqual({ commands: [{ type: "on" }], sensors: [] });
  });

  it("냉장고: 문은 센서 값으로", () => {
    const h = hub();
    const fridge = thinqAdapterOf(spec(h, "fridge_1").kind)!;
    expect(mirrorPlan(fridge, { door: "open" }, h.get("fridge_1")!)).toEqual({ commands: [], sensors: [["door", "open"]] });
    expect(mirrorPlan(fridge, { door: "closed" }, h.get("fridge_1")!)).toEqual({ commands: [], sensors: [] });
  });
});

describe("짝지을 수 있는 기기", () => {
  it("에어컨·냉장고만, ThinQ 종류가 맞아야 한다", () => {
    expect(PAIRABLE_KINDS).toEqual(["aircon", "fridge"]);
    expect(fitsKind("aircon", "DEVICE_AIR_CONDITIONER")).toBe(true);
    expect(fitsKind("aircon", "DEVICE_REFRIGERATOR")).toBe(false);
    expect(fitsKind("fridge", "DEVICE_REFRIGERATOR")).toBe(true);
    expect(fitsKind("fridge", "DEVICE_KIMCHI_REFRIGERATOR")).toBe(true);
    expect(fitsKind("light", "DEVICE_AIR_CONDITIONER")).toBe(false);
  });
});
