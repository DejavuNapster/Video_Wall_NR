import { nextTileId } from './layout'
import { SCHEMA_VERSION, SourceSchema } from './schema'
import type { MonitorLayout, Preset, Source, Tile } from './types'

/** Operasi murni (tanpa efek samping) untuk mengedit preset. Semua mengembalikan preset baru. */

export function emptyMonitor(slot: number): MonitorLayout {
  return { slot, cols: 12, rows: 8, gap: 4, background: '#000000', layoutMode: 'grid', bezel: { cols: 1, rows: 1 }, tiles: [] }
}

/** Pastikan ada layout untuk setiap slot 0..count-1 (monitor baru dicolok = layout kosong). */
export function ensureMonitors(preset: Preset, count: number): Preset {
  const have = new Set(preset.monitors.map((m) => m.slot))
  const added: MonitorLayout[] = []
  for (let slot = 0; slot < count; slot++) if (!have.has(slot)) added.push(emptyMonitor(slot))
  if (added.length === 0) return preset
  return { ...preset, monitors: [...preset.monitors, ...added].sort((a, b) => a.slot - b.slot) }
}

function mapMonitor(preset: Preset, slot: number, fn: (m: MonitorLayout) => MonitorLayout): Preset {
  return { ...preset, monitors: preset.monitors.map((m) => (m.slot === slot ? fn(m) : m)) }
}

/** Cari posisi kosong pertama (scan baris demi baris) untuk tile berukuran w x h. */
export function findFreeSpot(
  tiles: readonly Pick<Tile, 'x' | 'y' | 'w' | 'h'>[],
  cols: number,
  rows: number,
  w: number,
  h: number
): { x: number; y: number } | null {
  for (let y = 0; y + h <= rows; y++) {
    for (let x = 0; x + w <= cols; x++) {
      const clash = tiles.some((t) => x < t.x + t.w && t.x < x + w && y < t.y + t.h && t.y < y + h)
      if (!clash) return { x, y }
    }
  }
  return null
}

/**
 * Belah `tile` jadi dua pada sisi terpanjangnya (diukur pada layar 16:9). Separuh pertama tetap milik
 * panel lama, separuh kedua untuk panel baru. null bila panel sudah 1x1 sel.
 */
export function splitRect(
  tile: Pick<Tile, 'x' | 'y' | 'w' | 'h'>,
  cols: number,
  rows: number
): { keep: Pick<Tile, 'x' | 'y' | 'w' | 'h'>; spot: Pick<Tile, 'x' | 'y' | 'w' | 'h'> } | null {
  const wide = (tile.w / cols) * 16 >= (tile.h / rows) * 9
  const byWidth = (): ReturnType<typeof splitRect> => {
    const half = Math.ceil(tile.w / 2)
    return { keep: { ...tile, w: half }, spot: { x: tile.x + half, y: tile.y, w: tile.w - half, h: tile.h } }
  }
  const byHeight = (): ReturnType<typeof splitRect> => {
    const half = Math.ceil(tile.h / 2)
    return { keep: { ...tile, h: half }, spot: { x: tile.x, y: tile.y + half, w: tile.w, h: tile.h - half } }
  }
  if (wide && tile.w >= 2) return byWidth()
  if (tile.h >= 2) return byHeight()
  if (tile.w >= 2) return byWidth()
  return null
}

/**
 * Tambah panel kosong di tempat kosong pertama. Ukuran dicoba dari sepertiga monitor
 * (4x3 sel pada grid 12x8, setara di Mode Bebas) lalu diperkecil sampai muat.
 * Monitor penuh + `nearId`: panel `nearId` dibelah dua dan panel baru mengisi separuhnya
 * (mis. "buka di panel baru" pada wall yang semua selnya terisi).
 */
export function addTile(preset: Preset, slot: number, nearId?: string): { preset: Preset; tileId: string | null } {
  const monitor = preset.monitors.find((m) => m.slot === slot)
  if (!monitor) return { preset, tileId: null }
  const id = nextTileId(preset)
  const scale = monitor.layoutMode === 'free' ? 8 : 1
  const sizes: Array<[number, number]> = [
    [4, 3],
    [3, 2],
    [2, 2],
    [2, 1],
    [1, 1]
  ]
  for (const [rw, rh] of sizes) {
    const w = Math.min(rw * scale, monitor.cols)
    const h = Math.min(rh * scale, monitor.rows)
    const spot = findFreeSpot(monitor.tiles, monitor.cols, monitor.rows, w, h)
    if (spot) {
      const tile: Tile = { id, label: '', ...spot, w, h, source: { type: 'empty' } }
      return { preset: mapMonitor(preset, slot, (m) => ({ ...m, tiles: [...m.tiles, tile] })), tileId: id }
    }
  }
  const near = nearId ? monitor.tiles.find((t) => t.id === nearId) : undefined
  const split = near ? splitRect(near, monitor.cols, monitor.rows) : null
  if (near && split) {
    const tile: Tile = { id, label: '', ...split.spot, source: { type: 'empty' } }
    return {
      preset: mapMonitor(preset, slot, (m) => ({
        ...m,
        tiles: [...m.tiles.map((t) => (t.id === near.id ? { ...t, ...split.keep } : t)), tile]
      })),
      tileId: id
    }
  }
  return { preset, tileId: null } // monitor penuh
}

export function removeTile(preset: Preset, tileId: string): Preset {
  return { ...preset, monitors: preset.monitors.map((m) => ({ ...m, tiles: m.tiles.filter((t) => t.id !== tileId) })) }
}

/** Sumber awal saat jenis sumber diganti di Inspector. */
export function defaultSource(type: Source['type']): Source {
  switch (type) {
    case 'web':
      return { type: 'web', url: 'https://example.com', zoom: 1, reloadMinutes: 0 }
    case 'rtsp':
      return { type: 'rtsp', url: 'rtsp://192.168.1.10:554/stream1', transport: 'auto' }
    case 'hls':
      return { type: 'hls', url: 'https://example.com/live/index.m3u8' }
    case 'whep':
      return { type: 'whep', url: 'http://127.0.0.1:8889/stream/whep' }
    case 'mjpeg':
      return { type: 'mjpeg', url: 'http://192.168.1.20/mjpeg' }
    case 'clock':
      return { type: 'clock', hour24: true, showDate: true, fontSize: 96 }
    case 'ticker':
      // Opsi lain memakai nilai bawaan skema; panel baru langsung bersambung dengan tepi memudar.
      return SourceSchema.parse({ type: 'ticker', text: 'Teks berjalan akan tampil di panel ini', speedSec: 12, continuous: true, fadeEdges: true })
    default:
      return { type: 'empty' }
  }
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'preset'
}

export function uniqueId(base: string, existing: readonly string[]): string {
  if (!existing.includes(base)) return base
  let n = 2
  while (existing.includes(`${base}-${n}`)) n++
  return `${base}-${n}`
}

export function duplicatePreset(preset: Preset, id: string, name: string): Preset {
  return { ...structuredClone(preset), schemaVersion: SCHEMA_VERSION, id, name, updatedAt: new Date().toISOString() }
}
