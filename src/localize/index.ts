import { photoConflict } from "../shared/photo-alignment.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { BusNode, TOPICS, type Body } from "../bus/index.js";
import type { EngineFrame } from "../contract/observe.js";
import type { FrameHeader } from "../phone/index.js";

export type Localized = Body<"/perception/localized">;
type Position = NonNullable<Localized["position"]>;
type Fit = {position:Position; yaw_deg:number; pitch_deg:number; matches:number; rms_px:number; confidence:number};
type Item = {frame:EngineFrame; header:FrameHeader; done:(value:Position|null)=>void};
export function agrees(r:Localized):boolean {
  return r.position !== null && r.ar_gap_m !== null && r.ar_gap_deg !== null && !photoConflict(r.ar_gap_m,r.ar_gap_deg);
}

function direction(yaw:number, pitch:number) {
  const a=yaw*Math.PI/180, b=pitch*Math.PI/180;
  return [Math.cos(b)*Math.cos(a), Math.sin(b), Math.cos(b)*Math.sin(a)] as const;
}

export function resultFor(frame:EngineFrame, fit:Fit|null, revision:string|null):Localized {
  let meters:number|null=null, degrees:number|null=null;
  const eye=frame.eye;
  if (fit && eye && frame.view) {
    meters=Math.hypot(fit.position[0]-eye.position[0],fit.position[1]-eye.height_m,fit.position[2]-eye.position[1]);
    const a=direction(fit.yaw_deg,fit.pitch_deg), b=direction(eye.yaw_deg,eye.pitch_deg);
    degrees=Math.acos(Math.max(-1,Math.min(1,a[0]*b[0]+a[1]*b[1]+a[2]*b[2])))*180/Math.PI;
  }
  return {frame_id:frame.id, captured_ms:frame.capturedAtMs, map_rev:revision, ar_gap_m:meters, ar_gap_deg:degrees,
    ...(fit ?? {position:null, yaw_deg:null, pitch_deg:null, matches:0, rms_px:null, confidence:0})};
}

class Worker {
  private child?:ChildProcessWithoutNullStreams;
  private answer?: (fit:Fit|null)=>void;
  private ready?:Promise<boolean>;
  private retryAfter=0;
  private stopped=false;
  revision:string|null=null;
  references=0;
  constructor(private python:string, private map:string, private home:string, private log:(s:string)=>void,
    private bucket?:string) {}

  open():Promise<boolean> {
    if (this.stopped || Date.now()<this.retryAfter) return Promise.resolve(false);
    if (this.ready) return this.ready;
    const args=["-B", "localize/worker.py", "serve", "--home",this.home,"--map",this.map];
    if(this.bucket) args.push("--bucket", this.bucket);
    const child=spawn(this.python,args,{windowsHide:true,stdio:"pipe"});
    this.child=child;
    this.ready=new Promise<boolean>(resolve=>{
      const lines=createInterface({input:child.stdout});
      const cleanup=()=>{
        clearTimeout(timer);
        resolve(false);
        if (this.child!==child) return;
        this.retryAfter=Date.now()+5000;
        this.child=undefined;
        this.ready=undefined;
        this.references=0;
        this.revision=null;
        this.answer?.(null);
        this.answer=undefined;
      };
      const timer=setTimeout(()=>child.kill(),15_000);
      child.stdin.on("error",()=>child.kill());
      child.once("error",e=>{this.log(e.message);cleanup();});
      child.once("close",cleanup);
      child.stderr.on("data",d=>this.log(String(d).trim()));
      lines.on("line",line=>{
        if(this.child!==child) return;
        try {
          const msg=JSON.parse(line);
          if(msg.ready && typeof msg.map_rev==="string" && Number.isInteger(msg.references)){
            this.revision=msg.map_rev;this.references=msg.references;clearTimeout(timer);resolve(true);
          } else { this.answer?.(msg.result ?? null); this.answer=undefined; }
        } catch { child.kill(); }
      });
    });
    return this.ready;
  }

  async solve({frame,header}:Item):Promise<Fit|null> {
    if(header.projection?.length!==16 || !await this.open() || !this.child) return null;
    const child=this.child;
    return new Promise(resolve=>{
      const timer=setTimeout(()=>child.kill(),2000);
      this.answer=fit=>{clearTimeout(timer);resolve(fit);};
      child.stdin.write(JSON.stringify({width:frame.width,height:frame.height,projection:header.projection,jpeg:frame.jpeg.toString("base64")})+"\n");
    });
  }
  close() { this.stopped=true; this.child?.kill(); }
}

export class PhotoLocalizer {
  private active?:Item;
  private pending?:Item;
  private solving=false;
  private timer?:ReturnType<typeof setTimeout>;
  private closed=false;
  last:Localized|null=null;
  constructor(private publisher:BusNode, private node:BusNode,
    private worker:Pick<Worker,"revision"|"references"|"solve"|"close">, log:(s:string)=>void) {
    node.on("/perception/localize",async request=>{
      const item=this.active;
      if (!item || this.solving || item.frame.id!==request.frame_id || item.frame.capturedAtMs!==request.captured_ms) return;
      this.solving=true;
      try {
        const fit=await this.worker.solve(item);
        if(this.active!==item || this.closed) return;
        const parsed=TOPICS["/perception/localized"].body.safeParse(resultFor(item.frame,fit,this.worker.revision));
        await node.publish("/perception/localized",parsed.success ? parsed.data : resultFor(item.frame,null,this.worker.revision));
      } catch(e) { log(String(e)); this.finish(item,null); }
      finally { this.solving=false; }
    });
  }
  status(){ return {map_rev:this.worker.revision,references:this.worker.references,last:this.last}; }
  request(frame:EngineFrame, header:FrameHeader):Promise<Position|null> {
    if(this.closed) return Promise.resolve(null);
    return new Promise(done=>{
      const item={frame,header,done};
      if(this.active) { this.pending?.done(null);this.pending=item; }
      else this.dispatch(item);
    });
  }
  private dispatch(item:Item) {
    this.active=item;
    this.timer=setTimeout(()=>this.finish(item,null),20_000);
    void this.publisher.publish("/perception/localize",{frame_id:item.frame.id,captured_ms:item.frame.capturedAtMs}).catch(()=>this.finish(item,null));
  }
  receive(r:Localized, accept:(h:FrameHeader,r:Localized)=>boolean) {
    const item=this.active;
    if(!item || item.frame.id!==r.frame_id || item.frame.capturedAtMs!==r.captured_ms) return;
    this.last=r;
    const current=accept(item.header,r);
    this.finish(item,current && agrees(r) ? r.position : null);
  }
  private finish(item:Item,value:Position|null) {
    if(this.active!==item) return;
    clearTimeout(this.timer);
    this.active=undefined;
    item.done(value);
    const next=this.pending; this.pending=undefined;
    if(next && !this.closed) this.dispatch(next);
  }
  async close(){
    this.closed=true;
    this.pending?.done(null);
    this.pending=undefined;
    if(this.active) this.finish(this.active,null);
    this.worker.close();
    await this.node.stop();
  }
}

export async function openLocalizer(publisher:BusNode, options:ConstructorParameters<typeof BusNode>[0],
  home:string,runtimeDir:string,env:Record<string,string|undefined>,log:(s:string)=>void) {
  const map=env.LOCALIZE_MAP ?? join(runtimeDir,"homes",home,"localize","map.npz");
  if(!env.LOCALIZE_MAP && !env.LOCALIZE_BUCKET && !existsSync(map)) return null;
  const venv=join(runtimeDir,"localize-venv",process.platform==="win32"?"Scripts/python.exe":"bin/python");
  const node=new BusNode(options);
  const worker=new Worker(env.LOCALIZE_PYTHON ?? (existsSync(venv)?venv:"python"),map,home,log,env.LOCALIZE_BUCKET);
  const localizer=new PhotoLocalizer(publisher,node,worker,log);
  await node.prepare();
  node.start();
  void worker.open();
  return localizer;
}
