/**
 * Store Operator: semua aksi lewat `run()` — hasil gagal tampil sebagai notifikasi (tidak melempar),
 * "Dibatalkan" (dialog file ditutup) diabaikan, dan preload yang gagal dimuat memberi pesan jelas
 * alih-alih "Cannot read properties of undefined".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OperatorApi } from '@shared/ipc'
import type { AppState, Result } from '@shared/types'

const ok = (payload: Record<string, unknown> = {}): Result => ({ ok: true, ...payload }) as Result

/** OperatorApi palsu: semua method default aman; test mem-override yang dibutuhkan. */
const makeApi = (overrides: Partial<OperatorApi> = {}): OperatorApi => ({
  getState: () => Promise.resolve({} as unknown as AppState),
  onState: () => () => {},
  preset: () => Promise.resolve(ok()),
  edit: () => Promise.resolve(ok()),
  reloadTile: () => Promise.resolve(ok()),
  identifyDisplays: () => Promise.resolve(ok()),
  showWalls: () => Promise.resolve(ok()),
  setRtspPassword: () => Promise.resolve(ok()),
  updateSettings: () => Promise.resolve(ok()),
  setBanner: () => Promise.resolve(ok()),
  clearBanner: () => Promise.resolve(ok()),
  backupExport: () => Promise.resolve({ ok: true, path: '/tmp/x.json' }),
  backupImport: () => Promise.resolve(ok()),
  ...overrides
})

/** Store instance BARU per test; `api === undefined` mensimulasikan preload yang gagal dimuat. */
const freshStore = async (api: OperatorApi | undefined) => {
  vi.resetModules()
  vi.stubGlobal('window', { operatorApi: api })
  const mod = await import('../src/renderer/src/operator/store')
  return mod
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('run()', () => {
  it('meneruskan hasil sukses dan menampilkan okText', async () => {
    const api = makeApi({ preset: vi.fn().mockResolvedValue(ok()) })
    const { useOperator } = await freshStore(api)
    const res = await useOperator.getState().run((a) => a.preset({ op: 'create' }), 'Preset baru dibuat')
    expect(res.ok).toBe(true)
    expect(api.preset).toHaveBeenCalledWith({ op: 'create' })
    expect(useOperator.getState().notice).toEqual({ kind: 'ok', text: 'Preset baru dibuat' })
    expect(useOperator.getState().busy).toBe(false)
  })

  it('menampilkan error dari main (ok: false) tanpa melempar', async () => {
    const api = makeApi({ edit: vi.fn().mockResolvedValue({ ok: false, error: 'Monitor penuh' }) })
    const { useOperator } = await freshStore(api)
    const res = await useOperator.getState().run((a) => a.edit(0, { op: 'addTile' }), 'tidak dipakai')
    expect(res).toEqual({ ok: false, error: 'Monitor penuh' })
    expect(useOperator.getState().notice).toEqual({ kind: 'error', text: 'Monitor penuh' })
  })

  it('"Dibatalkan" (dialog ditutup) tidak dianggap error', async () => {
    const api = makeApi({ backupImport: vi.fn().mockResolvedValue({ ok: false, error: 'Dibatalkan' }) })
    const { useOperator } = await freshStore(api)
    await useOperator.getState().run((a) => a.backupImport())
    expect(useOperator.getState().notice).toBeNull()
  })

  it('exception (mis. IPC putus) menjadi notifikasi dan busy kembali false', async () => {
    const api = makeApi({ clearBanner: vi.fn().mockRejectedValue(new Error('IPC putus')) })
    const { useOperator } = await freshStore(api)
    const res = await useOperator.getState().run((a) => a.clearBanner())
    expect(res).toEqual({ ok: false, error: 'IPC putus' })
    expect(useOperator.getState().notice).toEqual({ kind: 'error', text: 'IPC putus' })
    expect(useOperator.getState().busy).toBe(false)
  })
})

describe('preload tidak tersedia', () => {
  it('init dan run memberi pesan jelas, bukan TypeError', async () => {
    const { useOperator, API_MISSING } = await freshStore(undefined)
    await expect(useOperator.getState().init()).resolves.toBeTypeOf('function')
    expect(useOperator.getState().notice).toEqual({ kind: 'error', text: API_MISSING })
    const res = await useOperator.getState().run((a) => a.preset({ op: 'create' }))
    expect(res).toEqual({ ok: false, error: API_MISSING })
  })
})

describe('init', () => {
  it('melanggan onState dan memuat state awal', async () => {
    const state = { presets: [], activePresetId: null } as unknown as AppState
    let listener: ((s: AppState) => void) | null = null
    const api = makeApi({
      getState: vi.fn().mockResolvedValue(state),
      onState: (cb) => {
        listener = cb
        return () => {}
      }
    })
    const { useOperator } = await freshStore(api)
    const off = await useOperator.getState().init()
    expect(typeof off).toBe('function')
    expect(useOperator.getState().app).toEqual(state)
    const next = { ...state, activePresetId: 'b' } as AppState
    listener!(next)
    expect(useOperator.getState().app).toEqual(next)
  })
})
