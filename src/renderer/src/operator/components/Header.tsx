import type { SidecarState } from '@shared/types'
import { type Tab, useOperator } from '../store'
import { btn, Pill } from './ui'

const SIDECAR: Record<SidecarState, { tone: 'ok' | 'warn' | 'error' | 'muted'; text: string }> = {
  running: { tone: 'ok', text: 'RTSP siap' },
  starting: { tone: 'warn', text: 'RTSP memulai…' },
  failed: { tone: 'error', text: 'RTSP gagal' },
  stopped: { tone: 'muted', text: 'RTSP berhenti' },
  disabled: { tone: 'muted', text: 'RTSP mati' }
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'monitor', label: 'Monitor & Panel' },
  { id: 'otomatisasi', label: 'Otomatisasi' },
  { id: 'banner', label: 'Banner' },
  { id: 'pengaturan', label: 'Pengaturan' }
]

export function Header(): React.JSX.Element {
  const app = useOperator((s) => s.app)
  const tab = useOperator((s) => s.tab)
  const { setTab, run } = useOperator.getState()
  if (!app) return <header className="h-[92px] border-b border-slate-800" />

  const displayMode = app.settings.wall.displayMode
  const sidecar = SIDECAR[app.sidecar.state]
  const schedule = app.settings.wall.schedule.filter((e) => e.enabled).length
  const automation = schedule > 0 ? `${schedule} jadwal` : app.settings.wall.rotation.enabled ? 'rotasi' : null

  return (
    <header className="border-b border-slate-800 bg-slate-900/70">
      <div className="flex h-12 items-center gap-3 px-4">
        <h1 className="flex items-center gap-2 text-sm font-semibold tracking-wide">
          Video Wall Browser
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-normal text-slate-400">v{app.version}</span>
        </h1>
        <span className="text-xs text-slate-400">
          {app.wallSlots} monitor wall{app.windowed ? ' · mode windowed' : ''}
        </span>
        <Pill tone={sidecar.tone} title={app.sidecar.message ?? 'MediaMTX: relay kamera RTSP ke WebRTC/HLS'}>
          {sidecar.text}
        </Pill>

        <div className="ml-auto flex items-center gap-2">
          {app.banner && (
            <button className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500" onClick={() => setTab('banner')}>
              ● Banner aktif
            </button>
          )}
          <div className="flex overflow-hidden rounded-md border border-slate-700 text-xs" title="Ctrl+E di jendela wall">
            {([false, true] as const).map((on) => (
              <button
                key={String(on)}
                onClick={() =>
                  void run(async (api) => {
                    const res = on !== displayMode ? await api.updateSettings({ wall: { displayMode: on } }) : ({ ok: true } as const)
                    // Satu monitor: wall bisa tertutup Operator/aplikasi lain, jadi munculkan supaya hasilnya terlihat.
                    return res.ok ? api.showWalls() : res
                  })
                }
                className={`px-3 py-1.5 ${displayMode === on ? 'bg-sky-600 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
              >
                {on ? 'Mode Tampil' : 'Mode Atur'}
              </button>
            ))}
          </div>
          <button
            className={`${btn.primary} py-1 text-xs`}
            title="Munculkan jendela wall di depan jendela lain (Ctrl+Alt+W). Kembali ke Operator: Ctrl+Alt+O atau ikon di taskbar."
            onClick={() => void run((api) => api.showWalls())}
          >
            Tampilkan Wall
          </button>
          <button className={`${btn.secondary} py-1 text-xs`} onClick={() => void run((api) => api.identifyDisplays())}>
            Identifikasi monitor
          </button>
        </div>
      </div>

      <nav className="flex gap-1 px-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
              tab === t.id ? 'border-sky-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
            {t.id === 'otomatisasi' && automation && <Pill tone="info">{automation}</Pill>}
            {t.id === 'banner' && app.banner && <span className="h-2 w-2 rounded-full bg-red-500" />}
          </button>
        ))}
      </nav>

      {app.warnings.map((w) => (
        <div key={w} className="border-t border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          ⚠ {w}
        </div>
      ))}
      {app.saveError && (
        <div className="border-t border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-200">⚠ {app.saveError}</div>
      )}
    </header>
  )
}
