import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { learnKey } from "../scripts/ir-learn.js";
import { loadIrConfig } from "../src/devices/hub/ir-config.js";
import type { IrPort } from "../src/devices/hub/ir.js";

const dirs: string[] = [];
afterEach(()=>{ for (const dir of dirs.splice(0)) rmSync(dir,{force:true,recursive:true}); });
it.each([
  { name: "first registration", saved: null, expected: { offBelow:180, onAbove:420, holdMs:600, confirmOnMs:8000, confirmOffMs:4000 } },
  // 창을 나누기 전에 저장한 집: 하나뿐인 confirmMs는 끄기 확인 창이 되고, 켜기는 기본 창을 쓴다
  { name: "calibrated home", saved: { offBelow:0, onAbove:360, holdMs:800, confirmMs:4800 },
    expected: { offBelow:0, onAbove:360, holdMs:800, confirmOnMs:8000, confirmOffMs:4800 } },
  { name: "home with separate windows", saved: { offBelow:0, onAbove:360, holdMs:800, confirmOnMs:12000, confirmOffMs:3000 },
    expected: { offBelow:0, onAbove:360, holdMs:800, confirmOnMs:12000, confirmOffMs:3000 } },
])("registers a key without threshold arguments for a $name", async ({ saved, expected }) => {
  const runtime = mkdtempSync(join(tmpdir(), "ir-defaults-"));
  dirs.push(runtime);
  const options = { runtime, home:"living", device:"tv-1", port:"COM5", key:"off" as const };
  const path = join(runtime, "homes", options.home, "ir.json");
  if (saved) {
    mkdirSync(join(runtime, "homes", options.home), {recursive:true});
    writeFileSync(path, JSON.stringify({ device:options.device, port:options.port, codes:{on:"NEC:0004:08"}, ...saved }));
  }
  await learnKey(options, (_port, receive) => {
    queueMicrotask(() => { receive("remote NEC:0004:09"); receive("remote NEC:0004:09"); });
    return { send:()=>{}, close:()=>{} };
  });
  const codes = saved ? {on:"NEC:0004:08", off:"NEC:0004:09"} : {off:"NEC:0004:09"};
  expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({codes, ...expected});
  expect(loadIrConfig(runtime, options.home)).toMatchObject({codes, ...expected});
});

it("loads a code-only home file with the light sensor defaults", () => {
  const runtime = mkdtempSync(join(tmpdir(), "ir-load-"));
  dirs.push(runtime);
  const folder = join(runtime, "homes", "living");
  mkdirSync(folder, {recursive:true});
  writeFileSync(join(folder, "ir.json"), JSON.stringify({device:"tv-1", port:"COM5", codes:{toggle:"NEC:0004:08"}}));
  expect(loadIrConfig(runtime, "living")).toMatchObject({offBelow:180, onAbove:420, holdMs:600, confirmOnMs:8000, confirmOffMs:4000});
});

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
