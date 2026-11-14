import { useState } from 'react'
import { uniqueId } from '@shared/editor'
import type { ScheduleEntry } from '@shared/types'
import { useOperator } from '../store'
import { btn, CommitNumber, inputCls, labelCls, Pill, Row, Section, Switch } from './ui'

const DAYS: Array<[number, string]> = [
  [1, 'Sen'],
  [2, 'Sel'],
  [3, 'Rab'],
  [4, 'Kam'],
  [5, 'Jum'],
  [6, 'Sab'],
  [0, 'Min']
]

const pad = (n: number): string => String(n).padStart(2, '0')

function daysLabel(e: ScheduleEntry): string {
  if (!e.weekdays || e.weekdays.length === 7) return 'Setiap hari'
  return DAYS.filter(([d]) => e.weekdays?.includes(d))
    .map(([, l]) => l)
    .join(', ')
}

function DayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }): React.JSX.Element {
  return (
    <div className="flex gap-1">
      {DAYS.map(([d, l]) => {
        const on = value.includes(d)
        return (
          <button
            key={d}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d])}
            className={`h-8 w-10 rounded-md border text-xs ${on ? 'border-sky-500 bg-sky-600/30 text-sky-100' : 'border-slate-700 text-slate-500 hover:bg-slate-800'}`}
          >
            {l}
          </button>
        )
      })}
    </div>
  )
}

/** Otomatisasi pergantian preset: rotasi interval dan jadwal berbasis jam (jadwal lebih kuat). */
export function AutomationPanel(): React.JSX.Element | null {
  const app = useOperator((s) => s.app)
  const { run } = useOperator.getState()
  const [presetId, setPresetId] = useState('')
  const [time, setTime] = useState('07:00')
  const [days, setDays] = useState<number[]>(DAYS.map(([d]) => d))
  if (!app) return null

  const wall = app.settings.wall
  const presets = app.presets
  const schedule = wall.schedule
  const scheduleActive = schedule.some((e) => e.enabled)
  const chosen = presets.some((p) => p.id === presetId) ? presetId : (presets[0]?.id ?? '')
  const presetName = (id: string): string => presets.find((p) => p.id === id)?.name ?? `(preset "${id}" tidak ada)`

  const saveSchedule = (next: ScheduleEntry[], okText?: string): void =>
    void run((api) => api.updateSettings({ wall: { schedule: next } }), okText)
  const setRotation = (patch: { enabled?: boolean; intervalSec?: number }): void =>
    void run((api) => api.updateSettings({ wall: { rotation: patch } }))

  let rotationState: { tone: 'ok' | 'warn' | 'muted'; text: string }
  if (!wall.rotation.enabled) rotationState = { tone: 'muted', text: 'Mati' }
  else if (scheduleActive) rotationState = { tone: 'warn', text: 'Dijeda — ada jadwal aktif' }
  else if (!wall.displayMode) rotationState = { tone: 'warn', text: 'Menunggu Mode Tampil' }
  else if (presets.length < 2) rotationState = { tone: 'warn', text: 'Butuh minimal 2 preset' }
  else rotationState = { tone: 'ok', text: 'Berjalan' }

  const add = (): void => {
    const [h, m] = time.split(':').map(Number)
    if (!chosen || h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m) || days.length === 0) return
    const entry: ScheduleEntry = {
      id: uniqueId('jadwal', schedule.map((e) => e.id)),
      presetId: chosen,
      hour: h,
      minute: m,
      enabled: true,
      ...(days.length < 7 ? { weekdays: [...days].sort((a, b) => a - b) } : {})
    }
    const next = [...schedule, entry].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))
    saveSchedule(next, `Jadwal ${time} ditambahkan`)
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5 overflow-auto p-5">
      <Section
        title="Rotasi preset"
        description="Ganti preset secara bergiliran sesuai urutan daftar. Hanya berjalan di Mode Tampil, dan dijeda selama ada jadwal aktif."
        actions={<Pill tone={rotationState.tone}>{rotationState.text}</Pill>}
      >
        <Row label="Aktifkan rotasi" hint="Shortcut di wall: Ctrl+Spasi">
          <Switch label="Aktifkan rotasi" checked={wall.rotation.enabled} onChange={(enabled) => setRotation({ enabled })} />
        </Row>
        <Row label="Interval" hint="Lama tiap preset tampil, dalam detik (10 – 86.400).">
          <div className="flex items-center gap-2">
            <CommitNumber aria-label="Interval rotasi (detik)" value={wall.rotation.intervalSec} min={10} max={86_400} onCommit={(intervalSec) => setRotation({ intervalSec })} />
            <span className="text-xs text-slate-500">detik</span>
          </div>
        </Row>
      </Section>

      <Section
        title="Jadwal preset"
        description="Tampilkan preset tertentu pada jam tertentu (waktu komputer ini). Jadwal lebih kuat daripada rotasi."
      >
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-slate-800 bg-slate-950/60 p-3">
          <label className="min-w-48 flex-1">
            <span className={labelCls}>Preset</span>
            <select className={inputCls} value={chosen} onChange={(e) => setPresetId(e.target.value)} disabled={presets.length === 0}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelCls}>Jam</span>
            <input type="time" className={`${inputCls} w-32`} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <div>
            <span className={labelCls}>Hari</span>
            <DayPicker value={days} onChange={setDays} />
          </div>
          <button className={btn.primary} onClick={add} disabled={!chosen || !time || days.length === 0}>
            Tambah
          </button>
        </div>

        {schedule.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada jadwal.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-md border border-slate-800">
            {schedule.map((e) => (
              <li key={e.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${e.enabled ? '' : 'opacity-50'}`}>
                <span className="w-14 font-mono tabular-nums text-slate-100">
                  {pad(e.hour)}:{pad(e.minute)}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-200" title={e.presetId}>
                  {presetName(e.presetId)}
                </span>
                <span className="text-xs text-slate-500">{daysLabel(e)}</span>
                <Switch
                  label="Jadwal aktif"
                  checked={e.enabled}
                  onChange={(enabled) => saveSchedule(schedule.map((x) => (x.id === e.id ? { ...x, enabled } : x)))}
                />
                <button className={`${btn.ghost} px-2 py-1 text-xs`} onClick={() => saveSchedule(schedule.filter((x) => x.id !== e.id))}>
                  Hapus
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
