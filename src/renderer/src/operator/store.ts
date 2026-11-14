import { create } from 'zustand'
import type { AppState, Result } from '@shared/types'

export interface Notice {
  kind: 'ok' | 'warn' | 'error'
  text: string
}

export type Tab = 'monitor' | 'otomatisasi' | 'banner' | 'pengaturan'

/** Pesan bila bridge preload tidak tersedia di jendela ini. */
export const API_MISSING = 'API operator tidak tersedia (preload gagal dimuat). Jalankan ulang aplikasi.'

interface OperatorStore {
  app: AppState | null
  tab: Tab
  /** Panel yang dipilih di ringkasan monitor (Inspector). */
  selected: { slot: number; tileId: string } | null
  notice: Notice | null
  busy: boolean

  init: () => Promise<() => void>
  setTab: (tab: Tab) => void
  select: (selected: { slot: number; tileId: string } | null) => void
  setNotice: (notice: Notice | null) => void
  /**
   * Jalankan panggilan API; error ditampilkan sebagai notifikasi, `okText` (bila ada) saat berhasil.
   * "Dibatalkan" (dialog file ditutup) tidak dianggap error.
   */
  run: <T extends object>(call: (api: Window['operatorApi']) => Promise<Result<T>>, okText?: string) => Promise<Result<T>>
}

export const useOperator = create<OperatorStore>((set) => ({
  app: null,
  tab: 'monitor',
  selected: null,
  notice: null,
  busy: false,

  init: async () => {
    const api = window.operatorApi
    if (!api) {
      set({ notice: { kind: 'error', text: API_MISSING } })
      return () => {}
    }
    const off = api.onState((app) => set({ app }))
    set({ app: await api.getState() })
    return off
  },

  setTab: (tab) => set({ tab }),
  select: (selected) => set({ selected }),
  setNotice: (notice) => set({ notice }),

  run: async (call, okText) => {
    const api = window.operatorApi
    if (!api) {
      set({ notice: { kind: 'error', text: API_MISSING } })
      return { ok: false, error: API_MISSING }
    }
    set({ busy: true })
    try {
      const res = await call(api)
      if (!res.ok) {
        if (res.error !== 'Dibatalkan') set({ notice: { kind: 'error', text: res.error } })
      } else if (okText) {
        set({ notice: { kind: 'ok', text: okText } })
      }
      return res
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      set({ notice: { kind: 'error', text } })
      return { ok: false, error: text }
    } finally {
      set({ busy: false })
    }
  }
}))
