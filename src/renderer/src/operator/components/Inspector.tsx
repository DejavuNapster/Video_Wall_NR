import { useState } from 'react'
import { defaultSource } from '@shared/editor'
import { isNativeSource } from '@shared/native'
import type { Source, Tile } from '@shared/types'
import { useOperator } from '../store'
import { SOURCE_LABEL } from './MonitorOverview'
import { StatusDot, stateLabel } from './StatusDot'
import { btn, CommitColor, CommitNumber, CommitText, inputCls, labelCls } from './ui'

const TYPES: Array<{ value: Source['type']; text: string }> = [
  { value: 'empty', text: 'Kosong' },
  { value: 'web', text: 'Halaman web' },
  { value: 'rtsp', text: 'Kamera RTSP (via MediaMTX)' },
  { value: 'hls', text: 'Stream HLS (.m3u8)' },
  { value: 'whep', text: 'WebRTC (WHEP)' },
  { value: 'mjpeg', text: 'MJPEG' },
  { value: 'clock', text: 'Jam & tanggal' },
  { value: 'ticker', text: 'Teks berjalan' }
]

const REFRESH = [0, 1, 5, 15, 30, 60, 120, 360, 720, 1440]

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  )
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-300">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

/** Pengaturan panel terpilih. Setiap perubahan langsung diterapkan ke wall dan disimpan otomatis. */
export function Inspector(): React.JSX.Element {
  const app = useOperator((s) => s.app)
  const selected = useOperator((s) => s.selected)
  const { run, select, setNotice } = useOperator.getState()
  const [password, setPassword] = useState('')

  const monitor = app?.activePreset?.monitors.find((m) => m.slot === selected?.slot)
  const tile: Tile | undefined = monitor?.tiles.find((t) => t.id === selected?.tileId)
  const shell = 'flex w-[340px] shrink-0 flex-col overflow-auto border-l border-slate-800 bg-slate-900/40'

  if (!monitor || !tile) {
    return (
      <aside className={`${shell} items-center justify-center p-6 text-center`}>
        <p className="text-sm text-slate-400">Pilih panel di ringkasan monitor untuk mengatur sumber kontennya.</p>
        <p className="mt-2 text-xs text-slate-500">Jam, teks berjalan, dan kredensial kamera RTSP hanya bisa diatur di sini.</p>
      </aside>
    )
  }

  const slot = monitor.slot
  const src = tile.source
  const status = app?.tileStatus[tile.id]
  const edit = (payload: object, okText?: string): void => void run((api) => api.edit(slot, { tileId: tile.id, ...payload }), okText)
  const setSource = (source: Source): void => edit({ op: 'setSourceConfig', source })

  const savePassword = async (): Promise<void> => {
    const res = await run((api) => api.setRtspPassword(tile.id, password))
    if (!res.ok) return
    setPassword('')
    setNotice({ kind: res.warning ? 'warn' : 'ok', text: res.warning ?? (password ? 'Password disimpan terenkripsi' : 'Password dihapus') })
  }

  return (
    <aside className={shell}>
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{tile.label || `Panel ${tile.id}`}</h2>
          <p className="text-xs text-slate-500">
            Monitor {slot + 1} · {SOURCE_LABEL[src.type]} · {tile.id}
          </p>
        </div>
        <button className={`${btn.ghost} px-2 py-1 text-xs`} onClick={() => select(null)}>
          Tutup
        </button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {status && src.type !== 'empty' && !isNativeSource(src) && (
          <div className="rounded-md border border-slate-800 bg-slate-950 p-2.5 text-xs">
            <div className="flex items-center gap-2">
              <StatusDot state={status.state} />
              <span className="text-slate-200">{stateLabel(status.state)}</span>
              <span className="ml-auto text-slate-500">dipulihkan {status.restarts}×</span>
            </div>
            {status.memoryMB !== undefined && (
              <div className="mt-1 text-slate-500">
                {status.memoryMB} MB · {status.cpuPercent ?? 0}% CPU
              </div>
            )}
            {status.lastError && status.state !== 'ok' && <div className="mt-1 break-words text-red-300">{status.lastError}</div>}
          </div>
        )}

        <Field label="Label" hint="Tampil di bilah panel (Mode Atur). Opsional.">
          <CommitText value={tile.label} maxLength={80} placeholder="mis. CCTV Lobi" onCommit={(label) => edit({ op: 'setLabel', label })} />
        </Field>

        <Field label="Jenis sumber">
          <select
            className={inputCls}
            value={src.type}
            onChange={(e) => {
              const type = e.target.value as Source['type']
              if (type !== src.type) setSource(defaultSource(type))
            }}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.text}
              </option>
            ))}
          </select>
        </Field>

        {src.type !== 'empty' && !isNativeSource(src) && (
          <Field
            label="URL"
            hint={src.type === 'rtsp' ? 'user:pass@ di URL otomatis dipindah ke penyimpanan terenkripsi.' : 'Enter untuk menerapkan.'}
          >
            <CommitText value={src.url} spellCheck={false} onCommit={(url) => setSource({ ...src, url: url.trim() } as Source)} />
          </Field>
        )}

        {src.type === 'web' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Zoom (%)">
              <CommitNumber
                value={Math.round(src.zoom * 100)}
                min={25}
                max={500}
                className={inputCls}
                onCommit={(v) => edit({ op: 'setZoom', zoom: v / 100 })}
              />
            </Field>
            <Field label="Muat ulang otomatis">
              <select className={inputCls} value={src.reloadMinutes} onChange={(e) => edit({ op: 'setReloadMinutes', minutes: Number(e.target.value) })}>
                {[...new Set([...REFRESH, src.reloadMinutes])]
                  .sort((a, b) => a - b)
                  .map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? 'Mati' : m < 60 ? `${m} menit` : `${m / 60} jam`}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
        )}

        {src.type !== 'empty' && src.type !== 'rtsp' && !isNativeSource(src) && (
          <Check checked={src.ignoreCertErrors === true} onChange={(value) => edit({ op: 'setIgnoreCert', value })}>
            Abaikan error sertifikat HTTPS
            <span className="block text-[11px] text-slate-500">Untuk server internal yang diakses lewat IP / self-signed. Login mungkin perlu diulang.</span>
          </Check>
        )}

        {src.type === 'rtsp' && (
          <>
            <Field label="Transport">
              <select className={inputCls} value={src.transport} onChange={(e) => setSource({ ...src, transport: e.target.value as 'auto' | 'tcp' | 'udp' })}>
                <option value="auto">Otomatis</option>
                <option value="tcp">TCP (lebih andal di jaringan sibuk)</option>
                <option value="udp">UDP</option>
              </select>
            </Field>
            <Field label="Username">
              <CommitText
                value={src.username ?? ''}
                onCommit={(v) => {
                  const { username: _drop, ...rest } = src
                  setSource(v.trim() ? { ...rest, username: v.trim() } : rest)
                }}
              />
            </Field>
            <Field label="Password" hint="Disimpan terenkripsi di komputer ini, tidak di file preset. Kosongkan lalu Simpan untuk menghapus.">
              <div className="flex gap-2">
                <input
                  type="password"
                  className={inputCls}
                  value={password}
                  autoComplete="new-password"
                  placeholder="Tidak ditampilkan ulang"
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void savePassword()
                  }}
                />
                <button className={btn.secondary} onClick={() => void savePassword()}>
                  Simpan
                </button>
              </div>
            </Field>
          </>
        )}

        {src.type === 'clock' && (
          <>
            <Check checked={src.hour24} onChange={(hour24) => setSource({ ...src, hour24 })}>
              Format 24 jam
            </Check>
            <Check checked={src.showDate} onChange={(showDate) => setSource({ ...src, showDate })}>
              Tampilkan tanggal
            </Check>
            <Field label="Ukuran teks (px)">
              <CommitNumber value={src.fontSize} min={16} max={288} className={inputCls} onCommit={(fontSize) => setSource({ ...src, fontSize })} />
            </Field>
          </>
        )}

        {src.type === 'ticker' && (
          <>
            <Field label="Teks berjalan" hint="Ctrl+Enter atau klik di luar kolom untuk menerapkan.">
              <CommitText
                multiline
                value={src.text}
                maxLength={500}
                onCommit={(text) => {
                  if (text.trim()) setSource({ ...src, text: text.trim() })
                }}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kecepatan (detik)">
                <CommitNumber value={src.speedSec} min={2} max={600} className={inputCls} onCommit={(speedSec) => setSource({ ...src, speedSec })} />
              </Field>
              <Field label="Ukuran teks (px)">
                <CommitNumber value={src.fontSize} min={12} max={288} className={inputCls} onCommit={(fontSize) => setSource({ ...src, fontSize })} />
              </Field>
              <Field label="Warna latar">
                <CommitColor label="Warna latar" value={src.bgColor} onCommit={(bgColor) => setSource({ ...src, bgColor })} />
              </Field>
              <Field label="Warna teks">
                <CommitColor label="Warna teks" value={src.fgColor} onCommit={(fgColor) => setSource({ ...src, fgColor })} />
              </Field>
            </div>
          </>
        )}
      </div>

      <div className="mt-auto flex gap-2 border-t border-slate-800 p-4">
        <button
          className={`${btn.secondary} flex-1`}
          disabled={src.type === 'empty' || isNativeSource(src)}
          onClick={() => void run((api) => api.reloadTile(tile.id), 'Panel dimuat ulang')}
        >
          Muat ulang
        </button>
        <button
          className={`${btn.danger} flex-1`}
          onClick={() => {
            if (window.confirm(`Hapus panel "${tile.label || tile.id}" dari monitor ${slot + 1}?`)) {
              edit({ op: 'removeTile' }, 'Panel dihapus')
              select(null)
            }
          }}
        >
          Hapus panel
        </button>
      </div>
    </aside>
  )
}
