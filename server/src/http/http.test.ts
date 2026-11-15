import type { FastifyInstance } from "fastify"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { hashPassword } from "../auth/password.js"
import { loadConfig, type Config } from "../config.js"
import { openDb } from "../db/db.js"
import { gameStore } from "../db/games.js"
import { sessionStore } from "../db/sessions.js"
import { GameService } from "../games/service.js"
import { buildApp } from "./app.js"

const ORIGIN = "https://bowl.example"
let HASH = ""
beforeAll(async () => {
  HASH = await hashPassword("let-me-in-please")
})

function env(extra: Record<string, string> = {}) {
  return {
    SALADBOWL_PASSWORD_HASH: HASH,
    SALADBOWL_SESSION_SECRET: "x".repeat(40),
    PUBLIC_ORIGIN: `${ORIGIN},http://bowl.local:1355`,
    DATA_DIR: "/tmp/unused",
    ...extra,
  }
}

let app: FastifyInstance
afterEach(async () => app?.close())

function make(opts: { connected?: Set<string>; cfg?: Partial<Config>; boom?: boolean } = {}) {
  const cfg = { ...loadConfig(env()), ...opts.cfg }
  const db = openDb(":memory:")
  const sessions = sessionStore(db)
  const games = new GameService(gameStore(db), {})
  app = buildApp(cfg, { games, sessions, isConnected: (_g, p) => opts.connected?.has(p) ?? false })
  if (opts.boom)
    app.get("/api/boom", async () => {
      throw new Error("secret internals")
    })
  return { cfg, games, sessions }
}

const cookieFrom = (res: { headers: Record<string, unknown> }, name: string) => {
  const raw = ([] as string[]).concat((res.headers["set-cookie"] as string | string[] | undefined) ?? [])
  const c = raw.find((x) => x.startsWith(`${name}=`))
  return c ? { header: c, pair: c.split(";")[0]! } : null
}

const post = (url: string, body: unknown, extra: { cookie?: string; ip?: string; origin?: string | null } = {}) =>
  app.inject({
    method: "POST",
    url,
    payload: body as object,
    remoteAddress: extra.ip ?? "1.2.3.4",
    headers: {
      ...(extra.origin === null ? {} : { origin: extra.origin ?? ORIGIN }),
      ...(extra.cookie ? { cookie: extra.cookie } : {}),
    },
  })

async function loginAsHost(ip = "1.2.3.4") {
  const res = await post("/api/login", { password: "let-me-in-please" }, { ip })
  return cookieFrom(res, "sb_host")!.pair
}

async function newGame(name = "Sid") {
  const host = await loginAsHost()
  const res = await post("/api/games", { name }, { cookie: host })
  const player = cookieFrom(res, "sb_player")!.pair
  return { host, player, gameId: res.json().gameId as string }
}

describe("config", () => {
  it("throws when the password hash is missing", () => {
    const e = env()
    delete (e as Record<string, string>).SALADBOWL_PASSWORD_HASH
    expect(() => loadConfig(e)).toThrow(/SALADBOWL_PASSWORD_HASH/)
  })
  it("throws when the session secret is short", () => {
    expect(() => loadConfig(env({ SALADBOWL_SESSION_SECRET: "short" }))).toThrow(/SALADBOWL_SESSION_SECRET/)
  })
})

describe("login", () => {
  it("rejects a wrong password and rate-limits the 6th try", async () => {
    make()
    for (let i = 0; i < 5; i++) expect((await post("/api/login", { password: "nope" })).statusCode).toBe(401)
    const sixth = await post("/api/login", { password: "nope" })
    expect(sixth.statusCode).toBe(401)
    const seventh = await post("/api/login", { password: "let-me-in-please" })
    expect(seventh.statusCode).toBe(429)
    expect(seventh.headers["retry-after"]).toBe("60")
  })

  it("sets a secure host cookie on the right password", async () => {
    make()
    const res = await post("/api/login", { password: "let-me-in-please" })
    expect(res.statusCode).toBe(204)
    const c = cookieFrom(res, "sb_host")!.header
    expect(c).toMatch(/HttpOnly/i)
    expect(c).toMatch(/SameSite=Lax/i)
    expect(c).toMatch(/Secure/i)
  })

  it("logout deletes the session", async () => {
    make()
    const host = await loginAsHost()
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie: host } })).json().isHost).toBe(true)
    await post("/api/logout", {}, { cookie: host })
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie: host } })).json().isHost).toBe(false)
  })
})

describe("origin check", () => {
  it("refuses POSTs without or with a foreign Origin", async () => {
    make()
    expect((await post("/api/login", { password: "x" }, { origin: null })).statusCode).toBe(403)
    expect((await post("/api/login", { password: "x" }, { origin: "https://evil.example" })).statusCode).toBe(403)
    expect((await post("/api/login", { password: "x" }, { origin: "http://bowl.local:1355" })).statusCode).toBe(401)
  })
})

describe("games and invites", () => {
  it("only hosts can create games", async () => {
    make()
    expect((await post("/api/games", { name: "Sid" })).statusCode).toBe(401)
  })

  it("creating a game makes the host a player in it", async () => {
    const { games } = make()
    const { player, gameId } = await newGame("Sid")
    expect(games.get(gameId)!.players.map((p) => p.name)).toEqual(["Sid"])
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: player } })
    expect(me.json()).toEqual({ isHost: false, gameId })
  })

  it("an unknown or ended invite is a 404 with no cookie", async () => {
    const { games } = make()
    const { gameId, host } = await newGame()
    const bad = await app.inject({ method: "GET", url: "/api/invite/nope", remoteAddress: "5.5.5.5" })
    expect(bad.statusCode).toBe(404)
    expect(bad.json()).toEqual({ code: "invite_invalid" })
    expect(bad.headers["set-cookie"]).toBeUndefined()
    const token = games.get(gameId)!.inviteToken
    await games.run(gameId, (s) => ({ state: { ...s, phase: "ended", endedAt: Date.now() }, result: null }))
    expect((await post(`/api/invite/${token}/join`, { name: "Anu" }, { ip: "5.5.5.5" })).statusCode).toBe(404)
    void host
  })

  it("join by name: sets a cookie, rejects duplicate names", async () => {
    const { games } = make()
    const { gameId } = await newGame("Sid")
    const token = games.get(gameId)!.inviteToken
    const ok = await post(`/api/invite/${token}/join`, { name: "Anu" }, { ip: "6.6.6.6" })
    expect(ok.statusCode).toBe(204)
    expect(cookieFrom(ok, "sb_player")).not.toBeNull()
    const dup = await post(`/api/invite/${token}/join`, { name: " anu " }, { ip: "6.6.6.6" })
    expect(dup.statusCode).toBe(409)
    expect(dup.json()).toEqual({ code: "name_taken" })
  })

  it("takeover: lists disconnected players; refuses connected or kicked ones", async () => {
    const connected = new Set<string>()
    const { games } = make({ connected })
    const { gameId } = await newGame("Sid")
    const token = games.get(gameId)!.inviteToken
    await post(`/api/invite/${token}/join`, { name: "Anu" }, { ip: "7.7.7.7" })
    const anu = games.get(gameId)!.players.find((p) => p.name === "Anu")!
    const sid = games.get(gameId)!.players.find((p) => p.name === "Sid")!
    connected.add(sid.id)
    const info = await app.inject({ method: "GET", url: `/api/invite/${token}`, remoteAddress: "7.7.7.7" })
    expect(info.json().takeover).toEqual([{ playerId: anu.id, name: "Anu" }])

    const busy = await post(`/api/invite/${token}/join`, { takeoverPlayerId: sid.id }, { ip: "7.7.7.7" })
    expect(busy.statusCode).toBe(409)
    const okTake = await post(`/api/invite/${token}/join`, { takeoverPlayerId: anu.id }, { ip: "7.7.7.7" })
    expect(okTake.statusCode).toBe(204)

    await games.run(gameId, (s) => ({
      state: { ...s, players: s.players.map((p) => (p.id === anu.id ? { ...p, kicked: true } : p)) },
      result: null,
    }))
    const kicked = await post(`/api/invite/${token}/join`, { takeoverPlayerId: anu.id }, { ip: "7.7.7.7" })
    expect(kicked.statusCode).toBe(409)
  })

  it("limits invite requests to 20 per IP per 15 minutes", async () => {
    make()
    for (let i = 0; i < 20; i++)
      expect((await app.inject({ method: "GET", url: "/api/invite/x", remoteAddress: "8.8.8.8" })).statusCode).toBe(404)
    expect((await app.inject({ method: "GET", url: "/api/invite/x", remoteAddress: "8.8.8.8" })).statusCode).toBe(429)
  })

  it("treats a player session for a game ended over a day ago as gone", async () => {
    const { games } = make()
    const { gameId, player } = await newGame()
    await games.run(gameId, (s) => ({ state: { ...s, phase: "ended", endedAt: Date.now() - 25 * 3600_000 }, result: null }))
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: player } })
    expect(me.json().gameId).toBeNull()
  })
})

describe("hardening", () => {
  it("sends CSP and referrer headers", async () => {
    make()
    const res = await app.inject({ method: "GET", url: "/healthz" })
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'")
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'")
    expect(res.headers["referrer-policy"]).toBe("no-referrer")
  })

  it("hides internals on errors", async () => {
    make({ boom: true })
    const res = await app.inject({ method: "GET", url: "/api/boom" })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ code: "internal" })
    expect(res.body).not.toContain("secret internals")
  })

  it("ignores X-Forwarded-For when no proxy is trusted", async () => {
    make()
    for (let i = 0; i < 6; i++)
      await app.inject({
        method: "POST",
        url: "/api/login",
        payload: { password: "nope" },
        remoteAddress: "9.9.9.9",
        headers: { origin: ORIGIN, "x-forwarded-for": `100.0.0.${i}` },
      })
    const res = await post("/api/login", { password: "nope" }, { ip: "9.9.9.9" })
    expect(res.statusCode).toBe(429)
  })

  it("rejects bodies over 16 KB", async () => {
    make()
    const res = await post("/api/login", { password: "x".repeat(20_000) })
    expect(res.statusCode).toBe(413)
  })
})

describe("review fixes", () => {
  it("does not rate-limit successful invite use from one shared network", async () => {
    const { games } = make()
    const { gameId } = await newGame("Sid")
    const token = games.get(gameId)!.inviteToken
    for (let i = 0; i < 30; i++) {
      const r = await app.inject({ method: "GET", url: `/api/invite/${token}`, remoteAddress: "4.4.4.4" })
      expect(r.statusCode).toBe(200)
    }
    for (let i = 0; i < 12; i++) expect((await post(`/api/invite/${token}/join`, { name: `P${i}` }, { ip: "4.4.4.4" })).statusCode).toBe(204)
  })

  it("never offers or allows taking over the game creator's player", async () => {
    const { games } = make()
    const { gameId } = await newGame("Sid")
    const token = games.get(gameId)!.inviteToken
    const sid = games.get(gameId)!.players[0]!
    const info = await app.inject({ method: "GET", url: `/api/invite/${token}`, remoteAddress: "3.3.3.3" })
    expect(info.json().takeover).toEqual([])
    expect((await post(`/api/invite/${token}/join`, { takeoverPlayerId: sid.id }, { ip: "3.3.3.3" })).statusCode).toBe(409)
  })

  it("lets a host who lost their player cookie get back into the game they're running", async () => {
    make()
    const { gameId, host } = await newGame("Sid")
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: host } })
    expect(me.json()).toEqual({ isHost: true, gameId: null, hostedGameId: gameId })
    const back = await post(`/api/games/${gameId}/rejoin`, {}, { cookie: host })
    expect(back.statusCode).toBe(204)
    const player = cookieFrom(back, "sb_player")!.pair
    const me2 = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: player } })
    expect(me2.json().gameId).toBe(gameId)
    expect((await post(`/api/games/${gameId}/rejoin`, {})).statusCode).toBe(401)
  })
})

describe("behind Cloudflare", () => {
  it("rate-limits by CF-Connecting-IP when CLIENT_IP_HEADER is set", async () => {
    make({ cfg: { clientIpHeader: "cf-connecting-ip" } })
    const login = (visitor: string) =>
      app.inject({
        method: "POST",
        url: "/api/login",
        payload: { password: "nope" },
        remoteAddress: "172.70.1.1", // the same Cloudflare edge for everyone
        headers: { origin: ORIGIN, "cf-connecting-ip": visitor },
      })
    for (let i = 0; i < 6; i++) await login("203.0.113.9")
    expect((await login("203.0.113.9")).statusCode).toBe(429)
    expect((await login("198.51.100.7")).statusCode).toBe(401) // a different visitor isn't locked out
  })

  it("ignores a header value that isn't an IP address", async () => {
    make({ cfg: { clientIpHeader: "cf-connecting-ip" } })
    for (let i = 0; i < 6; i++)
      await app.inject({
        method: "POST",
        url: "/api/login",
        payload: { password: "nope" },
        remoteAddress: "9.9.9.1",
        headers: { origin: ORIGIN, "cf-connecting-ip": `junk-${i}` },
      })
    expect((await post("/api/login", { password: "nope" }, { ip: "9.9.9.1" })).statusCode).toBe(429)
  })
})
