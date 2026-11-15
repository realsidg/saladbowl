import type { Scores } from "@saladbowl/shared"
import type { GameState } from "./types.js"

/** Points from finished turns only: one per card marked got. */
export function scores(s: GameState): Scores {
  const out: Scores = {
    byTeam: { tangerine: 0, lagoon: 0 },
    byRound: s.settings.rounds.map(() => ({ tangerine: 0, lagoon: 0 })),
    byPlayer: {},
  }
  for (const t of s.turns) {
    if (t.phase !== "done") continue
    const got = t.shown.filter((x) => x.outcome === "got").length
    if (got === 0) continue
    out.byTeam[t.team] += got
    const round = out.byRound[t.roundIndex]
    if (round) round[t.team] += got
    out.byPlayer[t.playerId] = (out.byPlayer[t.playerId] ?? 0) + got
  }
  return out
}
