import { EventEmitter } from 'node:events'
import { powerMonitor, screen } from 'electron'
import { assignWallSlots } from '@shared/layout'
import type { DisplayInfo } from '@shared/types'
import { flags } from './config'

type RawDisplay = Omit<DisplayInfo, 'slot'>

/**
 * Mengenumerasi monitor, memberi nomor slot wall, dan memberi sinyal 'changed' (sudah di-debounce)
 * saat monitor dicolok/dicabut, resolusi berubah, atau komputer bangun dari sleep.
 */
export class DisplayManager extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private readonly onScreenChange = (): void => this.schedule(750)
  private readonly onResume = (): void => this.schedule(3000)

  constructor(private readonly getExcludePrimary: () => boolean | undefined) {
    super()
  }

  private raw(): RawDisplay[] {
    if (flags.virtualDisplays > 0) return this.virtualDisplays()
    const primaryId = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      label: d.label || `Display ${d.id}`,
      bounds: { ...d.bounds },
      scaleFactor: d.scaleFactor,
      primary: d.id === primaryId,
      virtual: false
    }))
  }

  /** Mode dev: N "monitor" 640x360 yang disusun di dalam area kerja layar utama. */
  private virtualDisplays(): RawDisplay[] {
    const wa = screen.getPrimaryDisplay().workArea
    const w = 640
    const h = 360
    const pad = 16
    const perRow = Math.max(1, Math.floor((wa.width + pad) / (w + pad)))
    return Array.from({ length: flags.virtualDisplays }, (_, i) => ({
      id: 100_000 + i,
      label: `Monitor virtual ${i + 1}`,
      bounds: { x: wa.x + (i % perRow) * (w + pad), y: wa.y + Math.floor(i / perRow) * (h + pad), width: w, height: h },
      scaleFactor: 1,
      primary: false,
      virtual: true
    }))
  }

  list(): DisplayInfo[] {
    return assignWallSlots(this.raw(), flags.windowed ? false : this.getExcludePrimary())
  }

  wallDisplays(): DisplayInfo[] {
    return this.list().filter((d) => d.slot !== null)
  }

  start(): void {
    screen.on('display-added', this.onScreenChange)
    screen.on('display-removed', this.onScreenChange)
    screen.on('display-metrics-changed', this.onScreenChange)
    powerMonitor.on('resume', this.onResume)
  }

  stop(): void {
    screen.off('display-added', this.onScreenChange)
    screen.off('display-removed', this.onScreenChange)
    screen.off('display-metrics-changed', this.onScreenChange)
    powerMonitor.off('resume', this.onResume)
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.emit('changed')
    }, delayMs)
  }
}
