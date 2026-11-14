import type { MonitorLayout } from './types'

/** Persegi dalam unit grid. */
export interface URect {
  x: number
  y: number
  w: number
  h: number
}

export type SnapEdges = 'move' | { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean }

export interface SnapLines {
  xs: number[]
  ys: number[]
}

const uniqSorted = (values: number[]): number[] => [...new Set(values)].sort((a, b) => a - b)

/** Garis tujuan magnet (unit grid): tepi monitor, garis bezel, dan tepi panel lain. */
export function snapLines(monitor: Pick<MonitorLayout, 'cols' | 'rows' | 'bezel'>, others: readonly URect[]): SnapLines {
  const xs = [0, monitor.cols]
  const ys = [0, monitor.rows]
  for (let i = 1; i < monitor.bezel.cols; i++) xs.push(Math.round((monitor.cols * i) / monitor.bezel.cols))
  for (let i = 1; i < monitor.bezel.rows; i++) ys.push(Math.round((monitor.rows * i) / monitor.bezel.rows))
  for (const o of others) {
    xs.push(o.x, o.x + o.w)
    ys.push(o.y, o.y + o.h)
  }
  return { xs: uniqSorted(xs), ys: uniqSorted(ys) }
}

/** Selisih ke garis terdekat untuk salah satu nilai, bila dalam ambang. */
function nearest(values: readonly number[], lines: readonly number[], threshold: number): number | null {
  let best: number | null = null
  for (const v of values) {
    for (const l of lines) {
      const d = l - v
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d
    }
  }
  return best
}

/** Tempelkan tepi persegi ke garis terdekat (dalam ambang, unit grid). */
export function snapRect(r: URect, lines: SnapLines, threshold: { x: number; y: number }, edges: SnapEdges): URect {
  if (edges === 'move') {
    const dx = nearest([r.x, r.x + r.w], lines.xs, threshold.x) ?? 0
    const dy = nearest([r.y, r.y + r.h], lines.ys, threshold.y) ?? 0
    return { ...r, x: r.x + dx, y: r.y + dy }
  }
  let { x, y } = r
  let right = r.x + r.w
  let bottom = r.y + r.h
  if (edges.left) x += nearest([x], lines.xs, threshold.x) ?? 0
  if (edges.right) right += nearest([right], lines.xs, threshold.x) ?? 0
  if (edges.top) y += nearest([y], lines.ys, threshold.y) ?? 0
  if (edges.bottom) bottom += nearest([bottom], lines.ys, threshold.y) ?? 0
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) }
}

export function rectsOverlap(a: URect, b: URect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function overlapsAny(r: URect, others: readonly URect[]): boolean {
  return others.some((o) => rectsOverlap(r, o))
}
