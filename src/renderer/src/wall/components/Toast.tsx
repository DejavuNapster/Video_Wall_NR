import { useEffect } from 'react'
import { TOOLBAR_H } from '@shared/panelGeometry'
import { useWall } from '../store'

const STYLE = {
  ok: 'border-emerald-500/40 text-emerald-200',
  warn: 'border-amber-500/40 text-amber-200',
  error: 'border-red-500/40 text-red-200'
} as const

/**
 * Notifikasi singkat. Di Mode Atur tampil di bawah toolbar; di Mode Tampil (tanpa toolbar) UI wall
 * dinaikkan sebentar ke atas tile supaya notifikasi tidak tertutup isi panel.
 */
export function Toast({ displayMode }: { displayMode: boolean }): React.JSX.Element | null {
  const notice = useWall((s) => s.notice)
  const setNotice = useWall((s) => s.setNotice)
  const holdOverlay = useWall((s) => s.holdOverlay)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), notice.kind === 'error' ? 6000 : 3500)
    return () => clearTimeout(t)
  }, [notice, setNotice])

  const raise = notice !== null && displayMode
  useEffect(() => {
    holdOverlay('toast', raise)
    return () => holdOverlay('toast', false)
  }, [raise, holdOverlay])

  if (!notice) return null
  // Mode Atur: di dalam area toolbar (area panel tertutup tile). Mode Tampil: pojok kanan atas, di atas tile.
  const place = displayMode
    ? 'top-3 right-3 max-w-md px-3 py-2'
    : 'left-1/2 -translate-x-1/2 truncate px-3'
  return (
    <div
      style={displayMode ? undefined : { top: 4, height: TOOLBAR_H - 8, lineHeight: `${TOOLBAR_H - 10}px`, maxWidth: '60%' }}
      onClick={() => setNotice(null)}
      title={notice.text}
      className={`absolute z-50 cursor-pointer rounded-md border bg-slate-900 text-xs shadow-xl ${place} ${STYLE[notice.kind]}`}
    >
      {notice.text}
    </div>
  )
}
