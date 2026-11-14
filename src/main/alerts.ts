import { hostname } from 'node:os'
import { app } from 'electron'
import { ALERT_CHECK_MS, type AlertEvent, type AlertTrack, evaluateAlerts, formatDuration } from '@shared/alerts'
import type { AlertSettings, Result, TileStatus } from '@shared/types'
import { createLogger } from './logger'
import { TelegramApi } from './telegram/api'
import { alertMessage, type PanelInfo, testMessage } from './telegram/alertMessages'

const log = createLogger('peringatan')
const SEND_TIMEOUT_MS = 10_000

export interface AlertDeps {
  settings: () => AlertSettings
  statuses: () => Record<string, TileStatus>
  /** Nama panel yang mudah dikenali (label atau host URL), nomor monitor, dan nomor panel seperti di /status. */
  describe: (tileId: string) => PanelInfo
  /** Token bot Telegram dari vault (null = belum diisi). */
  telegramToken: () => Promise<string | null>
}

/**
 * Memantau status panel dan mengirim peringatan ke webhook / Telegram bila panel bermasalah
 * terus-menerus melewati batas waktu, serta pesan pulih setelahnya.
 */
export class AlertMonitor {
  private tracks = new Map<string, AlertTrack>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly d: AlertDeps) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), ALERT_CHECK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick(now = Date.now()): Promise<void> {
    const s = this.d.settings()
    if (!s.enabled) {
      this.tracks.clear()
      return
    }
    const res = evaluateAlerts(this.tracks, this.d.statuses(), now, {
      thresholdMs: s.afterMinutes * 60_000,
      notifyRecovery: s.notifyRecovery
    })
    this.tracks = res.tracks
    for (const ev of res.events) {
      const sent = await this.send(this.message(ev), ev)
      if (!sent.ok) log.warn(`peringatan panel ${ev.tileId} gagal dikirim: ${sent.error}`)
    }
  }

  /** Kirim pesan uji ke semua saluran yang diisi. */
  test(): Promise<Result> {
    return this.send(`✅ Uji peringatan dari Video Wall NR di komputer "${hostname()}". Saluran ini siap menerima peringatan.`)
  }

  /** Teks biasa untuk webhook (Slack, Discord, dll.); Telegram memakai versi berformat dari alertMessage(). */
  private message(ev: AlertEvent): string {
    const p = this.d.describe(ev.tileId)
    const where = `"${p.name}"${p.monitor !== null ? ` (monitor ${p.monitor})` : ''} di komputer "${hostname()}"`
    if (ev.kind === 'up') return `✅ Panel pulih: ${where} kembali normal setelah bermasalah ${formatDuration(ev.durationMs)}.`
    return `⚠️ Panel bermasalah: ${where} tidak tampil normal selama ${formatDuration(ev.durationMs)}.${ev.error ? `\nPenyebab: ${ev.error}` : ''}`
  }

  private async send(text: string, ev?: AlertEvent): Promise<Result> {
    const s = this.d.settings()
    const token = s.telegramChatId ? await this.d.telegramToken() : null
    const jobs: Array<Promise<string | null>> = []
    if (s.webhookUrl) {
      const body = {
        text,
        content: text, // Discord
        app: 'Video Wall NR',
        version: app.getVersion(),
        host: hostname(),
        ...(ev ? { event: ev.kind, tileId: ev.tileId, durationMs: ev.durationMs } : { event: 'test' })
      }
      jobs.push(post(s.webhookUrl, body).then((err) => (err ? `Webhook: ${err}` : null)))
    }
    if (s.telegramChatId && token) {
      const formatted = ev ? alertMessage(ev, this.d.describe(ev.tileId), hostname()) : testMessage(hostname())
      jobs.push(
        new TelegramApi(token)
          .sendMessage(s.telegramChatId, formatted)
          .then(() => null)
          .catch((err: unknown) => `Telegram: ${err instanceof Error ? err.message : String(err)}`)
      )
    }
    if (jobs.length === 0) return { ok: false, error: 'Belum ada saluran: isi URL webhook, atau chat ID + token bot Telegram' }
    const errors = (await Promise.all(jobs)).filter((e): e is string => e !== null)
    return errors.length ? { ok: false, error: errors.join(' · ') } : { ok: true }
  }
}

/** POST JSON; mengembalikan pesan error atau null bila berhasil. */
async function post(url: string, body: object): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    })
    if (res.ok) return null
    const detail = (await res.text().catch(() => '')).slice(0, 200)
    return `HTTP ${res.status}${detail ? ` ${detail}` : ''}`
  } catch (err) {
    return err instanceof Error ? (err.name === 'TimeoutError' ? 'tidak ada respons (10 detik)' : err.message) : String(err)
  }
}
