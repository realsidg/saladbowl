import { DatabaseSync } from "node:sqlite"
import { MIGRATIONS } from "./migrations.js"

export type Db = DatabaseSync

export function openDb(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)")
  const done = new Set((db.prepare("SELECT name FROM migrations").all() as { name: string }[]).map((r) => r.name))
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue
    db.exec("BEGIN")
    try {
      db.exec(m.sql)
      db.prepare("INSERT INTO migrations (name, applied_at) VALUES (?, ?)").run(m.name, Date.now())
      db.exec("COMMIT")
    } catch (e) {
      db.exec("ROLLBACK")
      throw e
    }
  }
  return db
}
