import { describe, expect, it } from 'vitest'
import { ScheduleController } from '../src/main/schedule'
import { entryKey, hasEnabledSchedule, isEntryDue, minuteStamp, pickScheduledEntry } from '@shared/schedule'
import { ScheduleEntrySchema, SettingsSchema, WallSettingsSchema } from '@shared/schema'
import { mergeSettings, SettingsPatchSchema, WallSettingsPatchSchema } from '@shared/wallPayloads'
import type { Result, ScheduleEntry } from '@shared/types'

/** 2026-11-05 = Kamis; getDay() = 4. */
const NOW = new Date(2026, 10, 5, 6, 0, 0)
const THURSDAY = NOW.getDay()

const mk = (over: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
  id: 'j1',
  presetId: 'p1',
  hour: 6,
  minute: 0,
  enabled: true,
  ...over
})

describe('logika murni jadwal', () => {
  it('entryKey dan minuteStamp stabil dan terbaca', () => {
    expect(entryKey(mk({ presetId: 'b', hour: 7, minute: 5 }))).toBe('b@07:05')
    expect(minuteStamp(NOW)).toBe('2026-11-05 06:00')
  })

  it('isEntryDue cocok hanya bila aktif + jam/menit/hari cocok', () => {
    expect(isEntryDue(mk(), NOW)).toBe(true)
    expect(isEntryDue(mk({ hour: 7 }), NOW)).toBe(false)
    expect(isEntryDue(mk({ minute: 1 }), NOW)).toBe(false)
    expect(isEntryDue(mk({ enabled: false }), NOW)).toBe(false)
  })

  it('isEntryDue menghormati filter hari; tidak diisi = semua hari', () => {
    expect(isEntryDue(mk({ weekdays: [THURSDAY] }), NOW)).toBe(true)
    expect(isEntryDue(mk({ weekdays: [(THURSDAY + 1) % 7] }), NOW)).toBe(false)
  })

  it('pickScheduledEntry: entri pertama yang cocok menang', () => {
    const a = mk({ id: 'a', presetId: 'pa' })
    const b = mk({ id: 'b', presetId: 'pb' })
    expect(pickScheduledEntry(NOW, [b, a], null)?.id).toBe('b')
  })

  it('pickScheduledEntry: hysteresis — entri sama di menit yang sama tidak dipicu ulang', () => {
    const e = mk()
    const last = { key: entryKey(e), minuteStamp: minuteStamp(NOW) }
    expect(pickScheduledEntry(NOW, [e], last)).toBeNull()
    // menit jam-jadi lain (hari berikutnya jam yang sama) → boleh lagi
    const nextDay = new Date(2026, 10, 6, 6, 0, 0)
    expect(pickScheduledEntry(nextDay, [e], last)?.id).toBe(e.id)
    // entri berbeda di menit yang sama → boleh
    expect(pickScheduledEntry(NOW, [mk({ id: 'x', presetId: 'px' })], last)?.presetId).toBe('px')
  })

  it('tanpa entri jatuh tempo → null', () => {
    expect(pickScheduledEntry(NOW, [mk({ hour: 9 })], null)).toBeNull()
    expect(pickScheduledEntry(NOW, [], null)).toBeNull()
  })

  it('hasEnabledSchedule menentukan apakah rotasi interval dijeda', () => {
    expect(hasEnabledSchedule([])).toBe(false)
    expect(hasEnabledSchedule([mk({ enabled: false })])).toBe(false)
    expect(hasEnabledSchedule([mk({ enabled: false }), mk({ id: 'j2' })])).toBe(true)
  })
})

describe('ScheduleController', () => {
  const make = (activate: (id: string) => Promise<Result> = async () => ({ ok: true })) => {
    const calls: string[] = []
    const deps = {
      entries: () => [mk()],
      activeId: () => null,
      activate: async (id: string) => {
        calls.push(id)
        return activate(id)
      }
    }
    return { calls, c: new ScheduleController(deps) }
  }

  it('tick mengaktifkan preset yang jatuh tempo, sekali per menit', async () => {
    const e0 = mk({ id: 'j0', presetId: 'p1' })
    const e1 = mk({ id: 'j1', presetId: 'p2', minute: 1 })
    const calls: string[] = []
    const c = new ScheduleController({
      entries: () => [e0, e1],
      activeId: () => null,
      activate: async (id: string) => {
        calls.push(id)
        return { ok: true }
      }
    })
    expect(await c.tick(NOW)).toBe(true) // 06:00 → p1
    expect(calls).toEqual(['p1'])
    expect(await c.tick(NOW)).toBe(false) // hysteresis
    expect(calls).toEqual(['p1'])
    expect(await c.tick(new Date(2026, 10, 5, 6, 1, 0))).toBe(true) // 06:01 → p2
    expect(calls).toEqual(['p1', 'p2'])
  })

  it('preset yang sudah aktif: catat pemicu tanpa memanggil activate', async () => {
    const calls: string[] = []
    const c = new ScheduleController({
      entries: () => [mk()],
      activeId: () => 'p1',
      activate: async (id: string) => {
        calls.push(id)
        return { ok: true }
      }
    })
    expect(await c.tick(NOW)).toBe(true)
    expect(calls).toEqual([])
    expect(await c.tick(NOW)).toBe(false)
  })

  it('aktivasi gagal: tidak catat pemicu, dicoba ulang di tick berikutnya', async () => {
    const { calls, c } = make(async () => ({ ok: false, error: 'preset rusak' }))
    expect(await c.tick(NOW)).toBe(true)
    expect(await c.tick(NOW)).toBe(true) // retry di menit yang sama
    expect(calls).toEqual(['p1', 'p1'])
  })

  it('restart/stop mengikuti keberadaan entri aktif', () => {
    const c = new ScheduleController({ entries: () => [], activeId: () => null, activate: async () => ({ ok: true }) })
    c.restart()
    expect(c.running).toBe(false)
    const c2 = new ScheduleController({
      entries: () => [mk({ enabled: false })],
      activeId: () => null,
      activate: async () => ({ ok: true })
    })
    c2.restart()
    expect(c2.running).toBe(false)
    const c3 = new ScheduleController({ entries: () => [mk()], activeId: () => null, activate: async () => ({ ok: true }) })
    c3.restart()
    expect(c3.running).toBe(true)
    c3.stop()
    expect(c3.running).toBe(false)
  })
})

describe('skema jadwal', () => {
  it('wall.schedule default kosong dan entri valid diterima', () => {
    expect(WallSettingsSchema.parse({}).schedule).toEqual([])
    const s = WallSettingsSchema.parse({ schedule: [{ id: 'j', presetId: 'p', hour: 23, minute: 59, weekdays: [1, 3] }] })
    expect(s.schedule).toHaveLength(1)
    expect(ScheduleEntrySchema.parse({ id: 'j', presetId: 'p', hour: 0, minute: 0, enabled: true })).toEqual({
      id: 'j',
      presetId: 'p',
      hour: 0,
      minute: 0,
      enabled: true
    })
  })

  it('jam/menit di luar rentang dan lebih dari 48 entri ditolak', () => {
    expect(WallSettingsSchema.safeParse({ schedule: [{ id: 'j', presetId: 'p', hour: 24 }] }).success).toBe(false)
    expect(WallSettingsSchema.safeParse({ schedule: [{ id: 'j', presetId: 'p', hour: 0, minute: -1 }] }).success).toBe(false)
    const many = Array.from({ length: 49 }, (_, i) => ({ id: `j${i}`, presetId: 'p', hour: 0, minute: 0, enabled: true }))
    expect(WallSettingsSchema.safeParse({ schedule: many }).success).toBe(false)
  })

  it('patch pengaturan Operator menerima jadwal; toolbar wall tidak', () => {
    const entry = { id: 'j', presetId: 'p', hour: 6, minute: 0, enabled: true }
    const p = SettingsPatchSchema.parse({ wall: { schedule: [entry] } })
    expect(p.wall?.schedule).toHaveLength(1)
    expect(WallSettingsPatchSchema.safeParse({ schedule: [entry] }).success).toBe(false)
  })
})

describe('mergeSettings', () => {
  const cur = SettingsSchema.parse({})

  it('menggabung wall dan rotasi secara dalam, bukan mengganti', () => {
    const next = mergeSettings(cur, { wall: { rotation: { intervalSec: 60 } } })
    expect(next.wall.rotation).toEqual({ enabled: false, intervalSec: 60 })
    expect(next.wall.showBezel).toBe(true)
  })

  it('null pada excludePrimaryFromWall kembali ke otomatis; mediaMtxEnabled hanya mengubah enabled', () => {
    const on = mergeSettings(cur, { excludePrimaryFromWall: true, mediaMtxEnabled: false })
    expect(on.excludePrimaryFromWall).toBe(true)
    expect(on.mediaMtx).toEqual({ ...cur.mediaMtx, enabled: false })
    expect('excludePrimaryFromWall' in mergeSettings(on, { excludePrimaryFromWall: null })).toBe(false)
  })
})
