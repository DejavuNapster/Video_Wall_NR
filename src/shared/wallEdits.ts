import { z } from 'zod'
import { addTile, removeTile } from './editor'
import { MAX_GRID, SourceSchema } from './schema'
import { overlapsAny } from './snap'
import { applyTemplate, TEMPLATE_IDS } from './templates'
import { isNativeSource } from './native'
import type { EditResult, MonitorLayout, Preset, Source, Tile } from './types'

/** Faktor kehalusan Mode Bebas: grid monitor dikali 8. */
export const FREE_FACTOR = 8

const tileId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)
const int = z.number().int()

/** Operasi edit dari jendela wall. Monitor TIDAK ada di payload: main mengambilnya dari jendela pengirim. */
export const WallEditSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('setSource'), tileId, input: z.string().max(2048) }),
  /** Sumber lengkap (dari Inspector Operator): jenis dipilih eksplisit, tanpa deteksi URL. */
  z.object({ op: z.literal('setSourceConfig'), tileId, source: SourceSchema }),
  z.object({ op: z.literal('setLabel'), tileId, label: z.string().max(80) }),
  z.object({ op: z.literal('setZoom'), tileId, zoom: z.number().min(0.25).max(5) }),
  z.object({ op: z.literal('setReloadMinutes'), tileId, minutes: int.min(0).max(10080) }),
  z.object({ op: z.literal('setIgnoreCert'), tileId, value: z.boolean() }),
  z.object({ op: z.literal('removeTile'), tileId }),
  /** `near`: panel yang dibelah dua bila monitor penuh (panel aktif / panel asal tab baru). */
  z.object({ op: z.literal('addTile'), near: tileId.optional() }),
  z.object({ op: z.literal('moveResize'), tileId, x: int.min(0), y: int.min(0), w: int.min(1), h: int.min(1) }),
  z.object({ op: z.literal('setLayoutMode'), mode: z.enum(['grid', 'free']) }),
  z.object({ op: z.literal('setBezel'), cols: int.min(1).max(8), rows: int.min(1).max(8) }),
  z.object({ op: z.literal('applyTemplate'), template: z.enum(TEMPLATE_IDS) })
])

export type WallEdit = z.infer<typeof WallEditSchema>
/** Operasi yang bisa diterapkan langsung (setSource/setSourceConfig perlu deteksi URL + vault di main dulu). */
export type PanelEdit = Exclude<WallEdit, { op: 'setSource' | 'setSourceConfig' }>

const NOT_FOUND = { ok: false, error: 'Panel tidak ditemukan di monitor ini' } as const

function monitorOf(preset: Preset, slot: number): MonitorLayout | undefined {
  return preset.monitors.find((m) => m.slot === slot)
}

function tileIn(preset: Preset, slot: number, id: string): Tile | undefined {
  return monitorOf(preset, slot)?.tiles.find((t) => t.id === id)
}

function withMonitor(preset: Preset, slot: number, fn: (m: MonitorLayout) => MonitorLayout): Preset {
  return { ...preset, monitors: preset.monitors.map((m) => (m.slot === slot ? fn(m) : m)) }
}

function withTile(preset: Preset, slot: number, id: string, fn: (t: Tile) => Tile): Preset {
  return withMonitor(preset, slot, (m) => ({ ...m, tiles: m.tiles.map((t) => (t.id === id ? fn(t) : t)) }))
}

export function setTileSource(preset: Preset, slot: number, id: string, source: Source): EditResult {
  if (!tileIn(preset, slot, id)) return NOT_FOUND
  return { ok: true, preset: withTile(preset, slot, id, (t) => ({ ...t, source })) }
}

function hasOverlap(tiles: readonly Tile[]): boolean {
  return tiles.some((a, i) => overlapsAny(a, tiles.slice(i + 1)))
}

function changeLayoutMode(preset: Preset, slot: number, mode: 'grid' | 'free'): EditResult {
  const m = monitorOf(preset, slot)
  if (!m) return { ok: false, error: 'Monitor tidak dikenal' }
  if (m.layoutMode === mode) return { ok: true, preset }

  if (mode === 'free') {
    if (m.cols * FREE_FACTOR > MAX_GRID || m.rows * FREE_FACTOR > MAX_GRID) {
      return { ok: false, error: `Grid terlalu besar untuk Mode Bebas (maks ${MAX_GRID / FREE_FACTOR} kolom/baris)` }
    }
    const f = FREE_FACTOR
    return {
      ok: true,
      preset: withMonitor(preset, slot, () => ({
        ...m,
        layoutMode: 'free',
        cols: m.cols * f,
        rows: m.rows * f,
        tiles: m.tiles.map((t) => ({ ...t, x: t.x * f, y: t.y * f, w: t.w * f, h: t.h * f }))
      }))
    }
  }

  // Bebas -> Grid: bulatkan TEPI (bukan lebar) supaya panel bersebelahan tetap bersebelahan.
  const cols = Math.max(1, Math.round(m.cols / FREE_FACTOR))
  const rows = Math.max(1, Math.round(m.rows / FREE_FACTOR))
  const edge = (v: number, max: number): number => Math.min(max, Math.round(v / FREE_FACTOR))
  const tiles = m.tiles.map((t) => {
    const x = Math.min(edge(t.x, cols), cols - 1)
    const y = Math.min(edge(t.y, rows), rows - 1)
    return { ...t, x, y, w: Math.max(1, edge(t.x + t.w, cols) - x), h: Math.max(1, edge(t.y + t.h, rows) - y) }
  })
  if (hasOverlap(tiles)) {
    return { ok: false, error: 'Tidak bisa kembali ke Grid: ada panel yang akan bertumpuk. Rapikan panel dulu.' }
  }
  return { ok: true, preset: withMonitor(preset, slot, () => ({ ...m, layoutMode: 'grid', cols, rows, tiles })) }
}

export function applyWallEdit(preset: Preset, slot: number, edit: PanelEdit): EditResult {
  switch (edit.op) {
    case 'setZoom':
    case 'setReloadMinutes': {
      const tile = tileIn(preset, slot, edit.tileId)
      if (!tile) return NOT_FOUND
      if (tile.source.type !== 'web') return { ok: false, error: 'Zoom dan refresh otomatis hanya untuk halaman web' }
      const src = tile.source
      const next =
        edit.op === 'setZoom' ? { ...src, zoom: Math.round(edit.zoom * 100) / 100 } : { ...src, reloadMinutes: edit.minutes }
      return { ok: true, preset: withTile(preset, slot, edit.tileId, (t) => ({ ...t, source: next })) }
    }
    case 'setIgnoreCert': {
      const tile = tileIn(preset, slot, edit.tileId)
      if (!tile) return NOT_FOUND
      const src = tile.source
      if (src.type === 'empty' || src.type === 'rtsp' || isNativeSource(src)) {
        return { ok: false, error: 'Opsi sertifikat hanya untuk sumber http(s)' }
      }
      const { ignoreCertErrors: _drop, ...rest } = src
      const next = (edit.value ? { ...rest, ignoreCertErrors: true } : rest) as Source
      return { ok: true, preset: withTile(preset, slot, edit.tileId, (t) => ({ ...t, source: next })) }
    }
    case 'setLabel':
      if (!tileIn(preset, slot, edit.tileId)) return NOT_FOUND
      return { ok: true, preset: withTile(preset, slot, edit.tileId, (t) => ({ ...t, label: edit.label.trim() })) }
    case 'removeTile':
      if (!tileIn(preset, slot, edit.tileId)) return NOT_FOUND
      return { ok: true, preset: removeTile(preset, edit.tileId) }
    case 'addTile': {
      if (!monitorOf(preset, slot)) return { ok: false, error: 'Monitor tidak dikenal' }
      const res = addTile(preset, slot, edit.near)
      if (!res.tileId) {
        return { ok: false, error: edit.near ? 'Monitor penuh dan panel ini terlalu kecil untuk dibelah.' : 'Monitor penuh. Klik panel yang mau dibelah dua, atau hapus/perkecil panel lain.' }
      }
      return { ok: true, preset: res.preset, tileId: res.tileId }
    }
    case 'moveResize': {
      const m = monitorOf(preset, slot)
      if (!m || !tileIn(preset, slot, edit.tileId)) return NOT_FOUND
      const rect = { x: edit.x, y: edit.y, w: edit.w, h: edit.h }
      if (rect.x + rect.w > m.cols || rect.y + rect.h > m.rows) return { ok: false, error: 'Panel keluar dari area monitor' }
      if (overlapsAny(rect, m.tiles.filter((t) => t.id !== edit.tileId))) {
        return { ok: false, error: 'Panel bertumpuk dengan panel lain' }
      }
      return { ok: true, preset: withTile(preset, slot, edit.tileId, (t) => ({ ...t, ...rect })) }
    }
    case 'setLayoutMode':
      return changeLayoutMode(preset, slot, edit.mode)
    case 'setBezel':
      if (!monitorOf(preset, slot)) return { ok: false, error: 'Monitor tidak dikenal' }
      return { ok: true, preset: withMonitor(preset, slot, (m) => ({ ...m, bezel: { cols: edit.cols, rows: edit.rows } })) }
    case 'applyTemplate':
      return applyTemplate(preset, slot, edit.template)
  }
}
