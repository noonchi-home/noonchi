import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { learnKey } from "../scripts/ir-learn.js";
import { loadIrConfig } from "../src/devices/hub/ir-config.js";
import type { IrPort } from "../src/devices/hub/ir.js";

const dirs: string[] = [];
afterEach(()=>{ for (const dir of dirs.splice(0)) rmSync(dir,{force:true,recursive:true}); });
it("learns matching physical presses only, preserves the other key, and rejects ambiguous codes without overwriting", async () => {
  const dir = mkdtempSync(join(tmpdir(),"ir-setup-")); dirs.push(dir);
  const base = { runtime:dir, home:"test-home", device:"test-tv", port:"COM7", offBelow:120, onAbove:500 };
  let line!: (s:string)=>void;
  let closes=0;
  const open:IrPort = (_port,onLine)=>{line=onLine; return {send:()=>{throw Error("unexpected send");},close:()=>{closes++;}};};
  const receive = (key:"on"|"off", code:string) => {
    const learn = learnKey({...base,key},open);
    line("ready"); line("light 600"); line("sent "+code); line("remote NEC:0004:12"); line("remote "+code);
    line("remote "+code);
    return learn;
  };
  await receive("on","NEC:0004:08");
  await receive("off","LG2:0088:1234");
  const config = loadIrConfig(dir,base.home);
  expect(config).toMatchObject({device:base.device,onAbove:500,codes:{on:"NEC:0004:08",off:"LG2:0088:1234"}});
  const contents=()=>readFileSync(join(dir,"homes",base.home,"ir.json"),"utf8");
  const before=contents();
  await expect(receive("off","NEC:0004:08")).rejects.toThrow();
  expect(contents()).toBe(before);
  expect(closes).toBe(3);
});
