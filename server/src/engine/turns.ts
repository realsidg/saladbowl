import { CARRYOVER_MIN_MS, type Intent } from "@saladbowl/shared"
import { nextPlayer, otherTeam } from "./order.js"
import { fail, ok, type Actor, type Ctx, type GameState, type Result, type Turn } from "./types.js"

export function activeTurn(s: GameState): Turn | null {
  const t = s.turns[s.turns.length - 1]
  return t && t.phase !== "done" ? t : null
}

export function nextDeadline(s: GameState): { turnId: string; at: number } | null {
  const t = activeTurn(s)
  return s.phase === "playing" && t?.phase === "playing" && t.endsAt !== null ? { turnId: t.id, at: t.endsAt } : null
}

/** Appends a `ready` turn for whoever plays next (honouring a carryover). Returns null if nobody can play. */
export function createReadyTurn(s: GameState, ctx: Ctx): Turn | null {
  const carried = s.carry ? s.players.find((p) => p.id === s.carry!.playerId && !p.kicked) : undefined
  const player = carried ?? nextPlayer(s)
  const durationMs = carried ? s.carry!.remainingMs : s.settings.secondsPerTurn * 1000
  s.carry = null
  if (!player || !player.team) return null
  const turn: Turn = {
    id: ctx.newId(),
    playerId: player.id,
    team: player.team,
    roundIndex: s.roundIndex,
    phase: "ready",
    durationMs,
    carried: Boolean(carried),
    endsAt: null,
    remainingMs: null,
    currentCardId: null,
    shown: [],
    emptiedBowl: false,
  }
  s.turns.push(turn)
  return turn
}

const pick = (ids: string[], ctx: Ctx) => (ids.length ? ids[Math.floor(ctx.rng() * ids.length)]! : null)

/** Moves to the next card (the one drawn in advance if it's still in the bowl), then draws a new next card.
 *  `avoid` (a just-skipped card) is only shown again when nothing else is left. */
function draw(s: GameState, t: Turn, ctx: Ctx, avoid: string | null) {
  const inBowl = (id: string | null | undefined) => Boolean(id && s.bowl.includes(id))
  const others = (ex: (string | null)[]) => s.bowl.filter((id) => !ex.includes(id))
  t.currentCardId = inBowl(t.nextCardId) && t.nextCardId !== avoid ? t.nextCardId! : (pick(others([avoid]), ctx) ?? pick(s.bowl, ctx))
  t.nextCardId = pick(others([t.currentCardId, avoid]), ctx) ?? pick(others([t.currentCardId]), ctx)
}

function record(t: Turn, cardId: string, outcome: Turn["shown"][number]["outcome"]) {
  const e = t.shown.find((x) => x.cardId === cardId)
  if (e) e.outcome = outcome
  else t.shown.push({ cardId, outcome })
}

function toReview(t: Turn, remainingMs: number) {
  t.phase = "review"
  t.remainingMs = Math.max(0, remainingMs)
  t.endsAt = null
  t.currentCardId = null
  t.nextCardId = null
}

/** Time is over for a playing or paused turn: the card on screen counts as missed. */
function stopTurn(t: Turn) {
  if (t.currentCardId) record(t, t.currentCardId, "missed")
  toReview(t, 0)
}

/** Server timer: the active turn ran out of time. No-op unless that turn is playing. */
export function timeUp(s0: GameState, turnId: string, ctx: Ctx): GameState {
  const t0 = activeTurn(s0)
  if (!t0 || t0.id !== turnId || t0.phase !== "playing") return s0
  const s = structuredClone(s0)
  stopTurn(activeTurn(s)!)
  s.updatedAt = ctx.now
  return s
}

/** Closes `t` and lines up the next turn. `sameTeam` keeps the turn with t's team (skip/kick). */
function advance(s: GameState, t: Turn, ctx: Ctx, sameTeam: boolean) {
  t.phase = "done"
  const player = s.players.find((p) => p.id === t.playerId)
  if (player) s.teamCursor[t.team] = player.order
  if (s.carry) {
    s.nextTeam = t.team
  } else if (sameTeam) {
    s.nextTeam = t.team
    const np = nextPlayer(s)
    if (!np || np.id === t.playerId) s.nextTeam = otherTeam(t.team)
  } else {
    s.nextTeam = otherTeam(t.team)
  }
  createReadyTurn(s, ctx)
}

function confirm(s: GameState, t: Turn, ctx: Ctx) {
  const left = t.remainingMs ?? 0
  if (s.bowl.length === 0) {
    if (s.roundIndex + 1 >= s.settings.rounds.length) {
      t.phase = "done"
      s.phase = "ended"
      s.endedAt = ctx.now
      return
    }
    s.roundIndex += 1
    s.bowl = s.cards.map((c) => c.id)
    s.carry = left > CARRYOVER_MIN_MS ? { playerId: t.playerId, remainingMs: left } : null
  } else if (t.emptiedBowl && left > CARRYOVER_MIN_MS) {
    s.carry = { playerId: t.playerId, remainingMs: left }
  } else {
    s.carry = null
  }
  advance(s, t, ctx, false)
}

/** Turn and in-game host intents. Mutates `s` (a clone made by applyIntent). */
export function applyTurnIntent(s: GameState, actor: Actor, intent: Intent, ctx: Ctx): Result<GameState> {
  if (intent.type === "endGame") {
    if (s.phase === "ended") return fail("bad_phase")
    const t = activeTurn(s)
    if (t) t.phase = "done"
    s.phase = "ended"
    s.endedAt = ctx.now
    return ok(s)
  }

  if (intent.type === "kickPlayer") {
    const p = s.players.find((x) => x.id === intent.playerId && !x.kicked)
    if (!p) return fail("not_found")
    p.kicked = true
    const t = activeTurn(s)
    if (s.phase === "playing" && t?.playerId === p.id) {
      if (t.phase === "ready") advance(s, t, ctx, true)
      else if (t.phase === "playing" || t.phase === "paused") stopTurn(t)
    }
    return ok(s)
  }

  if (s.phase !== "playing") return fail("bad_phase")
  if (!("turnId" in intent)) return fail("invalid")
  const t = activeTurn(s)
  if (!t || t.id !== intent.turnId) return fail("stale_turn")
  const isClueGiver = actor.playerId === t.playerId

  switch (intent.type) {
    case "startTurn":
      if (!isClueGiver) return fail("not_your_turn")
      if (t.phase !== "ready") return fail("bad_phase")
      t.phase = "playing"
      t.endsAt = ctx.now + t.durationMs
      draw(s, t, ctx, null)
      return ok(s)

    case "gotIt":
    case "skip":
    case "undoLastGotIt": {
      if (!isClueGiver) return fail("not_your_turn")
      if (t.phase !== "playing") return fail("bad_phase")
      if (intent.type === "undoLastGotIt") {
        const last = [...t.shown].reverse().find((x) => x.outcome === "got")
        if (!last) return fail("invalid")
        t.shown = t.shown.filter((x) => x !== last)
        s.bowl.push(last.cardId)
        // the card that was on screen comes up next again
        t.nextCardId = t.currentCardId
        t.currentCardId = last.cardId
        return ok(s)
      }
      const card = t.currentCardId
      if (!card) return fail("invalid")
      if (intent.cardId && intent.cardId !== card) return fail("stale_card")
      if (intent.type === "skip") {
        if (!s.settings.allowSkips) return fail("skips_disabled")
        record(t, card, "skipped")
        draw(s, t, ctx, card)
        return ok(s)
      }
      record(t, card, "got")
      s.bowl = s.bowl.filter((id) => id !== card)
      if (s.bowl.length === 0) {
        t.emptiedBowl = true
        toReview(t, (t.endsAt ?? ctx.now) - ctx.now)
      } else draw(s, t, ctx, null)
      return ok(s)
    }

    case "reviewToggle": {
      if (!isClueGiver && !actor.isHost) return fail("not_your_turn")
      if (t.phase !== "review") return fail("bad_phase")
      const e = t.shown.find((x) => x.cardId === intent.cardId)
      if (!e || e.outcome === "skipped") return fail("invalid")
      if (e.outcome === "got") {
        e.outcome = "missed"
        if (!s.bowl.includes(e.cardId)) s.bowl.push(e.cardId)
      } else {
        e.outcome = "got"
        s.bowl = s.bowl.filter((id) => id !== e.cardId)
      }
      return ok(s)
    }

    case "confirmReview":
      if (!isClueGiver && !actor.isHost) return fail("not_your_turn")
      if (t.phase !== "review") return fail("bad_phase")
      confirm(s, t, ctx)
      return ok(s)

    case "pause":
      if (t.phase !== "playing") return fail("bad_phase")
      t.phase = "paused"
      t.remainingMs = Math.max(0, (t.endsAt ?? ctx.now) - ctx.now)
      t.endsAt = null
      return ok(s)

    case "resume":
      if (t.phase !== "paused") return fail("bad_phase")
      t.phase = "playing"
      t.endsAt = ctx.now + (t.remainingMs ?? 0)
      t.remainingMs = null
      return ok(s)

    case "skipPlayer":
      if (t.phase !== "ready") return fail("bad_phase")
      s.carry = null
      advance(s, t, ctx, true)
      return ok(s)

    default:
      return fail("invalid")
  }
}
