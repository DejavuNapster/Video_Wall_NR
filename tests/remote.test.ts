import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDefaultPreset } from '@shared/layout'
import { SettingsSchema } from '@shared/schema'
import type { AppState } from '@shared/types'
import { hashPassword, LoginLimiter, SessionStore, verifyPassword } from '../src/main/remote/auth'
import { RemoteServer } from '../src/main/remote/server'

describe('hash password', () => {
  it('cocok hanya dengan password yang benar; salt berbeda tiap hash', () => {
    const h = hashPassword('rahasia-123')
    expect(verifyPassword(h, 'rahasia-123')).toBe(true)
    expect(verifyPassword(h, 'rahasia-124')).toBe(false)
    expect(hashPassword('rahasia-123')).not.toBe(h)
    expect(verifyPassword('format-salah', 'rahasia-123')).toBe(false)
  })
})

describe('SessionStore & LoginLimiter', () => {
  it('sesi kedaluwarsa dan bisa dicabut', () => {
    let now = 0
    const s = new SessionStore(1000, () => now)
    const a = s.create()
    expect(s.valid(a)).toBe(true)
    now = 1000
    expect(s.valid(a)).toBe(false)
    const b = s.create()
    s.revoke(b)
    expect(s.valid(b)).toBe(false)
    expect(s.valid(undefined)).toBe(false)
  })

  it('dikunci setelah 5 kali gagal, lalu dibuka lagi', () => {
    let now = 0
    const l = new LoginLimiter(5, 60_000, () => now)
    for (let i = 0; i < 4; i++) l.fail('1.2.3.4')
    expect(l.lockedFor('1.2.3.4')).toBe(0)
    l.fail('1.2.3.4')
    expect(l.lockedFor('1.2.3.4')).toBe(60_000)
    expect(l.lockedFor('5.6.7.8')).toBe(0)
    now = 60_000
    expect(l.lockedFor('1.2.3.4')).toBe(0)
  })
})

describe('RemoteServer (HTTP)', () => {
  const PORT = 18_000 + Math.floor(Math.random() * 2000)
  const base = `http://127.0.0.1:${PORT}`
  const hash = hashPassword('password-uji')
  const preset = createDefaultPreset(1, 'p1', 'Dashboard')
  const state = {
    presets: [{ id: 'p1', name: 'Dashboard', updatedAt: '' }],
    activePresetId: 'p1',
    activePreset: preset,
    displays: [{ id: 1, label: '', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, primary: true, slot: 0, virtual: false }],
    tileStatus: {},
    settings: SettingsSchema.parse({}),
    banner: null,
    version: '9.9.9'
  } as unknown as AppState
  const deps = {
    settings: () => ({ enabled: true, port: PORT }),
    passwordHash: async () => hash,
    state: () => state,
    thumbnails: async () => ({ t1: 'data:image/jpeg;base64,AAAA' }),
    activatePreset: vi.fn(async () => ({ ok: true as const })),
    updateWall: vi.fn(async () => ({ ok: true as const })),
    showBanner: vi.fn(),
    clearBanner: vi.fn(),
    reloadTile: vi.fn(() => true),
    onStatus: vi.fn()
  }
  const server = new RemoteServer(deps)
  let cookie = ''
  const post = (path: string, body: object, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-vwnr': '1', ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body) })

  beforeAll(async () => {
    await server.apply()
  })
  afterAll(async () => {
    await server.stop()
  })

  it('berjalan dan menyajikan halaman kendali', async () => {
    expect(server.status().running).toBe(true)
    const res = await fetch(base + '/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(await res.text()).toContain('Video Wall NR')
    expect((await fetch(base + '/remote.js')).status).toBe(200)
  })

  it('API butuh login; password salah ditolak; POST tanpa header khusus ditolak', async () => {
    expect((await fetch(base + '/api/state')).status).toBe(401)
    expect((await post('/api/login', { password: 'salah' })).status).toBe(401)
    expect((await post('/api/login', { password: 'password-uji' }, { 'x-vwnr': '0' })).status).toBe(403)
  })

  it('login benar memberi cookie sesi; state dan aksi berjalan', async () => {
    const res = await post('/api/login', { password: 'password-uji' })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/SameSite=Strict/)
    cookie = setCookie.split(';')[0]!

    const st = (await (await fetch(base + '/api/state', { headers: { cookie } })).json()) as Record<string, unknown>
    expect(st).toMatchObject({ ok: true, version: '9.9.9', activePresetId: 'p1', displayMode: false })
    expect((st['monitors'] as Array<{ tiles: unknown[] }>)[0]!.tiles).toHaveLength(4)

    expect((await post('/api/preset', { id: 'p1' })).status).toBe(200)
    expect(deps.activatePreset).toHaveBeenCalledWith('p1')
    expect((await post('/api/display-mode', { on: true })).status).toBe(200)
    expect(deps.updateWall).toHaveBeenCalledWith({ displayMode: true })
    expect((await post('/api/banner', { text: 'Rapat 13.00' })).status).toBe(200)
    expect(deps.showBanner).toHaveBeenCalledWith(expect.objectContaining({ text: 'Rapat 13.00', title: 'Pengumuman', sound: false }))
    expect((await post('/api/banner', { text: '' })).status).toBe(400)
    expect((await post('/api/tile/reload', { id: 't1' })).status).toBe(200)
    expect((await post('/api/preset', { id: '../x' })).status).toBe(400)
    const thumbs = (await (await fetch(base + '/api/thumbnails', { headers: { cookie } })).json()) as { thumbnails: object }
    expect(thumbs.thumbnails).toHaveProperty('t1')
  })

  it('ganti password mengeluarkan semua sesi', async () => {
    await server.passwordChanged()
    expect((await fetch(base + '/api/state', { headers: { cookie } })).status).toBe(401)
  })

  it('login dikunci setelah 5 percobaan gagal', async () => {
    cookie = ''
    for (let i = 0; i < 5; i++) await post('/api/login', { password: 'salah' })
    const res = await post('/api/login', { password: 'password-uji' })
    expect(res.status).toBe(429)
  })
})
