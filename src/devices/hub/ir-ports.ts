// Windows 직렬 포트 목록(USB만)과 펌웨어 확인. 블루투스 직렬 포트(BTHENUM)는 열면 연결을 시도하므로 열지 않는다.
import { execFile } from "node:child_process";
import type { IrFirmware } from "../../contract/ir.js";
import { IrBridge, PING_MS, READY_MS } from "./ir-bridge.js";
import type { IrPort } from "./ir.js";

export interface SerialPortInfo { name: string; label: string; pnp: string; usb: boolean }
export const PORTS_SCRIPT = "Get-CimInstance Win32_PnPEntity -Filter \"Name LIKE '%(COM%'\" | Select-Object Name,PNPDeviceID | ConvertTo-Json -Compress";

export function parsePorts(json: string): SerialPortInfo[] {
  if (!json.trim()) return [];
  const raw = JSON.parse(json) as unknown;
  const rows = (Array.isArray(raw) ? raw : [raw]) as { Name?: unknown; PNPDeviceID?: unknown }[];
  return rows.flatMap((r) => {
    const name = typeof r.Name === "string" ? /\((COM\d+)\)\s*$/.exec(r.Name)?.[1] : undefined;
    const pnp = typeof r.PNPDeviceID === "string" ? r.PNPDeviceID : "";
    if (!name || !/^(USB|FTDIBUS)\\/i.test(pnp)) return [];
    return [{ name, label: String(r.Name).replace(/\s*\(COM\d+\)\s*$/, ""), pnp, usb: true }];
  }).sort((a, b) => Number(a.name.slice(3)) - Number(b.name.slice(3)));
}

const powershell = (script: string) => new Promise<string>((resolve, reject) => {
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 10_000 },
    (error, stdout) => (error ? reject(error) : resolve(stdout)));
});

export async function listSerialPorts(run: (script: string) => Promise<string> = powershell, platform: NodeJS.Platform = process.platform): Promise<SerialPortInfo[]> {
  if (platform !== "win32") return [];
  return parsePorts(await run(PORTS_SCRIPT));
}

export function findPort(ports: SerialPortInfo[], saved: { name: string; pnp: string | null }): SerialPortInfo | null {
  if (saved.pnp) return ports.find((p) => p.pnp === saved.pnp) ?? null;
  return ports.find((p) => p.name === saved.name) ?? null;
}

const FIRMWARE: Record<string, IrFirmware> = { connected: "ir_bridge", wrong_firmware: "other", silent: "silent", busy: "in_use", lost: "silent" };
export function probePort(open: IrPort, name: string): Promise<IrFirmware> {
  return new Promise((resolve) => {
    const bridge = new IrBridge(open, name);
    let done = false;
    const finish = (f: IrFirmware) => { if (done) return; done = true; clearTimeout(limit); off(); bridge.close(); resolve(f); };
    const off = bridge.onState((s) => { if (s !== "connecting") finish(FIRMWARE[s]!); });
    const limit = setTimeout(() => finish("silent"), READY_MS + PING_MS + 100);
    bridge.start();
  });
}
