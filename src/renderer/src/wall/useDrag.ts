import { useCallback, useEffect, useRef, useState } from 'react'
import { computeDrag, type DragInput, type DragKind } from '@shared/dragMath'
import { gridUnit, stripHeight, wallArea } from '@shared/panelGeometry'
import type { URect } from '@shared/snap'
import { useWall } from './store'

export type { DragKind }

/** Ambang magnet dalam piksel layar. */
const SNAP_PX = 12

export interface DragPreview {
  tileId: string
  rect: URect
  valid: boolean
}

interface Session extends DragInput {
  startX: number
  startY: number
}

/** Persegi baru (unit grid) dari gerakan mouse. Alt mematikan magnet sementara. */
function compute(s: Session, dx: number, dy: number, altKey: boolean): DragPreview {
  return { tileId: s.tileId, ...computeDrag({ ...s, snap: s.snap && !altKey }, dx, dy) }
}

/**
 * Geser / ubah ukuran panel. Selama sesi, UI wall dinaikkan ke atas tile (overlay) dan hanya kotak
 * bayangan yang bergerak; panel asli baru dipindah saat tombol mouse dilepas.
 */
export function usePanelDrag(size: { width: number; height: number }): {
  preview: DragPreview | null
  begin: (e: React.PointerEvent, tileId: string, kind: DragKind) => void
} {
  const [preview, setPreview] = useState<DragPreview | null>(null)
  const session = useRef<Session | null>(null)
  const latest = useRef<DragPreview | null>(null)

  const finish = useCallback((commit: boolean) => {
    const s = session.current
    const p = latest.current
    session.current = null
    latest.current = null
    setPreview(null)
    const store = useWall.getState()
    store.holdOverlay('drag', false)
    if (!s || !p || !commit) return
    const r = p.rect
    if (r.x === s.start.x && r.y === s.start.y && r.w === s.start.w && r.h === s.start.h) return
    if (!p.valid) {
      store.setNotice({ kind: 'warn', text: 'Panel bertumpuk dengan panel lain — dikembalikan ke posisi semula' })
      return
    }
    void store.run(window.wallApi.edit({ op: 'moveResize', tileId: s.tileId, ...r }))
  }, [])

  useEffect(() => {
    const move = (e: PointerEvent): void => {
      const s = session.current
      if (!s) return
      const p = compute(s, e.clientX - s.startX, e.clientY - s.startY, e.altKey)
      latest.current = p
      setPreview(p)
    }
    const up = (): void => {
      if (session.current) finish(true)
    }
    const cancel = (): void => {
      if (session.current) finish(false)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', cancel)
    }
  }, [finish])

  const begin = useCallback(
    (e: React.PointerEvent, tileId: string, kind: DragKind) => {
      if (e.button !== 0) return
      const state = useWall.getState().state
      const monitor = state?.monitor
      const tile = monitor?.tiles.find((t) => t.id === tileId)
      if (!state || !monitor || !tile) return
      // Banner mode strip: grid snap mengikuti area wall yang bergeser turun setinggi strip.
      const banner = state.banner
      const stripInset = banner && banner.banner.mode === 'strip' ? stripHeight(size) : 0
      e.preventDefault()
      e.stopPropagation()
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      window.wallApi.setActiveTile(tileId)
      const start = { x: tile.x, y: tile.y, w: tile.w, h: tile.h }
      session.current = {
        tileId,
        kind,
        startX: e.clientX,
        startY: e.clientY,
        start,
        monitor,
        unit: gridUnit(monitor, wallArea(size, true, stripInset)),
        snap: monitor.layoutMode === 'free' && state.wall.snap,
        snapPx: SNAP_PX
      }
      const first = { tileId, rect: start, valid: true }
      latest.current = first
      setPreview(first)
      useWall.getState().holdOverlay('drag', true)
    },
    [size]
  )

  return { preview, begin }
}
