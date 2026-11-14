import { safeStorage } from 'electron'
import { isSafeId, readJson, writeJsonAtomic } from './store'

/**
 * Penyimpanan password RTSP terenkripsi (safeStorage: DPAPI di Windows, libsecret/kwallet di Linux).
 * Password tidak pernah masuk ke file preset maupun ke renderer.
 */
export class CredentialVault {
  private cache: Record<string, string> = {}
  private loaded = false

  constructor(private readonly file: string) {}

  private async load(): Promise<void> {
    if (this.loaded) return
    const raw = (await readJson(this.file).catch(() => null)) as Record<string, unknown> | null
    this.cache = {}
    if (raw) {
      for (const [k, v] of Object.entries(raw)) if (isSafeId(k) && typeof v === 'string') this.cache[k] = v
    }
    this.loaded = true
  }

  /** 'secure' bila memakai keyring OS, 'weak' bila Linux jatuh ke basic_text, 'none' bila tidak tersedia. */
  strength(): 'secure' | 'weak' | 'none' {
    if (!safeStorage.isEncryptionAvailable()) return 'none'
    if (process.platform === 'linux') {
      const backend = (safeStorage as unknown as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend?.()
      if (backend === 'basic_text' || backend === 'unknown') return 'weak'
    }
    return 'secure'
  }

  async set(tileId: string, password: string): Promise<{ warning?: string }> {
    if (!isSafeId(tileId)) throw new Error('ID tile tidak valid')
    const strength = this.strength()
    if (strength === 'none') throw new Error('Enkripsi OS tidak tersedia, password tidak dapat disimpan dengan aman')
    await this.load()
    this.cache[tileId] = safeStorage.encryptString(password).toString('base64')
    await writeJsonAtomic(this.file, this.cache)
    return strength === 'weak'
      ? {
          warning:
            'Keyring OS tidak ditemukan (libsecret/kwallet). Password terenkripsi dengan kunci lemah. Pasang gnome-keyring atau kwallet untuk keamanan penuh.'
        }
      : {}
  }

  async get(tileId: string): Promise<string | null> {
    if (!isSafeId(tileId)) return null
    await this.load()
    const enc = this.cache[tileId]
    if (!enc || !safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }

  async has(tileId: string): Promise<boolean> {
    await this.load()
    return isSafeId(tileId) && tileId in this.cache
  }

  async remove(tileId: string): Promise<void> {
    if (!isSafeId(tileId)) return
    await this.load()
    if (tileId in this.cache) {
      delete this.cache[tileId]
      await writeJsonAtomic(this.file, this.cache)
    }
  }
}
