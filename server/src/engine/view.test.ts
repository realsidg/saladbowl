import { describe, expect, it } from "vitest"
import { scores } from "./score.js"
import { act, as, host, lobbyWith, makeCtx, startWith } from "./testkit.js"
import { activeTurn, timeUp } from "./turns.js"
import { snapshotFor } from "./view.js"

const ORIGIN = "https://bowl.example"

function started() {
  const ctx = makeCtx(3)
  let { s, id } = startWith(["a", "b"], ["x", "y"], ctx)
  const t = activeTurn(s)!
  s = act(s, as(t.playerId), { type: "startTurn", turnId: t.id }, ctx)
  return { s, id, ctx, t }
}

describe("snapshotFor", () => {
  it("sends the current card's word only to the clue-giver", () => {
    const { s, id, t } = started()
    const word = s.cards.find((c) => c.id === activeTurn(s)!.currentCardId)!.word
    const connected = new Set(Object.values(id))
    expect(snapshotFor(s, as(t.playerId), connected, ORIGIN).turn!.card!.word).toBe(word)
    for (const pid of Object.values(id).filter((p) => p !== t.playerId)) {
      const snap = snapshotFor(s, as(pid, pid === id["x"]), connected, ORIGIN)
      expect(snap.turn!.card).toBeNull()
      expect(JSON.stringify(snap)).not.toContain(word)
    }
  })

  it("shows review details only to the clue-giver and hosts", () => {
    let { s, id, ctx, t } = started()
    s = act(s, as(t.playerId), { type: "gotIt", turnId: t.id }, ctx)
    s = timeUp(s, t.id, ctx)
    const none = new Set<string>()
    expect(snapshotFor(s, as(t.playerId), none, ORIGIN).turn!.review).toHaveLength(2)
    const other = Object.values(id).find((p) => p !== t.playerId)!
    expect(snapshotFor(s, as(other, true), none, ORIGIN).turn!.review).toHaveLength(2)
    expect(snapshotFor(s, as(other), none, ORIGIN).turn!.review).toBeNull()
  })

  it("myWords holds only the viewer's own words, and nobody sees others' words in the lobby", () => {
    const ctx = makeCtx()
    const { s, ids } = lobbyWith(["Anu", "Dev"], ctx, 2)
    const snap = snapshotFor(s, as(ids[0]!), new Set(), ORIGIN)
    expect(snap.myWords.map((w) => w.word)).toEqual(["Anu-w0", "Anu-w1"])
    expect(JSON.stringify(snap)).not.toContain("Dev-w")
    expect(snap.players.find((p) => p.id === ids[1])!.wordCount).toBe(2)
  })

  it("gives the invite URL to hosts only", () => {
    const ctx = makeCtx()
    const { s, ids } = lobbyWith(["Anu"], ctx)
    expect(snapshotFor(s, as(ids[0]!, true), new Set(), ORIGIN).inviteUrl).toBe(`${ORIGIN}/join/${s.inviteToken}`)
    expect(snapshotFor(s, as(ids[0]!), new Set(), ORIGIN).inviteUrl).toBeNull()
  })

  it("marks connected players and names who is up next", () => {
    const { s, id, t } = started()
    const snap = snapshotFor(s, as(id["a"]!), new Set([id["a"]!]), ORIGIN)
    expect(snap.players.find((p) => p.id === id["a"])!.connected).toBe(true)
    expect(snap.players.find((p) => p.id === id["b"])!.connected).toBe(false)
    expect(t.playerId).toBe(id["a"])
    expect(snap.upNext).toEqual({ playerId: id["x"] })
  })
})

describe("scores", () => {
  it("sums got cards from done turns by team, round and player", () => {
    let { s, ctx, t } = started()
    for (let i = 0; i < 3; i++) s = act(s, as(t.playerId), { type: "gotIt", turnId: t.id }, ctx)
    s = timeUp(s, t.id, ctx)
    s = act(s, as(t.playerId), { type: "confirmReview", turnId: t.id }, ctx)
    const t2 = activeTurn(s)!
    s = act(s, as(t2.playerId), { type: "startTurn", turnId: t2.id }, ctx)
    for (let i = 0; i < 2; i++) s = act(s, as(t2.playerId), { type: "gotIt", turnId: t2.id }, ctx)
    s = timeUp(s, t2.id, ctx)
    const live = scores(s)
    expect(live.byTeam).toEqual({ tangerine: 3, lagoon: 0 }) // t2 still in review
    s = act(s, host, { type: "confirmReview", turnId: t2.id }, ctx)
    const sc = scores(s)
    expect(sc.byTeam).toEqual({ tangerine: 3, lagoon: 2 })
    expect(sc.byRound[0]).toEqual({ tangerine: 3, lagoon: 2 })
    expect(sc.byRound).toHaveLength(3)
    expect(sc.byPlayer[t.playerId]).toBe(3)
    expect(sc.byPlayer[t2.playerId]).toBe(2)
  })
})
