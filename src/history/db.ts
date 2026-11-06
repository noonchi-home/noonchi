// 기록 DB: 런타임 볼륨의 SQLite 파일 하나(node:sqlite, Node 22.15는 플래그 없이 쓴다). 시간축·기억·사진 표는 G4에서 더한다.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class HistoryDb {
  private constructor(readonly db: DatabaseSync) {}
  static open(path: string): HistoryDb {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    return new HistoryDb(db);
  }
  ok(): boolean {
    try { return (this.db.prepare("SELECT 1 AS one").get() as { one: number }).one === 1; } catch { return false; }
  }
  close(): void {
    try { this.db.close(); } catch { /* 이미 닫힘 */ }
  }
}
