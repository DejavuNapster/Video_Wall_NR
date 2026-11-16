import { describe, expect, it } from 'vitest'
import { defaultSource } from '@shared/editor'
import { SourceSchema } from '@shared/schema'
import {
  applyTickerPatch,
  TICKER_STYLES,
  tickerBackground,
  tickerMessages,
  tickerName,
  TickerPatchSchema,
  tickerPlan,
  tickerTextShadow,
  type TickerSource
} from '@shared/ticker'

const base = { continuous: false, speedSec: 10, laneW: 1000, laneH: 100, contentW: 400, contentH: 60 }

describe('skema ticker', () => {
  it('ticker lama (hanya 6 kolom) tetap valid dengan nilai bawaan untuk opsi baru', () => {
    const res = SourceSchema.safeParse({ type: 'ticker', text: 'Halo', speedSec: 20, bgColor: '#0f172a', fgColor: '#f8fafc', fontSize: 48 })
    expect(res.success).toBe(true)
    if (!res.success || res.data.type !== 'ticker') return
    expect(res.data).toMatchObject({ motion: 'left', continuous: false, paused: false, effect: 'none', fontWeight: 'normal', badge: '', bgColor2: '' })
  })

  it('menolak warna dan pilihan yang tidak dikenal', () => {
    expect(SourceSchema.safeParse({ type: 'ticker', text: 'a', effectColor: 'merah' }).success).toBe(false)
    expect(SourceSchema.safeParse({ type: 'ticker', text: 'a', motion: 'zigzag' }).success).toBe(false)
    expect(SourceSchema.safeParse({ type: 'ticker', text: 'a', bgColor2: '#12345' }).success).toBe(false)
  })

  it('ticker baru dari Inspector bersambung dan semua gaya siap pakai valid', () => {
    const src = defaultSource('ticker')
    expect(src).toMatchObject({ type: 'ticker', continuous: true, fadeEdges: true })
    for (const st of TICKER_STYLES) expect(SourceSchema.safeParse({ ...src, ...st.style }).success, st.name).toBe(true)
  })
})

describe('tickerMessages & tickerName', () => {
  it('satu pesan per baris, baris kosong diabaikan', () => {
    expect(tickerMessages(' Satu \r\n\n  Dua\n ')).toEqual(['Satu', 'Dua'])
  })

  it('nama panel = pesan pertama, dipotong', () => {
    expect(tickerName('\nSelamat datang\nRapat')).toBe('Selamat datang')
    expect(tickerName('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})

describe('perubahan dari kendali jarak jauh & Telegram', () => {
  const src = defaultSource('ticker') as TickerSource

  it('hanya kunci yang dikirim yang berubah; gaya siap pakai mengganti tampilan saja', () => {
    const paused = applyTickerPatch(src, { paused: true })
    expect(paused).toMatchObject({ ok: true, source: { ...src, paused: true } })
    const neon = applyTickerPatch(src, { style: 'neon', text: 'Halo' })
    expect(neon.ok && neon.source).toMatchObject({ text: 'Halo', effect: 'glow', speedSec: src.speedSec, motion: src.motion })
  })

  it('skema menolak kunci asing, gaya tak dikenal, dan teks kosong', () => {
    expect(TickerPatchSchema.safeParse({ fontSize: 99 }).success).toBe(false)
    expect(TickerPatchSchema.safeParse({ style: 'pelangi' }).success).toBe(false)
    expect(TickerPatchSchema.safeParse({ text: '   ' }).success).toBe(false)
    expect(TickerPatchSchema.safeParse({}).success).toBe(true)
  })
})

describe('tickerPlan', () => {
  it('kiri: masuk dari tepi kanan sampai keluar penuh di kiri, kecepatan = lebar lane / speedSec', () => {
    const plan = tickerPlan({ ...base, motion: 'left' })
    expect(plan?.copies).toBe(1)
    expect(plan?.frames.map((f) => f.value)).toEqual([1000, -400])
    expect(plan?.durationMs).toBe(14_000) // 1400 px pada 100 px/detik
  })

  it('kanan adalah kebalikan dari kiri', () => {
    expect(tickerPlan({ ...base, motion: 'right' })?.frames.map((f) => f.value)).toEqual([-400, 1000])
  })

  it('bersambung: cukup salinan untuk menutup lane dan bergeser tepat satu salinan', () => {
    const plan = tickerPlan({ ...base, motion: 'left', continuous: true })
    expect(plan?.copies).toBe(4) // ceil(1000/400) + 1
    expect(plan?.frames.map((f) => f.value)).toEqual([0, -400])
    expect(plan?.durationMs).toBe(4000)
  })

  it('naik memakai sumbu y dan tinggi lane', () => {
    const plan = tickerPlan({ ...base, motion: 'up' })
    expect(plan?.axis).toBe('y')
    expect(plan?.frames.map((f) => f.value)).toEqual([100, -60])
  })

  it('bolak-balik bergerak antara kedua ujung dan berhenti sejenak di setiap ujung', () => {
    const plan = tickerPlan({ ...base, motion: 'bounce', continuous: true })
    expect(plan?.copies).toBe(1)
    expect(plan?.frames.map((f) => f.value)).toEqual([0, 0, 600, 600, 0])
    // Teks lebih lebar dari lane bergeser ke kiri untuk memperlihatkan ujungnya.
    expect(tickerPlan({ ...base, motion: 'bounce', contentW: 1300 })?.frames[2]?.value).toBe(-300)
    expect(tickerPlan({ ...base, motion: 'bounce', contentW: 1000 })).toBeNull()
  })

  it('null bila belum terukur', () => {
    expect(tickerPlan({ ...base, motion: 'left', laneW: 0 })).toBeNull()
  })
})

describe('efek & latar', () => {
  it('tanpa efek = none; 3D menumpuk lapisan sesuai ukuran huruf', () => {
    expect(tickerTextShadow('none', '#000000', 5, 48)).toBe('none')
    const small = tickerTextShadow('3d', '#000000', 5, 48).split(', ').length
    const big = tickerTextShadow('3d', '#000000', 5, 96).split(', ').length
    expect(big).toBeGreaterThan(small)
  })

  it('setiap efek menghasilkan text-shadow yang memakai warnanya', () => {
    for (const effect of ['shadow', '3d', 'outline', 'glow'] as const) {
      expect(tickerTextShadow(effect, '#ff0000', 5, 48)).toContain('#ff0000')
    }
  })

  it('latar polos atau gradasi', () => {
    expect(tickerBackground({ bgColor: '#111111', bgColor2: '' })).toBe('#111111')
    expect(tickerBackground({ bgColor: '#111111', bgColor2: '#222222' })).toBe('linear-gradient(180deg, #111111, #222222)')
  })
})
