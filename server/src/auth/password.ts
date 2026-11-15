import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto"

const N = 32768
const R = 8
const P = 1
const KEYLEN = 32

function derive(pw: string, salt: Buffer, opts: ScryptOptions, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(pw.normalize("NFKC"), salt, keylen, { ...opts, maxmem: 256 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  )
}

/** `scrypt$N$r$p$saltB64$keyB64` */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(pw, salt, { N, r: R, p: P }, KEYLEN)
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$")
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return false
  const [n, r, p] = parts.slice(1, 4).map(Number)
  if (!n || !r || !p || n > 2 ** 20) return false
  const salt = Buffer.from(parts[4]!, "base64")
  const want = Buffer.from(parts[5]!, "base64")
  if (want.length < 16) return false
  const got = await derive(pw, salt, { N: n, r, p }, want.length)
  return timingSafeEqual(got, want)
}
