import { describe, expect, it } from 'vitest'
import { BAR_H, EDGE, gridUnit, panelGeometry, stripHeight, STRIP_RATIO, TOOLBAR_H, wallArea } from '@shared/panelGeometry'

const monitor = { cols: 2, rows: 2, gap: 0 }
const size = { width: 1000, height: 640 }

describe('wallArea', () => {
  it('Mode Atur menyisakan tempat untuk toolbar', () => {
    expect(wallArea(size, true)).toEqual({ x: 0, y: TOOLBAR_H, width: 1000, height: 640 - TOOLBAR_H })
  })
  it('Mode Tampil memakai seluruh jendela', () => {
    expect(wallArea(size, false)).toEqual({ x: 0, y: 0, width: 1000, height: 640 })
  })
})

describe('panelGeometry', () => {
  const tile = { x: 1, y: 0, w: 1, h: 1 }

  it('Mode Tampil: body = frame, tanpa bilah', () => {
    const g = panelGeometry(tile, monitor, size, false)
    expect(g.frame).toEqual({ x: 500, y: 0, width: 500, height: 320 })
    expect(g.bar).toBeNull()
    expect(g.body).toEqual(g.frame)
  })

  it('Mode Atur: bilah di atas, isi dimundurkan EDGE px dari tepi', () => {
    const g = panelGeometry(tile, monitor, size, true)
    const areaH = 640 - TOOLBAR_H
    expect(g.frame).toEqual({ x: 500, y: TOOLBAR_H, width: 500, height: areaH / 2 })
    expect(g.bar).toEqual({ x: 500, y: TOOLBAR_H, width: 500, height: BAR_H })
    expect(g.body).toEqual({
      x: 500 + EDGE,
      y: TOOLBAR_H + BAR_H,
      width: 500 - 2 * EDGE,
      height: areaH / 2 - BAR_H - EDGE
    })
  })

  it('panel yang sangat kecil tidak menghasilkan ukuran nol/negatif', () => {
    const g = panelGeometry({ x: 0, y: 0, w: 1, h: 1 }, { cols: 1, rows: 1, gap: 0 }, { width: 6, height: TOOLBAR_H + 10 }, true)
    expect(g.body.width).toBeGreaterThanOrEqual(1)
    expect(g.body.height).toBeGreaterThanOrEqual(1)
  })
})

describe('gridUnit', () => {
  it('ukuran satu langkah grid (sel + gap) dalam piksel', () => {
    expect(gridUnit({ cols: 4, rows: 2, gap: 10 }, { x: 0, y: 0, width: 410, height: 210 })).toEqual({ x: 100, y: 100 })
  })
})

describe('stripInset (banner mode strip)', () => {
  it('stripHeight = 12% tinggi window', () => {
    expect(stripHeight({ width: 100, height: 1000 })).toBe(120)
    expect(STRIP_RATIO).toBe(0.12)
  })

  it('wallArea menggeser area turun sebesar inset (Mode Tampil)', () => {
    expect(wallArea(size, false, 64)).toEqual({ x: 0, y: 64, width: 1000, height: 640 - 64 })
  })

  it('wallArea Mode Atur: toolbar + inset', () => {
    expect(wallArea(size, true, 64)).toEqual({ x: 0, y: TOOLBAR_H + 64, width: 1000, height: 640 - TOOLBAR_H - 64 })
  })

  it('panelGeometry: semua panel tergeser turun sebesar inset, tidak menumpuk di strip', () => {
    const g = panelGeometry({ x: 1, y: 0, w: 1, h: 1 }, monitor, size, false, 64)
    expect(g.frame).toEqual({ x: 500, y: 64, width: 500, height: (640 - 64) / 2 })
    expect(g.body).toEqual(g.frame)
    const g2 = panelGeometry({ x: 1, y: 0, w: 1, h: 1 }, monitor, size, true, 64)
    expect(g2.frame).toEqual({ x: 500, y: TOOLBAR_H + 64, width: 500, height: (640 - TOOLBAR_H - 64) / 2 })
  })

  it('inset 0 (default) tidak mengubah geometri lama', () => {
    const a = panelGeometry({ x: 0, y: 0, w: 1, h: 1 }, monitor, size, false)
    const b = panelGeometry({ x: 0, y: 0, w: 1, h: 1 }, monitor, size, false, 0)
    expect(b).toEqual(a)
  })
})
