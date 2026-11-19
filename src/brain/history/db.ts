// 기록 DB: 런타임 볼륨의 SQLite 파일 하나(node:sqlite, Node 22.15는 플래그 없이 쓴다).
// events 한 시간축 기록, memories 기억 판본, photos 디스크에 둔 사진(사진 찍기·시험 자료), meta 설정 값,
// bus_seen 기록 노드가 처리한 메시지(다시 와도 한 번만 쓰기), device_last 가전마다 지난 값(가전 기록기가 이전 값·같은 값을 가린다).
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DecisionRow, HistoryKind, HistoryRow } from "../../contract/history.js";

export type { DecisionRow, HistoryKind, HistoryRow } from "../../contract/history.js";

/** 기록 종류 전부(GET /api/history의 kinds 검사). */
export const HISTORY_KINDS: readonly HistoryKind[] = [
  "device", "detection", "vlm", "yolo", "world", "pam_text", "mode", "decision", "plan", "execution", "reflection", "feedback", "photo", "link", "trigger", "look", "thought", "service", "bus_gap", "goal", "planner",
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT, text TEXT NOT NULL, data TEXT);
CREATE INDEX IF NOT EXISTS idx_events_at ON events(at_ms);
CREATE INDEX IF NOT EXISTS idx_events_day_kind ON events(day, kind);
CREATE TABLE IF NOT EXISTS memories (version INTEGER PRIMARY KEY, created_ms INTEGER NOT NULL, day TEXT, applies_day TEXT, kind TEXT NOT NULL, memory TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, at_ms INTEGER NOT NULL, path TEXT NOT NULL, origin TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bus_seen (topic TEXT NOT NULL, grp TEXT NOT NULL, msg_key TEXT NOT NULL, msg TEXT NOT NULL, boot TEXT NOT NULL, PRIMARY KEY (topic, grp, msg_key, msg));
CREATE TABLE IF NOT EXISTS device_last (id TEXT PRIMARY KEY, twin TEXT NOT NULL);
`;

/** 기록 날짜의 시간대(분). HISTORY_TZ_MINUTES(기본 540 = 서울). -720~840 사이 정수가 아니면 시작을 막는다. */
export function historyTzMinutes(env: Record<string, string | undefined>): number {
  const raw = env.HISTORY_TZ_MINUTES?.trim();
  if (!raw) return 540;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < -720 || v > 840) throw new Error(`HISTORY_TZ_MINUTES=${raw}: -720~840 사이 정수(분)여야 합니다`);
  return v;
}

/** latest면 조건에 맞는 마지막 limit줄(시각 순으로 돌려줌). 아니면 처음부터 limit줄. */
export interface HistoryQuery { since?: number; until?: number; kinds?: HistoryKind[]; day?: string; limit?: number; latest?: boolean }

/** 기록 노드가 처리한 메시지 하나: 토픽·그룹·봉투 열쇠·메시지 식별자(msgId)·기동. */
export interface SeenKey { topic: string; group: string; key: string; msg: string; boot: string }

/** 디스크에 둔 사진: photo 폰 사진 찍기, dataset DATASET_COLLECT=1일 때의 시험 자료. */
export interface StoredPhoto { id: string; atMs: number; path: string; origin: "photo" | "dataset" }

/** 기억 판본 하나. appliesDay는 쓰기 시작하는 날(seed는 null). */
export type MemorySource = "seed" | "reflection" | "synthetic";
/** 기억 종류: 실행 기억(list·fsm, 판단이 PAM에 보내는 것)과 후보 판본(fsm_candidates, 반성이 낸 후보 FSM. 다음 밤 반성 입력으로만 읽는다). */
export type MemoryKind = "list" | "fsm" | "fsm_candidates";
/** 실행 기억 판본 하나. day: 그 판본을 만든 반성의 날(seed는 null). */
export interface MemoryVersion { version: number; kind: "list" | "fsm"; memory: unknown; appliesDay: string | null; source: MemorySource; day: string | null }
/** 후보 판본 하나(fsm_candidates). */
export interface CandidateVersion { version: number; kind: "fsm_candidates"; memory: unknown; appliesDay: string | null; source: MemorySource; day: string | null }
type RawMemory = { version: number; kind: MemoryKind; memory: string; applies_day: string | null; source: MemorySource; day: string | null };
const memoryRow = <T extends MemoryVersion | CandidateVersion>(r: RawMemory): T => ({ version: r.version, kind: r.kind, memory: JSON.parse(r.memory) as unknown, appliesDay: r.applies_day, source: r.source, day: r.day }) as T;
/** 실행 기억만 고르는 조건(후보 판본은 판단 기억으로 뽑히지 않는다). */
const EXEC = "kind != 'fsm_candidates'";

type RawRow = Omit<HistoryRow, "data"> & { data: string | null };
const parseRow = (r: RawRow): HistoryRow => ({ ...r, data: r.data === null ? null : JSON.parse(r.data) as unknown });

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
    const order = q.latest ? "at_ms DESC, id DESC" : "at_ms, id";
    const sql = `SELECT id, at_ms, day, kind, subject, text, data FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ?`;
    const rows = (this.db.prepare(sql).all(...args, q.limit ?? 10_000) as unknown as RawRow[]).map(parseRow);
    return q.latest ? rows.reverse() : rows;
  }

  /** 기억 판본을 저장하고 새 번호를 돌려준다(1부터). appliesDay가 없으면(seed) 어느 날에나 쓸 수 있다. synthetic은 합성 기록(scripts/seed-history.ts)이다. */
  saveMemory(m: { kind: MemoryKind; memory: unknown; day: string | null; appliesDay: string | null; source: MemorySource }): number {
    const next = (this.db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM memories").get() as { v: number }).v;
    this.db.prepare("INSERT INTO memories(version, created_ms, day, applies_day, kind, memory, source) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(next, Date.now(), m.day, m.appliesDay, m.kind, JSON.stringify(m.memory), m.source);
    return next;
  }

  /** 그날 쓸 수 있는 실행 기억 판본(applies_day가 없거나 그날 이전) 중 가장 새 것. */
  memoryFor(day: string): MemoryVersion | null {
    const r = this.db.prepare(`SELECT version, kind, memory, applies_day, source, day FROM memories WHERE ${EXEC} AND (applies_day IS NULL OR applies_day <= ?) ORDER BY version DESC LIMIT 1`).get(day);
    return r ? memoryRow<MemoryVersion>(r as RawMemory) : null;
  }

  /** 가장 새 실행 기억 판본 번호(언제부터 쓰는지와 상관없이). 없으면 null. */
  latestMemoryVersion(): number | null {
    return (this.db.prepare(`SELECT MAX(version) AS v FROM memories WHERE ${EXEC}`).get() as { v: number | null }).v;
  }

  /** 실행 기억 판본 하나(후보 판본 번호면 null). */
  memoryVersion(version: number): MemoryVersion | null {
    const r = this.db.prepare(`SELECT version, kind, memory, applies_day, source, day FROM memories WHERE version = ? AND ${EXEC}`).get(version);
    return r ? memoryRow<MemoryVersion>(r as RawMemory) : null;
  }

  /** 실행 기억 판본 전부(번호 차례). */
  memoryVersions(): MemoryVersion[] {
    return (this.db.prepare(`SELECT version, kind, memory, applies_day, source, day FROM memories WHERE ${EXEC} ORDER BY version`).all() as unknown as RawMemory[]).map((r) => memoryRow<MemoryVersion>(r));
  }

  /** 그날 이전에 저장한 가장 새 후보 판본(applies_day가 없거나 그날 이전): 그날 밤 반성의 입력. 없으면 null. */
  candidatesFor(day: string): CandidateVersion | null {
    const r = this.db.prepare("SELECT version, kind, memory, applies_day, source, day FROM memories WHERE kind = 'fsm_candidates' AND (applies_day IS NULL OR applies_day <= ?) ORDER BY version DESC LIMIT 1").get(day);
    return r ? memoryRow<CandidateVersion>(r as RawMemory) : null;
  }

  /** 밤 저장 하나(BEGIN IMMEDIATE): 로봇 판본·후보 판본·반성 기록을 함께 쓰고, 어느 하나라도 던지면 모두 되돌린 뒤 다시 던진다.
   *  reflection은 로봇 판본 번호로 반성 기록 줄(시각·글·data)을 만든다. */
  saveNight(o: { day: string; appliesDay: string; robot: unknown; candidates: unknown; reflection: (robot: number) => { atMs: number; text: string; data: unknown } }): { robot: number; candidates: number } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const robot = this.saveMemory({ kind: "fsm", memory: o.robot, day: o.day, appliesDay: o.appliesDay, source: "reflection" });
      const candidates = this.saveMemory({ kind: "fsm_candidates", memory: o.candidates, day: o.day, appliesDay: o.appliesDay, source: "reflection" });
      const r = o.reflection(robot);
      this.add("reflection", r.atMs, r.text, { data: r.data });
      this.db.exec("COMMIT");
      return { robot, candidates };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** 그날까지 기록이 있는 날(차례). kinds가 없으면 모든 종류. */
  daysUpTo(day: string, kinds: readonly HistoryKind[] = ["detection", "world", "device", "vlm", "yolo", "decision", "execution", "feedback"]): string[] {
    return (this.db.prepare(`SELECT DISTINCT day FROM events WHERE day <= ? AND kind IN (${kinds.map(() => "?").join(",")}) ORDER BY day`).all(day, ...kinds) as { day: string }[]).map((r) => r.day);
  }

  /** 그날 판단에 고정한 판본(meta memory_day:<날짜>). */
  pinnedMemory(day: string): number | null {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(`memory_day:${day}`) as { value: string } | undefined;
    return r ? Number(r.value) : null;
  }

  /** 그날 판본을 고정한다. 이미 고정한 날은 바꾸지 않는다. replace면 바꾼다(코드의 seed가 바뀌어 seed 판본을 올릴 때만, src/brain/history/reflect.ts). */
  pinMemory(day: string, version: number, replace = false): void {
    const kind = (this.db.prepare("SELECT kind FROM memories WHERE version = ?").get(version) as { kind: MemoryKind } | undefined)?.kind;
    if (kind === "fsm_candidates") throw new Error(`memory ${version}: not an execution memory`);
    this.db.prepare(`INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO ${replace ? "UPDATE SET value = excluded.value" : "NOTHING"}`).run(`memory_day:${day}`, String(version));
  }


  /** 디스크에 둔 사진 하나(photo 사진 찍기, dataset 시험 자료). 보관 기간이 지나면 retention.sweep이 지운다. */
  addPhoto(p: StoredPhoto): void {
    this.db.prepare("INSERT OR REPLACE INTO photos(id, at_ms, path, origin) VALUES (?, ?, ?, ?)").run(p.id, p.atMs, p.path, p.origin);
  }

  listPhotos(): StoredPhoto[] {
    return (this.db.prepare("SELECT id, at_ms, path, origin FROM photos ORDER BY at_ms, id").all() as unknown as { id: string; at_ms: number; path: string; origin: StoredPhoto["origin"] }[])
      .map((r) => ({ id: r.id, atMs: r.at_ms, path: r.path, origin: r.origin }));
  }

  removePhoto(id: string): void {
    this.db.prepare("DELETE FROM photos WHERE id = ?").run(id);
  }

  /** 그날 종류별 줄 수. */
  counts(day: string): Partial<Record<HistoryKind, number>> {
    const rows = this.db.prepare("SELECT kind, COUNT(*) AS n FROM events WHERE day = ? GROUP BY kind").all(day) as unknown as { kind: HistoryKind; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
  }

  /** 그날 분석 수: VLM 답(vlm 줄 중 이유 없음), VLM 분석 없음(이유 있는 vlm 줄 + VLM도 못 한 yolo 줄), YOLO 분석 없음(yolo 줄). */
  analysisTally(day: string): { vlm: number; vlmMissing: number; yoloMissing: number } {
    const r = this.db.prepare(`SELECT
      COALESCE(SUM(kind = 'vlm' AND json_extract(data, '$.missing') IS NULL), 0) AS vlm,
      COALESCE(SUM((kind = 'vlm' AND json_extract(data, '$.missing') IS NOT NULL) OR (kind = 'yolo' AND json_extract(data, '$.vlm_missing') IS NOT NULL)), 0) AS vlm_missing,
      COALESCE(SUM(kind = 'yolo'), 0) AS yolo_missing
      FROM events WHERE day = ? AND kind IN ('vlm', 'yolo')`).get(day) as { vlm: number; vlm_missing: number; yolo_missing: number };
    return { vlm: r.vlm, vlmMissing: r.vlm_missing, yoloMissing: r.yolo_missing };
  }

  /** 최근 판단 limit개(시각 순)와 그때 보낸 관찰 텍스트(같은 번호·같은 시각의 pam_text). */
  decisions(limit: number): DecisionRow[] {
    const rows = this.db.prepare(`SELECT d.*, (SELECT p.text FROM events p WHERE p.kind = 'pam_text' AND p.subject = d.subject AND p.at_ms = d.at_ms ORDER BY p.id DESC LIMIT 1) AS text_sent
      FROM (SELECT * FROM events WHERE kind = 'decision' ORDER BY at_ms DESC, id DESC LIMIT ?) d ORDER BY d.at_ms, d.id`).all(limit) as unknown as (RawRow & { text_sent: string | null })[];
    return rows.map((raw) => {
      const r = parseRow(raw);
      const d = (r.data ?? {}) as Partial<Pick<DecisionRow, "seq" | "status" | "prediction" | "memory_version" | "world">>;
      return {
        id: r.subject ?? "", at_ms: r.at_ms, day: r.day, text: r.text, text_sent: raw.text_sent, seq: d.seq ?? 0, status: d.status ?? "failed",
        prediction: d.prediction ?? null, memory_version: d.memory_version ?? 0, world: d.world ?? null,
      };
    });
  }

  /** 합성 기록(scripts/seed-history.ts)만 지운다: data.synthetic이 참인 줄, source가 synthetic인 기억 판본, 그 판본에 고정한 날·넣은 seed 바뀜 표시. 지운 수를 돌려준다. */
  removeSynthetic(): { events: number; memories: number; pins: number } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const versions = (this.db.prepare("SELECT version FROM memories WHERE source = 'synthetic'").all() as { version: number }[]).map((r) => String(r.version));
      const pins = versions.length
        ? Number(this.db.prepare(`DELETE FROM meta WHERE key LIKE 'memory_day:%' AND value IN (${versions.map(() => "?").join(",")})`).run(...versions).changes)
        : 0;
      // 합성 판본에 넣은 seed 바뀜 표시도 지운다(새 합성 기록에 다시 넣는다)
      if (versions.length) this.db.prepare(`DELETE FROM meta WHERE key LIKE 'seed_patch:%' AND value IN (${versions.map(() => "?").join(",")})`).run(...versions);
      const memories = Number(this.db.prepare("DELETE FROM memories WHERE source = 'synthetic'").run().changes);
      const events = Number(this.db.prepare("DELETE FROM events WHERE json_extract(data, '$.synthetic') = 1").run().changes);
      this.db.exec("COMMIT");
      return { events, memories, pins };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** 메시지 하나를 한 번만 쓴다: 처리표에 넣고 write(같은 연결의 add 등)를 한 트랜잭션으로. 이미 처리했으면 쓰지 않고 false.
   *  write가 던지면 처리표 줄까지 되돌리고 다시 던진다. */
  once(k: SeenKey, write: () => void): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const fresh = Number(this.db.prepare("INSERT OR IGNORE INTO bus_seen(topic, grp, msg_key, msg, boot) VALUES (?, ?, ?, ?, ?)").run(k.topic, k.group, k.key, k.msg, k.boot).changes) > 0;
      if (fresh) write();
      this.db.exec(fresh ? "COMMIT" : "ROLLBACK");
      return fresh;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** 다른 기동의 처리표 줄을 지운다(기록 노드가 시작할 때). */
  forgetOtherBoots(boot: string): void {
    this.db.prepare("DELETE FROM bus_seen WHERE boot <> ?").run(boot);
  }

  /** 가전의 지난 값(없으면 null). */
  deviceLast(id: string): Record<string, unknown> | null {
    const r = this.db.prepare("SELECT twin FROM device_last WHERE id = ?").get(id) as { twin: string } | undefined;
    return r ? JSON.parse(r.twin) as Record<string, unknown> : null;
  }

  setDeviceLast(id: string, twin: Record<string, unknown>): void {
    this.db.prepare("INSERT INTO device_last(id, twin) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET twin = excluded.twin").run(id, JSON.stringify(twin));
  }

  close(): void {
    try { this.db.close(); } catch { /* 이미 닫힘 */ }
  }
}
