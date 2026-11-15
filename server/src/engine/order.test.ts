import { describe, expect, it } from "vitest"
import { addPlayer } from "./lobby.js"
import { nextPlayer } from "./order.js"
import { act, host, makeCtx, must, startWith } from "./testkit.js"
import type { Ctx, GameState } from "./types.js"

const nameOf = (s: GameState, playerId: string) => s.players.find((p) => p.id === playerId)!.name
const active = (s: GameState) => s.turns[s.turns.length - 1]!

function playEmpty(s: GameState, ctx: Ctx, timeUp: (s: GameState, id: string) => GameState): GameState {
  const t = active(s)
  const p = { playerId: t.playerId, isHost: false }
  s = act(s, p, { type: "startTurn", turnId: t.id }, ctx)
  s = timeUp(s, t.id)
  return act(s, p, { type: "confirmReview", turnId: t.id }, ctx)
}

describe("turn order", async () => {
  const { timeUp } = await import("./turns.js")

  function sequence(s: GameState, ctx: Ctx, n: number) {
    const names = [nameOf(s, active(s).playerId)]
    for (let i = 1; i < n; i++) {
      s = playEmpty(s, ctx, (st, id) => timeUp(st, id, ctx))
      names.push(nameOf(s, active(s).playerId))
    }
    return { names, s }
  }

  it("alternates teams, each team keeping its own rotation", () => {
    const ctx = makeCtx()
    const { s } = startWith(["a", "b", "c"], ["x", "y"], ctx)
    expect(sequence(s, ctx, 7).names).toEqual(["a", "x", "b", "y", "c", "x", "a"])
  })

  it("skips kicked players", () => {
    const ctx = makeCtx()
    let { s, id } = startWith(["a", "b", "c"], ["x", "y"], ctx)
    s = act(s, host, { type: "kickPlayer", playerId: id["b"]! }, ctx)
    expect(sequence(s, ctx, 5).names).toEqual(["a", "x", "c", "y", "a"])
  })

  it("puts a late joiner into their team's next rotation", () => {
    const ctx = makeCtx()
    let { s } = startWith(["a", "b"], ["x"], ctx)
    s = must(addPlayer(s, "z", ctx)).state // lagoon is smaller
    expect(sequence(s, ctx, 4).names).toEqual(["a", "x", "b", "z"])
  })

  it("gives every turn to the other team when one team is empty", () => {
    const ctx = makeCtx()
    let { s, id } = startWith(["a"], ["x", "y"], ctx)
    s = act(s, host, { type: "kickPlayer", playerId: id["a"]! }, ctx)
    expect(sequence(s, ctx, 3).names).toEqual(["x", "y", "x"])
  })
})

it("nextPlayer is null when nobody can play", () => {
  const ctx = makeCtx()
  let { s, id } = startWith(["a"], ["x"], ctx)
  s = structuredClone(s)
  for (const p of s.players) p.kicked = true
  expect(nextPlayer(s)).toBeNull()
  void id
})
