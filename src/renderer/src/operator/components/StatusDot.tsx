import type { TileState } from '@shared/types'

const COLORS: Record<TileState, string> = {
  idle: 'bg-slate-500',
  loading: 'bg-amber-400 animate-pulse',
  ok: 'bg-emerald-400',
  crashed: 'bg-red-500',
  unresponsive: 'bg-orange-500',
  stalled: 'bg-orange-400',
  failed: 'bg-red-400'
}

const LABELS: Record<TileState, string> = {
  idle: 'Menunggu',
  loading: 'Memuat',
  ok: 'Berjalan',
  crashed: 'Crash',
  unresponsive: 'Tidak responsif',
  stalled: 'Video beku',
  failed: 'Gagal'
}

export const stateLabel = (state: TileState): string => LABELS[state]

export function StatusDot({ state }: { state: TileState }): React.JSX.Element {
  return <span title={LABELS[state]} className={`inline-block h-2 w-2 shrink-0 rounded-full ${COLORS[state]}`} />
}
