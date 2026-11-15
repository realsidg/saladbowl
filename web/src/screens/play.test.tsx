import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Snapshot } from "@saladbowl/shared"
import { sound } from "../device/sound"
import { End } from "./End"
import { player, snap } from "./fixtures"
import { Play } from "./Play"

type Turn = NonNullable<Snapshot["turn"]>
const NOW = 1_700_000_000_000

function turn(t: Partial<Turn> = {}): Turn {
  return {
    id: "t1",
    playerId: "p1",
    team: "tangerine",
    phase: "playing",
    endsAt: NOW + 37_000,
    remainingMs: null,
    durationMs: 60_000,
    gotCount: 3,
    card: { id: "c1", word: "Shah Rukh Khan" },
    review: null,
    ...t,
  }
}

function game(extra: Partial<Snapshot> = {}): Snapshot {
  return snap({
    phase: "playing",
    roundIndex: 1,
    bowlCount: 14,
    players: [
      player("p1", "Anu", { team: "tangerine" }),
      player("p2", "Dev", { team: "lagoon" }),
      player("p3", "Sid", { team: "tangerine", order: 1 }),
    ],
    scores: { byTeam: { tangerine: 18, lagoon: 15 }, byRound: [{ tangerine: 18, lagoon: 15 }], byPlayer: { p1: 10, p2: 15, p3: 8 } },
    upNext: { playerId: "p2" },
    turn: turn(),
    ...extra,
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("clue-giver", () => {
  it("shows the word on the slip with big Got it and Skip buttons", () => {
    render(<Play snap={game()} send={vi.fn()} offset={0} />)
    expect(screen.getByText("Shah Rukh Khan").closest(".slip")).not.toBeNull()
    for (const name of ["Got it", "Skip"]) expect(screen.getByRole("button", { name }).className).toMatch(/\bbtn\b/)
  })

  it("hides Skip when skips are off", () => {
    const s = game()
    render(<Play snap={{ ...s, settings: { ...s.settings, allowSkips: false } }} send={vi.fn()} offset={0} />)
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull()
  })

  it("ignores a second tap within 300 ms and tags intents with the turn id", () => {
    const send = vi.fn(() => true)
    render(<Play snap={game()} send={send} offset={0} />)
    const got = screen.getByRole("button", { name: "Got it" })
    fireEvent.click(got)
    act(() => void vi.advanceTimersByTime(100))
    fireEvent.click(got)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: "gotIt", turnId: "t1" })
    act(() => void vi.advanceTimersByTime(300))
    fireEvent.click(screen.getByRole("button", { name: "Skip" }))
    expect(send).toHaveBeenLastCalledWith({ type: "skip", turnId: "t1" })
  })
})

describe("everyone else", () => {
  it("shows the countdown, who is acting, both scores and who is up next", () => {
    render(<Play snap={game({ me: { playerId: "p2", isHost: false }, turn: turn({ card: null }) })} send={vi.fn()} offset={0} />)
    expect(screen.getByText("37")).toBeTruthy()
    expect(screen.getByText(/Anu is acting for/)).toBeTruthy()
    expect(screen.getByText("18")).toBeTruthy()
    expect(screen.getByText("15")).toBeTruthy()
    expect(screen.getByText(/Up next: Dev/)).toBeTruthy()
  })

  it("uses the server clock offset", () => {
    render(<Play snap={game({ me: { playerId: "p2", isHost: false }, turn: turn({ card: null }) })} send={vi.fn()} offset={7000} />)
    expect(screen.getByText("30")).toBeTruthy()
  })
})

describe("ready turn", () => {
  it("gives the next player a Start my turn button", () => {
    const send = vi.fn(() => true)
    render(<Play snap={game({ turn: turn({ phase: "ready", endsAt: null, card: null }) })} send={send} offset={0} />)
    fireEvent.click(screen.getByRole("button", { name: "Start my turn" }))
    expect(send).toHaveBeenCalledWith({ type: "startTurn", turnId: "t1" })
  })

  it("tells everyone else who they're waiting for", () => {
    render(<Play snap={game({ me: { playerId: "p2", isHost: false }, turn: turn({ phase: "ready", endsAt: null, card: null }) })} send={vi.fn()} offset={0} />)
    expect(screen.getByText("Waiting for Anu to start")).toBeTruthy()
  })
})

describe("review", () => {
  const review = [
    { cardId: "c1", word: "Shah Rukh Khan", outcome: "got" as const },
    { cardId: "c2", word: "Cricket", outcome: "skipped" as const },
  ]

  it("lets the clue-giver untick cards and confirm", () => {
    const send = vi.fn(() => true)
    render(<Play snap={game({ turn: turn({ phase: "review", endsAt: null, card: null, review }) })} send={send} offset={0} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "Shah Rukh Khan" }))
    expect(send).toHaveBeenCalledWith({ type: "reviewToggle", turnId: "t1", cardId: "c1" })
    fireEvent.click(screen.getByRole("button", { name: /^Done/ }))
    expect(send).toHaveBeenCalledWith({ type: "confirmReview", turnId: "t1" })
  })

  it("gives the host the controls when the clue-giver's phone is away", () => {
    const s = game({
      me: { playerId: "p2", isHost: true },
      turn: turn({ phase: "review", endsAt: null, card: null, review }),
    })
    const away = { ...s, players: s.players.map((p) => (p.id === "p1" ? { ...p, connected: false } : p)) }
    const { rerender } = render(<Play snap={s} send={vi.fn()} offset={0} />)
    expect(screen.queryByRole("button", { name: /^Done/ })).toBeNull()
    rerender(<Play snap={away} send={vi.fn()} offset={0} />)
    expect(screen.getByRole("button", { name: /^Done/ })).toBeTruthy()
  })
})

describe("sound", () => {
  it("rings the bell once when time runs out, even if the countdown skips past 1", () => {
    const bell = vi.spyOn(sound, "bell").mockImplementation(() => {})
    vi.spyOn(sound, "tick").mockImplementation(() => {})
    render(<Play snap={game({ me: { playerId: "p2", isHost: false }, turn: turn({ card: null, endsAt: NOW + 2000 }) })} send={vi.fn()} offset={0} />)
    vi.setSystemTime(NOW + 2600) // jump straight past 1
    act(() => void vi.advanceTimersByTime(250))
    act(() => void vi.advanceTimersByTime(1000))
    expect(bell).toHaveBeenCalledTimes(1)
  })
})

describe("end", () => {
  it("shows the winner, per-round totals and who gave the most clues", () => {
    const s = game({
      phase: "ended",
      turn: null,
      scores: {
        byTeam: { tangerine: 30, lagoon: 25 },
        byRound: [
          { tangerine: 12, lagoon: 10 },
          { tangerine: 18, lagoon: 15 },
        ],
        byPlayer: { p1: 10, p2: 25, p3: 20 },
      },
    })
    render(<End snap={s} />)
    expect(screen.getByText("Tangerine wins")).toBeTruthy()
    expect(screen.getByText("Most clues: Dev")).toBeTruthy()
    expect(screen.getAllByRole("row")).toHaveLength(4) // header + 2 rounds + total
  })
})
