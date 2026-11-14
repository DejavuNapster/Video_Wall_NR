import { useEffect } from 'react'
import { AutomationPanel } from './components/AutomationPanel'
import { BannerPanel } from './components/BannerPanel'
import { Header } from './components/Header'
import { Inspector } from './components/Inspector'
import { MonitorOverview } from './components/MonitorOverview'
import { PresetSidebar } from './components/PresetSidebar'
import { SettingsPanel } from './components/SettingsPanel'
import { useOperator } from './store'

const NOTICE_STYLE = {
  ok: 'border-emerald-500/40 text-emerald-200',
  warn: 'border-amber-500/40 text-amber-200',
  error: 'border-red-500/40 text-red-200'
} as const

function Notice(): React.JSX.Element | null {
  const notice = useOperator((s) => s.notice)
  const setNotice = useOperator((s) => s.setNotice)
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), notice.kind === 'error' ? 8000 : 4000)
    return () => clearTimeout(t)
  }, [notice, setNotice])
  if (!notice) return null
  return (
    <div
      role="status"
      onClick={() => setNotice(null)}
      className={`fixed bottom-4 left-1/2 z-50 max-w-xl -translate-x-1/2 cursor-pointer rounded-lg border bg-slate-900 px-4 py-2.5 text-sm shadow-2xl ${NOTICE_STYLE[notice.kind]}`}
    >
      {notice.text}
    </div>
  )
}

export function App(): React.JSX.Element {
  const app = useOperator((s) => s.app)
  const tab = useOperator((s) => s.tab)
  const selectedId = useOperator((s) => s.selected?.tileId)

  useEffect(() => {
    let off: (() => void) | undefined
    let cancelled = false
    void useOperator
      .getState()
      .init()
      .then((fn) => {
        if (cancelled) fn()
        else off = fn
      })
    return () => {
      cancelled = true
      off?.()
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <Header />
      {app ? (
        <div className="flex min-h-0 flex-1">
          <PresetSidebar />
          <main className="flex min-w-0 flex-1">
            {tab === 'monitor' && (
              <>
                <MonitorOverview />
                <Inspector key={selectedId ?? 'none'} />
              </>
            )}
            {tab === 'otomatisasi' && <AutomationPanel />}
            {tab === 'banner' && <BannerPanel />}
            {tab === 'pengaturan' && <SettingsPanel />}
          </main>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Memuat…</div>
      )}
      <Notice />
    </div>
  )
}
