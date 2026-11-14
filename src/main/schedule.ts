/**
 * Scheduler preset berbasis jam (proses main).
 *
 * Cek tiap ~30 detik; bila entri jadwal jatuh tempo, preset yang ditunjuk
 * diaktifkan lewat alur `activate` yang sama dengan rotasi interval.
 *
 * Hysteresis: entri yang sama (preset + jam) hanya memicu sekali per menit —
 * kegagalan aktivasi dicoba ulang pada tick berikutnya di menit yang sama.
 *
 * PRIORITAS (aturan global, dipertahankan di index.ts):
 * jadwal > rotasi interval — selama ada entri aktif, rotasi interval dijeda.
 */
import {
  SCHEDULE_CHECK_MS,
  entryKey,
  hasEnabledSchedule,
  minuteStamp,
  pickScheduledEntry,
  type LastTrigger
} from '@shared/schedule'
import type { Result, ScheduleEntry } from '@shared/types'
import { createLogger } from './logger'

const log = createLogger('jadwal')

export interface ScheduleDeps {
  /** Entri jadwal saat ini (settings.wall.schedule). */
  entries: () => readonly ScheduleEntry[]
  /** ID preset aktif saat ini. */
  activeId: () => string | null
  /** Aktifkan preset (setActiveId + rotasi wall, alur yang sama dengan rotasi interval). */
  activate: (id: string) => Promise<Result>
}

export class ScheduleController {
  private timer: NodeJS.Timeout | null = null
  private last: LastTrigger | null = null

  constructor(private readonly d: ScheduleDeps) {}

  get running(): boolean {
    return this.timer !== null
  }

  /** (Re)start timer; tidak berjalan bila tidak ada entri yang diaktifkan. */
  restart(): void {
    this.stop()
    if (!hasEnabledSchedule(this.d.entries())) return
    this.timer = setInterval(() => {
      void this.tick().catch((err) => log.error('tick jadwal gagal', err))
    }, SCHEDULE_CHECK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Satu langkah pemeriksaan. `now` dapat disuntik untuk unit test.
   * Mengembalikan true bila entri diproses (aktifkan / no-op / gagal).
   */
  async tick(now: Date = new Date()): Promise<boolean> {
    const entry = pickScheduledEntry(now, this.d.entries(), this.last)
    if (!entry) return false
    const key = entryKey(entry)
    const stamp = minuteStamp(now)
    if (entry.presetId === this.d.activeId()) {
      // Preset yang ditunjuk sudah aktif: catat pemicu agar tidak diulang menit ini.
      this.last = { key, minuteStamp: stamp }
      return true
    }
    log.info(`jadwal ${String(entry.hour).padStart(2, '0')}:${String(entry.minute).padStart(2, '0')} -> preset "${entry.presetId}"`)
    const res = await this.d.activate(entry.presetId)
    if (res.ok) {
      this.last = { key, minuteStamp: stamp }
      return true
    }
    // Tidak catat pemicu: dicoba ulang pada tick berikutnya di menit yang sama.
    log.warn(`jadwal gagal untuk preset "${entry.presetId}": ${res.error} (dicoba ulang)`)
    return true
  }
}
