import type { BeerAction, BeerEvent } from "../contract/beer.js";
export type { BeerAction } from "../contract/beer.js";
import type { WorldView } from "../contract/world.js";

export interface BeerPower {
  device: string;
  room: string;
  on: boolean;
  atMs: number;
  originId: string;
}

interface BeerCandidate { action: BeerAction; object: string | null; surface: string; power: BeerPower; seenMs: number }

const TRIGGER_MS = 300_000;
const FRESH_MS = 10_000;
const VIEWER_REACH_M = 2;

export function viewerSurface(world: WorldView, room: string, id?: string) {
  const photo = world.household_photo;
  const viewer = photo?.proof?.person;
  if (!photo || photo.proof?.person_count !== 1 || world.person.count !== 1
    || viewer?.room !== room || viewer.seated !== true || viewer.attention !== "toward_tv") return null;
  const distance = (center: [number, number]) => Math.hypot(center[0] - viewer.position[0], center[1] - viewer.position[1]);
  return (world.surfaces_seen ?? []).filter(surface => surface.room === room && surface.seen_ms === photo.at_ms
      && (!id || id === surface.id) && distance(surface.center) <= VIEWER_REACH_M)
    .sort((a, b) => distance(a.center) - distance(b.center))[0] ?? null;
}

/** Advances a TV session from real state transitions and distinct captures. */
export class BeerObservation {
  private power: BeerPower | null = null;
  private on: BeerPower | null = null;
  private lastPhoto = -Infinity;
  private photoId = "";
  private viewer = false;
  private moved = false;
  private ambiguous = false;
  private can: string | null = null;
  private table: string | null = null;
  private observedHold = false;
  private outsideHolding: string | null = null;
  private reserved = new Set<BeerAction>();
  private preexisting = new Set<string>();
  private offer: BeerCandidate | null = null;

  constructor(private readonly home: string, private readonly user: string,
              private readonly publish: (event: BeerEvent) => void) {}

  observe(world: WorldView, power: BeerPower | null, robotActive: boolean, now: number): void {
    if (!power || power.atMs > now || (this.power && power.atMs < this.power.atMs)) {
      this.offer = null;
      return;
    }
    const prior = this.power;
    if (prior && prior.atMs === power.atMs && prior.on !== power.on) {
      this.offer = null;
      return;
    }
    if (prior?.on === power.on) power = prior;
    this.power = power;
    if (prior && prior.on !== power.on && power.atMs > prior.atMs) {
      this.publish({ home: this.home, user: this.user, device: power.device, originId: power.originId, atMs: power.atMs, kind: power.on ? "tv_on" : "tv_off" });
      this.offer = null;
      if (power.on) {
        this.on = power;
        this.viewer = this.moved = this.ambiguous = false;
        this.can = this.table = this.outsideHolding = null;
        this.reserved.clear();
        this.preexisting = new Set(world.objects.filter(o => o.cls === "beer_can" && o.room === power.room
          && o.facts.place?.value === "on_table" && o.last_seen_ms < power.atMs).map(o => o.id));
      } else this.observedHold = false;
    }
    const photo = world.household_photo;
    if (!this.on || !photo || photo.id === this.photoId || photo.at_ms <= this.lastPhoto || photo.at_ms <= power.atMs
      || photo.at_ms > now || now - photo.at_ms > FRESH_MS) return;
    this.lastPhoto = photo.at_ms;
    this.photoId = photo.id;
    this.offer = null;
    const proof = photo.proof;
    if (!proof) return;
    if (proof.person_count > 1 || world.person.count > 1) this.ambiguous = true;
    if (this.ambiguous || robotActive) return;

    const resident = proof.person_count === 1 && world.person.count === 1 && world.person.visible ? proof.person : null;
    const cans = world.objects.filter(o => o.cls === "beer_can" && o.status === "present" && o.last_seen_ms === photo.at_ms);
    const place = (o: (typeof cans)[number], value: string) => o.facts.place?.certainty === "confirmed" && o.facts.place.value === value;
    const held = resident ? cans.filter(o => place(o, "in_hand") && world.person.holding.includes(o.id)) : [];
    const exact = cans.find(o => o.id === this.can);
    const event = (kind: "beer_taken" | "can_put_away", object: string) => this.publish({
      home: this.home, user: this.user, device: power.device, kind, object, provenance: "resident",
      atMs: photo.at_ms, originId: photo.id,
    });
    if (power.on) {
      if (resident?.room === power.room && resident.seated === true && resident.attention === "toward_tv") this.viewer = true;
      const taken = held.length === 1 ? held[0] : undefined;
      if (this.viewer && !this.can && taken && !this.preexisting.has(taken.id) && photo.at_ms - power.atMs <= TRIGGER_MS && resident?.room) {
        if (resident.room !== power.room) this.outsideHolding = taken.id;
        else {
          this.can = taken.id;
          if (this.outsideHolding === taken.id && !this.reserved.has("맥주 가져다주기")) event("beer_taken", taken.id);
        }
      }
      if (exact && place(exact, "on_table") && exact.room === power.room && exact.surface) this.table = exact.surface;
      const visibleSurface = viewerSurface(world, power.room);
      if (!this.can && cans.length === 0 && visibleSurface) {
        this.offer = { action: "맥주 가져다주기", object: null, surface: visibleSurface.id, power, seenMs: photo.at_ms };
      }
      return;
    }

    if (!this.can || this.reserved.has("맥주 캔 치우기") || photo.at_ms - power.atMs > TRIGGER_MS) return;
    if (held.some(o => o.id === this.can)) this.observedHold = true;
    if (exact && place(exact, "in_sink")) {
      if (this.observedHold) event("can_put_away", this.can);
      this.can = null;
      return;
    }
    if (resident?.room) this.moved = resident.room !== power.room;
    if (this.moved && exact?.surface && exact.surface === this.table && place(exact, "on_table")
      && world.surfaces_seen?.some(s => s.id === this.table && s.seen_ms === photo.at_ms)) {
      this.offer = { action: "맥주 캔 치우기", object: this.can, surface: exact.surface, power, seenMs: photo.at_ms };
    }
  }

  candidate(action: BeerAction, now: number): BeerCandidate | null {
    const offer = this.offer;
    return offer?.action === action && !this.reserved.has(action) && now - offer.seenMs <= FRESH_MS
      && now - offer.power.atMs <= TRIGGER_MS ? offer : null;
  }

  reserve(action: BeerAction): void { this.reserved.add(action); }

  handedOff(object: string): void {
    if (this.power?.on && this.reserved.has("맥주 가져다주기") && !this.can) this.can = object;
  }
}
