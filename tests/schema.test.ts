import { describe, expect, it } from 'vitest'
import { parsePreset } from '@shared/layout'
import { SettingsSchema } from '@shared/schema'

const legacyPreset = {
  schemaVersion: 1,
  id: 'default',
  name: 'Lama',
  updatedAt: '2026-10-15T00:00:00.000Z',
  monitors: [
    {
      slot: 0,
      cols: 12,
      rows: 8,
      gap: 4,
      background: '#000000',
      tiles: [{ id: 't1', label: '', x: 0, y: 0, w: 6, h: 4, source: { type: 'web', url: 'https://a.test', zoom: 1, reloadMinutes: 0 } }]
    }
  ]
}

describe('kompatibilitas skema', () => {
  it('preset lama tanpa layoutMode/bezel tetap valid dengan nilai default', () => {
    const res = parsePreset(legacyPreset)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.preset.monitors[0]?.layoutMode).toBe('grid')
    expect(res.preset.monitors[0]?.bezel).toEqual({ cols: 1, rows: 1 })
  })

  it('pengaturan lama tanpa wall/ignoreCertErrorsAll mendapat default', () => {
    const s = SettingsSchema.parse({ reloadIntervalHours: 6 })
    expect(s.reloadIntervalHours).toBe(6)
    expect(s.ignoreCertErrorsAll).toBe(false)
    expect(s.wall).toEqual({ displayMode: false, pinned: false, showBezel: true, snap: true, rotation: { enabled: false, intervalSec: 300 }, schedule: [] })
  })

  it('pengaturan wall parsial dilengkapi default', () => {
    const s = SettingsSchema.parse({ wall: { displayMode: true } })
    expect(s.wall.displayMode).toBe(true)
    expect(s.wall.rotation).toEqual({ enabled: false, intervalSec: 300 })
  })

  it('grid sampai 384 diterima (Mode Bebas), lebih dari itu ditolak', () => {
    const ok = structuredClone(legacyPreset)
    ok.monitors[0]!.cols = 384
    expect(parsePreset(ok).ok).toBe(true)
    const bad = structuredClone(legacyPreset)
    bad.monitors[0]!.cols = 385
    expect(parsePreset(bad).ok).toBe(false)
  })
})
