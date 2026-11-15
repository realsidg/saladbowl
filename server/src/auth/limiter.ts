const MIN = 60_000
const IP_WINDOW = 15 * MIN
const IP_FREE_FAILURES = 5
const IP_MAX_LOCK = 60 * MIN
const GLOBAL_WINDOW = 60 * MIN
const GLOBAL_MAX_FAILURES = 50
const GLOBAL_LOCK = 15 * MIN

type Check = { ok: true } | { ok: false; retryAfterMs: number }

/** In-memory brute-force guard for the password form: per IP and site-wide. */
export class LoginLimiter {
  private ips = new Map<string, { fails: number[]; lockedUntil: number }>()
  private global: number[] = []
  private globalLockedUntil = 0

  check(ip: string, now: number): Check {
    if (this.globalLockedUntil > now) return { ok: false, retryAfterMs: this.globalLockedUntil - now }
    const e = this.ips.get(ip)
    if (e && e.lockedUntil > now) return { ok: false, retryAfterMs: e.lockedUntil - now }
    return { ok: true }
  }

  fail(ip: string, now: number): void {
    const e = this.ips.get(ip) ?? { fails: [], lockedUntil: 0 }
    e.fails = e.fails.filter((t) => t > now - IP_WINDOW)
    e.fails.push(now)
    if (e.fails.length > IP_FREE_FAILURES) {
      e.lockedUntil = now + Math.min(2 ** (e.fails.length - IP_FREE_FAILURES - 1) * MIN, IP_MAX_LOCK)
    }
    this.ips.set(ip, e)

    this.global = this.global.filter((t) => t > now - GLOBAL_WINDOW)
    this.global.push(now)
    if (this.global.length > GLOBAL_MAX_FAILURES) this.globalLockedUntil = now + GLOBAL_LOCK
    this.prune(now)
  }

  succeed(ip: string): void {
    this.ips.delete(ip)
  }

  private prune(now: number) {
    if (this.ips.size < 10_000) return
    for (const [ip, e] of this.ips) if (e.lockedUntil < now && e.fails.every((t) => t < now - IP_WINDOW)) this.ips.delete(ip)
  }
}
