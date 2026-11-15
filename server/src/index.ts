import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { loadConfig } from "./config.js"
import { openDb } from "./db/db.js"
import { gameStore } from "./db/games.js"
import { sessionStore } from "./db/sessions.js"
import { purgeOld } from "./games/cleanup.js"
import { GameService } from "./games/service.js"
import { buildApp } from "./http/app.js"
import { Hub } from "./realtime/hub.js"

const cfg = loadConfig(process.env)
mkdirSync(cfg.dataDir, { recursive: true })
const db = openDb(join(cfg.dataDir, "saladbowl.db"))
const sessions = sessionStore(db)
const store = gameStore(db)
const games = new GameService(store, {})
const hub = new Hub(games, {
  sessions,
  now: Date.now,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  origin: cfg.origins[0]!,
})
const app = buildApp(cfg, { games, sessions, isConnected: hub.isConnected, hub })

process.on("unhandledRejection", (err) => app.log.error({ err }, "unhandled rejection"))
process.on("uncaughtException", (err) => app.log.error({ err }, "uncaught exception"))

const cleanup = () => {
  const removed = purgeOld({ store, games, sessions, drop: (id) => hub.drop(id) }, Date.now())
  const expired = sessions.deleteExpired(Date.now())
  if (removed || expired) app.log.info({ removed, expired }, "cleanup")
}

await hub.recover()
cleanup()
setInterval(cleanup, 3600_000).unref()

const shutdown = async () => {
  hub.close()
  await app.close()
  db.close()
  process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

await app.listen({ port: cfg.port, host: process.env.HOST || "0.0.0.0" })
