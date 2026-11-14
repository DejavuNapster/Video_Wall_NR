import { useEffect, useState } from 'react'
import { TOOLBAR_H } from '@shared/panelGeometry'
import type { WallUiState } from '@shared/types'
import { useWall } from '../store'
import { LayoutMenu, SettingsMenu } from './Menus'

// Varian warna dipisah (bukan ditimpa) karena urutan kelas Tailwind tidak menentukan mana yang menang.
const btnBase = 'flex h-7 shrink-0 items-center gap-1 rounded border px-2.5 text-xs disabled:opacity-40'
const btn = `${btnBase} border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700`
const btnOn = `${btnBase} border-sky-500 bg-sky-600 text-white hover:bg-sky-500`

const numBase =
  'h-7 shrink-0 rounded border border-slate-700 bg-slate-950 px-1 text-center text-xs text-slate-100 focus:border-sky-500 focus:outline-none'
const num = `${numBase} w-10`
const sep = <span className="mx-1 h-5 w-px shrink-0 bg-slate-700" />

/** Kolom angka yang baru dikirim saat Enter / keluar fokus (bukan setiap ketikan). */
function NumberField({
  value,
  min,
  max,
  title,
  className,
  onCommit
}: {
  value: number
  min: number
  max: number
  title: string
  className: string
  onCommit: (v: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (): void => {
    const n = Math.round(Number(draft))
    if (!Number.isFinite(n) || n < min || n > max) return setDraft(String(value))
    if (n !== value) onCommit(n)
  }
  return (
    <input
      type="number"
      title={title}
      value={draft}
      min={min}
      max={max}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className={className}
    />
  )
}

export function Toolbar({ state }: { state: WallUiState }): React.JSX.Element {
  const run = useWall((s) => s.run)
  const focusUrlLater = useWall((s) => s.focusUrlLater)
  const monitor = state.monitor
  const wall = state.wall
  const edit = (payload: object): void => void run(window.wallApi.edit(payload))
  const settings = (patch: object): void => void run(window.wallApi.settings(patch))
  const preset = (action: object): void => void run(window.wallApi.preset(action))

  const addPanel = async (): Promise<void> => {
    // Monitor penuh: panel aktif dibelah dua untuk tempat panel baru.
    const res = await run(window.wallApi.edit({ op: 'addTile', ...(state.activeTileId ? { near: state.activeTileId } : {}) }))
    if (res.ok && res.tileId) focusUrlLater(res.tileId)
  }

  return (
    <div
      style={{ height: TOOLBAR_H }}
      onWheel={(e) => {
        // Layar sempit: roda mouse menggulung toolbar ke samping.
        if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY
      }}
      className="no-scrollbar absolute inset-x-0 top-0 flex items-center gap-1.5 overflow-x-auto overflow-y-hidden whitespace-nowrap border-b border-slate-800 bg-slate-900 px-2"
    >
      <button className={btn} onClick={() => void addPanel()} disabled={!monitor} title="Tambah panel di tempat kosong (monitor penuh: panel aktif dibelah dua)">
        + Panel
      </button>
      <LayoutMenu state={state} className={btn} />
      {monitor && (
        <div className="flex shrink-0 overflow-hidden rounded border border-slate-700" title="Grid: panel menempel ke sel. Bebas: langkah 8x lebih halus">
          {(['grid', 'free'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => edit({ op: 'setLayoutMode', mode })}
              className={`h-7 px-2.5 text-xs ${monitor.layoutMode === mode ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              {mode === 'grid' ? 'Grid' : 'Bebas'}
            </button>
          ))}
        </div>
      )}
      {monitor?.layoutMode === 'free' && (
        <label
          className="flex shrink-0 items-center gap-1 text-xs text-slate-300"
          title="Magnet tepi: panel menempel ke tepi panel lain / garis bezel. Tahan Alt saat menggeser untuk mematikan sementara."
        >
          <input type="checkbox" checked={wall.snap} onChange={(e) => settings({ snap: e.target.checked })} />
          Magnet
        </label>
      )}
      <label className="flex shrink-0 items-center gap-1 text-xs text-slate-300" title="Tampilkan garis bezel di Mode Atur">
        <input type="checkbox" checked={wall.showBezel} onChange={(e) => settings({ showBezel: e.target.checked })} />
        Bezel
      </label>
      {monitor && (
        <>
          <NumberField
            value={monitor.bezel.cols}
            min={1}
            max={8}
            title="Jumlah kolom bezel (1-8)"
            className={num}
            onCommit={(cols) => edit({ op: 'setBezel', cols, rows: monitor.bezel.rows })}
          />
          <span className="text-xs text-slate-500">×</span>
          <NumberField
            value={monitor.bezel.rows}
            min={1}
            max={8}
            title="Jumlah baris bezel (1-8)"
            className={num}
            onCommit={(rows) => edit({ op: 'setBezel', cols: monitor.bezel.cols, rows })}
          />
        </>
      )}

      {sep}
      <span className="shrink-0 text-xs text-slate-500">Preset</span>
      {state.presets.map((p, i) => (
        <button
          key={p.id}
          title={`${p.name}${i < 9 ? ` (Ctrl+${i + 1})` : ''}`}
          onClick={() => p.id !== state.activePresetId && preset({ op: 'activate', id: p.id })}
          className={`${p.id === state.activePresetId ? btnOn : btn} min-w-7 justify-center`}
        >
          {i + 1}
        </button>
      ))}
      <span className="max-w-40 shrink-0 truncate text-xs text-slate-300" title={`Preset aktif: ${state.activePresetName}`}>
        {state.activePresetName}
      </span>
      {wall.rotation.enabled && (
        <span
          className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-300"
          title="Rotasi preset aktif: berganti otomatis di Mode Tampil. Atur di Operator › Otomatisasi (Ctrl+Spasi untuk jeda)."
        >
          rotasi
        </span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
        {state.saveError && (
          <span title={state.saveError} className="max-w-48 truncate rounded bg-red-500/15 px-2 py-1 text-[11px] text-red-300">
            ⚠ {state.saveError}
          </span>
        )}
        <button
          className={wall.pinned ? btnOn : btn}
          title={wall.pinned ? 'Lepas: jendela wall tidak lagi selalu di atas' : 'Pin: jendela wall selalu di atas jendela lain'}
          onClick={() => settings({ pinned: !wall.pinned })}
        >
          📌
        </button>
        <button className={btn} title="Sembunyikan semua bilah (Ctrl+E untuk kembali)" onClick={() => settings({ displayMode: true })}>
          Mode Tampil
        </button>
        <button className={btn} title="Layar penuh jendela (F10)" onClick={() => void run(window.wallApi.windowFullscreen())}>
          {state.windowFullscreen ? 'Keluar layar penuh' : 'Layar penuh'}
        </button>
        <SettingsMenu className={btn} />
      </div>
    </div>
  )
}
