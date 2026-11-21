import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { irSettings, loadIrConfig } from "../src/devices/hub/ir-config.js";
import type { IrConfig, IrPort } from "../src/devices/hub/ir.js";
import { openIrPort } from "../src/devices/hub/ir-serial.js";
import { isEntry } from "../src/shared/paths.js";

interface Options {
  runtime: string;
  home: string;
  device: string;
  port: string;
  key: keyof IrConfig["codes"];
  offBelow: number;
  onAbove: number;
}

export async function learnKey(options: Options, open: IrPort = openIrPort): Promise<void> {
  const {runtime, home, device, port, key, offBelow, onAbove} = options;
  if (!/^[\w-]+$/.test(home) || !device || !/^COM[1-9][0-9]*$/.test(port) ||
      !["on","off","toggle"].includes(key)) throw new Error("Check the home, device, port and key.");
  const existing = loadIrConfig(runtime, home);
  if (existing && (existing.device !== device || existing.port !== port))
    throw new Error("This home already has a different TV or port configured.");
  let connection: ReturnType<IrPort> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let previous: string | undefined;
  try {
    const code = await new Promise<string>((resolve,reject) => {
      timeout = setTimeout(() => reject(new Error("No matching remote presses in 30 seconds.")), 30_000);
      connection = open(port, line => {
        if (!line.startsWith("remote ")) return;
        const [verb, code, extra] = line.split(" ");
        if (verb !== "remote" || !code || extra !== undefined) return;
        if (previous === code) resolve(code);
        previous = code;
      }, () => reject(new Error("The serial port disconnected.")));
    });
    const config = irSettings.parse({...existing, device, port, offBelow, onAbove, codes:{...existing?.codes, [key]:code}});
    const dir = join(runtime, "homes", home);
    mkdirSync(dir, {recursive:true});
    const file = join(dir, "ir.json");
    const tmp = file + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", {flag:"wx"});
      renameSync(tmp, file);
    } finally { rmSync(tmp, {force:true}); }
  } finally {
    clearTimeout(timeout);
    connection?.close();
  }
}

if (isEntry(import.meta.url)) {
  const [runtime,home,device,port,key,off,on] = process.argv.slice(2);
  if (!runtime || !home || !device || !port || !on || !off || (key!=="on" && key!=="off" && key!=="toggle")) {
    console.error("Usage: ir-learn <runtime> <home> <device> <COM port> <on|off|toggle> <off threshold> <on threshold>");
    process.exitCode = 2;
  } else {
    console.log("Press and release the " + key + " key twice.");
    learnKey({runtime,home,device,port,key,offBelow:Number(off),onAbove:Number(on)})
      .then(() => console.log("Saved the learned TV power key for " + home + "."))
      .catch(e => { console.error((e as Error).message); process.exitCode = 1; });
  }
}
