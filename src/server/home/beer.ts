import type { AgentPlan } from "../../agent/index.js";
import { matchesBeerRule } from "../../brain/index.js";
import type { BeerAction } from "../../contract/beer.js";
import type { DecisionRecord } from "../../contract/events.js";
import type { PlanView } from "../../contract/plan.js";
import type { WorldView } from "../../contract/world.js";
import { HOUSEHOLD_KINDS } from "../../devices/kinds.js";
import { BeerObservation, viewerSurface, type BeerPower } from "../../goal/index.js";
import type { HomeCore } from "./core.js";

export function isBeerAction(action: string | null | undefined): action is BeerAction {
  return action === "맥주 가져다주기" || action === "맥주 캔 치우기";
}

type Candidate = NonNullable<ReturnType<BeerObservation["candidate"]>>;

/** A rule only permits the current verified TV episode and its own observed can. */
export class HomeBeer {
  private readonly watch: BeerObservation;
  private readonly reservations = new Map<string, { candidate: Candidate; destination: string; placeStep: string }>();
  private power: BeerPower | null = null;

  constructor(private readonly core: HomeCore, private readonly user: string) {
    this.watch = new BeerObservation(core.twin.home.id, user, event => core.out.act?.push("/act/beer_observation", {
      ...event, originId: JSON.stringify([core.epoch.boot, core.epoch.home, event.originId]),
    }));
  }

  private readPower(): BeerPower | null {
    const signals = this.core.signals;
    const tvs = signals.list().filter(spec => spec.kind === HOUSEHOLD_KINDS.viewerPower);
    if (tvs.length !== 1) return null;
    const tv = tvs[0]!;
    const state = signals.get(tv.id);
    if (!state?.online || state.signal === "none" || (state.vision?.applied && !state.readback)) return null;
    const power = state.twin.power;
    const atMs = Date.parse(state.readback?.at ?? state.updatedAt);
    if ((power !== "on" && power !== "off") || !Number.isFinite(atMs)) return null;
    return { device: tv.id, room: tv.room, on: power === "on", atMs, originId: JSON.stringify([this.core.epoch.boot, this.core.epoch.home, tv.id, atMs, power]) };
  }

  see(world: WorldView): void {
    const state = this.readPower();
    const prior = this.power;
    if (state && prior && state.on !== prior.on) this.reservations.clear();
    this.power = state;
    const plan = this.core.plans?.current();
    this.watch.observe(world, state, plan?.status === "running", this.core.nowMs());
  }

  available(action: BeerAction): Candidate | null {
    const now = this.core.nowMs();
    const candidate = this.watch.candidate(action, now);
    if (!candidate) return null;
    const db = this.core.ctx.history.db;
    const day = db.dayOf(now);
    const version = db.pinnedMemory(day) ?? db.memoryFor(day)?.version;
    if (version === undefined) return null;
    const allowed = db.beerRules(version).some(rule => rule.home === this.core.twin.home.id && rule.user === this.user
      && rule.device === candidate.power.device && rule.action === action && matchesBeerRule(rule, candidate.power.atMs, db.offsetMinutes));
    return allowed ? candidate : null;
  }

  reserve(decision: DecisionRecord, candidate: Candidate, plan: AgentPlan): boolean {
    const current = this.available(candidate.action);
    if (!current || current.power.originId !== candidate.power.originId || current.object !== candidate.object || current.surface !== candidate.surface) return false;
    const pick = plan.steps.filter(step => step.kind === "pick");
    const places = plan.steps.filter(step => step.kind === "place");
    const place = places[0];
    if (plan.task !== candidate.action || pick.length !== 1 || places.length !== 1 || !place?.target || plan.steps.at(-1) !== place) return false;
    if (candidate.object ? (pick[0]?.object !== candidate.object || place.object !== candidate.object || !this.sinkBasin(place.target))
      : place.target !== current.surface) return false;
    this.reservations.set(decision.id, { candidate: current, destination: place.target, placeStep: place.id });
    this.watch.reserve(candidate.action);
    return true;
  }

  private sinkBasin(id: string): boolean {
    return this.basinIds().includes(id);
  }

  basinIds(): string[] { return this.core.surfaces().filter(surface => !!surface.basin).map(surface => surface.id); }

  valid(decision: DecisionRecord, world: WorldView, plan?: PlanView | null): boolean {
    const reservation = this.reservations.get(decision.id);
    const power = this.readPower();
    if (!reservation || !power) return false;
    const { candidate, destination, placeStep } = reservation;
    if (power.device !== candidate.power.device || power.on !== candidate.power.on || this.power?.on !== power.on
      || plan?.steps.find(step => step.id === placeStep)?.target?.objectId !== destination) return false;
    const photo = world.household_photo;
    const now = this.core.nowMs();
    if (!photo?.proof || now - photo.at_ms > 10_000 || photo.proof.person_count > 1 || world.person.count > 1
      || photo.at_ms < candidate.seenMs || now - candidate.power.atMs > 300_000) return false;
    if (!candidate.object) {
      return !!viewerSurface(world, power.room, destination) &&
        !world.objects.some(o => o.cls === "beer_can" && o.status === "present" && o.last_seen_ms === photo.at_ms);
    }
    if (photo.proof.person?.room === power.room || !this.sinkBasin(destination)) return false;
    return world.surfaces_seen?.some(s => s.id === candidate.surface && s.seen_ms === photo.at_ms) === true
      && world.objects.some(o => o.id === candidate.object && o.status === "present" && o.surface === candidate.surface && o.last_seen_ms === photo.at_ms
        && o.facts.place?.certainty === "confirmed" && o.facts.place.value === "on_table");
  }

  handoff(object: string): void { this.watch.handedOff(object); }
}
