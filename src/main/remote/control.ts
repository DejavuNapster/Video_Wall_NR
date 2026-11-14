import type { Result, TileNavAction } from '@shared/types'

/** Aksi panel dari kendali jarak jauh (setara tombol bilah panel + shortcut di wall). */
export const TILE_ACTIONS = [
  'back',
  'forward',
  'home',
  'reload',
  'newPanel',
  'fullscreen',
  'zoomIn',
  'zoomOut',
  'zoomReset',
  'prevPage',
  'nextPage'
] as const
export type RemoteTileAction = (typeof TILE_ACTIONS)[number]

/** Aksi satu monitor dari kendali jarak jauh. */
export const MONITOR_ACTIONS = ['show', 'windowFullscreen', 'exitPanelFullscreen', 'reloadAll'] as const
export type RemoteMonitorAction = (typeof MONITOR_ACTIONS)[number]

export interface MonitorView {
  /** Panel yang sedang memenuhi jendela monitor (null = tata letak biasa). */
  panelFullscreenTileId: string | null
  windowFullscreen: boolean
  /** Posisi rotasi halaman per panel yang berotasi (1-based). */
  cyclePositions: Record<string, { index: number; total: number }>
}

/** Bagian WallController yang dipakai kendali jarak jauh (dipisah agar bisa diuji tanpa Electron). */
export interface WallControlTarget {
  slotOfTile(tileId: string): number | null
  monitorView(slot: number): MonitorView | null
  tileNav(slot: number, tileId: string, action: TileNavAction): Result
  reloadTileInSlot(slot: number, tileId: string): Result
  setPanelFullscreen(slot: number, tileId: string | null): Result
  setWindowFullscreen(slot: number, on?: boolean): Result
  stepTilePage(slot: number, tileId: string, dir: 1 | -1): Result
  reloadAllInSlot(slot: number): Result
  showWalls(focus?: boolean): void
}

export interface WallControlDeps {
  wall: WallControlTarget
  zoomTile(slot: number, tileId: string, dir: 'in' | 'out' | 'reset'): Promise<Result>
  /** Ganti URL/sumber panel (deteksi jenis sama seperti kolom URL di wall). */
  setSource(slot: number, tileId: string, input: string): Promise<Result>
  presetIds(): string[]
  activeId(): string | null
  activatePreset(id: string): Promise<Result>
}

const NOT_ON_WALL = { ok: false, error: 'Panel tidak ada di preset yang sedang tampil' } as const

/** Menerjemahkan perintah kendali jarak jauh menjadi aksi wall, seperti yang dilakukan tombol & shortcut di wall. */
export class WallRemoteControl {
  constructor(private readonly d: WallControlDeps) {}

  monitorView(slot: number): MonitorView | null {
    return this.d.wall.monitorView(slot)
  }

  async tile(tileId: string, action: RemoteTileAction): Promise<Result> {
    const { wall } = this.d
    const slot = wall.slotOfTile(tileId)
    if (slot === null) return NOT_ON_WALL
    switch (action) {
      case 'back':
      case 'forward':
      case 'home':
      case 'newPanel':
        return wall.tileNav(slot, tileId, action)
      case 'reload':
        return wall.reloadTileInSlot(slot, tileId)
      case 'fullscreen': {
        const current = wall.monitorView(slot)?.panelFullscreenTileId ?? null
        return wall.setPanelFullscreen(slot, current === tileId ? null : tileId)
      }
      case 'zoomIn':
        return this.d.zoomTile(slot, tileId, 'in')
      case 'zoomOut':
        return this.d.zoomTile(slot, tileId, 'out')
      case 'zoomReset':
        return this.d.zoomTile(slot, tileId, 'reset')
      case 'prevPage':
        return wall.stepTilePage(slot, tileId, -1)
      case 'nextPage':
        return wall.stepTilePage(slot, tileId, 1)
    }
  }

  async setUrl(tileId: string, url: string): Promise<Result> {
    const slot = this.d.wall.slotOfTile(tileId)
    if (slot === null) return NOT_ON_WALL
    const input = url.trim()
    if (!input) return { ok: false, error: 'URL tidak boleh kosong' }
    return this.d.setSource(slot, tileId, input)
  }

  monitor(slot: number, action: RemoteMonitorAction): Result {
    const { wall } = this.d
    if (!wall.monitorView(slot)) return { ok: false, error: `Monitor ${slot + 1} tidak aktif` }
    switch (action) {
      case 'show':
        wall.showWalls()
        return { ok: true }
      case 'windowFullscreen':
        return wall.setWindowFullscreen(slot)
      case 'exitPanelFullscreen':
        return wall.setPanelFullscreen(slot, null)
      case 'reloadAll':
        return wall.reloadAllInSlot(slot)
    }
  }

  /** Preset sebelumnya/berikutnya dalam urutan daftar preset (berputar). */
  async stepPreset(dir: 1 | -1): Promise<Result> {
    const ids = this.d.presetIds()
    if (ids.length < 2) return { ok: false, error: 'Hanya ada satu preset' }
    const cur = ids.indexOf(this.d.activeId() ?? '')
    const next = cur < 0 ? ids[0]! : ids[(cur + dir + ids.length) % ids.length]!
    return this.d.activatePreset(next)
  }
}
