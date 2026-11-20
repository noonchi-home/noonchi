import type { DirectiveResult, HouseholdOffer, ManagerDirective } from "../../contract/machines.js";

import type { TrackCore } from "../track/core.js";
import { eyeNow, idleLine, phoneBlocked, sendLine, type IdleSlot } from "./phone-line.js";
import { josa } from "../../shared/korean.js";

export function visitPhoneBusy(core:TrackCore) {
  return phoneBlocked(core,core.clock.now(),!!core.open()?.asking) || !!(core.finding || core.idlePeek || core.docking || core.notice);
}
const ARRIVAL_M=0.5;
export function stationDirectives(core:TrackCore) {
  let slot:IdleSlot|null=null;
  const port=core.o.stations;
  return new DirectiveRunner({
    now:()=>core.clock.now(), rev:()=>port?.rev() ?? 0,
    blocked:job=>{
      const ctx=core.start.context();
      return core.stopped || ctx.emergency || !!ctx.requested ||
        (job.kind==="visit" && (!!ctx.activeAction || visitPhoneBusy(core)));
    },
    visit:job=>{
      const station=port?.target(job.target_id);
      if (!station) return false;
      slot={id:job.id,sent:null,spokeAt:0,visionAt:0};
      sendLine(idleLine(core,slot),{type:"command",id:job.id,step:job.id+":go",kind:"go",near_m:ARRIVAL_M,
        text:josa(station.label,"으로/로")+" 이동해 주세요.",choices:[],speak:true,vision:null,target:station},core.clock.now());
      return true;
    },
    clear:id=>{ if (slot?.id===id) { idleLine(core,slot).clear();slot=null; } },
    arrived:job=>{
      const eye=eyeNow(core,core.clock.now()), target=port?.target(job.target_id);
      return !!(eye && target && Math.hypot(eye.position[0]-target.position[0],eye.position[1]-target.position[2])<=ARRIVAL_M);
    },
    result:r=>port?.result(r),
  });
}
interface DirectivePort {
  now():number;
  rev():number;
  blocked(job:HouseholdOffer):boolean;
  visit(job:HouseholdOffer):boolean;
  arrived(job:HouseholdOffer):boolean;
  clear(id:string):void;
  result(result:DirectiveResult):void;
}

/** One runner per home epoch. Only the actor owns the phone command and the terminal result. */
export class DirectiveRunner {
  private readonly active=new Map<string,HouseholdOffer>();
  private readonly finished=new Set<string>();
  private displayed:string|null=null;
  private closed=false;
  constructor(private readonly port:DirectivePort) {}

  receive(message:ManagerDirective) {
    if (this.closed) return;
    if (message.op==="revoke") {
      this.cancel(message.id);
      this.finished.add(message.id); // A grant may still be waiting for its world revision.
      return;
    }
    if (this.active.has(message.id) || this.finished.has(message.id)) return;
    this.active.set(message.id,message);
    if (this.blocked(message)) this.finish(message,"cancelled");
    else if (message.kind==="visit") {
      if (this.port.arrived(message)) this.finish(message,"arrived");
      else if (!this.port.visit(message)) this.finish(message,"unknown");
      else this.displayed=message.id;
    } else this.finish(message,"unknown");
  }

  private blocked(job:HouseholdOffer) {
    return this.port.now()>=job.until_ms || this.port.blocked(job);
  }
  tick() {
    for (const job of this.active.values()) {
      if (this.blocked(job)) this.finish(job,"cancelled");
      else if (job.kind==="visit" && this.port.arrived(job)) this.finish(job,"arrived");
    }
  }
  cancel(id?:string) {
    let cancelled=false;
    for (const job of this.active.values()) if (!id || job.id===id) {
      this.finish(job,"cancelled");
      cancelled=true;
    }
    return cancelled;
  }
  close() { this.cancel(); this.closed=true; this.finished.clear(); }
  private finish(job:HouseholdOffer,outcome:Exclude<DirectiveResult["outcome"],"applied">) {
    if (!this.active.delete(job.id)) return;
    this.finished.add(job.id);
    if (this.displayed===job.id) { this.displayed=null; this.port.clear(job.id); }
    this.port.result({id:job.id,target_id:job.target_id,at_ms:this.port.now(),evidence_rev:this.port.rev(),outcome});
  }
}
