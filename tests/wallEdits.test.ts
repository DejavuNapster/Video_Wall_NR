import { describe, expect, it } from 'vitest'
import { createDefaultPreset } from '@shared/layout'
import type { Preset } from '@shared/types'
import { applyWallEdit, setTileSource, WallEditSchema } from '@shared/wallEdits'

/** Preset 2 monitor; tiap monitor grid 12x8 berisi 4 tile 6x4 (t1..t4 di slot 0, t5..t8 di slot 1). */
const base = (): Preset => createDefaultPreset(2, 'p', 'P')
const tileOf = (p: Preset, id: string) => p.monitors.flatMap((m) => m.tiles).find((t) => t.id === id)

describe('setTileSource', () => {
  it('mengganti sumber tile di monitor pengirim', () => {
    const res = setTileSource(base(), 0, 't1', { type: 'web', url: 'https://a.test', zoom: 1, reloadMinutes: 0 })
    expect(res.ok).toBe(true)
    if (res.ok) expect(tileOf(res.preset, 't1')?.source).toEqual({ type: 'web', url: 'https://a.test', zoom: 1, reloadMinutes: 0 })
  })

  it('menolak tile dari monitor lain', () => {
    const res = setTileSource(base(), 0, 't5', { type: 'empty' })
    expect(res).toEqual({ ok: false, error: 'Panel tidak ditemukan di monitor ini' })
  })
})

describe('applyWallEdit', () => {
  const withWeb = (): Preset => {
    const r = setTileSource(base(), 0, 't1', { type: 'web', url: 'https://a.test', zoom: 1, reloadMinutes: 0 })
    if (!r.ok) throw new Error(r.error)
    return r.preset
  }

  it('zoom dan refresh hanya untuk panel web', () => {
    const z = applyWallEdit(withWeb(), 0, { op: 'setZoom', tileId: 't1', zoom: 1.234 })
    expect(z.ok && tileOf(z.preset, 't1')?.source).toMatchObject({ zoom: 1.23 })
    const r = applyWallEdit(withWeb(), 0, { op: 'setReloadMinutes', tileId: 't1', minutes: 15 })
    expect(r.ok && tileOf(r.preset, 't1')?.source).toMatchObject({ reloadMinutes: 15 })
    expect(applyWallEdit(base(), 0, { op: 'setZoom', tileId: 't2', zoom: 2 }).ok).toBe(false)
  })

  it('opsi abaikan sertifikat bisa dinyalakan dan dimatikan', () => {
    const on = applyWallEdit(withWeb(), 0, { op: 'setIgnoreCert', tileId: 't1', value: true })
    expect(on.ok && tileOf(on.preset, 't1')?.source).toMatchObject({ ignoreCertErrors: true })
    if (!on.ok) return
    const off = applyWallEdit(on.preset, 0, { op: 'setIgnoreCert', tileId: 't1', value: false })
    expect(off.ok && 'ignoreCertErrors' in (tileOf(off.preset, 't1')?.source ?? {})).toBe(false)
  })

  it('hapus dan tambah panel', () => {
    const removed = applyWallEdit(base(), 0, { op: 'removeTile', tileId: 't2' })
    expect(removed.ok && tileOf(removed.preset, 't2')).toBeUndefined()
    if (!removed.ok) return
    const added = applyWallEdit(removed.preset, 0, { op: 'addTile' })
    expect(added.ok).toBe(true)
    if (added.ok) {
      expect(added.tileId).toBe('t2')
      expect(tileOf(added.preset, 't2')).toMatchObject({ x: 6, y: 0, w: 4, h: 3 })
    }
  })

  it('tambah panel gagal bila monitor penuh', () => {
    expect(applyWallEdit(base(), 0, { op: 'addTile' })).toEqual({ ok: false, error: 'Monitor penuh. Klik panel yang mau dibelah dua, atau hapus/perkecil panel lain.' })
  })

  it('tab baru: tambah panel lalu isi URL-nya (alur openNewTab)', () => {
    // Monitor base penuh — buka satu slot dulu, persis seperti tile yang digantikan tab baru.
    const removed = applyWallEdit(base(), 0, { op: 'removeTile', tileId: 't4' })
    if (!removed.ok) throw new Error(removed.error)
    // Langkah 1 openNewTab: buat tile kosong di slot pertama yang tersedia.
    const added = applyWallEdit(removed.preset, 0, { op: 'addTile' })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    const tileId = added.tileId!
    // Langkah 2 openNewTab: isi URL tab barunya pada tileId yang dikembalikan.
    const src = setTileSource(added.preset, 0, tileId, { type: 'web', url: 'https://tab-b.test', zoom: 1, reloadMinutes: 0 })
    expect(src.ok).toBe(true)
    if (!src.ok) return
    expect(tileOf(src.preset, tileId)).toMatchObject({ source: { type: 'web', url: 'https://tab-b.test' } })
    // Tab baru tidak boleh menumpuk dengan tile lain yang sudah ada.
    const monitor = src.preset.monitors.find((m) => m.slot === 0)!
    const overlapped = monitor.tiles.filter((a, i) =>
      monitor.tiles.slice(i + 1).some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
    )
    expect(overlapped).toHaveLength(0)
  })

  it('geser/ubah ukuran: menolak tumpukan dan keluar area', () => {
    const removed = applyWallEdit(base(), 0, { op: 'removeTile', tileId: 't2' })
    if (!removed.ok) throw new Error()
    const moved = applyWallEdit(removed.preset, 0, { op: 'moveResize', tileId: 't1', x: 2, y: 0, w: 10, h: 4 })
    expect(moved.ok && tileOf(moved.preset, 't1')).toMatchObject({ x: 2, y: 0, w: 10, h: 4 })
    expect(applyWallEdit(base(), 0, { op: 'moveResize', tileId: 't1', x: 1, y: 0, w: 6, h: 4 })).toEqual({
      ok: false,
      error: 'Panel bertumpuk dengan panel lain'
    })
    expect(applyWallEdit(removed.preset, 0, { op: 'moveResize', tileId: 't1', x: 8, y: 0, w: 6, h: 4 })).toEqual({
      ok: false,
      error: 'Panel keluar dari area monitor'
    })
  })

  it('Grid -> Bebas mengalikan 8, Bebas -> Grid membulatkan kembali', () => {
    const free = applyWallEdit(base(), 0, { op: 'setLayoutMode', mode: 'free' })
    expect(free.ok).toBe(true)
    if (!free.ok) return
    const m = free.preset.monitors.find((x) => x.slot === 0)!
    expect(m).toMatchObject({ layoutMode: 'free', cols: 96, rows: 64 })
    expect(tileOf(free.preset, 't2')).toMatchObject({ x: 48, y: 0, w: 48, h: 32 })
    // monitor lain tidak tersentuh
    expect(free.preset.monitors.find((x) => x.slot === 1)).toMatchObject({ layoutMode: 'grid', cols: 12 })

    const nudged = applyWallEdit(free.preset, 0, { op: 'moveResize', tileId: 't1', x: 0, y: 0, w: 45, h: 30 })
    if (!nudged.ok) throw new Error(nudged.error)
    const grid = applyWallEdit(nudged.preset, 0, { op: 'setLayoutMode', mode: 'grid' })
    expect(grid.ok).toBe(true)
    if (grid.ok) {
      expect(grid.preset.monitors.find((x) => x.slot === 0)).toMatchObject({ layoutMode: 'grid', cols: 12, rows: 8 })
      expect(tileOf(grid.preset, 't1')).toMatchObject({ x: 0, y: 0, w: 6, h: 4 })
    }
  })

  it('Bebas -> Grid ditolak bila pembulatan membuat panel bertumpuk', () => {
    let p = applyWallEdit(base(), 0, { op: 'setLayoutMode', mode: 'free' })
    if (!p.ok) throw new Error()
    p = applyWallEdit(p.preset, 0, { op: 'removeTile', tileId: 't2' })
    if (!p.ok) throw new Error()
    // Panel A sangat sempit (49..51 = 0,25 sel): setelah dibulatkan lebarnya dipaksa 1 sel dan menabrak panel B.
    p = applyWallEdit(p.preset, 0, { op: 'moveResize', tileId: 't1', x: 0, y: 0, w: 49, h: 32 })
    if (!p.ok) throw new Error(p.error)
    const a = applyWallEdit(p.preset, 0, { op: 'addTile' })
    if (!a.ok) throw new Error(a.error)
    const aPlaced = applyWallEdit(a.preset, 0, { op: 'moveResize', tileId: a.tileId!, x: 49, y: 0, w: 2, h: 32 })
    if (!aPlaced.ok) throw new Error(aPlaced.error)
    const b = applyWallEdit(aPlaced.preset, 0, { op: 'addTile' })
    if (!b.ok) throw new Error(b.error)
    const bPlaced = applyWallEdit(b.preset, 0, { op: 'moveResize', tileId: b.tileId!, x: 51, y: 0, w: 45, h: 32 })
    if (!bPlaced.ok) throw new Error(bPlaced.error)
    const grid = applyWallEdit(bPlaced.preset, 0, { op: 'setLayoutMode', mode: 'grid' })
    expect(grid).toEqual({ ok: false, error: 'Tidak bisa kembali ke Grid: ada panel yang akan bertumpuk. Rapikan panel dulu.' })
  })

  it('garis bezel per monitor', () => {
    const res = applyWallEdit(base(), 1, { op: 'setBezel', cols: 2, rows: 2 })
    expect(res.ok && res.preset.monitors.find((m) => m.slot === 1)?.bezel).toEqual({ cols: 2, rows: 2 })
  })
})

describe('WallEditSchema', () => {
  it('menolak payload tidak dikenal atau tidak valid', () => {
    expect(WallEditSchema.safeParse({ op: 'hapusSemua' }).success).toBe(false)
    expect(WallEditSchema.safeParse({ op: 'setZoom', tileId: 't1', zoom: 99 }).success).toBe(false)
    expect(WallEditSchema.safeParse({ op: 'setSource', tileId: '../x', input: 'a' }).success).toBe(false)
    expect(WallEditSchema.safeParse({ op: 'setSource', tileId: 't1', input: 'https://a.test' }).success).toBe(true)
  })
})
