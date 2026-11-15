import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { App } from "./App"
import { navigate } from "./router"

afterEach(() => {
  vi.unstubAllGlobals()
  history.replaceState(null, "", "/")
})

it("does not bounce /game back to / on a stale 'not in a game' answer", async () => {
  let inGame = false
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/me") return new Response(JSON.stringify({ isHost: true, gameId: inGame ? "g1" : null }), { status: 200 })
      return new Response("{}", { status: 200 })
    }),
  )
  vi.stubGlobal(
    "WebSocket",
    class {
      static OPEN = 1
      readyState = 0
      close() {}
      send() {}
    },
  )
  render(<App />)
  await waitFor(() => expect(screen.getByText("Start a new game")).toBeTruthy())
  inGame = true
  navigate("/game")
  await waitFor(() => expect(screen.getByText("Joining the game…")).toBeTruthy())
  expect(location.pathname).toBe("/game")
})

it("treats an invite link with a trailing slash as the invite", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: "invite_invalid" }), { status: 404 }))
  vi.stubGlobal("fetch", fetchMock)
  history.replaceState(null, "", "/join/AbC_12-x/")
  render(<App />)
  await waitFor(() => expect(screen.getByText("This invite no longer works")).toBeTruthy())
  expect(fetchMock).toHaveBeenCalledWith("/api/invite/AbC_12-x", expect.anything())
})
