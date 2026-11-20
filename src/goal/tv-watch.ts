import type { PowerStamp } from "../contract/devices.js";
import type { DirectiveResult, GoalIntent, HouseholdOffer } from "../contract/machines.js";

import type { TriggerFacts } from "./triggers.js";

export interface ViewerEvidence { empty:boolean; watch:boolean; photo:number|null }
export function viewerAt(facts:TriggerFacts | null,id:string,now:number):ViewerEvidence {
  const room=facts?.tvRooms?.get(id);
  if (!room || facts?.photoValidUntil == null || now > facts.photoValidUntil) return {empty:false,watch:false,photo:null};
  const empty=facts.read({kind:"noViewer",room,ms:4000});
  const watch=facts.read({kind:"postureAttention",posture:"seated",target:id});
  return {empty:empty.value===true,watch:watch.value===true,photo:empty.observed_ms};
}
interface Pending {
  offer:HouseholdOffer; power:"on"|"off"; generation:number; successAt:number|null;
}
interface Screen {
  stamp:PowerStamp; pending:Pending|null; owner:{id:string; generation:number; at:number}|null;
  attempted:"on"|"off"|null;
}

/** The goal node owns this memory for one boot. A manual generation always invalidates an older command. */
export class TvWatch {
  private readonly screens=new Map<string,Screen>();
  private serial=0;
  constructor(private readonly send:(intent:GoalIntent)=>void) {}

  observe(id:string,stamp:PowerStamp) {
    const screen=this.screens.get(id);
    if (!screen) {
      this.screens.set(id,{stamp,pending:null,owner:null,attempted:null});
      return;
    }
    if (stamp.generation<screen.stamp.generation) return;
    if (stamp.generation!==screen.stamp.generation) {
      this.withdraw(screen);
      screen.owner=null;
    }
    screen.stamp=stamp;
    if (screen.owner && (stamp.power!=="off" || stamp.command_id!==screen.owner.id)) screen.owner=null;
    this.confirm(screen);
  }

  private confirm(screen:Screen) {
    const p=screen.pending, s=screen.stamp;
    if (!p || p.successAt===null || s.command_id!==p.offer.id || s.generation!==p.generation || s.power!==p.power) return;
    screen.owner=p.power==="off" ? {id:p.offer.id,generation:s.generation,at:p.successAt} : null;
    screen.pending=null;
  }

  private desired(s:Screen,e:ViewerEvidence) {
    if (s.stamp.power==="on" && e.empty) return "off";
    if (s.stamp.power==="off" && s.owner && e.watch && e.photo!==null && e.photo>s.owner.at) return "on";
    return null;
  }

  permits(job:HouseholdOffer,e:ViewerEvidence,current:PowerStamp|undefined,now:number) {
    const s=this.screens.get(job.target_id), p=s?.pending;
    return !!(s && p && current && p.offer.id===job.id && p.generation===current.generation &&
      s.stamp.command_id===current.command_id && s.stamp.power===current.power && now<job.until_ms &&
      this.desired(s,e)===p.power);
  }

  tick(id:string,e:ViewerEvidence,rev:number,now:number) {
    const s=this.screens.get(id);
    if (!s) return;
    const want=this.desired(s,e);
    const p=s.pending;
    if (p && (now>=p.offer.until_ms || (want!==p.power && p.successAt===null &&
        s.stamp.power!==p.power))) this.withdraw(s);
    if (!s.pending && !want) s.attempted=null;
    if (s.pending || !want || s.attempted===want) return;
    const offer:HouseholdOffer={id:"tv:"+ ++this.serial,kind:want==="on"?"tv_on":"tv_off",
      target_id:id,rev,goal_id:null,until_ms:now+5000};
    s.pending={offer,power:want,generation:s.stamp.generation,successAt:null};
    s.attempted=want;
    this.send({...offer,op:"offer"});
  }

  result(r:DirectiveResult) {
    const s=this.screens.get(r.target_id), p=s?.pending;
    if (!s || !p || p.offer.id!==r.id) return;
    if (r.outcome!=="applied" || r.command_id!==r.id || r.expected_power!==p.power ||
        r.at_ms>=p.offer.until_ms || r.evidence_rev<p.offer.rev) {s.pending=null;return;}
    p.successAt=r.at_ms;
    this.confirm(s);
  }
  revoked(id:string) {
    for (const s of this.screens.values()) if (s.pending?.offer.id===id) s.pending=null;
  }
  private withdraw(s:Screen) {
    const p=s.pending;
    if (p) this.send({op:"withdraw",id:p.offer.id,rev:p.offer.rev});
    s.pending=null;
  }
}
