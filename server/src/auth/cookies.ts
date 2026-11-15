import { createHmac, timingSafeEqual } from "node:crypto"

/** Signing key tied to the password hash: changing the password invalidates every cookie. */
export function sessionKey(secret: string, passwordHash: string): Buffer {
  return createHmac("sha256", secret).update(passwordHash).digest()
}

const mac = (id: string, key: Buffer) => createHmac("sha256", key).update(id).digest()

export function signSession(id: string, key: Buffer): string {
  return `${id}.${mac(id, key).toString("base64url")}`
}

export function verifySession(value: string, key: Buffer): string | null {
  const dot = value.lastIndexOf(".")
  if (dot <= 0) return null
  const id = value.slice(0, dot)
  const given = Buffer.from(value.slice(dot + 1), "base64url")
  const want = mac(id, key)
  return given.length === want.length && timingSafeEqual(given, want) ? id : null
}
