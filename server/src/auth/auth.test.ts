import { describe, expect, it } from "vitest"
import { sessionKey, signSession, verifySession } from "./cookies.js"
import { LoginLimiter } from "./limiter.js"
import { hashPassword, verifyPassword } from "./password.js"

describe("password", () => {
  it("verifies the right password only, with a fresh salt each time", async () => {
    const h = await hashPassword("correct horse")
    expect(h).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
    expect(await verifyPassword("correct horse", h)).toBe(true)
    expect(await verifyPassword("correct horsE", h)).toBe(false)
    expect(await hashPassword("correct horse")).not.toBe(h)
  })

  it("returns false for a malformed stored hash", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false)
  })
})

describe("session cookies", () => {
  const key = sessionKey("s".repeat(32), "scrypt$hash-one")
  it("round-trips and rejects tampering", () => {
    const v = signSession("abc", key)
    expect(verifySession(v, key)).toBe("abc")
    expect(verifySession(v.replace("abc", "abd"), key)).toBeNull()
    expect(verifySession(v.slice(0, -2) + "xx", key)).toBeNull()
    expect(verifySession("abc", key)).toBeNull()
  })

  it("rejects cookies once the password hash changes", () => {
    const v = signSession("abc", key)
    expect(verifySession(v, sessionKey("s".repeat(32), "scrypt$hash-two"))).toBeNull()
  })
})

describe("LoginLimiter", () => {
  const MIN = 60_000
  it("allows 5 failures, then locks for 1, 2 minutes..., capped at an hour", () => {
    const l = new LoginLimiter()
    let now = 0
    for (let i = 0; i < 5; i++) {
      expect(l.check("1.1.1.1", now)).toEqual({ ok: true })
      l.fail("1.1.1.1", now)
    }
    expect(l.check("1.1.1.1", now)).toEqual({ ok: true })
    l.fail("1.1.1.1", now) // 6th
    expect(l.check("1.1.1.1", now)).toEqual({ ok: false, retryAfterMs: MIN })
    l.fail("1.1.1.1", now) // 7th
    expect(l.check("1.1.1.1", now)).toEqual({ ok: false, retryAfterMs: 2 * MIN })
    for (let i = 0; i < 10; i++) l.fail("1.1.1.1", now)
    expect(l.check("1.1.1.1", now)).toEqual({ ok: false, retryAfterMs: 60 * MIN })
    expect(l.check("2.2.2.2", now)).toEqual({ ok: true })
    now += 60 * MIN + 1
    // window of 15 minutes has passed: the IP starts clean
    expect(l.check("1.1.1.1", now)).toEqual({ ok: true })
  })

  it("success resets the IP", () => {
    const l = new LoginLimiter()
    for (let i = 0; i < 6; i++) l.fail("1.1.1.1", 0)
    l.succeed("1.1.1.1")
    expect(l.check("1.1.1.1", 0)).toEqual({ ok: true })
  })

  it("locks every IP for 15 minutes after more than 50 failures in an hour", () => {
    const l = new LoginLimiter()
    for (let i = 0; i < 51; i++) l.fail(`10.0.0.${i}`, i * 1000)
    expect(l.check("9.9.9.9", 50_000)).toEqual({ ok: false, retryAfterMs: 15 * 60_000 })
    expect(l.check("9.9.9.9", 50_000 + 15 * 60_000)).toEqual({ ok: true })
  })
})
