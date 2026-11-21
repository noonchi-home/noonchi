import { HOUSEHOLD_KINDS } from "../devices/kinds.js";
import type { DirectiveResult, GoalIntent, HouseholdAction } from "../contract/machines.js";
import type { StationMap, Station } from "../contract/stations.js";
import type { Vec2 } from "../contract/layout.js";
import type { TriggerFacts } from "./triggers.js";

type Trail=TriggerFacts["trail"];
type Portal={rooms:[string,string];point:Vec2};
type Choice={kind:"one";id:string}|{kind:"ambiguous";ids:string[]}|{kind:"none"};

/** For another room, compare the first door on a shortest route. Tied first doors stay ambiguous. */
function firstDoors(room:string, portals:Portal[]) {
  const first=new Map<string,Vec2[]>([[room,[]]]), distances=new Map([[room,0]]);
  const queue=[room];
  for (const at of queue) {
    const depth=distances.get(at)!+1;
    for (const p of portals) {
      const other=p.rooms[0]===at?p.rooms[1]:p.rooms[1]===at?p.rooms[0]:null;
      if (!other || (distances.get(other)??Infinity)<depth) continue;
      const points=at===room?[p.point]:first.get(at)!;
      if (!first.has(other)) { queue.push(other);first.set(other,[]);distances.set(other,depth); }
      for (const point of points) if (!first.get(other)!.includes(point)) first.get(other)!.push(point);
    }
  }
  return first;
}
function observedPoints(station:Station,map:StationMap):Vec2[] {
  const zones=map.zones.filter(z=>station.observes_zone_ids.includes(z.id));
  return zones.length ? zones.map(z=>z.polygon.reduce<Vec2>((sum,p)=>
    [sum[0]+p[0]/z.polygon.length,sum[1]+p[1]/z.polygon.length],[0,0])) : [station.look_at];
}
export function selectSearchStation(trail:Trail,map:StationMap,visited:string[],portals:Portal[]):Choice {
  const last=trail.at(-1), prev=trail.at(-2);
  const doors=last?.room ? firstDoors(last.room,portals) : null;
  const places=map.stations.filter(s=>s.roles.includes("standby") && !visited.includes(s.id) && (!doors || doors.has(s.room)));
  if (!places.length) return {kind:"none"};
  if (places.length===1) return {kind:"one",id:places[0]!.id};
  const unclear:Choice={kind:"ambiguous",ids:places.map(s=>s.id)};
  if (!prev || !last || last.at_ms<=prev.at_ms || last.at_ms-prev.at_ms>5000) return unclear;
  const dx=last.position[0]-prev.position[0], dz=last.position[1]-prev.position[1], length=Math.hypot(dx,dz);
  if (length<0.15) return unclear;
  const angle=(p:Vec2)=>{
    const x=p[0]-last.position[0], z=p[1]-last.position[1], distance=Math.hypot(x,z);
    return distance<0.05 ? Math.PI : Math.acos(Math.max(-1,Math.min(1,(dx*x+dz*z)/(length*distance))));
  };
  const ranked=places.map(s=>({id:s.id,angle:Math.min(...(s.room===last.room?observedPoints(s,map):doors?.get(s.room)??[]).map(angle))}))
    .sort((a,b)=>a.angle-b.angle);
  return ranked[0]!.angle<=Math.PI/3 && ranked[1]!.angle-ranked[0]!.angle>Math.PI/12 ? {kind:"one",id:ranked[0]!.id} : unclear;
}

export interface CheckingVisit {id:string;since:number;until:number}
export interface WatchInput {
  now:number; rev:number; map:StationMap|null; facts:TriggerFacts;
  checking:CheckingVisit|null; personSeen:boolean; cupSeen:boolean;
}
type Offer=Extract<GoalIntent,{op:"offer"}>;
const VISIT_MS=30_000;
const DOOR={kind:"device",deviceKind:HOUSEHOLD_KINDS.mealDoor,attr:"door",value:"open",mode:"edge"} as const;

/** A single trip or observer selection at a time. Trips never issue a phone command from goal. */
export class RoomWatch {
  private serial=0;
  private pending:Offer|null=null;
  private goal:string|null=null;
  private ended=false;
  private visited:string[]=[];
  private selected:string|null=null;
  private arrived:{id:string;at:number;until:number}|null=null;
  /** 목표 없이 간 관찰 자리에 도착한 때(냉장고 → 주방 입구 뒤 식탁 관찰 자리로 넘길 때 쓴다). */
  private watching:{id:string;at:number}|null=null;
  private attempted="";
  private mealAt:number|null=null;
  private doorAt:number|null=null;
  private busy=false;
  constructor(private readonly send:(i:GoalIntent)=>void,private readonly portals:Portal[]) {}

  needsPhoto(kitchenEntry:string|null):boolean {
    return this.pending?.kind==="visit" || !!this.arrived || (!!kitchenEntry && this.watching?.id===kitchenEntry);
  }

  private withdraw() {
    if (this.pending) this.send({op:"withdraw",id:this.pending.id,rev:this.pending.rev});
    this.pending=null;this.selected=null;
  }
  /** 그만·비상·바쁨·요청: 내놓은 방문을 거두고, 목표 없이 간 자리의 도착도 잊는다(멈춘 뒤 다른 곳 사진으로 식탁 관찰 자리로 다시 가지 않게). */
  interrupt() { this.withdraw();this.ended=true;this.watching=null; }

  private missed(job:Offer) {
    if (job.kind==="visit" && job.goal_id!==null && job.goal_id===this.goal && !this.visited.includes(job.target_id))
      this.visited.push(job.target_id);
  }
  setBusy(busy:boolean) { this.busy=busy;if (busy) this.interrupt(); }
  revoked(id:string,now:number) {
    const job=this.pending;
    if(job?.id!==id) return;
    this.pending=null;this.selected=null;
    if(now>=job.until_ms) this.missed(job);
    else this.ended=true;
  }
  result(result:DirectiveResult) {
    const job=this.pending;
    if (!job || job.id!==result.id || result.evidence_rev<job.rev) return;
    if (job.kind==="choose_station" && result.evidence_rev!==job.rev && result.outcome==="selected") return;
    if (job.kind==="visit" && result.target_id!==job.target_id) return;
    this.pending=null;
    if (job.goal_id===null && job.kind==="visit" && result.outcome==="arrived") this.watching={id:job.target_id,at:result.at_ms};
    if (job.goal_id===null || this.ended || this.goal!==job.goal_id) return;
    if (result.outcome==="cancelled") {this.ended=true;return;}
    if (result.at_ms>=job.until_ms || result.outcome==="failed" || result.outcome==="unknown") {this.missed(job);return;}
    if (job.kind==="choose_station" && result.outcome==="selected" && job.candidates.includes(result.target_id))
      this.selected=result.target_id;
    else if (job.kind==="visit" && result.outcome==="arrived") {
      this.visited.push(job.target_id);
      this.arrived={id:job.target_id,at:result.at_ms,until:job.until_ms};
    }
  }

  tick(input:WatchInput) {
    const {checking,map,facts,rev,now}=input;
    if (this.goal!==(checking?.id??null)) {
      this.interrupt();this.goal=checking?.id??null;this.ended=false;this.visited=[];this.arrived=null;this.attempted="";this.watching=null;
    }
    const door=facts.read(DOOR), meal=facts.mealSeated;
    const opened=door.value===true && door.observed_ms!==this.doorAt;
    const seated=meal.value===true && meal.observed_ms!==this.mealAt;
    if (opened) this.doorAt=door.observed_ms;
    if (seated) this.mealAt=meal.observed_ms;
    if (this.busy || (checking && now>=checking.until)) {this.interrupt();return;}
    if (checking && input.personSeen) {
      this.withdraw();
      this.attempted="";
      this.arrived=null;
      return;
    }
    if (!map) {this.withdraw();return;}
    if (this.pending && now>=this.pending.until_ms) {this.missed(this.pending);this.withdraw();}
    const offer=(target_id:string,action:HouseholdAction)=>{
      if (this.pending) this.withdraw();
      this.pending={...action,op:"offer",id:"visit:"+ ++this.serial,target_id,rev,goal_id:this.goal,until_ms:Math.min(now+VISIT_MS,checking?.until??Infinity)};
      this.send(this.pending);
    };
    if (!checking) {
      // 주방 입구는 냉장고를 봐 식탁이 등 뒤다: 도착 뒤 찍은 사진에 사람이 없으면(냉장고 앞을 떠남) 식탁 관찰 자리로 간다
      const left=!opened && this.watching?.id===map.kitchen_entry && facts.seesNobody(this.watching.id,this.watching.at);
      if (left) this.watching=null;
      const id=seated?map.meal_watch:opened?map.kitchen_entry:left?map.meal_watch:null;
      if (id) offer(id,{kind:"visit"});
      return;
    }

    const trail=facts.trail.filter(p=>p.at_ms>=checking.since-5000 && p.at_ms<=now);
    const key=JSON.stringify([trail,this.visited]);
    if ((this.pending?.kind==="choose_station" || this.selected) && this.attempted!==key) {
      this.withdraw();
    }
    if (this.ended || this.pending || (!this.attempted && !input.cupSeen && now-checking.since<3000)) return;
    if (this.arrived) {
      if (now<this.arrived.until && !facts.observes(this.arrived.id,this.arrived.at)) return;
      this.arrived=null;
    }
    if (this.selected) {
      const id=this.selected;this.selected=null;
      if (map.stations.some(s=>s.id===id)) offer(id,{kind:"visit"});
      return;
    }
    if (this.attempted===key) return;
    this.attempted=key;
    const choice=selectSearchStation(trail,map,this.visited,this.portals);
    if (choice.kind==="one") offer(choice.id,{kind:"visit"});
    if (choice.kind==="ambiguous") {
      const direction=trail.map(t=>({room:t.room,position:t.position}));
      offer(choice.ids[0]!,{kind:"choose_station",candidates:choice.ids,direction:JSON.stringify(direction),visited:[...this.visited]});
    }
  }
}
