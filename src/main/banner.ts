/**
 * Banner pengumuman darurat (proses main).
 *
 * Satu state global di main: saat banner diset, semua monitor wall
 * menutupinya (UI wall membaca `state.banner`). Banner bisa:
 * - tampil sementara (`durationSec` > 0 → otomatis hilang),
 * - tampil tetap (`durationSec` = 0 → sampai ditutup dari operator),
 * - di-pin (`pinned` → tombol tutup di wall disembunyikan).
 *
 * UI operator dan UI wall tidak menyimpan state sendiri; keduanya hanya
 * memproyeksikan state ini dari main (AppState.banner / WallUiState.banner).
 */
import type { EmergencyBanner, LiveBanner } from '@shared/types'
import { createLogger } from './logger'

const log = createLogger('banner')

/** Handle timer minimal (NodeJS.Timeout juga cocok); `unref` opsional untuk browser. */
export type TimerHandle = { unref?: () => void }

export interface BannerDeps {
  /** Ubah waktu/timer (dapat disuntik untuk unit test). */
  now?: () => number
  setTimeout?: (fn: () => void, ms: number) => TimerHandle
  clearTimeout?: (t: TimerHandle) => void
  /** Dipanggil setiap kali state banner berubah (set/clear/expired) untuk mendorong UI. */
  onChange?: () => void
}

export class BannerController {
  private live: LiveBanner | null = null
  private timer: TimerHandle | null = null
  private readonly now: () => number
  private readonly setTimeoutFn: (fn: () => void, ms: number) => TimerHandle
  private readonly clearTimeoutFn: (t: TimerHandle) => void

  constructor(private readonly d: BannerDeps = {}) {
    this.now = d.now ?? Date.now
    this.setTimeoutFn = d.setTimeout ?? ((fn, ms) => {
      const h = setTimeout(fn, ms)
      h.unref?.()
      return h
    })
    this.clearTimeoutFn = d.clearTimeout ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>))
  }

  /** Banner yang sedang aktif, atau null. */
  get(): LiveBanner | null {
    return this.live
  }

  /** Tampilkan (atau ganti) banner; jadwalkan penghilangan otomatis bila durationSec > 0. */
  set(banner: EmergencyBanner): void {
    this.cancelTimer()
    this.live = { banner, setAt: this.now() }
    if (banner.durationSec > 0) {
      this.timer = this.setTimeoutFn(() => this.expire(), banner.durationSec * 1000)
      this.timer.unref?.()
    }
    log.info(`banner diset (${banner.durationSec > 0 ? `${banner.durationSec}s` : 'tetap'}${banner.pinned ? ', pinned' : ''})`)
    this.d.onChange?.()
  }

  /** Tutup banner (dari operator, atau dari tombol wall bila tidak pinned). */
  clear(): void {
    if (!this.live) return
    this.cancelTimer()
    this.live = null
    log.info('banner ditutup')
    this.d.onChange?.()
  }

  /** Banner pinned tidak boleh ditutup lewat tombol wall. */
  closeFromWall(): boolean {
    if (!this.live) return false
    if (this.live.banner.pinned) {
      log.warn('menolak tutup banner pinned dari wall')
      return false
    }
    this.clear()
    return true
  }

  /** Berhenti (batal timer); dipanggil saat aplikasi keluar. */
  stop(): void {
    this.cancelTimer()
  }

  private expire(): void {
    if (!this.live) return
    this.live = null
    log.info('banner berakhir (durasi habis)')
    this.d.onChange?.()
  }

  private cancelTimer(): void {
    if (this.timer) {
      this.clearTimeoutFn(this.timer)
      this.timer = null
    }
  }
}
