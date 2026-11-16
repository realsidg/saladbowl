import { describe, expect, it } from "vitest"
import { openDb } from "../db/db.js"
import { gameStore } from "../db/games.js"
import { sessionStore } from "../db/sessions.js"
import { purgeOld } from "./cleanup.js"
import { GameService } from "./service.js"

const DAY = 24 * 3600_000

describe("purgeOld", () => {
  it("drops deleted games from memory and their sessions, so they can't come back", async () => {
    let now = 10 * DAY
    const db = openDb(":memory:")
    const store = gameStore(db)
    const sessions = sessionStore(db)
    const games = new GameService(store, { now: () => now })
    const made = (await games.create("Sid", "host-session"))!
    const sid = sessions.create({ role: "player", gameId: made.gameId, playerId: made.playerId, expiresAt: now + 30 * DAY })
    games.get(made.gameId) // cached
    const dropped: string[] = []
    now += 3 * DAY
    expect(purgeOld({ store, games, sessions, drop: (id) => dropped.push(id) }, now)).toBe(1)
    expect(games.get(made.gameId)).toBeNull()
    expect(sessions.get(sid, now)).toBeNull()
    expect(dropped).toEqual([made.gameId])
  })
})
