import { describe, expect, it } from "vitest";
import { assistanceOutcome } from "../src/act/help-record.js";
import { HistoryDb } from "../src/brain/index.js";
import type { AssistanceProofKind } from "../src/contract/assistance-outcome.js";

const home = "home";
const user = "alice";
const habit = { action: "water", context: "study" };
const day = "2026-11-22";
const next = "2026-11-23";
const at = (date: string, time = "20:00") => Date.parse(`${date}T${time}:00+09:00`);
const rule = { initial_state: "study", states: [{ id: "study", next: [{ on: "water is needed", action: "water", to: "study" }] }] };

function observed(db: HistoryDb, id: string, ms: number, kind?: AssistanceProofKind, scope?: { home?: string; user?: string | null; request?: "direct" | "proactive" }) {
  const key = { boot: "test", homeEpoch: "epoch", attemptId: id, gen: 0 };
  const attempt = { key, home, user, ...habit, startedMs: ms - 10, request: "proactive" as const, ...scope };
  const source = kind === "self_resolved" ? "resident_action" : "phone_answer";
  const proof = kind ? [{ key, home: attempt.home, user: attempt.user ?? user, kind, evidence: { source, subjectId: attempt.user ?? user, observedMs: ms, originId: id } }] : [];
  const outcome = assistanceOutcome(attempt, kind === "explicit_decline" ? "cancelled" : "done", ms, proof);
  db.once({ topic: "/act/assistance_outcome", group: "recorder", key: id, msg: id, boot: key.boot }, () => db.recordAssistanceOutcome(outcome));
}

function save(db: HistoryDb, date = day, appliesDay = next) {
  return db.saveNight({ day: date, appliesDay, robot: rule, candidates: {},
    reflection: version => ({ atMs: at(date, "23:30"), text: "night", data: { version } }) });
}

describe("intervention learning", () => {
  it("changes only next day's matching proactive context after two separate explicit declines", () => {
    for (const [sample, expected] of [["explicit_decline", "defer_proactive"], ["explicit_accept", "default"], [undefined, "default"]] as const) {
      const db = HistoryDb.open(":memory:");
      try {
        observed(db, "first", at("2026-11-21"), "explicit_decline");
        observed(db, "second", at(day), sample);
        observed(db, "late", at(day, "23:59"));
        observed(db, "midnight", at(next, "00:00"), "explicit_accept");
        observed(db, "other-home", at(day), "explicit_decline", { home: "other" });
        observed(db, "other-user", at(day), "explicit_decline", { user: "bob" });
        observed(db, "unknown-user", at(day), "explicit_decline", { user: null });
        observed(db, "direct", at(day, "22:00"), "explicit_accept", { request: "direct" });
        save(db);
        expect(db.policyFor?.(home, user, habit, next) ?? "default").toBe(expected);
        expect(db.policyFor?.(home, user, habit, day) ?? "default").toBe("default");
        expect(db.policyFor?.("other", user, habit, next) ?? "default").toBe("default");
        expect(db.policyFor?.(home, "bob", habit, next) ?? "default").toBe("default");
        expect(db.policyFor?.(home, user, { ...habit, context: "dinner" }, next) ?? "default").toBe("default");
        expect(db.memoryFor(next)?.memory).toEqual(rule);
      } finally { db.close(); }
    }
  });

  it("uses the last valid response of a day, verifies self-resolution, and resets after two proactive acceptances", () => {
    const db = HistoryDb.open(":memory:");
    try {
      observed(db, "first", at("2026-11-21"), "self_resolved");
      observed(db, "old-second", at(day, "19:00"), "explicit_decline");
      observed(db, "second", at(day), "self_resolved");
      save(db);
      expect(db.policyFor?.(home, user, habit, next) ?? "default").toBe("verify_first");
      observed(db, "direct", at(next), "explicit_accept", { request: "direct" });
      observed(db, "accept-one", at(next, "20:01"), "explicit_accept");
      save(db, next, "2026-11-24");
      expect(db.policyFor?.(home, user, habit, "2026-11-24") ?? "default").toBe("verify_first");
      observed(db, "accept-two", at("2026-11-24"), "explicit_accept");
      save(db, "2026-11-24", "2026-11-25");
      expect(db.policyFor?.(home, user, habit, "2026-11-25") ?? "default").toBe("default");
    } finally { db.close(); }
  });

  it("clears a scope only with an explicit ongoing preference and ignores earlier refusals afterwards", () => {
    const db = HistoryDb.open(":memory:");
    try {
      observed(db, "first", at("2026-11-21"), "explicit_decline");
      observed(db, "second", at(day), "explicit_decline");
      save(db);
      expect(db.policyFor(home, user, habit, next)).toBe("defer_proactive");
      db.recordInterventionPreference?.({ home, user, ...habit, atMs: at(next), originId: "request-to-resume" });
      save(db, next, "2026-11-24");
      expect(db.policyFor(home, user, habit, "2026-11-24")).toBe("default");
      save(db, "2026-11-24", "2026-11-25");
      expect(db.policyFor(home, user, habit, "2026-11-25")).toBe("default");
      observed(db, "new-first", at("2026-11-25"), "explicit_decline");
      observed(db, "new-second", at("2026-11-26"), "explicit_decline");
      save(db, "2026-11-26", "2026-11-27");
      expect(db.policyFor(home, user, habit, "2026-11-27")).toBe("defer_proactive");
    } finally { db.close(); }
  });

  it("rolls back policy, memory and the night marker together, then commits the night once", () => {
    const db = HistoryDb.open(":memory:");
    try {
      observed(db, "first", at("2026-11-21"), "explicit_decline");
      observed(db, "second", at(day), "explicit_decline");
      db.db.exec("CREATE TRIGGER reject_reflection BEFORE INSERT ON events WHEN NEW.kind = 'reflection' BEGIN SELECT RAISE(ABORT, 'test write failed'); END");
      expect(() => save(db)).toThrow("test write failed");
      expect(db.memoryFor(next)).toBeNull();
      expect(db.policyFor?.(home, user, habit, next) ?? "default").toBe("default");
      db.db.exec("DROP TRIGGER reject_reflection");
      const first = save(db);
      expect(save(db)).toEqual(first);
      expect(db.policyFor?.(home, user, habit, "2027-02-01") ?? "default").toBe("defer_proactive");
      expect(db.memoryVersions()).toHaveLength(1);
      expect(db.list({ kinds: ["reflection"] })).toHaveLength(1);
    } finally { db.close(); }
  });
});
