import { randomBytes } from "node:crypto"
import type { Db } from "./db.js"

export interface SessionRow {
  id: string
  role: "host" | "player"
  gameId: string | null
  playerId: string | null
  expiresAt: number
}

export interface SessionStore {
  create(row: { role: "host" | "player"; gameId?: string; playerId?: string; expiresAt: number }): string
  get(id: string, now: number): SessionRow | null
  delete(id: string): void
  deleteForPlayer(gameId: string, playerId: string): void
  deleteExpired(now: number): number
}

export function sessionStore(db: Db): SessionStore {
  const ins = db.prepare("INSERT INTO sessions (id, role, game_id, player_id, expires_at) VALUES (?, ?, ?, ?, ?)")
  const sel = db.prepare("SELECT id, role, game_id, player_id, expires_at FROM sessions WHERE id = ? AND expires_at > ?")
  const del = db.prepare("DELETE FROM sessions WHERE id = ?")
  const delPlayer = db.prepare("DELETE FROM sessions WHERE game_id = ? AND player_id = ?")
  const delExpired = db.prepare("DELETE FROM sessions WHERE expires_at <= ?")
  return {
    create(row) {
      const id = randomBytes(32).toString("base64url")
      ins.run(id, row.role, row.gameId ?? null, row.playerId ?? null, row.expiresAt)
      return id
    },
    get(id, now) {
      const r = sel.get(id, now) as
        | { id: string; role: "host" | "player"; game_id: string | null; player_id: string | null; expires_at: number }
        | undefined
      return r ? { id: r.id, role: r.role, gameId: r.game_id, playerId: r.player_id, expiresAt: r.expires_at } : null
    },
    delete: (id) => void del.run(id),
    deleteForPlayer: (gameId, playerId) => void delPlayer.run(gameId, playerId),
    deleteExpired: (now) => Number(delExpired.run(now).changes),
  }
}
