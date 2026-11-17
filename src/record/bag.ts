// bag.ts — 녹화 파일(SQLite, node:sqlite): 도착 차례(arrival)·도착 시각(arrival_ms, 기록 노드 시계)·발행 시각·토픽·봉투.
// 사진 칸(TOPICS의 photo)은 빼고 남긴다. 같은 메시지(토픽·msgId)는 한 번만 남긴다.
import { DatabaseSync } from "node:sqlite";
import { TOPICS, decode, msgId, type Envelope, type TopicName } from "../bus/index.js";

export class Bag {
  private constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS bag (arrival INTEGER PRIMARY KEY AUTOINCREMENT, arrival_ms INTEGER NOT NULL, stamp INTEGER NOT NULL,
      topic TEXT NOT NULL, msg TEXT NOT NULL, raw TEXT NOT NULL, UNIQUE (topic, msg));
      CREATE INDEX IF NOT EXISTS bag_time ON bag(arrival_ms, arrival);`);
  }
  static open(path: string): Bag { return new Bag(new DatabaseSync(path)); }

  write(e: Envelope<TopicName>, arrivalMs: number): void {
    const photo = (TOPICS[e.topic] as { photo?: string }).photo;
    const body = photo ? Object.fromEntries(Object.entries(e.body as Record<string, unknown>).filter(([k]) => k !== photo)) : e.body;
    const h = e.header;
    this.db.prepare("INSERT OR IGNORE INTO bag (arrival_ms, stamp, topic, msg, raw) VALUES (?, ?, ?, ?, ?)")
      .run(arrivalMs, h.stamp, e.topic, msgId(h), JSON.stringify({ key: e.key, header: h, body }));
  }

  /** from ≤ 도착 시각 < to, 도착 차례로. 사진 토픽은 돌려주지 않는다(되살릴 사진이 없다). */
  range(from: number, to: number, o: { topics?: readonly TopicName[] } = {}): { e: Envelope<TopicName>; arrivalMs: number }[] {
    const rows = this.db.prepare("SELECT arrival_ms, topic, raw FROM bag WHERE arrival_ms >= ? AND arrival_ms < ? ORDER BY arrival").all(from, to) as { arrival_ms: number; topic: TopicName; raw: string }[];
    return rows
      .filter((r) => !(TOPICS[r.topic] as { photo?: string }).photo && (!o.topics || o.topics.includes(r.topic)))
      .map((r) => ({ e: decode(r.topic, r.raw), arrivalMs: r.arrival_ms }));
  }

  close(): void { this.db.close(); }
}
