import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net'
import { hostname, networkInterfaces } from 'node:os'
import { z } from 'zod'
import { BANNER_THEMES } from '@shared/bannerThemes'
import { EmergencyBannerSchema } from '@shared/schema'
import { TICKER_SPEEDS, TICKER_STYLES, TickerPatchSchema, type TickerPatch } from '@shared/ticker'
import { tileSummary } from '@shared/tileSummary'
import type { AppState, EmergencyBanner, RemoteStatus, Result, Thumbnails } from '@shared/types'
import { cyclePages } from '@shared/webPanel'
import { createLogger } from '../logger'
import { LoginLimiter, SessionStore, verifyPassword } from './auth'
import { MONITOR_ACTIONS, type RemoteMonitorAction, type RemoteTileAction, TILE_ACTIONS } from './control'
import { type ScreenInput, ScreenInputSchema } from './screen'
import { certInfo, certNames, type CertInfo, type TlsMaterial } from './tls'
import clientCss from './client.css?raw'
import clientHtml from './client.html?raw'
import clientJs from './client.js?raw'

const log = createLogger('remote')
const COOKIE = 'vwnr_session'
const MAX_BODY = 32 * 1024
/** Sertifikat diperiksa berkala: dibuat ulang bila alamat IP berubah atau masa berlakunya hampir habis. */
const CERT_CHECK_MS = 10 * 60_000
/** Koneksi yang tidak mengirim apa pun setelah tersambung diputus. */
const FIRST_BYTE_TIMEOUT_MS = 10_000
/** Byte pertama TLS ClientHello (record "handshake"); selain ini dianggap HTTP biasa. */
const TLS_HANDSHAKE = 0x16
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)

export interface RemoteDeps {
  settings: () => { enabled: boolean; port: number; screenControl: boolean }
  /** Sertifikat HTTPS self-signed yang masih berlaku untuk nama-nama ini (dibuat ulang bila perlu). */
  tls: {
    ensure(names: string[]): Promise<{ material: TlsMaterial; renewed: boolean }>
    readonly warning: string | undefined
  }
  /** Hash password dari vault (null = belum diatur; server tidak dijalankan). */
  passwordHash: () => Promise<string | null>
  state: () => AppState
  thumbnails: () => Promise<Thumbnails>
  activatePreset: (id: string) => Promise<Result>
  updateWall: (patch: { displayMode?: boolean; rotation?: { enabled: boolean } }) => Promise<Result>
  showBanner: (banner: EmergencyBanner) => void
  clearBanner: () => void
  reloadTile: (tileId: string) => boolean
  /** Kendali wall: navigasi/layar penuh/zoom panel, ganti URL, aksi monitor, preset sebelumnya/berikutnya. */
  control: {
    tile(tileId: string, action: RemoteTileAction): Promise<Result>
    setUrl(tileId: string, url: string): Promise<Result>
    ticker(tileId: string, patch: TickerPatch): Promise<Result>
    monitor(slot: number, action: RemoteMonitorAction): Result
    stepPreset(dir: 1 | -1): Promise<Result>
    monitorView(slot: number): {
      panelFullscreenTileId: string | null
      windowFullscreen: boolean
      cyclePositions: Record<string, { index: number; total: number }>
    } | null
    /** Layar kendali: gambar panel web dan masukan klik/gulir/ketik. */
    screenFrame(tileId: string, maxWidth: number): Promise<{ jpeg: Buffer } | { error: string }>
    screenInput(tileId: string, input: ScreenInput): Result
  }
  /** Status server berubah (mulai / berhenti / gagal) → perbarui UI Operator. */
  onStatus: () => void
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

interface Listener {
  net: NetServer
  secure: HttpsServer
  plain: HttpServer
  sockets: Set<Socket>
}

/**
 * Server HTTPS kecil di jaringan lokal: halaman kendali untuk ponsel/PC lain + API JSON. Satu port melayani
 * HTTPS; permintaan HTTP biasa ke port yang sama dialihkan ke HTTPS sehingga password tidak pernah dikirim tanpa
 * enkripsi.
 */
export class RemoteServer {
  private server: Listener | null = null
  private port = 0
  private error: string | undefined
  private passwordSet = false
  private cert: CertInfo | null = null
  private certTimer: NodeJS.Timeout | null = null
  private applying: Promise<void> = Promise.resolve()
  private readonly sessions = new SessionStore()
  private readonly limiter = new LoginLimiter()

  constructor(private readonly d: RemoteDeps) {}

  status(): RemoteStatus {
    const running = this.server !== null
    const warning = this.d.tls.warning
    return {
      running,
      urls: running ? lanAddresses().map((ip) => `https://${ip}:${this.port}`) : [],
      passwordSet: this.passwordSet,
      ...(running && this.cert ? { fingerprint: this.cert.fingerprint, certValidTo: this.cert.validTo.toISOString() } : {}),
      ...(this.error ? { error: this.error } : {}),
      ...(running && warning ? { warning } : {})
    }
  }

  /** Sesuaikan server dengan pengaturan: nyalakan, matikan, atau pindah port. */
  apply(): Promise<void> {
    // Berurutan: pembuatan sertifikat saat start butuh waktu, dan dua start bersamaan akan berebut port.
    const run = this.applying.then(() => this.doApply())
    this.applying = run.catch(() => undefined)
    return run
  }

  private async doApply(): Promise<void> {
    const { enabled, port } = this.d.settings()
    this.passwordSet = (await this.d.passwordHash()) !== null
    const wanted = enabled && this.passwordSet
    if (this.server && (!wanted || port !== this.port)) await this.stop()
    this.error = enabled && !this.passwordSet ? 'Atur password terlebih dahulu' : undefined
    if (wanted && !this.server) await this.start(port)
    this.d.onStatus()
  }

  /** Password diganti: semua perangkat harus masuk ulang. */
  async passwordChanged(): Promise<void> {
    this.sessions.clear()
    await this.apply()
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.sessions.clear()
    if (this.certTimer) clearInterval(this.certTimer)
    this.certTimer = null
    if (!server) return
    server.secure.closeAllConnections()
    server.plain.closeAllConnections()
    for (const s of server.sockets) s.destroy()
    await new Promise<void>((resolve) => server.net.close(() => resolve()))
    log.info('kendali jarak jauh berhenti')
  }

  private async start(port: number): Promise<void> {
    let material: TlsMaterial
    try {
      material = (await this.d.tls.ensure(currentCertNames())).material
      this.cert = certInfo(material.cert)
    } catch (err) {
      this.error = `Sertifikat HTTPS gagal dibuat: ${err instanceof Error ? err.message : String(err)}`
      log.error('sertifikat kendali jarak jauh gagal dibuat', err)
      return
    }

    const secure = createHttpsServer({ cert: material.cert, key: material.key, minVersion: 'TLSv1.2' }, (req, res) => {
      void this.handle(req, res).catch((err: unknown) => {
        const status = err instanceof HttpError ? err.status : 500
        if (status === 500) log.error('permintaan gagal', err)
        sendJson(res, status, { ok: false, error: err instanceof Error ? err.message : String(err) })
      })
    })
    secure.on('tlsClientError', () => undefined) // browser menolak sertifikat self-signed sebelum pengguna menyetujuinya
    const plain = createHttpServer((req, res) => redirectToHttps(req, res, port))
    const sockets = new Set<Socket>()
    // Satu port untuk HTTPS dan HTTP: byte pertama koneksi menentukan server yang melayaninya.
    const net = createNetServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => socket.destroy())
      socket.setTimeout(FIRST_BYTE_TIMEOUT_MS, () => socket.destroy())
      socket.once('data', (first: Buffer) => {
        socket.setTimeout(0)
        socket.pause()
        socket.unshift(first)
        ;(first[0] === TLS_HANDSHAKE ? secure : plain).emit('connection', socket)
        process.nextTick(() => socket.resume())
      })
    })

    await new Promise<void>((resolve) => {
      net.once('error', (err: NodeJS.ErrnoException) => {
        this.error = err.code === 'EADDRINUSE' ? `Port ${port} sudah dipakai aplikasi lain` : err.message
        log.warn(`kendali jarak jauh gagal mulai: ${this.error}`)
        resolve()
      })
      net.listen(port, '0.0.0.0', () => {
        net.on('error', (err) => log.warn(`kendali jarak jauh: ${err.message}`))
        this.server = { net, secure, plain, sockets }
        this.port = port
        this.error = undefined
        this.certTimer = setInterval(() => void this.refreshCert(), CERT_CHECK_MS)
        log.info(`kendali jarak jauh (HTTPS) aktif di port ${port}, sertifikat ${this.cert?.fingerprint}`)
        resolve()
      })
    })
  }

  /** Alamat IP berubah atau sertifikat hampir habis → pasang sertifikat baru tanpa memutus server. */
  async refreshCert(): Promise<void> {
    const server = this.server
    if (!server) return
    try {
      const { material, renewed } = await this.d.tls.ensure(currentCertNames())
      if (!renewed || this.server !== server) return
      server.secure.setSecureContext({ cert: material.cert, key: material.key, minVersion: 'TLSv1.2' })
      this.cert = certInfo(material.cert)
      log.info(`sertifikat kendali jarak jauh diperbarui: ${this.cert.fingerprint}`)
      this.d.onStatus()
    } catch (err) {
      log.warn(`sertifikat kendali jarak jauh gagal diperbarui: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'https://localhost')
    const route = `${req.method} ${url.pathname}`
    const ip = req.socket.remoteAddress ?? '?'

    switch (route) {
      case 'GET /':
        return sendText(res, 200, clientHtml, 'text/html; charset=utf-8')
      case 'GET /remote.css':
        return sendText(res, 200, clientCss, 'text/css; charset=utf-8')
      case 'GET /remote.js':
        return sendText(res, 200, clientJs, 'text/javascript; charset=utf-8')
      case 'GET /api/session':
        return sendJson(res, 200, { ok: true, authenticated: this.sessions.valid(sessionOf(req)) })
    }

    if (req.method === 'POST' && req.headers['x-vwnr'] !== '1') throw new HttpError(403, 'Permintaan ditolak')

    if (route === 'POST /api/login') {
      const locked = this.limiter.lockedFor(ip)
      if (locked > 0) throw new HttpError(429, `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(locked / 1000)} detik.`)
      const { password } = parse(z.object({ password: z.string().max(256) }), await readBody(req))
      const hash = await this.d.passwordHash()
      if (!hash || !verifyPassword(hash, password)) {
        this.limiter.fail(ip)
        log.warn(`login kendali jarak jauh gagal dari ${ip}`)
        throw new HttpError(401, 'Password salah')
      }
      this.limiter.succeed(ip)
      const token = this.sessions.create()
      res.setHeader('set-cookie', `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${this.sessions.ttlSeconds}`)
      log.info(`login kendali jarak jauh dari ${ip}`)
      return sendJson(res, 200, { ok: true })
    }
    if (route === 'POST /api/logout') {
      this.sessions.revoke(sessionOf(req))
      res.setHeader('set-cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`)
      return sendJson(res, 200, { ok: true })
    }

    if (!this.sessions.valid(sessionOf(req))) throw new HttpError(401, 'Sesi berakhir, silakan masuk lagi')

    switch (route) {
      case 'GET /api/state':
        return sendJson(res, 200, { ok: true, ...this.snapshot() })
      case 'GET /api/thumbnails':
        return sendJson(res, 200, { ok: true, thumbnails: await this.d.thumbnails() })
      case 'POST /api/preset': {
        const body = parse(z.object({ id }), await readBody(req))
        return sendResult(res, await this.d.activatePreset(body.id))
      }
      case 'POST /api/display-mode': {
        const body = parse(z.object({ on: z.boolean() }), await readBody(req))
        return sendResult(res, await this.d.updateWall({ displayMode: body.on }))
      }
      case 'POST /api/rotation': {
        const body = parse(z.object({ enabled: z.boolean() }), await readBody(req))
        return sendResult(res, await this.d.updateWall({ rotation: { enabled: body.enabled } }))
      }
      case 'POST /api/banner': {
        this.d.showBanner(parse(EmergencyBannerSchema, await readBody(req)))
        return sendJson(res, 200, { ok: true })
      }
      case 'POST /api/banner/template': {
        const body = parse(z.object({ id }), await readBody(req))
        const template = this.d.state().settings.bannerTemplates.find((t) => t.id === body.id)
        if (!template) throw new HttpError(404, 'Templat banner tidak ditemukan')
        this.d.showBanner(template.banner)
        return sendJson(res, 200, { ok: true })
      }
      case 'POST /api/banner/clear':
        this.d.clearBanner()
        return sendJson(res, 200, { ok: true })
      case 'POST /api/tile/reload': {
        const body = parse(z.object({ id }), await readBody(req))
        return sendResult(res, this.d.reloadTile(body.id) ? { ok: true } : { ok: false, error: 'Panel tidak sedang tampil di wall' })
      }
      case 'POST /api/tile/action': {
        const body = parse(z.object({ id, action: z.enum(TILE_ACTIONS) }), await readBody(req))
        return sendResult(res, await this.d.control.tile(body.id, body.action))
      }
      case 'POST /api/tile/url': {
        const body = parse(z.object({ id, url: z.string().trim().min(1, 'URL tidak boleh kosong').max(2048) }), await readBody(req))
        return sendResult(res, await this.d.control.setUrl(body.id, body.url))
      }
      case 'POST /api/tile/ticker': {
        const body = parse(z.object({ id, patch: TickerPatchSchema }), await readBody(req))
        return sendResult(res, await this.d.control.ticker(body.id, body.patch))
      }
      case 'POST /api/monitor/action': {
        const body = parse(z.object({ slot: z.number().int().min(0).max(31), action: z.enum(MONITOR_ACTIONS) }), await readBody(req))
        return sendResult(res, this.d.control.monitor(body.slot, body.action))
      }
      case 'POST /api/preset/step': {
        const body = parse(z.object({ dir: z.union([z.literal(1), z.literal(-1)]) }), await readBody(req))
        return sendResult(res, await this.d.control.stepPreset(body.dir))
      }
      case 'GET /api/tile/screen': {
        this.requireScreenControl()
        const q = parse(
          z.object({ id, w: z.coerce.number().int().min(160).max(1920).default(1280) }),
          Object.fromEntries(url.searchParams)
        )
        const frame = await this.d.control.screenFrame(q.id, q.w)
        if ('error' in frame) throw new HttpError(409, frame.error)
        res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'image/jpeg', 'content-length': frame.jpeg.length })
        res.end(frame.jpeg)
        return
      }
      case 'POST /api/tile/input': {
        this.requireScreenControl()
        const body = parse(z.object({ id, input: ScreenInputSchema }), await readBody(req))
        return sendResult(res, this.d.control.screenInput(body.id, body.input))
      }
    }
    throw new HttpError(404, 'Tidak ditemukan')
  }

  private requireScreenControl(): void {
    if (!this.d.settings().screenControl) {
      throw new HttpError(403, 'Kendali layar belum diizinkan. Aktifkan di Operator › Pengaturan › Kendali jarak jauh.')
    }
  }

  /** Ringkasan state untuk halaman kendali (tanpa pengaturan internal). */
  private snapshot(): object {
    const s = this.d.state()
    const wallSlots = new Set(s.displays.filter((d) => d.slot !== null).map((d) => d.slot))
    return {
      app: 'Video Wall NR',
      version: s.version,
      host: hostname(),
      presets: s.presets.map((p) => ({ id: p.id, name: p.name })),
      activePresetId: s.activePresetId,
      displayMode: s.settings.wall.displayMode,
      screenControl: this.d.settings().screenControl,
      rotation: s.settings.wall.rotation.enabled,
      scheduleActive: s.settings.wall.schedule.some((e) => e.enabled),
      banner: s.banner
        ? { title: s.banner.banner.title, text: s.banner.banner.text, pinned: s.banner.banner.pinned, setAt: s.banner.setAt, durationSec: s.banner.banner.durationSec }
        : null,
      templates: s.settings.bannerTemplates.map((t) => ({ id: t.id, name: t.name })),
      themes: BANNER_THEMES,
      tickerStyles: TICKER_STYLES.map((t) => ({ id: t.id, name: t.name, bg: t.style.bgColor, fg: t.style.fgColor })),
      tickerSpeeds: TICKER_SPEEDS,
      monitors: (s.activePreset?.monitors ?? [])
        .filter((m) => wallSlots.has(m.slot))
        .map((m) => {
          const view = this.d.control.monitorView(m.slot)
          return {
            slot: m.slot,
            panelFullscreenTileId: view?.panelFullscreenTileId ?? null,
            windowFullscreen: view?.windowFullscreen ?? false,
            tiles: m.tiles.map((t) => {
              const st = s.tileStatus[t.id]
              const web = t.source.type === 'web' ? t.source : null
              const ticker = t.source.type === 'ticker' ? t.source : null
              return {
                id: t.id,
                summary: tileSummary(t),
                type: t.source.type,
                state: st?.state ?? null,
                error: st && st.state !== 'ok' ? st.lastError : undefined,
                ...(web
                  ? {
                      url: web.url,
                      pageUrl: st?.pageUrl || web.url,
                      canGoBack: st?.canGoBack ?? false,
                      canGoForward: st?.canGoForward ?? false,
                      zoom: web.zoom,
                      cycle: web.cycle ? (view?.cyclePositions[t.id] ?? { index: 1, total: cyclePages(web).length }) : null
                    }
                  : {}),
                ...(ticker
                  ? {
                      ticker: {
                        text: ticker.text,
                        badge: ticker.badge,
                        paused: ticker.paused,
                        motion: ticker.motion,
                        speedSec: ticker.speedSec,
                        bgColor: ticker.bgColor,
                        fgColor: ticker.fgColor
                      }
                    }
                  : {})
              }
            })
          }
        })
    }
  }
}

/** Alamat IPv4 jaringan lokal komputer ini. */
function lanAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address)
  }
  return out
}

function currentCertNames(): string[] {
  return certNames(hostname(), lanAddresses())
}

/** Permintaan HTTP biasa: halaman dialihkan ke HTTPS; API ditolak supaya password tidak terkirim tanpa enkripsi. */
function redirectToHttps(req: IncomingMessage, res: ServerResponse, port: number): void {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '')
  const safeHost = /^[a-z0-9.-]{1,253}$/i.test(host) ? host : (lanAddresses()[0] ?? 'localhost')
  const path = (req.url ?? '/').startsWith('/') ? (req.url ?? '/') : '/'
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 400, { ok: false, error: `Gunakan https://${safeHost}:${port}` })
  }
  res.writeHead(301, { ...SECURITY_HEADERS, location: `https://${safeHost}:${port}${path.startsWith('/api/') ? '/' : path}` })
  res.end()
}

function sessionOf(req: IncomingMessage): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, v] = part.trim().split('=')
    if (k === COOKIE && v) return v
  }
  return undefined
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Permintaan terlalu besar'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new HttpError(400, 'Format permintaan tidak valid'))
      }
    })
    req.on('error', reject)
  })
}

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw)
  if (!r.success) throw new HttpError(400, `Permintaan tidak valid: ${r.error.issues[0]?.message ?? 'format salah'}`)
  return r.data
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
}

function sendText(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type })
  res.end(body)
}

function sendJson(res: ServerResponse, status: number, body: object): void {
  if (res.headersSent) return
  sendText(res, status, JSON.stringify(body), 'application/json; charset=utf-8')
}

function sendResult(res: ServerResponse, r: Result): void {
  sendJson(res, r.ok ? 200 : 400, r)
}
