import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as help from "../src/act/help-record.js";
import { HistoryDb } from "../src/brain/index.js";
import { BusNode, MemoryBus, Outbox, RETRY_MS, VirtualClock } from "../src/bus/index.js";
import { historyRoutes } from "../src/record/index.js";
import { settle } from "../src/record/replay.js";

const epoch = { boot: "boot-1", home: "home-epoch-1" };
const attempt = {
  key: { boot: epoch.boot, homeEpoch: epoch.home, attemptId: "a1", gen: 2 },
  home: "home", user: "alice", action: "water", context: "study", request: "proactive" as const, startedMs: 1_000,
};
const proof = {
  key: attempt.key, home: attempt.home, user: "alice", kind: "explicit_decline" as const,
  evidence: { source: "phone_answer", subjectId: "alice", observedMs: 1_500, originId: "reply-1" },
};

describe("assistance outcomes", () => {
  it("separates execution from a response and verifies the proof binding", () => {
    const cases = [
      { proofs: [], want: "unknown" },
      { proofs: [proof], want: "declined" },
      { proofs: [{ ...proof, key: { ...proof.key, attemptId: "other" } }], want: "unknown" },
      { proofs: [{ ...proof, key: { ...proof.key, gen: 1 } }], want: "unknown" },
      { proofs: [{ ...proof, user: "bob" }], want: "unknown" },
      { proofs: [{ ...proof, home: "other" }], want: "unknown" },
      { proofs: [{ ...proof, evidence: { ...proof.evidence, observedMs: 99 } }], want: "unknown" },
      { proofs: [{ ...proof, evidence: { ...proof.evidence, source: "object_missing" } }], want: "unknown" },
      { proofs: [{ ...proof, kind: "explicit_accept" as const }], want: "accepted" },
      { proofs: [{ ...proof, kind: "confirmed_handoff" as const, evidence: { ...proof.evidence, source: "handoff", subjectId: "cup" } }], want: "accepted" },
      { proofs: [{ ...proof, kind: "self_resolved" as const, evidence: { ...proof.evidence, source: "resident_action", subjectId: "cup" } }], want: "self_resolved" },
    ];
    for (const { proofs, want } of cases) {
      const outcome = help.assistanceOutcome?.(attempt, "done", 2_000, proofs);
      expect(outcome).toMatchObject({ execution: "done", reaction: want });
    }
    expect(help.assistanceOutcome?.({ ...attempt, user: null }, "cancelled", 2_000, [proof])).toMatchObject({ reaction: "unknown" });
    expect(help.assistanceOutcome?.(attempt, "cancelled", 2_000)).toMatchObject({ execution: "cancelled", reaction: "unknown" });
  });

  it("retries a failed write and keeps the first result across reopened databases and new envelopes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "assistance-outcomes-"));
    const path = join(dir, "history.db");
    const clock = new VirtualClock(2_000);
    const bus = new MemoryBus({ clock });
    const act = new BusNode({ name: "act", bus, epoch, clock });
    const out = new Outbox(act, { clock, log: () => {} });
    let db = HistoryDb.open(path);
    const recorder = (scoped = epoch) => {
      const node = new BusNode({ name: "recorder", bus, epoch: scoped, clock, log: () => {} });
      historyRoutes(node, db, { now: () => clock.now(), machinesOnly: true });
      return node;
    };
    let rec = recorder();
    const start = async () => { await rec.prepare(); rec.start(); };
    const barrier = () => settle(bus, [act, rec]);
    const topic = "/act/assistance_outcome";
    const rows = () => db.list({}).filter(row => row.kind === ("assistance_outcome" as string));
    try {
      expect(rows()).toEqual([]);
      db.db.exec("CREATE TRIGGER reject_outcome BEFORE INSERT ON events WHEN NEW.kind = 'assistance_outcome' BEGIN SELECT RAISE(ABORT, 'test write failed'); END");
      await start();
      const outcome = help.assistanceOutcome?.(attempt, "cancelled", 2_000, [proof]);
      const envelope = outcome && act.envelope(topic, outcome);
      if (outcome) help.publishAssistanceOutcome?.(out, outcome);
      await barrier();
      expect(rows()).toEqual([]);
      expect(db.db.prepare("SELECT count(*) AS n FROM bus_seen WHERE topic = ?").get(topic)).toEqual({ n: 0 });
      db.db.exec("DROP TRIGGER reject_outcome");
      await clock.advanceTo(clock.now() + RETRY_MS, barrier);
      expect(rows()).toHaveLength(1);
      await rec.stop();
      db.close();
      db = HistoryDb.open(path);
      rec = recorder();
      await start();
      if (envelope) await bus.publish(envelope);
      const later = help.assistanceOutcome?.({ ...attempt, key: { ...attempt.key, gen: 3 } }, "done", 2_000);
      if (later) help.publishAssistanceOutcome?.(out, later);
      await barrier();
      expect(rows().map(row => row.data)).toEqual([outcome]);
      for (const scoped of [{ ...epoch, boot: "boot-2" }, { ...epoch, boot: "boot-2", home: "home-epoch-2" }]) {
        await rec.stop();
        rec = recorder(scoped);
        await start();
        const nextAct = new BusNode({ name: "act", bus, epoch: scoped, clock });
        const next = help.assistanceOutcome({ ...attempt, key: { ...attempt.key, boot: scoped.boot, homeEpoch: scoped.home } }, "done", 2_000);
        await nextAct.publish(topic, next);
        await barrier();
        await nextAct.stop();
      }
      expect(rows()).toHaveLength(3);
    } finally {
      await rec.stop();
      await bus.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
