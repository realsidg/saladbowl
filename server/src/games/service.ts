import { randomBytes, randomInt } from "node:crypto"
import type { GameStore } from "../db/games.js"
import { addPlayer, createGame } from "../engine/lobby.js"
import type { Ctx, GameState } from "../engine/types.js"

export interface ServiceOpts {
  now?: () => number
  rng?: () => number
  newId?: () => string
  /** called after every saved change */
  onChange?: (s: GameState) => void
}

export const randomId = () => randomBytes(16).toString("base64url")

/** Owns live game state: an in-memory cache over SQLite, with one queue per game so changes never interleave. */
export class GameService {
  private cache = new Map<string, GameState>()
  private queues = new Map<string, Promise<unknown>>()
  readonly now: () => number
  private rng: () => number
  private newId: () => string
  onChange: (s: GameState) => void

  constructor(
    private store: GameStore,
    opts: ServiceOpts,
  ) {
    this.now = opts.now ?? Date.now
    this.rng = opts.rng ?? (() => randomInt(0, 2 ** 32) / 2 ** 32)
    this.newId = opts.newId ?? randomId
    this.onChange = opts.onChange ?? (() => {})
  }

  ctx(): Ctx {
    return { now: this.now(), rng: this.rng, newId: this.newId }
  }

  get(id: string): GameState | null {
    const hit = this.cache.get(id)
    if (hit) return hit
    const s = this.store.load(id)
    if (s) this.cache.set(id, s)
    return s
  }

  byInvite(token: string): GameState | null {
    const s = this.store.byInvite(token)
    return s ? this.get(s.id) : null
  }

  loadAll(): GameState[] {
    return this.store.loadAll().map((s) => this.get(s.id)!)
  }

  /** Most recently active game that hasn't ended, for a host finding their way back. */
  latestLive(): string | null {
    return this.store.latestLive()
  }

  forget(id: string) {
    this.cache.delete(id)
  }

  /** Runs `fn` on the game's queue. Returning `state` saves it and notifies listeners. */
  run<T>(gameId: string, fn: (s: GameState, ctx: Ctx) => { state?: GameState | null; result: T }): Promise<T> {
    const prev = this.queues.get(gameId) ?? Promise.resolve()
    const next = prev.then(() => {
      const s = this.get(gameId)
      if (!s) throw new Error("game_not_found")
      const out = fn(s, this.ctx())
      if (out.state && out.state !== s) {
        this.cache.set(gameId, out.state)
        this.store.save(out.state)
        this.onChange(out.state)
      }
      return out.result
    })
    const settled = next.catch(() => undefined)
    this.queues.set(gameId, settled)
    void settled.then(() => {
      if (this.queues.get(gameId) === settled) this.queues.delete(gameId)
    })
    return next
  }

  async create(hostName: string): Promise<{ gameId: string; playerId: string } | null> {
    const ctx = this.ctx()
    const r = addPlayer(createGame(ctx, this.newId()), hostName, ctx)
    if (!r.ok) return null
    r.value.state.creatorId = r.value.playerId
    this.cache.set(r.value.state.id, r.value.state)
    this.store.save(r.value.state)
    return { gameId: r.value.state.id, playerId: r.value.playerId }
  }
}
