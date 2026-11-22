import type { DatabaseSync } from "node:sqlite";

/** A decision about leftovers belongs to a resident in one home. Only demo setup
 * designates a single known resident in a session where face identity is unavailable. */
export class CupAnswers {
  constructor(private readonly db: DatabaseSync) {}

  allowDiscard(home: string, resident: string | null): boolean {
    if (!resident) return false;
    const row = this.db.prepare("SELECT discard_leftover_cup FROM cup_answers WHERE home = ? AND resident = ?").get(home, resident);
    return row?.discard_leftover_cup === 1;
  }

  remember(home: string, resident: string, discard: boolean): void {
    this.db.prepare(`INSERT INTO cup_answers(home, resident, discard_leftover_cup) VALUES (?, ?, ?)
      ON CONFLICT(home, resident) DO UPDATE SET discard_leftover_cup = excluded.discard_leftover_cup`).run(home, resident, Number(discard));
  }

  seedDemo(home: string): void {
    this.db.prepare(`INSERT INTO cup_answers(home, resident, discard_leftover_cup, single_demo) VALUES (?, 'demo-owner', 1, 1)
      ON CONFLICT(home, resident) DO UPDATE SET single_demo = 1`).run(home);
  }

  demoResident(home: string, people: number): string | null {
    if (people !== 0 && people !== 1) return null;
    const row = this.db.prepare("SELECT resident FROM cup_answers WHERE home = ? AND single_demo = 1").get(home);
    return typeof row?.resident === "string" ? row.resident : null;
  }
}
