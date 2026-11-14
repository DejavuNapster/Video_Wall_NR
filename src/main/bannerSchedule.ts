import { isEntryDue, minuteStamp, SCHEDULE_CHECK_MS } from '@shared/schedule'
import type { BannerScheduleEntry, BannerTemplate, EmergencyBanner } from '@shared/types'
import { createLogger } from './logger'

const log = createLogger('jadwal-banner')

export interface BannerScheduleDeps {
  entries: () => readonly BannerScheduleEntry[]
  templates: () => readonly BannerTemplate[]
  show: (banner: EmergencyBanner) => void
}

/**
 * Menampilkan templat banner pada jam yang dijadwalkan (cek tiap ~30 detik, sekali per entri per menit).
 * Beberapa entri pada menit yang sama: entri pertama di daftar yang menang.
 */
export class BannerScheduler {
  private timer: NodeJS.Timeout | null = null
  /** Entri + menit yang sudah dipicu (hysteresis). */
  private last: string | null = null

  constructor(private readonly d: BannerScheduleDeps) {}

  restart(): void {
    this.stop()
    if (!this.d.entries().some((e) => e.enabled)) return
    this.timer = setInterval(() => this.tick(), SCHEDULE_CHECK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Satu pemeriksaan; mengembalikan templat yang ditampilkan (untuk unit test). */
  tick(now: Date = new Date()): BannerTemplate | null {
    const entry = this.d.entries().find((e) => isEntryDue(e, now))
    if (!entry) return null
    const key = `${entry.id}@${minuteStamp(now)}`
    if (key === this.last) return null
    this.last = key
    const template = this.d.templates().find((t) => t.id === entry.templateId)
    if (!template) {
      log.warn(`jadwal banner ${entry.id}: templat "${entry.templateId}" tidak ada`)
      return null
    }
    log.info(`jadwal banner -> templat "${template.name}"`)
    this.d.show(template.banner)
    return template
  }
}
