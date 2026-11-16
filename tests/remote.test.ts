import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDefaultPreset } from '@shared/layout'
import { SettingsSchema, SourceSchema } from '@shared/schema'
import type { AppState } from '@shared/types'
import { hashPassword, LoginLimiter, SessionStore, verifyPassword } from '../src/main/remote/auth'
import { RemoteServer } from '../src/main/remote/server'
import { certInfo, type TlsMaterial, TlsStore } from '../src/main/remote/tls'

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

interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: Buffer
  text: string
  json: () => Record<string, unknown>
}

describe('RemoteServer (HTTPS)', () => {
  const PORT = 18_000 + Math.floor(Math.random() * 2000)
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
  const remoteSettings = { enabled: true, port: PORT, screenControl: false }
  let saved: TlsMaterial | null = null
  const deps = {
    settings: () => remoteSettings,
    tls: new TlsStore({ load: async () => saved, save: async (m) => void (saved = m) }),
    passwordHash: async () => hash,
    state: () => state,
    thumbnails: async () => ({ t1: 'data:image/jpeg;base64,AAAA' }),
    activatePreset: vi.fn(async () => ({ ok: true as const })),
    updateWall: vi.fn(async () => ({ ok: true as const })),
    showBanner: vi.fn(),
    clearBanner: vi.fn(),
    reloadTile: vi.fn(() => true),
    control: {
      tile: vi.fn(async () => ({ ok: true as const })),
      setUrl: vi.fn(async () => ({ ok: true as const })),
      ticker: vi.fn(async () => ({ ok: true as const })),
      monitor: vi.fn(() => ({ ok: true as const })),
      stepPreset: vi.fn(async () => ({ ok: true as const })),
      monitorView: vi.fn(() => ({ panelFullscreenTileId: null, windowFullscreen: true, cyclePositions: {} })),
      screenFrame: vi.fn(async (): Promise<{ jpeg: Buffer } | { error: string }> => ({ jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) })),
      screenInput: vi.fn(() => ({ ok: true as const }))
    },
    onStatus: vi.fn()
  }
  const server = new RemoteServer(deps)
  let cookie = ''

  /** Permintaan HTTPS yang memverifikasi sertifikat server terhadap sertifikat self-signed itu sendiri. */
  const call = (method: string, path: string, body?: object, headers: Record<string, string> = {}): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body)
      const req = httpsRequest(
        {
          host: '127.0.0.1',
          port: PORT,
          method,
          path,
          ca: saved?.cert,
          headers: {
            ...(payload ? { 'content-type': 'application/json', 'x-vwnr': '1' } : {}),
            ...(cookie ? { cookie } : {}),
            ...headers
          }
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => {
            const buf = Buffer.concat(chunks)
            const text = buf.toString('utf8')
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf, text, json: () => JSON.parse(text) as Record<string, unknown> })
          })
        }
      )
      req.on('error', reject)
      req.end(payload)
    })
  const get = (path: string): Promise<Reply> => call('GET', path)
  const post = (path: string, body: object, headers: Record<string, string> = {}): Promise<Reply> => call('POST', path, body, headers)
  /** HTTP biasa (tanpa TLS) ke port yang sama. */
  const plain = (method: string, path: string): Promise<{ status: number; location?: string }> =>
    new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: PORT, method, path, headers: { host: `127.0.0.1:${PORT}` } }, (res) => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location }))
      })
      req.on('error', reject)
      req.end()
    })

  beforeAll(async () => {
    await server.apply()
  })
  afterAll(async () => {
    await server.stop()
  })

  it('berjalan lewat HTTPS dengan sertifikat yang tersimpan, dan menyajikan halaman kendali', async () => {
    const st = server.status()
    expect(st.running).toBe(true)
    expect(st.urls.every((u) => u.startsWith('https://'))).toBe(true)
    expect(saved).not.toBeNull()
    expect(st.fingerprint).toBe(certInfo(saved!.cert).fingerprint)
    const res = await get('/')
    expect(res.status).toBe(200)
    expect(res.headers['content-security-policy']).toContain("default-src 'self'")
    expect(res.headers['strict-transport-security']).toBeUndefined()
    expect(res.text).toContain('Video Wall NR')
    expect((await get('/remote.js')).status).toBe(200)
  })

  it('HTTP biasa di port yang sama dialihkan ke HTTPS; API lewat HTTP ditolak', async () => {
    expect(await plain('GET', '/')).toEqual({ status: 301, location: `https://127.0.0.1:${PORT}/` })
    expect(await plain('GET', '/api/state')).toEqual({ status: 301, location: `https://127.0.0.1:${PORT}/` })
    expect((await plain('POST', '/api/login')).status).toBe(400)
  })

  it('API butuh login; password salah ditolak; POST tanpa header khusus ditolak', async () => {
    expect((await get('/api/state')).status).toBe(401)
    expect((await post('/api/login', { password: 'salah' })).status).toBe(401)
    expect((await post('/api/login', { password: 'password-uji' }, { 'x-vwnr': '0' })).status).toBe(403)
  })

  it('login benar memberi cookie sesi Secure; state dan aksi berjalan', async () => {
    const res = await post('/api/login', { password: 'password-uji' })
    expect(res.status).toBe(200)
    const setCookie = String(res.headers['set-cookie'] ?? '')
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/; Secure;/)
    expect(setCookie).toMatch(/SameSite=Strict/)
    cookie = setCookie.split(';')[0]!

    const st = (await get('/api/state')).json()
    expect(st).toMatchObject({ ok: true, version: '9.9.9', activePresetId: 'p1', displayMode: false, screenControl: false })
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
    expect((await get('/api/thumbnails')).json()['thumbnails']).toHaveProperty('t1')
  })

  it('kendali wall: aksi panel (termasuk hapus), ganti URL, aksi monitor, preset berikutnya', async () => {
    const st = (await get('/api/state')).json() as {
      monitors: Array<{ slot: number; windowFullscreen: boolean; panelFullscreenTileId: string | null; tiles: Array<{ id: string }> }>
    }
    expect(st.monitors[0]).toMatchObject({ slot: 0, windowFullscreen: true, panelFullscreenTileId: null })
    const tileId = st.monitors[0]!.tiles[0]!.id

    expect((await post('/api/tile/action', { id: tileId, action: 'fullscreen' })).status).toBe(200)
    expect(deps.control.tile).toHaveBeenCalledWith(tileId, 'fullscreen')
    expect((await post('/api/tile/action', { id: tileId, action: 'remove' })).status).toBe(200)
    expect(deps.control.tile).toHaveBeenCalledWith(tileId, 'remove')
    expect((await post('/api/tile/action', { id: tileId, action: 'hapus' })).status).toBe(400)

    expect((await post('/api/tile/url', { id: tileId, url: ' https://grafana.lan/d/1 ' })).status).toBe(200)
    expect(deps.control.setUrl).toHaveBeenCalledWith(tileId, 'https://grafana.lan/d/1')
    expect((await post('/api/tile/url', { id: tileId, url: '   ' })).status).toBe(400)

    expect((await post('/api/monitor/action', { slot: 0, action: 'reloadAll' })).status).toBe(200)
    expect(deps.control.monitor).toHaveBeenCalledWith(0, 'reloadAll')
    expect((await post('/api/monitor/action', { slot: -1, action: 'show' })).status).toBe(400)

    expect((await post('/api/preset/step', { dir: 1 })).status).toBe(200)
    expect(deps.control.stepPreset).toHaveBeenCalledWith(1)
    expect((await post('/api/preset/step', { dir: 2 })).status).toBe(400)

    deps.control.tile.mockResolvedValueOnce({ ok: false, error: 'Tidak ada halaman sebelumnya' } as never)
    const res = await post('/api/tile/action', { id: tileId, action: 'back' })
    expect(res.status).toBe(400)
    expect(res.json()).toMatchObject({ ok: false, error: 'Tidak ada halaman sebelumnya' })
  })

  it('teks berjalan: isi panel ikut di state, perubahan divalidasi sebelum diteruskan', async () => {
    const tile = preset.monitors[0]!.tiles[0]!
    const before = tile.source
    tile.source = SourceSchema.parse({ type: 'ticker', text: 'Selamat datang\nRapat 14.00', badge: 'INFO' })
    try {
      const st = (await get('/api/state')).json() as {
        tickerStyles: Array<{ id: string }>
        monitors: Array<{ tiles: Array<{ summary: string; ticker?: { text: string; badge: string; paused: boolean } }> }>
      }
      expect(st.tickerStyles.length).toBeGreaterThan(0)
      expect(st.monitors[0]!.tiles[0]).toMatchObject({ summary: 'Selamat datang', ticker: { text: 'Selamat datang\nRapat 14.00', badge: 'INFO', paused: false } })

      expect((await post('/api/tile/ticker', { id: tile.id, patch: { paused: true } })).status).toBe(200)
      expect(deps.control.ticker).toHaveBeenCalledWith(tile.id, { paused: true })
      expect((await post('/api/tile/ticker', { id: tile.id, patch: { style: 'neon', speedSec: 6 } })).status).toBe(200)
      expect((await post('/api/tile/ticker', { id: tile.id, patch: { text: '   ' } })).status).toBe(400)
      expect((await post('/api/tile/ticker', { id: tile.id, patch: { style: 'pelangi' } })).status).toBe(400)
      expect((await post('/api/tile/ticker', { id: tile.id, patch: { fontSize: 99 } })).status).toBe(400)
    } finally {
      tile.source = before
    }
  })

  it('layar kendali hanya bila diizinkan; gambar JPEG dan masukan tervalidasi', async () => {
    expect((await get('/api/tile/screen?id=t1')).status).toBe(403)
    expect((await post('/api/tile/input', { id: 't1', input: { kind: 'key', key: 'Enter' } })).status).toBe(403)
    expect(deps.control.screenInput).not.toHaveBeenCalled()

    remoteSettings.screenControl = true
    expect((await get('/api/state')).json()['screenControl']).toBe(true)
    const frame = await get('/api/tile/screen?id=t1&w=640')
    expect(frame.status).toBe(200)
    expect(frame.headers['content-type']).toBe('image/jpeg')
    expect([...frame.body]).toEqual([0xff, 0xd8, 0xff, 0xd9])
    expect(deps.control.screenFrame).toHaveBeenCalledWith('t1', 640)
    expect((await get('/api/tile/screen?id=t1&w=99999')).status).toBe(400)
    deps.control.screenFrame.mockResolvedValueOnce({ error: 'Panel sedang tidak tampil di wall' })
    const hidden = await get('/api/tile/screen?id=t1')
    expect(hidden.status).toBe(409)
    expect(hidden.json()).toMatchObject({ error: 'Panel sedang tidak tampil di wall' })

    expect((await post('/api/tile/input', { id: 't1', input: { kind: 'tap', x: 0.5, y: 0.5 } })).status).toBe(200)
    expect(deps.control.screenInput).toHaveBeenCalledWith('t1', { kind: 'tap', x: 0.5, y: 0.5, count: 1 })
    expect((await post('/api/tile/input', { id: 't1', input: { kind: 'tap', x: 2, y: 0 } })).status).toBe(400)
    expect((await post('/api/tile/input', { id: 't1', input: { kind: 'text', text: 'halo' } })).status).toBe(200)
    remoteSettings.screenControl = false
  })

  it('layar kendali juga butuh login', async () => {
    remoteSettings.screenControl = true
    const saveCookie = cookie
    cookie = ''
    expect((await get('/api/tile/screen?id=t1')).status).toBe(401)
    cookie = saveCookie
    remoteSettings.screenControl = false
  })

  it('ganti password mengeluarkan semua sesi', async () => {
    await server.passwordChanged()
    expect((await get('/api/state')).status).toBe(401)
  })

  it('login dikunci setelah 5 percobaan gagal', async () => {
    cookie = ''
    for (let i = 0; i < 5; i++) await post('/api/login', { password: 'salah' })
    const res = await post('/api/login', { password: 'password-uji' })
    expect(res.status).toBe(429)
  })
})
