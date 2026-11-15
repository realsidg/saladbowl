import type { Intent, ServerMessage } from "@saladbowl/shared"
import { ClockSync } from "./clock"

export type SocketStatus = "connecting" | "live" | "offline" | "gone"

export interface SocketDeps {
  WebSocket: typeof WebSocket
  addEventListener: (type: "visibilitychange" | "online", fn: () => void) => void
  removeEventListener: (type: "visibilitychange" | "online", fn: () => void) => void
  visibility: () => string
  now: () => number
}

const BACKOFF = [500, 1000, 2000, 4000, 8000, 10_000]
const FINAL_CODES = new Set([4401, 4403])

/** One live connection to the game, kept alive across sleeps, app switches and flaky networks. */
export class GameSocket {
  status: SocketStatus = "connecting"
  readonly clock = new ClockSync()
  onStatus: (s: SocketStatus) => void = () => {}

  private ws: WebSocket | null = null
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimers: ReturnType<typeof setTimeout>[] = []
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private closed = false
  private readonly wake = () => {
    if (this.closed || this.status === "gone") return
    if (this.deps.visibility() !== "visible") return
    if (this.ws && this.ws.readyState === this.deps.WebSocket.OPEN) this.ping()
    else this.reconnectNow()
  }

  constructor(
    private url: string,
    private onMessage: (m: ServerMessage) => void,
    private deps: SocketDeps,
  ) {
    deps.addEventListener("visibilitychange", this.wake)
    deps.addEventListener("online", this.wake)
    this.connect()
  }

  send(intent: Intent): boolean {
    if (!this.ws || this.ws.readyState !== this.deps.WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ type: "intent", intent }))
    return true
  }

  close() {
    this.closed = true
    this.stopTimers()
    this.deps.removeEventListener("visibilitychange", this.wake)
    this.deps.removeEventListener("online", this.wake)
    this.ws?.close()
  }

  private setStatus(s: SocketStatus) {
    this.status = s
    this.onStatus(s)
  }

  private connect() {
    this.retryTimer = null
    const ws = new this.deps.WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      this.setStatus("live")
      this.ping()
      this.pingTimers = [setTimeout(() => this.ping(), 300), setTimeout(() => this.ping(), 600)]
      this.pingInterval = setInterval(() => this.ping(), 10_000)
    }
    ws.onmessage = (e: MessageEvent) => {
      let m: ServerMessage
      try {
        m = JSON.parse(String(e.data))
      } catch {
        return
      }
      if (m.type === "pong") this.clock.add({ sentAt: m.t, receivedAt: this.deps.now(), serverNow: m.serverNow })
      this.onMessage(m)
    }
    ws.onclose = (e: CloseEvent) => {
      if (this.ws !== ws) return
      this.stopTimers()
      this.ws = null
      if (this.closed) return
      if (FINAL_CODES.has(e.code)) return this.setStatus("gone")
      this.setStatus("offline")
      const delay = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)]!
      this.attempt += 1
      this.retryTimer = setTimeout(() => this.connect(), delay)
    }
  }

  private reconnectNow() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.attempt = 0
    this.setStatus("connecting")
    this.connect()
  }

  private ping() {
    if (this.ws?.readyState === this.deps.WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "ping", t: this.deps.now() }))
  }

  private stopTimers() {
    this.pingTimers.forEach(clearTimeout)
    this.pingTimers = []
    if (this.pingInterval) clearInterval(this.pingInterval)
    this.pingInterval = null
  }
}
