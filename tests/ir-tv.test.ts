import { afterEach, expect, it, vi } from "vitest";
import { SignalHub } from "../src/devices/hub/signals.js";
import { MemoryHub } from "../src/devices/hub/memory.js";
import { describeDevice } from "../src/devices/mapping.js";
import type { IrPort, IrConfig } from "../src/devices/hub/ir.js";

const id = "screen-1";
const attrs = { power:["on","off"] };
const spec = { id, label:"TV", room:"living", roomLabel:"거실", twinType:"tv", twinAttrs:attrs, ...describeDevice("tv", attrs)! };
const codes = {on:"NEC:0004:08",off:"NEC:0004:09",toggle:"NEC:0004:07"};
const active: SignalHub[] = [];
function setup(keys: IrConfig["codes"] = codes) {
  vi.useFakeTimers({now:10000});
  const hub = new SignalHub(new MemoryHub([spec], {[id]:{power:"on"}}));
  active.push(hub);
  const writes: string[] = [];
  let rx!: (line:string)=>void, lost!: ()=>void;
  const open: IrPort = (_port,line,closed) => {
    rx=line; lost=closed;
    return {send: l=>writes.push(l), close:()=>{}};
  };
  hub.setInfrared({device:id,port:"COM3",codes:keys,offBelow:200,onAbove:350,holdMs:600,confirmMs:4000},open);
  const states: string[]=[];
  hub.subscribe(s=>states.push(String(s.twin.power)));
  rx("ready");
  const light = (v:number, n=7) => {
    for(let i=0;i<n;i++){vi.advanceTimersByTime(100);rx("light "+v);}
  };
  return {hub,rx,lost,writes,light,states};
}
afterEach(async()=>{for(const h of active.splice(0)) await h.stop(); vi.useRealTimers();});

it("sends the discrete code once and confirms only from continuous post-transmission light samples",async()=>{
  const {hub,rx,light,writes}=setup();
  expect(hub.get(id)?.twin.power).toBeUndefined();
  light(750);
  expect(hub.powerStamp(id)?.power).toBe("on");
  const before=hub.powerStamp(id)!.generation;
  const result=hub.command(id,{type:"off"},"automatic-1");
  expect(writes).toEqual(["send "+codes.off]);
  expect((await hub.command(id,{type:"off"},"another")).ok).toBe(false);
  rx("sent "+codes.off);
  light(80,3); light(280,1); light(80,6);
  expect(hub.powerStamp(id)?.command_id).toBeNull();
  light(80,1);
  expect(await result).toMatchObject({ok:true,outcome:"done",state:{twin:{power:"off"}}});
  expect(hub.powerStamp(id)).toEqual({power:"off",generation:before,command_id:"automatic-1"});
  const gen=hub.powerStamp(id)!.generation;
  rx("remote NEC:0004:12");
  expect(hub.powerStamp(id)?.generation).toBe(gen);
  rx("remote "+codes.off);
  expect(hub.powerStamp(id)).toMatchObject({generation:gen+1, command_id:null});
  expect(writes).toHaveLength(1);
});
it("treats repeated handshake replies as harmless and a real board reboot as a loss of confirmation", async () => {
  const {hub,rx,light}=setup();
  light(800);
  const known=hub.powerStamp(id);
  rx("ready");
  expect(hub.powerStamp(id)).toEqual(known);
  const pending=hub.command(id,{type:"off"},"auto");
  rx("boot");
  expect((await pending).ok).toBe(false);
  expect(hub.get(id)?.online).toBe(false);
  rx("ready");
  expect(hub.get(id)?.online).toBe(true);
  expect(hub.powerStamp(id)?.power).toBeNull();
});

it("confirms the result of a discrete off key without claiming that a stale screen was ours to turn off", async () => {
  const {hub,rx,light}=setup();
  light(800);
  vi.advanceTimersByTime(6000);
  const p=hub.command(id,{type:"off"},"automation");
  rx("sent "+codes.off);
  light(50);
  expect((await p).ok).toBe(true);
  expect(hub.powerStamp(id)).toMatchObject({power:"off",command_id:null});
});

it("never transmits a single toggle on the strength of a camera estimate alone", async () => {
  const {hub, rx, writes} = setup({toggle:codes.toggle});
  rx("light none");
  const at = Date.now();
  hub.observe(id, {power:"off"}, at, {power:{seenAt:at,explicit:true}});
  expect(hub.get(id)?.twin.power).toBe("off");
  const request = hub.command(id, {type:"on"});
  vi.advanceTimersByTime(4050);
  expect((await request).ok).toBe(false);
  expect(writes).toEqual([]);
});

it("never guesses or repeats a toggle, including after a timeout",async()=>{
  const {hub,rx,writes,light}=setup({toggle:codes.toggle});
  expect((await hub.command(id,{type:"off"})).ok).toBe(false);
  light(850);
  expect((await hub.command(id,{type:"on"})).ok).toBe(true);
  expect(writes).toEqual([]);
  const p=hub.command(id,{type:"off"},"auto");
  rx("sent "+codes.toggle);
  vi.advanceTimersByTime(4050);
  expect((await p).ok).toBe(false);
  expect((await hub.command(id,{type:"off"})).ok).toBe(false);
  expect(writes).toEqual(["send "+codes.toggle]);
  expect(hub.powerStamp(id)?.command_id).toBeNull();
});
it("uses fresh explicit screen evidence only without a live light sensor",async()=>{
  const {hub,rx,writes,light}=setup();
  const see=(p:string,stamp:number,explicit=true)=>hub.observe(id,{power:p},stamp,{power:{seenAt:stamp,explicit}});
  light(800);
  see("off",Date.now());
  expect(hub.get(id)?.twin.power).toBe("on");
  rx("light none");
  const sent=Date.now();
  const p=hub.command(id,{type:"off"},"auto");
  rx("sent "+codes.off);
  vi.advanceTimersByTime(100);
  see("off",sent-10); see("off",Date.now(),false);
  expect(hub.powerStamp(id)?.command_id).toBeNull();
  vi.advanceTimersByTime(100);
  see("off",Date.now());
  expect(await p).toMatchObject({ok:true,outcome:"done"});
  expect(hub.powerStamp(id)).toMatchObject({power:"off",command_id:"auto"});
  expect(writes).toHaveLength(1);
});
it("accepts two new explicit photos after a manual key even if the earlier VLM streak started before it", () => {
  const {hub,rx}=setup();
  rx("light none");
  const first=Date.now();
  const seen=()=>hub.observe(id,{power:"on"},Date.now(),{power:{seenAt:first,explicit:true}});
  seen();
  vi.advanceTimersByTime(100);
  rx("remote "+codes.on);
  vi.advanceTimersByTime(200);
  seen();
  expect(hub.powerStamp(id)?.power).toBeNull();
  vi.advanceTimersByTime(1100);
  seen();
  expect(hub.powerStamp(id)).toMatchObject({power:"on",command_id:null});
});

it.each(["manual","disconnect","stop"] as const)("interrupts an outstanding send on %s without later claiming it",async(kind)=>{
  const {hub,rx,lost,light,writes}=setup();
  light(800);
  const p=hub.command(id,{type:"off"},"old");
  rx("sent "+codes.off);
  if(kind==="manual") rx("remote "+codes.toggle);
  if(kind==="disconnect") lost();
  if(kind==="stop") await hub.stop();
  expect((await p).ok).toBe(false);
  light(50);
  expect(hub.powerStamp(id)?.command_id).not.toBe("old");
  expect(writes).toHaveLength(1);
});
