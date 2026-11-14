import { describe, expect, it, vi } from 'vitest'
import { CERT_DAYS, certInfo, certNames, generateCert, needsRenewal, TlsStore, type TlsMaterial } from '../src/main/remote/tls'

const DAY = 86_400_000

describe('sertifikat HTTPS kendali jarak jauh', () => {
  it('mencakup nama komputer, localhost, dan semua IP; berlaku 825 hari', async () => {
    const names = certNames('PC-Wall', ['192.168.1.20', '10.0.0.5'])
    expect(names).toEqual(['pc-wall', 'localhost', '127.0.0.1', '192.168.1.20', '10.0.0.5'])
    const now = new Date('2026-11-14T00:00:00Z')
    const m = await generateCert(names, now)
    expect(m.key).toContain('PRIVATE KEY')
    const info = certInfo(m.cert)
    expect(info.names).toEqual(names)
    expect(info.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
    expect(Math.round((info.validTo.getTime() - now.getTime()) / DAY)).toBe(CERT_DAYS)
  })

  it('dibuat ulang bila belum ada, hampir habis, atau IP baru belum tercakup', async () => {
    const now = new Date('2026-11-14T00:00:00Z')
    const m = await generateCert(['localhost', '192.168.1.20'], now)
    expect(needsRenewal(null, ['localhost'], now)).toBe(true)
    expect(needsRenewal(m, ['localhost', '192.168.1.20'], now)).toBe(false)
    expect(needsRenewal(m, ['localhost', '192.168.1.21'], now)).toBe(true)
    expect(needsRenewal(m, ['localhost'], new Date(now.getTime() + (CERT_DAYS - 10) * DAY))).toBe(true)
    expect(needsRenewal({ cert: 'rusak', key: 'rusak' }, ['localhost'], now)).toBe(true)
  })

  it('TlsStore memakai sertifikat tersimpan dan hanya membuat baru bila perlu', async () => {
    let saved: TlsMaterial | null = null
    const store = new TlsStore({ load: async () => saved, save: async (m) => void (saved = m) })
    const a = await store.ensure(['localhost', '192.168.1.20'])
    expect(a.renewed).toBe(true)
    expect(saved).toEqual(a.material)
    const b = await store.ensure(['localhost', '192.168.1.20'])
    expect(b).toEqual({ material: a.material, renewed: false })
    // Aplikasi dijalankan lagi: sertifikat dimuat dari penyimpanan, sidik jari tidak berubah.
    const again = new TlsStore({ load: async () => saved, save: vi.fn() })
    expect((await again.ensure(['localhost', '192.168.1.20'])).renewed).toBe(false)
    const c = await store.ensure(['localhost', '192.168.1.99'])
    expect(c.renewed).toBe(true)
    expect(certInfo(c.material.cert).fingerprint).not.toBe(certInfo(a.material.cert).fingerprint)
  })

  it('gagal disimpan: tetap dipakai dari memori dengan peringatan', async () => {
    const store = new TlsStore({
      load: async () => null,
      save: async () => {
        throw new Error('Enkripsi OS tidak tersedia')
      }
    })
    const r = await store.ensure(['localhost'])
    expect(r.material.cert).toContain('BEGIN CERTIFICATE')
    expect(store.warning).toContain('Enkripsi OS tidak tersedia')
  })
})
