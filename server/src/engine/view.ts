import type { Snapshot } from "@saladbowl/shared"
import { nextPlayer, otherTeam } from "./order.js"
import { scores } from "./score.js"
import { activeTurn } from "./turns.js"
import type { Actor, GameState } from "./types.js"

function upNext(s: GameState): Snapshot["upNext"] {
  if (s.phase !== "playing") return null
  const t = activeTurn(s)
  if (!t) return null
  const order = s.players.find((p) => p.id === t.playerId)?.order ?? -1
  const after = { ...s, teamCursor: { ...s.teamCursor, [t.team]: order }, nextTeam: otherTeam(t.team) }
  const p = nextPlayer(after)
  return p ? { playerId: p.id } : null
}

/** What one viewer may see. Card words leave the server only for their owner (lobby) or the clue-giver. */
export function snapshotFor(s: GameState, viewer: Actor, connected: Set<string>, origin: string): Snapshot {
  const word = (id: string) => s.cards.find((c) => c.id === id)?.word ?? ""
  const t = activeTurn(s)
  const isClueGiver = Boolean(t && viewer.playerId === t.playerId)
  return {
    me: { playerId: viewer.playerId, isHost: viewer.isHost },
    phase: s.phase,
    settings: s.settings,
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      order: p.order,
      connected: connected.has(p.id),
      kicked: p.kicked,
      wordCount: s.cards.filter((c) => c.playerId === p.id).length,
    })),
    myWords: s.phase === "lobby" ? s.cards.filter((c) => c.playerId && c.playerId === viewer.playerId).map((c) => ({ id: c.id, word: c.word })) : [],
    hostWordCount: s.cards.filter((c) => c.playerId === null).length,
    roundIndex: s.roundIndex,
    rounds: s.settings.rounds,
    bowlCount: s.bowl.length,
    scores: scores(s),
    turn: t && {
      id: t.id,
      playerId: t.playerId,
      team: t.team,
      phase: t.phase,
      endsAt: t.endsAt,
      remainingMs: t.remainingMs,
      durationMs: t.durationMs,
      gotCount: t.shown.filter((x) => x.outcome === "got").length,
      card: isClueGiver && t.phase === "playing" && t.currentCardId ? { id: t.currentCardId, word: word(t.currentCardId) } : null,
      nextCard: isClueGiver && t.phase === "playing" && t.nextCardId ? { id: t.nextCardId, word: word(t.nextCardId) } : null,
      review:
        t.phase === "review" && (isClueGiver || viewer.isHost)
          ? t.shown.map((x) => ({ cardId: x.cardId, word: word(x.cardId), outcome: x.outcome }))
          : null,
    },
    upNext: upNext(s),
    // Every player may bring others in; the host can still reset the invite to cut it off.
    inviteUrl: viewer.playerId || viewer.isHost ? `${origin}/join/${s.inviteToken}` : null,
  }
}
