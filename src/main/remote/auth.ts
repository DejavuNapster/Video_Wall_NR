import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/** Panjang minimum password kendali jarak jauh. */
export const MIN_PASSWORD_LENGTH = 8
const KEY_LEN = 32

/** Hash password dengan scrypt + salt acak. Format: `scrypt$<salt hex>$<hash hex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, KEY_LEN).toString('hex')}`
}

/** Bandingkan password dengan hash tersimpan (waktu konstan). */
export function verifyPassword(stored: string, password: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return expected.length === KEY_LEN && timingSafeEqual(expected, actual)
}

/** Sesi login (token acak di cookie HttpOnly). Disimpan di memori; hilang saat aplikasi ditutup. */
export class SessionStore {
  private readonly sessions = new Map<string, number>()

  constructor(
    private readonly ttlMs = 12 * 60 * 60_000,
    private readonly now: () => number = Date.now
  ) {}

  create(): string {
    this.prune()
    const token = randomBytes(32).toString('hex')
    this.sessions.set(token, this.now() + this.ttlMs)
    return token
  }

  valid(token: string | undefined): boolean {
    if (!token) return false
    const exp = this.sessions.get(token)
    if (exp === undefined) return false
    if (exp <= this.now()) {
      this.sessions.delete(token)
      return false
    }
    return true
  }

  revoke(token: string | undefined): void {
    if (token) this.sessions.delete(token)
  }

  /** Semua sesi berakhir (password diganti / kendali jarak jauh dimatikan). */
  clear(): void {
    this.sessions.clear()
  }

  get ttlSeconds(): number {
    return Math.floor(this.ttlMs / 1000)
  }

  private prune(): void {
    const now = this.now()
    for (const [t, exp] of this.sessions) if (exp <= now) this.sessions.delete(t)
  }
}

/** Batas percobaan login per alamat IP: setelah `maxFailures` gagal, dikunci selama `lockMs`. */
export class LoginLimiter {
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>()

  constructor(
    private readonly maxFailures = 5,
    private readonly lockMs = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  /** Sisa waktu terkunci (ms); 0 = boleh mencoba. */
  lockedFor(ip: string): number {
    const f = this.failures.get(ip)
    return f ? Math.max(0, f.lockedUntil - this.now()) : 0
  }

  fail(ip: string): void {
    const f = this.failures.get(ip) ?? { count: 0, lockedUntil: 0 }
    f.count += 1
    if (f.count >= this.maxFailures) {
      f.lockedUntil = this.now() + this.lockMs
      f.count = 0
    }
    this.failures.set(ip, f)
  }

  succeed(ip: string): void {
    this.failures.delete(ip)
  }
}
