// tests/ir-remotes.test.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { EMPTY_REMOTES, codeOf, equalSignal, loadRemotes, pressMatches, sameTicks, saveRemotes, tvConfigOf, type RemotesFile } from "../src/devices/hub/ir-remotes.js";
import { necTicks } from "../src/devices/hub/ir-fake.js";

const dirs: string[] = [];
const runtime = () => { const d = mkdtempSync(join(tmpdir(), "ir-remotes-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const file = (over: Partial<RemotesFile> = {}): RemotesFile => ({
  version: 1, port: { name: "COM7", pnp: "USB\\VID_1A86&PID_7523\\6&34F2BBB7&0&2" },
  remotes: [{ id: "r_0000000a", label: "거실 TV 리모컨", device: "tv_1", buttons: [
    { id: "b_0000000a", label: "전원", role: "toggle", signal: { kind: "nec", address: 4, command: 8 }, learned_at: "2026-11-27T10:00:00.000Z" },
    { id: "b_0000000b", label: "음량 올림", role: null, signal: { kind: "nec", address: 4, command: 2 }, learned_at: "2026-11-27T10:01:00.000Z" },
  ] }],
  ...over,
});

it("없으면 빈 파일이고, 저장한 것을 그대로 다시 읽는다", () => {
  const dir = runtime();
  expect(loadRemotes(dir, "mokryeon_180b")).toEqual(EMPTY_REMOTES);
  saveRemotes(dir, "mokryeon_180b", file());
  expect(loadRemotes(dir, "mokryeon_180b")).toEqual(file());
  expect(readFileSync(join(dir, "homes", "mokryeon_180b", "remotes.json"), "utf8")).toContain("\"version\": 1");
});

it("단추 이름·전원 뜻·신호가 겹치거나 가전 하나에 리모컨이 둘이면 저장하지 않는다", () => {
  const dir = runtime();
  const base = file();
  const r = base.remotes[0]!;
  const bad: RemotesFile[] = [
    { ...base, remotes: [{ ...r, buttons: [r.buttons[0]!, { ...r.buttons[1]!, label: "전원" }] }] },
    { ...base, remotes: [{ ...r, buttons: [r.buttons[0]!, { ...r.buttons[1]!, role: "toggle" }] }] },
    { ...base, remotes: [{ ...r, buttons: [r.buttons[0]!, { ...r.buttons[1]!, signal: { kind: "nec", address: 4, command: 8 } }] }] },
    { ...base, remotes: [r, { ...r, id: "r_0000000b" }] },
  ];
  for (const f of bad) expect(() => saveRemotes(dir, "h", f)).toThrow();
  expect(loadRemotes(dir, "h")).toEqual(EMPTY_REMOTES);
});

it("모르는 칸이 있는 파일은 읽지 않는다", () => {
  const dir = runtime();
  mkdirSync(join(dir, "homes", "h"), { recursive: true });
  writeFileSync(join(dir, "homes", "h", "remotes.json"), JSON.stringify({ ...file(), extra: 1 }));
  expect(() => loadRemotes(dir, "h")).toThrow();
});

it("원본 신호는 칸 수 ±2, 칸마다 max(3칸, 25%) 안이면 같다", () => {
  const a = necTicks(4, 8);
  expect(sameTicks(a, a.map((t, i) => (i % 2 ? t + 2 : t - 2)))).toBe(true);
  expect(sameTicks(a, necTicks(4, 9))).toBe(false);
  expect(sameTicks(a, a.slice(0, 60))).toBe(false);
  expect(equalSignal({ kind: "nec", address: 4, command: 8 }, { kind: "raw", khz: 38, ticks: a, decoded: { protocol: "NEC", address: 4, command: 8 } })).toBe(true);
  expect(pressMatches({ kind: "nec", address: 4, command: 8 }, { decoded: { protocol: "NEC", address: 4, command: 8 }, ticks: null, overflow: false, at: 0 })).toBe(true);
  expect(pressMatches({ kind: "nec", address: 4, command: 8 }, { decoded: { protocol: "NEC", address: 4, command: 9 }, ticks: null, overflow: false, at: 0 })).toBe(false);
  expect(pressMatches({ kind: "raw", khz: 38, ticks: a, decoded: null }, { decoded: null, ticks: a, overflow: false, at: 0 })).toBe(true);
});

it("TV 리모컨의 전원 뜻 단추만 IrTv 설정이 되고, 트윈에 없거나 TV가 아닌 가전은 빠진다", () => {
  const devices = [{ id: "tv_1", kind: "tv" }, { id: "ac_1", kind: "aircon" }];
  expect(tvConfigOf(file(), devices)).toMatchObject({ device: "tv_1", codes: { toggle: codeOf("b_0000000a") }, confirmOnMs: 8000, confirmOffMs: 4000 });
  expect(tvConfigOf(file(), [{ id: "ac_1", kind: "aircon" }])).toBeNull();
  expect(tvConfigOf(file({ remotes: [{ ...file().remotes[0]!, device: "ac_1" }] }), devices)).toBeNull();
});
