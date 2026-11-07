import { describe, expect, it } from "vitest";
import { RemainingTracker, deviceStatus, relatedDeviceIds } from "../src/world/relations.js";

describe("관계표", () => {
  it("컵·병·그릇에 식기세척기를 붙이고, 상태 이름은 running으로 정한다", () => {
    const devices = [{ id: "dw", kind: "dishwasher" }, { id: "tv", kind: "tv" }];
    for (const cls of ["cup", "bottle", "bowl"] as const) expect(relatedDeviceIds(cls, devices)).toEqual(["dw"]);
    expect(deviceStatus("dishwasher", { running: true })).toBe("작동 중");
    expect(deviceStatus("dishwasher", { running: false })).toBe("이용 가능");
    expect(deviceStatus("tv", { power: "on" })).toBeNull();
  });
});

describe("남은 시간", () => {
  it("코스 시간이 없으면 비워 두고, 끝나면 지운다", () => {
    const r = new RemainingTracker();
    r.update("d", { running: true }, 0);
    expect(r.remainingMin("d", 60_000)).toBeNull();
    r.update("d", { running: true, course_min: 10 }, 120_000);
    expect(r.startedAt("d")).toBe(0);
    expect(r.remainingMin("d", 9 * 60_000 + 1)).toBe(1);
    expect(r.remainingMin("d", 20 * 60_000)).toBe(0);
    r.update("d", { running: false }, 30 * 60_000);
    expect(r.startedAt("d")).toBeNull();
  });
});
