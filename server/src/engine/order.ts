import type { TeamId } from "@saladbowl/shared"
import type { GameState, Player } from "./types.js"

export const otherTeam = (t: TeamId): TeamId => (t === "tangerine" ? "lagoon" : "tangerine")

export function activeTeamPlayers(s: GameState, team: TeamId): Player[] {
  return s.players.filter((p) => p.team === team && !p.kicked).sort((a, b) => a.order - b.order)
}

/** The player after `cursor` (an `order` value) in that team's rotation, wrapping round. */
function nextInTeam(s: GameState, team: TeamId): Player | null {
  const players = activeTeamPlayers(s, team)
  if (players.length === 0) return null
  const cursor = s.teamCursor[team]
  return players.find((p) => p.order > cursor) ?? players[0]!
}

/** Who plays the next turn: `nextTeam`'s next player, or the other team's if that team is empty. */
export function nextPlayer(s: GameState): Player | null {
  return nextInTeam(s, s.nextTeam) ?? nextInTeam(s, otherTeam(s.nextTeam))
}
