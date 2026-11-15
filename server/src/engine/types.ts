import type { CardOutcome, ErrorCode, GamePhase, Settings, TeamId, TurnPhase } from "@saladbowl/shared"

export interface Player {
  id: string
  name: string
  team: TeamId | null
  order: number
  kicked: boolean
  joinedAt: number
}

export interface Card {
  id: string
  /** null for words from the host's list */
  playerId: string | null
  word: string
}

export interface Turn {
  id: string
  playerId: string
  team: TeamId
  roundIndex: number
  phase: TurnPhase
  durationMs: number
  /** started from a carryover; its duration is not secondsPerTurn */
  carried: boolean
  endsAt: number | null
  remainingMs: number | null
  currentCardId: string | null
  shown: { cardId: string; outcome: CardOutcome }[]
  /** true when this turn emptied the bowl, so the round may end at confirm */
  emptiedBowl: boolean
}

export interface GameState {
  id: string
  inviteToken: string
  phase: GamePhase
  settings: Settings
  players: Player[]
  cards: Card[]
  roundIndex: number
  /** card ids still in the bowl this round */
  bowl: string[]
  turns: Turn[]
  /** `order` of the player on each team who played last; -1 before anyone has */
  teamCursor: Record<TeamId, number>
  nextTeam: TeamId
  carry: { playerId: string; remainingMs: number } | null
  /** the host's own player in this game; never offered for takeover */
  creatorId?: string | null
  createdAt: number
  updatedAt: number
  endedAt: number | null
}

export interface Actor {
  playerId: string | null
  isHost: boolean
}

export interface Ctx {
  now: number
  rng: () => number
  newId: () => string
}

export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode }

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })
export const fail = <T = never>(code: ErrorCode): Result<T> => ({ ok: false, code })
