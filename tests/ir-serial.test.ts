import { expect, it } from "vitest";
import { BUSY_EXIT, serialProcess } from "../src/devices/hub/ir-serial.js";

// serial.ps1 대신 node 프로세스를 띄워 끝 코드와 줄만 본다(실제 포트는 열지 않는다)
const end = (code: string) => new Promise<{ lines: string[]; reason: "busy" | undefined }>((resolve) => {
  const lines: string[] = [];
  serialProcess(process.execPath, () => ["-e", code])("COM7", (l) => lines.push(l), (reason) => resolve({ lines, reason }));
});

it("끝 코드 3이면 다른 프로그램이 쥔 포트(busy)이고, 오류 글은 보지 않는다", async () => {
  expect(await end(`process.exit(${BUSY_EXIT})`)).toEqual({ lines: [], reason: "busy" });
  expect(await end(`console.error("Access to the port 'COM7' is denied."); process.exit(1)`)).toEqual({ lines: [], reason: undefined });
});

it("보드 줄을 그대로 받고, 끝나면 까닭 없이 끊김을 알린다", async () => {
  expect(await end(`console.log("ready ir_bridge raw=750"); setTimeout(() => process.exit(0), 300)`))
    .toEqual({ lines: ["ready ir_bridge raw=750"], reason: undefined });
});
