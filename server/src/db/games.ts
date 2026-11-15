import type { GameState } from "../engine/types.js"
import type { Db } from "./db.js"

export interface GameStore {
  load(id: string): GameState | null
  loadAll(): GameState[]
  save(s: GameState): void
  byInvite(token: string): GameState | null
  /** Deletes games ended over 7 days ago or idle over 2 days; returns their ids. */
  deleteOld(now: number): string[]
  latestLive(): string | null
}

const DAY = 24 * 3600 * 1000

export function gameStore(db: Db): GameStore {
  const get = db.prepare("SELECT state_json FROM games WHERE id = ?")
  const getByInvite = db.prepare("SELECT state_json FROM games WHERE invite_token = ?")
  const all = db.prepare("SELECT state_json FROM games")
  const upsert = db.prepare(`
    INSERT INTO games (id, invite_token, phase, state_json, updated_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET invite_token = excluded.invite_token, phase = excluded.phase,
      state_json = excluded.state_json, updated_at = excluded.updated_at, ended_at = excluded.ended_at`)
  const purge = db.prepare("DELETE FROM games WHERE (ended_at IS NOT NULL AND ended_at < ?) OR updated_at < ? RETURNING id")
  const latest = db.prepare("SELECT id FROM games WHERE phase != 'ended' ORDER BY updated_at DESC LIMIT 1")
  const parse = (row: unknown) => (row ? (JSON.parse((row as { state_json: string }).state_json) as GameState) : null)
  return {
    load: (id) => parse(get.get(id)),
    byInvite: (token) => parse(getByInvite.get(token)),
    loadAll: () => all.all().map((r) => parse(r)!),
    save: (s) => {
      upsert.run(s.id, s.inviteToken, s.phase, JSON.stringify(s), s.updatedAt, s.endedAt)
    },
    deleteOld: (now) => (purge.all(now - 7 * DAY, now - 2 * DAY) as { id: string }[]).map((r) => r.id),
    latestLive: () => (latest.get() as { id: string } | undefined)?.id ?? null,
  }
}
