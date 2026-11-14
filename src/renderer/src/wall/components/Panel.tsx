import { useEffect, useRef, useState } from 'react'
import { EDGE, type PanelGeometry } from '@shared/panelGeometry'
import type { Rect, Tile, TileNavAction, TileStatus } from '@shared/types'
import { useWall } from '../store'
import type { DragKind } from '../useDrag'
import { urlInputs } from '../urlInputs'
import { isNativeSource } from '@shared/native'
import { ClockTile, TickerTile } from './NativeTiles'

const DOT: Record<string, string> = {
  idle: 'bg-slate-500',
  loading: 'bg-amber-400 animate-pulse',
  ok: 'bg-emerald-400',
  crashed: 'bg-red-500',
  unresponsive: 'bg-orange-500',
  stalled: 'bg-orange-400',
  failed: 'bg-red-500'
}

const REFRESH_OPTIONS = [0, 1, 5, 15, 30, 60]

const box = (r: Rect): React.CSSProperties => ({ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height })

// Varian warna dipisah (bukan ditimpa) karena urutan kelas Tailwind tidak menentukan mana yang menang.
const btnBase = 'flex h-6 shrink-0 items-center justify-center rounded border px-1.5 text-xs disabled:opacity-40'
const btn = `${btnBase} border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700`
const btnDanger = `${btnBase} border-red-500/60 bg-red-950 text-red-200 hover:bg-red-900`
const btnWarn = `${btnBase} border-amber-500/60 bg-amber-950 text-amber-200 hover:bg-amber-900`

function urlOf(tile: Tile): string {
  const s = tile.source
  if (s.type === 'empty' || isNativeSource(s)) return ''
  return s.url
}

interface PanelProps {
  tile: Tile
  geo: PanelGeometry
  status: TileStatus | undefined
  active: boolean
  edit: boolean
  onBeginDrag: (e: React.PointerEvent, tileId: string, kind: DragKind) => void
}

/** Bingkai, bilah, pegangan ubah ukuran, dan pesan isi (kosong / error) untuk satu panel. */
export function Panel({ tile, geo, status, active, edit, onBeginDrag }: PanelProps): React.JSX.Element {
  const failed = status?.state === 'failed' || status?.state === 'crashed'
  return (
    <>
      {edit && (
        <div
          style={box(geo.frame)}
          className={`pointer-events-none border ${active ? 'border-sky-400' : 'border-slate-700'}`}
        />
      )}
      {(tile.source.type === 'empty' || failed) && <PanelBody tile={tile} rect={geo.body} status={status} edit={edit} />}
      {tile.source.type === 'clock' && <ClockTile source={tile.source} rect={geo.body} />}
      {tile.source.type === 'ticker' && <TickerTile source={tile.source} rect={geo.body} />}
      {edit && geo.bar && <PanelBar tile={tile} rect={geo.bar} status={status} active={active} onBeginDrag={onBeginDrag} />}
      {edit && <ResizeHandles tileId={tile.id} frame={geo.frame} barH={geo.bar?.height ?? 0} onBeginDrag={onBeginDrag} />}
    </>
  )
}

function PanelBody({ tile, rect, status, edit }: { tile: Tile; rect: Rect; status: TileStatus | undefined; edit: boolean }): React.JSX.Element {
  const run = useWall((s) => s.run)
  const select = (): void => window.wallApi.setActiveTile(tile.id)

  if (tile.source.type === 'empty') {
    if (!edit) return <></>
    return (
      <div style={box(rect)} onMouseDown={select} className="flex flex-col items-center justify-center gap-1 text-center">
        <span className="text-sm text-sky-300/90">Panel kosong</span>
        <span className="text-xs text-sky-300/70">Ketik URL di bilah atas panel</span>
      </div>
    )
  }

  const error = status?.lastError ?? 'Gagal memuat'
  const certError = /ERR_CERT_|CERT_/i.test(error)
  const ignoring = tile.source.type !== 'rtsp' && !isNativeSource(tile.source) && tile.source.ignoreCertErrors === true
  return (
    <div
      style={box(rect)}
      onMouseDown={select}
      className="flex flex-col items-center justify-center gap-2 overflow-hidden bg-slate-950 p-3 text-center"
    >
      <span className="text-sm font-medium text-red-300">{status?.state === 'crashed' ? 'Panel crash' : 'Gagal memuat'}</span>
      <span className="max-w-full break-words text-xs text-slate-400">{error}</span>
      <div className="flex flex-wrap justify-center gap-2">
        <button className={btn} onClick={() => void run(window.wallApi.reloadTile(tile.id))}>
          Coba lagi
        </button>
        {certError && !ignoring && (
          <button
            className={btnWarn}
            title="Terima sertifikat HTTPS panel ini walau tidak valid (mis. diakses lewat IP). Hanya untuk server tepercaya."
            onClick={() => void run(window.wallApi.edit({ op: 'setIgnoreCert', tileId: tile.id, value: true }))}
          >
            Abaikan sertifikat untuk panel ini
          </button>
        )}
      </div>
    </div>
  )
}

function PanelBar({
  tile,
  rect,
  status,
  active,
  onBeginDrag
}: {
  tile: Tile
  rect: Rect
  status: TileStatus | undefined
  active: boolean
  onBeginDrag: PanelProps['onBeginDrag']
}): React.JSX.Element {
  const run = useWall((s) => s.run)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const src = tile.source
  const hasView = src.type !== 'empty' && !isNativeSource(src)
  const isWeb = src.type === 'web'
  // Tombol muncul bertahap sesuai lebar bilah; kolom URL selalu mendapat sisa ruang.
  const wide = rect.width >= 640
  const roomy = rect.width >= 420
  const medium = rect.width >= 260
  const edit = (payload: object): void => void run(window.wallApi.edit({ tileId: tile.id, ...payload }))
  const nav = (action: TileNavAction): void => void run(window.wallApi.tileNav(tile.id, action))

  return (
    <div
      style={box(rect)}
      onMouseDown={() => window.wallApi.setActiveTile(tile.id)}
      className={`flex items-center gap-1 overflow-hidden px-1 ${active ? 'bg-slate-800' : 'bg-slate-900'}`}
    >
      <span
        title="Seret untuk memindah panel"
        onPointerDown={(e) => onBeginDrag(e, tile.id, 'move')}
        className="flex h-6 w-5 shrink-0 cursor-grab items-center justify-center text-slate-500 hover:text-slate-200 active:cursor-grabbing"
      >
        ⠿
      </span>
      {hasView && <span title={status?.state ?? 'idle'} className={`h-2 w-2 shrink-0 rounded-full ${DOT[status?.state ?? 'idle']}`} />}
      {tile.label && medium && <span className="max-w-[25%] shrink-0 truncate text-xs font-medium text-slate-300">{tile.label}</span>}
      {isWeb && rect.width >= 200 && (
        <button className={btn} title="Kembali ke halaman sebelumnya (Alt+←)" disabled={!status?.canGoBack} onClick={() => nav('back')}>
          ←
        </button>
      )}
      {isWeb && roomy && (
        <button className={btn} title="Maju ke halaman berikutnya (Alt+→)" disabled={!status?.canGoForward} onClick={() => nav('forward')}>
          →
        </button>
      )}
      {medium && (
        <button className={btn} title="Muat ulang halaman (F5)" disabled={!hasView} onClick={() => void run(window.wallApi.reloadTile(tile.id))}>
          ⟳
        </button>
      )}
      {isWeb && roomy && (
        <button className={btn} title={`Kembali ke URL panel: ${src.url} (Alt+Home)`} onClick={() => nav('home')}>
          ⌂
        </button>
      )}
      <UrlInput tile={tile} pageUrl={status?.pageUrl} />
      {isWeb && medium && (
        <button
          className={btn}
          title="Buka halaman ini di panel baru (seperti tab baru). Bila monitor penuh, panel ini dibelah dua."
          onClick={() => nav('newPanel')}
        >
          ⧉
        </button>
      )}

      {confirmDelete ? (
        <>
          <span className="shrink-0 text-xs text-red-300">Hapus?</span>
          <button className={btnDanger} onClick={() => edit({ op: 'removeTile' })}>
            Ya
          </button>
          <button className={btn} onClick={() => setConfirmDelete(false)}>
            Batal
          </button>
        </>
      ) : (
        <>
          {isWeb && wide && (
            <>
              <button className={btn} title="Perkecil (Ctrl −)" onClick={() => edit({ op: 'setZoom', zoom: Math.max(0.25, src.zoom - 0.1) })}>
                −
              </button>
              <button className={`${btn} w-12`} title="Kembali ke 100% (Ctrl+0)" onClick={() => edit({ op: 'setZoom', zoom: 1 })}>
                {Math.round(src.zoom * 100)}%
              </button>
              <button className={btn} title="Perbesar (Ctrl +)" onClick={() => edit({ op: 'setZoom', zoom: Math.min(5, src.zoom + 0.1) })}>
                +
              </button>
              <select
                title="Muat ulang otomatis"
                value={src.reloadMinutes}
                onChange={(e) => edit({ op: 'setReloadMinutes', minutes: Number(e.target.value) })}
                className="h-6 shrink-0 rounded border border-slate-700 bg-slate-800 px-1 text-xs text-slate-200"
              >
                {[...new Set([...REFRESH_OPTIONS, src.reloadMinutes])]
                  .sort((a, b) => a - b)
                  .map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? 'Refresh: mati' : `Refresh: ${m} mnt`}
                    </option>
                  ))}
              </select>
            </>
          )}
          {medium && (
            <button
              className={btn}
              title="Layar penuh panel (F11, Esc untuk kembali)"
              disabled={!hasView}
              onClick={() => void run(window.wallApi.panelFullscreen(tile.id))}
            >
              ⛶
            </button>
          )}
          <button className={btn} title="Hapus panel" onClick={() => setConfirmDelete(true)}>
            ✕
          </button>
        </>
      )}
    </div>
  )
}

/**
 * Kolom URL panel. Seperti address bar browser: menampilkan halaman yang sedang terbuka; Enter dengan
 * URL lain mengganti URL panel (disimpan di preset), Enter dengan URL panel kembali ke halaman awalnya.
 */
function UrlInput({ tile, pageUrl }: { tile: Tile; pageUrl: string | undefined }): React.JSX.Element {
  const run = useWall((s) => s.run)
  const panelUrl = urlOf(tile)
  const current = tile.source.type === 'web' && pageUrl ? pageUrl : panelUrl
  const [draft, setDraft] = useState(current)
  const [error, setError] = useState<string | null>(null)
  const focused = useRef(false)
  const ref = useRef<HTMLInputElement | null>(null)

  // Ikuti nilai dari main selama pengguna tidak sedang mengetik.
  useEffect(() => {
    if (!focused.current) setDraft(current)
  }, [current])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    urlInputs.set(tile.id, el)
    return () => {
      if (urlInputs.get(tile.id) === el) urlInputs.delete(tile.id)
    }
  }, [tile.id])

  const submit = async (): Promise<void> => {
    // Baca langsung dari elemen: state `draft` bisa tertinggal satu render (mis. tempel lalu Enter cepat).
    const value = (ref.current?.value ?? draft).trim()
    if (value === current) {
      ref.current?.blur()
      return
    }
    const res = await run(
      value === panelUrl ? window.wallApi.tileNav(tile.id, 'home') : window.wallApi.edit({ op: 'setSource', tileId: tile.id, input: value })
    )
    if (res.ok) {
      setError(null)
      ref.current?.blur()
    } else {
      setError(res.error)
    }
  }

  return (
    <input
      ref={ref}
      value={draft}
      spellCheck={false}
      placeholder="Masukkan URL lalu Enter"
      title={error ?? (current ? (current === panelUrl ? current : `${current}
URL panel: ${panelUrl}`) : 'Masukkan URL lalu Enter')}
      onChange={(e) => {
        setDraft(e.target.value)
        setError(null)
      }}
      onFocus={(e) => {
        focused.current = true
        e.target.select()
        window.wallApi.setActiveTile(tile.id)
      }}
      onBlur={() => {
        focused.current = false
        setDraft(current)
        setError(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void submit()
        else if (e.key === 'Escape') ref.current?.blur()
      }}
      className={`h-6 min-w-0 flex-1 rounded border bg-slate-950 px-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none ${
        error ? 'border-red-500' : 'border-slate-700 focus:border-sky-500'
      }`}
    />
  )
}

/** Pegangan ubah ukuran: tepi kiri/kanan/bawah, tepi atas (di atas bilah), dan keempat sudut. */
function ResizeHandles({
  tileId,
  frame,
  barH,
  onBeginDrag
}: {
  tileId: string
  frame: Rect
  barH: number
  onBeginDrag: PanelProps['onBeginDrag']
}): React.JSX.Element {
  const T = 3 // tebal pegangan tepi atas (di atas bilah)
  const C = EDGE * 3 // ukuran pegangan sudut
  const { x, y, width: w, height: h } = frame
  const handles: Array<{ key: string; r: Rect; cursor: string; kind: DragKind }> = [
    { key: 'l', r: { x, y: y + barH, width: EDGE, height: h - barH }, cursor: 'ew-resize', kind: { left: true } },
    { key: 'r', r: { x: x + w - EDGE, y: y + barH, width: EDGE, height: h - barH }, cursor: 'ew-resize', kind: { right: true } },
    { key: 'b', r: { x, y: y + h - EDGE, width: w, height: EDGE }, cursor: 'ns-resize', kind: { bottom: true } },
    { key: 't', r: { x, y, width: w, height: T }, cursor: 'ns-resize', kind: { top: true } },
    { key: 'tl', r: { x, y, width: C, height: T }, cursor: 'nwse-resize', kind: { top: true, left: true } },
    { key: 'tr', r: { x: x + w - C, y, width: C, height: T }, cursor: 'nesw-resize', kind: { top: true, right: true } },
    { key: 'bl', r: { x, y: y + h - C, width: C, height: C }, cursor: 'nesw-resize', kind: { bottom: true, left: true } },
    { key: 'br', r: { x: x + w - C, y: y + h - C, width: C, height: C }, cursor: 'nwse-resize', kind: { bottom: true, right: true } }
  ]
  return (
    <>
      {handles.map((hd) => (
        <div
          key={hd.key}
          style={{ ...box(hd.r), cursor: hd.cursor }}
          onPointerDown={(e) => onBeginDrag(e, tileId, hd.kind)}
        />
      ))}
    </>
  )
}
