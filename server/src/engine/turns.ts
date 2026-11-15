import { nextPlayer } from "./order.js"
import type { Ctx, GameState, Turn } from "./types.js"

/** Appends a `ready` turn for whoever plays next (honouring a carryover). Returns null if nobody can play. */
export function createReadyTurn(s: GameState, ctx: Ctx): Turn | null {
  const carry = s.carry && s.players.find((p) => p.id === s.carry!.playerId && !p.kicked)
  const player = carry ?? nextPlayer(s)
  if (!player || !player.team) return null
  const turn: Turn = {
    id: ctx.newId(),
    playerId: player.id,
    team: player.team,
    roundIndex: s.roundIndex,
    phase: "ready",
    durationMs: carry ? s.carry!.remainingMs : s.settings.secondsPerTurn * 1000,
    endsAt: null,
    remainingMs: null,
    currentCardId: null,
    shown: [],
    emptiedBowl: false,
  }
  s.turns.push(turn)
  return turn
}
