import { expect, it, vi } from "vitest"

it("resumes audio that iOS left 'interrupted' after the screen locked", async () => {
  const resume = vi.fn(async () => {})
  class FakeAC {
    state = "running"
    currentTime = 0
    destination = {}
    resume = resume
    createOscillator() {
      return { connect: () => ({ connect: () => {} }), start() {}, stop() {}, frequency: {}, type: "" }
    }
    createGain() {
      return { gain: { value: 0 }, connect: () => ({ connect: () => {} }) }
    }
  }
  vi.stubGlobal("AudioContext", FakeAC)
  const { sound } = await import("./sound")
  sound.unlock()
  const ctx = (sound as unknown as { _ctx(): FakeAC })._ctx()
  ctx.state = "interrupted"
  sound.unlock()
  expect(resume).toHaveBeenCalled()
  vi.unstubAllGlobals()
})
