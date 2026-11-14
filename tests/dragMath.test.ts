import { describe, expect, it } from 'vitest'
import { computeDrag } from '@shared/dragMath'

// Mode Bebas 96x64, 1 unit = 16 px; panel lain di 48..96; garis bezel di 48.
const monitor = {
  cols: 96,
  rows: 64,
  bezel: { cols: 1, rows: 1 },
  tiles: [
    { id: 'a', x: 0, y: 0, w: 40, h: 32 },
    { id: 'b', x: 48, y: 0, w: 48, h: 32 }
  ]
}
const base = { tileId: 'a', start: { x: 0, y: 0, w: 40, h: 32 }, monitor, unit: { x: 16, y: 16 }, snapPx: 12 }

describe('computeDrag', () => {
  it('magnet menarik tepi yang masih di dalam 12 px ke garis terdekat (sebelum dibulatkan)', () => {
    // geser 8 px (0,5 unit): tanpa magnet dibulatkan ke 1, dengan magnet kembali ke 0
    expect(computeDrag({ ...base, kind: 'move', snap: false }, 8, 0).rect.x).toBe(1)
    expect(computeDrag({ ...base, kind: 'move', snap: true }, 8, 0).rect.x).toBe(0)
  })

  it('magnet menempelkan tepi kanan ke panel tetangga saat ubah ukuran', () => {
    // tepi kanan 40 -> ditarik 118 px (7,375 unit) = 47,375: 0,625 unit (10 px) dari 48 -> menempel
    const r = computeDrag({ ...base, kind: { right: true }, snap: true }, 118, 0)
    expect(r.rect).toEqual({ x: 0, y: 0, w: 48, h: 32 })
    expect(r.valid).toBe(true)
  })

  it('di luar ambang hanya dibulatkan', () => {
    // 6 unit (96 px) -> tepi kanan 46, jauh dari 48 (32 px)
    expect(computeDrag({ ...base, kind: { right: true }, snap: true }, 96, 0).rect.w).toBe(46)
  })

  it('tumpukan ditandai tidak valid', () => {
    const r = computeDrag({ ...base, kind: { right: true }, snap: false }, 16 * 20, 0)
    expect(r.rect.w).toBe(60)
    expect(r.valid).toBe(false)
  })

  it('tidak pernah keluar dari monitor dan ukuran minimal 1', () => {
    expect(computeDrag({ ...base, kind: 'move', snap: false }, -500, -500).rect).toMatchObject({ x: 0, y: 0 })
    expect(computeDrag({ ...base, kind: { right: true }, snap: false }, -5000, 0).rect.w).toBe(1)
    expect(computeDrag({ ...base, kind: 'move', snap: false }, 0, 5000).rect.y).toBe(32)
  })
})
