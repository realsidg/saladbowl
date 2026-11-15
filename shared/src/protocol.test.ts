import { describe, expect, it } from "vitest"
import { parseClientMessage } from "./index.js"

const intent = (i: unknown) => JSON.stringify({ type: "intent", intent: i })

describe("parseClientMessage", () => {
  it("trims words", () => {
    const m = parseClientMessage(intent({ type: "addWord", word: "  Taj  " }))
    expect(m).toEqual({ type: "intent", intent: { type: "addWord", word: "Taj" } })
  })

  it("rejects a 41-char word", () => {
    expect(parseClientMessage(intent({ type: "addWord", word: "a".repeat(41) }))).toBeNull()
  })

  it("rejects a blank name", () => {
    expect(parseClientMessage(intent({ type: "setName", name: "   " }))).toBeNull()
  })

  it("rejects secondsPerTurn outside 10-180", () => {
    expect(parseClientMessage(intent({ type: "updateSettings", patch: { secondsPerTurn: 9 } }))).toBeNull()
    expect(parseClientMessage(intent({ type: "updateSettings", patch: { secondsPerTurn: 181 } }))).toBeNull()
    expect(parseClientMessage(intent({ type: "updateSettings", patch: { secondsPerTurn: 60 } }))).not.toBeNull()
  })

  it("rejects an empty rounds list", () => {
    expect(parseClientMessage(intent({ type: "updateSettings", patch: { rounds: [] } }))).toBeNull()
  })

  it("rejects unknown intent types", () => {
    expect(parseClientMessage(intent({ type: "becomeHost" }))).toBeNull()
  })

  it("rejects messages over 4096 bytes", () => {
    expect(parseClientMessage(intent({ type: "addWord", word: "x".repeat(5000) }))).toBeNull()
    expect(parseClientMessage("x".repeat(5000))).toBeNull()
  })

  it("rejects bad JSON", () => {
    expect(parseClientMessage("{nope")).toBeNull()
  })

  it("parses ping", () => {
    expect(parseClientMessage('{"type":"ping","t":1}')).toEqual({ type: "ping", t: 1 })
  })

  it("requires turnId on turn intents", () => {
    expect(parseClientMessage(intent({ type: "gotIt" }))).toBeNull()
    expect(parseClientMessage(intent({ type: "gotIt", turnId: "t1" }))).not.toBeNull()
  })
})
