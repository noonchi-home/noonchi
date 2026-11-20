import type { DecisionRecord } from "../contract/events.js";
import type { Vec2 } from "../contract/layout.js";
import type { Trigger, TriggerFact } from "../contract/machines.js";
import type { StationMap, Zone } from "../contract/stations.js";
import type { HouseholdPhoto, WorldDevice, WorldView } from "../contract/world.js";
import { becameKey, inView } from "../world/index.js";
import { DEVICE_STATES } from "../world/vocab.js";

const MAX_PHOTO_GAP_MS = 2500;
const EDGE_MARGIN_M = 0.1;
const fact = (value: TriggerFact["value"], observed_ms: number | null = null, rev: number | null = null): TriggerFact => ({value, observed_ms, rev});
type ZoneOf = (map: StationMap, room: string | null, p: Vec2 | null, margin: number) => string | null;
type Decision = Pick<DecisionRecord,"seq"|"request_rev"|"atMs"|"status"|"fsm"|"late"|"source"|"memoryVersion">;

export interface TriggerFacts {
  read(trigger: Trigger): TriggerFact;
  mealSeated: TriggerFact;
  trail: NonNullable<WorldView["person_trail"]>;
}

function deviceFact(devices: WorldDevice[], t: Extract<Trigger,{kind:"device"}>, rev:number, changed: Map<string,Set<string>>) {
  const candidates = devices.filter(d=>d.kind === t.deviceKind && (!t.id || d.id === t.id));
  const d = candidates.length === 1 ? candidates[0] : null;
  const key = becameKey(t.attr,t.value);
  if (!d?.status || !key) return fact("unknown");
  const attr = [...d.history].reverse().find(row => row.attr === t.attr);
  const time = attr?.seen_ms ?? attr?.at_ms ?? d.changed_ms;
  if (t.mode === "edge") {
    const edge = [...d.history].reverse().find(row=>row.attr===t.attr && row.from!==row.to);
    return fact(!!changed.get(d.id)?.has(t.attr) && !!edge && edge.from != null && edge.explicit !== false && edge.to===t.value && d.state.includes(key), edge?.seen_ms ?? edge?.at_ms ?? time, rev);
  }
  if (!d.state.some(s => DEVICE_STATES[s].attr === t.attr)) return fact("unknown");
  return fact(d.state.includes(key),time,rev);
}

/** One instance per home. Timers can expire evidence, but only a distinct camera capture can extend it. */
export class GoalTriggers {
  private photo: HouseholdPhoto | undefined;
  private photoRev = 0;
  private map: StationMap | null = null;
  private vacantSince = new Map<string,number>();
  private mealSetup: {at:number;cup:string;surface:string} | null = null;
  private mealSeated = fact("unknown");
  private previousSeated: boolean | null = null;
  private deviceTimes = new Map<string,Map<string,number>>();
  private seq = 0;
  private state: string | null = null;
  private memoryVersion: number | undefined;
  private entered: string | null = null;
  private transition = fact("unknown");

  constructor(private readonly zoneOf: ZoneOf, private readonly floor: (p:Vec2)=>number) {}

  decision(d: Decision) {
    if (d.source === "speech" || d.seq <= this.seq) return;
    this.seq = d.seq;
    if (d.late || d.status !== "valid" || !d.fsm || d.request_rev == null) return;
    const comparable = this.state !== null && this.memoryVersion === d.memoryVersion;
    this.entered = comparable && this.state !== d.fsm.state ? d.fsm.state : null;
    this.transition = fact(comparable ? !!this.entered : "unknown",d.atMs,d.request_rev);
    this.state = d.fsm.state;
    this.memoryVersion = d.memoryVersion;
  }

  evaluateTriggers(view: WorldView, rev:number, map: StationMap | null, now:number): TriggerFacts {
    const photo = view.household_photo;
    if (this.map !== map) {
      this.map = map;
      this.vacantSince.clear();
      this.photo = undefined;
      this.mealSetup = null;
      this.previousSeated = null;
      this.mealSeated = fact("unknown");
    }
    const changedDevices = this.changedDevices(view.devices);
    const tvs = view.devices.filter(d=>d.kind==="tv");
    const watches = new Map<string,{tv:string; zones:Zone[]}>();
    if (map) for (const tv of tvs) {
      const ids = new Set(map.stations.filter(s=>s.roles.includes("observe") && s.surfaces.includes(tv.id)).flatMap(s=>s.observes_zone_ids));
      const zones = map.zones.filter(z=>ids.has(z.id));
      const rooms = new Set(zones.map(z=>z.room));
      for (const room of rooms) {
        const previous = watches.get(room);
        watches.set(room, previous ? {tv:"",zones:[]} : {tv:tv.id,zones:zones.filter(z=>z.room===room)});
      }
    }
    const newer = !!photo && (!this.photo || photo.serial > this.photo.serial && photo.at_ms >= this.photo.at_ms);
    if (newer) {
      const prev = this.photo;
      const consecutive = prev && photo.serial === prev.serial+1 && photo.id !== prev.id && photo.at_ms-prev.at_ms <= MAX_PHOTO_GAP_MS;
      if (!consecutive) {
        this.vacantSince.clear();
        this.mealSetup = null;
        this.previousSeated = null;
      }
      this.photo = photo;
      this.photoRev = rev;
      for (const [room,watch] of watches) {
        if (this.covered(photo,watch.zones) && photo.proof!.person_count===0) {
          if (!this.vacantSince.has(room)) this.vacantSince.set(room,photo.at_ms);
        } else this.vacantSince.delete(room);
      }
      this.updateMeal(view,map,photo);
    }
    const current = this.photo;
    const proof = current?.proof;
    const stamp = current?.at_ms ?? null;
    const currentRev = current ? this.photoRev : null;
    const recent = stamp !== null && now >= stamp && now-stamp <= MAX_PHOTO_GAP_MS;
    const see = (v:TriggerFact["value"])=>fact(v,stamp,currentRev);
    const transition = {...this.transition}, entered = this.entered;
    const windows = new Map(this.vacantSince);
    return {
      trail:view.person_trail ?? [],
      mealSeated: recent ? this.mealSeated : see("unknown"),
      read: t => {
        if (t.kind==="device") return deviceFact(view.devices,t,rev,changedDevices);
        if (t.kind==="entered") return transition.rev === null || transition.rev > rev ? fact("unknown") :
          {...transition,value:transition.value==="unknown" ? "unknown" : entered === t.state};
        if (!recent || !proof || !current || !map) return see("unknown");
        if (t.kind==="noViewer") {
          const watch = watches.get(t.room);
          if (!watch || !this.covered(current,watch.zones)) return see("unknown");
          const since = windows.get(t.room);
          return see(since !== undefined && current.at_ms-since >= t.ms);
        }
        const match = [...watches.values()].filter(w=>w.tv===t.target);
        if (match.length!==1 || !this.covered(current,match[0]!.zones) || proof.person_count!==1 || !proof.person) return see("unknown");
        const p = proof.person;
        const zone = this.zoneOf(map,p.room,p.position,EDGE_MARGIN_M);
        if (!zone || p.seated===null || p.attention==="unknown") return see("unknown");
        return see(match[0]!.zones.some(z=>z.id===zone) && p.seated && p.attention==="toward_tv");
      },
    };
  }

  private changedDevices(devices: WorldDevice[]) {
    const changed = new Map<string,Set<string>>();
    const next = new Map<string,Map<string,number>>();
    for (const device of devices) {
      const old = this.deviceTimes.get(device.id);
      const times = new Map(old);
      const attrs = new Set<string>();
      for (const row of device.history) {
        if (row.from === row.to) continue;
        const at = row.seen_ms ?? row.at_ms;
        if (at <= (times.get(row.attr) ?? -Infinity)) continue;
        times.set(row.attr,at);
        if (old && row.from != null && row.explicit !== false) attrs.add(row.attr);
      }
      next.set(device.id,times);
      changed.set(device.id,attrs);
    }
    this.deviceTimes = next;
    return changed;
  }

  private covered(p: HouseholdPhoto,zones: Zone[]) {
    const proof=p.proof;
    return proof?.seats==="clear" && zones.length>0 && zones.every(z=>z.polygon.every(point=>{
      const floor = this.floor(point);
      return [floor,floor+1.2].every(y=>inView(proof.camera,[point[0],y,point[1]]));
    }));
  }

  private updateMeal(view:WorldView,map:StationMap|null,photo:HouseholdPhoto) {
    const proof=photo.proof;
    const station=map?.stations.find(s=>s.id===map.meal_watch);
    this.mealSeated=fact("unknown",photo.at_ms,this.photoRev);
    if (!map || !station || !proof) { this.mealSetup=null; this.previousSeated=null; return; }
    const cup=view.objects.find(o=>o.cls==="cup" && o.status==="present" && o.surface && station.surfaces.includes(o.surface) &&
      o.facts.place?.value!=="in_hand" && !o.carried && !o.followed_by && o.last_seen_ms<=photo.at_ms && photo.at_ms-o.last_seen_ms<=MAX_PHOTO_GAP_MS);
    const old=this.mealSetup;
    if (!cup || proof.dining_food==="no" || (old && (photo.at_ms-old.at > MAX_PHOTO_GAP_MS || cup.id!==old.cup || cup.surface!==old.surface))) this.mealSetup=null;
    const person=proof.person;
    const zone=person && this.zoneOf(map,person.room,person.position,EDGE_MARGIN_M);
    if (person && zone && station.observes_zone_ids.includes(zone) && person.seated !== null) {
      this.mealSeated=fact(!!this.mealSetup && this.previousSeated===false && person.seated && this.mealSetup.at<photo.at_ms, photo.at_ms,this.photoRev);
      this.previousSeated=person.seated;
    } else this.previousSeated=proof.person_count===0 || person?.seated===false ? false : null;
    if (cup?.surface && proof.dining_food==="yes" && this.previousSeated===false) this.mealSetup={at:photo.at_ms,cup:cup.id,surface:cup.surface};
  }
}
