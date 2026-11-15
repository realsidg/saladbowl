import { DEFAULT_SETTINGS, type Snapshot } from "@saladbowl/shared"

type P = Snapshot["players"][number]
export const player = (id: string, name: string, extra: Partial<P> = {}): P => ({
  id,
  name,
  team: null,
  order: 0,
  connected: true,
  kicked: false,
  wordCount: 0,
  ...extra,
})

export function snap(extra: Partial<Snapshot> = {}): Snapshot {
  return {
    me: { playerId: "p1", isHost: false },
    phase: "lobby",
    settings: { ...DEFAULT_SETTINGS, rounds: [...DEFAULT_SETTINGS.rounds] },
    players: [player("p1", "Sid"), player("p2", "Anu")],
    myWords: [],
    hostWordCount: 0,
    roundIndex: 0,
    rounds: [...DEFAULT_SETTINGS.rounds],
    bowlCount: 0,
    scores: { byTeam: { tangerine: 0, lagoon: 0 }, byRound: [], byPlayer: {} },
    turn: null,
    upNext: null,
    inviteUrl: null,
    ...extra,
  }
}
