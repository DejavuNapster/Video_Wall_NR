import { useState } from 'react'
import { defaultSource } from '@shared/editor'
import { isNativeSource } from '@shared/native'
import { TICKER_FONTS, TICKER_SPEEDS, TICKER_STYLES, tickerBackground, type TickerSource } from '@shared/ticker'
import type { MonitorLayout, Source, Tile } from '@shared/types'
import { CSS_SNIPPETS } from '@shared/webPanel'
import { TickerView } from '../../wall/components/TickerView'
import { useOperator } from '../store'
import { SOURCE_LABEL } from './MonitorOverview'
import { StatusDot, stateLabel } from './StatusDot'
import { btn, CommitColor, CommitNumber, CommitRange, CommitText, inputCls, labelCls } from './ui'

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

        {src.type === 'web' && <WebExtras src={src} onChange={setSource} />}

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

        {src.type === 'ticker' && <TickerSettings src={src} tile={tile} monitor={monitor} onChange={setSource} />}
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

type WebSource = Extract<Source, { type: 'web' }>

/** Opsi khusus panel web: rotasi beberapa halaman dan CSS tambahan untuk merapikan dashboard. */
function WebExtras({ src, onChange }: { src: WebSource; onChange: (source: Source) => void }): React.JSX.Element {
  const { setNotice } = useOperator.getState()
  const { cycle: _cycle, css: _css, ...base } = src
  const withCycle = (cycle: WebSource['cycle']): void => onChange(cycle ? { ...base, ...(src.css ? { css: src.css } : {}), cycle } : { ...base, ...(src.css ? { css: src.css } : {}) })
  const withCss = (css: string): void => onChange({ ...base, ...(src.cycle ? { cycle: src.cycle } : {}), ...(css.trim() ? { css } : {}) })

  const commitUrls = (text: string): void => {
    const urls = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(l) ? l : `http://${l}`))
    const bad = urls.find((u) => !/^https?:\/\/[^\s]+$/i.test(u))
    if (bad) return setNotice({ kind: 'error', text: `URL tidak valid: ${bad}` })
    if (urls.length > 20) return setNotice({ kind: 'error', text: 'Maksimal 20 halaman tambahan' })
    withCycle(urls.length ? { urls, intervalSec: src.cycle?.intervalSec ?? 60 } : undefined)
  }

  return (
    <>
      <Field
        label="Rotasi halaman"
        hint={
          src.cycle
            ? `${src.cycle.urls.length + 1} halaman bergantian (URL di atas + ${src.cycle.urls.length} halaman tambahan).`
            : 'Isi halaman tambahan (satu URL per baris) agar panel ini menampilkan beberapa dashboard bergantian.'
        }
      >
        <CommitText
          multiline
          spellCheck={false}
          className={`${inputCls} min-h-20 font-mono text-xs`}
          placeholder={'https://dashboard-2.contoh.id\nhttps://dashboard-3.contoh.id'}
          value={src.cycle?.urls.join('\n') ?? ''}
          onCommit={commitUrls}
        />
        {src.cycle && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-slate-400">Ganti halaman setiap</span>
            <CommitNumber
              value={src.cycle.intervalSec}
              min={5}
              max={86_400}
              className={`${inputCls} w-24`}
              onCommit={(intervalSec) => src.cycle && withCycle({ ...src.cycle, intervalSec })}
            />
            <span className="text-xs text-slate-400">detik</span>
          </div>
        )}
      </Field>

      <Field label="CSS khusus" hint="Disuntikkan ke setiap halaman panel ini, mis. untuk menyembunyikan header, menu, atau pop-up. Tanpa memuat ulang halaman.">
        <CommitText
          multiline
          spellCheck={false}
          maxLength={20_000}
          className={`${inputCls} min-h-24 font-mono text-xs`}
          placeholder={'.navbar { display: none !important; }'}
          value={src.css ?? ''}
          onCommit={withCss}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CSS_SNIPPETS.map((snip) => (
            <button
              key={snip.label}
              type="button"
              className={`${btn.secondary} px-2 py-1 text-[11px]`}
              disabled={(src.css ?? '').includes(snip.css)}
              onClick={() => withCss([src.css?.trim(), snip.css].filter(Boolean).join('\n'))}
            >
              + {snip.label}
            </button>
          ))}
        </div>
      </Field>
    </>
  )
}

/** Tombol pilihan tunggal berjajar (mis. arah gerak, efek teks). */
function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; text: string; title?: string }>
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={o.value === value}
          onClick={() => o.value !== value && onChange(o.value)}
          className={`${btn.base} px-2 py-1 text-xs ${
            o.value === value ? 'bg-sky-600 text-white' : 'border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
          }`}
        >
          {o.text}
        </button>
      ))}
    </div>
  )
}

function SubHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h3 className="-mb-1 border-t border-slate-800 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{children}</h3>
}

const MOTIONS: Array<{ value: TickerSource['motion']; text: string; title: string }> = [
  { value: 'left', text: '← Kiri', title: 'Teks berjalan dari kanan ke kiri' },
  { value: 'right', text: 'Kanan →', title: 'Teks berjalan dari kiri ke kanan' },
  { value: 'up', text: '↑ Naik', title: 'Pesan bergulir dari bawah ke atas, satu pesan per baris' },
  { value: 'bounce', text: '↔ Bolak-balik', title: 'Teks bergerak ke ujung lalu kembali' },
  { value: 'static', text: 'Diam', title: 'Teks diam di tengah; beberapa pesan tampil bergantian' }
]

const EFFECTS: Array<{ value: TickerSource['effect']; text: string }> = [
  { value: 'none', text: 'Tanpa' },
  { value: 'shadow', text: 'Bayangan' },
  { value: '3d', text: '3D' },
  { value: 'outline', text: 'Garis tepi' },
  { value: 'glow', text: 'Berpendar' }
]

const SEPARATORS = ['•', '★', '◆', '✦', '|', '—', '·', '']

/** Pengaturan teks berjalan: isi, gerak, gaya teks, efek, dan latar, dengan pratinjau langsung. */
function TickerSettings({
  src,
  tile,
  monitor,
  onChange
}: {
  src: TickerSource
  tile: Tile
  monitor: MonitorLayout
  onChange: (source: Source) => void
}): React.JSX.Element {
  const app = useOperator((s) => s.app)
  const set = (patch: Partial<TickerSource>): void => onChange({ ...src, ...patch })

  // Pratinjau digambar seukuran panel sebenarnya (perkiraan dari bagian grid monitor) lalu diperkecil.
  const display = app?.displays.find((d) => d.slot === monitor.slot)
  const screenW = display?.bounds.width ?? 1920
  const screenH = display?.bounds.height ?? 1080
  const panelW = Math.max(40, Math.round((tile.w / monitor.cols) * screenW))
  const panelH = Math.max(20, Math.round((tile.h / monitor.rows) * screenH))
  const scale = Math.min(306 / panelW, 140 / panelH)
  const moving = src.motion !== 'static'
  const separators = SEPARATORS.includes(src.separator) ? SEPARATORS : [src.separator, ...SEPARATORS]

  return (
    <>
      <div className="flex flex-col gap-2">
        <div
          className="mx-auto overflow-hidden rounded border border-slate-700"
          style={{ width: Math.round(panelW * scale), height: Math.round(panelH * scale) }}
          title="Pratinjau langsung"
        >
          <div style={{ width: panelW, height: panelH, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            <TickerView source={src} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={`${src.paused ? btn.primary : btn.secondary} flex-1`} onClick={() => set({ paused: !src.paused })}>
            {src.paused ? '▶ Jalankan' : '⏸ Jeda'}
          </button>
          <span className="text-xs text-slate-500">{src.paused ? 'Dijeda di wall' : 'Berjalan di wall'}</span>
        </div>
      </div>

      <SubHeading>Isi</SubHeading>
      <Field label="Teks berjalan" hint="Satu pesan per baris. Ctrl+Enter atau klik di luar kolom untuk menerapkan.">
        <CommitText
          multiline
          value={src.text}
          maxLength={2000}
          onCommit={(text) => {
            if (text.trim()) set({ text: text.trim() })
          }}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Label kiri">
          <CommitText value={src.badge} maxLength={40} placeholder="mis. INFO" onCommit={(badge) => set({ badge: badge.trim() })} />
        </Field>
        <Field label="Pemisah pesan">
          <select className={inputCls} value={src.separator} onChange={(e) => set({ separator: e.target.value })}>
            {separators.map((sep) => (
              <option key={sep} value={sep}>
                {sep || 'Spasi'}
              </option>
            ))}
          </select>
        </Field>
        {src.badge && (
          <>
            <Field label="Latar label">
              <CommitColor label="Warna latar label" value={src.badgeBg} onCommit={(badgeBg) => set({ badgeBg })} />
            </Field>
            <Field label="Teks label">
              <CommitColor label="Warna teks label" value={src.badgeFg} onCommit={(badgeFg) => set({ badgeFg })} />
            </Field>
          </>
        )}
      </div>

      <SubHeading>Gerak</SubHeading>
      <Segmented value={src.motion} options={MOTIONS} onChange={(motion) => set({ motion })} />
      {moving ? (
        <Field label="Kecepatan (detik melintasi panel)" hint="Makin kecil makin cepat.">
          <div className="flex gap-1.5">
            {TICKER_SPEEDS.map((sp) => (
              <button
                key={sp.text}
                type="button"
                className={`${btn.secondary} flex-1 px-2 py-1 text-xs ${src.speedSec === sp.sec ? 'border-sky-500 text-sky-300' : ''}`}
                onClick={() => set({ speedSec: sp.sec })}
              >
                {sp.text}
              </button>
            ))}
            <CommitNumber
              value={src.speedSec}
              min={2}
              max={600}
              integer={false}
              step={0.5}
              aria-label="Kecepatan (detik)"
              className={`${inputCls} w-20`}
              onCommit={(speedSec) => set({ speedSec })}
            />
          </div>
        </Field>
      ) : (
        <Field label="Ganti pesan setiap (detik)" hint="Berlaku bila ada lebih dari satu baris pesan.">
          <CommitNumber value={src.holdSec} min={2} max={600} className={inputCls} onCommit={(holdSec) => set({ holdSec })} />
        </Field>
      )}
      {(src.motion === 'left' || src.motion === 'right' || src.motion === 'up') && (
        <Check checked={src.continuous} onChange={(continuous) => set({ continuous })}>
          Bersambung tanpa jeda
          <span className="block text-[11px] text-slate-500">Teks diulang terus sehingga panel tidak pernah kosong.</span>
        </Check>
      )}
      {moving && (
        <Check checked={src.fadeEdges} onChange={(fadeEdges) => set({ fadeEdges })}>
          Tepi memudar
        </Check>
      )}

      <SubHeading>Gaya teks</SubHeading>
      <Field label="Gaya siap pakai" hint="Mengubah warna, huruf, dan efek; teks dan gerak tidak berubah.">
        <div className="flex flex-wrap gap-1.5">
          {TICKER_STYLES.map((st) => (
            <button
              key={st.id}
              type="button"
              className={`${btn.base} border border-slate-700 px-2 py-1 text-xs hover:brightness-125`}
              style={{ background: tickerBackground(st.style), color: st.style.fgColor, fontWeight: 700 }}
              onClick={() => set(st.style)}
            >
              {st.name}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Jenis huruf">
          <select className={inputCls} value={src.fontFamily} onChange={(e) => set({ fontFamily: e.target.value as TickerSource['fontFamily'] })}>
            {Object.entries(TICKER_FONTS).map(([id, f]) => (
              <option key={id} value={id}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ukuran teks (px)">
          <CommitNumber value={src.fontSize} min={12} max={288} className={inputCls} onCommit={(fontSize) => set({ fontSize })} />
        </Field>
      </div>
      <Segmented
        value={src.fontWeight}
        options={[
          { value: 'normal', text: 'Normal' },
          { value: 'bold', text: 'Tebal' },
          { value: 'black', text: 'Sangat tebal' }
        ]}
        onChange={(fontWeight) => set({ fontWeight })}
      />
      <div className="flex gap-4">
        <Check checked={src.italic} onChange={(italic) => set({ italic })}>
          <span className="italic">Miring</span>
        </Check>
        <Check checked={src.uppercase} onChange={(uppercase) => set({ uppercase })}>
          HURUF KAPITAL
        </Check>
      </div>
      <Field label="Jarak huruf">
        <CommitRange label="Jarak huruf" value={src.letterSpacing} min={-10} max={50} format={(v) => `${v}%`} onCommit={(letterSpacing) => set({ letterSpacing })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Warna teks">
          <CommitColor label="Warna teks" value={src.fgColor} onCommit={(fgColor) => set({ fgColor })} />
        </Field>
        <Field label={src.bgColor2 ? 'Latar atas' : 'Warna latar'}>
          <CommitColor label="Warna latar" value={src.bgColor} onCommit={(bgColor) => set({ bgColor })} />
        </Field>
        {src.bgColor2 && (
          <Field label="Latar bawah">
            <CommitColor label="Warna latar bawah" value={src.bgColor2} onCommit={(bgColor2) => set({ bgColor2 })} />
          </Field>
        )}
      </div>
      <Check checked={src.bgColor2 !== ''} onChange={(on) => set({ bgColor2: on ? '#000000' : '' })}>
        Latar gradasi
      </Check>

      <SubHeading>Efek teks</SubHeading>
      <Segmented value={src.effect} options={EFFECTS} onChange={(effect) => set({ effect })} />
      {src.effect !== 'none' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Warna efek">
            <CommitColor label="Warna efek" value={src.effectColor} onCommit={(effectColor) => set({ effectColor })} />
          </Field>
          <Field label="Kekuatan">
            <CommitRange label="Kekuatan efek" value={src.effectStrength} min={1} max={10} onCommit={(effectStrength) => set({ effectStrength })} />
          </Field>
        </div>
      )}
    </>
  )
}
