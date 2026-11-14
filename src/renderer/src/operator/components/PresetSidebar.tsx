import { useOperator } from '../store'
import { btn, CommitText } from './ui'

/**
 * Daftar preset. Klik = tampilkan di wall. Ganti nama / duplikat / hapus berlaku untuk preset aktif
 * (preset yang sedang tampil), sama seperti edit panel yang selalu langsung tampil di wall.
 */
export function PresetSidebar(): React.JSX.Element {
  const app = useOperator((s) => s.app)
  const busy = useOperator((s) => s.busy)
  const { run } = useOperator.getState()
  const presets = app?.presets ?? []
  const active = app?.activePreset ?? null

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900/40">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Preset</h2>
        <button
          className={`${btn.ghost} px-2 py-1 text-xs`}
          title="Preset baru (2x2 panel kosong per monitor) dan langsung tampilkan"
          disabled={busy}
          onClick={() => void run((api) => api.preset({ op: 'create' }), 'Preset baru dibuat')}
        >
          + Baru
        </button>
      </div>

      <ul className="flex-1 space-y-0.5 overflow-auto px-2 pb-2">
        {presets.map((p, i) => {
          const isActive = p.id === app?.activePresetId
          return (
            <li key={p.id}>
              <button
                disabled={busy}
                onClick={() => !isActive && void run((api) => api.preset({ op: 'activate', id: p.id }))}
                title={isActive ? 'Sedang tampil di wall' : `Tampilkan di wall${i < 9 ? ` (Ctrl+${i + 1} di wall)` : ''}`}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                  isActive ? 'bg-sky-500/15 text-sky-100 ring-1 ring-sky-500/40' : 'text-slate-300 hover:bg-slate-800/70'
                }`}
              >
                <span className="w-4 shrink-0 text-right font-mono text-[11px] text-slate-500">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {isActive && <span className="shrink-0 text-[10px] font-semibold uppercase text-sky-300">tampil</span>}
              </button>
            </li>
          )
        })}
      </ul>

      {active && (
        <div className="flex flex-col gap-2 border-t border-slate-800 p-3">
          <span className="text-xs font-medium text-slate-400">Preset aktif</span>
          <CommitText
            aria-label="Nama preset aktif"
            value={active.name}
            maxLength={80}
            onCommit={(name) => {
              if (name.trim()) void run((api) => api.preset({ op: 'rename', name }))
            }}
          />
          <div className="flex gap-2">
            <button
              className={`${btn.secondary} flex-1 text-xs`}
              disabled={busy}
              onClick={() => void run((api) => api.preset({ op: 'duplicate' }), 'Preset diduplikat')}
            >
              Duplikat
            </button>
            <button
              className={`${btn.danger} flex-1 text-xs`}
              disabled={busy || presets.length <= 1}
              title={presets.length <= 1 ? 'Preset terakhir tidak bisa dihapus' : 'Hapus preset aktif lalu pindah ke preset berikutnya'}
              onClick={() => {
                if (window.confirm(`Hapus preset "${active.name}" secara permanen?`)) {
                  void run((api) => api.preset({ op: 'delete' }), 'Preset dihapus')
                }
              }}
            >
              Hapus
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
