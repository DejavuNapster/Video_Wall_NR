import { rectsOverlap } from './snap'
import type { EditResult, MonitorLayout, Preset, Tile } from './types'

export const TEMPLATE_IDS = ['single', 'split-v', 'split-h', 'grid-2', 'grid-3', 'grid-4', 'one-plus-five'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

/** Tepi panel sebagai pecahan monitor: [kiri, atas, kanan, bawah]. Tepi bersama memakai nilai yang sama persis. */
type Edges = readonly [number, number, number, number]

function gridRects(n: number): Edges[] {
  const out: Edges[] = []
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out.push([c / n, r / n, (c + 1) / n, (r + 1) / n])
  return out
}

const T = 1 / 3
const TT = 2 / 3

export const TEMPLATES: ReadonlyArray<{ id: TemplateId; label: string; rects: readonly Edges[] }> = [
  { id: 'single', label: '1 penuh', rects: [[0, 0, 1, 1]] },
  { id: 'split-v', label: '2 kiri-kanan', rects: [[0, 0, 0.5, 1], [0.5, 0, 1, 1]] },
  { id: 'split-h', label: '2 atas-bawah', rects: [[0, 0, 1, 0.5], [0, 0.5, 1, 1]] },
  { id: 'grid-2', label: '2 × 2', rects: gridRects(2) },
  { id: 'grid-3', label: '3 × 3', rects: gridRects(3) },
  { id: 'grid-4', label: '4 × 4', rects: gridRects(4) },
  {
    id: 'one-plus-five',
    label: '1 besar + 5 kecil',
    rects: [
      [0, 0, TT, TT],
      [TT, 0, 1, T],
      [TT, T, 1, TT],
      [0, TT, T, 1],
      [T, TT, TT, 1],
      [TT, TT, 1, 1]
    ]
  }
]

/** Urutan panel yang dipakai template: baris demi baris, kiri ke kanan. */
const readingOrder = (tiles: readonly Tile[]): Tile[] => [...tiles].sort((a, b) => a.y - b.y || a.x - b.x)

/** ID panel yang akan dihapus bila template diterapkan (untuk konfirmasi di UI). */
export function templateRemovals(monitor: MonitorLayout, id: TemplateId): string[] {
  const count = TEMPLATES.find((t) => t.id === id)?.rects.length ?? 0
  return readingOrder(monitor.tiles)
    .slice(count)
    .map((t) => t.id)
}

/** Susun ulang panel monitor sesuai template. URL panel lama dipertahankan sesuai urutan. */
export function applyTemplate(preset: Preset, slot: number, id: TemplateId): EditResult {
  const template = TEMPLATES.find((t) => t.id === id)
  const monitor = preset.monitors.find((m) => m.slot === slot)
  if (!template || !monitor) return { ok: false, error: 'Layout atau monitor tidak dikenal' }

  const used = new Set(preset.monitors.flatMap((m) => m.tiles.map((t) => t.id)))
  const freshId = (): string => {
    let n = 1
    while (used.has(`t${n}`)) n++
    used.add(`t${n}`)
    return `t${n}`
  }

  const existing = readingOrder(monitor.tiles)
  const tiles: Tile[] = template.rects.map(([l, t, r, b], i) => {
    const x = Math.round(l * monitor.cols)
    const y = Math.round(t * monitor.rows)
    const geo = { x, y, w: Math.round(r * monitor.cols) - x, h: Math.round(b * monitor.rows) - y }
    const old = existing[i]
    return old ? { ...old, ...geo } : { id: freshId(), label: '', ...geo, source: { type: 'empty' } }
  })

  const broken = tiles.some((t) => t.w < 1 || t.h < 1) || tiles.some((a, i) => tiles.slice(i + 1).some((b) => rectsOverlap(a, b)))
  if (broken) return { ok: false, error: 'Grid monitor terlalu kecil untuk layout ini. Perbesar kolom/baris dulu.' }

  return {
    ok: true,
    preset: { ...preset, monitors: preset.monitors.map((m) => (m.slot === slot ? { ...m, tiles } : m)) }
  }
}
