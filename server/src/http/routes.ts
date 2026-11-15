import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { nameSchema } from "@saladbowl/shared"
import { signSession } from "../auth/cookies.js"
import { LoginLimiter } from "../auth/limiter.js"
import { verifyPassword } from "../auth/password.js"
import type { Config } from "../config.js"
import { addPlayer } from "../engine/lobby.js"
import type { AppDeps, Auth } from "./app.js"
import { HOST_COOKIE, PLAYER_COOKIE } from "./app.js"
import { tooMany, WindowLimiter } from "./security.js"

const DAY = 24 * 3600 * 1000
const HOST_TTL = 30 * DAY
const PLAYER_TTL = 30 * DAY

const loginBody = z.object({ password: z.string().min(1).max(1024) })
const gameBody = z.object({ name: nameSchema })
const joinBody = z.union([z.object({ name: nameSchema }), z.object({ takeoverPlayerId: z.string().min(1).max(64) })])
const tokenParam = z.object({ token: z.string().min(1).max(64) })

export function registerRoutes(app: FastifyInstance, cfg: Config, deps: AppDeps, auth: Auth) {
  const { games, sessions } = deps
  const now = games.now
  const login = new LoginLimiter()
  // Guests at a party share one public IP: only failed lookups count toward the tight limit.
  const inviteFailLimit = new WindowLimiter(20, 15 * 60_000)
  const inviteLimit = new WindowLimiter(300, 15 * 60_000)
  const createLimit = new WindowLimiter(10, 60 * 60_000)

  const setCookie = (reply: FastifyReply, name: string, sessionId: string, ttlMs: number) =>
    reply.setCookie(name, signSession(sessionId, auth.key), {
      httpOnly: true,
      sameSite: "lax",
      secure: cfg.cookieSecure,
      path: "/",
      maxAge: Math.floor(ttlMs / 1000),
    })

  const playerSession = (reply: FastifyReply, gameId: string, playerId: string) => {
    const id = sessions.create({ role: "player", gameId, playerId, expiresAt: now() + PLAYER_TTL })
    setCookie(reply, PLAYER_COOKIE, id, PLAYER_TTL)
  }

  /** The game a player session belongs to, if it is still usable. */
  const liveGameOf = (row: { gameId: string | null; playerId: string | null } | null) => {
    if (!row?.gameId || !row.playerId) return null
    const g = games.get(row.gameId)
    if (!g) return null
    if (g.endedAt !== null && g.endedAt < now() - DAY) return null
    const p = g.players.find((x) => x.id === row.playerId)
    return p && !p.kicked ? g : null
  }

  app.post("/api/login", async (req, reply) => {
    const ip = req.ip
    const gate = login.check(ip, now())
    if (!gate.ok) return tooMany(reply, gate.retryAfterMs)
    const body = loginBody.safeParse(req.body)
    const good = body.success && (await verifyPassword(body.data.password, cfg.passwordHash))
    if (!good) {
      login.fail(ip, now())
      return reply.code(401).send({ code: "bad_password" })
    }
    login.succeed(ip)
    const id = sessions.create({ role: "host", expiresAt: now() + HOST_TTL })
    setCookie(reply, HOST_COOKIE, id, HOST_TTL)
    return reply.code(204).send()
  })

  app.post("/api/logout", async (req, reply) => {
    for (const row of [auth.host(req), auth.player(req)]) if (row) sessions.delete(row.id)
    reply.clearCookie(HOST_COOKIE, { path: "/" }).clearCookie(PLAYER_COOKIE, { path: "/" })
    return reply.code(204).send()
  })

  app.get("/api/me", async (req) => {
    const g = liveGameOf(auth.player(req))
    const isHost = Boolean(auth.host(req))
    return isHost ? { isHost, gameId: g?.id ?? null, hostedGameId: games.latestLive() } : { isHost, gameId: g?.id ?? null }
  })

  /** A host whose phone lost its player cookie gets back into a game they created. */
  app.post("/api/games/:id/rejoin", async (req, reply) => {
    if (!auth.host(req)) return reply.code(401).send({ code: "not_host" })
    const id = z.object({ id: z.string().min(1).max(64) }).safeParse(req.params)
    const g = id.success ? games.get(id.data.id) : null
    const creator = g?.creatorId ? g.players.find((p) => p.id === g.creatorId && !p.kicked) : null
    if (!g || g.phase === "ended" || !creator) return reply.code(404).send({ code: "not_found" })
    sessions.deleteForPlayer(g.id, creator.id)
    playerSession(reply, g.id, creator.id)
    return reply.code(204).send()
  })

  app.post("/api/games", async (req, reply) => {
    const host = auth.host(req)
    if (!host) return reply.code(401).send({ code: "not_host" })
    const wait = createLimit.hit(host.id, now())
    if (wait) return tooMany(reply, wait)
    const body = gameBody.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ code: "invalid" })
    const made = await games.create(body.data.name)
    if (!made) return reply.code(400).send({ code: "invalid" })
    playerSession(reply, made.gameId, made.playerId)
    return reply.send({ gameId: made.gameId })
  })

  /** Shared guard for invite routes: rate limit, then a live game for the token. */
  const inviteGame = (ip: string, params: unknown, reply: FastifyReply) => {
    const wait = inviteFailLimit.blocked(ip, now()) || inviteLimit.hit(ip, now())
    if (wait) {
      void tooMany(reply, wait)
      return null
    }
    const p = tokenParam.safeParse(params)
    const g = p.success ? games.byInvite(p.data.token) : null
    if (!g || g.phase === "ended") {
      inviteFailLimit.hit(ip, now())
      void reply.code(404).send({ code: "invite_invalid" })
      return null
    }
    return g
  }

  app.get("/api/invite/:token", async (req, reply) => {
    const g = inviteGame(req.ip, req.params, reply)
    if (!g) return reply
    const mine = auth.player(req)
    return {
      phase: g.phase,
      alreadyIn: liveGameOf(mine)?.id === g.id,
      takeover: g.players
        .filter((p) => !p.kicked && p.id !== g.creatorId && !deps.isConnected(g.id, p.id))
        .map((p) => ({ playerId: p.id, name: p.name })),
    }
  })

  app.post("/api/invite/:token/join", async (req, reply) => {
    const g = inviteGame(req.ip, req.params, reply)
    if (!g) return reply
    const body = joinBody.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ code: "invalid" })

    if ("name" in body.data) {
      const name = body.data.name
      const r = await games.run<ReturnType<typeof addPlayer>>(g.id, (s, ctx) => {
        const added = addPlayer(s, name, ctx)
        return added.ok ? { state: added.value.state, result: added } : { result: added }
      })
      if (!r.ok) return reply.code(r.code === "name_taken" ? 409 : 400).send({ code: r.code })
      playerSession(reply, g.id, r.value.playerId)
      return reply.code(204).send()
    }

    const pid = body.data.takeoverPlayerId
    const p = games.get(g.id)!.players.find((x) => x.id === pid)
    if (!p || p.kicked || p.id === g.creatorId || deps.isConnected(g.id, pid)) return reply.code(409).send({ code: "player_busy" })
    sessions.deleteForPlayer(g.id, pid)
    playerSession(reply, g.id, pid)
    return reply.code(204).send()
  })
}
