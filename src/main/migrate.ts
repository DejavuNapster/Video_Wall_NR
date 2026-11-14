import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { createLogger } from './logger'

const log = createLogger('migrate')

/** Nama aplikasi sebelumnya. Folder datanya (preset, pengaturan, password RTSP, login panel) dipindah sekali. */
const LEGACY_NAMES = ['Video Wall Browser']

/** Salin pohon folder; berkas yang terkunci (mis. aplikasi versi lama masih berjalan) dilewati. */
function copyTree(from: string, to: string): number {
  let skipped = 0
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name)
    const dest = join(to, entry.name)
    try {
      if (entry.isDirectory()) skipped += copyTree(src, dest)
      else copyFileSync(src, dest)
    } catch {
      skipped++
    }
  }
  return skipped
}

/**
 * Pindahkan folder data lama (%APPDATA%\Video Wall Browser) ke folder nama baru saat pertama kali jalan.
 * HARUS dipanggil sebelum apa pun menulis ke userData — termasuk logger, yang membuat folder logs/.
 */
export function migrateLegacyUserData(): void {
  if (app.commandLine.hasSwitch('user-data-dir')) return
  const dir = app.getPath('userData')
  if (existsSync(dir)) return
  for (const name of LEGACY_NAMES) {
    const old = join(app.getPath('appData'), name)
    if (!existsSync(old)) continue
    try {
      renameSync(old, dir)
      log.info(`folder data dipindah: ${old} -> ${dir}`)
    } catch {
      // Gagal pindah (biasanya versi lama masih berjalan): salin, folder lama dibiarkan.
      const skipped = copyTree(old, dir)
      log.warn(`folder data disalin dari ${old} -> ${dir}${skipped ? ` (${skipped} berkas terkunci dilewati)` : ''}`)
    }
    return
  }
}
