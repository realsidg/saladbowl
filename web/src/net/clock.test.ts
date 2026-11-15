import { describe, expect, it } from "vitest"
import type { Snapshot } from "@saladbowl/shared"
import { ClockSync, secondsLeft } from "./clock"

describe("ClockSync", () => {
  it("estimates a +5000 ms skew despite one slow round trip", () => {
    const c = new ClockSync()
    const skew = 5000
    const samples = [
      [1000, 1040],
      [2000, 2030],
      [3000, 5000], // 2 s outlier
      [4000, 4050],
      [5000, 5036],
    ] as const
    for (const [sentAt, receivedAt] of samples) {
      const rtt = receivedAt - sentAt
      c.add({ sentAt, receivedAt, serverNow: sentAt + rtt / 2 + skew })
    }
    expect(Math.abs(c.offset() - skew)).toBeLessThanOrEqual(20)
  })

  it("is 0 with no samples and keeps only the last 7", () => {
    const c = new ClockSync()
    expect(c.offset()).toBe(0)
    for (let i = 0; i < 10; i++) c.add({ sentAt: i, receivedAt: i, serverNow: i + (i < 3 ? 99999 : 100) })
    expect(c.offset()).toBe(100)
  })
})

type Turn = NonNullable<Snapshot["turn"]>
const turn = (t: Partial<Turn>): Turn => ({
  id: "t",
  playerId: "p",
  team: "lagoon",
  phase: "playing",
  endsAt: null,
  remainingMs: null,
  durationMs: 60_000,
  gotCount: 0,
  card: null,
  review: null,
  ...t,
})

describe("secondsLeft", () => {
  it("counts down to endsAt using the offset", () => {
    expect(secondsLeft(turn({ endsAt: 100_000 }), 50_000, 10_000)).toBe(40)
    expect(secondsLeft(turn({ endsAt: 100_000 }), 99_001, 0)).toBe(1)
  })

  it("never goes below 0, even long after the end", () => {
    expect(secondsLeft(turn({ endsAt: 100_000 }), 130_000, 0)).toBe(0)
  })

  it("shows the paused remainder and a ready turn's full length", () => {
    expect(secondsLeft(turn({ phase: "paused", remainingMs: 12_300 }), 0, 0)).toBe(13)
    expect(secondsLeft(turn({ phase: "ready", durationMs: 45_000 }), 0, 0)).toBe(45)
    expect(secondsLeft(null, 0, 0)).toBe(0)
  })
})
