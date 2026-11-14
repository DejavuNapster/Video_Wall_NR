import { BACKUP_APP_ID, BACKUP_SCHEMA_VERSION, backupFileName, type BackupPayload } from '@shared/backup'
import type { Preset } from '@shared/types'
import type { PresetStore, SettingsStore } from './store'

export interface BackupServiceOpts {
  /** Versi aplikasi (di-catat di payload, informatif). */
  appVersion: string
  presets: PresetStore
  settings: SettingsStore
  /** "Sekarang" — di-inject agar bisa diuji. */
  now?: () => Date
}

/**
 * Backup/restore satu file: SEMUA preset + seluruh pengaturan menjadi SATU file JSON ber-versi.
 * Prinsip: validasi penuh (zod, `parseBackupPayload`) SEBELUM `apply` — bila gagal, state tidak berubah.
 * Lapisan ini murni node (tanpa Electron) sehingga bisa diuji unit; dialog simpan/buka ada di handler IPC.
 */
export class BackupService {
  constructor(private readonly o: BackupServiceOpts) {}

  private now(): Date {
    return this.o.now ? this.o.now() : new Date()
  }

  /** Ambil seluruh preset + pengaturan menjadi payload (tanpa menulis apa pun). */
  async buildPayload(): Promise<BackupPayload> {
    const presets: Preset[] = []
    for (const m of await this.o.presets.list()) {
      const p = await this.o.presets.get(m.id)
      if (p) presets.push(p)
    }
    return {
      app: BACKUP_APP_ID,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: this.now().toISOString(),
      appVersion: this.o.appVersion,
      settings: this.o.settings.get(),
      presets
    }
  }

  /**
   * Terapkan payload (sudah tervalidasi `parseBackupPayload`) ke store:
   * preset yang tidak ada di backup dihapus, semua preset backup disimpan, pengaturan diganti.
   */
  async apply(payload: BackupPayload): Promise<void> {
    const keep = new Set(payload.presets.map((p) => p.id))
    for (const m of await this.o.presets.list()) {
      if (!keep.has(m.id)) await this.o.presets.remove(m.id)
    }
    for (const p of payload.presets) await this.o.presets.save(p)
    const res = await this.o.settings.replace(payload.settings)
    if (!res.ok) throw new Error(res.error)
  }

  /** Nama file default di dialog simpan (deterministik, untuk uji). */
  fileNameFor(date: Date = this.now()): string {
    return backupFileName(date)
  }
}
