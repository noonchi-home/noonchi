import type { PowerStamp } from "../contract/devices.js";
import type { DirectiveResult, GoalIntent, HouseholdOffer } from "../contract/machines.js";

import type { TriggerFacts } from "./triggers.js";

/** 시청 구역이 이만큼(촬영 시각 기준) 이어서 비면 끈다. 떠남 → 다음 촬영(1초) + 2초 + VLM 답(약 1.7초)이 5초 안에 들게(2026-11-21 사용자 결정). */
export const NO_VIEWER_MS = 2000;
/** 시청 구역을 본 사진의 촬영 시각부터 이만큼은 지켜보는 것으로 둔다: 1초 간격 사진 한 장이 처리 한도로 빠져(다음 촬영 2초 뒤)
 *  그 답이 2초 늦게 와도 2초 간격으로 돌아가지 않게. 같은 사진을 다시 평가해도 늘지 않는다. */
export const WATCH_HOLD_MS = 4000;
/** seen: 시청 구역이 지금 유효한 사진에 보인다(빈 자리 판단이 unknown이 아니다). */
export interface ViewerEvidence { empty:boolean; watch:boolean; photo:number|null; seen:boolean }
export function viewerAt(facts:TriggerFacts | null,id:string,now:number):ViewerEvidence {
  const room=facts?.tvRooms?.get(id);
  if (!room || facts?.photoValidUntil == null || now > facts.photoValidUntil) return {empty:false,watch:false,photo:null,seen:false};
  const empty=facts.read({kind:"noViewer",room,ms:NO_VIEWER_MS});
  const watch=facts.read({kind:"postureAttention",posture:"seated",target:id});
  return {empty:empty.value===true,watch:watch.value===true,photo:empty.observed_ms,seen:empty.value!=="unknown"};
}
interface Pending {
  offer:HouseholdOffer; power:"on"|"off"; generation:number; successAt:number|null;
}
interface Screen {
  stamp:PowerStamp; pending:Pending|null; owner:{id:string; generation:number; at:number}|null;
  attempted:"on"|"off"|null; seen:boolean; seenAt:number|null;
}

/** The goal node owns this memory for one boot. A manual generation always invalidates an older command. */
export class TvWatch {
  private readonly screens=new Map<string,Screen>();
  private serial=0;
  constructor(private readonly send:(intent:GoalIntent)=>void) {}

  observe(id:string,stamp:PowerStamp) {
    const screen=this.screens.get(id);
    if (!screen) {
      this.screens.set(id,{stamp,pending:null,owner:null,attempted:null,seen:false,seenAt:null});
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

  /** 관찰 흐름이 VLM 사진 간격을 1초로 줄일 때인가(src/server/home/observe.ts vlmFast): 시청 구역이 보이고(그 사진 촬영 뒤 WATCH_HOLD_MS 안),
   *  켜진 TV이거나 우리가 끈 TV(다시 켤 차례)다. */
  /** 끌 일(켜진 TV)이나 다시 켤 일(우리가 끈 TV)이 있는가. 없으면 새 집 사진마다 조건을 다시 매길 까닭이 없다(src/server/home/observe.ts onPhoto). */
  armed():boolean {
    return [...this.screens.values()].some(s=>s.stamp.power==="on" || s.owner!==null);
  }

  watching():boolean {
    return [...this.screens.values()].some(s=>s.seen && (s.stamp.power==="on" || s.owner!==null));
  }

  tick(id:string,e:ViewerEvidence,rev:number,now:number) {
    const s=this.screens.get(id);
    if (!s) return;
    if (e.seen && e.photo!==null) s.seenAt=Math.max(s.seenAt ?? -Infinity,e.photo);
    s.seen=s.seenAt!==null && now-s.seenAt<=WATCH_HOLD_MS;
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
