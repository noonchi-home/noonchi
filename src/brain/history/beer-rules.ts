import { binomialTail, FOLLOW_SECONDS, RATE_MIN } from "../pam/adopt.js";

import type { BeerContext, BeerEvent, BeerRule } from "../../contract/beer.js";
import type { FsmMemory } from "../decision.js";

export type { BeerEvent, BeerRule } from "../../contract/beer.js";

export function withBeerRules(memory: FsmMemory, rules: readonly BeerRule[]): FsmMemory {
  const deliver = rules.some(rule => rule.trigger === "tv_on");
  const clear = rules.some(rule => rule.trigger === "tv_off");
  if (!deliver && !clear) return memory;
  const next = structuredClone(memory);
  const watching = next.states.find(state => state.id === "watching_tv");
  if (!watching) return next;
  if (deliver && !watching.next.some(edge => edge.action === "맥주 가져다주기")) watching.next.push({
    to: "watching_tv", on: "TV가 켜지고 사용자가 소파에 앉아 시청한다.", when: "배운 맥주 시청 시간이고 맥주가 없다.", action: "맥주 가져다주기",
  });
  if (clear && !watching.next.some(edge => edge.action === "맥주 캔 치우기")) watching.next.push({
    to: "*", on: "TV를 끈 사용자가 다른 방으로 이동한다.", when: "배운 맥주 시청 시간이고 같은 맥주 캔이 탁자에 남아 있다.", action: "맥주 캔 치우기",
  });
  return next;
}

const WINDOW_MS = FOLLOW_SECONDS * 1000;
const ALPHA = 0.01;

export function matchesBeerRule(rule: BeerContext, atMs: number, offsetMinutes: number): boolean {
  const local = new Date(atMs + offsetMinutes * 60_000);
  return (rule.weekday === null || local.getUTCDay() === rule.weekday)
    && (rule.hour === null || Math.floor(local.getUTCHours() / 3) * 3 === rule.hour);
}

function bestContext(samples: readonly { atMs: number; hit: boolean }[], offsetMinutes: number) {
  const totalHits = samples.filter(s => s.hit).length;
  const baseline = totalHits / samples.length;
  if (totalHits < 2) return null;
  const lengths = new Set(samples.map(s => {
    const local = new Date(s.atMs + offsetMinutes * 60_000);
    return local.toISOString().slice(0, 10);
  }));
  // Unconditional probability uses distinct observed five-minute slots.
  const outsideRate = Math.min(1, totalHits / (lengths.size * (86_400_000 / WINDOW_MS)));
  const assess = (scope: BeerContext, chance: number) => {
    const within = samples.filter(s => matchesBeerRule(scope, s.atMs, offsetMinutes));
    const seen = within.length;
    const matched = within.filter(s => s.hit).length;
    if (matched < 2 || matched / seen < RATE_MIN) return null;
    const p = binomialTail(matched, seen, chance);
    return p < ALPHA ? { ...scope, seen, matched, baseline, p } : null;
  };
  const plain = assess({ weekday: null, hour: null }, outsideRate);
  if (plain) return plain;
  const days = Array.from({ length: 7 }, (_, weekday) => weekday);
  const hours = Array.from({ length: 8 }, (_, bucket) => bucket * 3);
  const one = [...days.map(weekday => ({ weekday, hour: null })), ...hours.map(hour => ({ weekday: null, hour }))];
  const two = days.flatMap(weekday => hours.map(hour => ({ weekday, hour })));
  for (const contexts of [one, two]) {
    const passed = contexts.flatMap(context => {
      const match = assess(context, baseline);
      return match ? [match] : [];
    }).sort((a, b) => a.p - b.p || b.seen - a.seen);
    if (passed.length) return passed[0]!;
  }
  return null;
}

export function learnBeerRules(input: readonly BeerEvent[], offsetMinutes: number) {
  const groups = new Map<string, Map<string, BeerEvent>>();
  for (const event of input) {
    if (!event.home || !event.user || !event.device || !event.originId || !Number.isSafeInteger(event.atMs)) continue;
    const scope = JSON.stringify([event.home, event.user, event.device]);
    const events = groups.get(scope) ?? new Map<string, BeerEvent>();
    const key = JSON.stringify([event.kind, event.originId]);
    if (!events.has(key)) events.set(key, event);
    groups.set(scope, events);
  }
  const result: { tvOn: number; beer: number; cleanup: number; rules: BeerRule[] } = {
    tvOn: 0, beer: 0, cleanup: 0, rules: [],
  };
  for (const group of groups.values()) {
    const events = [...group.values()].sort((a, b) => a.atMs - b.atMs);
    const first = events[0]!;
    const { home, user, device } = first;
    const edges = events.filter(e => e.kind === "tv_on" || e.kind === "tv_off").filter((e, i, all) => e.kind !== all[i - 1]?.kind);
    for (const [trigger, observed, action, count] of [
      ["tv_on", "beer_taken", "맥주 가져다주기", "beer"],
      ["tv_off", "can_put_away", "맥주 캔 치우기", "cleanup"],
    ] as const) {
      const samples = edges.flatMap((edge, i) => {
        if (edge.kind !== trigger) return [];
        const until = Math.min(edge.atMs + WINDOW_MS + 1, edges[i + 1]?.atMs ?? Infinity);
        const hit = events.some(e => e.kind === observed && e.provenance === "resident" && e.object
          && e.atMs > edge.atMs && e.atMs < until);
        return [{ atMs: edge.atMs, hit }];
      });
      if (trigger === "tv_on") result.tvOn += samples.length;
      result[count] += samples.filter(sample => sample.hit).length;
      const context = bestContext(samples, offsetMinutes);
      if (context) result.rules.push({ home, user, device, action, trigger, ...context });
    }
  }
  return result;
}
