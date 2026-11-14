import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { BackoffTracker } from '@shared/backoff'
import type { Settings, SidecarState } from '@shared/types'
import { dataPath, resourcePath } from './config'
import { createLogger } from './logger'

const log = createLogger('mediamtx')

export interface PathSpec {
  /** URL RTSP lengkap (sudah berisi kredensial). Hanya hidup di memori MediaMTX, tidak ditulis ke disk. */
  source: string
  transport: 'auto' | 'tcp' | 'udp'
}

export const PATH_PREFIX = 'vw_'

export function mediaPathName(tileId: string): string {
  return `${PATH_PREFIX}${tileId}`
}

/** Sisipkan username/password ke URL RTSP (dengan percent-encoding yang benar). */
export function withCredentials(url: string, username?: string, password?: string | null): string {
  if (!username) return url
  try {
    const u = new URL(url)
    u.username = username
    if (password) u.password = password
    return u.toString()
  } catch {
    return url
  }
}

/**
 * Konfigurasi MediaMTX untuk dipakai app ini: hanya HLS + WebRTC + Control API, semuanya terikat ke
 * 127.0.0.1. Control API (yang bisa menjalankan perintah lewat runOnInit) dikunci dengan token acak
 * per sesi, dan pengguna anonim hanya boleh membaca stream.
 */
export function buildMediaMtxConfig(ports: { api: number; hls: number; webrtc: number }, apiToken: string): string {
  return `# Dibuat otomatis oleh Video Wall Browser. Jangan diedit; akan ditimpa saat aplikasi start.
logLevel: warn
api: yes
apiAddress: 127.0.0.1:${ports.api}
metrics: no
pprof: no
playback: no
rtsp: no
rtmp: no
srt: no
moq: no
hls: yes
hlsAddress: 127.0.0.1:${ports.hls}
hlsAllowOrigins: ['*']
webrtc: yes
webrtcAddress: 127.0.0.1:${ports.webrtc}
webrtcAllowOrigins: ['*']
authMethod: internal
authInternalUsers:
  - user: any
    pass:
    ips: ['127.0.0.1', '::1']
    permissions:
      - action: read
  - user: vwctl
    pass: ${apiToken}
    ips: ['127.0.0.1', '::1']
    permissions:
      - action: api
`
}

export class MediaMtxSidecar extends EventEmitter {
  state: SidecarState = 'stopped'
  message: string | undefined

  private proc: ChildProcess | null = null
  private stopping = false
  private restartTimer: NodeJS.Timeout | null = null
  private readonly backoff = new BackoffTracker()
  private readonly apiToken = randomBytes(24).toString('hex')
  private desired = new Map<string, PathSpec>()
  private reconcileChain: Promise<void> = Promise.resolve()
  private currentPorts = { api: 9997, hls: 8888, webrtc: 8889 }
  private readonly tail: string[] = []

  constructor(private readonly getSettings: () => Settings) {
    super()
  }

  /** Port yang dipakai sidecar; dipakai juga untuk memblokir akses dari tile web. */
  ports(): number[] {
    return [this.currentPorts.api, this.currentPorts.hls, this.currentPorts.webrtc]
  }

  endpoints(): { hls: string; webrtc: string } {
    return {
      hls: `http://127.0.0.1:${this.currentPorts.hls}`,
      webrtc: `http://127.0.0.1:${this.currentPorts.webrtc}`
    }
  }

  binaryPath(): string {
    return resourcePath('bin', process.platform === 'win32' ? 'mediamtx.exe' : 'mediamtx')
  }

  private setState(state: SidecarState, message?: string): void {
    this.state = state
    this.message = message
    this.emit('state')
  }

  async start(): Promise<void> {
    const cfg = this.getSettings().mediaMtx
    if (!cfg.enabled) {
      this.setState('disabled', 'MediaMTX dimatikan di pengaturan')
      return
    }
    const bin = this.binaryPath()
    if (!existsSync(bin)) {
      this.setState('failed', `Binary MediaMTX tidak ditemukan di ${bin}. Jalankan "npm run fetch:mediamtx" lalu restart aplikasi.`)
      return
    }

    this.stopping = false
    this.currentPorts = { api: cfg.apiPort, hls: cfg.hlsPort, webrtc: cfg.webrtcPort }
    const cfgPath = dataPath('mediamtx.yml')
    await mkdir(dirname(cfgPath), { recursive: true })
    await writeFile(cfgPath, buildMediaMtxConfig(this.currentPorts, this.apiToken), { encoding: 'utf8', mode: 0o600 })

    this.setState('starting')
    // cwd = folder data aplikasi: MediaMTX tidak boleh menulis file apa pun ke folder instalasi (mis. /opt, Program Files).
    const proc = spawn(bin, [cfgPath], { cwd: dirname(cfgPath), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    this.proc = proc

    const onData = (chunk: Buffer): void => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue
        this.tail.push(line)
        if (this.tail.length > 50) this.tail.shift()
        log.info(line)
      }
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.on('error', (err) => {
      this.proc = null
      this.setState('failed', `Gagal menjalankan MediaMTX: ${err.message}`)
      this.scheduleRestart()
    })
    proc.on('exit', (code, signal) => {
      if (this.proc === proc) this.proc = null
      if (this.stopping) {
        this.setState('stopped')
        return
      }
      const last = this.tail.slice(-3).join(' | ')
      this.setState('failed', `MediaMTX berhenti (code=${code}, signal=${signal})${last ? `: ${last}` : ''}`)
      this.scheduleRestart()
    })

    if (await this.waitReady(proc)) {
      this.backoff.reset()
      this.setState('running')
      await this.reconcile()
    }
  }

  private async waitReady(proc: ChildProcess): Promise<boolean> {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (this.proc !== proc || proc.exitCode !== null) return false
      try {
        const res = await this.api('GET', '/v3/config/global/get')
        if (res.ok) return true
      } catch {
        /* belum siap */
      }
      await new Promise((r) => setTimeout(r, 300))
    }
    if (this.proc === proc) this.setState('failed', 'MediaMTX tidak merespons Control API dalam 15 detik')
    return false
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer) return
    const delay = this.backoff.failure()
    log.warn(`restart MediaMTX dalam ${delay} ms`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.start().catch((err) => log.error('start ulang gagal', err))
    }, delay)
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    const proc = this.proc
    if (!proc || proc.exitCode !== null) {
      this.setState('stopped')
      return
    }
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => proc.kill('SIGKILL'), 3000)
      proc.once('exit', () => {
        clearTimeout(force)
        resolve()
      })
      proc.kill()
    })
  }

  private api(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`http://127.0.0.1:${this.currentPorts.api}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`vwctl:${this.apiToken}`).toString('base64')}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000)
    })
  }

  /** Tetapkan daftar path yang diinginkan; langsung direkonsiliasi bila MediaMTX sedang berjalan. */
  async setPaths(desired: Map<string, PathSpec>): Promise<void> {
    this.desired = new Map(desired)
    await this.reconcile()
  }

  private reconcile(): Promise<void> {
    this.reconcileChain = this.reconcileChain.then(() => this.doReconcile()).catch((err) => log.error('reconcile gagal', err))
    return this.reconcileChain
  }

  private async doReconcile(): Promise<void> {
    // Sedang dimatikan (mis. dinonaktifkan di pengaturan): proses akan hilang, jangan panggil API-nya.
    if (this.state !== 'running' || this.stopping) return
    const listRes = await this.api('GET', '/v3/config/paths/list?itemsPerPage=1000')
    if (!listRes.ok) throw new Error(`list path gagal: HTTP ${listRes.status}`)
    const listed = (await listRes.json()) as { items?: Array<{ name?: string }> }
    const existing = new Set((listed.items ?? []).map((i) => i.name).filter((n): n is string => typeof n === 'string'))

    for (const name of existing) {
      if (name.startsWith(PATH_PREFIX) && !this.desired.has(name)) {
        await this.api('DELETE', `/v3/config/paths/delete/${encodeURIComponent(name)}`)
      }
    }
    for (const [name, spec] of this.desired) {
      const body: Record<string, unknown> = { source: spec.source, sourceOnDemand: false }
      if (spec.transport !== 'auto') body['rtspTransport'] = spec.transport
      const verb = existing.has(name) ? 'patch' : 'add'
      const res = await this.api(verb === 'add' ? 'POST' : 'PATCH', `/v3/config/paths/${verb}/${encodeURIComponent(name)}`, body)
      if (!res.ok) log.warn(`${verb} path ${name} gagal: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    }
  }
}
