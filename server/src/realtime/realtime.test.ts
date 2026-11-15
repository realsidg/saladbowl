import type { FastifyInstance } from "fastify"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import WebSocket from "ws"
import type { ServerMessage, Snapshot } from "@saladbowl/shared"
import { hashPassword } from "../auth/password.js"
import { loadConfig } from "../config.js"
import { openDb, type Db } from "../db/db.js"
import { gameStore } from "../db/games.js"
import { sessionStore } from "../db/sessions.js"
import { activeTurn } from "../engine/turns.js"
import { GameService } from "../games/service.js"
import { buildApp } from "../http/app.js"
import { Hub } from "./hub.js"

const ORIGIN = "https://bowl.example"
let HASH = ""
beforeAll(async () => {
  HASH = await hashPassword("let-me-in-please")
})

/** Manual clock for game timers; the heartbeat uses real timers. */
function fakeClock(start = 1_700_000_000_000) {
  let t = start
  let timers: { at: number; fn: () => void }[] = []
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const h = { at: t + ms, fn }
      timers.push(h)
      return h
    },
    clearTimer: (h: unknown) => {
      timers = timers.filter((x) => x !== h)
    },
    async advance(ms: number) {
      t += ms
      const due = timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)
      timers = timers.filter((x) => x.at > t)
      for (const d of due) d.fn()
      await settle()
    },
  }
}

const settle = () => new Promise((r) => setTimeout(r, 30))

interface Env {
  app: FastifyInstance
  url: string
  db: Db
  games: GameService
  hub: Hub
  clock: ReturnType<typeof fakeClock>
}
let envs: Env[] = []
let sockets: WebSocket[] = []
afterEach(async () => {
  for (const s of sockets) s.terminate()
  sockets = []
  for (const e of envs) {
    e.hub.close()
    await e.app.close()
  }
  envs = []
})

async function start(opts: { db?: Db; pingIntervalMs?: number; clock?: ReturnType<typeof fakeClock> } = {}): Promise<Env> {
  const clock = opts.clock ?? fakeClock()
  const cfg = loadConfig({
    SALADBOWL_PASSWORD_HASH: HASH,
    SALADBOWL_SESSION_SECRET: "x".repeat(40),
    PUBLIC_ORIGIN: ORIGIN,
    COOKIE_SECURE: "false",
  })
  const db = opts.db ?? openDb(":memory:")
  const sessions = sessionStore(db)
  const games = new GameService(gameStore(db), { now: clock.now })
  const hub = new Hub(games, {
    sessions,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    origin: ORIGIN,
    pingIntervalMs: opts.pingIntervalMs,
  })
  const app = buildApp(cfg, { games, sessions, isConnected: hub.isConnected, hub })
  await app.listen({ port: 0, host: "127.0.0.1" })
  const addr = app.server.address() as { port: number }
  const env = { app, url: `ws://127.0.0.1:${addr.port}/ws`, db, games, hub, clock }
  envs.push(env)
  return env
}

const cookieOf = (res: { headers: Record<string, unknown> }, name: string) =>
  ([] as string[])
    .concat((res.headers["set-cookie"] as string[]) ?? [])
    .find((c) => c.startsWith(`${name}=`))!
    .split(";")[0]!

async function post(env: Env, url: string, body: object, cookie?: string) {
  return env.app.inject({ method: "POST", url, payload: body, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } })
}

/** Host "Sid" creates a game; `names` join by invite. Returns cookies by name. */
async function setupGame(env: Env, names: string[]) {
  const login = await post(env, "/api/login", { password: "let-me-in-please" })
  const host = cookieOf(login, "sb_host")
  const created = await post(env, "/api/games", { name: "Sid" }, host)
  const gameId = created.json().gameId as string
  const cookies: Record<string, string> = { Sid: `${host}; ${cookieOf(created, "sb_player")}` }
  const token = env.games.get(gameId)!.inviteToken
  for (const n of names) cookies[n] = cookieOf(await post(env, `/api/invite/${token}/join`, { name: n }), "sb_player")
  return { gameId, cookies }
}

class Client {
  msgs: ServerMessage[] = []
  raw: string[] = []
  closeCode: number | null = null
  ws: WebSocket
  constructor(url: string, cookie: string | null, origin = ORIGIN, opts: { autoPong?: boolean } = {}) {
    this.ws = new WebSocket(url, { headers: { origin, ...(cookie ? { cookie } : {}) }, autoPong: opts.autoPong ?? true })
    sockets.push(this.ws)
    this.ws.on("message", (d) => {
      this.raw.push(d.toString())
      this.msgs.push(JSON.parse(d.toString()))
    })
    this.ws.on("close", (code) => (this.closeCode = code))
    this.ws.on("error", () => {})
  }
  opened() {
    return new Promise<void>((res, rej) => {
      this.ws.once("open", () => res())
      this.ws.once("close", () => res())
      this.ws.once("error", rej)
    })
  }
  closed(timeout = 2000) {
    return waitFor(() => this.closeCode !== null, timeout).then(() => this.closeCode)
  }
  send(o: object) {
    this.ws.send(JSON.stringify(o))
  }
  intent(intent: object) {
    this.send({ type: "intent", intent })
  }
  snap(): Snapshot {
    const s = [...this.msgs].reverse().find((m) => m.type === "snapshot")
    if (!s || s.type !== "snapshot") throw new Error("no snapshot yet")
    return s.snapshot
  }
}

async function waitFor(pred: () => boolean, timeout = 2000) {
  const end = Date.now() + timeout
  while (!pred()) {
    if (Date.now() > end) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 10))
  }
}

async function connect(env: Env, cookie: string | null, origin?: string) {
  const c = new Client(env.url, cookie, origin)
  await c.opened()
  return c
}

/** Everyone joined; host makes teams and starts. Returns clients by name. */
async function startedGame(env: Env, names = ["A", "B"]) {
  const { gameId, cookies } = await setupGame(env, names)
  const clients: Record<string, Client> = {}
  for (const n of ["Sid", ...names]) clients[n] = await connect(env, cookies[n]!)
  await settle()
  for (const n of ["Sid", ...names]) for (let i = 0; i < 6; i++) clients[n]!.intent({ type: "addWord", word: `${n}word${i}` })
  await settle()
  clients["Sid"]!.intent({ type: "makeTeams" })
  await settle()
  clients["Sid"]!.intent({ type: "startGame" })
  await settle()
  return { gameId, cookies, clients }
}

const clueGiverName = (clients: Record<string, Client>) => {
  const snap = clients["Sid"]!.snap()
  return snap.players.find((p) => p.id === snap.turn!.playerId)!.name
}

describe("connecting", () => {
  it("closes 4401 without a valid player cookie", async () => {
    const env = await start()
    const c = new Client(env.url, null)
    expect(await c.closed()).toBe(4401)
  })

  it("closes 4403 for a foreign Origin", async () => {
    const env = await start()
    const { cookies } = await setupGame(env, [])
    const c = new Client(env.url, cookies["Sid"]!, "https://evil.example")
    expect(await c.closed()).toBe(4403)
  })

  it("sends a snapshot on connect stamped with server time", async () => {
    const env = await start()
    const { cookies } = await setupGame(env, [])
    const c = await connect(env, cookies["Sid"]!)
    await waitFor(() => c.msgs.length > 0, 500)
    const m = c.msgs[0]!
    expect(m.type).toBe("snapshot")
    if (m.type === "snapshot") {
      expect(Math.abs(m.serverNow - env.clock.now())).toBeLessThanOrEqual(50)
      expect(m.snapshot.me.isHost).toBe(true)
    }
  })

  it("answers ping with pong", async () => {
    const env = await start()
    const { cookies } = await setupGame(env, [])
    const c = await connect(env, cookies["Sid"]!)
    c.send({ type: "ping", t: 123 })
    await waitFor(() => c.msgs.some((m) => m.type === "pong"))
    expect(c.msgs.find((m) => m.type === "pong")).toEqual({ type: "pong", t: 123, serverNow: env.clock.now() })
  })
})

describe("playing", () => {
  it("never sends the current card's word to anyone but the clue-giver", async () => {
    const env = await start()
    const { clients } = await startedGame(env)
    const giver = clueGiverName(clients)
    const others = Object.keys(clients).filter((n) => n !== giver)
    const from = Object.fromEntries(others.map((n) => [n, clients[n]!.raw.length]))
    const g = clients[giver]!
    g.intent({ type: "startTurn", turnId: g.snap().turn!.id })
    await settle()
    const words: string[] = []
    for (let i = 0; i < 3; i++) {
      words.push(g.snap().turn!.card!.word)
      g.intent({ type: "gotIt", turnId: g.snap().turn!.id })
      await settle()
    }
    for (const n of others) {
      const later = clients[n]!.raw.slice(from[n]).join("\n")
      for (const w of words) expect(later).not.toContain(w)
    }
  })

  it("ends a turn on time with nobody connected, and a reconnect sees review", async () => {
    const env = await start()
    const { gameId, clients, cookies } = await startedGame(env)
    clients["Sid"]!.intent({ type: "updateSettings", patch: { secondsPerTurn: 10 } })
    await settle()
    const giver = clueGiverName(clients)
    const g = clients[giver]!
    g.intent({ type: "startTurn", turnId: g.snap().turn!.id })
    await settle()
    for (const c of Object.values(clients)) c.ws.close()
    await settle()
    await env.clock.advance(10_000)
    expect(activeTurn(env.games.get(gameId)!)!.phase).toBe("review")
    const back = await connect(env, cookies[giver]!)
    await waitFor(() => back.msgs.length > 0)
    expect(back.snap().turn!.phase).toBe("review")
  })

  it("lets only one of two simultaneous confirmReviews through", async () => {
    const env = await start()
    const { gameId, clients } = await startedGame(env)
    const giver = clueGiverName(clients)
    const g = clients[giver]!
    g.intent({ type: "startTurn", turnId: g.snap().turn!.id })
    await settle()
    await env.clock.advance(60_000)
    const turnId = g.snap().turn!.id
    const turnsBefore = env.games.get(gameId)!.turns.length
    g.intent({ type: "confirmReview", turnId })
    clients["Sid"]!.intent({ type: "confirmReview", turnId })
    await settle()
    expect(env.games.get(gameId)!.turns.length).toBe(turnsBefore + 1)
    const senders = [...new Set([g, clients["Sid"]!])]
    const errors = senders.flatMap((c) => c.msgs).filter((m) => m.type === "error")
    expect(errors.map((e) => e.type === "error" && e.code)).toEqual(["stale_turn"])
  })
})

describe("recovery", () => {
  it("moves an overdue turn to review on restart, and schedules a future one", async () => {
    const db = openDb(":memory:")
    const clock = fakeClock()
    const env = await start({ db, clock })
    const { gameId, clients } = await startedGame(env)
    const giver = clueGiverName(clients)
    const g = clients[giver]!
    g.intent({ type: "startTurn", turnId: g.snap().turn!.id })
    await settle()
    env.hub.close()
    await env.app.close()
    envs = []

    // restart 30 s into a 60 s turn: still playing, fires at the original endsAt
    await clock.advance(0)
    const later = fakeClock(clock.now() + 30_000)
    const env2 = await start({ db, clock: later })
    await env2.hub.recover()
    expect(activeTurn(env2.games.get(gameId)!)!.phase).toBe("playing")
    await later.advance(30_000)
    expect(activeTurn(env2.games.get(gameId)!)!.phase).toBe("review")
  })

  it("an overdue turn goes to review immediately on recover", async () => {
    const db = openDb(":memory:")
    const clock = fakeClock()
    const env = await start({ db, clock })
    const { gameId, clients } = await startedGame(env)
    const g = clients[clueGiverName(clients)]!
    g.intent({ type: "startTurn", turnId: g.snap().turn!.id })
    await settle()
    env.hub.close()
    await env.app.close()
    envs = []
    const env2 = await start({ db, clock: fakeClock(clock.now() + 120_000) })
    await env2.hub.recover()
    expect(activeTurn(env2.games.get(gameId)!)!.phase).toBe("review")
  })
})

describe("abuse and liveness", () => {
  it("closes 4429 after more than 20 messages in a second", async () => {
    const env = await start()
    const { cookies } = await setupGame(env, [])
    const c = await connect(env, cookies["Sid"]!)
    for (let i = 0; i < 25; i++) c.send({ type: "ping", t: i })
    expect(await c.closed()).toBe(4429)
  })

  it("closes 1009 for a frame over 4 KB", async () => {
    const env = await start()
    const { cookies } = await setupGame(env, [])
    const c = await connect(env, cookies["Sid"]!)
    c.ws.send("x".repeat(5000))
    expect(await c.closed()).toBe(1009)
  })

  it("drops a socket that stops answering pings", async () => {
    const env = await start({ pingIntervalMs: 40 })
    const { gameId, cookies } = await setupGame(env, [])
    const c = new Client(env.url, cookies["Sid"]!, ORIGIN, { autoPong: false })
    await c.opened()
    await settle()
    const sid = env.games.get(gameId)!.players[0]!.id
    expect(env.hub.isConnected(gameId, sid)).toBe(true)
    await c.closed(1000)
    expect(env.hub.isConnected(gameId, sid)).toBe(false)
  })

  it("kicking closes the player's socket and kills their session", async () => {
    const env = await start()
    const { gameId, cookies } = await setupGame(env, ["A"])
    const host = await connect(env, cookies["Sid"]!)
    const a = await connect(env, cookies["A"]!)
    await settle()
    const aId = env.games.get(gameId)!.players.find((p) => p.name === "A")!.id
    host.intent({ type: "kickPlayer", playerId: aId })
    expect(await a.closed()).toBe(4403)
    const again = new Client(env.url, cookies["A"]!)
    expect(await again.closed()).toBe(4401)
  })
})
