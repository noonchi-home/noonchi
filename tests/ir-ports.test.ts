// tests/ir-ports.test.ts
import { afterEach, expect, it, vi } from "vitest";
import { PING_MS, READY_MS } from "../src/devices/hub/ir-bridge.js";
import { fakeBoard } from "../src/devices/hub/ir-fake.js";
import { PORTS_SCRIPT, findPort, listSerialPorts, parsePorts, probePort } from "../src/devices/hub/ir-ports.js";
import type { IrPort } from "../src/devices/hub/ir.js";
afterEach(() => { vi.useRealTimers(); });

const CIM = JSON.stringify([
  { Name: "표준 Bluetooth에서 직렬 링크(COM6)", PNPDeviceID: "BTHENUM\\{00001101-0000-1000-8000-00805F9B34FB}_VID&000105D6_PID&000A\\8&3A9899E2&0&78152DAB6130_C00000000" },
  { Name: "USB-SERIAL CH340 (COM10)", PNPDeviceID: "USB\\VID_1A86&PID_7523\\6&11111111&0&1" },
  { Name: "USB-SERIAL CH340(COM7)", PNPDeviceID: "USB\\VID_1A86&PID_7523\\6&34F2BBB7&0&2" },
]);

it("USB 직렬 포트만 COM 번호 차례로 내고 블루투스 직렬 포트는 뺀다", () => {
  expect(parsePorts(CIM)).toEqual([
    { name: "COM7", label: "USB-SERIAL CH340", pnp: "USB\\VID_1A86&PID_7523\\6&34F2BBB7&0&2", usb: true },
    { name: "COM10", label: "USB-SERIAL CH340", pnp: "USB\\VID_1A86&PID_7523\\6&11111111&0&1", usb: true },
  ]);
  expect(parsePorts(JSON.stringify(JSON.parse(CIM)[2]))).toHaveLength(1);
  expect(parsePorts("")).toEqual([]);
});

it("Windows에서만 PowerShell로 목록을 읽는다", async () => {
  const run = vi.fn(async () => CIM);
  expect(await listSerialPorts(run, "win32")).toHaveLength(2);
  expect(run).toHaveBeenCalledWith(PORTS_SCRIPT);
  expect(await listSerialPorts(run, "linux")).toEqual([]);
  expect(run).toHaveBeenCalledTimes(1);
});

it("저장한 USB 장치 id로 바뀐 COM 번호를 찾고, 그 장치가 없으면 null", () => {
  const ports = parsePorts(CIM);
  expect(findPort(ports, { name: "COM3", pnp: "USB\\VID_1A86&PID_7523\\6&34F2BBB7&0&2" })?.name).toBe("COM7");
  expect(findPort(ports, { name: "COM7", pnp: "USB\\VID_1A86&PID_7523\\6&99999999&0&9" })).toBeNull();
  expect(findPort(ports, { name: "COM10", pnp: null })?.name).toBe("COM10");
});

it("열어서 펌웨어를 본다: ir_bridge · 다른 펌웨어 · 답 없음 · 다른 프로그램이 씀", async () => {
  vi.useFakeTimers();
  const wait = READY_MS + PING_MS + 200;
  const run = async (open: IrPort) => { const p = probePort(open, "COM7"); await vi.advanceTimersByTimeAsync(wait); return p; };
  expect(await run(fakeBoard().port)).toBe("ir_bridge");
  expect(await run(fakeBoard({ firmware: "ir_tv" }).port)).toBe("other");
  expect(await run(fakeBoard({ firmware: "silent" }).port)).toBe("silent");
  const busy: IrPort = (_n, _r, lost) => { setTimeout(() => lost("busy"), 10); return { send() {}, close() {} }; };
  expect(await run(busy)).toBe("in_use");
});
