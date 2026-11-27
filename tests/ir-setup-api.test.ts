// tests/ir-setup-api.test.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import type { IrView } from "../src/contract/ir.js";
import { fakeBoard, type FakeBoard } from "../src/devices/hub/ir-fake.js";
import type { SerialPortInfo } from "../src/devices/hub/ir-ports.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { fetchRetry } from "../src/shared/net.js";
import { HOME_SCRIPT, startFakeLlm, type FakeLlm } from "./helpers/llm.js";
import { openWebSocket } from "./helpers/ws.js";
import { kindEntry } from "../src/devices/kinds.js";

let llm: FakeLlm;
beforeAll(async () => { llm = await startFakeLlm(HOME_SCRIPT); });
afterAll(async () => { await llm?.close(); });
let srv: RunningServer | undefined;
const dirs: string[] = [];
afterEach(async () => { await srv?.close(); srv = undefined; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const HOME = "oneroom";
const PNP = "USB\\VID_1A86&PID_7523\\6&34F2BBB7&0&2";
const AT = "2026-11-27T10:00:00.000Z";
const usb = (name: string): SerialPortInfo[] => [{ name, label: "USB-SERIAL CH340", pnp: PNP, usb: true }];
const runtime = () => { const d = mkdtempSync(join(tmpdir(), "ir-setup-")); dirs.push(d); return d; };
async function start(dir: string, board: FakeBoard, ports: () => Promise<SerialPortInfo[]> = async () => usb("COM7"), o: { persist?: boolean; env?: Record<string, string>; logs?: string[] } = {}) {
  srv = await startServer({ env: { HUB: "memory", PORT: "0", ...llm.env, HOME_ID: HOME, RUNTIME_DIR: dir, ...o.env }, log: (l) => { o.logs?.push(l); },
    irPort: board.port, irPorts: ports, persistSetup: o.persist ?? false });
}
const get = async (path: string) => { const r = await fetchRetry(srv!.url + path); return { status: r.status, json: await r.json() as any }; };
const post = async (path: string, body: object) => {
  const r = await fetchRetry(srv!.url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() as any };
};
async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await read(); if (ok(v) || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 50)); }
}
const view = async () => (await get(`/api/setup/ir?home=${HOME}`)).json as IrView;
const pressTwice = async (board: FakeBoard, command: number) => {
  for (let i = 0; i < 2; i++) { board.press({ protocol: "NEC", address: 4, command }); await new Promise((r) => setTimeout(r, 120)); }
};
/** 저장해 둔 remotes.json: tv_1 리모컨에 켜기·끄기 전용 단추. */
const saveTvRemote = (dir: string, port: { name: string; pnp: string | null }) => {
  mkdirSync(join(dir, "homes", HOME), { recursive: true });
  writeFileSync(join(dir, "homes", HOME, "remotes.json"), JSON.stringify({ version: 1, port, remotes: [{ id: "r_0000000a", label: "TV", device: "tv_1", buttons: [
    { id: "b_000000c4", label: "켜기", role: "on", signal: { kind: "nec", address: 4, command: 0xc4 }, learned_at: AT },
    { id: "b_000000c5", label: "끄기", role: "off", signal: { kind: "nec", address: 4, command: 0xc5 }, learned_at: AT },
  ] }] }));
};

it("포트를 고르고 TV 리모컨에 단추를 배우고, 겹치는 신호는 거절하고, 시험 쏘기는 확인을 받아야 쏜다", async () => {
  const dir = runtime(), board = fakeBoard();
  await start(dir, board);
  const first = await view();
  expect(first).toMatchObject({ home: HOME, mode: "test", port: { name: null, state: "none" }, remotes: [], learning: null });
  expect(first.devices.map((d) => d.id)).toContain("tv_1");
  expect(first.devices.map((d) => d.id)).not.toContain("induction_1");
  expect(first.devices.map((d) => d.id)).not.toContain("door_main");
  expect((await get("/api/setup/ir/ports")).json.ports).toEqual([{ name: "COM7", label: "USB-SERIAL CH340", firmware: "ir_bridge" }]);
  await post("/api/setup/ir/port", { home: HOME, port: "COM7" });
  expect((await until(view, (v) => v.port.state === "connected")).port).toEqual({ name: "COM7", state: "connected" });
  expect(await post("/api/setup/ir/remote", { home: HOME, label: "인덕션 리모컨", device: "induction_1" })).toEqual({ status: 400, json: { ok: false, error: "리모컨을 달 수 없는 가전이에요." } });
  const made = (await post("/api/setup/ir/remote", { home: HOME, label: "거실 TV 리모컨", device: "tv_1" })).json as IrView;
  const remote = made.remotes[0]!.id;
  expect((await post("/api/setup/ir/learn", { home: HOME, remote, label: "전원", role: "toggle" })).json.learning).toMatchObject({ state: "waiting", presses: 0 });
  expect((await post("/api/setup/ir/learn", { home: HOME, remote, label: "다른", role: null })).status).toBe(409);
  await pressTwice(board, 8);
  const saved = await until(view, (v) => v.learning?.state !== "waiting");
  expect(saved.learning).toMatchObject({ state: "saved", label: "전원" });
  expect(saved.remotes[0]!.buttons).toEqual([expect.objectContaining({ label: "전원", role: "toggle", signal: "nec" })]);
  const disk = JSON.parse(readFileSync(join(dir, "homes", HOME, "remotes.json"), "utf8"));
  expect(disk.remotes[0].buttons[0].signal).toEqual({ kind: "nec", address: 4, command: 8 });
  expect(disk.port).toEqual({ name: "COM7", pnp: PNP });
  await post("/api/setup/ir/learn", { home: HOME, remote, label: "음량 올림", role: null });
  await pressTwice(board, 8);
  expect((await until(view, (v) => v.learning?.state !== "waiting")).learning).toMatchObject({ state: "duplicate", duplicate_of: "전원" });
  const button = saved.remotes[0]!.buttons[0]!.id;
  expect(await post("/api/setup/ir/test", { home: HOME, remote, button })).toEqual({ status: 400, json: { ok: false, error: "실제 가전에 보내려면 한 번 더 확인해 주세요." } });
  expect(board.written).not.toContain("NEC 0x4 0x8 0");
  expect((await post("/api/setup/ir/test", { home: HOME, remote, button, confirm: true })).json).toEqual({ ok: true, sent: true });
  expect(board.written).toContain("NEC 0x4 0x8 0");
  const preset = (await post("/api/setup/ir/preset", { home: HOME, remote, preset: "lg_tv_power" })).json as IrView;
  expect(preset.remotes[0]!.buttons.map((b) => [b.label, b.role])).toEqual([["전원", "toggle"], ["켜기", "on"], ["끄기", "off"]]);
  expect((await post("/api/setup/ir/learn", { home: "apartment", remote, label: "x", role: null })).status).toBe(409);
}, 30_000);

it("시험 모드에서는 TV 명령을 쏘지 않고, 실제 모드에서는 끄기 단추를 쏜다", async () => {
  const dir = runtime(), board = fakeBoard();
  await start(dir, board);
  await post("/api/setup/ir/port", { home: HOME, port: "COM7" });
  await until(view, (v) => v.port.state === "connected");
  const remote = ((await post("/api/setup/ir/remote", { home: HOME, label: "TV", device: "tv_1" })).json as IrView).remotes[0]!.id;
  await post("/api/setup/ir/preset", { home: HOME, remote, preset: "lg_tv_power" });
  expect((await get("/api/setup")).json.ir).toEqual({ ready: true });
  await srv!.signals.command("tv_1", { type: "off" });
  expect(board.written).not.toContain("NEC 0x4 0xC5 0");
  expect((await post("/api/setup/mode", { mode: "live", confirm: true })).status).toBe(200);
  void srv!.signals.command("tv_1", { type: "off" });
  await until(async () => board.written, (w) => w.includes("NEC 0x4 0xC5 0"));
  expect(board.written).toContain("NEC 0x4 0xC5 0");
}, 30_000);

it("다시 켜면 저장한 리모컨을 읽고, COM 번호가 바뀌어도 같은 USB 장치를 찾아 연다", async () => {
  const dir = runtime();
  await start(dir, fakeBoard());
  await post("/api/setup/ir/port", { home: HOME, port: "COM7" });
  await until(view, (v) => v.port.state === "connected");
  await post("/api/setup/ir/remote", { home: HOME, label: "TV", device: "tv_1" });
  await srv!.close(); srv = undefined;
  await start(dir, fakeBoard(), async () => usb("COM8"));
  const again = await until(view, (v) => v.port.state === "connected");
  expect(again.port).toEqual({ name: "COM8", state: "connected" });
  expect(again.remotes.map((r) => r.label)).toEqual(["TV"]);
  expect(JSON.parse(readFileSync(join(dir, "homes", HOME, "remotes.json"), "utf8")).port.name).toBe("COM8");
  await srv!.close(); srv = undefined;
  await start(dir, fakeBoard(), async () => []);
  expect((await view()).port).toEqual({ name: "COM8", state: "missing" });
}, 40_000);

it("포트 목록을 읽지 못해도 서버는 뜨고 저장한 포트는 USB 장치 없음이다", async () => {
  const dir = runtime(), logs: string[] = [];
  saveTvRemote(dir, { name: "COM7", pnp: PNP });
  await start(dir, fakeBoard(), async () => { throw new Error("powershell timed out"); }, { logs });
  expect((await view()).port).toEqual({ name: "COM7", state: "missing" });
  expect(logs.some((l) => l.includes("powershell timed out"))).toBe(true);
}, 30_000);

it("실제 모드로 띄운 집에서 포트를 나중에 고르면 TV 명령이 그 연결로 나간다", async () => {
  const dir = runtime(), board = fakeBoard();
  saveTvRemote(dir, { name: "COM7", pnp: PNP });
  writeFileSync(join(dir, "setup.json"), JSON.stringify({ version: 1, done: true, home: HOME, mode: "live" }));
  let ports: SerialPortInfo[] = [];
  await start(dir, board, async () => ports, { persist: true });
  expect(await view()).toMatchObject({ mode: "live", port: { name: "COM7", state: "missing" } });
  ports = usb("COM7");
  await post("/api/setup/ir/port", { home: HOME, port: "COM7" });
  await until(view, (v) => v.port.state === "connected");
  void srv!.signals.command("tv_1", { type: "off" });
  await until(async () => board.written, (w) => w.includes("NEC 0x4 0xC5 0"));
  expect(board.written).toContain("NEC 0x4 0xC5 0");
}, 30_000);

it("IR_FAKE=1이면 포트 목록에 가상 적외선 장치가 있고, 고르면 연결된다", async () => {
  const dir = runtime();
  await start(dir, fakeBoard(), async () => [], { env: { IR_FAKE: "1" } });
  expect((await get("/api/setup/ir/ports")).json.ports).toEqual([{ name: "FAKE", label: "가상 적외선 장치", firmware: "ir_bridge" }]);
  await post("/api/setup/ir/port", { home: HOME, port: "FAKE" });
  expect((await until(view, (v) => v.port.state === "connected")).port).toEqual({ name: "FAKE", state: "connected" });
  expect((await get("/api/setup/ir/ports")).json.ports).toEqual([{ name: "FAKE", label: "가상 적외선 장치", firmware: "ir_bridge" }]);
}, 30_000);

it("사람이 등록한 단추를 누르면 대시보드에 리모컨 누름 줄이, 실제 모드에서 허브가 쏘면 리모컨 신호 줄이 생긴다", async () => {
  const dir = runtime(), board = fakeBoard();
  await start(dir, board);
  const rows = new Map<string, any>();
  const ws = await openWebSocket(srv!.url.replace(/^http/, "ws") + "/events", {
    setup: (w) => w.on("message", (d, bin) => { if (bin) return; const m = JSON.parse(String(d)); if (m.type === "trace") for (const r of m.rows) rows.set(r.id, r); }),
  });
  try {
    await post("/api/setup/ir/port", { home: HOME, port: "COM7" });
    await until(view, (v) => v.port.state === "connected");
    const remote = ((await post("/api/setup/ir/remote", { home: HOME, label: "TV", device: "tv_1" })).json as IrView).remotes[0]!.id;
    await post("/api/setup/ir/preset", { home: HOME, remote, preset: "lg_tv_power" });
    const named = (name: string) => [...rows.values()].filter((r) => r.name === name);
    board.press({ protocol: "NEC", address: 4, command: 0xc5 });
    await until(async () => named("리모컨 누름"), (r) => r.length > 0);
    expect(named("리모컨 누름")).toEqual([expect.objectContaining({ kind: "OBSERVATION", input: kindEntry("tv")!.label, output: "단추 누름 확인", refs: expect.objectContaining({ object_id: "tv_1" }) })]);
    expect(named("리모컨 신호")).toEqual([]);
    expect((await post("/api/setup/mode", { mode: "live", confirm: true })).status).toBe(200);
    expect(await srv!.signals.press("tv_1", "켜기")).toEqual({ ok: true, sent: true });
    await until(async () => named("리모컨 신호"), (r) => r.length > 0);
    expect(named("리모컨 신호")).toEqual([expect.objectContaining({ kind: "TOOL", input: kindEntry("tv")!.label, output: "신호 보냄", refs: expect.objectContaining({ object_id: "tv_1" }) })]);
  } finally {
    ws.terminate();
  }
}, 30_000);
