import { z } from "zod"
import {
  HOST_WORD_LIST_MAX,
  NAME_MAX,
  ROUNDS_MAX,
  ROUNDS_MIN,
  SECONDS_MAX,
  SECONDS_MIN,
  WORD_MAX,
  WORDS_PER_PLAYER_MAX,
  WORDS_PER_PLAYER_MIN,
  WS_MESSAGE_LIMIT,
} from "./limits.js"

export const TEAMS = ["tangerine", "lagoon"] as const
export type TeamId = (typeof TEAMS)[number]

export const ROUND_KINDS = ["taboo", "charades", "password"] as const
export type RoundKind = (typeof ROUND_KINDS)[number]

const id = z.string().min(1).max(64)
const word = z.string().trim().min(1).max(WORD_MAX)
export const nameSchema = z.string().trim().min(1).max(NAME_MAX)
const team = z.enum(TEAMS)

export const settingsSchema = z.object({
  secondsPerTurn: z.number().int().min(SECONDS_MIN).max(SECONDS_MAX),
  wordsPerPlayer: z.number().int().min(WORDS_PER_PLAYER_MIN).max(WORDS_PER_PLAYER_MAX),
  rounds: z.array(z.enum(ROUND_KINDS)).min(ROUNDS_MIN).max(ROUNDS_MAX),
  allowSkips: z.boolean(),
  startingLetter: z
    .string()
    .regex(/^[A-Za-z]$/)
    .transform((s) => s.toUpperCase())
    .nullable(),
  wordSource: z.enum(["players", "host"]),
  teamNames: z.object({ tangerine: nameSchema, lagoon: nameSchema }),
})
export type Settings = z.output<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  secondsPerTurn: 60,
  wordsPerPlayer: 6,
  rounds: ["taboo", "charades", "password"],
  allowSkips: true,
  startingLetter: null,
  wordSource: "players",
  teamNames: { tangerine: "Tangerine", lagoon: "Lagoon" },
}

const turnIntent = <T extends string>(type: T) => z.object({ type: z.literal(type), turnId: id })
const bare = <T extends string>(type: T) => z.object({ type: z.literal(type) })

export const intentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setName"), name: nameSchema }),
  z.object({ type: z.literal("addWord"), word }),
  z.object({ type: z.literal("editWord"), cardId: id, word }),
  z.object({ type: z.literal("removeWord"), cardId: id }),
  z.object({ type: z.literal("setHostWordList"), words: z.array(word).max(HOST_WORD_LIST_MAX) }),
  z.object({ type: z.literal("updateSettings"), patch: settingsSchema.partial() }),
  bare("makeTeams"),
  bare("shuffleTeams"),
  z.object({ type: z.literal("movePlayer"), playerId: id, team }),
  bare("backToLobby"),
  bare("startGame"),
  turnIntent("startTurn"),
  // cardId: the card on screen when tapped; a tap aimed at an old card (double tap on a slow network) is ignored
  z.object({ type: z.literal("gotIt"), turnId: id, cardId: id.optional() }),
  z.object({ type: z.literal("skip"), turnId: id, cardId: id.optional() }),
  turnIntent("undoLastGotIt"),
  z.object({ type: z.literal("reviewToggle"), turnId: id, cardId: id }),
  turnIntent("confirmReview"),
  turnIntent("pause"),
  turnIntent("resume"),
  turnIntent("skipPlayer"),
  z.object({ type: z.literal("kickPlayer"), playerId: id }),
  bare("resetInvite"),
  bare("endGame"),
])
export type Intent = z.output<typeof intentSchema>
export type IntentType = Intent["type"]

const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("intent"), intent: intentSchema }),
  z.object({ type: z.literal("ping"), t: z.number().finite() }),
])
export type ClientMessage = z.output<typeof clientMessageSchema>

export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > WS_MESSAGE_LIMIT || new TextEncoder().encode(raw).length > WS_MESSAGE_LIMIT) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const r = clientMessageSchema.safeParse(json)
  return r.success ? r.data : null
}

export type ErrorCode =
  | "not_host"
  | "not_your_turn"
  | "stale_turn"
  | "bad_phase"
  | "invalid"
  | "name_taken"
  | "limit"
  | "skips_disabled"
  | "letter_mismatch"
  | "not_found"
  | "stale_card"
  | "duplicate_word"

export type GamePhase = "lobby" | "teams" | "playing" | "ended"
export type TurnPhase = "ready" | "playing" | "paused" | "review" | "done"
export type CardOutcome = "got" | "skipped" | "missed"

export interface Scores {
  byTeam: Record<TeamId, number>
  byRound: Record<TeamId, number>[]
  byPlayer: Record<string, number>
}

export interface Snapshot {
  me: { playerId: string | null; isHost: boolean }
  phase: GamePhase
  settings: Settings
  players: {
    id: string
    name: string
    team: TeamId | null
    order: number
    connected: boolean
    kicked: boolean
    wordCount: number
  }[]
  myWords: { id: string; word: string }[]
  hostWordCount: number
  roundIndex: number
  rounds: RoundKind[]
  bowlCount: number
  scores: Scores
  turn: null | {
    id: string
    playerId: string
    team: TeamId
    phase: TurnPhase
    endsAt: number | null
    remainingMs: number | null
    durationMs: number
    gotCount: number
    card: { id: string; word: string } | null
    /** clue-giver only: the card that comes after this one, so the phone can show it instantly */
    nextCard: { id: string; word: string } | null
    review: { cardId: string; word: string; outcome: CardOutcome }[] | null
  }
  upNext: { playerId: string } | null
  inviteUrl: string | null
}

export type ServerMessage =
  | { type: "snapshot"; serverNow: number; snapshot: Snapshot }
  | { type: "pong"; t: number; serverNow: number }
  | { type: "error"; code: ErrorCode; message: string }
