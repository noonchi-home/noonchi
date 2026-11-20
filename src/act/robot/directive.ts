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
    personSeen:()=>core.o.state.view().person.visible,
    blocked:job=>{
      const ctx=core.start.context();
      return core.stopped || ctx.emergency || !!ctx.requested ||
        (job.kind==="choose_station" && (!!ctx.activeAction || ctx.docking || !!core.o.phone.talking?.())) ||
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
    shown:id=>slot?.id===id && core.robot.commands.shows(id) ? slot.sent : null,
    clear:id=>{ if (slot?.id===id) { idleLine(core,slot).clear();slot=null; } },
    arrived:job=>{
      const eye=eyeNow(core,core.clock.now()), target=port?.target(job.target_id);
      return !!(eye && target && Math.hypot(eye.position[0]-target.position[0],eye.position[1]-target.position[2])<=ARRIVAL_M);
    },
    tv:async(job,stillActive)=>{
      const live=()=>stillActive() && port?.tvAllowed?.(job)===true;
      const runner=core.o.appliances.run;
      if (!runner || !live()) return false;
      const power=job.kind==="tv_on" ? "on" : "off";
      const result=await runner.run(power==="on" ? "turn_on" : "turn_off",job.target_id,{},live,job.id);
      return result.ok && !result.unverified && typeof result.state==="object" && result.state?.power===power;
    },
    choose:(job,signal)=>port?.choose?.(job,signal) ?? Promise.resolve(null),
    result:r=>port?.result(r),
  });
}
interface DirectivePort {
  now():number;
  rev():number;
  blocked(job:HouseholdOffer):boolean;
  personSeen?():boolean;
  visit(job:HouseholdOffer):boolean;
  arrived(job:HouseholdOffer):boolean;
  shown?(id:string):import("../../contract/phone.js").PlannedCommand|null;
  clear(id:string):void;
  choose?(job:Extract<HouseholdOffer,{kind:"choose_station"}>,signal:AbortSignal):Promise<string|null>;
  tv?(job:HouseholdOffer,live:()=>boolean):Promise<boolean>;
  result(result:DirectiveResult):void;
}

/** One runner per home epoch. Only the actor owns the phone command and the terminal result. */
export class DirectiveRunner {
  private readonly active=new Map<string,HouseholdOffer>();
  private readonly finished=new Set<string>();
  private selections=new Map<string,AbortController>();
  private displayed:string|null=null;
  private closed=false;
  constructor(private readonly port:DirectivePort) {}

  shown() { return this.displayed ? this.port.shown?.(this.displayed) ?? null : null; }

  receive(message:ManagerDirective) {
    if (this.closed) return;
    if (message.op==="revoke") {
      const job = this.active.get(message.id);
      if (job) this.finish(job,this.interruption(job) ?? "cancelled");
      this.finished.add(message.id); // A grant may still be waiting for its world revision.
      return;
    }
    if (this.active.has(message.id) || this.finished.has(message.id)) return;
    this.active.set(message.id,message);
    const stop = this.interruption(message);
    if (stop) this.finish(message,stop);
    else if (message.kind==="visit") {
      if (this.port.arrived(message)) this.finish(message,"arrived");
      else if (!this.port.visit(message)) this.finish(message,"unknown");
      else this.displayed=message.id;
    } else if (message.kind==="choose_station" && this.port.choose) {
      const abort=new AbortController();
      this.selections.set(message.id,abort);
      void this.port.choose(message,abort.signal).then(id=>{
        if (abort.signal.aborted) return;
        const stop = this.interruption(message);
        if (stop) this.finish(message,stop);
        else if (id && message.candidates.includes(id)) this.finish(message,"selected",id);
        else this.finish(message,"unknown");
      },()=>this.finish(message,"unknown"));
    } else if ((message.kind==="tv_on" || message.kind==="tv_off") && this.port.tv) {
      const live=()=>this.active.has(message.id) && !this.interruption(message);
      void this.port.tv(message,live).then(ok=>{
        if (!ok || !live()) return this.finish(message,"failed");
        if (!this.active.delete(message.id)) return;
        this.finished.add(message.id);
        this.port.result({id:message.id,target_id:message.target_id,at_ms:this.port.now(),evidence_rev:this.port.rev(),
          outcome:"applied",command_id:message.id,expected_power:message.kind==="tv_on" ? "on" : "off"});
      },()=>this.finish(message,"failed"));
    } else this.finish(message,"unknown");
  }

  private interruption(job:HouseholdOffer) {
    if (this.port.blocked(job)) return "cancelled";
    if (this.port.now() >= job.until_ms || (job.goal_id && this.port.personSeen?.())) return "unknown";
    return null;
  }
  tick() {
    for (const job of this.active.values()) {
      const stop = this.interruption(job);
      if (stop) this.finish(job,stop);
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
  private finish(job:HouseholdOffer,outcome:Exclude<DirectiveResult["outcome"],"applied">,target=job.target_id) {
    if (!this.active.delete(job.id)) return;
    this.finished.add(job.id);
    this.selections.get(job.id)?.abort();this.selections.delete(job.id);
    if (this.displayed===job.id) { this.displayed=null; this.port.clear(job.id); }
    this.port.result({id:job.id,target_id:target,at_ms:this.port.now(),evidence_rev:job.kind==="choose_station"?job.rev:this.port.rev(),outcome});
  }
}
