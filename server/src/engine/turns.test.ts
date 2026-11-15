import { describe, expect, it } from "vitest"
import { applyIntent } from "./apply.js"
import { act, as, host, makeCtx, startWith } from "./testkit.js"
import { activeTurn, nextDeadline, timeUp } from "./turns.js"
import type { GameState } from "./types.js"

const turn = (s: GameState) => activeTurn(s)!
const clue = (s: GameState) => as(turn(s).playerId)

/** 2v2 game, 2 words each (8 cards), first turn started at ctx.now. */
function playing(opts: { words?: number; skips?: boolean; rounds?: number } = {}) {
  const ctx = makeCtx(7)
  let { s, id } = startWith(["a", "b"], ["x", "y"], ctx, opts.words ?? 2)
  if (opts.skips === false) s = act(s, host, { type: "updateSettings", patch: {} }, ctx)
  s = structuredClone(s)
  if (opts.skips === false) s.settings.allowSkips = false
  if (opts.rounds) s.settings.rounds = s.settings.rounds.slice(0, opts.rounds)
  s = act(s, clue(s), { type: "startTurn", turnId: turn(s).id }, ctx)
  return { s, id, ctx }
}

/** Guess every card left in the bowl. */
function guessAll(s: GameState, ctx: ReturnType<typeof makeCtx>) {
  while (turn(s).phase === "playing") s = act(s, clue(s), { type: "gotIt", turnId: turn(s).id }, ctx)
  return s
}

describe("acting on turns", () => {
  it("only the turn's player may start it", () => {
    const ctx = makeCtx()
    const { s, id } = startWith(["a"], ["x"], ctx)
    expect(applyIntent(s, as(id["x"]!), { type: "startTurn", turnId: turn(s).id }, ctx)).toEqual({ ok: false, code: "not_your_turn" })
  })

  it("rejects a turnId that is not the active turn", () => {
    const { s, ctx } = playing()
    expect(applyIntent(s, clue(s), { type: "gotIt", turnId: "old" }, ctx)).toEqual({ ok: false, code: "stale_turn" })
  })

  it("rejects gotIt after time is up", () => {
    const { s, ctx } = playing()
    const s2 = timeUp(s, turn(s).id, ctx)
    expect(applyIntent(s2, clue(s2), { type: "gotIt", turnId: turn(s2).id }, ctx)).toEqual({ ok: false, code: "bad_phase" })
  })

  it("rejects a second confirmReview", () => {
    const { s, ctx } = playing()
    const t = turn(s)
    let s2 = timeUp(s, t.id, ctx)
    s2 = act(s2, as(t.playerId), { type: "confirmReview", turnId: t.id }, ctx)
    expect(applyIntent(s2, as(t.playerId), { type: "confirmReview", turnId: t.id }, ctx)).toEqual({ ok: false, code: "stale_turn" })
  })
})

describe("playing a turn", () => {
  it("startTurn sets endsAt and draws a card from the bowl", () => {
    const { s, ctx } = playing()
    expect(turn(s).phase).toBe("playing")
    expect(turn(s).endsAt).toBe(ctx.now + 60_000)
    expect(s.bowl).toContain(turn(s).currentCardId)
  })

  it("gotIt records the card, removes it from the bowl and draws another", () => {
    const { s, ctx } = playing()
    const card = turn(s).currentCardId!
    const s2 = act(s, clue(s), { type: "gotIt", turnId: turn(s).id }, ctx)
    expect(turn(s2).shown).toEqual([{ cardId: card, outcome: "got" }])
    expect(s2.bowl).not.toContain(card)
    expect(s2.bowl).toContain(turn(s2).currentCardId)
  })

  it("skip is refused when skips are off", () => {
    const { s, ctx } = playing({ skips: false })
    expect(applyIntent(s, clue(s), { type: "skip", turnId: turn(s).id }, ctx)).toEqual({ ok: false, code: "skips_disabled" })
  })

  it("skip keeps the card in the bowl and draws a different one", () => {
    const { s, ctx } = playing()
    const card = turn(s).currentCardId!
    const s2 = act(s, clue(s), { type: "skip", turnId: turn(s).id }, ctx)
    expect(turn(s2).shown).toEqual([{ cardId: card, outcome: "skipped" }])
    expect(s2.bowl).toContain(card)
    expect(turn(s2).currentCardId).not.toBe(card)
  })

  it("skip with one card left redraws that card", () => {
    let { s, ctx } = playing()
    while (s.bowl.length > 1) s = act(s, clue(s), { type: "gotIt", turnId: turn(s).id }, ctx)
    const last = turn(s).currentCardId
    s = act(s, clue(s), { type: "skip", turnId: turn(s).id }, ctx)
    expect(turn(s).currentCardId).toBe(last)
  })

  it("undoLastGotIt puts the last got card back as the current card", () => {
    let { s, ctx } = playing()
    const first = turn(s).currentCardId!
    s = act(s, clue(s), { type: "gotIt", turnId: turn(s).id }, ctx)
    const second = turn(s).currentCardId!
    s = act(s, clue(s), { type: "undoLastGotIt", turnId: turn(s).id }, ctx)
    expect(turn(s).currentCardId).toBe(first)
    expect(turn(s).shown).toEqual([])
    expect(s.bowl).toContain(first)
    expect(s.bowl).toContain(second)
  })

  it("timeUp moves to review and marks the current card missed, keeping it in the bowl", () => {
    const { s, ctx } = playing()
    const card = turn(s).currentCardId!
    const s2 = timeUp(s, turn(s).id, ctx)
    expect(turn(s2).phase).toBe("review")
    expect(turn(s2).remainingMs).toBe(0)
    expect(turn(s2).shown).toEqual([{ cardId: card, outcome: "missed" }])
    expect(s2.bowl).toContain(card)
  })

  it("timeUp ignores a turn that is not playing", () => {
    const { s, ctx } = playing()
    const paused = act(s, host, { type: "pause", turnId: turn(s).id }, ctx)
    expect(timeUp(paused, turn(s).id, ctx)).toBe(paused)
  })
})

describe("review, rounds and carryover", () => {
  it("bowl emptied with 20 s left carries the same player into the next round", () => {
    let { s, ctx } = playing()
    const player = turn(s).playerId
    ctx.advance(40_000)
    s = guessAll(s, ctx)
    expect(turn(s)).toMatchObject({ phase: "review", emptiedBowl: true, remainingMs: 20_000 })
    s = act(s, as(player), { type: "confirmReview", turnId: turn(s).id }, ctx)
    expect(s.roundIndex).toBe(1)
    expect([...s.bowl].sort()).toEqual(s.cards.map((c) => c.id).sort())
    expect(turn(s)).toMatchObject({ playerId: player, phase: "ready", durationMs: 20_000 })
  })

  it("bowl emptied with 1.5 s left passes to the other team", () => {
    let { s, ctx } = playing()
    const t0 = turn(s)
    ctx.advance(58_500)
    s = guessAll(s, ctx)
    s = act(s, as(t0.playerId), { type: "confirmReview", turnId: t0.id }, ctx)
    expect(s.roundIndex).toBe(1)
    expect(turn(s).team).not.toBe(t0.team)
    expect(turn(s).durationMs).toBe(60_000)
  })

  it("unticking a card after emptying the bowl continues the same round with the frozen time", () => {
    let { s, ctx } = playing()
    const player = turn(s).playerId
    ctx.advance(30_000)
    s = guessAll(s, ctx)
    const card = turn(s).shown[0]!.cardId
    s = act(s, as(player), { type: "reviewToggle", turnId: turn(s).id, cardId: card }, ctx)
    s = act(s, as(player), { type: "confirmReview", turnId: turn(s).id }, ctx)
    expect(s.roundIndex).toBe(0)
    expect(s.bowl).toEqual([card])
    expect(turn(s)).toMatchObject({ playerId: player, durationMs: 30_000 })
  })

  it("emptying the bowl in the last round ends the game", () => {
    let { s, ctx } = playing({ rounds: 1 })
    s = guessAll(s, ctx)
    s = act(s, clue(s), { type: "confirmReview", turnId: turn(s).id }, ctx)
    expect(s.phase).toBe("ended")
    expect(s.endedAt).toBe(ctx.now)
  })

  it("reviewToggle: clue-giver or host only, flips got and missed only, review phase only", () => {
    let { s, ctx, id } = playing()
    s = act(s, clue(s), { type: "gotIt", turnId: turn(s).id }, ctx)
    const got = turn(s).shown[0]!.cardId
    expect(applyIntent(s, clue(s), { type: "reviewToggle", turnId: turn(s).id, cardId: got }, ctx)).toEqual({ ok: false, code: "bad_phase" })
    s = timeUp(s, turn(s).id, ctx)
    const other = Object.values(id).find((p) => p !== turn(s).playerId)!
    expect(applyIntent(s, as(other), { type: "reviewToggle", turnId: turn(s).id, cardId: got }, ctx)).toEqual({ ok: false, code: "not_your_turn" })
    s = act(s, host, { type: "reviewToggle", turnId: turn(s).id, cardId: got }, ctx)
    expect(turn(s).shown.find((x) => x.cardId === got)!.outcome).toBe("missed")
    expect(s.bowl).toContain(got)
    s = act(s, clue(s), { type: "reviewToggle", turnId: turn(s).id, cardId: got }, ctx)
    expect(turn(s).shown.find((x) => x.cardId === got)!.outcome).toBe("got")
    expect(s.bowl).not.toContain(got)
  })
})

describe("host controls", () => {
  it("pause stores remaining time; resume sets a new endsAt; no deadline while paused", () => {
    let { s, ctx } = playing()
    ctx.advance(15_000)
    s = act(s, host, { type: "pause", turnId: turn(s).id }, ctx)
    expect(turn(s)).toMatchObject({ phase: "paused", remainingMs: 45_000, endsAt: null })
    expect(nextDeadline(s)).toBeNull()
    ctx.advance(100_000)
    s = act(s, host, { type: "resume", turnId: turn(s).id }, ctx)
    expect(turn(s)).toMatchObject({ phase: "playing", endsAt: ctx.now + 45_000 })
    expect(nextDeadline(s)).toEqual({ turnId: turn(s).id, at: ctx.now + 45_000 })
  })

  it("skipPlayer only works on a ready turn and moves to the next player", () => {
    const ctx = makeCtx()
    let { s } = startWith(["a", "b"], ["x", "y"], ctx)
    const t0 = turn(s)
    s = act(s, host, { type: "skipPlayer", turnId: t0.id }, ctx)
    expect(s.turns.find((t) => t.id === t0.id)!.phase).toBe("done")
    expect(turn(s).phase).toBe("ready")
    expect(turn(s).playerId).not.toBe(t0.playerId)
    s = act(s, as(turn(s).playerId), { type: "startTurn", turnId: turn(s).id }, ctx)
    expect(applyIntent(s, host, { type: "skipPlayer", turnId: turn(s).id }, ctx)).toEqual({ ok: false, code: "bad_phase" })
  })

  it("kicking the clue-giver mid-turn sends the turn to review", () => {
    let { s, ctx } = playing()
    s = act(s, host, { type: "kickPlayer", playerId: turn(s).playerId }, ctx)
    expect(turn(s).phase).toBe("review")
  })

  it("kicking the player whose turn is ready moves on", () => {
    const ctx = makeCtx()
    let { s } = startWith(["a", "b"], ["x"], ctx)
    const t0 = turn(s)
    s = act(s, host, { type: "kickPlayer", playerId: t0.playerId }, ctx)
    expect(turn(s).playerId).not.toBe(t0.playerId)
    expect(turn(s).phase).toBe("ready")
  })

  it("a new secondsPerTurn applies from the next turn, not the running one", () => {
    let { s, ctx } = playing()
    const t0 = turn(s)
    s = act(s, host, { type: "updateSettings", patch: { secondsPerTurn: 30 } }, ctx)
    expect(turn(s).durationMs).toBe(60_000)
    s = timeUp(s, t0.id, ctx)
    s = act(s, as(t0.playerId), { type: "confirmReview", turnId: t0.id }, ctx)
    expect(turn(s).durationMs).toBe(30_000)
  })

  it("endGame ends the game and closes the active turn", () => {
    let { s, ctx } = playing()
    s = act(s, host, { type: "endGame" }, ctx)
    expect(s.phase).toBe("ended")
    expect(activeTurn(s)).toBeNull()
  })
})

describe("review fixes", () => {
  it("ignores gotIt/skip aimed at a card that is no longer on screen (double tap)", () => {
    let { s, ctx } = playing()
    const first = turn(s).currentCardId!
    s = act(s, clue(s), { type: "gotIt", turnId: turn(s).id, cardId: first }, ctx)
    const r = applyIntent(s, clue(s), { type: "gotIt", turnId: turn(s).id, cardId: first }, ctx)
    expect(r).toEqual({ ok: false, code: "stale_card" })
    const r2 = applyIntent(s, clue(s), { type: "skip", turnId: turn(s).id, cardId: first }, ctx)
    expect(r2).toEqual({ ok: false, code: "stale_card" })
    expect(turn(s).shown).toHaveLength(1)
  })
})

describe("next card drawn in advance", () => {
  it("keeps a next card that is in the bowl and isn't the current one", () => {
    const { s } = playing()
    const t = turn(s)
    expect(t.nextCardId).not.toBeNull()
    expect(t.nextCardId).not.toBe(t.currentCardId)
    expect(s.bowl).toContain(t.nextCardId)
  })

  it("Got it shows exactly the card that was drawn in advance", () => {
    let { s, ctx } = playing()
    for (let i = 0; i < 4; i++) {
      const next = turn(s).nextCardId
      s = act(s, clue(s), { type: "gotIt", turnId: turn(s).id, cardId: turn(s).currentCardId! }, ctx)
      expect(turn(s).currentCardId).toBe(next)
    }
  })

  it("Skip also moves to the card drawn in advance", () => {
    let { s, ctx } = playing()
    const next = turn(s).nextCardId
    s = act(s, clue(s), { type: "skip", turnId: turn(s).id, cardId: turn(s).currentCardId! }, ctx)
    expect(turn(s).currentCardId).toBe(next)
  })

  it("has no next card when only one card is left", () => {
    let { s, ctx } = playing()
    while (s.bowl.length > 1) s = act(s, clue(s), { type: "gotIt", turnId: turn(s).id }, ctx)
    expect(turn(s).nextCardId).toBeNull()
  })
})
