import { nextPresetId } from '@shared/rotation'
import type { Result, Settings } from '@shared/types'
import { createLogger } from './logger'

const log = createLogger('rotation')

export interface RotationDeps {
  settings: () => Settings
  /** ID preset sesuai urutan tombol 1, 2, 3, ... di toolbar. */
  presetIds: () => string[]
  activeId: () => string | null
  activate: (id: string) => Promise<Result>
}

/**
 * Rotasi otomatis antar preset. Hanya berjalan di Mode Tampil, supaya preset tidak berganti
 * saat operator sedang mengatur panel di Mode Atur.
 */
export class RotationController {
  private timer: NodeJS.Timeout | null = null
  private readonly broken = new Set<string>()

  constructor(private readonly d: RotationDeps) {}

  get running(): boolean {
    const { enabled } = this.d.settings().wall.rotation
    return enabled && this.d.settings().wall.displayMode
  }

  /** Mulai ulang hitungan (dipanggil saat pengaturan berubah atau preset diganti manual). */
  restart(): void {
    this.stop()
    if (!this.running) return
    this.timer = setTimeout(() => void this.tick(), this.d.settings().wall.rotation.intervalSec * 1000)
  }

  /** Daftar preset berubah: beri kesempatan lagi pada preset yang sebelumnya gagal. */
  presetsChanged(): void {
    this.broken.clear()
    this.restart()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    this.timer = null
    if (!this.running) return
    const next = nextPresetId(this.d.presetIds(), this.d.activeId(), this.broken)
    if (next) {
      const res = await this.d.activate(next)
      if (!res.ok) {
        this.broken.add(next)
        log.warn(`preset "${next}" dilewati: ${res.error}`)
      }
    }
    this.restart()
  }
}
