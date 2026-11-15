import type { GameStore } from "../db/games.js"
import type { SessionStore } from "../db/sessions.js"
import type { GameService } from "./service.js"

/** Deletes old games for good: database row, in-memory copy, sessions, and live connections/timers (`drop`). */
export function purgeOld(
  deps: { store: GameStore; games: GameService; sessions: SessionStore; drop: (gameId: string) => void },
  now: number,
): number {
  const ids = deps.store.deleteOld(now)
  for (const id of ids) {
    deps.games.forget(id)
    deps.sessions.deleteForGame(id)
    deps.drop(id)
  }
  return ids.length
}
