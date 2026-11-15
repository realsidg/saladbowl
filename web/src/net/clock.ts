import type { Snapshot } from "@saladbowl/shared"

/** Estimates server time minus local time from ping/pong samples (median of the last 7). */
export class ClockSync {
  private samples: number[] = []

  add(s: { sentAt: number; receivedAt: number; serverNow: number }) {
    const rtt = Math.max(0, s.receivedAt - s.sentAt)
    this.samples.push(s.serverNow + rtt / 2 - s.receivedAt)
    if (this.samples.length > 7) this.samples.shift()
  }

  offset(): number {
    if (this.samples.length === 0) return 0
    const sorted = [...this.samples].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  }
}

/** Whole seconds left on a turn, drawn from server time. Never negative. */
export function secondsLeft(turn: Snapshot["turn"], now: number, offset: number): number {
  if (!turn) return 0
  if (turn.phase === "paused") return Math.ceil((turn.remainingMs ?? 0) / 1000)
  if (turn.phase === "ready") return Math.ceil(turn.durationMs / 1000)
  if (turn.phase !== "playing" || turn.endsAt === null) return 0
  return Math.max(0, Math.ceil((turn.endsAt - (now + offset)) / 1000))
}
