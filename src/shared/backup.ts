/**
 * Backup & restore penuh (satu file): SEMUA preset + seluruh pengaturan + metadata versi.
 *
 * Prinsip:
 * - Ekspor = SATU file JSON (payload ber-versi) yang memuat semua preset dan settings.
 * - Restore = validasi penuh dengan zod DULU (parseBackupPayload); state baru
 *   dikomit ke storage setelah validasi lolos → bila gagal, state tidak berubah.
 */
import { z } from 'zod'
import { PresetSchema, SettingsSchema } from './schema'
import type { Result } from './types'

/** Identitas aplikasi dalam file backup (penolakan cepat bila file dari aplikasi lain). */
export const BACKUP_APP_ID = 'video-wall-browser'

/** Versi skema payload backup. Naikkan bila format berubah (file versi lama ditolak). */
export const BACKUP_SCHEMA_VERSION = 1

export const BackupPayloadSchema = z.object({
  app: z.literal(BACKUP_APP_ID),
  schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
  /** ISO-8601 waktu ekspor. */
  exportedAt: z.string().min(1),
  /** Versi aplikasi saat ekspor (informatif). */
  appVersion: z.string(),
  settings: SettingsSchema,
  presets: z.array(PresetSchema)
})
export type BackupPayload = z.infer<typeof BackupPayloadSchema>

/**
 * Validasi penuh isi file backup. DITOLAK bila:
 * - bukan objek, `app` salah, `schemaVersion` tidak dikenal, atau
 * - isi preset/settings tidak lolos zod (termasuk duplikasi tile/slot).
 */
export function parseBackupPayload(raw: unknown): Result<{ payload: BackupPayload }> {
  const parsed = BackupPayloadSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first && first.path.length ? ` (${first.path.join('.')})` : ''
    const reason = first?.message ?? 'format tidak dikenal'
    return { ok: false, error: `File backup tidak valid${where}: ${reason}` }
  }
  return { ok: true, payload: parsed.data }
}

/** Nama file backup dari stempel waktu (format aman lintas OS). */
export function backupFileName(date: Date): string {
  const stamp = date.toISOString().replace(/[:.]/g, '-')
  return `backup-${stamp}.json`
}
