/**
 * Logika murni peringatan panel bermasalah (dipakai AlertMonitor di proses main dan unit test).
 *
 * Aturan:
 * 1. Panel dianggap bermasalah bila statusnya failed / crashed / stalled / unresponsive.
 * 2. Peringatan "down" dikirim SEKALI setelah panel bermasalah terus-menerus selama `thresholdMs`.
 * 3. Begitu panel kembali normal (atau dihapus dari wall), pelacakan direset; bila peringatan "down"
 *    sudah terkirim, peringatan "up" dikirim (bila `notifyRecovery`).
 */
import type { TileState, TileStatus } from './types'

export const ALERT_CHECK_MS = 30_000

const BAD_STATES: ReadonlySet<TileState> = new Set(['failed', 'crashed', 'stalled', 'unresponsive'])

export function isBadState(state: TileState): boolean {
  return BAD_STATES.has(state)
}

export interface AlertTrack {
  /** Sejak kapan (ms) panel bermasalah tanpa henti. */
  since: number
  /** Peringatan "down" sudah dikirim. */
  notified: boolean
}

export interface AlertEvent {
  kind: 'down' | 'up'
  tileId: string
  /** Lama bermasalah (ms) saat event dibuat. */
  durationMs: number
  error?: string
}

/**
 * Hitung event peringatan dari status terbaru. Mengembalikan pelacakan baru (tidak mengubah `tracks`).
 * Panel yang sedang `loading`/`idle` tidak memutus atau memulai pelacakan (pemulihan otomatis sedang berjalan).
 */
export function evaluateAlerts(
  tracks: ReadonlyMap<string, AlertTrack>,
  statuses: Readonly<Record<string, TileStatus>>,
  now: number,
  opts: { thresholdMs: number; notifyRecovery: boolean }
): { tracks: Map<string, AlertTrack>; events: AlertEvent[] } {
  const next = new Map<string, AlertTrack>()
  const events: AlertEvent[] = []

  for (const [tileId, status] of Object.entries(statuses)) {
    const prev = tracks.get(tileId)
    const bad = isBadState(status.state)
    const transitional = status.state === 'loading' || status.state === 'idle'
    if (bad || (transitional && prev)) {
      const track: AlertTrack = prev ? { ...prev } : { since: now, notified: false }
      if (bad && !track.notified && now - track.since >= opts.thresholdMs) {
        track.notified = true
        events.push({ kind: 'down', tileId, durationMs: now - track.since, ...(status.lastError ? { error: status.lastError } : {}) })
      }
      next.set(tileId, track)
    } else if (prev?.notified && opts.notifyRecovery) {
      events.push({ kind: 'up', tileId, durationMs: now - prev.since })
    }
  }
  // Panel yang hilang dari wall (dihapus / preset berganti) dianggap selesai, tanpa pesan pulih.
  return { tracks: next, events }
}

/** "5 menit", "1 jam 20 menit" */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} menit`
  return m === 0 ? `${h} jam` : `${h} jam ${m} menit`
}
