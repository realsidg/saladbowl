import { describe, expect, it } from "vitest"
import type { Intent } from "@saladbowl/shared"
import { applyIntent } from "./apply.js"
import { addPlayer, createGame } from "./lobby.js"
import { act, as, host, lobbyWith, makeCtx, must } from "./testkit.js"

describe("players", () => {
  it("trims names and rejects duplicates case-insensitively", () => {
    const ctx = makeCtx()
    let s = createGame(ctx, "inv")
    const a = must(addPlayer(s, "  Anu  ", ctx))
    s = a.state
    expect(s.players[0]!.name).toBe("Anu")
    const dup = addPlayer(s, " anu ", ctx)
    expect(dup).toEqual({ ok: false, code: "name_taken" })
  })

  it("rejects blank names", () => {
    const ctx = makeCtx()
    expect(addPlayer(createGame(ctx, "inv"), "   ", ctx)).toEqual({ ok: false, code: "invalid" })
  })

  it("setName rejects a name another player has", () => {
    const ctx = makeCtx()
    const { s, ids } = lobbyWith(["Anu", "Dev"], ctx)
    expect(applyIntent(s, as(ids[1]!), { type: "setName", name: "ANU" }, ctx)).toEqual({ ok: false, code: "name_taken" })
    const renamed = act(s, as(ids[1]!), { type: "setName", name: "Devika" }, ctx)
    expect(renamed.players[1]!.name).toBe("Devika")
  })

  it("places late joiners on the smaller team, ties to lagoon, at the end of its order", () => {
    const ctx = makeCtx()
    let { s } = lobbyWith(["A", "B", "C"], ctx)
    s = act(s, host, { type: "makeTeams" }, ctx)
    const counts = (t: string) => s.players.filter((p) => p.team === t).length
    const smaller = counts("tangerine") < counts("lagoon") ? "tangerine" : "lagoon"
    const r = must(addPlayer(s, "Late", ctx))
    const late = r.state.players.find((p) => p.id === r.playerId)!
    expect(late.team).toBe(smaller)
    const maxOrder = Math.max(...s.players.filter((p) => p.team === smaller).map((p) => p.order))
    expect(late.order).toBe(maxOrder + 1)
    // now 2 v 2: tie goes to lagoon
    const r2 = must(addPlayer(r.state, "Later", ctx))
    expect(r2.state.players.find((p) => p.id === r2.playerId)!.team).toBe("lagoon")
  })

  it("does not mutate its input", () => {
    const ctx = makeCtx()
    const { s, ids } = lobbyWith(["Anu", "Dev"], ctx)
    const before = JSON.stringify(s)
    act(s, as(ids[0]!), { type: "setName", name: "X" }, ctx)
    expect(JSON.stringify(s)).toBe(before)
  })
})

describe("words", () => {
  it("enforces words per player", () => {
    const ctx = makeCtx()
    const { s, ids } = lobbyWith(["Anu"], ctx, 2)
    expect(applyIntent(s, as(ids[0]!), { type: "addWord", word: "more" }, ctx)).toEqual({ ok: false, code: "limit" })
  })

  it("enforces the starting letter", () => {
    const ctx = makeCtx()
    let s = createGame(ctx, "inv")
    s = act(s, host, { type: "updateSettings", patch: { startingLetter: "S" } }, ctx)
    const r = must(addPlayer(s, "Anu", ctx))
    s = r.state
    expect(applyIntent(s, as(r.playerId), { type: "addWord", word: "taj" }, ctx)).toEqual({ ok: false, code: "letter_mismatch" })
    s = act(s, as(r.playerId), { type: "addWord", word: "sun" }, ctx)
    expect(s.cards.map((c) => c.word)).toEqual(["sun"])
  })

  it("only lets players edit and remove their own words", () => {
    const ctx = makeCtx()
    const { s, ids } = lobbyWith(["Anu", "Dev"], ctx)
    const devCard = s.cards.find((c) => c.playerId === ids[1])!
    expect(applyIntent(s, as(ids[0]!), { type: "editWord", cardId: devCard.id, word: "x" }, ctx)).toEqual({ ok: false, code: "invalid" })
    expect(applyIntent(s, as(ids[0]!), { type: "removeWord", cardId: devCard.id }, ctx)).toEqual({ ok: false, code: "invalid" })
    const edited = act(s, as(ids[1]!), { type: "editWord", cardId: devCard.id, word: "  new  " }, ctx)
    expect(edited.cards.find((c) => c.id === devCard.id)!.word).toBe("new")
    const removed = act(s, as(ids[1]!), { type: "removeWord", cardId: devCard.id }, ctx)
    expect(removed.cards.find((c) => c.id === devCard.id)).toBeUndefined()
  })

  it("rejects word intents outside the lobby", () => {
    const ctx = makeCtx()
    let { s, ids } = lobbyWith(["Anu", "Dev"], ctx)
    s = act(s, host, { type: "makeTeams" }, ctx)
    expect(applyIntent(s, as(ids[0]!), { type: "addWord", word: "x" }, ctx)).toEqual({ ok: false, code: "bad_phase" })
  })

  it("host word list creates host-owned cards", () => {
    const ctx = makeCtx()
    let s = createGame(ctx, "inv")
    s = act(s, host, { type: "updateSettings", patch: { wordSource: "host" } }, ctx)
    s = act(s, host, { type: "setHostWordList", words: ["a", "b", "c"] }, ctx)
    expect(s.cards.map((c) => [c.word, c.playerId])).toEqual([["a", null], ["b", null], ["c", null]])
  })
})

describe("host-only intents", () => {
  const hostOnly: Intent[] = [
    { type: "updateSettings", patch: { secondsPerTurn: 30 } },
    { type: "makeTeams" },
    { type: "shuffleTeams" },
    { type: "movePlayer", playerId: "x", team: "lagoon" },
    { type: "backToLobby" },
    { type: "startGame" },
    { type: "setHostWordList", words: ["a"] },
    { type: "kickPlayer", playerId: "x" },
    { type: "resetInvite" },
    { type: "endGame" },
  ]
  it.each(hostOnly.map((i) => [i.type, i] as const))("%s is refused for non-hosts", (_t, intent) => {
    const ctx = makeCtx()
    const { s, ids } = lobbyWith(["Anu", "Dev"], ctx)
    expect(applyIntent(s, as(ids[0]!), intent, ctx)).toEqual({ ok: false, code: "not_host" })
  })
})

describe("teams and start", () => {
  it("makeTeams splits named players into teams within 1 of each other", () => {
    const ctx = makeCtx()
    let { s } = lobbyWith(["A", "B", "C", "D", "E"], ctx)
    s = act(s, host, { type: "makeTeams" }, ctx)
    expect(s.phase).toBe("teams")
    const t = s.players.filter((p) => p.team === "tangerine").length
    const l = s.players.filter((p) => p.team === "lagoon").length
    expect(t + l).toBe(5)
    expect(Math.abs(t - l)).toBeLessThanOrEqual(1)
  })

  it("refuses to start with fewer than 2 players", () => {
    const ctx = makeCtx()
    let { s } = lobbyWith(["A"], ctx)
    s = act(s, host, { type: "makeTeams" }, ctx)
    expect(applyIntent(s, host, { type: "startGame" }, ctx)).toEqual({ ok: false, code: "invalid" })
  })

  it("refuses to start with an empty team", () => {
    const ctx = makeCtx()
    let { s, ids } = lobbyWith(["A", "B"], ctx)
    s = act(s, host, { type: "makeTeams" }, ctx)
    s = act(s, host, { type: "movePlayer", playerId: ids[0]!, team: "lagoon" }, ctx)
    s = act(s, host, { type: "movePlayer", playerId: ids[1]!, team: "lagoon" }, ctx)
    expect(applyIntent(s, host, { type: "startGame" }, ctx)).toEqual({ ok: false, code: "invalid" })
  })

  it("refuses to start when a player is short of words", () => {
    const ctx = makeCtx()
    let { s, ids } = lobbyWith(["A", "B"], ctx, 2)
    const card = s.cards.find((c) => c.playerId === ids[0])!
    s = act(s, as(ids[0]!), { type: "removeWord", cardId: card.id }, ctx)
    s = act(s, host, { type: "makeTeams" }, ctx)
    expect(applyIntent(s, host, { type: "startGame" }, ctx)).toEqual({ ok: false, code: "invalid" })
  })

  it("refuses to start in host mode with an empty list", () => {
    const ctx = makeCtx()
    let s = createGame(ctx, "inv")
    s = act(s, host, { type: "updateSettings", patch: { wordSource: "host" } }, ctx)
    s = must(addPlayer(s, "A", ctx)).state
    s = must(addPlayer(s, "B", ctx)).state
    s = act(s, host, { type: "makeTeams" }, ctx)
    expect(applyIntent(s, host, { type: "startGame" }, ctx)).toEqual({ ok: false, code: "invalid" })
  })

  it("starts: playing, round 0, full bowl, a ready turn for nextTeam's first player", () => {
    const ctx = makeCtx()
    let { s } = lobbyWith(["A", "B", "C", "D"], ctx)
    s = act(s, host, { type: "makeTeams" }, ctx)
    s = act(s, host, { type: "startGame" }, ctx)
    expect(s.phase).toBe("playing")
    expect(s.roundIndex).toBe(0)
    expect([...s.bowl].sort()).toEqual(s.cards.map((c) => c.id).sort())
    expect(s.turns).toHaveLength(1)
    const turn = s.turns[0]!
    expect(turn.phase).toBe("ready")
    const first = s.players.filter((p) => p.team === turn.team).sort((a, b) => a.order - b.order)[0]!
    expect(turn.playerId).toBe(first.id)
    expect(turn.durationMs).toBe(60_000)
  })

  it("locks words per player and word source after start but allows seconds per turn", () => {
    const ctx = makeCtx()
    let { s } = lobbyWith(["A", "B"], ctx)
    s = act(s, host, { type: "makeTeams" }, ctx)
    s = act(s, host, { type: "startGame" }, ctx)
    expect(applyIntent(s, host, { type: "updateSettings", patch: { wordsPerPlayer: 3 } }, ctx)).toEqual({ ok: false, code: "bad_phase" })
    expect(applyIntent(s, host, { type: "updateSettings", patch: { wordSource: "host" } }, ctx)).toEqual({ ok: false, code: "bad_phase" })
    const s2 = act(s, host, { type: "updateSettings", patch: { secondsPerTurn: 30 } }, ctx)
    expect(s2.settings.secondsPerTurn).toBe(30)
  })

  it("resetInvite gives a new token", () => {
    const ctx = makeCtx()
    const { s } = lobbyWith(["A"], ctx)
    const s2 = act(s, host, { type: "resetInvite" }, ctx)
    expect(s2.inviteToken).not.toBe(s.inviteToken)
  })
})

describe("word source switch", () => {
  it("clears the other source's words when the host switches", () => {
    const ctx = makeCtx()
    let { s } = lobbyWith(["A"], ctx, 2)
    s = act(s, host, { type: "updateSettings", patch: { wordSource: "host" } }, ctx)
    expect(s.cards).toHaveLength(0)
    s = act(s, host, { type: "setHostWordList", words: ["x", "y"] }, ctx)
    s = act(s, host, { type: "updateSettings", patch: { wordSource: "players" } }, ctx)
    expect(s.cards).toHaveLength(0)
  })
})

describe("duplicate words", () => {
  it("rejects a word already in the bowl, from anyone, ignoring case, spaces and punctuation", () => {
    const ctx = makeCtx()
    let { s, ids } = lobbyWith(["Anu", "Dev"], ctx, 0)
    s = act(s, host, { type: "updateSettings", patch: { wordsPerPlayer: 3 } }, ctx)
    s = act(s, as(ids[0]!), { type: "addWord", word: "Shah Rukh Khan" }, ctx)
    expect(applyIntent(s, as(ids[0]!), { type: "addWord", word: "Shah Rukh Khan" }, ctx)).toEqual({ ok: false, code: "duplicate_word" })
    expect(applyIntent(s, as(ids[1]!), { type: "addWord", word: "  shah rukh khan " }, ctx)).toEqual({ ok: false, code: "duplicate_word" })
    expect(applyIntent(s, as(ids[1]!), { type: "addWord", word: "Shah-Rukh Khan!" }, ctx)).toEqual({ ok: false, code: "duplicate_word" })
    s = act(s, as(ids[1]!), { type: "addWord", word: "Salman Khan" }, ctx)
    expect(s.cards).toHaveLength(2)
  })

  it("rejects editing a word into one that's already there, but allows re-saving the same word", () => {
    const ctx = makeCtx()
    let { s, ids } = lobbyWith(["Anu", "Dev"], ctx, 0)
    s = act(s, host, { type: "updateSettings", patch: { wordsPerPlayer: 2 } }, ctx)
    s = act(s, as(ids[0]!), { type: "addWord", word: "Taj Mahal" }, ctx)
    s = act(s, as(ids[1]!), { type: "addWord", word: "Biryani" }, ctx)
    const devCard = s.cards.find((c) => c.playerId === ids[1])!
    expect(applyIntent(s, as(ids[1]!), { type: "editWord", cardId: devCard.id, word: "taj mahal" }, ctx)).toEqual({ ok: false, code: "duplicate_word" })
    expect(applyIntent(s, as(ids[1]!), { type: "editWord", cardId: devCard.id, word: "BIRYANI" }, ctx).ok).toBe(true)
  })

  it("drops duplicates from the host's word list", () => {
    const ctx = makeCtx()
    let s = createGame(ctx, "inv")
    s = act(s, host, { type: "updateSettings", patch: { wordSource: "host" } }, ctx)
    s = act(s, host, { type: "setHostWordList", words: ["Goa", "goa", "Kerala", "GOA!"] }, ctx)
    expect(s.cards.map((c) => c.word)).toEqual(["Goa", "Kerala"])
  })
})
