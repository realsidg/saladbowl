import type { FastifyReply, FastifyRequest } from "fastify"

/** Simple fixed-window counter: at most `max` hits per key per window. */
export class WindowLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  /** Ms to wait if this key has already used its allowance, else 0. Doesn't count as a hit. */
  blocked(key: string, now: number): number {
    const e = this.hits.get(key)
    return e && e.resetAt > now && e.count >= this.max ? e.resetAt - now : 0
  }

  /** Records a hit; returns ms to wait if over the limit, else 0. */
  hit(key: string, now: number): number {
    let e = this.hits.get(key)
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + this.windowMs }
      this.hits.set(key, e)
      if (this.hits.size > 50_000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k)
    }
    e.count += 1
    return e.count > this.max ? e.resetAt - now : 0
  }
}

export function tooMany(reply: FastifyReply, waitMs: number) {
  return reply
    .code(429)
    .header("retry-after", String(Math.ceil(waitMs / 1000)))
    .send({ code: "rate_limited", retryAfterSeconds: Math.ceil(waitMs / 1000) })
}

/** State-changing requests must come from one of our own pages. */
export function originAllowed(req: FastifyRequest, origins: string[]): boolean {
  const o = req.headers.origin
  return typeof o === "string" && origins.includes(o)
}
