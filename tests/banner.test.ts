import { describe, expect, it } from 'vitest'
import { BannerController, type TimerHandle } from '../src/main/banner'
import { EmergencyBannerSchema } from '@shared/schema'
import type { EmergencyBanner } from '@shared/types'

/** Fake timer: callback disimpan agar bisa dijalankan manual di test. */
const fakeTimers = () => {
  let pending: { fn: () => void; ms: number } | null = null
  return {
    setTimeout: (fn: () => void, ms: number): TimerHandle => {
      pending = { fn, ms }
      return { unref: () => {} }
    },
    clearTimeout: (): void => {
      pending = null
    },
    fire: (): void => {
      const p = pending
      pending = null
      p?.fn()
    },
    hasPending: (): boolean => pending !== null
  }
}

const banner = (over: Partial<EmergencyBanner> = {}): EmergencyBanner => ({
  title: 'Pengumuman Darurat',
  text: 'EVAKUASI',
  bgColor: '#b91c1c',
  fgColor: '#ffffff',
  fontSize: 96,
  durationSec: 0,
  pinned: false,
  mode: 'cover',
  sound: false,
  ...over
})

const T0 = 1_700_000_000_000

describe('BannerController', () => {
  it('set menyimpan banner + setAt dan mendorong onChange', () => {
    const changes: number[] = []
    const c = new BannerController({ now: () => T0, onChange: () => changes.push(1) })
    expect(c.get()).toBeNull()
    c.set(banner())
    expect(c.get()?.banner.text).toBe('EVAKUASI')
    expect(c.get()?.setAt).toBe(T0)
    expect(changes).toHaveLength(1)
  })

  it('durationSec > 0: timer terjadwal, expire menutup banner', () => {
    const t = fakeTimers()
    const changes: number[] = []
    const c = new BannerController({ now: () => T0, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout, onChange: () => changes.push(1) })
    c.set(banner({ durationSec: 30 }))
    expect(t.hasPending()).toBe(true)
    expect(c.get()).not.toBeNull()
    t.fire()
    expect(c.get()).toBeNull()
    expect(changes).toHaveLength(2) // set + expire
  })

  it('durationSec = 0: permanen, tidak ada timer', () => {
    const t = fakeTimers()
    const c = new BannerController({ now: () => T0, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout })
    c.set(banner({ durationSec: 0 }))
    expect(t.hasPending()).toBe(false)
    expect(c.get()).not.toBeNull()
  })

  it('set kedua menggantikan banner pertama (timer lama dibatalkan)', () => {
    const t = fakeTimers()
    const c = new BannerController({ now: () => T0, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout })
    c.set(banner({ text: 'PERTAMA', durationSec: 10 }))
    c.set(banner({ text: 'KEDUA', durationSec: 20 }))
    expect(c.get()?.banner.text).toBe('KEDUA')
    t.fire() // timer baru (20s) → expire
    expect(c.get()).toBeNull()
  })

  it('clear menutup banner dan membatalkan timer', () => {
    const t = fakeTimers()
    const changes: number[] = []
    const c = new BannerController({ now: () => T0, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout, onChange: () => changes.push(1) })
    c.set(banner({ durationSec: 10 }))
    c.clear()
    expect(c.get()).toBeNull()
    expect(changes).toHaveLength(2)
    expect(t.hasPending()).toBe(false)
    c.clear() // clear saat kosong: aman
    expect(changes).toHaveLength(2)
  })

  it('closeFromWall: banner biasa ditutup, banner pinned ditolak', () => {
    const c = new BannerController({ now: () => T0 })
    expect(c.closeFromWall()).toBe(false) // tidak ada banner
    c.set(banner({ pinned: false }))
    expect(c.closeFromWall()).toBe(true)
    expect(c.get()).toBeNull()
    c.set(banner({ pinned: true }))
    expect(c.closeFromWall()).toBe(false) // pinned → ditolak
    expect(c.get()?.banner.pinned).toBe(true)
    c.clear() // hanya operator yang boleh
    expect(c.get()).toBeNull()
  })

  it('stop membatalkan timer yang tersisa', () => {
    const t = fakeTimers()
    const c = new BannerController({ now: () => T0, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout })
    c.set(banner({ durationSec: 5 }))
    c.stop()
    expect(t.hasPending()).toBe(false)
  })
})

describe('skema banner darurat', () => {
  it('default terisi bila opsional tidak dikirim', () => {
    const b = EmergencyBannerSchema.parse({ text: 'PERINGATAN' })
    expect(b).toEqual({
      title: 'Pengumuman',
      text: 'PERINGATAN',
      bgColor: '#b91c1c',
      fgColor: '#ffffff',
      fontSize: 96,
      durationSec: 300,
      pinned: false,
      mode: 'cover',
      sound: false
    })
  })

  it('judul: dipangkas, boleh kosong, maks 60 karakter', () => {
    expect(EmergencyBannerSchema.parse({ text: 'a', title: '  Informasi ' }).title).toBe('Informasi')
    expect(EmergencyBannerSchema.parse({ text: 'a', title: '' }).title).toBe('')
    expect(EmergencyBannerSchema.safeParse({ text: 'a', title: 'x'.repeat(61) }).success).toBe(false)
  })

  it('mode: cover/strip diterima, nilai lain ditolak, default cover', () => {
    expect(EmergencyBannerSchema.safeParse({ text: 'a', mode: 'strip' }).success).toBe(true)
    expect(EmergencyBannerSchema.safeParse({ text: 'a', mode: 'cover' }).success).toBe(true)
    expect(EmergencyBannerSchema.safeParse({ text: 'a', mode: 'half' }).success).toBe(false)
    expect(EmergencyBannerSchema.parse({ text: 'a' }).mode).toBe('cover')
  })

  it('teks kosong / terlalu panjang ditolak', () => {
    expect(EmergencyBannerSchema.safeParse({ text: '   ' }).success).toBe(false)
    expect(EmergencyBannerSchema.safeParse({ text: 'x'.repeat(501) }).success).toBe(false)
  })

  it('warna harus hex #rrggbb; fontSize 24–480; durationSec 0–86400', () => {
    expect(EmergencyBannerSchema.safeParse({ text: 'a', bgColor: 'red' }).success).toBe(false)
    expect(EmergencyBannerSchema.safeParse({ text: 'a', fgColor: '#GGGGGG' }).success).toBe(false)
    expect(EmergencyBannerSchema.safeParse({ text: 'a', fontSize: 23 }).success).toBe(false)
    expect(EmergencyBannerSchema.safeParse({ text: 'a', fontSize: 481 }).success).toBe(false)
    expect(EmergencyBannerSchema.safeParse({ text: 'a', durationSec: -1 }).success).toBe(false)
    expect(EmergencyBannerSchema.safeParse({ text: 'a', durationSec: 86_401 }).success).toBe(false)
    expect(EmergencyBannerSchema.safeParse({ text: 'a', fontSize: 24, durationSec: 86_400 }).success).toBe(true)
  })
})
