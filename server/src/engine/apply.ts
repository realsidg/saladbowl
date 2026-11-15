import { intentSchema, type Intent, type IntentType } from "@saladbowl/shared"
import { applyLobbyIntent } from "./lobby.js"
import { fail, type Actor, type Ctx, type GameState, type Result } from "./types.js"

const HOST_ONLY = new Set<IntentType>([
  "updateSettings",
  "makeTeams",
  "shuffleTeams",
  "movePlayer",
  "backToLobby",
  "startGame",
  "setHostWordList",
  "kickPlayer",
  "resetInvite",
  "endGame",
  "pause",
  "resume",
  "skipPlayer",
])

/** Applies one intent. Never mutates `s0`; returns the new state or an error code. */
export function applyIntent(s0: GameState, actor: Actor, raw: Intent, ctx: Ctx): Result<GameState> {
  // Re-validate (and trim) even though the socket layer already parsed it.
  const parsed = intentSchema.safeParse(raw)
  if (!parsed.success) return fail("invalid")
  const intent = parsed.data
  if (HOST_ONLY.has(intent.type) && !actor.isHost) return fail("not_host")
  const s = structuredClone(s0)
  const r = applyLobbyIntent(s, actor, intent, ctx)
  if (r.ok) r.value.updatedAt = ctx.now
  return r
}
