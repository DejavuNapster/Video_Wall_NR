import { describe, expect, it, vi } from 'vitest'
import { EmergencyBannerSchema, SettingsSchema, SourceSchema } from '@shared/schema'
import { tileHardKey } from '@shared/tileKey'
import type { BannerScheduleEntry, BannerTemplate, Source } from '@shared/types'
import { mergeSettings, SettingsPatchSchema } from '@shared/wallPayloads'
import { cyclePages } from '@shared/webPanel'
import { BannerScheduler } from '../src/main/bannerSchedule'

const web = (over: object = {}): Source => SourceSchema.parse({ type: 'web', url: 'https://dash.contoh.id/', ...over })

describe('panel web: CSS & rotasi halaman', () => {
  it('CSS dan rotasi tidak membuat panel dibuat ulang; URL utama tetap', () => {
    const base = tileHardKey(web(), false)
    expect(tileHardKey(web({ css: 'nav{display:none}' }), false)).toBe(base)
    expect(tileHardKey(web({ cycle: { urls: ['https://b.contoh.id/'], intervalSec: 30 } }), false)).toBe(base)
    expect(tileHardKey(web({ url: 'https://lain.contoh.id/' }), false)).not.toBe(base)
  })

  it('daftar halaman rotasi: URL utama lalu URL tambahan', () => {
    expect(cyclePages({ url: 'https://a/' })).toEqual(['https://a/'])
    expect(cyclePages({ url: 'https://a/', cycle: { urls: ['https://b/', 'https://c/'] } })).toEqual(['https://a/', 'https://b/', 'https://c/'])
  })

  it('validasi rotasi: minimal 1 URL http(s), interval minimal 5 detik', () => {
    expect(SourceSchema.safeParse({ type: 'web', url: 'https://a/', cycle: { urls: [], intervalSec: 30 } }).success).toBe(false)
    expect(SourceSchema.safeParse({ type: 'web', url: 'https://a/', cycle: { urls: ['ftp://b/'], intervalSec: 30 } }).success).toBe(false)
    expect(SourceSchema.safeParse({ type: 'web', url: 'https://a/', cycle: { urls: ['https://b/'], intervalSec: 4 } }).success).toBe(false)
    expect(web({ cycle: { urls: ['https://b/'] } })).toMatchObject({ cycle: { intervalSec: 60 } })
  })
})

describe('pengaturan baru', () => {
  it('default: peringatan & kendali jarak jauh mati, templat/jadwal banner kosong', () => {
    const s = SettingsSchema.parse({})
    expect(s.alerts).toEqual({ enabled: false, afterMinutes: 5, notifyRecovery: true, webhookUrl: '', telegramChatId: '' })
    expect(s.remote).toEqual({ enabled: false, port: 8787, screenControl: false })
    expect(s.bannerTemplates).toEqual([])
    expect(s.bannerSchedule).toEqual([])
  })

  it('patch alerts/remote digabung, bukan diganti', () => {
    const s = SettingsSchema.parse({})
    const next = mergeSettings(s, { alerts: { enabled: true }, remote: { port: 9000 } })
    expect(next.alerts).toMatchObject({ enabled: true, afterMinutes: 5 })
    expect(next.remote).toEqual({ enabled: false, port: 9000, screenControl: false })
  })

  it('patch yang divalidasi tidak menimpa opsi lain dengan nilai bawaan', () => {
    const s = mergeSettings(SettingsSchema.parse({}), { remote: { enabled: true, port: 18792 }, alerts: { afterMinutes: 15, notifyRecovery: false } })
    const remote = SettingsPatchSchema.parse({ remote: { enabled: false } })
    expect(remote).toEqual({ remote: { enabled: false } })
    expect(mergeSettings(s, remote).remote).toEqual({ enabled: false, port: 18792, screenControl: false })
    const alerts = SettingsPatchSchema.parse({ alerts: { enabled: true } })
    expect(mergeSettings(s, alerts).alerts).toMatchObject({ enabled: true, afterMinutes: 15, notifyRecovery: false })
  })

  it('chat ID Telegram: angka atau @kanal', () => {
    const ok = (telegramChatId: string): boolean => SettingsSchema.safeParse({ alerts: { telegramChatId } }).success
    expect(ok('-1001234567890')).toBe(true)
    expect(ok('@infokantor')).toBe(true)
    expect(ok('')).toBe(true)
    expect(ok('bukan id')).toBe(false)
  })
})

describe('BannerScheduler', () => {
  const template: BannerTemplate = { id: 'rapat', name: 'Rapat', banner: EmergencyBannerSchema.parse({ text: 'Rapat pukul 13.00' }) }
  const entry = (over: Partial<BannerScheduleEntry> = {}): BannerScheduleEntry => ({ id: 'e1', templateId: 'rapat', hour: 13, minute: 0, enabled: true, ...over })
  const at = (h: number, m: number, s = 0): Date => new Date(2026, 10, 16, h, m, s) // Senin

  it('menampilkan templat sekali pada menit yang cocok', () => {
    const show = vi.fn()
    const sched = new BannerScheduler({ entries: () => [entry()], templates: () => [template], show })
    expect(sched.tick(at(12, 59))).toBeNull()
    expect(sched.tick(at(13, 0, 5))?.id).toBe('rapat')
    expect(sched.tick(at(13, 0, 35))).toBeNull()
    expect(show).toHaveBeenCalledTimes(1)
    expect(show).toHaveBeenCalledWith(template.banner)
  })

  it('menghormati hari, entri nonaktif, dan templat yang sudah dihapus', () => {
    const show = vi.fn()
    expect(new BannerScheduler({ entries: () => [entry({ weekdays: [2] })], templates: () => [template], show }).tick(at(13, 0))).toBeNull()
    expect(new BannerScheduler({ entries: () => [entry({ enabled: false })], templates: () => [template], show }).tick(at(13, 0))).toBeNull()
    expect(new BannerScheduler({ entries: () => [entry()], templates: () => [], show }).tick(at(13, 0))).toBeNull()
    expect(show).not.toHaveBeenCalled()
  })
})
