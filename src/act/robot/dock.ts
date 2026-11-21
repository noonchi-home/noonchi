// 계획 뒤 잠시 본 다음 낮에는 사용자 방의 대기 자리, 밤·저전력이면 충전 자리로 간다.
import type { PlannedCommand } from "../../contract/phone.js";
import type { WorldView } from "../../contract/world.js";
import type { StationMap } from "../../contract/stations.js";
import { standbyFor } from "../../layout/index.js";
import { DAY_PARTS, FRESH_MS } from "../../world/vocab.js";
import { josa } from "../../shared/korean.js";
import { dockId } from "../dock-step.js";
import { DOCK_TEXT, VISION_TEXT } from "../labels.js";
import { emergencyOf } from "../mode.js";
import { STEP_DONE } from "../prompts.js";
import { Part, type Run } from "../track/core.js";
import { eyeNow, idleLine, refreshLine, sendLine, type IdleSlot } from "./phone-line.js";

export const DOCK = { nearM: 1.2, lookMs: 3000, totalMs: 120_000 } as const;
const STATION_NEAR_M = 0.5;
/** 사용자 방을 마지막으로 확인한(발 자리를 본) 뒤 이만큼(ms) 안이면 그 방으로 돌아간다. 폰은 일하는 동안 사용자를 못 보기 쉽다(싱크대 앞에서 소파는 등 뒤). 목표 확인 창 5분과 같다. */
export const USER_ROOM_MS = 300_000;
type Position = [number, number, number];
type Destination = {kind: "station"; id: string} | {kind: "dock"; position: Position};
type Place = {id: string; label: string; position: Position; look: string | null};

export function returnTarget(ctx: {batteryLow: boolean | null; night: boolean; userRoom: string | null}, map: StationMap | null, dock: Position | null): Destination | null {
  if (ctx.batteryLow === true || ctx.night) return dock ? {kind:"dock", position:dock} : null;
  const station = ctx.userRoom && map ? standbyFor(map, ctx.userRoom) : null;
  return station ? {kind:"station", id:station.id} : null;
}

export interface DockSlot extends IdleSlot {
  phase: "look" | "go";
  target: Place | null;
  charging: boolean;
  startedAt: number;
  decision: string;
}

/** 아는 사실로 본 사용자 위치 한 줄. */
export function userWhere(world: Pick<WorldView, "person">): string {
  const p = world.person;
  if (p.visible && p.room_label) return DOCK_TEXT.userHere(p.room_label);
  if (p.room_label) return DOCK_TEXT.userLast(p.room_label);
  return DOCK_TEXT.userUnknown;
}

export class Dock extends Part {
  private seq = 0;
  private standby: Place | null = null;

  private context(now: number) {
    const p = this.o.state.view().person;
    const fresh = p.visible && p.count === 1 && p.position && p.position_ms !== null && p.position_ms <= now && now - p.position_ms <= FRESH_MS;
    // 지금 안 보여도 최근에 확인한 방(World State는 마지막 발 자리와 그 방을 남긴다)
    const recent = !p.visible && p.position && p.position_ms !== null && p.position_ms <= now && now - p.position_ms <= USER_ROOM_MS;
    const hour = new Date(now + (this.o.offsetMinutes ?? 540) * 60_000).getUTCHours();
    return {userRoom: fresh || recent ? p.room : null, night: DAY_PARTS.findLast(part => hour >= part.from)?.key === "night",
      batteryLow:this.o.layout.batteryLow?.() ?? null};
  }

  planClosed(r: Run, close: "done" | "failed" | "cancelled" | null): void {
    if (this.core.stopped || close === null || close === "cancelled" || r.at < 0 || this.emergency()) return;
    const now = this.clock.now();
    const ctx = this.context(now);
    if (ctx.night || ctx.batteryLow === true ? !this.o.layout.dock?.() : !this.o.stations?.map?.()?.stations.some(s => s.roles.includes("standby"))) return;
    this.drop();
    this.core.docking = {id:dockId(++this.seq), sent:null, spokeAt:now, visionAt:now, phase:"look", target:null,
      charging:ctx.night || ctx.batteryLow === true, startedAt:now, decision:r.decision.id};
  }

  state(): "look" | "go" | "room" | "standby" | null {
    const q = this.core.docking;
    if (q) return q.phase === "go" && !q.charging ? "room" : q.phase;
    return this.standby ? "standby" : null;
  }

  private distance(place: Place, now: number) {
    const eye = eyeNow(this.core,now);
    return eye ? Math.hypot(eye.position[0]-place.position[0], eye.position[1]-place.position[2]) : null;
  }

  tick(): void {
    const core = this.core;
    const now = this.clock.now();
    const q = core.docking;
    if (!q && !this.standby) return;
    if (core.stopped || core.open() || core.planning || core.finding || core.idlePeek || core.directives.shown() || this.emergency()) return this.drop();
    if (!q) {
      if (this.standby && (this.distance(this.standby,now) ?? Infinity) > STATION_NEAR_M) this.standby = null;
      return;
    }
    if (now - q.startedAt >= DOCK.totalMs) {
      if (q.charging) this.o.events.thought?.(DOCK_TEXT.gaveUp,q.decision);
      return this.drop();
    }
    if (!q.target) {
      if (now - q.startedAt < DOCK.lookMs) return;
      const destination = returnTarget(this.context(now), this.o.stations?.map?.() ?? null, this.o.layout.dock?.() ?? null);
      if (!destination) return;
      const place = destination.kind === "dock" ? {id:"dock",label:DOCK_TEXT.label,position:destination.position,look:null}
        : this.o.stations?.target(destination.id);
      if (!place) return;
      this.o.events.thought?.(userWhere(this.o.state.view()),q.decision);
      q.target = place;
      q.charging = destination.kind === "dock";
      q.phase = "go";
    }
    const target = q.target;
    const near = q.charging ? DOCK.nearM : STATION_NEAR_M;
    const distance = this.distance(target,now);
    const nav=q.charging?undefined:core.walk(q.id,target,true);
    if (nav?nav.arrived:distance !== null && distance <= near) return this.arrived();
    const line = idleLine(core,q);
    if (this.blocked()) return line.clear();
    const vision = nav?.vision??VISION_TEXT.distance(target.label,distance);
    if (!q.sent) {
      const sent: PlannedCommand = {type:"command", id:q.id, step:`${q.id}:1`, kind:"go", near_m:near, ...(nav?{guide:nav.guide}:{}), target:{id:target.id,label:target.label,position:target.position}, speak:true, vision,
        text:q.charging ? DOCK_TEXT.command : DOCK_TEXT.stationCommand(josa(target.label,"으로/로"),target.look ? josa(target.look,"을/를") : null),
        choices:q.charging ? [{id:STEP_DONE.id,label:STEP_DONE.label}] : []};
      sendLine(line,sent,now);
      this.o.events.thought?.(q.charging ? DOCK_TEXT.going : DOCK_TEXT.stationGoing(josa(target.label,"으로/로")),q.decision);
    } else if(nav && nav.guide?.revision!==q.sent.guide?.revision) line.show({...q.sent,vision,guide:nav.guide,speak:false});
    else refreshLine(core,line,q.sent,vision,now);
  }

  arrived(): void {
    const q = this.core.docking;
    if (!q?.target) return;
    const place = q.target;
    this.drop();
    if (!q.charging) this.standby = place;
    this.o.events.thought?.(q.charging ? DOCK_TEXT.docked : DOCK_TEXT.standing(place.label),q.decision);
  }

  busy(): boolean {
    const q = this.core.docking;
    if (!q || this.core.stopped) return false;
    if (this.emergency()) { this.drop(); return false; }
    return q.charging || !!q.target;
  }

  private emergency(): boolean {
    return emergencyOf({world:this.o.state.view(),offNotices:this.core.safety.offTrack().notices});
  }

  drop(): void {
    const q = this.core.docking;
    if (q) idleLine(this.core,q).clear();
    this.core.docking = null;
    this.standby = null;
  }

  private blocked(): boolean {
    return !this.core.start.phoneOk() || this.core.safety.offPending() || !!this.core.safety.shownOff()
      || !!this.o.phone.approvalsWaiting?.() || !!this.o.phone.talking?.();
  }
}
