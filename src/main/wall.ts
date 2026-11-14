import { EventEmitter } from 'node:events'
import { app, BaseWindow, type Event, type Input } from 'electron'
import { IPC } from '@shared/ipc'
import { panelGeometry, stripHeight } from '@shared/panelGeometry'
import { matchShortcut, type WallAction } from '@shared/shortcuts'
import { isNativeSource } from '@shared/native'
import { tileHardKey } from '@shared/tileKey'
import type {
  DisplayInfo,
  LiveBanner,
  MonitorLayout,
  Preset,
  Result,
  Settings,
  Tile,
  TileNavAction,
  Thumbnails,
  TileStatus,
  VideoTileConfig,
  WallCommand,
  WallUiState
} from '@shared/types'
import type { CredentialVault } from './credentials'
import { flags } from './config'
import type { DisplayManager } from './displays'
import { createLogger } from './logger'
import { appendMetrics, type MetricsRow } from './metrics'
import { type MediaMtxSidecar, mediaPathName, type PathSpec, withCredentials } from './sidecar'
import { TileView, type TileContext } from './tiles'
import { WallUiView } from './wallUi'

const log = createLogger('wall')

/** Lebar cuplikan panel (px) dan berapa lama satu set cuplikan dipakai bersama (Operator + kendali jarak jauh). */
const THUMB_WIDTH = 360
const THUMB_TTL_MS = 3_000

/** Tile dengan status ini disembunyikan supaya pesan error + tombol "Coba lagi" di UI wall terlihat. */
const HIDDEN_STATES = new Set(['failed', 'crashed'])

interface WallWindow {
  slot: number
  displayId: number
  bounds: DisplayInfo['bounds']
  win: BaseWindow
  ui: WallUiView
  tiles: Map<string, TileView>
  relayoutTimer: NodeJS.Timeout | null
  closing: boolean
  /** Panel tujuan shortcut (F5, F11, zoom, Ctrl+L). */
  activeTileId: string | null
  /** Panel yang sedang memenuhi seluruh jendela (F11). Sementara, tidak disimpan. */
  panelFullscreen: string | null
  /** true = UI wall di atas semua tile (menu terbuka / sedang geser panel). */
  overlay: boolean
}

/** Aksi yang butuh komponen lain (preset, pengaturan). Dipasang dari index.ts. */
export interface WallActions {
  toggleDisplayMode(): void
  zoomTile(slot: number, tileId: string, dir: 'in' | 'out' | 'reset'): void
  activatePresetIndex(index: number): void
  toggleRotation(): void
  /**
   * Tab baru (target=_blank / window.open, atau tombol "buka di panel baru") → buka sebagai tile baru
   * pada monitor yang sama. Monitor penuh: panel `fromTileId` dibelah dua.
   */
  openNewTab(slot: number, url: string, fromTileId: string): void
}

export interface WallDeps {
  displays: DisplayManager
  sidecar: MediaMtxSidecar
  vault: CredentialVault
  getSettings: () => Settings
  /** Dipanggil setiap status tile berubah (untuk memperbarui UI operator). */
  onChange: () => void
  /** Bagian state UI wall yang bukan milik WallController. */
  uiExtras: () => Pick<WallUiState, 'presets' | 'saveError'>
  /** Banner darurat saat ini (null = tidak ada). */
  banner: () => LiveBanner | null
}

/**
 * Mengelola window wall: satu BaseWindow per monitor wall, berisi lapisan UI wall dan WebContentsView per tile.
 * Perubahan preset dihitung sebagai selisih: tile yang tidak berubah tidak di-reload.
 */
export class WallController extends EventEmitter {
  private readonly windows = new Map<number, WallWindow>()
  private readonly statuses = new Map<string, TileStatus>()
  private preset: Preset | null = null
  private queue: Promise<void> = Promise.resolve()
  private metricsTimer: NodeJS.Timeout | null = null
  private uiTimer: NodeJS.Timeout | null = null
  private actions: WallActions | null = null
  private readonly tileCtx: TileContext
  private thumbCache: { at: number; data: Thumbnails } | null = null
  private thumbPending: Promise<Thumbnails> | null = null

  constructor(private readonly deps: WallDeps) {
    super()
    this.tileCtx = {
      getSettings: () => deps.getSettings(),
      resolveVideo: (tile) => this.resolveVideo(tile),
      onStatus: (status) => {
        this.statuses.set(status.tileId, status)
        const ww = this.windows.get(status.monitorSlot)
        const tv = ww?.tiles.get(status.tileId)
        if (tv) this.applyVisibility(tv)
        deps.onChange()
        this.notifyUi()
      },
      blockedPorts: () => deps.sidecar.ports(),
      onInput: (tv, event, input) => {
        const ww = this.windows.get(tv.monitorSlot)
        if (ww) this.handleInput(ww, event, input, tv)
      },
      onFocus: (tv) => this.setActiveTile(tv.monitorSlot, tv.tile.id),
      onZoomWheel: (tv, dir) => {
        this.setActiveTile(tv.monitorSlot, tv.tile.id)
        this.actions?.zoomTile(tv.monitorSlot, tv.tile.id, dir)
      },
      onNewTab: (tv, url) => {
        this.setActiveTile(tv.monitorSlot, tv.tile.id)
        this.actions?.openNewTab(tv.monitorSlot, url, tv.tile.id)
      }
    }
  }

  setActions(actions: WallActions): void {
    this.actions = actions
  }

  start(): void {
    this.deps.displays.on('changed', () => void this.sync())
    this.deps.sidecar.on('state', () => {
      if (this.deps.sidecar.state === 'running') {
        for (const ww of this.windows.values()) for (const tv of ww.tiles.values()) tv.retryIfFailed()
      }
    })
    this.metricsTimer = setInterval(() => this.collectMetrics(), 10_000)
  }

  get activePreset(): Preset | null {
    return this.preset
  }

  statusSnapshot(): Record<string, TileStatus> {
    return Object.fromEntries(this.statuses)
  }

  /** Terapkan preset ke semua monitor wall (hanya tile yang berubah yang dimuat ulang). */
  apply(preset: Preset): Promise<void> {
    this.preset = preset
    return this.sync()
  }

  /** Sinkronkan ulang tanpa mengganti preset (dipakai saat monitor berubah, kredensial atau pengaturan diganti). */
  sync(): Promise<void> {
    this.queue = this.queue.then(() => this.doSync()).catch((err) => log.error('sync gagal', err))
    return this.queue
  }

  /** Pengaturan berubah: pin, Mode Atur/Tampil, sertifikat global (tile dibuat ulang lewat sync). */
  onSettingsChanged(): Promise<void> {
    const pinned = this.deps.getSettings().wall.pinned
    for (const ww of this.windows.values()) if (!ww.win.isDestroyed()) ww.win.setAlwaysOnTop(pinned)
    return this.sync().then(() => this.notifyUi())
  }

  /**
   * Munculkan semua jendela wall di depan jendela lain (tombol "Tampilkan wall" / Ctrl+Alt+W).
   * Penting di satu monitor, tempat Operator dan aplikasi lain berbagi layar dengan wall.
   */
  showWalls(focus = true): void {
    const list = [...this.windows.values()].filter((ww) => !ww.win.isDestroyed()).sort((a, b) => b.slot - a.slot)
    for (const ww of list) {
      if (ww.win.isMinimized()) ww.win.restore()
      ww.win.show()
      if (!flags.windowed && !ww.win.isFullScreen()) ww.win.setFullScreen(true)
      ww.win.moveTop()
    }
    // Fokus ke monitor 1 supaya shortcut wall (Ctrl+E, F11, ...) langsung berlaku.
    const first = list.at(-1)
    if (focus && first) {
      first.win.focus()
      first.ui.focus()
    }
  }

  /** Cuplikan JPEG kecil dari semua panel yang sedang terlihat. Hasil dipakai bersama selama beberapa detik. */
  captureThumbnails(): Promise<Thumbnails> {
    if (this.thumbCache && Date.now() - this.thumbCache.at < THUMB_TTL_MS) return Promise.resolve(this.thumbCache.data)
    this.thumbPending ??= this.doCaptureThumbnails().finally(() => {
      this.thumbPending = null
    })
    return this.thumbPending
  }

  /** Cari panel di semua monitor. */
  findTile(tileId: string): TileView | null {
    for (const ww of this.windows.values()) {
      const tv = ww.tiles.get(tileId)
      if (tv) return tv
    }
    return null
  }

  reloadTile(tileId: string): boolean {
    const tv = this.findTile(tileId)
    tv?.reload('diminta operator')
    return tv !== null
  }

  // ---------------------------------------------------------------- API untuk UI wall (per monitor)

  reloadTileInSlot(slot: number, tileId: string): Result {
    const tv = this.windows.get(slot)?.tiles.get(tileId)
    if (!tv) return { ok: false, error: 'Panel kosong atau tidak ada di monitor ini' }
    tv.refresh()
    return { ok: true }
  }

  tileNav(slot: number, tileId: string, action: TileNavAction): Result {
    const tv = this.windows.get(slot)?.tiles.get(tileId)
    if (!tv || tv.tile.source.type !== 'web') return { ok: false, error: 'Navigasi hanya untuk panel halaman web' }
    switch (action) {
      case 'back':
      case 'forward':
        return tv.navigate(action) ? { ok: true } : { ok: false, error: action === 'back' ? 'Tidak ada halaman sebelumnya' : 'Tidak ada halaman berikutnya' }
      case 'home':
        tv.goHome()
        return { ok: true }
      case 'newPanel': {
        const url = tv.pageUrl || tv.tile.source.url
        if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Halaman ini tidak bisa dibuka di panel baru' }
        this.actions?.openNewTab(slot, url, tileId)
        return { ok: true }
      }
    }
  }

  setPanelFullscreen(slot: number, tileId: string | null): Result {
    const ww = this.windows.get(slot)
    if (!ww) return { ok: false, error: 'Monitor tidak aktif' }
    if (tileId !== null && !ww.tiles.has(tileId)) return { ok: false, error: 'Panel kosong tidak bisa layar penuh' }
    ww.panelFullscreen = tileId
    if (tileId) ww.activeTileId = tileId
    this.applyBounds(ww)
    if (tileId) ww.tiles.get(tileId)?.focus()
    this.notifyUi()
    return { ok: true }
  }

  setWindowFullscreen(slot: number, on?: boolean): Result {
    const ww = this.windows.get(slot)
    if (!ww || ww.win.isDestroyed()) return { ok: false, error: 'Monitor tidak aktif' }
    ww.win.setFullScreen(on ?? !ww.win.isFullScreen())
    return { ok: true }
  }

  setOverlay(slot: number, on: boolean): void {
    const ww = this.windows.get(slot)
    if (!ww || ww.overlay === on) return
    ww.overlay = on
    this.restack(ww)
  }

  setActiveTile(slot: number, tileId: string | null): void {
    const ww = this.windows.get(slot)
    if (!ww || ww.activeTileId === tileId) return
    if (tileId !== null && !this.monitorFor(slot)?.tiles.some((t) => t.id === tileId)) return
    ww.activeTileId = tileId
    this.notifyUi()
  }

  sendCommand(slot: number, cmd: WallCommand): void {
    this.windows.get(slot)?.ui.send(IPC.wallCommand, cmd)
  }

  uiState(slot: number): WallUiState | null {
    const ww = this.windows.get(slot)
    return ww ? this.buildUiState(ww) : null
  }

  /**
   * Sinkronkan visibilitas + bounds semua tile (semua jendela wall) dengan state banner darurat:
   * - mode cover → SEMUA tile di-hide (banner menutupi seluruh wall);
   * - mode strip → tile tetap terlihat, tapi bergeser turun setinggi strip (banner di atas).
   * Ganti mode saat banner aktif (cover↔strip) juga berfungsi: BannerController.set selalu
   * memicu onChange, dan applyBounds menghitung ulang visibilitas + bounds.
   * Tile adalah WebContentsView native di atas DOM, jadi z-index CSS tak bisa menang —
   * hide harus dari main. Dipanggil sinkron dari BannerController.onChange, bukan lewat
   * notifyUi (yang debounced), supaya tidak ada frame tile terlihat di atas banner.
   */
  syncBannerVisibility(): void {
    for (const ww of this.windows.values()) this.applyBounds(ww)
  }

  /** Kirim state terbaru ke UI semua jendela wall (dibatasi ~10x per detik). */
  notifyUi(): void {
    if (this.uiTimer) return
    this.uiTimer = setTimeout(() => {
      this.uiTimer = null
      for (const ww of this.windows.values()) ww.ui.send(IPC.wallState, this.buildUiState(ww))
    }, 100)
  }

  async shutdown(): Promise<void> {
    if (this.metricsTimer) clearInterval(this.metricsTimer)
    if (this.uiTimer) clearTimeout(this.uiTimer)
    await this.queue.catch(() => undefined)
    for (const ww of [...this.windows.values()]) this.closeWindow(ww)
  }

  // ---------------------------------------------------------------- internal

  private async doCaptureThumbnails(): Promise<Thumbnails> {
    const out: Thumbnails = {}
    const jobs: Promise<void>[] = []
    for (const ww of this.windows.values()) {
      if (ww.win.isDestroyed() || ww.win.isMinimized()) continue
      for (const tv of ww.tiles.values()) {
        const wc = tv.view.webContents
        if (wc.isDestroyed() || !tv.view.getVisible()) continue
        jobs.push(
          wc
            .capturePage()
            .then((img) => {
              if (img.isEmpty()) return
              const small = img.getSize().width > THUMB_WIDTH ? img.resize({ width: THUMB_WIDTH, quality: 'good' }) : img
              out[tv.tile.id] = `data:image/jpeg;base64,${small.toJPEG(60).toString('base64')}`
            })
            .catch(() => undefined)
        )
      }
    }
    await Promise.all(jobs)
    // Hasil kosong (panel baru mulai dimuat) tidak disimpan supaya permintaan berikutnya langsung mencoba lagi.
    this.thumbCache = Object.keys(out).length > 0 ? { at: Date.now(), data: out } : null
    return out
  }

  private buildUiState(ww: WallWindow): WallUiState {
    const settings = this.deps.getSettings()
    const monitor = this.monitorFor(ww.slot)
    const tileStatus: Record<string, TileStatus> = {}
    for (const t of monitor?.tiles ?? []) {
      const s = this.statuses.get(t.id)
      if (s) tileStatus[t.id] = s
    }
    return {
      slot: ww.slot,
      monitor,
      activePresetId: this.preset?.id ?? null,
      activePresetName: this.preset?.name ?? '',
      tileStatus,
      wall: settings.wall,
      activeTileId: ww.activeTileId,
      panelFullscreenTileId: ww.panelFullscreen,
      windowFullscreen: !ww.win.isDestroyed() && ww.win.isFullScreen(),
      windowed: flags.windowed,
      banner: this.deps.banner(),
      ...this.deps.uiExtras()
    }
  }

  private handleInput(ww: WallWindow, event: Event, input: Input, tv?: TileView): void {
    const action = matchShortcut(input, { panelFullscreen: ww.panelFullscreen !== null })
    if (!action) return
    // Esc saat halaman sedang fullscreen HTML milik halaman itu (Electron yang menanganinya).
    if (action.type === 'exitPanelFullscreen' && tv?.htmlFullscreen) return
    event.preventDefault()
    if (input.isAutoRepeat && action.type !== 'zoom') return
    if (tv) this.setActiveTile(ww.slot, tv.tile.id)
    this.runAction(ww, action)
  }

  private runAction(ww: WallWindow, action: WallAction): void {
    const target = ww.activeTileId ?? this.monitorFor(ww.slot)?.tiles[0]?.id ?? null
    switch (action.type) {
      case 'toggleDisplayMode':
        this.actions?.toggleDisplayMode()
        return
      case 'panelFullscreen':
        if (ww.panelFullscreen) this.setPanelFullscreen(ww.slot, null)
        else if (target) this.setPanelFullscreen(ww.slot, target)
        return
      case 'exitPanelFullscreen':
        this.setPanelFullscreen(ww.slot, null)
        return
      case 'windowFullscreen':
        this.setWindowFullscreen(ww.slot)
        return
      case 'reload':
        if (target) ww.tiles.get(target)?.refresh()
        return
      case 'nav': {
        if (!target) return
        const res = this.tileNav(ww.slot, target, action.action)
        // Panel non-web diam saja; pesan hanya bila riwayat memang kosong.
        if (!res.ok && ww.tiles.get(target)?.tile.source.type === 'web') {
          this.sendCommand(ww.slot, { type: 'notice', kind: 'warn', text: res.error })
        }
        return
      }
      case 'focusUrl':
        if (!target) return
        if (ww.panelFullscreen) this.setPanelFullscreen(ww.slot, null)
        if (this.deps.getSettings().wall.displayMode) this.actions?.toggleDisplayMode()
        ww.activeTileId = target
        ww.ui.focus()
        this.sendCommand(ww.slot, { type: 'focusUrl', tileId: target })
        this.notifyUi()
        return
      case 'zoom':
        if (target) this.actions?.zoomTile(ww.slot, target, action.dir)
        return
      case 'nextTile': {
        const ids = [...(this.monitorFor(ww.slot)?.tiles ?? [])].sort((a, b) => a.y - b.y || a.x - b.x).map((t) => t.id)
        if (ids.length === 0) return
        const next = ids[(ids.indexOf(target ?? '') + 1) % ids.length] ?? ids[0]!
        ww.activeTileId = next
        const tv = ww.tiles.get(next)
        if (tv) tv.focus()
        else ww.ui.focus()
        this.notifyUi()
        return
      }
      case 'preset':
        this.actions?.activatePresetIndex(action.index)
        return
      case 'toggleRotation':
        this.actions?.toggleRotation()
        return
    }
  }

  private async doSync(): Promise<void> {
    const wallDisplays = this.deps.displays.wallDisplays()
    const wantedSlots = new Set(wallDisplays.map((d) => d.slot as number))

    for (const ww of [...this.windows.values()]) {
      if (!wantedSlots.has(ww.slot)) this.closeWindow(ww)
    }

    // Path MediaMTX harus terdaftar SEBELUM tile video dimuat.
    await this.syncSidecarPaths(wantedSlots)

    for (const display of wallDisplays) {
      const slot = display.slot as number
      let ww = this.windows.get(slot)
      if (!ww) ww = this.createWindow(display)
      else this.repositionWindow(ww, display)
      this.layoutTiles(ww)
    }
    this.deps.onChange()
    this.notifyUi()
  }

  private monitorFor(slot: number): MonitorLayout | null {
    return this.preset?.monitors.find((m) => m.slot === slot) ?? null
  }

  private createWindow(display: DisplayInfo): WallWindow {
    const slot = display.slot as number
    const b = display.bounds
    const windowed = flags.windowed
    const win = new BaseWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      show: false,
      frame: windowed,
      // Selalu true: di Windows dengan skala layar pecahan (mis. 125%), jendela tanpa bingkai yang
      // resizable:false menjadi LEBIH BESAR dari layar saat fullscreen (1553x873 di layar 1536x864),
      // sehingga tepi kanan/bawah wall terpotong. Jendela kiosk tanpa bingkai tetap tidak bisa di-resize pengguna.
      resizable: true,
      movable: windowed,
      minimizable: windowed,
      maximizable: windowed,
      closable: windowed,
      // Juga di mode windowed: F10 / tombol "Layar penuh" menghilangkan title bar.
      fullscreenable: true,
      // Selalu tampil di taskbar: di satu monitor, wall yang tertutup jendela lain harus bisa dimunculkan lagi.
      skipTaskbar: false,
      autoHideMenuBar: true,
      backgroundColor: this.monitorFor(slot)?.background ?? '#000000',
      title: `Video Wall - Monitor ${slot + 1}`
    })
    let ww: WallWindow
    const ui = new WallUiView(slot, {
      onInput: (event, input) => this.handleInput(ww, event, input),
      onReady: () => {
        // UI baru dimuat (atau pulih dari crash): kembalikan lapisan normal dan kirim state lengkap.
        ww.overlay = false
        this.restack(ww)
        ww.ui.send(IPC.wallState, this.buildUiState(ww))
      }
    })
    win.contentView.addChildView(ui.view)
    ww = {
      slot,
      displayId: display.id,
      bounds: { ...b },
      win,
      ui,
      tiles: new Map(),
      relayoutTimer: null,
      closing: false,
      activeTileId: null,
      panelFullscreen: null,
      overlay: false
    }
    this.windows.set(slot, ww)
    win.setAlwaysOnTop(this.deps.getSettings().wall.pinned)

    const relayout = (): void => {
      if (ww.relayoutTimer) clearTimeout(ww.relayoutTimer)
      ww.relayoutTimer = setTimeout(() => {
        this.applyBounds(ww)
        this.notifyUi()
      }, 100)
    }
    // Tombol back/forward mouse (Windows): navigasi panel aktif seperti di browser.
    win.on('app-command', (_event, command) => {
      if (command === 'browser-backward') this.runAction(ww, { type: 'nav', action: 'back' })
      else if (command === 'browser-forward') this.runAction(ww, { type: 'nav', action: 'forward' })
    })
    win.on('resize', relayout)
    win.on('enter-full-screen', relayout)
    win.on('leave-full-screen', relayout)
    win.on('closed', () => {
      if (ww.relayoutTimer) clearTimeout(ww.relayoutTimer)
      if (!ww.closing) {
        // Operator menutup window wall (mode windowed): bersihkan tile dan lupakan window ini.
        for (const tv of ww.tiles.values()) this.releaseTile(tv)
        ww.tiles.clear()
        ww.ui.destroy()
        this.windows.delete(slot)
      }
    })

    win.show()
    if (!windowed) win.setFullScreen(true)
    return ww
  }

  private repositionWindow(ww: WallWindow, display: DisplayInfo): void {
    if (flags.windowed) return // jendela dev boleh digeser bebas oleh pengguna
    const b = display.bounds
    const changed =
      ww.displayId !== display.id ||
      ww.bounds.x !== b.x ||
      ww.bounds.y !== b.y ||
      ww.bounds.width !== b.width ||
      ww.bounds.height !== b.height
    if (!changed) return
    ww.displayId = display.id
    ww.bounds = { ...b }
    ww.win.setFullScreen(false)
    ww.win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height })
    ww.win.setFullScreen(true)
  }

  private layoutTiles(ww: WallWindow): void {
    const monitor = this.monitorFor(ww.slot)
    ww.win.setBackgroundColor(monitor?.background ?? '#000000')
    const globalIgnore = this.deps.getSettings().ignoreCertErrorsAll

    const desired = new Map<string, Tile>()
    for (const t of monitor?.tiles ?? []) if (t.source.type !== 'empty' && !isNativeSource(t.source)) desired.set(t.id, t)

    // Hapus tile yang hilang atau yang perlu dibuat ulang (URL/jenis/sertifikat berubah);
    // perubahan ringan (zoom, refresh otomatis, label) diterapkan langsung tanpa memuat ulang.
    for (const [id, tv] of [...ww.tiles]) {
      const next = desired.get(id)
      if (!next || tv.hardKey !== tileHardKey(next.source, globalIgnore)) {
        ww.win.contentView.removeChildView(tv.view)
        this.releaseTile(tv)
        ww.tiles.delete(id)
      } else {
        tv.update(next)
      }
    }
    // Tambah tile baru.
    for (const [id, tile] of desired) {
      if (ww.tiles.has(id)) continue
      const tv = new TileView(tile, ww.slot, this.tileCtx)
      tv.hardKey = tileHardKey(tile.source, globalIgnore)
      ww.tiles.set(id, tv)
      ww.win.contentView.addChildView(tv.view)
      tv.setBounds({ x: 0, y: 0, width: 1, height: 1 })
      tv.start()
      // Tile baru/recreate saat banner aktif harus langsung hidden (jangan flash terlihat).
      this.applyVisibility(tv)
    }

    const ids = new Set(monitor?.tiles.map((t) => t.id) ?? [])
    if (ww.panelFullscreen && !ww.tiles.has(ww.panelFullscreen)) ww.panelFullscreen = null
    if (ww.activeTileId && !ids.has(ww.activeTileId)) ww.activeTileId = null
    this.applyBounds(ww)
  }

  /** Hitung ulang posisi piksel lapisan UI dan semua tile berdasarkan ukuran isi window saat ini. */
  private applyBounds(ww: WallWindow): void {
    if (ww.win.isDestroyed()) return
    const [width = 0, height = 0] = ww.win.getContentSize()
    ww.ui.view.setBounds({ x: 0, y: 0, width, height })
    const monitor = this.monitorFor(ww.slot)
    if (monitor) {
      const edit = !this.deps.getSettings().wall.displayMode
      // Banner mode strip: tile menggeser turun setinggi strip agar tidak menumpuk di atasnya.
      const banner = this.deps.banner()
      const stripInset = banner !== null && banner.banner.mode === 'strip' ? stripHeight({ width, height }) : 0
      for (const tile of monitor.tiles) {
        const tv = ww.tiles.get(tile.id)
        if (!tv) continue
        tv.setBounds(
          ww.panelFullscreen === tile.id
            ? { x: 0, y: stripInset, width, height: Math.max(1, height - stripInset) }
            : panelGeometry(tile, monitor, { width, height }, edit, stripInset).body
        )
        this.applyVisibility(tv)
      }
    }
    this.restack(ww)
  }

  private applyVisibility(tv: TileView): void {
    const state = this.statuses.get(tv.tile.id)?.state
    const banner = this.deps.banner()
    // Mode cover: banner fullscreen menutupi wall → SEMUA tile di-hide (WebContentsView native
    // tak bisa ditutup z-index CSS, jadi disembunyikan dari main).
    // Mode strip: banner hanya strip di atas (DOM) → tile tetap visible, posisi di bawah strip
    // diatur lewat inset pada applyBounds.
    const bannerCovers = banner !== null && banner.banner.mode !== 'strip'
    tv.view.setVisible(!(bannerCovers || (state && HIDDEN_STATES.has(state))))
  }

  /**
   * Urutan lapisan. addChildView pada view yang sudah ada memindahkannya ke paling atas, jadi urutan
   * dibangun dari bawah: (UI) -> tile -> tile layar penuh -> (UI bila overlay).
   */
  private restack(ww: WallWindow): void {
    if (ww.win.isDestroyed()) return
    const cv = ww.win.contentView
    for (const [id, tv] of ww.tiles) if (id !== ww.panelFullscreen) cv.addChildView(tv.view)
    const full = ww.panelFullscreen ? ww.tiles.get(ww.panelFullscreen) : undefined
    if (full) cv.addChildView(full.view)
    if (ww.overlay) cv.addChildView(ww.ui.view)
  }

  private releaseTile(tv: TileView): void {
    this.statuses.delete(tv.tile.id)
    tv.destroy()
  }

  private closeWindow(ww: WallWindow): void {
    ww.closing = true
    if (ww.relayoutTimer) clearTimeout(ww.relayoutTimer)
    for (const tv of ww.tiles.values()) {
      if (!ww.win.isDestroyed()) ww.win.contentView.removeChildView(tv.view)
      this.releaseTile(tv)
    }
    ww.tiles.clear()
    if (!ww.win.isDestroyed()) ww.win.contentView.removeChildView(ww.ui.view)
    ww.ui.destroy()
    this.windows.delete(ww.slot)
    if (!ww.win.isDestroyed()) ww.win.destroy()
  }

  private async resolveVideo(tile: Tile): Promise<VideoTileConfig | null> {
    const src = tile.source
    const stallSeconds = this.deps.getSettings().videoStallSeconds
    switch (src.type) {
      case 'hls':
        return { tileId: tile.id, kind: 'hls', playUrl: src.url, stallSeconds }
      case 'whep':
        return { tileId: tile.id, kind: 'whep', playUrl: src.url, stallSeconds }
      case 'mjpeg':
        return { tileId: tile.id, kind: 'mjpeg', playUrl: src.url, stallSeconds }
      case 'rtsp': {
        if (this.deps.sidecar.state !== 'running') return null
        const name = mediaPathName(tile.id)
        const ep = this.deps.sidecar.endpoints()
        return {
          tileId: tile.id,
          kind: 'whep',
          playUrl: `${ep.webrtc}/${name}/whep`,
          fallbackHlsUrl: `${ep.hls}/${name}/index.m3u8`,
          stallSeconds
        }
      }
      default:
        return null
    }
  }

  /** Daftarkan semua tile RTSP pada monitor aktif ke MediaMTX (kredensial dari vault). */
  private async syncSidecarPaths(wantedSlots: Set<number>): Promise<void> {
    const desired = new Map<string, PathSpec>()
    for (const monitor of this.preset?.monitors ?? []) {
      if (!wantedSlots.has(monitor.slot)) continue
      for (const tile of monitor.tiles) {
        if (tile.source.type !== 'rtsp') continue
        const password = tile.source.username ? await this.deps.vault.get(tile.id) : null
        desired.set(mediaPathName(tile.id), {
          source: withCredentials(tile.source.url, tile.source.username, password),
          transport: tile.source.transport
        })
      }
    }
    await this.deps.sidecar.setPaths(desired)
  }

  private collectMetrics(): void {
    const byPid = new Map(app.getAppMetrics().map((m) => [m.pid, m]))
    const rows: MetricsRow[] = []
    for (const ww of this.windows.values()) {
      for (const tv of ww.tiles.values()) {
        const wc = tv.view.webContents
        if (wc.isDestroyed()) continue
        const metric = byPid.get(wc.getOSProcessId())
        if (metric) tv.updateMetrics(metric.memory.workingSetSize / 1024, metric.cpu.percentCPUUsage)
        const s = tv.currentStatus
        rows.push({
          slot: ww.slot,
          tileId: tv.tile.id,
          type: tv.tile.source.type,
          state: s.state,
          memoryMB: s.memoryMB,
          cpuPercent: s.cpuPercent,
          restarts: s.restarts
        })
      }
    }
    void appendMetrics(rows)
    this.deps.onChange()
  }
}
