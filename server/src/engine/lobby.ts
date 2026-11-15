import { DEFAULT_SETTINGS, nameSchema, TEAMS, type Intent, type TeamId } from "@saladbowl/shared"
import { activeTeamPlayers } from "./order.js"
import { createReadyTurn } from "./turns.js"
import { fail, ok, type Actor, type Ctx, type GameState, type Result } from "./types.js"

export function createGame(ctx: Ctx, inviteToken: string): GameState {
  return {
    id: ctx.newId(),
    inviteToken,
    phase: "lobby",
    settings: { ...DEFAULT_SETTINGS, rounds: [...DEFAULT_SETTINGS.rounds] },
    players: [],
    cards: [],
    roundIndex: 0,
    bowl: [],
    turns: [],
    teamCursor: { tangerine: -1, lagoon: -1 },
    nextTeam: "tangerine",
    carry: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    endedAt: null,
  }
}

function cleanName(name: string): string | null {
  const r = nameSchema.safeParse(name)
  return r.success ? r.data : null
}

const nameTaken = (s: GameState, name: string, exceptId?: string) =>
  s.players.some((p) => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase())

const teamSize = (s: GameState, t: TeamId) => activeTeamPlayers(s, t).length

/** Adds a named player. Outside the lobby they go to the smaller team (ties to lagoon). */
export function addPlayer(s0: GameState, name: string, ctx: Ctx): Result<{ state: GameState; playerId: string }> {
  if (s0.phase === "ended") return fail("bad_phase")
  const clean = cleanName(name)
  if (!clean) return fail("invalid")
  if (nameTaken(s0, clean)) return fail("name_taken")
  const s = structuredClone(s0)
  const id = ctx.newId()
  let team: TeamId | null = null
  let order = s.players.length
  if (s.phase !== "lobby") {
    team = teamSize(s, "tangerine") < teamSize(s, "lagoon") ? "tangerine" : "lagoon"
    const orders = s.players.filter((p) => p.team === team).map((p) => p.order)
    order = orders.length ? Math.max(...orders) + 1 : 0
  }
  s.players.push({ id, name: clean, team, order, kicked: false, joinedAt: ctx.now })
  s.updatedAt = ctx.now
  return ok({ state: s, playerId: id })
}

function assignTeams(s: GameState, ctx: Ctx) {
  const players = s.players.filter((p) => !p.kicked)
  for (let i = players.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1))
    ;[players[i], players[j]] = [players[j]!, players[i]!]
  }
  const half = Math.ceil(players.length / 2)
  players.forEach((p, i) => {
    p.team = i < half ? "tangerine" : "lagoon"
    p.order = i < half ? i : i - half
  })
}

function renumber(s: GameState) {
  for (const t of TEAMS) activeTeamPlayers(s, t).forEach((p, i) => (p.order = i))
}

/** Lobby/setup intents. Mutates `s` (a clone made by applyIntent). */
export function applyLobbyIntent(s: GameState, actor: Actor, intent: Intent, ctx: Ctx): Result<GameState> {
  const me = s.players.find((p) => p.id === actor.playerId && !p.kicked)
  const hostOnly = () => (actor.isHost ? null : fail<GameState>("not_host"))

  switch (intent.type) {
    case "setName": {
      if (!me) return fail("invalid")
      if (nameTaken(s, intent.name, me.id)) return fail("name_taken")
      me.name = intent.name
      return ok(s)
    }
    case "addWord": {
      if (!me) return fail("invalid")
      if (s.phase !== "lobby") return fail("bad_phase")
      if (s.settings.wordSource !== "players") return fail("invalid")
      const mine = s.cards.filter((c) => c.playerId === me.id).length
      if (mine >= s.settings.wordsPerPlayer) return fail("limit")
      const letter = s.settings.startingLetter
      if (letter && intent.word[0]!.toUpperCase() !== letter) return fail("letter_mismatch")
      s.cards.push({ id: ctx.newId(), playerId: me.id, word: intent.word })
      return ok(s)
    }
    case "editWord":
    case "removeWord": {
      if (s.phase !== "lobby") return fail("bad_phase")
      const card = s.cards.find((c) => c.id === intent.cardId)
      if (!me || !card || card.playerId !== me.id) return fail("invalid")
      if (intent.type === "removeWord") {
        s.cards = s.cards.filter((c) => c.id !== card.id)
        return ok(s)
      }
      const letter = s.settings.startingLetter
      if (letter && intent.word[0]!.toUpperCase() !== letter) return fail("letter_mismatch")
      card.word = intent.word
      return ok(s)
    }
    case "setHostWordList": {
      const e = hostOnly()
      if (e) return e
      if (s.phase !== "lobby") return fail("bad_phase")
      if (s.settings.wordSource !== "host") return fail("invalid")
      s.cards = intent.words.map((word) => ({ id: ctx.newId(), playerId: null, word }))
      return ok(s)
    }
    case "updateSettings": {
      const e = hostOnly()
      if (e) return e
      if (s.phase === "ended") return fail("bad_phase")
      const keys = Object.keys(intent.patch)
      if (s.phase === "playing" && keys.some((k) => k !== "secondsPerTurn")) return fail("bad_phase")
      if (s.phase === "teams" && keys.some((k) => k === "wordsPerPlayer" || k === "wordSource" || k === "startingLetter"))
        return fail("bad_phase")
      s.settings = { ...s.settings, ...intent.patch }
      return ok(s)
    }
    case "makeTeams": {
      const e = hostOnly()
      if (e) return e
      if (s.phase !== "lobby") return fail("bad_phase")
      assignTeams(s, ctx)
      s.phase = "teams"
      return ok(s)
    }
    case "shuffleTeams": {
      const e = hostOnly()
      if (e) return e
      if (s.phase !== "teams") return fail("bad_phase")
      assignTeams(s, ctx)
      return ok(s)
    }
    case "movePlayer": {
      const e = hostOnly()
      if (e) return e
      if (s.phase !== "teams") return fail("bad_phase")
      const p = s.players.find((x) => x.id === intent.playerId && !x.kicked)
      if (!p) return fail("not_found")
      p.team = intent.team
      p.order = Number.MAX_SAFE_INTEGER
      renumber(s)
      return ok(s)
    }
    case "backToLobby": {
      const e = hostOnly()
      if (e) return e
      if (s.phase !== "teams") return fail("bad_phase")
      for (const p of s.players) p.team = null
      s.phase = "lobby"
      return ok(s)
    }
    case "startGame": {
      const e = hostOnly()
      if (e) return e
      if (s.phase !== "teams") return fail("bad_phase")
      const active = s.players.filter((p) => !p.kicked)
      if (active.length < 2) return fail("invalid")
      if (TEAMS.some((t) => teamSize(s, t) === 0)) return fail("invalid")
      if (s.settings.wordSource === "players") {
        const short = active.some((p) => s.cards.filter((c) => c.playerId === p.id).length < s.settings.wordsPerPlayer)
        if (short) return fail("invalid")
      } else if (s.cards.length === 0) return fail("invalid")
      s.phase = "playing"
      s.roundIndex = 0
      s.bowl = s.cards.map((c) => c.id)
      s.teamCursor = { tangerine: -1, lagoon: -1 }
      s.nextTeam = "tangerine"
      s.carry = null
      createReadyTurn(s, ctx)
      return ok(s)
    }
    case "resetInvite": {
      const e = hostOnly()
      if (e) return e
      if (s.phase === "ended") return fail("bad_phase")
      s.inviteToken = ctx.newId()
      return ok(s)
    }
    default:
      return fail("invalid")
  }
}
