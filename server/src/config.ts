export interface Config {
  passwordHash: string
  sessionSecret: string
  /** allowed browser origins; the first is used in invite links */
  origins: string[]
  trustProxy: boolean | string
  dataDir: string
  port: number
  cookieSecure: boolean
  staticDir: string | null
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const need = (k: string) => {
    const v = env[k]?.trim()
    if (!v) throw new Error(`Missing required environment variable ${k}`)
    return v
  }
  const passwordHash = need("SALADBOWL_PASSWORD_HASH")
  if (!passwordHash.startsWith("scrypt:")) throw new Error("SALADBOWL_PASSWORD_HASH must come from `npm run hash-password`")
  const sessionSecret = need("SALADBOWL_SESSION_SECRET")
  if (Buffer.byteLength(sessionSecret) < 32) throw new Error("SALADBOWL_SESSION_SECRET must be at least 32 bytes")
  const origins = need("PUBLIC_ORIGIN")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean)
  for (const o of origins) if (!/^https?:\/\/[^/]+$/.test(o)) throw new Error(`PUBLIC_ORIGIN entry is not an origin: ${o}`)
  const tp = env.TRUST_PROXY?.trim()
  return {
    passwordHash,
    sessionSecret,
    origins,
    trustProxy: !tp || tp === "false" ? false : tp === "true" ? true : tp,
    dataDir: env.DATA_DIR?.trim() || "/data",
    port: Number(env.PORT) || 3000,
    cookieSecure: env.COOKIE_SECURE?.trim() !== "false",
    staticDir: env.STATIC_DIR?.trim() || null,
  }
}
