import { useCallback, useEffect, useRef, useState } from "react"
import type { Intent, ServerMessage, Snapshot } from "@saladbowl/shared"
import { GameSocket, type SocketStatus } from "./socket"

export interface GameHandle {
  snapshot: Snapshot | null
  status: SocketStatus
  send: (intent: Intent) => boolean
  offset: number
  error: string | null
  clearError: () => void
}

function wsUrl() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`
}

/** Connects to the game and keeps the latest snapshot and clock offset. */
export function useGame(): GameHandle {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [status, setStatus] = useState<SocketStatus>("connecting")
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const sock = useRef<GameSocket | null>(null)

  useEffect(() => {
    const s = new GameSocket(
      wsUrl(),
      (m: ServerMessage) => {
        if (m.type === "snapshot") {
          setSnapshot(m.snapshot)
          setOffset(s.clock.offset())
        } else if (m.type === "pong") setOffset(s.clock.offset())
        else if (m.type === "error") setError(m.message)
      },
      {
        WebSocket,
        addEventListener: (t, fn) => (t === "online" ? window : document).addEventListener(t, fn),
        removeEventListener: (t, fn) => (t === "online" ? window : document).removeEventListener(t, fn),
        visibility: () => document.visibilityState,
        now: () => Date.now(),
      },
    )
    s.onStatus = setStatus
    sock.current = s
    return () => s.close()
  }, [])

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 3500)
    return () => clearTimeout(t)
  }, [error])

  const send = useCallback((intent: Intent) => {
    const ok = sock.current?.send(intent) ?? false
    if (!ok) setError("Reconnecting. Try again in a second.")
    return ok
  }, [])

  return { snapshot, status, send, offset, error, clearError: () => setError(null) }
}
