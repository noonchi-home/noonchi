import { describe, expect, it } from "vitest";
import * as habits from "../src/brain/history/habits.js";
import { localTime } from "./fixtures/assistance/learning.js";

const home = "beer-household";
const user = "resident";
const device = "living-tv";

function fourWeeks(provenance: "resident" | "assistance" = "resident", includeAfternoons = true) {
  const events = [];
  for (let day = 0; day < 28; day++) {
    const date = new Date(Date.UTC(2026, 9, 24 + day)).toISOString().slice(0, 10);
    const saturday = day % 7 === 0;
    const starts = saturday && includeAfternoons ? ["14:00:00", "19:00:00"] : ["19:00:00"];
    for (const time of starts) {
      const start = localTime(date, time);
      const session = date + "-" + time;
      const end = start + 90 * 60_000;
      events.push({ home, user, device, originId: "tv-on-" + session, atMs: start, kind: "tv_on" as const },
        { home, user, device, originId: "tv-off-" + session, atMs: end, kind: "tv_off" as const });
      if (saturday && time === "19:00:00") {
        const object = "can-" + date;
        events.push({ home, user, device, object, provenance, originId: "pickup-" + session, atMs: start + 60_000, kind: "beer_taken" as const },
          { home, user, device, object, provenance, originId: "put-away-" + session, atMs: end + 120_000, kind: "can_put_away" as const });
      }
    }
  }
  return events;
}

describe("TV and beer context over four observed weeks", () => {
  it("adopts separate delivery and cleanup rules only for Saturday evening", () => {
    const result = habits.learnBeerRules?.(fourWeeks(), 540);
    expect(result).toMatchObject({ tvOn: 32, beer: 4, cleanup: 4, rules: [
      { action: "맥주 가져다주기", trigger: "tv_on", weekday: 6, hour: 18, seen: 4, matched: 4, baseline: 0.125 },
      { action: "맥주 캔 치우기", trigger: "tv_off", weekday: 6, hour: 18, seen: 4, matched: 4, baseline: 0.125 },
    ] });
    expect(result!.rules.every(r => r.p < 0.01)).toBe(true);
    expect(habits.matchesBeerRule(result!.rules[0]!, localTime("2026-11-21", "14:00:00"), 540)).toBe(false);
    expect(habits.matchesBeerRule(result!.rules[0]!, localTime("2026-11-22", "19:00:00"), 540)).toBe(false);
    expect(habits.matchesBeerRule(result!.rules[0]!, localTime("2026-11-21", "19:00:00"), 540)).toBe(true);
  });

  it("excludes robot-assisted behavior and counts each original observation once", () => {
    const assisted = habits.learnBeerRules?.(fourWeeks("assistance"), 540);
    expect(assisted).toMatchObject({ tvOn: 32, beer: 0, cleanup: 0, rules: [] });
    const events = fourWeeks();
    expect(habits.learnBeerRules?.([...events, ...events], 540)).toMatchObject({ tvOn: 32, beer: 4, cleanup: 4 });
  });

  it("derives the weekday from the same 32 exposures", () => {
    const sunday = fourWeeks().map(event => ({ ...event, atMs: event.atMs + 86_400_000 }));
    const result = habits.learnBeerRules(sunday, 540);
    expect(result).toMatchObject({ tvOn: 32, beer: 4, cleanup: 4 });
    expect(result.rules.map(rule => rule.weekday)).toEqual([0, 0]);
  });

  it("can adopt Saturday by itself when Saturday afternoons were never observed", () => {
    const result = habits.learnBeerRules?.(fourWeeks("resident", false), 540);
    expect(result?.rules).toHaveLength(2);
    expect(result?.rules.every(r => r.weekday === 6 && r.hour === null)).toBe(true);
  });
});
