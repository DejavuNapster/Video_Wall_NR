import { type Event, type Input, WebContentsView } from 'electron'
import { BackoffTracker } from '@shared/backoff'
import { preloadPath, rendererTarget } from './config'
import { createLogger } from './logger'

const log = createLogger('wall-ui')

/** webContents.id UI wall -> slot monitor. Dipakai IPC wall:* untuk mengenali (dan membatasi) pengirim. */
export const wallUiSlots = new Map<number, number>()

export interface WallUiHooks {
  onInput(event: Event, input: Input): void
  /** Halaman UI selesai dimuat (kirim state awal, kembalikan urutan lapisan normal). */
  onReady(): void
}

/**
 * Lapisan UI di jendela wall: toolbar, bilah panel, garis bezel, menu. Halaman milik aplikasi
 * (tepercaya) dengan latar transparan, sehingga bisa diletakkan di bawah ATAU di atas tile.
 */
export class WallUiView {
  readonly view: WebContentsView
  private readonly backoff = new BackoffTracker()
  private retryTimer: NodeJS.Timeout | null = null
  private destroyed = false

  constructor(
    readonly slot: number,
    private readonly hooks: WallUiHooks
  ) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: preloadPath(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false
      }
    })
    this.view.setBackgroundColor('#00000000')
    const wc = this.view.webContents
    wallUiSlots.set(wc.id, slot)

    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    const target = rendererTarget('wall')
    const origin = target.kind === 'url' ? new URL(target.url).origin : null
    wc.on('will-navigate', (event) => {
      // Halaman UI tidak pernah berpindah halaman; di dev hanya HMR yang boleh reload.
      if (origin && event.url.startsWith(origin)) return
      event.preventDefault()
    })
    wc.on('before-input-event', (event, input) => this.hooks.onInput(event, input))
    wc.on('did-finish-load', () => {
      this.backoff.reset()
      this.hooks.onReady()
    })
    wc.on('render-process-gone', (_event, details) => {
      if (this.destroyed || details.reason === 'clean-exit') return
      this.scheduleReload(`renderer berhenti: ${details.reason}`)
    })
    wc.on('unresponsive', () => {
      if (!this.destroyed) this.scheduleReload('tidak responsif')
    })
    this.load()
  }

  get webContentsId(): number {
    return this.view.webContents.id
  }

  send(channel: string, payload: unknown): void {
    const wc = this.view.webContents
    if (!this.destroyed && !wc.isDestroyed() && !wc.isLoading()) wc.send(channel, payload)
  }

  focus(): void {
    if (!this.destroyed && !this.view.webContents.isDestroyed()) this.view.webContents.focus()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    wallUiSlots.delete(this.view.webContents.id)
    const wc = this.view.webContents
    if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false })
  }

  private load(): void {
    const target = rendererTarget('wall')
    const wc = this.view.webContents
    const p = target.kind === 'url' ? wc.loadURL(target.url) : wc.loadFile(target.path)
    p.catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes('ERR_ABORTED')) this.scheduleReload(`gagal dimuat: ${message}`)
    })
  }

  private scheduleReload(reason: string): void {
    if (this.destroyed || this.retryTimer) return
    const delay = this.backoff.failure()
    log.warn(`UI wall monitor ${this.slot + 1} ${reason}. Muat ulang dalam ${delay} ms`)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.destroyed) return
      const wc = this.view.webContents
      if (wc.isCrashed()) this.load()
      else wc.reload()
    }, delay)
  }
}
