// 설정 저장소: 고른 집·끝냄(runtime/setup.json)과 집별 기기 신호 출처(runtime/homes/<id>/signals.json).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SetupError, SetupStore, parseSources } from "../src/setup/store.js";

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
