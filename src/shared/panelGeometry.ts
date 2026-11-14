import { tileToBounds } from './layout'
import type { MonitorLayout, Rect, Tile } from './types'

/** Tinggi toolbar atas jendela wall (Mode Atur). */
export const TOOLBAR_H = 40
/** Tinggi bilah panel (Mode Atur). */
export const BAR_H = 30
/** Bingkai di sisi kiri/kanan/bawah panel yang menjadi pegangan ubah ukuran (Mode Atur). */
export const EDGE = 4
/** Fraksi tinggi window untuk strip banner darurat (mode strip): 12% (rentang wajar 10–15%). */
export const STRIP_RATIO = 0.12

type Size = { width: number; height: number }
type GridSpec = Pick<MonitorLayout, 'cols' | 'rows' | 'gap'>

/** Tinggi strip banner (px) untuk ukuran window tertentu — dipakai main dan renderer agar selalu sejajar. */
export function stripHeight(size: Size): number {
  return Math.round(size.height * STRIP_RATIO)
}

/**
 * Area tempat panel disusun di dalam jendela wall, setelah toolbar (Mode Atur)
 * dan strip banner darurat (mode strip, `stripInset`) dipotong dari atas.
 */
export function wallArea(size: Size, edit: boolean, stripInset = 0): Rect {
  const top = (edit ? TOOLBAR_H : 0) + stripInset
  return { x: 0, y: top, width: size.width, height: Math.max(1, size.height - top) }
}

export interface PanelGeometry {
  /** Kotak panel penuh. */
  frame: Rect
  /** Bilah panel (null di Mode Tampil). */
  bar: Rect | null
  /** Area isi web/video (posisi WebContentsView tile). */
  body: Rect
}

/**
 * Posisi piksel panel di dalam jendela wall. Dipakai main (posisi WebContentsView) DAN renderer wall
 * (bilah, bingkai) supaya keduanya selalu sejajar.
 */
export function panelGeometry(tile: Pick<Tile, 'x' | 'y' | 'w' | 'h'>, monitor: GridSpec, size: Size, edit: boolean, stripInset = 0): PanelGeometry {
  const area = wallArea(size, edit, stripInset)
  const r = tileToBounds(tile, monitor, { width: area.width, height: area.height })
  const frame: Rect = { x: r.x + area.x, y: r.y + area.y, width: r.width, height: r.height }
  if (!edit) return { frame, bar: null, body: frame }
  const barH = Math.min(BAR_H, frame.height)
  return {
    frame,
    bar: { x: frame.x, y: frame.y, width: frame.width, height: barH },
    body: {
      x: frame.x + EDGE,
      y: frame.y + barH,
      width: Math.max(1, frame.width - 2 * EDGE),
      height: Math.max(1, frame.height - barH - EDGE)
    }
  }
}

/** Ukuran satu langkah grid (sel + gap) dalam piksel; dipakai untuk mengubah gerakan mouse menjadi unit grid. */
export function gridUnit(monitor: GridSpec, area: Rect): { x: number; y: number } {
  const cellW = (area.width - monitor.gap * (monitor.cols + 1)) / monitor.cols
  const cellH = (area.height - monitor.gap * (monitor.rows + 1)) / monitor.rows
  return { x: cellW + monitor.gap, y: cellH + monitor.gap }
}
