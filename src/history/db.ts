// 기록 DB: 런타임 볼륨의 SQLite 파일 하나(node:sqlite, Node 22.15는 플래그 없이 쓴다).
// events 한 시간축 기록, memories 기억 판본, photos 디스크에 둔 사진(사진 찍기·시험 자료), meta 설정 값.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HistoryKind, HistoryRow } from "../contract/history.js";

export type { HistoryKind, HistoryRow } from "../contract/history.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT, text TEXT NOT NULL, data TEXT);
CREATE INDEX IF NOT EXISTS idx_events_at ON events(at_ms);
CREATE INDEX IF NOT EXISTS idx_events_day_kind ON events(day, kind);
CREATE TABLE IF NOT EXISTS memories (version INTEGER PRIMARY KEY, created_ms INTEGER NOT NULL, day TEXT, applies_day TEXT, kind TEXT NOT NULL, memory TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, at_ms INTEGER NOT NULL, path TEXT NOT NULL, origin TEXT NOT NULL);
`;

/** 기록 날짜의 시간대(분). HISTORY_TZ_MINUTES(기본 540 = 서울). -720~840 사이 정수가 아니면 시작을 막는다. */
export function historyTzMinutes(env: Record<string, string | undefined>): number {
  const raw = env.HISTORY_TZ_MINUTES?.trim();
  if (!raw) return 540;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < -720 || v > 840) throw new Error(`HISTORY_TZ_MINUTES=${raw}: -720~840 사이 정수(분)여야 합니다`);
  return v;
}

export interface HistoryQuery { since?: number; until?: number; kinds?: HistoryKind[]; day?: string; limit?: number }

export class HistoryDb {
  private constructor(readonly db: DatabaseSync, readonly offsetMinutes: number) {}

  static open(path: string, offsetMinutes = 540): HistoryDb {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec(`PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; ${SCHEMA}`);
    return new HistoryDb(db, offsetMinutes);
  }

  ok(): boolean {
    try { return (this.db.prepare("SELECT 1 AS one").get() as { one: number }).one === 1; } catch { return false; }
  }

  /** ms → 기록 시간대의 날짜 YYYY-MM-DD. */
  dayOf(ms: number): string {
    return new Date(ms + this.offsetMinutes * 60_000).toISOString().slice(0, 10);
  }

  add(kind: HistoryKind, atMs: number, text: string, o: { subject?: string; data?: unknown } = {}): void {
    this.db.prepare("INSERT INTO events(at_ms, day, kind, subject, text, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run(atMs, this.dayOf(atMs), kind, o.subject ?? null, text, o.data === undefined ? null : JSON.stringify(o.data));
  }

  /** 시각 순(같으면 넣은 순). limit 기본 10,000. */
  list(q: HistoryQuery): HistoryRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.since !== undefined) { where.push("at_ms >= ?"); args.push(q.since); }
    if (q.until !== undefined) { where.push("at_ms <= ?"); args.push(q.until); }
    if (q.day) { where.push("day = ?"); args.push(q.day); }
    if (q.kinds?.length) { where.push(`kind IN (${q.kinds.map(() => "?").join(",")})`); args.push(...q.kinds); }
    const sql = `SELECT id, at_ms, day, kind, subject, text, data FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY at_ms, id LIMIT ?`;
    const rows = this.db.prepare(sql).all(...args, q.limit ?? 10_000) as unknown as (Omit<HistoryRow, "data"> & { data: string | null })[];
    return rows.map((r) => ({ ...r, data: r.data === null ? null : JSON.parse(r.data) as unknown }));
  }

  close(): void {
    try { this.db.close(); } catch { /* 이미 닫힘 */ }
  }
}
