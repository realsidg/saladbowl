import { existsSync } from "node:fs"
import { join } from "node:path"
import cookie from "@fastify/cookie"
import helmet from "@fastify/helmet"
import fastifyStatic from "@fastify/static"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import { HTTP_BODY_LIMIT } from "@saladbowl/shared"
import { sessionKey, verifySession } from "../auth/cookies.js"
import type { Config } from "../config.js"
import type { SessionRow, SessionStore } from "../db/sessions.js"
import type { GameService } from "../games/service.js"
import { registerRoutes } from "./routes.js"
import { originAllowed } from "./security.js"

export interface AppDeps {
  games: GameService
  sessions: SessionStore
  isConnected: (gameId: string, playerId: string) => boolean
}

export interface Auth {
  key: Buffer
  host(req: FastifyRequest): SessionRow | null
  player(req: FastifyRequest): SessionRow | null
}

export const HOST_COOKIE = "sb_host"
export const PLAYER_COOKIE = "sb_player"

export function makeAuth(cfg: Config, sessions: SessionStore, now: () => number): Auth {
  const key = sessionKey(cfg.sessionSecret, cfg.passwordHash)
  const read = (req: FastifyRequest, name: string, role: "host" | "player") => {
    const raw = req.cookies?.[name]
    const id = raw ? verifySession(raw, key) : null
    const row = id ? sessions.get(id, now()) : null
    return row && row.role === role ? row : null
  }
  return {
    key,
    host: (req) => read(req, HOST_COOKIE, "host"),
    player: (req) => read(req, PLAYER_COOKIE, "player"),
  }
}

export function buildApp(cfg: Config, deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" || process.env.VITEST ? false : { level: "info" },
    bodyLimit: HTTP_BODY_LIMIT,
    trustProxy: cfg.trustProxy,
  })

  const wsOrigins = cfg.origins.map((o) => o.replace(/^http/, "ws"))
  void app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'", ...wsOrigins],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginEmbedderPolicy: false,
  })
  void app.register(cookie)

  app.addHook("onRequest", async (req, reply) => {
    if (req.method !== "GET" && req.method !== "HEAD" && !originAllowed(req, cfg.origins)) {
      return reply.code(403).send({ code: "bad_origin" })
    }
  })

  app.setErrorHandler((err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ code: status === 413 ? "too_large" : "invalid" })
    }
    req.log.error({ err }, "request failed")
    return reply.code(500).send({ code: "internal" })
  })

  const auth = makeAuth(cfg, deps.sessions, deps.games.now)
  app.get("/healthz", async () => ({ ok: true }))
  registerRoutes(app, cfg, deps, auth)

  if (cfg.staticDir && existsSync(join(cfg.staticDir, "index.html"))) {
    void app.register(fastifyStatic, { root: cfg.staticDir, wildcard: false, index: ["index.html"] })
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && req.url !== "/ws") {
        return reply.type("text/html").sendFile("index.html")
      }
      return reply.code(404).send({ code: "not_found" })
    })
  }
  return app
}
