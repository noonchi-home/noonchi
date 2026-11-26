import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { repoPath } from "../../shared/paths.js";
import type { IrPort } from "./ir.js";

/** Windows PowerShell ships the .NET SerialPort driver on the home laptop. */
export const openIrPort: IrPort = (port, received, lost) => {
  if (process.platform !== "win32") throw new Error("적외선 송신기는 집의 Windows 노트북에서 연결해 주세요.");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", repoPath("hardware/ir-tv/serial.ps1"), port], {windowsHide:true, stdio:["pipe","pipe","inherit"]});
  let closed = false;
  const lines = createInterface({input:child.stdout, crlfDelay:Infinity});
  lines.on("line", line => { if (!closed) received(line); });
  const close = () => {
    if (closed) return;
    closed = true;
    lines.close();
    child.stdin.end();
    child.kill();
  };
  const disconnected = () => {
    if (closed) return;
    close();
    lost();
  };
  child.once("error", disconnected);
  child.once("exit", disconnected);
  child.stdin.on("error", disconnected);
  return { send(line) {
    if (closed || !child.stdin.writable) throw new Error("TV 송신기가 연결되지 않았어요.");
    child.stdin.write(line + "\n");
  }, close };
};
