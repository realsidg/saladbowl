import type { Snapshot, TeamId } from "@saladbowl/shared"

export const ROUND_NAMES = { taboo: "Taboo", charades: "Charades", password: "Password" } as const
export const ROUND_HINTS = {
  taboo: "Describe it without saying the word.",
  charades: "Act it out. No talking.",
  password: "One word only.",
} as const
export const TEAM_NAMES = { tangerine: "Tangerine", lagoon: "Lagoon" } as const
/** The team's name as the host set it. */
export const teamName = (s: Snapshot, t: TeamId): string => s.settings.teamNames?.[t] ?? TEAM_NAMES[t]

export const nameOf = (s: Snapshot, id: string | null | undefined) => s.players.find((p) => p.id === id)?.name ?? "Someone"

/** Who still needs to add words before teams can be made; empty when ready. */
export function missingWords(s: Snapshot): string[] {
  if (s.settings.wordSource === "host") return []
  return s.players.filter((p) => !p.kicked && p.wordCount < s.settings.wordsPerPlayer).map((p) => p.name)
}

export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("")
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}
