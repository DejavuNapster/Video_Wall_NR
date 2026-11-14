import { describe, expect, it } from 'vitest'
import { type AlertTrack, evaluateAlerts, formatDuration } from '@shared/alerts'
import type { TileState, TileStatus } from '@shared/types'

const st = (tileId: string, state: TileState, lastError?: string): TileStatus => ({
  tileId,
  monitorSlot: 0,
  state,
  restarts: 0,
  ...(lastError ? { lastError } : {})
})
const opts = { thresholdMs: 5 * 60_000, notifyRecovery: true }
const MIN = 60_000

describe('evaluateAlerts', () => {
  it('peringatan "down" sekali setelah melewati batas, lalu "up" saat pulih', () => {
    let tracks = new Map<string, AlertTrack>()
    let r = evaluateAlerts(tracks, { t1: st('t1', 'failed', 'ERR_NAME_NOT_RESOLVED') }, 0, opts)
    expect(r.events).toEqual([])
    tracks = r.tracks

    r = evaluateAlerts(tracks, { t1: st('t1', 'failed', 'ERR_NAME_NOT_RESOLVED') }, 5 * MIN, opts)
    expect(r.events).toEqual([{ kind: 'down', tileId: 't1', durationMs: 5 * MIN, error: 'ERR_NAME_NOT_RESOLVED' }])
    tracks = r.tracks

    r = evaluateAlerts(tracks, { t1: st('t1', 'failed') }, 6 * MIN, opts)
    expect(r.events).toEqual([])
    tracks = r.tracks

    r = evaluateAlerts(tracks, { t1: st('t1', 'ok') }, 8 * MIN, opts)
    expect(r.events).toEqual([{ kind: 'up', tileId: 't1', durationMs: 8 * MIN }])
    expect(r.tracks.size).toBe(0)
  })

  it('gangguan singkat yang pulih sebelum batas tidak dilaporkan', () => {
    const a = evaluateAlerts(new Map(), { t1: st('t1', 'crashed') }, 0, opts)
    const b = evaluateAlerts(a.tracks, { t1: st('t1', 'ok') }, 2 * MIN, opts)
    expect(b.events).toEqual([])
    expect(b.tracks.size).toBe(0)
  })

  it('status loading di tengah pemulihan tidak mereset hitungan', () => {
    const a = evaluateAlerts(new Map(), { t1: st('t1', 'failed') }, 0, opts)
    const b = evaluateAlerts(a.tracks, { t1: st('t1', 'loading') }, 3 * MIN, opts)
    expect(b.tracks.get('t1')?.since).toBe(0)
    const c = evaluateAlerts(b.tracks, { t1: st('t1', 'failed') }, 5 * MIN, opts)
    expect(c.events.map((e) => e.kind)).toEqual(['down'])
  })

  it('tanpa notifyRecovery tidak ada pesan pulih; panel yang dihapus tidak memicu pesan', () => {
    const quiet = { ...opts, notifyRecovery: false }
    const a = evaluateAlerts(new Map([['t1', { since: 0, notified: true }]]), { t1: st('t1', 'ok') }, MIN, quiet)
    expect(a.events).toEqual([])
    const b = evaluateAlerts(new Map([['t2', { since: 0, notified: true }]]), {}, MIN, opts)
    expect(b.events).toEqual([])
    expect(b.tracks.size).toBe(0)
  })
})

describe('formatDuration', () => {
  it('menit dan jam', () => {
    expect(formatDuration(20_000)).toBe('1 menit')
    expect(formatDuration(5 * MIN)).toBe('5 menit')
    expect(formatDuration(60 * MIN)).toBe('1 jam')
    expect(formatDuration(80 * MIN)).toBe('1 jam 20 menit')
  })
})
