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
