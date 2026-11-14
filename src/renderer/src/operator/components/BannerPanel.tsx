import { useEffect, useState } from 'react'
import { BANNER_THEMES } from '@shared/bannerThemes'
import { slugify, uniqueId } from '@shared/editor'
import type { BannerMode, BannerTemplate, EmergencyBanner } from '@shared/types'
import { useOperator } from '../store'
import { DAYS, DayPicker, daysLabel, pad } from './AutomationPanel'
import { btn, inputCls, labelCls, Section, Switch } from './ui'

const DURATIONS: Array<[number, string]> = [
  [60, '1 menit'],
  [300, '5 menit'],
  [900, '15 menit'],
  [1800, '30 menit'],
  [3600, '1 jam'],
  [0, 'Sampai ditutup']
]

const THEMES = BANNER_THEMES
const DEFAULT_THEME = THEMES[0]!

function remaining(setAt: number, durationSec: number, now: number): string {
  if (durationSec <= 0) return 'tampil sampai ditutup'
  const left = Math.max(0, Math.round((setAt + durationSec * 1000 - now) / 1000))
  const m = Math.floor(left / 60)
  return `sisa ${m > 0 ? `${m} mnt ` : ''}${left % 60} dtk`
}

/** Banner pengumuman di semua monitor wall. State hidup di main; panel ini formulir + status. */
export function BannerPanel(): React.JSX.Element | null {
  const app = useOperator((s) => s.app)
  const busy = useOperator((s) => s.busy)
  const { run } = useOperator.getState()
  const [title, setTitle] = useState(DEFAULT_THEME.title)
  const [text, setText] = useState('')
  const [bgColor, setBgColor] = useState(DEFAULT_THEME.bg)
  const [fgColor, setFgColor] = useState(DEFAULT_THEME.fg)
  const [fontSize, setFontSize] = useState(96)
  const [durationSec, setDurationSec] = useState(300)
  const [pinned, setPinned] = useState(false)
  const [mode, setMode] = useState<BannerMode>('cover')
  const [sound, setSound] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const live = app?.banner ?? null

  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live])

  if (!app) return null
  const valid = text.trim().length > 0
  const templates = app.settings.bannerTemplates

  const current = (): EmergencyBanner => ({ title: title.trim(), text: text.trim(), bgColor, fgColor, fontSize, durationSec, pinned, mode, sound })
  const show = (): void => {
    if (!valid) return
    const banner = current()
    void run((api) => api.setBanner(banner), 'Banner ditampilkan di semua monitor wall')
  }
  /** Isi formulir dari templat. */
  const fill = (b: EmergencyBanner): void => {
    setTitle(b.title)
    setText(b.text)
    setBgColor(b.bgColor)
    setFgColor(b.fgColor)
    setFontSize(b.fontSize)
    setDurationSec(b.durationSec)
    setPinned(b.pinned)
    setMode(b.mode)
    setSound(b.sound)
  }
  const saveTemplate = (): void => {
    const name = templateName.trim() || text.trim().slice(0, 60)
    if (!valid || !name) return
    const existing = templates.find((t) => t.name.toLowerCase() === name.toLowerCase())
    const next: BannerTemplate[] = existing
      ? templates.map((t) => (t.id === existing.id ? { ...t, banner: current() } : t))
      : [...templates, { id: uniqueId(slugify(name), templates.map((t) => t.id)), name, banner: current() }]
    void run((api) => api.updateSettings({ bannerTemplates: next }), existing ? `Templat "${name}" diperbarui` : `Templat "${name}" disimpan`).then((r) => {
      if (r.ok) setTemplateName('')
    })
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5 overflow-auto p-5">
      {live && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-red-100">
              {live.banner.title && <span className="font-normal text-red-200/80">{live.banner.title}: </span>}
              {live.banner.text}
            </div>
            <div className="text-xs text-red-200/70">
              {live.banner.mode === 'strip' ? 'Strip atas' : 'Layar penuh'} · {remaining(live.setAt, live.banner.durationSec, now)}
              {live.banner.pinned ? ' · hanya bisa ditutup dari Operator' : ''}
            </div>
          </div>
          <button className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-500" disabled={busy} onClick={() => void run((api) => api.clearBanner(), 'Banner ditutup')}>
            Tutup banner
          </button>
        </div>
      )}

      <Section title="Banner pengumuman" description="Pengumuman (darurat, peringatan, info, atau umum) yang tampil di semua monitor wall sekaligus.">
        <div>
          <span className={labelCls}>Tema</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {THEMES.map((c) => (
              <button
                key={c.label}
                onClick={() => {
                  setBgColor(c.bg)
                  setFgColor(c.fg)
                  // Judul ikut tema, kecuali sudah diubah sendiri atau sengaja dikosongkan.
                  if (THEMES.some((t) => t.title === title)) setTitle(c.title)
                }}
                className={`rounded-md px-3 py-1 text-xs font-medium ring-offset-2 ring-offset-slate-900 ${bgColor === c.bg && fgColor === c.fg ? 'ring-2 ring-sky-400' : ''}`}
                style={{ backgroundColor: c.bg, color: c.fg }}
              >
                {c.label}
              </button>
            ))}
            <span className="ml-2 text-[11px] text-slate-500">Warna sendiri:</span>
            <input type="color" aria-label="Warna latar" title="Warna latar" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="h-7 w-8 cursor-pointer rounded border border-slate-700 bg-slate-950 p-0.5" />
            <input type="color" aria-label="Warna teks" title="Warna teks" value={fgColor} onChange={(e) => setFgColor(e.target.value)} className="h-7 w-8 cursor-pointer rounded border border-slate-700 bg-slate-950 p-0.5" />
          </div>
        </div>

        <label>
          <span className={labelCls}>Judul</span>
          <input
            maxLength={60}
            className={inputCls}
            placeholder="Kosongkan bila tanpa judul"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="mt-1 block text-[11px] text-slate-500">Tampil kecil di atas teks. Otomatis mengikuti tema; boleh diubah atau dikosongkan.</span>
        </label>

        <label>
          <span className={labelCls}>Teks pengumuman</span>
          <textarea
            rows={3}
            maxLength={500}
            className={inputCls}
            placeholder="Contoh: EVAKUASI — segera menuju titik kumpul"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <span className="mt-1 block text-right text-[11px] text-slate-500">{text.length}/500</span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className={labelCls}>Tampilan</span>
            <div className="flex overflow-hidden rounded-md border border-slate-700 text-sm">
              {(
                [
                  ['cover', 'Layar penuh'],
                  ['strip', 'Strip atas']
                ] as const
              ).map(([m, l]) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 px-3 py-1.5 ${mode === m ? 'bg-sky-600 text-white' : 'bg-slate-950 text-slate-300 hover:bg-slate-800'}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">{mode === 'strip' ? 'Panel tetap terlihat di bawah strip.' : 'Menutupi seluruh layar wall.'}</p>
          </div>
          <label>
            <span className={labelCls}>Lama tampil</span>
            <select className={inputCls} value={durationSec} onChange={(e) => setDurationSec(Number(e.target.value))}>
              {DURATIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          <span className={labelCls}>Ukuran teks: {fontSize}px</span>
          <input type="range" min={24} max={240} step={4} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="w-full accent-sky-500" />
        </label>

        <div className="flex items-center gap-3">
          <Switch label="Bunyikan alarm" checked={sound} onChange={setSound} />
          <div className="text-sm text-slate-300">
            Bunyikan alarm
            <span className="block text-xs text-slate-500">Sirene singkat (±5 detik) dari speaker komputer wall saat banner muncul.</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Switch label="Kunci banner" checked={pinned} onChange={setPinned} />
          <div className="text-sm text-slate-300">
            Kunci banner
            <span className="block text-xs text-slate-500">Tombol "Tutup" di wall disembunyikan; hanya bisa ditutup dari Operator.</span>
          </div>
        </div>

        <div className="rounded-md border border-slate-800 p-3">
          <span className={labelCls}>Pratinjau</span>
          <div className="flex min-h-20 flex-col items-center justify-center gap-1 rounded px-4 py-3 text-center" style={{ backgroundColor: bgColor, color: fgColor }}>
            {title.trim() && <span className="text-[11px] font-semibold uppercase tracking-[0.3em] opacity-80">{title.trim()}</span>}
            <span className="font-bold" style={{ fontSize: Math.max(14, Math.round(fontSize / 4)) }}>
              {text.trim() || 'Teks pengumuman'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <input
            className={`${inputCls} w-56`}
            maxLength={60}
            placeholder="Nama templat (opsional)"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
          />
          <button className={btn.secondary} disabled={!valid || busy} onClick={saveTemplate} title="Simpan isi formulir ini agar bisa dipakai ulang atau dijadwalkan">
            Simpan sebagai templat
          </button>
          <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40" disabled={!valid || busy} onClick={show}>
            {live ? 'Ganti banner' : 'Tampilkan di wall'}
          </button>
        </div>
      </Section>

      <TemplateList templates={templates} onFill={fill} />
      <BannerSchedule templates={templates} />
    </div>
  )
}

function TemplateList({ templates, onFill }: { templates: BannerTemplate[]; onFill: (b: EmergencyBanner) => void }): React.JSX.Element {
  const app = useOperator((s) => s.app)
  const { run } = useOperator.getState()
  const remove = (t: BannerTemplate): void => {
    const used = app?.settings.bannerSchedule.some((e) => e.templateId === t.id)
    if (!window.confirm(`Hapus templat "${t.name}"?${used ? '\nJadwal yang memakai templat ini juga dihapus.' : ''}`)) return
    void run(
      (api) =>
        api.updateSettings({
          bannerTemplates: templates.filter((x) => x.id !== t.id),
          bannerSchedule: (app?.settings.bannerSchedule ?? []).filter((e) => e.templateId !== t.id)
        }),
      'Templat dihapus'
    )
  }
  return (
    <Section title="Templat banner" description="Banner tersimpan untuk ditampilkan dengan satu klik, dijadwalkan, atau dipakai dari kendali jarak jauh.">
      {templates.length === 0 ? (
        <p className="text-sm text-slate-500">Belum ada templat. Isi formulir di atas, lalu klik "Simpan sebagai templat".</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-3 py-2">
              <span className="h-5 w-5 shrink-0 rounded" style={{ backgroundColor: t.banner.bgColor }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-200">{t.name}</div>
                <div className="truncate text-xs text-slate-500">
                  {t.banner.title ? `${t.banner.title}: ` : ''}
                  {t.banner.text}
                </div>
              </div>
              <button className={`${btn.ghost} px-2 py-1 text-xs`} onClick={() => onFill(t.banner)}>
                Isi formulir
              </button>
              <button className={`${btn.secondary} px-2 py-1 text-xs`} onClick={() => void run((api) => api.setBanner(t.banner), `Banner "${t.name}" ditampilkan`)}>
                Tampilkan
              </button>
              <button className={`${btn.danger} px-2 py-1 text-xs`} onClick={() => remove(t)}>
                Hapus
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function BannerSchedule({ templates }: { templates: BannerTemplate[] }): React.JSX.Element {
  const app = useOperator((s) => s.app)
  const { run } = useOperator.getState()
  const [templateId, setTemplateId] = useState('')
  const [time, setTime] = useState('13:00')
  const [days, setDays] = useState<number[]>(DAYS.map(([d]) => d))
  const entries = app?.settings.bannerSchedule ?? []
  const chosen = templates.some((t) => t.id === templateId) ? templateId : (templates[0]?.id ?? '')
  const save = (next: typeof entries, okText?: string): void => void run((api) => api.updateSettings({ bannerSchedule: next }), okText)

  const add = (): void => {
    const [h, m] = time.split(':').map(Number)
    if (!chosen || h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m) || days.length === 0) return
    const id = uniqueId(`b-${pad(h)}${pad(m)}`, entries.map((e) => e.id))
    const entry = { id, templateId: chosen, hour: h, minute: m, enabled: true, ...(days.length < 7 ? { weekdays: [...days].sort() } : {}) }
    const next = [...entries, entry].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))
    save(next, 'Jadwal banner ditambahkan')
  }

  return (
    <Section title="Jadwal banner" description="Tampilkan templat banner secara otomatis pada jam tertentu, mis. pengingat rapat atau jam istirahat.">
      {templates.length === 0 ? (
        <p className="text-sm text-slate-500">Simpan minimal satu templat untuk membuat jadwal.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label>
            <span className={labelCls}>Templat</span>
            <select className={`${inputCls} w-52`} value={chosen} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelCls}>Jam</span>
            <input type="time" className={`${inputCls} w-28`} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <div>
            <span className={labelCls}>Hari</span>
            <DayPicker value={days} onChange={setDays} />
          </div>
          <button className={btn.primary} disabled={days.length === 0} onClick={add}>
            Tambah jadwal
          </button>
        </div>
      )}
      {entries.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm">
              <Switch
                label="Aktif"
                checked={e.enabled}
                onChange={(enabled) => save(entries.map((x) => (x.id === e.id ? { ...x, enabled } : x)))}
              />
              <span className="w-12 font-mono text-slate-200">
                {pad(e.hour)}:{pad(e.minute)}
              </span>
              <span className="min-w-0 flex-1 truncate text-slate-300">
                {templates.find((t) => t.id === e.templateId)?.name ?? `(templat "${e.templateId}" tidak ada)`}
              </span>
              <span className="text-xs text-slate-500">{daysLabel(e)}</span>
              <button className={`${btn.danger} px-2 py-1 text-xs`} onClick={() => save(entries.filter((x) => x.id !== e.id), 'Jadwal banner dihapus')}>
                Hapus
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
