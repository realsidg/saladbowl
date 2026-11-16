import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { player, snap } from "./fixtures"
import { Join } from "./Join"
import { Lobby } from "./Lobby"

const full = (n: number) => ({ wordCount: n })

describe("Lobby", () => {
  it("shows the host a QR code, settings, and a Make teams button that waits for everyone's words", () => {
    const send = vi.fn()
    const s = snap({
      me: { playerId: "p1", isHost: true },
      inviteUrl: "https://bowl.example/join/tok",
      players: [player("p1", "Sid", full(6)), player("p2", "Anu", full(3))],
    })
    const { container, rerender } = render(<Lobby snap={s} send={send} />)
    const qr = container.querySelector("svg[data-qr]")
    expect(qr).not.toBeNull()
    expect(qr!.getAttribute("aria-label")).toBe("QR code for https://bowl.example/join/tok")
    expect(screen.getByRole("group", { name: "Seconds per turn" })).toBeTruthy()
    const make = screen.getByRole("button", { name: "Make teams" }) as HTMLButtonElement
    expect(make.disabled).toBe(true)
    expect(screen.getByText("Waiting for Anu to add words")).toBeTruthy()

    rerender(<Lobby snap={{ ...s, players: [player("p1", "Sid", full(6)), player("p2", "Anu", full(6))] }} send={send} />)
    const ready = screen.getByRole("button", { name: "Make teams" }) as HTMLButtonElement
    expect(ready.disabled).toBe(false)
    ready.click()
    expect(send).toHaveBeenCalledWith({ type: "makeTeams" })
  })

  it("needs at least 2 players", () => {
    const s = snap({ me: { playerId: "p1", isHost: true }, players: [player("p1", "Sid", full(6))], inviteUrl: "x" })
    render(<Lobby snap={s} send={vi.fn()} />)
    expect((screen.getByRole("button", { name: "Make teams" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("Waiting for at least 2 players")).toBeTruthy()
  })

  it("lets players open the invite QR to bring others in", async () => {
    const { container } = render(<Lobby snap={snap({ inviteUrl: "https://bowl.example/join/tok" })} send={vi.fn()} />)
    expect(container.querySelector("svg[data-qr]")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Invite others" }))
    expect(container.querySelector("svg[data-qr]")!.getAttribute("aria-label")).toBe("QR code for https://bowl.example/join/tok")
    expect(screen.getByRole("button", { name: "Share link" })).toBeTruthy()
  })

  it("shows players no settings controls", () => {
    const { container } = render(<Lobby snap={snap()} send={vi.fn()} />)
    expect(container.querySelector("svg[data-qr]")).toBeNull()
    expect(screen.queryByRole("group", { name: "Seconds per turn" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Make teams" })).toBeNull()
    expect(screen.getByText("Waiting for the host to make teams")).toBeTruthy()
  })

  it("hints the starting letter and stops adding words at the limit", async () => {
    const send = vi.fn()
    const s = snap({
      settings: { ...snap().settings, startingLetter: "S", wordsPerPlayer: 2 },
      myWords: [{ id: "c1", word: "Sun" }],
    })
    const { rerender } = render(<Lobby snap={s} send={send} />)
    expect(screen.getByText("Words must start with S")).toBeTruthy()
    await userEvent.type(screen.getByLabelText("Add a word"), "Sitar{Enter}")
    expect(send).toHaveBeenCalledWith({ type: "addWord", word: "Sitar" })
    rerender(<Lobby snap={{ ...s, myWords: [...s.myWords, { id: "c2", word: "Sitar" }] }} send={send} />)
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("All 2 words in. Nice.")).toBeTruthy()
  })
})

describe("Join", () => {
  afterEach(() => vi.unstubAllGlobals())

  const respond = (status: number, body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
    )

  it("offers 'Are you one of these?' and a name field", async () => {
    respond(200, { phase: "playing", alreadyIn: false, takeover: [{ playerId: "p9", name: "Meera" }] })
    render(<Join token="tok" />)
    await waitFor(() => expect(screen.getByText("Are you one of these?")).toBeTruthy())
    expect(screen.getByRole("button", { name: "I'm Meera" })).toBeTruthy()
    expect(screen.getByLabelText("Your name")).toBeTruthy()
  })

  it("says when an invite no longer works", async () => {
    respond(404, { code: "invite_invalid" })
    render(<Join token="tok" />)
    await waitFor(() => expect(screen.getByText("This invite no longer works")).toBeTruthy())
  })
})

describe("adding a word that gets rejected", () => {
  it("keeps the typed word until it actually lands in your list", async () => {
    const send = vi.fn(() => true)
    const s = snap({ myWords: [] })
    const { rerender } = render(<Lobby snap={s} send={send} />)
    const box = screen.getByLabelText("Add a word") as HTMLInputElement
    await userEvent.type(box, "Goa{Enter}")
    expect(box.value).toBe("Goa") // server may still say it's a duplicate
    rerender(<Lobby snap={{ ...s, myWords: [{ id: "c1", word: "Goa" }] }} send={send} />)
    expect(box.value).toBe("")
  })
})

describe("settings taps", () => {
  it("counts every quick tap on a stepper instead of repeating the same value", () => {
    const send = vi.fn(() => true)
    render(<Lobby snap={snap({ me: { playerId: "p1", isHost: true }, inviteUrl: "x" })} send={send} />)
    const less = screen.getByRole("button", { name: "Less words each" })
    fireEvent.click(less)
    fireEvent.click(less)
    fireEvent.click(less)
    const sent = send.mock.calls.map((c) => (c as unknown as [{ patch: { wordsPerPlayer?: number } }])[0].patch.wordsPerPlayer).filter(Boolean)
    expect(sent).toEqual([5, 4, 3])
    expect(screen.getByRole("group", { name: "Words each" }).textContent).toContain("3")
  })
})
