import type { Intent } from "@saladbowl/shared"
import { applyIntent } from "./apply.js"
import { addPlayer, createGame } from "./lobby.js"
import type { Actor, Ctx, GameState } from "./types.js"

/** Deterministic context for tests: seeded rng, counter ids, settable clock. */
export function makeCtx(seed = 1, now = 1_000_000): Ctx & { advance(ms: number): void } {
  let a = seed >>> 0
  let n = 0
  const ctx = {
    now,
    rng() {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
    newId: () => `id${++n}`,
    advance(ms: number) {
      ctx.now += ms
    },
  }
  return ctx
}

export const host: Actor = { playerId: null, isHost: true }
export const as = (playerId: string, isHost = false): Actor => ({ playerId, isHost })

export function must<T>(r: { ok: true; value: T } | { ok: false; code: string }): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`)
  return r.value
}

export function act(s: GameState, actor: Actor, intent: Intent, ctx: Ctx): GameState {
  return must(applyIntent(s, actor, intent, ctx))
}

/** A game in `teams` phase with the named players, each with `words` words. */
export function lobbyWith(names: string[], ctx: Ctx, words = 2) {
  let s = createGame(ctx, "invite1")
  s = act(s, host, { type: "updateSettings", patch: { wordsPerPlayer: words } }, ctx)
  const ids: string[] = []
  for (const name of names) {
    const r = must(addPlayer(s, name, ctx))
    s = r.state
    ids.push(r.playerId)
    for (let i = 0; i < words; i++) s = act(s, as(r.playerId), { type: "addWord", word: `${name}-w${i}` }, ctx)
  }
  return { s, ids }
}
