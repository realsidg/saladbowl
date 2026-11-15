import type { WebSocket } from "ws"
import {
  parseClientMessage,
  WS_MESSAGES_PER_SECOND,
  type ErrorCode,
  type Intent,
  type ServerMessage,
} from "@saladbowl/shared"
import type { SessionStore } from "../db/sessions.js"
import { applyIntent } from "../engine/apply.js"
import { nextDeadline, timeUp } from "../engine/turns.js"
import type { Actor, GameState, Result } from "../engine/types.js"
import { snapshotFor } from "../engine/view.js"
import type { GameService } from "../games/service.js"

export interface HubOpts {
  sessions: SessionStore
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (h: unknown) => void
  /** used in invite links */
  origin: string
  pingIntervalMs?: number
}

interface Conn {
  ws: WebSocket
  gameId: string
  playerId: string
  isHost: boolean
  missedPongs: number
  windowStart: number
  windowCount: number
}

export const CLOSE = { unauthorized: 4401, forbidden: 4403, tooMany: 4429 } as const

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  not_host: "Only the host can do that.",
  not_your_turn: "It's not your turn.",
  stale_turn: "That turn is already over.",
  bad_phase: "You can't do that right now.",
  name_taken: "Someone already has that name.",
  limit: "You've added all your words.",
  skips_disabled: "Skips are off in this game.",
  letter_mismatch: "Words must start with the game's letter.",
}

/** Live connections per game: runs intents through the game queue, owns turn timers, sends each socket its own view. */
export class Hub {
  private conns = new Map<string, Set<Conn>>()
  private timers = new Map<string, unknown>()
  private heartbeat: ReturnType<typeof setInterval>

  constructor(
    private games: GameService,
    private opts: HubOpts,
  ) {
    games.onChange = (s) => {
      this.broadcast(s)
      this.schedule(s)
    }
    this.heartbeat = setInterval(() => this.beat(), opts.pingIntervalMs ?? 15_000)
    this.heartbeat.unref?.()
  }

  isConnected = (gameId: string, playerId: string): boolean => {
    for (const c of this.conns.get(gameId) ?? []) if (c.playerId === playerId) return true
    return false
  }

  attach(ws: WebSocket, who: { gameId: string; playerId: string; isHost: boolean }) {
    const conn: Conn = { ...who, ws, missedPongs: 0, windowStart: this.opts.now(), windowCount: 0 }
    let set = this.conns.get(who.gameId)
    if (!set) this.conns.set(who.gameId, (set = new Set()))
    set.add(conn)

    ws.on("pong", () => (conn.missedPongs = 0))
    ws.on("message", (data, isBinary) => this.onMessage(conn, isBinary ? "" : data.toString()))
    ws.on("close", () => {
      set!.delete(conn)
      if (set!.size === 0) this.conns.delete(who.gameId)
      const s = this.games.get(who.gameId)
      if (s) this.broadcast(s)
    })
    ws.on("error", () => ws.terminate())

    const s = this.games.get(who.gameId)
    if (s) this.broadcast(s)
  }

  private onMessage(conn: Conn, raw: string) {
    const now = Date.now()
    if (now - conn.windowStart >= 1000) {
      conn.windowStart = now
      conn.windowCount = 0
    }
    if (++conn.windowCount > WS_MESSAGES_PER_SECOND) {
      conn.ws.close(CLOSE.tooMany, "too many messages")
      return
    }
    const msg = parseClientMessage(raw)
    if (!msg) return this.send(conn.ws, { type: "error", code: "invalid", message: "That message wasn't understood." })
    if (msg.type === "ping") return this.send(conn.ws, { type: "pong", t: msg.t, serverNow: this.opts.now() })
    void this.dispatch(conn.gameId, { playerId: conn.playerId, isHost: conn.isHost }, msg.intent).then((r) => {
        // a tap that lost a race with the clock or with another tap: nothing to tell the player
      if (!r.ok && r.code !== "stale_card") this.send(conn.ws, { type: "error", code: r.code, message: MESSAGES[r.code] ?? "That didn't work." })
    })
  }

  async dispatch(gameId: string, actor: Actor, intent: Intent): Promise<Result<GameState>> {
    let r: Result<GameState>
    try {
      r = await this.games.run<Result<GameState>>(gameId, (s, ctx) => {
        const out = applyIntent(s, actor, intent, ctx)
        return out.ok ? { state: out.value, result: out } : { result: out }
      })
    } catch {
      return { ok: false, code: "not_found" }
    }
    if (r.ok && intent.type === "kickPlayer") {
      this.opts.sessions.deleteForPlayer(gameId, intent.playerId)
      for (const c of this.conns.get(gameId) ?? []) if (c.playerId === intent.playerId) c.ws.close(CLOSE.forbidden, "removed")
    }
    return r
  }

  /** Keeps exactly one timer per game, aimed at the active turn's end. */
  private schedule(s: GameState) {
    const old = this.timers.get(s.id)
    if (old !== undefined) {
      this.opts.clearTimer(old)
      this.timers.delete(s.id)
    }
    const d = nextDeadline(s)
    if (!d) return
    const fire = () => {
      this.timers.delete(s.id)
      void this.games
        .run(s.id, (cur, ctx) => {
          const next = timeUp(cur, d.turnId, ctx)
          return { state: next === cur ? null : next, result: null }
        })
        .catch(() => undefined)
    }
    this.timers.set(s.id, this.opts.setTimer(fire, Math.max(0, d.at - this.opts.now())))
  }

  /** After a restart: end overdue turns now, schedule the rest. */
  async recover() {
    for (const s of this.games.loadAll()) {
      if (s.phase !== "playing") continue
      const d = nextDeadline(s)
      if (!d) continue
      if (d.at <= this.opts.now()) {
        await this.games.run(s.id, (cur, ctx) => {
          const next = timeUp(cur, d.turnId, ctx)
          return { state: next === cur ? null : next, result: null }
        })
      } else this.schedule(s)
    }
  }

  private broadcast(s: GameState) {
    const set = this.conns.get(s.id)
    if (!set?.size) return
    const connected = new Set([...set].map((c) => c.playerId))
    const serverNow = this.opts.now()
    for (const c of set) {
      const snapshot = snapshotFor(s, { playerId: c.playerId, isHost: c.isHost }, connected, this.opts.origin)
      this.send(c.ws, { type: "snapshot", serverNow, snapshot })
    }
  }

  private send(ws: WebSocket, m: ServerMessage) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m))
  }

  private beat() {
    for (const set of this.conns.values())
      for (const c of set) {
        if (c.missedPongs >= 2) {
          c.ws.terminate()
          continue
        }
        c.missedPongs += 1
        try {
          c.ws.ping()
        } catch {
          c.ws.terminate()
        }
      }
  }

  /** A game was deleted: stop its timer and disconnect everyone in it. */
  drop(gameId: string) {
    const h = this.timers.get(gameId)
    if (h !== undefined) this.opts.clearTimer(h)
    this.timers.delete(gameId)
    for (const c of this.conns.get(gameId) ?? []) c.ws.close(CLOSE.unauthorized, "game over")
    this.conns.delete(gameId)
  }

  close() {
    clearInterval(this.heartbeat)
    for (const h of this.timers.values()) this.opts.clearTimer(h)
    this.timers.clear()
    for (const set of this.conns.values()) for (const c of set) c.ws.terminate()
    this.conns.clear()
  }
}
