import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { addPlayer, createGame } from "../engine/lobby.js"
import { makeCtx } from "../engine/testkit.js"
import { openDb } from "./db.js"
import { gameStore } from "./games.js"
import { sessionStore } from "./sessions.js"

const DAY = 24 * 3600 * 1000

describe("games", () => {
  it("round-trips a game and finds it by invite token", () => {
    const db = openDb(":memory:")
    const games = gameStore(db)
    const ctx = makeCtx()
    const g = addPlayer(createGame(ctx, "tok123"), "Anu", ctx)
    if (!g.ok) throw new Error()
    games.save(g.value.state)
    expect(games.load(g.value.state.id)).toEqual(g.value.state)
    expect(games.byInvite("tok123")!.id).toBe(g.value.state.id)
    expect(games.byInvite("nope")).toBeNull()
    expect(games.loadAll()).toHaveLength(1)
  })

  it("deleteOld removes games ended over 7 days ago or idle over 2 days", () => {
    const db = openDb(":memory:")
    const games = gameStore(db)
    const now = 100 * DAY
    const ctx = makeCtx(1, now)
    const ended = { ...createGame(ctx, "a"), phase: "ended" as const, endedAt: now - 8 * DAY, updatedAt: now - 8 * DAY }
    const idle = { ...createGame(ctx, "b"), updatedAt: now - 3 * DAY }
    const fresh = { ...createGame(ctx, "c"), updatedAt: now - 3600_000 }
    for (const g of [ended, idle, fresh]) games.save(g)
    expect(games.deleteOld(now).sort()).toEqual([ended.id, idle.id].sort())
    expect(games.loadAll().map((g) => g.id)).toEqual([fresh.id])
  })
})

describe("sessions", () => {
  it("creates 32-byte base64url ids and expires them", () => {
    const db = openDb(":memory:")
    const sessions = sessionStore(db)
    const id = sessions.create({ role: "player", gameId: "g1", playerId: "p1", expiresAt: 1000 })
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(sessions.get(id, 999)).toEqual({ id, role: "player", gameId: "g1", playerId: "p1", expiresAt: 1000 })
    expect(sessions.get(id, 1000)).toBeNull()
    expect(sessions.deleteExpired(2000)).toBe(1)
  })

  it("deletes a player's sessions", () => {
    const db = openDb(":memory:")
    const sessions = sessionStore(db)
    const a = sessions.create({ role: "player", gameId: "g1", playerId: "p1", expiresAt: 10 })
    const b = sessions.create({ role: "host", expiresAt: 10 })
    sessions.deleteForPlayer("g1", "p1")
    expect(sessions.get(a, 0)).toBeNull()
    expect(sessions.get(b, 0)!.role).toBe("host")
  })
})

describe("migrations", () => {
  let dir = ""
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  it("applies each migration once across re-opens", () => {
    dir = mkdtempSync(join(tmpdir(), "sb-"))
    const file = join(dir, "t.db")
    openDb(file).close()
    const db = openDb(file)
    const rows = db.prepare("SELECT name FROM migrations").all()
    expect(rows).toEqual([{ name: "001_init.sql" }])
    db.close()
  })
})
