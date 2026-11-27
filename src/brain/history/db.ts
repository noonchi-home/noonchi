// 기록 DB: 런타임 볼륨의 SQLite 파일 하나(node:sqlite, Node 22.15는 플래그 없이 쓴다).
// events 한 시간축 기록, memories 기억 판본, photos 디스크에 둔 사진(사진 찍기·시험 자료), meta 설정 값,
// bus_seen 기록 노드가 처리한 메시지(다시 와도 한 번만 쓰기), device_last 가전마다 지난 값(가전 기록기가 이전 값·같은 값을 가린다).
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CupAnswers } from "./cup-answer.js";
import type { DecisionRow, HistoryKind, HistoryRow } from "../../contract/history.js";
import type { AssistanceOutcome } from "../../contract/assistance-outcome.js";
import type { BeerEvent, BeerRule } from "../../contract/beer.js";
import { interventionChanges, type CurrentIntervention, type HabitContext, type Intervention, type InterventionPreference } from "./intervention.js";

export type { DecisionRow, HistoryKind, HistoryRow } from "../../contract/history.js";

/** 기록 종류 전부(GET /api/history의 kinds 검사). */
export const HISTORY_KINDS: readonly HistoryKind[] = [
  "device", "detection", "vlm", "yolo", "world", "pam_text", "mode", "decision", "plan", "execution", "reflection", "feedback", "photo", "link", "trigger", "look", "thought", "service", "bus_gap", "goal", "planner", "person", "robot", "safety", "manager", "household", "help", "assistance_outcome",
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT, text TEXT NOT NULL, data TEXT);
CREATE INDEX IF NOT EXISTS idx_events_at ON events(at_ms);
CREATE INDEX IF NOT EXISTS idx_household_photos_at ON events(at_ms) WHERE kind='household' AND json_extract(data,'$.event')='photo';
CREATE INDEX IF NOT EXISTS idx_events_day_kind ON events(day, kind);
CREATE INDEX IF NOT EXISTS idx_help_at ON events(at_ms) WHERE kind='help';
CREATE TABLE IF NOT EXISTS memories (version INTEGER PRIMARY KEY, created_ms INTEGER NOT NULL, day TEXT, applies_day TEXT, kind TEXT NOT NULL, memory TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, at_ms INTEGER NOT NULL, path TEXT NOT NULL, origin TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bus_seen (topic TEXT NOT NULL, grp TEXT NOT NULL, msg_key TEXT NOT NULL, msg TEXT NOT NULL, boot TEXT NOT NULL, PRIMARY KEY (topic, grp, msg_key, msg));
CREATE TABLE IF NOT EXISTS device_last (id TEXT PRIMARY KEY, twin TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assistance_seen (home TEXT NOT NULL, boot TEXT NOT NULL, home_epoch TEXT NOT NULL, attempt_id TEXT NOT NULL, PRIMARY KEY (home, boot, home_epoch, attempt_id));
CREATE INDEX IF NOT EXISTS idx_assistance_outcome_day ON events(day, at_ms) WHERE kind = 'assistance_outcome';
CREATE INDEX IF NOT EXISTS idx_beer_observation_day ON events(day, at_ms) WHERE kind = 'household' AND json_extract(data, '$.event') = 'beer_observation';
CREATE TABLE IF NOT EXISTS beer_rules (version INTEGER PRIMARY KEY, rules TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assistance_nights (day TEXT PRIMARY KEY, robot INTEGER NOT NULL, candidates INTEGER NOT NULL, result TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS intervention_preferences (
  home TEXT NOT NULL, user TEXT NOT NULL, action TEXT NOT NULL, context TEXT NOT NULL,
  at_ms INTEGER NOT NULL, origin_id TEXT NOT NULL, PRIMARY KEY (home, user, action, context, origin_id)
);
CREATE TABLE IF NOT EXISTS intervention_policy (
  home TEXT NOT NULL, user TEXT NOT NULL, action TEXT NOT NULL, context TEXT NOT NULL,
  applies_day TEXT NOT NULL, version INTEGER NOT NULL, policy TEXT NOT NULL,
  PRIMARY KEY (home, user, action, context, applies_day, version)
);
CREATE TABLE IF NOT EXISTS cup_answers (
  home TEXT NOT NULL, resident TEXT NOT NULL, discard_leftover_cup INTEGER NOT NULL CHECK(discard_leftover_cup IN (0,1)),
  single_demo INTEGER NOT NULL DEFAULT 0 CHECK(single_demo IN (0,1)), PRIMARY KEY(home, resident)
);
CREATE UNIQUE INDEX IF NOT EXISTS single_demo_resident ON cup_answers(home) WHERE single_demo = 1;
CREATE TABLE IF NOT EXISTS day_skips (at_ms INTEGER PRIMARY KEY, from_day TEXT NOT NULL UNIQUE, to_day TEXT NOT NULL UNIQUE);
`;

/** 기록 날짜의 시간대(분). HISTORY_TZ_MINUTES(기본 540 = 서울). -720~840 사이 정수가 아니면 시작을 막는다. */
export function historyTzMinutes(env: Record<string, string | undefined>): number {
  const raw = env.HISTORY_TZ_MINUTES?.trim();
  if (!raw) return 540;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < -720 || v > 840) throw new Error(`HISTORY_TZ_MINUTES=${raw}: -720~840 사이 정수(분)여야 합니다`);
  return v;
}

/** 날짜 글 계산(YYYY-MM-DD에 n일). 넘긴 날도 하루씩 이어진 글이다. */
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** 넘김을 빼고 본 달력 날짜(기록 시간대). */
export const calendarDay = (ms: number, offsetMinutes: number): string => new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10);
/** 그날까지 days일(그날 포함) 창: 첫날 시작 ~ 그날 끝 바로 전(ms). 넘긴 날도 맞다. */
export function dayWindow(db: Pick<HistoryDb, "rangeOf">, day: string, days: number): { since: number; until: number } {
  return { since: db.rangeOf(addDays(day, -(days - 1))).start, until: db.rangeOf(day).end - 1 };
}
/** 하루 넘김 한 번(「하루 마치기」, src/server/finish-day.ts). */
export interface DaySkip { atMs: number; from: string; to: string }

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
  readonly cupAnswers: CupAnswers;
  private constructor(readonly db: DatabaseSync, readonly offsetMinutes: number) {
    this.cupAnswers = new CupAnswers(db);
  }

  /** readOnly: 서버 메인 스레드의 읽기 연결(쓰기는 기록 작업 스레드만 한다, src/record/thread-writer.ts). 쓰면 SQLite가 오류를 던진다.
   *  읽기 전용은 표를 만들지 않으므로 쓰기 연결이 먼저 연 파일에만 쓴다. */
  static open(path: string, offsetMinutes = 540, o: { readOnly?: boolean } = {}): HistoryDb {
    if (o.readOnly) {
      const db = new DatabaseSync(path, { readOnly: true });
      db.exec("PRAGMA busy_timeout = 5000");
      return new HistoryDb(db, offsetMinutes);
    }
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec(`PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; ${SCHEMA}`);
    return new HistoryDb(db, offsetMinutes);
  }

  /** 파일과 표를 만든다(쓰기 연결을 열었다 바로 닫는다). 서버는 돌기 전에 한 번 부르고, 그 뒤 메인 스레드는 읽기 전용으로만 연다. */
  static create(path: string): void {
    HistoryDb.open(path).close();
  }

  #depth = 0;
  /** fn을 트랜잭션 하나로 감싼다: 바깥이면 BEGIN IMMEDIATE … COMMIT, 이미 트랜잭션 안이면 SAVEPOINT(기록 작업 스레드가 묶음 안 일마다 나눈다).
   *  fn이 던지면 그 안에서 쓴 것만 되돌리고 다시 던진다. 바깥 COMMIT이 실패해도 되돌리고 던진다. */
  tx<T>(fn: () => T): T {
    const name = `tx${this.#depth}`;
    const outer = this.#depth === 0;
    this.db.exec(outer ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
    this.#depth++;
    let value: T;
    try {
      value = fn();
    } catch (e) {
      this.#depth--;
      this.db.exec(outer ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
      throw e;
    }
    this.#depth--;
    try {
      this.db.exec(outer ? "COMMIT" : `RELEASE ${name}`);
    } catch (e) {
      // COMMIT이 실패하면(잠김 등) 트랜잭션이 열린 채 남는다. 이미 닫혔으면 ROLLBACK이 던지니 삼킨다
      if (outer) try { this.db.exec("ROLLBACK"); } catch { /* 열린 트랜잭션 없음 */ }
      throw e;
    }
    return value;
  }

  ok(): boolean {
    try { return (this.db.prepare("SELECT 1 AS one").get() as { one: number }).one === 1; } catch { return false; }
  }

  #skipCount: ReturnType<DatabaseSync["prepare"]> | null = null;

  /** ms → 시스템 날짜 YYYY-MM-DD: 기록 시간대의 달력 날짜 + 그 시각까지 한 넘김 수(day_skips). 옛 시각은 그때 날짜다.
   *  읽기 전용 연결도 매번 표를 읽어 넘긴 뒤 다시 열 일이 없다. */
  dayOf(ms: number): string {
    const n = (this.#skipCount ??= this.db.prepare("SELECT COUNT(*) AS n FROM day_skips WHERE at_ms <= ?")).get(ms) as { n: number };
    return addDays(calendarDay(ms, this.offsetMinutes), n.n);
  }

  /** 넘김 전부(시각 차례). */
  skips(): DaySkip[] {
    return this.db.prepare(`SELECT at_ms AS atMs, from_day AS "from", to_day AS "to" FROM day_skips ORDER BY at_ms`).all() as unknown as DaySkip[];
  }

  /** 그날의 [시작, 끝) ms. 넘긴 날은 넘긴 때 시작하고 그다음 달력 자정에 끝난다. */
  rangeOf(day: string): { start: number; end: number } {
    return { start: this.startOf(day), end: this.startOf(addDays(day, 1)) };
  }

  /** dayOf가 처음 day가 되는 ms. 넘김 사이 구간마다, 그 구간의 넘김 수를 뺀 날의 자정과 구간 시작 가운데 늦은 쪽을 본다. */
  private startOf(day: string): number {
    const skips = this.skips();
    for (let i = 0; i <= skips.length; i++) {
      const lo = i === 0 ? -Infinity : skips[i - 1]!.atMs;
      const hi = i === skips.length ? Infinity : skips[i]!.atMs;
      const first = Math.max(lo, Date.parse(`${addDays(day, -i)}T00:00:00Z`) - this.offsetMinutes * 60_000);
      if (first < hi) return first;
    }
    return Infinity;
  }

  /** atMs에 from을 마치고 다음 날로 넘긴다(한 트랜잭션). atMs의 날이 from이 아니면 던진다(두 번 누름).
   *  같은 묶음에서 먼저 들어간, atMs 뒤 from 줄도 새 날로 고친다(events.day = dayOf(at_ms)가 늘 맞게). */
  skipDay(atMs: number, from: string): { from: string; to: string } {
    return this.tx(() => {
      const today = this.dayOf(atMs);
      if (today !== from) throw new Error(`오늘은 ${today}이에요(받은 날 ${from})`);
      const to = addDays(from, 1);
      this.db.prepare("INSERT INTO day_skips (at_ms, from_day, to_day) VALUES (?, ?, ?)").run(atMs, from, to);
      this.db.prepare("UPDATE events SET day = ? WHERE at_ms >= ? AND day = ?").run(to, atMs, from);
      return { from, to };
    });
  }

  /** 시간축 한 줄 넣기는 프레임마다 여러 번 불린다. 문장은 한 번만 준비하고, 그 한 줄만 디스크 동기화 없이(NORMAL) 넣은 뒤 FULL로 돌린다.
   *  줄마다 동기화하면 엔진 프레임 → 집 상태 지연에 약 3ms가 더해진다. 정전 때 잃을 수 있는 것은 마지막 디스크 동기화 뒤에 넣은
   *  시간축 줄들이다. 기억·컵 답 같은 다른 쓰기는 FULL 그대로이고, 그 커밋이 앞선 시간축 줄도 함께 동기화한다.
   *  트랜잭션 안에서는 이 설정을 바꿀 수 없다: 그때는 그대로 넣고, 그 트랜잭션의 커밋(FULL)이 동기화한다.
   *  설정은 매번 exec로 바꾼다: 준비해 둔 PRAGMA 문장은 준비할 때 적용되고 다시 실행해도 적용되지 않을 때가 있다(첫 줄이 FULL로 들어갔다). */
  #insert: ReturnType<DatabaseSync["prepare"]> | null = null;

  add(kind: HistoryKind, atMs: number, text: string, o: { subject?: string; data?: unknown } = {}): void {
    let relaxed = false;
    try {
      this.db.exec("PRAGMA synchronous = NORMAL");
      relaxed = true;
    } catch {
      // 트랜잭션 안: FULL 그대로 넣는다
    }
    try {
      (this.#insert ??= this.db.prepare("INSERT INTO events(at_ms, day, kind, subject, text, data) VALUES (?, ?, ?, ?, ?, ?)"))
        .run(atMs, this.dayOf(atMs), kind, o.subject ?? null, text, o.data === undefined ? null : JSON.stringify(o.data));
    } finally {
      if (relaxed) this.db.exec("PRAGMA synchronous = FULL");
    }
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
    const next = this.nextMemoryVersion();
    this.db.prepare("INSERT INTO memories(version, created_ms, day, applies_day, kind, memory, source) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(next, Date.now(), m.day, m.appliesDay, m.kind, JSON.stringify(m.memory), m.source);
    return next;
  }

  /** 다음에 저장할 기억 판본 번호(후보 판본까지 센다). */
  nextMemoryVersion(): number {
    return (this.db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM memories").get() as { v: number }).v;
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
  saveNight(o: { day: string; appliesDay: string; robot: unknown; candidates: unknown; kind?: "list" | "fsm"; pin?: () => void; beerRules?: readonly BeerRule[];
    reflection: (robot: number) => { atMs: number; text: string; data: unknown } }): { robot: number; candidates: number } {
    return this.tx(() => {
      const saved = this.night(o.day);
      if (saved) return { robot: saved.robot, candidates: saved.candidates };
      o.pin?.();
      const robot = this.saveMemory({ kind: o.kind ?? "fsm", memory: o.robot, day: o.day, appliesDay: o.appliesDay, source: "reflection" });
      const candidates = o.kind === "list" ? 0
        : this.saveMemory({ kind: "fsm_candidates", memory: o.candidates, day: o.day, appliesDay: o.appliesDay, source: "reflection" });
      const firstDay = addDays(o.day, -29);
      const rows = (this.db.prepare(`SELECT id, at_ms, day, kind, subject, text, data FROM events
        WHERE kind = 'assistance_outcome' AND day BETWEEN ? AND ? ORDER BY at_ms, id`).all(firstDay, o.day) as unknown as RawRow[]).map(parseRow);
      const preferences = this.db.prepare(`SELECT home, user, action, context, at_ms AS atMs, origin_id AS originId
        FROM intervention_preferences WHERE at_ms < ? ORDER BY at_ms, origin_id`).all(this.rangeOf(o.day).end) as unknown as InterventionPreference[];
      const changes = interventionChanges(rows, preferences, scope => this.interventionAt(scope.home, scope.user, scope, o.day), ms => this.dayOf(ms));
      const insert = this.db.prepare("INSERT INTO intervention_policy (home, user, action, context, applies_day, version, policy) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const change of changes) insert.run(change.home, change.user, change.action, change.context, o.appliesDay, robot, change.policy);
      if (o.beerRules?.length) this.db.prepare("INSERT INTO beer_rules (version, rules) VALUES (?, ?)").run(robot, JSON.stringify(o.beerRules));
      const r = o.reflection(robot);
      this.add("reflection", r.atMs, r.text, { data: r.data });
      this.db.prepare("INSERT INTO assistance_nights (day, robot, candidates, result) VALUES (?, ?, ?, ?)")
        .run(o.day, robot, candidates, JSON.stringify(r.data));
      return { robot, candidates };
    });
  }

  beerEvents(firstDay: string, lastDay: string): BeerEvent[] {
    const rows = this.db.prepare(`SELECT data FROM events
      WHERE kind = 'household' AND json_extract(data, '$.event') = 'beer_observation' AND day BETWEEN ? AND ?
      ORDER BY at_ms, id`).all(firstDay, lastDay) as { data: string }[];
    return rows.map(row => (JSON.parse(row.data) as { observation: BeerEvent }).observation);
  }

  beerRules(version: number): BeerRule[] {
    const row = this.db.prepare("SELECT rules FROM beer_rules WHERE version = ?").get(version) as { rules: string } | undefined;
    return row ? JSON.parse(row.rules) as BeerRule[] : [];
  }

  night(day: string): { robot: number; candidates: number; result: unknown } | null {
    const row = this.db.prepare("SELECT robot, candidates, result FROM assistance_nights WHERE day = ?").get(day) as
      { robot: number; candidates: number; result: string } | undefined;
    return row ? { ...row, result: JSON.parse(row.result) as unknown } : null;
  }

  policyFor(home: string, user: string | null, habit: HabitContext, day: string): Intervention {
    return this.interventionAt(home, user, habit, day)?.policy ?? "default";
  }

  private interventionAt(home: string, user: string | null, habit: HabitContext, day: string): CurrentIntervention | null {
    if (!user || !habit.context) return null;
    const version = this.pinnedMemory(day) ?? this.memoryFor(day)?.version;
    if (version === undefined) return null;
    const row = this.db.prepare(`SELECT policy, applies_day AS appliesDay FROM intervention_policy
      WHERE home = ? AND user = ? AND action = ? AND context = ? AND applies_day <= ? AND version <= ?
      ORDER BY applies_day DESC, version DESC LIMIT 1`).get(home, user, habit.action, habit.context, day, version) as CurrentIntervention | undefined;
    return row ?? null;
  }

  hasInterventionPreference(day: string): boolean {
    const { start, end } = this.rangeOf(day);
    return !!this.db.prepare("SELECT 1 FROM intervention_preferences WHERE at_ms >= ? AND at_ms < ? LIMIT 1").get(start, end);
  }

  recordInterventionPreference(p: InterventionPreference): boolean {
    if (!p.originId || !Number.isSafeInteger(p.atMs) || this.policyFor(p.home, p.user, p, this.dayOf(p.atMs)) !== "defer_proactive") return false;
    const row = this.db.prepare(`INSERT INTO intervention_preferences (home, user, action, context, at_ms, origin_id)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(p.home, p.user, p.action, p.context, p.atMs, p.originId);
    return row.changes > 0;
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

  removeExpiredHouseholdPhotos(cutoffMs: number): void {
    this.db.prepare("DELETE FROM events WHERE kind='household' AND json_extract(data,'$.event')='photo' AND at_ms <= ?").run(cutoffMs);
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
    return this.tx(() => {
      const versions = (this.db.prepare("SELECT version FROM memories WHERE source = 'synthetic'").all() as { version: number }[]).map((r) => String(r.version));
      const pins = versions.length
        ? Number(this.db.prepare(`DELETE FROM meta WHERE key LIKE 'memory_day:%' AND value IN (${versions.map(() => "?").join(",")})`).run(...versions).changes)
        : 0;
      // 합성 판본에 넣은 seed 바뀜 표시도 지운다(새 합성 기록에 다시 넣는다)
      if (versions.length) this.db.prepare(`DELETE FROM meta WHERE key LIKE 'seed_patch:%' AND value IN (${versions.map(() => "?").join(",")})`).run(...versions);
      const memories = Number(this.db.prepare("DELETE FROM memories WHERE source = 'synthetic'").run().changes);
      const events = Number(this.db.prepare("DELETE FROM events WHERE json_extract(data, '$.synthetic') = 1").run().changes);
      return { events, memories, pins };
    });
  }

  /** Called inside the recorder's envelope transaction, before it acknowledges delivery. */
  recordAssistanceOutcome(outcome: AssistanceOutcome): void {
    const added = this.db.prepare("INSERT INTO assistance_seen(home, boot, home_epoch, attempt_id) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
      .run(outcome.home, outcome.key.boot, outcome.key.homeEpoch, outcome.key.attemptId).changes;
    if (added) this.add("assistance_outcome", outcome.endedMs, `${outcome.action} · ${outcome.execution} · ${outcome.reaction}`,
      { subject: outcome.key.attemptId, data: outcome });
  }

  /** 메시지 하나를 한 번만 쓴다: 처리표에 넣고 write(같은 연결의 add 등)를 한 트랜잭션으로(이미 트랜잭션 안이면 SAVEPOINT). 이미 처리했으면 쓰지 않고 false.
   *  write가 던지면 처리표 줄까지 되돌리고 다시 던진다. */
  once(k: SeenKey, write: () => void): boolean {
    return this.tx(() => {
      const fresh = Number(this.db.prepare("INSERT OR IGNORE INTO bus_seen(topic, grp, msg_key, msg, boot) VALUES (?, ?, ?, ?, ?)").run(k.topic, k.group, k.key, k.msg, k.boot).changes) > 0;
      if (fresh) write();
      return fresh;
    });
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
