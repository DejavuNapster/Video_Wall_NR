import { PresetSchema, SCHEMA_VERSION } from './schema'
import type { DisplayInfo, MonitorLayout, Preset, Rect, Tile } from './types'

/**
 * Hitung posisi piksel sebuah tile di dalam window monitor (koordinat relatif ke window).
 * Tepi kiri/kanan dihitung dari posisi grid yang dibulatkan sehingga tile bersebelahan
 * tidak meninggalkan celah 1 px karena pembulatan.
 */
export function tileToBounds(
  tile: Pick<Tile, 'x' | 'y' | 'w' | 'h'>,
  monitor: Pick<MonitorLayout, 'cols' | 'rows' | 'gap'>,
  size: { width: number; height: number }
): Rect {
  const { cols, rows, gap } = monitor
  const cellW = (size.width - gap * (cols + 1)) / cols
  const cellH = (size.height - gap * (rows + 1)) / rows
  const left = Math.round(gap + tile.x * (cellW + gap))
  const top = Math.round(gap + tile.y * (cellH + gap))
  const right = Math.round(gap + (tile.x + tile.w) * (cellW + gap) - gap)
  const bottom = Math.round(gap + (tile.y + tile.h) * (cellH + gap) - gap)
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  }
}

/** Urutkan monitor kiri->kanan lalu atas->bawah supaya slot stabil dan mudah dipahami operator. */
export function sortDisplays<T extends { bounds: Rect; id: number }>(displays: readonly T[]): T[] {
  return [...displays].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y || a.id - b.id)
}

/**
 * Tentukan display mana yang dipakai wall dan beri nomor slot.
 * Bila `excludePrimary` true dan ada lebih dari satu display, display utama dikosongkan untuk operator.
 */
export function assignWallSlots(
  displays: readonly Omit<DisplayInfo, 'slot'>[],
  excludePrimary: boolean | undefined
): DisplayInfo[] {
  const exclude = excludePrimary ?? displays.length > 1
  const sorted = sortDisplays(displays)
  let slot = 0
  return sorted.map((d) => {
    const usedByOperator = exclude && d.primary && displays.length > 1
    return { ...d, slot: usedByOperator ? null : slot++ }
  })
}

/** Pasangan ID tile yang saling tumpang tindih (untuk peringatan di UI). */
export function findOverlaps(tiles: readonly Tile[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i]!
      const b = tiles[j]!
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
      if (overlap) out.push([a.id, b.id])
    }
  }
  return out
}

/** ID tile berikutnya yang belum dipakai pada preset: t1, t2, ... */
export function nextTileId(preset: Pick<Preset, 'monitors'>): string {
  const used = new Set(preset.monitors.flatMap((m) => m.tiles.map((t) => t.id)))
  let n = 1
  while (used.has(`t${n}`)) n++
  return `t${n}`
}

/** Preset awal: tiap monitor berisi grid 2x2 tile kosong. */
export function createDefaultPreset(slotCount: number, id = 'default', name = 'Preset Baru'): Preset {
  const count = Math.max(1, slotCount)
  const monitors: MonitorLayout[] = []
  let n = 1
  for (let slot = 0; slot < count; slot++) {
    const tiles: Tile[] = []
    for (const [x, y] of [
      [0, 0],
      [6, 0],
      [0, 4],
      [6, 4]
    ] as const) {
      tiles.push({ id: `t${n++}`, label: '', x, y, w: 6, h: 4, source: { type: 'empty' } })
    }
    monitors.push({ slot, cols: 12, rows: 8, gap: 4, background: '#000000', layoutMode: 'grid', bezel: { cols: 1, rows: 1 }, tiles })
  }
  return { schemaVersion: SCHEMA_VERSION, id, name, updatedAt: new Date().toISOString(), monitors }
}

export type ParseResult = { ok: true; preset: Preset } | { ok: false; error: string }

/** Validasi + migrasi data preset dari sumber tak tepercaya (file, impor, IPC). */
export function parsePreset(raw: unknown): ParseResult {
  const parsed = PresetSchema.safeParse(raw)
  if (parsed.success) return { ok: true, preset: parsed.data }
  const issue = parsed.error.issues[0]
  const where = issue && issue.path.length > 0 ? ` (${issue.path.join('.')})` : ''
  return { ok: false, error: `${issue?.message ?? 'Preset tidak valid'}${where}` }
}
