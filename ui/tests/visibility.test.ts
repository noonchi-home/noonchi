import { describe, expect, it } from "vitest";
import { hiddenByFocus } from "../src/twin/visibility";

// 뷰어(twin-studio walls.mjs)가 노드를 숨기는 까닭: 천장 보기 꺼짐(ceilingVisible), 낮춘 벽에 걸림(cutAction),
// 방 초점 + 초점 방만(focusVisible). 말풍선은 방 초점 때문에 숨은 것만 따라 숨는다.
const view = (focus: string | null, isolate = true, cctv = false) => ({ focus, isolate, cctv });
const lamp = { room: "living_room", mount: "ceiling", category: "lighting" };
const ac = { room: "bedroom", mount: "wall", category: "appliances" };
const hidden = () => true;
const shown = () => false;

describe("hiddenByFocus", () => {
  it("방 초점이 없으면 숨은 천장 기기도 말풍선을 감추지 않는다", () => {
    expect(hiddenByFocus(lamp, view(null), hidden)).toBe(false);
  });

  it("초점 방의 기기는 감추지 않는다", () => {
    expect(hiddenByFocus(lamp, view("living_room"), hidden)).toBe(false);
  });

  it("초점 방만이면 다른 방에서 숨은 기기는 감춘다(천장 기기도)", () => {
    expect(hiddenByFocus(ac, view("living_room"), hidden)).toBe(true);
    expect(hiddenByFocus({ ...lamp, room: "bedroom" }, view("living_room"), hidden)).toBe(true);
  });

  it("다른 방이라도 뷰어가 보여 주면 감추지 않는다(초점 방으로 이어진 문)", () => {
    expect(hiddenByFocus({ room: "hallway", category: "openings" }, view("living_room"), shown)).toBe(false);
  });

  it("초점 방만이 꺼졌거나 CCTV로 보는 중이면 감추지 않는다", () => {
    expect(hiddenByFocus(ac, view("living_room", false), hidden)).toBe(false);
    expect(hiddenByFocus(ac, view("living_room", true, true), hidden)).toBe(false);
  });

  it("방이 없는 것·구조물·장면에 없는 기기는 감추지 않는다", () => {
    expect(hiddenByFocus({ room: null, category: "appliances" }, view("living_room"), hidden)).toBe(false);
    expect(hiddenByFocus({ room: "bedroom", category: "structure" }, view("living_room"), hidden)).toBe(false);
    expect(hiddenByFocus(undefined, view("living_room"), hidden)).toBe(false);
  });

  it("다른 방이 아니면 노드가 숨었는지 묻지 않는다", () => {
    let asked = 0;
    hiddenByFocus(lamp, view(null), () => { asked++; return true; });
    hiddenByFocus(lamp, view("living_room"), () => { asked++; return true; });
    expect(asked).toBe(0);
  });
});
