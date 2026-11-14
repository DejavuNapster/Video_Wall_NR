import { describe, expect, it } from 'vitest'
import { addTile, duplicatePreset, emptyMonitor, ensureMonitors, findFreeSpot, removeTile, slugify, splitRect, uniqueId } from '@shared/editor'
import { createDefaultPreset, findOverlaps } from '@shared/layout'
import { SCHEMA_VERSION } from '@shared/schema'
import { splitRtspCredentials } from '@shared/urlDetect'
import type { Preset, Tile } from '@shared/types'

const tile = (id: string, x: number, y: number, w: number, h: number): Tile => ({
  id,
  label: '',
  x,
  y,
  w,
  h,
  source: { type: 'empty' }
})

const preset = (tiles: Tile[], layoutMode: 'grid' | 'free' = 'grid'): Preset => {
  const scale = layoutMode === 'free' ? 8 : 1
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'p',
    name: 'P',
    updatedAt: '2026-01-01T00:00:00.000Z',
    monitors: [{ ...emptyMonitor(0), cols: 12 * scale, rows: 8 * scale, layoutMode, tiles }]
  }
}

describe('findFreeSpot', () => {
  it('memindai baris demi baris dan melewati area terpakai', () => {
    expect(findFreeSpot([tile('a', 0, 0, 6, 4)], 12, 8, 6, 4)).toEqual({ x: 6, y: 0 })
    expect(findFreeSpot([tile('a', 0, 0, 12, 8)], 12, 8, 1, 1)).toBeNull()
  })
})

describe('splitRect', () => {
  it('membelah sisi terpanjang di layar 16:9', () => {
    expect(splitRect({ x: 0, y: 0, w: 12, h: 8 }, 12, 8)).toEqual({ keep: { x: 0, y: 0, w: 6, h: 8 }, spot: { x: 6, y: 0, w: 6, h: 8 } })
    expect(splitRect({ x: 0, y: 0, w: 6, h: 8 }, 12, 8)).toEqual({ keep: { x: 0, y: 0, w: 6, h: 4 }, spot: { x: 0, y: 4, w: 6, h: 4 } })
    expect(splitRect({ x: 3, y: 2, w: 3, h: 1 }, 12, 8)).toEqual({ keep: { x: 3, y: 2, w: 2, h: 1 }, spot: { x: 5, y: 2, w: 1, h: 1 } })
    expect(splitRect({ x: 0, y: 0, w: 1, h: 1 }, 12, 8)).toBeNull()
  })
})

describe('addTile', () => {
  it('menambah panel 4x3 di tempat kosong pertama tanpa tumpang tindih', () => {
    const res = addTile(preset([tile('t1', 0, 0, 6, 4)]), 0)
    expect(res.tileId).toBe('t2')
    const tiles = res.preset.monitors[0]!.tiles
    expect(tiles.find((t) => t.id === 't2')).toMatchObject({ x: 6, y: 0, w: 4, h: 3 })
    expect(findOverlaps(tiles)).toHaveLength(0)
  })

  it('memperkecil ukuran sampai muat dan gagal bila monitor penuh', () => {
    const almostFull = preset([tile('t1', 0, 0, 12, 7), tile('t2', 0, 7, 11, 1)])
    expect(addTile(almostFull, 0).preset.monitors[0]!.tiles.at(-1)).toMatchObject({ x: 11, y: 7, w: 1, h: 1 })
    expect(addTile(preset([tile('t1', 0, 0, 12, 8)]), 0).tileId).toBeNull()
  })

  it('di Mode Bebas ukuran panel ikut diskalakan (bukan panel mini)', () => {
    const res = addTile(preset([], 'free'), 0)
    expect(res.preset.monitors[0]!.tiles[0]).toMatchObject({ x: 0, y: 0, w: 32, h: 24 })
  })

  it('monitor penuh + near: panel asal dibelah dua, tanpa tumpang tindih', () => {
    // Dua panel kiri-kanan (960x1080 di layar 16:9) → dibelah atas-bawah.
    const res = addTile(preset([tile('t1', 0, 0, 6, 8), tile('t2', 6, 0, 6, 8)]), 0, 't2')
    expect(res.tileId).toBe('t3')
    const tiles = res.preset.monitors[0]!.tiles
    expect(tiles.find((t) => t.id === 't2')).toMatchObject({ x: 6, y: 0, w: 6, h: 4 })
    expect(tiles.find((t) => t.id === 't3')).toMatchObject({ x: 6, y: 4, w: 6, h: 4 })
    expect(tiles.find((t) => t.id === 't1')).toMatchObject({ x: 0, y: 0, w: 6, h: 8 })
    expect(findOverlaps(tiles)).toHaveLength(0)
  })

  it('monitor penuh + near: panel 1x1 tidak bisa dibelah', () => {
    const full = preset([tile('t1', 0, 0, 12, 7), tile('t2', 0, 7, 11, 1), tile('t3', 11, 7, 1, 1)])
    expect(addTile(full, 0, 't3').tileId).toBeNull()
  })

  it('monitor yang tidak ada tidak mengubah preset', () => {
    const p = preset([])
    expect(addTile(p, 5)).toEqual({ preset: p, tileId: null })
  })
})

describe('ensureMonitors / removeTile', () => {
  it('melengkapi layout kosong untuk monitor baru, urut slot', () => {
    const p = ensureMonitors(createDefaultPreset(1), 3)
    expect(p.monitors.map((m) => m.slot)).toEqual([0, 1, 2])
    expect(p.monitors[2]!.tiles).toEqual([])
  })

  it('menghapus panel dari monitor mana pun', () => {
    const p = removeTile(createDefaultPreset(2), 't5')
    expect(p.monitors[1]!.tiles.map((t) => t.id)).toEqual(['t6', 't7', 't8'])
  })
})

describe('id & salinan preset', () => {
  it('slugify dan uniqueId', () => {
    expect(slugify('Lobi Utama (salinan)')).toBe('lobi-utama-salinan')
    expect(slugify('!!!')).toBe('preset')
    expect(uniqueId('preset-baru', ['preset-baru', 'preset-baru-2'])).toBe('preset-baru-3')
  })

  it('duplicatePreset membuat salinan dalam dengan id/nama baru', () => {
    const src = createDefaultPreset(1)
    const copy = duplicatePreset(src, 'salin', 'Salin')
    expect(copy).toMatchObject({ id: 'salin', name: 'Salin' })
    copy.monitors[0]!.tiles[0]!.label = 'ubah'
    expect(src.monitors[0]!.tiles[0]!.label).toBe('')
  })
})

describe('splitRtspCredentials', () => {
  it('memindah user:pass dari URL RTSP (password tidak masuk preset)', () => {
    const res = splitRtspCredentials({ type: 'rtsp', url: 'rtsp://admin:p%40ss@10.0.0.5:554/s1', transport: 'tcp' })
    expect(res.password).toBe('p@ss')
    expect(res.source).toEqual({ type: 'rtsp', url: 'rtsp://10.0.0.5:554/s1', transport: 'tcp', username: 'admin' })
  })

  it('sumber tanpa kredensial / non-RTSP tidak berubah', () => {
    const rtsp = { type: 'rtsp' as const, url: 'rtsp://10.0.0.5/s1', transport: 'auto' as const }
    expect(splitRtspCredentials(rtsp)).toEqual({ source: rtsp })
    const web = { type: 'web' as const, url: 'https://a.test', zoom: 1, reloadMinutes: 0 }
    expect(splitRtspCredentials(web)).toEqual({ source: web })
  })
})
