// 설정 저장소: 고른 집·끝냄(runtime/setup.json)과 집별 기기 신호 출처(runtime/homes/<id>/signals.json).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SetupError, SetupStore, effectiveSources, parsePairs, parseSources } from "../src/server/setup/store.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "twin-setup-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("SetupStore 메모리 방식", () => {
  it("파일을 만들지 않고 끝냄으로 시작한다", () => {
    const dir = tmp();
    const store = new SetupStore({ runtimeDir: dir, persist: false });
    expect(store.state()).toEqual({ home: null, done: true });
    store.setHome("oneroom");
    expect(store.state()).toEqual({ home: "oneroom", done: false });
    expect(store.hasSources("oneroom")).toBe(false);
    store.saveSources("oneroom", { tv: { kind: "none" } });
    expect(store.hasSources("oneroom")).toBe(true);
    expect(store.sources("oneroom", ["tv"])).toEqual({ tv: { kind: "none" } });
    store.markDone();
    expect(store.state().done).toBe(true);
    expect(existsSync(join(dir, "setup.json"))).toBe(false);
    expect(existsSync(join(dir, "homes"))).toBe(false);
  });
});

describe("SetupStore 저장 방식", () => {
  it("저장한 것이 없으면 집 없음·안 끝냄", () => {
    expect(new SetupStore({ runtimeDir: tmp(), persist: true }).state()).toEqual({ home: null, done: false });
  });

  it("쓰고 다시 열면 같다", () => {
    const dir = tmp();
    const a = new SetupStore({ runtimeDir: dir, persist: true });
    a.setHome("apartment");
    a.saveSources("apartment", { tv: { kind: "none" }, lamp: { kind: "virtual" } });
    a.markDone();
    const b = new SetupStore({ runtimeDir: dir, persist: true });
    expect(b.state()).toEqual({ home: "apartment", done: true });
    expect(b.sources("apartment", ["tv", "lamp"])).toEqual({ tv: { kind: "none" } });
    const file = JSON.parse(readFileSync(join(dir, "homes", "apartment", "signals.json"), "utf8"));
    expect(file).toMatchObject({ version: 1, home: "apartment", sources: { tv: { kind: "none" } } });
  });

  it("고른 적이 있는지: 모두 가상으로 저장해도 고른 것", () => {
    const dir = tmp();
    const a = new SetupStore({ runtimeDir: dir, persist: true });
    expect(a.hasSources("apartment")).toBe(false);
    a.saveSources("apartment", { lamp: { kind: "virtual" } });
    expect(a.hasSources("apartment")).toBe(true);
    expect(new SetupStore({ runtimeDir: dir, persist: true }).hasSources("apartment")).toBe(true);
    expect(a.hasSources("oneroom")).toBe(false);
  });

  it("같은 집을 다시 고르면 끝냄을 그대로 두고, 다른 집이면 안 끝냄", () => {
    const dir = tmp();
    const s = new SetupStore({ runtimeDir: dir, persist: true });
    s.setHome("apartment");
    s.markDone();
    s.setHome("apartment");
    expect(s.state().done).toBe(true);
    s.setHome("oneroom");
    expect(s.state()).toEqual({ home: "oneroom", done: false });
  });

  it("지금 집에 없는 기기 id는 버리고 알린다", () => {
    const dir = tmp();
    const logs: string[] = [];
    const s = new SetupStore({ runtimeDir: dir, persist: true, log: (l) => logs.push(l) });
    s.saveSources("apartment", { tv: { kind: "none" }, gone: { kind: "none" } });
    expect(s.sources("apartment", ["tv"])).toEqual({ tv: { kind: "none" } });
    expect(logs.join("\n")).toMatch(/gone/);
  });

  it("깨진 파일은 알리고 빈 값으로 본다", () => {
    const dir = tmp();
    writeFileSync(join(dir, "setup.json"), "{ 깨짐");
    mkdirSync(join(dir, "homes", "apartment"), { recursive: true });
    writeFileSync(join(dir, "homes", "apartment", "signals.json"), JSON.stringify({ version: 1, home: "apartment", sources: { tv: { kind: "thinq" } } }));
    const logs: string[] = [];
    const s = new SetupStore({ runtimeDir: dir, persist: true, log: (l) => logs.push(l) });
    expect(s.state()).toEqual({ home: null, done: false });
    expect(s.sources("apartment", ["tv"])).toEqual({});
    expect(logs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("parseSources", () => {
  it("기기 id → virtual|none", () => {
    expect(parseSources({ tv: "none", lamp: "virtual" }, ["tv", "lamp"])).toEqual({ tv: { kind: "none" }, lamp: { kind: "virtual" } });
  });
  it("모르는 기기·값·형식은 한국어 오류", () => {
    expect(() => parseSources({ nope: "none" }, ["tv"])).toThrow(SetupError);
    expect(() => parseSources({ nope: "none" }, ["tv"])).toThrow(/없는 기기/);
    expect(() => parseSources({ tv: "thinq" }, ["tv"])).toThrow(/virtual 또는 none/);
    expect(() => parseSources(["tv"], ["tv"])).toThrow(/객체/);
  });
});

describe("운영 모드", () => {
  it("메모리 방식: 기본은 시험 모드, 바꾸면 그대로, 파일은 만들지 않는다", () => {
    const dir = tmp();
    const s = new SetupStore({ runtimeDir: dir, persist: false });
    expect(s.mode()).toBe("test");
    s.setMode("live");
    expect(s.mode()).toBe("live");
    s.setHome("oneroom");
    expect(s.mode()).toBe("live");
    expect(existsSync(join(dir, "setup.json"))).toBe(false);
  });

  it("저장 방식: setup.json에 mode, 다시 열어도 같고, mode가 없던 파일은 시험 모드", () => {
    const dir = tmp();
    const a = new SetupStore({ runtimeDir: dir, persist: true });
    expect(a.mode()).toBe("test");
    a.setHome("oneroom");
    a.setMode("live");
    expect(JSON.parse(readFileSync(join(dir, "setup.json"), "utf8"))).toMatchObject({ version: 1, home: "oneroom", mode: "live" });
    expect(new SetupStore({ runtimeDir: dir, persist: true }).mode()).toBe("live");
    writeFileSync(join(dir, "setup.json"), JSON.stringify({ version: 1, home: "oneroom", done: true }));
    expect(new SetupStore({ runtimeDir: dir, persist: true }).mode()).toBe("test");
  });
});

describe("ThinQ 짝", () => {
  it("메모리 방식: 집마다 저장하고 읽는다", () => {
    const s = new SetupStore({ runtimeDir: tmp(), persist: false });
    expect(s.pairs("oneroom", ["ac_1"])).toEqual({});
    s.savePairs("oneroom", { ac_1: "thinq-ac" });
    expect(s.pairs("oneroom", ["ac_1"])).toEqual({ ac_1: "thinq-ac" });
    expect(s.pairs("apartment", ["ac_1"])).toEqual({});
  });

  it("저장 방식: homes/<id>/thinq.json, 다시 열어도 같고, 사라진 기기는 버리고 알린다", () => {
    const dir = tmp();
    const logs: string[] = [];
    const a = new SetupStore({ runtimeDir: dir, persist: true, log: (l) => logs.push(l) });
    a.savePairs("oneroom", { ac_1: "thinq-ac", gone: "thinq-x" });
    const file = JSON.parse(readFileSync(join(dir, "homes", "oneroom", "thinq.json"), "utf8"));
    expect(file).toMatchObject({ version: 1, home: "oneroom", pairs: { ac_1: "thinq-ac", gone: "thinq-x" } });
    const b = new SetupStore({ runtimeDir: dir, persist: true, log: (l) => logs.push(l) });
    expect(b.pairs("oneroom", ["ac_1"])).toEqual({ ac_1: "thinq-ac" });
    expect(logs.join("\n")).toMatch(/gone/);
    logs.length = 0;
    expect(b.pairs("oneroom", ["ac_1"], { quiet: true })).toEqual({ ac_1: "thinq-ac" });
    expect(logs).toEqual([]);
  });

  it("깨진 짝 파일은 알리고 짝 없음으로 본다", () => {
    const dir = tmp();
    mkdirSync(join(dir, "homes", "oneroom"), { recursive: true });
    writeFileSync(join(dir, "homes", "oneroom", "thinq.json"), "{ 깨짐");
    const logs: string[] = [];
    expect(new SetupStore({ runtimeDir: dir, persist: true, log: (l) => logs.push(l) }).pairs("oneroom", ["ac_1"])).toEqual({});
    expect(logs.join("\n")).toMatch(/짝/);
  });
});

describe("parsePairs", () => {
  const devices = [{ id: "ac_1", kind: "aircon" as const }, { id: "fridge_1", kind: "fridge" as const }, { id: "tv", kind: "tv" as const }];
  it("트윈 id → ThinQ id, null은 짝 풀기", () => {
    expect(parsePairs({ ac_1: "thinq-ac", fridge_1: null }, devices)).toEqual({ ac_1: "thinq-ac", fridge_1: null });
  });
  it("모르는 기기·짝지을 수 없는 종류·빈 값·형식은 한국어 오류", () => {
    expect(() => parsePairs({ nope: "x" }, devices)).toThrow(/없는 기기/);
    expect(() => parsePairs({ tv: "x" }, devices)).toThrow(/에어컨·냉장고/);
    expect(() => parsePairs({ ac_1: "" }, devices)).toThrow(SetupError);
    expect(() => parsePairs({ ac_1: 3 }, devices)).toThrow(SetupError);
    expect(() => parsePairs("ac_1", devices)).toThrow(/객체/);
  });
});

describe("effectiveSources", () => {
  it("시험 모드는 저장한 출처 그대로, 실제 모드는 짝지은 기기만 thinq", () => {
    const stored = { tv: { kind: "none" as const }, ac_1: { kind: "none" as const } };
    const pairs = { ac_1: "thinq-ac", fridge_1: "thinq-fridge" };
    expect(effectiveSources(stored, pairs, "test")).toEqual(stored);
    expect(effectiveSources(stored, pairs, "live")).toEqual({
      tv: { kind: "none" }, ac_1: { kind: "thinq", deviceId: "thinq-ac" }, fridge_1: { kind: "thinq", deviceId: "thinq-fridge" },
    });
  });
});

describe("돕는 방식(눈치·코치)", () => {
  it("메모리 방식: 기본은 눈치 모드, 바꾸면 그대로, 파일은 만들지 않는다", () => {
    const dir = tmp();
    const s = new SetupStore({ runtimeDir: dir, persist: false });
    expect(s.assist()).toBe("noonchi");
    s.setAssist("coach");
    expect(s.assist()).toBe("coach");
    expect(existsSync(join(dir, "setup.json"))).toBe(false);
  });

  it("assist가 없거나 틀린 옛 setup.json은 noonchi로 읽는다", () => {
    const dir = tmp();
    writeFileSync(join(dir, "setup.json"), JSON.stringify({ version: 1, home: "oneroom", done: true, mode: "live" }));
    expect(new SetupStore({ runtimeDir: dir, persist: true }).assist()).toBe("noonchi");
    writeFileSync(join(dir, "setup.json"), JSON.stringify({ version: 1, home: "oneroom", done: true, assist: "teacher" }));
    expect(new SetupStore({ runtimeDir: dir, persist: true }).assist()).toBe("noonchi");
  });

  it("setup.json이 없을 때 새로 만드는 설정은 자동이고, 새로 쓴 파일에 assist: auto가 있다. setAssist(auto)도 그대로 남는다", () => {
    const dir = tmp();
    const a = new SetupStore({ runtimeDir: dir, persist: true });
    expect(a.assist()).toBe("auto");
    a.setHome("oneroom");
    expect(JSON.parse(readFileSync(join(dir, "setup.json"), "utf8"))).toMatchObject({ version: 1, home: "oneroom", assist: "auto" });
    a.setAssist("noonchi");
    a.setAssist("auto");
    expect(new SetupStore({ runtimeDir: dir, persist: true }).assist()).toBe("auto");
  });

  it("setAssist(coach) 뒤 파일에 assist: coach가 있고 mode는 그대로다. 운영 모드를 바꿔도 돕는 방식은 그대로다", () => {
    const dir = tmp();
    const a = new SetupStore({ runtimeDir: dir, persist: true });
    a.setHome("oneroom");
    a.setMode("live");
    a.setAssist("coach");
    expect(JSON.parse(readFileSync(join(dir, "setup.json"), "utf8"))).toMatchObject({ version: 1, home: "oneroom", mode: "live", assist: "coach" });
    a.setMode("test");
    expect(JSON.parse(readFileSync(join(dir, "setup.json"), "utf8"))).toMatchObject({ mode: "test", assist: "coach" });
    const b = new SetupStore({ runtimeDir: dir, persist: true });
    expect([b.mode(), b.assist()]).toEqual(["test", "coach"]);
  });
});
