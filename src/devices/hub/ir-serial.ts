import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { repoPath } from "../../shared/paths.js";
import type { IrPort } from "./ir.js";

/** hardware/ir-bridge/serial.ps1이 다른 프로그램이 쥔 포트(UnauthorizedAccessException)에서 내는 끝 코드. 오류 글은 Windows 표시 언어를 따라 보지 않는다. */
export const BUSY_EXIT = 3;

/** 줄 단위 직렬 중계 프로세스 하나를 포트 하나로 쓴다. 끝 코드가 BUSY_EXIT면 lost("busy"). */
export function serialProcess(command: string, args: (port: string) => string[]): IrPort {
  return (port, received, lost) => {
    const child = spawn(command, args(port), {windowsHide:true, stdio:["pipe","pipe","inherit"]});
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
    const disconnected = (code?: number | null) => {
      if (closed) return;
      close();
      if (code === BUSY_EXIT) lost("busy");
      else lost();
    };
    child.once("error", () => disconnected());
    child.once("exit", code => disconnected(code));
    child.stdin.on("error", () => disconnected());
    return { send(line) {
      if (closed || !child.stdin.writable) throw new Error("TV 송신기가 연결되지 않았어요.");
      child.stdin.write(line + "\n");
    }, close };
  };
}

const powershellSerial = serialProcess("powershell.exe", port => ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
  "-File", repoPath("hardware/ir-bridge/serial.ps1"), port]);

/** Windows PowerShell ships the .NET SerialPort driver on the home laptop. */
export const openIrPort: IrPort = (port, received, lost) => {
  if (process.platform !== "win32") throw new Error("적외선 송신기는 집의 Windows 노트북에서 연결해 주세요.");
  return powershellSerial(port, received, lost);
};
