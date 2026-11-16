import { useEffect, useRef, useState } from 'react'

export const inputCls =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none disabled:opacity-50'
export const labelCls = 'mb-1 block text-xs font-medium text-slate-400'
const btnBase = 'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40'
export const btn = {
  base: btnBase,
  primary: `${btnBase} bg-sky-600 text-white hover:bg-sky-500`,
  secondary: `${btnBase} border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800`,
  danger: `${btnBase} border border-red-500/40 text-red-300 hover:bg-red-500/10`,
  ghost: `${btnBase} text-slate-400 hover:bg-slate-800 hover:text-slate-200`
}

/** Kartu bagian dengan judul dan keterangan singkat. */
export function Section({
  title,
  description,
  actions,
  children
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50">
      <header className="flex items-start gap-3 border-b border-slate-800 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </section>
  )
}

/** Baris pengaturan: label + keterangan di kiri, kontrol di kanan. */
export function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <div className="min-w-56 flex-1">
        <div className="text-sm text-slate-200">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  label: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${checked ? 'bg-sky-500' : 'bg-slate-700'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

/**
 * Kolom teks yang baru dikirim saat Enter / keluar fokus (bukan setiap ketikan), supaya panel tidak
 * dimuat ulang di tiap huruf. Selama tidak sedang diedit, nilainya mengikuti state dari main.
 */
export function CommitText({
  value,
  onCommit,
  multiline,
  ...rest
}: {
  value: string
  onCommit: (value: string) => void
  multiline?: boolean
  placeholder?: string
  maxLength?: number
  className?: string
  'aria-label'?: string
  spellCheck?: boolean
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])
  const commit = (): void => {
    editing.current = false
    if (draft !== value) onCommit(draft)
  }
  const common = {
    ...rest,
    value: draft,
    className: rest.className ?? inputCls,
    onFocus: () => {
      editing.current = true
    },
    onBlur: commit
  }
  if (multiline) {
    return (
      <textarea
        {...common}
        rows={3}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.blur()
        }}
      />
    )
  }
  return (
    <input
      {...common}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          editing.current = false
          setDraft(value)
          setTimeout(() => (e.target as HTMLInputElement).blur())
        }
      }}
    />
  )
}

/** Kolom angka: dikirim saat Enter / keluar fokus; nilai di luar rentang dikembalikan. */
export function CommitNumber({
  value,
  min,
  max,
  step,
  onCommit,
  className,
  integer = true,
  'aria-label': ariaLabel
}: {
  value: number
  min: number
  max: number
  step?: number
  onCommit: (value: number) => void
  className?: string
  integer?: boolean
  'aria-label'?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (): void => {
    const raw = Number(draft)
    const n = integer ? Math.round(raw) : raw
    if (draft.trim() === '' || !Number.isFinite(n) || n < min || n > max) return setDraft(String(value))
    if (n !== value) onCommit(n)
  }
  return (
    <input
      type="number"
      aria-label={ariaLabel}
      value={draft}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className={className ?? `${inputCls} w-28`}
    />
  )
}

/** Pemilih warna: dikirim dengan jeda singkat supaya geser di color picker tidak membanjiri IPC. */
export function CommitColor({ value, onCommit, label }: { value: string; onCommit: (value: string) => void; label: string }): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setDraft(value), [value])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  return (
    <input
      type="color"
      aria-label={label}
      value={draft}
      onChange={(e) => {
        const v = e.target.value
        setDraft(v)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => onCommit(v), 250)
      }}
      className="h-8 w-full cursor-pointer rounded-md border border-slate-700 bg-slate-950 p-0.5"
    />
  )
}

/** Penggeser angka: dikirim dengan jeda singkat (seperti CommitColor) supaya geseran tidak membanjiri IPC. */
export function CommitRange({
  value,
  min,
  max,
  step = 1,
  onCommit,
  label,
  format = String
}: {
  value: number
  min: number
  max: number
  step?: number
  onCommit: (value: number) => void
  label: string
  format?: (value: number) => string
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setDraft(value), [value])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => {
          const v = Number(e.target.value)
          setDraft(v)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => onCommit(v), 250)
        }}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-sky-500"
      />
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-400">{format(draft)}</span>
    </div>
  )
}

/** Teks kecil berwarna untuk status. */
export function Pill({ tone, children, title }: { tone: 'ok' | 'warn' | 'error' | 'info' | 'muted'; children: React.ReactNode; title?: string }): React.JSX.Element {
  const tones = {
    ok: 'bg-emerald-500/15 text-emerald-300',
    warn: 'bg-amber-500/15 text-amber-300',
    error: 'bg-red-500/15 text-red-300',
    info: 'bg-sky-500/15 text-sky-300',
    muted: 'bg-slate-700/40 text-slate-400'
  }
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}
