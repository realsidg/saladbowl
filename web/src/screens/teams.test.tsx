import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DEFAULT_SETTINGS } from "@saladbowl/shared"
import { player, snap } from "./fixtures"
import { Teams } from "./Teams"

const teamsSnap = (isHost: boolean) =>
  snap({
    phase: "teams",
    me: { playerId: "p1", isHost },
    settings: { ...DEFAULT_SETTINGS, teamNames: { tangerine: "Aces", lagoon: "Kings" } },
    players: [player("p1", "Sid", { team: "tangerine" }), player("p2", "Anu", { team: "lagoon" })],
  })

describe("Teams", () => {
  it("lets the host rename a team", () => {
    const send = vi.fn(() => true)
    render(<Teams snap={teamsSnap(true)} send={send} />)
    const box = screen.getByRole("textbox", { name: "Name of team Aces" })
    fireEvent.change(box, { target: { value: "  Jokers " } })
    fireEvent.blur(box)
    expect(send).toHaveBeenCalledWith({ type: "updateSettings", patch: { teamNames: { tangerine: "Jokers", lagoon: "Kings" } } })
  })

  it("puts an empty or duplicate name back instead of sending it", () => {
    const send = vi.fn(() => true)
    render(<Teams snap={teamsSnap(true)} send={send} />)
    const box = screen.getByRole("textbox", { name: "Name of team Aces" }) as HTMLInputElement
    fireEvent.change(box, { target: { value: "kings" } })
    fireEvent.blur(box)
    fireEvent.change(box, { target: { value: " " } })
    fireEvent.blur(box)
    expect(send).not.toHaveBeenCalled()
    expect(box.value).toBe("Aces")
  })

  it("shows players the team names without a way to change them", () => {
    render(<Teams snap={teamsSnap(false)} send={vi.fn()} />)
    expect(screen.getByText("Aces")).toBeTruthy()
    expect(screen.getByText("Kings")).toBeTruthy()
    expect(screen.queryByRole("textbox")).toBeNull()
  })
})
