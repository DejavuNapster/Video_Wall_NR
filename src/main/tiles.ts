import { type Event, type Input, WebContentsView } from 'electron'
import { BackoffTracker } from '@shared/backoff'
import { effectiveIgnoreCert } from '@shared/tileKey'
import type { Rect, Settings, Tile, TileState, TileStatus, VideoHeartbeat, VideoTileConfig } from '@shared/types'
import { preloadPath, rendererTarget } from './config'
import { createLogger } from './logger'
import { hardenTileSession } from './security'

const log = createLogger('tile')

/** webContents.id -> TileView, dipakai handler IPC video untuk mengenali pengirim. */
export const tileByWebContents = new Map<number, TileView>()

export interface TileContext {
  getSettings(): Settings
  resolveVideo(tile: Tile): Promise<VideoTileConfig | null>
  onStatus(status: TileStatus): void
  blockedPorts(): number[]
  /** Keyboard di dalam tile (untuk shortcut wall). */
  onInput(tv: TileView, event: Event, input: Input): void
  /** Tile mendapat fokus (diklik) -> menjadi panel aktif. */
  onFocus(tv: TileView): void
  /** Ctrl+roda mouse di dalam tile. */
  onZoomWheel(tv: TileView, dir: 'in' | 'out'): void
  /** Tab baru (target=_blank / window.open) → buka URL sebagai tile baru. */
  onNewTab(tv: TileView, url: string): void
}

const UNRESPONSIVE_RELOAD_MS = 30_000
const HEALTH_INTERVAL_MS = 5_000
const MEMORY_RELOAD_COOLDOWN_MS = 10 * 60_000

/**
 * Satu tile = satu WebContentsView = satu proses renderer terpisah.
 * Crash/hang di satu tile tidak memengaruhi tile lain; TileView memulihkan dirinya sendiri
 * dengan backoff (2 dtk, 5 dtk, 30 dtk), reload terjadwal, dan deteksi video beku.
 */
export class TileView {
  readonly view: WebContentsView
  readonly webContentsId: number
  videoConfig: VideoTileConfig | null = null

  private status: TileStatus
  private readonly backoff = new BackoffTracker()
  private recoveryTimer: NodeJS.Timeout | null = null
  private unresponsiveTimer: NodeJS.Timeout | null = null
  private reloadTimer: NodeJS.Timeout | null = null
  private healthTimer: NodeJS.Timeout | null = null
  private lastProgress = Number.NaN
  private lastProgressAt = Date.now()
  private lastMemoryReloadAt = 0
  private destroyed = false
  /** Halaman sedang fullscreen HTML (tombol "Layar Penuh" di dalam web); Esc milik halaman. */
  htmlFullscreen = false
  /** `tileHardKey` saat tile dibuat; bila berubah, WallController membuat tile baru. */
  hardKey = ''

  constructor(
    public tile: Tile,
    readonly monitorSlot: number,
    private readonly ctx: TileContext
  ) {
    const isWeb = tile.source.type === 'web'
    const ignoreCertErrors = effectiveIgnoreCert(tile.source, ctx.getSettings().ignoreCertErrorsAll)
    // Session terpisah bila sertifikat diabaikan: hasil verifikasi sertifikat di-cache per session,
    // sehingga mengubah opsi ini pada session yang sama tidak berpengaruh sampai aplikasi restart.
    // Karena itu WallController membuat ulang tile bila nilai efektif ini berubah (lihat tileHardKey).
    const suffix = ignoreCertErrors ? '-insecure' : ''
    this.view = new WebContentsView({
      webPreferences: {
        // Tile web: session persisten per tile (login bertahan). Tile video: session sementara.
        partition: isWeb ? `persist:tile-${tile.id}${suffix}` : `video-${tile.id}${suffix}`,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        autoplayPolicy: 'no-user-gesture-required',
        spellcheck: false,
        // Konten web tak tepercaya TIDAK diberi preload sama sekali.
        ...(isWeb ? {} : { preload: preloadPath() })
      }
    })
    this.view.setBackgroundColor('#000000')
    this.webContentsId = this.view.webContents.id
    tileByWebContents.set(this.webContentsId, this)

    this.status = { tileId: tile.id, monitorSlot, state: 'idle', restarts: 0 }

    hardenTileSession(this.view.webContents.session, {
      untrusted: isWeb,
      ignoreCertErrors,
      getSettings: () => ctx.getSettings(),
      blockedPorts: () => ctx.blockedPorts()
    })
    this.wire()
  }

  get currentStatus(): TileStatus {
    return { ...this.status }
  }

  setBounds(rect: Rect): void {
    this.view.setBounds(rect)
  }

  /**
   * Terapkan perubahan yang tidak butuh memuat ulang halaman (zoom, refresh otomatis, label).
   * Perubahan lain (URL, jenis, sertifikat) membuat WallController membuat TileView baru.
   */
  update(tile: Tile): void {
    if (this.destroyed) return
    const prev = this.tile.source
    this.tile = tile
    const src = tile.source
    if (src.type !== 'web' || prev.type !== 'web') return
    if (src.zoom !== prev.zoom && !this.view.webContents.isDestroyed()) this.view.webContents.setZoomFactor(src.zoom)
    if (src.reloadMinutes !== prev.reloadMinutes) {
      if (this.reloadTimer) clearTimeout(this.reloadTimer)
      this.reloadTimer = null
      this.armScheduledReload()
    }
  }

  focus(): void {
    if (!this.destroyed && !this.view.webContents.isDestroyed()) this.view.webContents.focus()
  }

  /** Mulai memuat konten dan menjalankan timer kesehatan/reload terjadwal. */
  start(): void {
    this.healthTimer = setInterval(() => this.checkHealth(), HEALTH_INTERVAL_MS)
    this.armScheduledReload()
    void this.load()
  }

  /** Halaman yang sedang terbuka (panel web), untuk "buka di panel baru". */
  get pageUrl(): string {
    const wc = this.view.webContents
    return this.destroyed || wc.isDestroyed() ? '' : wc.getURL()
  }

  /** Muat ulang halaman yang sedang terbuka (tombol ⟳ / F5). Panel bermasalah dimuat ulang dari URL panel. */
  refresh(): void {
    const wc = this.view.webContents
    if (this.destroyed || wc.isDestroyed()) return
    if (this.tile.source.type === 'web' && this.status.state === 'ok' && wc.getURL()) {
      log.info(`refresh tile ${this.tile.id}`)
      wc.reload()
    } else {
      this.reload('diminta dari wall')
    }
  }

  /** Riwayat halaman panel web. false bila tidak ada halaman tujuan. */
  navigate(dir: 'back' | 'forward'): boolean {
    const wc = this.view.webContents
    if (this.destroyed || wc.isDestroyed() || this.tile.source.type !== 'web') return false
    const history = wc.navigationHistory
    if (dir === 'back' ? !history.canGoBack() : !history.canGoForward()) return false
    if (dir === 'back') history.goBack()
    else history.goForward()
    return true
  }

  reload(reason: string): void {
    if (this.destroyed) return
    log.info(`reload tile ${this.tile.id}: ${reason}`)
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    this.recoveryTimer = null
    void this.load()
  }

  /** Dipanggil saat sidecar baru siap: percobaan ulang langsung untuk tile video yang gagal. */
  retryIfFailed(): void {
    if (this.destroyed) return
    if (this.tile.source.type === 'web' || this.tile.source.type === 'empty') return
    if (this.status.state === 'failed' || this.status.state === 'stalled') this.reload('sidecar siap')
  }

  heartbeat(beat: VideoHeartbeat): void {
    if (this.destroyed) return
    if (beat.error) this.status.lastError = beat.error
    if (beat.playing && beat.progress !== this.lastProgress) {
      this.lastProgress = beat.progress
      this.lastProgressAt = Date.now()
      if (this.status.state !== 'ok') {
        this.backoff.reset()
        this.setState('ok')
      }
    }
  }

  updateMetrics(memoryMB: number, cpuPercent: number): void {
    if (this.destroyed) return
    this.status.memoryMB = Math.round(memoryMB)
    this.status.cpuPercent = Math.round(cpuPercent * 10) / 10
    const max = this.ctx.getSettings().maxTileMemoryMB
    if (max > 0 && memoryMB > max && Date.now() - this.lastMemoryReloadAt > MEMORY_RELOAD_COOLDOWN_MS) {
      this.lastMemoryReloadAt = Date.now()
      this.reload(`memori ${Math.round(memoryMB)} MB melewati batas ${max} MB`)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const t of [this.recoveryTimer, this.unresponsiveTimer, this.reloadTimer]) if (t) clearTimeout(t)
    if (this.healthTimer) clearInterval(this.healthTimer)
    tileByWebContents.delete(this.webContentsId)
    const wc = this.view.webContents
    if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false })
  }

  // ---------------------------------------------------------------- internal

  private allowNavigation(rawUrl: string): boolean {
    if (this.tile.source.type !== 'web') return false // halaman pemutar tidak pernah berpindah halaman
    try {
      const protocol = new URL(rawUrl).protocol
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  }

  private wire(): void {
    const wc = this.view.webContents
    // Tab baru (target=_blank / window.open) → buka di tile baru seperti browser.
    // Hanya URL http(s) yang diteruskan; sisanya (about:blank, javascript:) tetap ditolak.
    // Jendela native Electron tetap ditolak — tile barulah yang kita buat.
    wc.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        this.ctx.onNewTab(this, url)
      }
      return { action: 'deny' }
    })
    wc.on('will-navigate', (event) => {
      if (!this.allowNavigation(event.url)) event.preventDefault()
    })
    wc.on('will-redirect', (event) => {
      if (!this.allowNavigation(event.url)) event.preventDefault()
    })
    // Halaman berpindah (klik link, kembali/maju, SPA): kirim URL + status riwayat ke UI wall.
    wc.on('did-navigate', () => this.syncNav())
    wc.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (isMainFrame) this.syncNav()
    })
    wc.on('before-input-event', (event, input) => this.ctx.onInput(this, event, input))
    wc.on('focus', () => this.ctx.onFocus(this))
    wc.on('zoom-changed', (_event, dir) => this.ctx.onZoomWheel(this, dir))
    wc.on('enter-html-full-screen', () => {
      this.htmlFullscreen = true
    })
    wc.on('leave-html-full-screen', () => {
      this.htmlFullscreen = false
    })
    wc.on('did-finish-load', () => {
      if (this.destroyed) return
      if (this.tile.source.type === 'web') {
        wc.setZoomFactor(this.tile.source.zoom)
        this.status.lastOkAt = Date.now()
        this.backoff.reset()
        this.setState('ok')
      }
      // Tile video menjadi 'ok' setelah heartbeat pertama yang menunjukkan frame maju.
    })
    wc.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (this.destroyed || !isMainFrame || errorCode === -3) return // -3 = ERR_ABORTED (navigasi diganti)
      this.scheduleRecovery('failed', `Gagal memuat: ${errorDescription} (${errorCode})`)
    })
    wc.on('render-process-gone', (_event, details) => {
      if (this.destroyed || details.reason === 'clean-exit') return
      this.scheduleRecovery('crashed', `Proses renderer berhenti: ${details.reason} (exit ${details.exitCode})`)
    })
    wc.on('unresponsive', () => {
      if (this.destroyed || this.unresponsiveTimer) return
      this.setState('unresponsive')
      this.unresponsiveTimer = setTimeout(() => {
        this.unresponsiveTimer = null
        if (this.destroyed || wc.isDestroyed()) return
        log.warn(`tile ${this.tile.id} tidak responsif >30 dtk, paksa crash renderer lalu reload`)
        wc.forcefullyCrashRenderer() // memicu 'render-process-gone' -> pemulihan berbackoff
      }, UNRESPONSIVE_RELOAD_MS)
    })
    wc.on('responsive', () => {
      if (this.unresponsiveTimer) clearTimeout(this.unresponsiveTimer)
      this.unresponsiveTimer = null
      if (this.status.state === 'unresponsive') this.setState('ok')
    })
  }

  private async load(): Promise<void> {
    if (this.destroyed) return
    const wc = this.view.webContents
    this.setState('loading')
    this.lastProgress = Number.NaN
    this.lastProgressAt = Date.now()
    try {
      const src = this.tile.source
      if (src.type === 'web') {
        await wc.loadURL(src.url)
      } else if (src.type !== 'empty') {
        const config = await this.ctx.resolveVideo(this.tile)
        if (!config) throw new Error('Sumber video belum tersedia (MediaMTX belum siap atau dimatikan)')
        this.videoConfig = config
        this.lastProgressAt = Date.now()
        const target = rendererTarget('video')
        if (target.kind === 'url') await wc.loadURL(target.url)
        else await wc.loadFile(target.path)
      }
    } catch (err) {
      if (this.destroyed) return
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('ERR_ABORTED')) return
      this.scheduleRecovery('failed', message)
    }
  }

  private scheduleRecovery(state: TileState, error: string): void {
    this.status.lastError = error
    this.setState(state)
    if (this.destroyed || this.recoveryTimer) return
    const delay = this.backoff.failure()
    this.status.restarts += 1
    log.warn(`tile ${this.tile.id} ${state}: ${error}. Coba lagi dalam ${delay} ms`)
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null
      void this.load()
    }, delay)
  }

  private checkHealth(): void {
    if (this.destroyed || this.recoveryTimer) return
    const src = this.tile.source
    if (src.type === 'web' || src.type === 'empty') return
    const stallMs = this.ctx.getSettings().videoStallSeconds * 1000
    if (this.status.state !== 'failed' && Date.now() - this.lastProgressAt > stallMs) {
      this.scheduleRecovery('stalled', `Video tidak bergerak selama ${Math.round(stallMs / 1000)} detik`)
    }
  }

  /** Reload terjadwal (+-10% jitter agar semua tile tidak reload bersamaan). */
  private armScheduledReload(): void {
    const src = this.tile.source
    const minutes =
      src.type === 'web' && src.reloadMinutes > 0 ? src.reloadMinutes : this.ctx.getSettings().reloadIntervalHours * 60
    if (this.destroyed || minutes <= 0) return
    const jitter = 0.9 + Math.random() * 0.2
    this.reloadTimer = setTimeout(
      () => {
        this.reloadTimer = null
        this.reload('reload terjadwal')
        this.armScheduledReload()
      },
      minutes * 60_000 * jitter
    )
  }

  private syncNav(): void {
    const wc = this.view.webContents
    if (this.destroyed || wc.isDestroyed() || this.tile.source.type !== 'web') return
    const pageUrl = wc.getURL()
    const canGoBack = wc.navigationHistory.canGoBack()
    const canGoForward = wc.navigationHistory.canGoForward()
    const s = this.status
    if (s.pageUrl === pageUrl && s.canGoBack === canGoBack && s.canGoForward === canGoForward) return
    Object.assign(s, { pageUrl, canGoBack, canGoForward })
    this.ctx.onStatus({ ...s })
  }

  private setState(state: TileState): void {
    this.status.state = state
    this.ctx.onStatus({ ...this.status })
  }
}
