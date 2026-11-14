import { describe, expect, it } from 'vitest'
import { createDefaultPreset } from '@shared/layout'
import { applyTemplate, TEMPLATES, templateRemovals } from '@shared/templates'
import type { Preset } from '@shared/types'
import { setTileSource } from '@shared/wallEdits'

const base = (): Preset => createDefaultPreset(1, 'p', 'P')
const monitor0 = (p: Preset) => p.monitors.find((m) => m.slot === 0)!

describe('templates', () => {
  it('setiap template menghasilkan panel tanpa tumpukan yang mengisi grid 12x8', () => {
    for (const t of TEMPLATES) {
      const res = applyTemplate(base(), 0, t.id)
      expect(res.ok, t.id).toBe(true)
      if (!res.ok) continue
      const tiles = monitor0(res.preset).tiles
      expect(tiles).toHaveLength(t.rects.length)
      const area = tiles.reduce((s, x) => s + x.w * x.h, 0)
      expect(area, t.id).toBe(12 * 8)
    }
  })

  it('URL panel lama dipertahankan sesuai urutan (baris lalu kolom)', () => {
    const p = setTileSource(base(), 0, 't2', { type: 'web', url: 'https://kanan-atas.test', zoom: 1, reloadMinutes: 0 })
    if (!p.ok) throw new Error()
    const res = applyTemplate(p.preset, 0, 'split-v')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const tiles = monitor0(res.preset).tiles
    expect(tiles.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(tiles[1]).toMatchObject({ x: 6, y: 0, w: 6, h: 8, source: { url: 'https://kanan-atas.test' } })
  })

  it('kelebihan panel dihapus dan dilaporkan sebelumnya', () => {
    expect(templateRemovals(monitor0(base()), 'single')).toEqual(['t2', 't3', 't4'])
    expect(templateRemovals(monitor0(base()), 'grid-3')).toEqual([])
  })

  it('kekurangan panel diisi panel kosong dengan ID unik', () => {
    const res = applyTemplate(base(), 0, 'grid-3')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const ids = monitor0(res.preset).tiles.map((t) => t.id)
    expect(new Set(ids).size).toBe(9)
    expect(ids.slice(0, 4)).toEqual(['t1', 't2', 't3', 't4'])
  })

  it('di Mode Bebas template memakai grid halus', () => {
    const p = base()
    p.monitors[0] = { ...p.monitors[0]!, layoutMode: 'free', cols: 96, rows: 64, tiles: [] }
    const res = applyTemplate(p, 0, 'grid-3')
    expect(res.ok).toBe(true)
    if (res.ok) expect(monitor0(res.preset).tiles.reduce((s, x) => s + x.w * x.h, 0)).toBe(96 * 64)
  })
})
