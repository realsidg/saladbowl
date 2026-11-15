import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GameSocket } from "./socket"

class FakeWS {
  static all: FakeWS[] = []
  static OPEN = 1
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  constructor(public url: string) {
    FakeWS.all.push(this)
  }
  send(d: string) {
    this.sent.push(d)
  }
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  drop(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

let listeners: Record<string, () => void> = {}
let visible = "visible"

function make(onMessage = vi.fn()) {
  return new GameSocket("ws://x/ws", onMessage, {
    WebSocket: FakeWS as unknown as typeof WebSocket,
    addEventListener: (type, fn) => (listeners[type] = fn),
    removeEventListener: (type) => delete listeners[type],
    visibility: () => visible,
    now: () => Date.now(),
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWS.all = []
  listeners = {}
  visible = "visible"
})
afterEach(() => vi.useRealTimers())

describe("GameSocket", () => {
  it("retries after 500, 1000, then 2000 ms", () => {
    const s = make()
    FakeWS.all[0]!.drop()
    vi.advanceTimersByTime(499)
    expect(FakeWS.all).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeWS.all).toHaveLength(2)
    FakeWS.all[1]!.drop()
    vi.advanceTimersByTime(999)
    expect(FakeWS.all).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeWS.all).toHaveLength(3)
    FakeWS.all[2]!.drop()
    vi.advanceTimersByTime(2000)
    expect(FakeWS.all).toHaveLength(4)
    s.close()
  })

  it("reconnects at once when the page becomes visible", () => {
    const s = make()
    FakeWS.all[0]!.drop()
    vi.advanceTimersByTime(100)
    listeners["visibilitychange"]!()
    expect(FakeWS.all).toHaveLength(2)
    s.close()
  })

  it("reconnects at once when the network comes back", () => {
    const s = make()
    FakeWS.all[0]!.drop()
    listeners["online"]!()
    expect(FakeWS.all).toHaveLength(2)
    s.close()
  })

  it("delivers messages after a reconnect and resets the backoff", () => {
    const onMessage = vi.fn()
    const s = make(onMessage)
    FakeWS.all[0]!.drop()
    vi.advanceTimersByTime(500)
    const ws = FakeWS.all[1]!
    ws.open()
    ws.onmessage!({ data: JSON.stringify({ type: "error", code: "invalid", message: "x" }) })
    expect(onMessage).toHaveBeenCalledWith({ type: "error", code: "invalid", message: "x" })
    ws.drop()
    vi.advanceTimersByTime(500)
    expect(FakeWS.all).toHaveLength(3)
    s.close()
  })

  it("sends 3 pings 300 ms apart on open, then one every 10 s", () => {
    const s = make()
    const ws = FakeWS.all[0]!
    ws.open()
    const send = ws.send.bind(ws)
    ws.send = (d: string) => {
      send(d)
      const m = JSON.parse(d)
      if (m.type === "ping") ws.onmessage!({ data: JSON.stringify({ type: "pong", t: m.t, serverNow: m.t }) })
    }
    const pings = () => ws.sent.filter((m) => JSON.parse(m).type === "ping").length
    expect(pings()).toBe(1)
    vi.advanceTimersByTime(600)
    expect(pings()).toBe(3)
    vi.advanceTimersByTime(10_000)
    expect(pings()).toBe(4)
    s.close()
  })

  it("stops for good on 4401 and 4403", () => {
    const s = make()
    FakeWS.all[0]!.drop(4403)
    vi.advanceTimersByTime(60_000)
    listeners["visibilitychange"]?.()
    expect(FakeWS.all).toHaveLength(1)
    expect(s.status).toBe("gone")
  })

  it("queues intents only while open", () => {
    const s = make()
    expect(s.send({ type: "makeTeams" })).toBe(false)
    FakeWS.all[0]!.open()
    expect(s.send({ type: "makeTeams" })).toBe(true)
    s.close()
  })
})

describe("waking up", () => {
  it("reconnects at once after being hidden a while, even if the socket looks open", () => {
    const s = make()
    FakeWS.all[0]!.open()
    visible = "hidden"
    listeners["visibilitychange"]!()
    vi.advanceTimersByTime(5000)
    const before = FakeWS.all.length
    const last = FakeWS.all[before - 1]!
    last.open() // even a socket that reports OPEN is replaced after a sleep
    visible = "visible"
    listeners["visibilitychange"]!()
    expect(FakeWS.all).toHaveLength(before + 1)
    s.close()
  })

  it("reconnects when a ping gets no answer", () => {
    const s = make()
    FakeWS.all[0]!.open()
    vi.advanceTimersByTime(10_000 + 4000)
    expect(FakeWS.all.length).toBeGreaterThanOrEqual(2)
    s.close()
  })
})
