import { overlapsAny, snapLines, snapRect, type SnapEdges, type URect } from './snap'
import type { MonitorLayout } from './types'

export type DragKind = 'move' | { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean }

export interface DragInput {
  tileId: string
  kind: DragKind
  /** Posisi panel saat mulai ditarik (unit grid). */
  start: URect
  monitor: Pick<MonitorLayout, 'cols' | 'rows' | 'bezel'> & { tiles: ReadonlyArray<URect & { id: string }> }
  /** Ukuran satu unit grid dalam piksel. */
  unit: { x: number; y: number }
  snap: boolean
  /** Ambang magnet dalam piksel layar. */
  snapPx: number
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/**
 * Posisi baru panel dari gerakan mouse (dx, dy piksel). Magnet dihitung pada posisi PECAHAN sebelum
 * dibulatkan; bila dibulatkan dulu, jarak ke garis selalu >= 1 unit dan magnet tidak pernah aktif.
 */
export function computeDrag(d: DragInput, dx: number, dy: number): { rect: URect; valid: boolean } {
  const { cols, rows } = d.monitor
  const fx = dx / d.unit.x
  const fy = dy / d.unit.y
  let r: URect
  if (d.kind === 'move') {
    r = { ...d.start, x: clamp(d.start.x + fx, 0, cols - d.start.w), y: clamp(d.start.y + fy, 0, rows - d.start.h) }
  } else {
    let l = d.start.x
    let rt = d.start.x + d.start.w
    let t = d.start.y
    let b = d.start.y + d.start.h
    if (d.kind.left) l = clamp(l + fx, 0, rt - 1)
    if (d.kind.right) rt = clamp(rt + fx, l + 1, cols)
    if (d.kind.top) t = clamp(t + fy, 0, b - 1)
    if (d.kind.bottom) b = clamp(b + fy, t + 1, rows)
    r = { x: l, y: t, w: rt - l, h: b - t }
  }

  const others = d.monitor.tiles.filter((t) => t.id !== d.tileId)
  if (d.snap) {
    const edges: SnapEdges = d.kind === 'move' ? 'move' : d.kind
    r = snapRect(r, snapLines(d.monitor, others), { x: d.snapPx / d.unit.x, y: d.snapPx / d.unit.y }, edges)
  }

  // Bulatkan TEPI supaya tepi yang menempel tetap tepat di garis, lalu jaga di dalam monitor.
  let x = Math.round(r.x)
  let y = Math.round(r.y)
  let right = Math.round(r.x + r.w)
  let bottom = Math.round(r.y + r.h)
  if (d.kind === 'move') {
    x = clamp(x, 0, cols - d.start.w)
    y = clamp(y, 0, rows - d.start.h)
    right = x + d.start.w
    bottom = y + d.start.h
  } else {
    x = clamp(x, 0, cols - 1)
    y = clamp(y, 0, rows - 1)
    right = clamp(right, x + 1, cols)
    bottom = clamp(bottom, y + 1, rows)
  }
  const rect = { x, y, w: right - x, h: bottom - y }
  return { rect, valid: !overlapsAny(rect, others) }
}
