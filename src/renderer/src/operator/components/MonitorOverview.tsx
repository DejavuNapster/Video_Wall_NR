import { useEffect, useState } from 'react'
import { isNativeSource } from '@shared/native'
import { tileSummary } from '@shared/tileSummary'
import type { MonitorLayout, Thumbnails, Tile, TileStatus } from '@shared/types'
import { useOperator } from '../store'
import { StatusDot, stateLabel } from './StatusDot'
import { Switch } from './ui'

const THUMB_INTERVAL_MS = 4000
const PREVIEW_KEY = 'vwnr.livePreview'

/** Pilihan "Pratinjau langsung" diingat per komputer (penyimpanan browser bisa tidak tersedia). */
function usePreviewSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(PREVIEW_KEY) !== 'off'
    } catch {
      return true
    }
  })
  const update = (value: boolean): void => {
    setOn(value)
    try {
      localStorage.setItem(PREVIEW_KEY, value ? 'on' : 'off')
    } catch {
      /* abaikan */
    }
  }
  return [on, update]
}

/** Ambil cuplikan panel berkala selama jendela Operator terlihat. */
function useThumbnails(enabled: boolean): Thumbnails {
  const [thumbs, setThumbs] = useState<Thumbnails>({})
  useEffect(() => {
    if (!enabled) {
      setThumbs({})
      return
    }
    let alive = true
    const load = async (): Promise<void> => {
      if (document.hidden) return
      try {
        const next = await window.operatorApi.thumbnails()
        if (alive && next && !('ok' in next)) setThumbs(next)
      } catch {
        /* coba lagi pada putaran berikutnya */
      }
    }
    void load()
    const timer = setInterval(() => void load(), THUMB_INTERVAL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [enabled])
  return thumbs
}

export const SOURCE_LABEL: Record<Tile['source']['type'], string> = {
  empty: 'Kosong',
  web: 'Web',
  rtsp: 'RTSP',
  hls: 'HLS',
  whep: 'WebRTC',
  mjpeg: 'MJPEG',
  clock: 'Jam',
  ticker: 'Ticker'
}

function tileTone(tile: Tile, status: TileStatus | undefined): string {
  if (tile.source.type === 'empty') return 'border-dashed border-slate-700 bg-slate-900/40 text-slate-500'
  if (isNativeSource(tile.source)) return 'border-indigo-500/40 bg-indigo-500/10 text-indigo-100'
  switch (status?.state) {
    case 'ok':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-50'
    case 'failed':
    case 'crashed':
      return 'border-red-500/50 bg-red-500/10 text-red-100'
    case 'stalled':
    case 'unresponsive':
      return 'border-orange-500/50 bg-orange-500/10 text-orange-100'
    default:
      return 'border-slate-600 bg-slate-800/60 text-slate-200'
  }
}

function MonitorMap({
  monitor,
  aspect,
  label,
  thumbs
}: {
  monitor: MonitorLayout
  aspect: number
  label: string
  thumbs: Thumbnails
}): React.JSX.Element {
  const app = useOperator((s) => s.app)
  const selected = useOperator((s) => s.selected)
  const select = useOperator((s) => s.select)
  const pct = (v: number, of: number): string => `${(v / of) * 100}%`
  const issues = monitor.tiles.filter((t) => {
    const st = app?.tileStatus[t.id]?.state
    return st === 'failed' || st === 'crashed' || st === 'stalled'
  }).length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-semibold text-slate-200">Monitor {monitor.slot + 1}</span>
        <span className="text-slate-500">{label}</span>
        <span className="text-slate-500">
          · {monitor.tiles.length} panel · {monitor.layoutMode === 'free' ? 'Mode Bebas' : `Grid ${monitor.cols}×${monitor.rows}`}
        </span>
        {issues > 0 && <span className="ml-auto text-red-300">{issues} bermasalah</span>}
      </div>
      <div className="relative w-full overflow-hidden rounded-md border border-slate-700 bg-black" style={{ aspectRatio: aspect }}>
        {monitor.tiles.map((tile) => {
          const status = app?.tileStatus[tile.id]
          const isSel = selected?.tileId === tile.id
          const thumb = thumbs[tile.id]
          return (
            <button
              key={tile.id}
              onClick={() => select({ slot: monitor.slot, tileId: tile.id })}
              title={`${tileSummary(tile)} — ${SOURCE_LABEL[tile.source.type]}${status ? ` · ${stateLabel(status.state)}` : ''}`}
              className={`absolute flex flex-col items-start gap-0.5 overflow-hidden rounded-sm border p-1.5 text-left text-[11px] leading-tight transition-shadow ${tileTone(tile, status)} ${
                isSel ? 'z-10 ring-2 ring-sky-400' : 'hover:ring-1 hover:ring-slate-400'
              }`}
              style={{
                left: `calc(${pct(tile.x, monitor.cols)} + 1px)`,
                top: `calc(${pct(tile.y, monitor.rows)} + 1px)`,
                width: `calc(${pct(tile.w, monitor.cols)} - 2px)`,
                height: `calc(${pct(tile.h, monitor.rows)} - 2px)`
              }}
            >
              {thumb && <img src={thumb} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />}
              <span className={`relative flex w-full items-center gap-1 ${thumb ? 'rounded bg-black/70 px-1 py-0.5' : ''}`}>
                {status && tile.source.type !== 'empty' && !isNativeSource(tile.source) && <StatusDot state={status.state} />}
                <span className="font-semibold opacity-80">{SOURCE_LABEL[tile.source.type]}</span>
                {thumb && <span className="min-w-0 truncate opacity-90">{tileSummary(tile)}</span>}
              </span>
              {!thumb && <span className="line-clamp-2 w-full break-all opacity-90">{tileSummary(tile)}</span>}
            </button>
          )
        })}
        {monitor.tiles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">Belum ada panel</div>
        )}
      </div>
    </div>
  )
}

/** Ringkasan isi semua monitor wall untuk preset yang sedang tampil. Posisi panel diatur langsung di wall. */
export function MonitorOverview(): React.JSX.Element {
  const app = useOperator((s) => s.app)
  const { run } = useOperator.getState()
  const [preview, setPreview] = usePreviewSetting()
  const thumbs = useThumbnails(preview && !!app?.activePreset)
  if (!app?.activePreset) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Belum ada preset aktif.</div>
  }
  const wallDisplays = app.displays.filter((d) => d.slot !== null)
  const monitors = app.activePreset.monitors.filter((m) => wallDisplays.some((d) => d.slot === m.slot))
  const displayMode = app.settings.wall.displayMode

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-5">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3 text-xs text-slate-400">
        <span className="min-w-64 flex-1">
          Klik panel untuk mengatur sumbernya di sebelah kanan. Tambah, geser, dan ubah ukuran panel dilakukan langsung di
          jendela wall pada <b className="text-slate-200">Mode Atur</b> (toolbar + bilah panel).
        </span>
        <label className="flex items-center gap-2 text-slate-300" title="Cuplikan isi panel diperbarui setiap beberapa detik">
          <Switch label="Pratinjau langsung" checked={preview} onChange={setPreview} />
          Pratinjau langsung
        </label>
        {displayMode && (
          <button
            className="rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500"
            onClick={() =>
              void run(async (api) => {
                const res = await api.updateSettings({ wall: { displayMode: false } })
                return res.ok ? api.showWalls() : res
              })
            }
          >
            Buka Mode Atur di wall
          </button>
        )}
      </div>
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(380px,1fr))]">
        {monitors.map((m) => {
          const d = wallDisplays.find((x) => x.slot === m.slot)
          const aspect = d ? d.bounds.width / d.bounds.height : 16 / 9
          const label = d ? `${d.bounds.width}×${d.bounds.height}${d.virtual ? ' (virtual)' : ''}` : ''
          return <MonitorMap key={m.slot} monitor={m} aspect={aspect} label={label} thumbs={thumbs} />
        })}
      </div>
    </div>
  )
}
