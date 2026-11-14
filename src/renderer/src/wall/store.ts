import { create } from 'zustand'
import type { Result, WallUiState } from '@shared/types'

export interface Notice {
  kind: 'ok' | 'warn' | 'error'
  text: string
}

interface WallStore {
  state: WallUiState | null
  notice: Notice | null
  /** Pemegang lapisan atas (menu terbuka, sedang geser). UI di atas tile selama himpunan ini tidak kosong. */
  overlayHolders: Set<string>
  /** Panel yang kolom URL-nya harus difokuskan begitu muncul (setelah + Panel atau Ctrl+L). */
  pendingFocusTile: string | null

  init: () => () => void
  setNotice: (notice: Notice | null) => void
  holdOverlay: (holder: string, on: boolean) => void
  focusUrlLater: (tileId: string | null) => void
  /** Jalankan aksi; tampilkan error sebagai notifikasi. Mengembalikan hasil. */
  run: <T extends object>(p: Promise<Result<T>>) => Promise<Result<T>>
}

export const useWall = create<WallStore>((set, get) => {
  const api = window.wallApi
  return {
    state: null,
    notice: null,
    overlayHolders: new Set(),
    pendingFocusTile: null,

    init: () => {
      const offState = api.onState((state) => set({ state }))
      const offCmd = api.onCommand((cmd) => {
        if (cmd.type === 'notice') set({ notice: { kind: cmd.kind, text: cmd.text } })
        else if (cmd.type === 'focusUrl') set({ pendingFocusTile: cmd.tileId })
      })
      void api.getState().then((state) => {
        if (state) set({ state })
      })
      return () => {
        offState()
        offCmd()
      }
    },

    setNotice: (notice) => set({ notice }),

    holdOverlay: (holder, on) => {
      const holders = new Set(get().overlayHolders)
      const before = holders.size > 0
      if (on) holders.add(holder)
      else holders.delete(holder)
      set({ overlayHolders: holders })
      const after = holders.size > 0
      if (before !== after) api.setOverlay(after)
    },

    focusUrlLater: (pendingFocusTile) => set({ pendingFocusTile }),

    run: async (p) => {
      try {
        const res = await p
        if (!res.ok) set({ notice: { kind: 'error', text: res.error } })
        return res
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err)
        set({ notice: { kind: 'error', text } })
        return { ok: false, error: text }
      }
    }
  }
})
