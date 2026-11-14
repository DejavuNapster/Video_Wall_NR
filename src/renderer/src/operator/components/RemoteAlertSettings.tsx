import { useState } from 'react'
import { useOperator } from '../store'
import { btn, CommitNumber, CommitText, inputCls, Pill, Row, Section, Switch } from './ui'

/** Kolom rahasia tulis-saja (password / token): nilai tersimpan tidak pernah ditampilkan ulang. */
function SecretField({
  label,
  isSet,
  placeholder,
  onSave
}: {
  label: string
  isSet: boolean
  placeholder: string
  onSave: (value: string) => Promise<boolean>
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const save = async (v: string): Promise<void> => {
    if (await onSave(v)) setValue('')
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="password"
        aria-label={label}
        className={`${inputCls} w-56`}
        value={value}
        autoComplete="new-password"
        placeholder={isSet ? 'Tersimpan — isi untuk mengganti' : placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value) void save(value)
        }}
      />
      <button className={btn.secondary} disabled={!value} onClick={() => void save(value)}>
        Simpan
      </button>
      {isSet && (
        <button className={`${btn.danger} px-2`} onClick={() => void save('')} title={`Hapus ${label.toLowerCase()}`}>
          Hapus
        </button>
      )}
    </div>
  )
}

/** Peringatan panel bermasalah (webhook / Telegram). */
export function AlertSettings(): React.JSX.Element | null {
  const app = useOperator((s) => s.app)
  const busy = useOperator((s) => s.busy)
  const { run } = useOperator.getState()
  if (!app) return null
  const a = app.settings.alerts
  const update = (alerts: object, okText?: string): void => void run((api) => api.updateSettings({ alerts }), okText)
  const hasChannel = !!a.webhookUrl || (!!a.telegramChatId && app.telegramTokenSet)

  return (
    <Section
      title="Peringatan panel bermasalah"
      description="Kirim pesan bila sebuah panel gagal tampil terus-menerus, mis. dashboard tidak bisa dibuka atau kamera terputus."
      actions={a.enabled ? <Pill tone={hasChannel ? 'ok' : 'warn'}>{hasChannel ? 'Aktif' : 'Belum ada saluran'}</Pill> : <Pill tone="muted">Mati</Pill>}
    >
      <Row label="Aktifkan peringatan">
        <Switch label="Aktifkan peringatan" checked={a.enabled} onChange={(enabled) => update({ enabled })} />
      </Row>
      <Row label="Kirim setelah bermasalah selama" hint="Gangguan singkat yang pulih sendiri tidak dilaporkan.">
        <div className="flex items-center gap-2">
          <CommitNumber aria-label="Batas waktu (menit)" value={a.afterMinutes} min={1} max={1440} onCommit={(afterMinutes) => update({ afterMinutes })} />
          <span className="w-10 text-xs text-slate-500">menit</span>
        </div>
      </Row>
      <Row label="Kabari saat panel pulih">
        <Switch label="Kabari saat panel pulih" checked={a.notifyRecovery} onChange={(notifyRecovery) => update({ notifyRecovery })} />
      </Row>
      <Row label="URL webhook" hint="POST JSON berisi { text, content, ... }; cocok untuk Slack, Discord, Google Chat, n8n, atau server sendiri.">
        <div className="w-72">
          <CommitText value={a.webhookUrl} spellCheck={false} placeholder="https://…" onCommit={(webhookUrl) => update({ webhookUrl: webhookUrl.trim() })} />
        </div>
      </Row>
      <Row label="Chat ID Telegram" hint="ID grup/obrolan (mis. -1001234567890) atau @namakanal. Bot harus sudah ditambahkan ke grup tersebut.">
        <div className="w-72">
          <CommitText value={a.telegramChatId} spellCheck={false} placeholder="-1001234567890" onCommit={(telegramChatId) => update({ telegramChatId: telegramChatId.trim() })} />
        </div>
      </Row>
      <Row label="Token bot Telegram" hint="Dari @BotFather. Disimpan terenkripsi di komputer ini dan tidak ikut backup.">
        <SecretField
          label="Token bot Telegram"
          isSet={app.telegramTokenSet}
          placeholder="123456789:AAH…"
          onSave={async (token) => (await run((api) => api.setTelegramToken(token), token ? 'Token Telegram disimpan' : 'Token Telegram dihapus')).ok}
        />
      </Row>
      <div className="flex justify-end">
        <button className={btn.secondary} disabled={busy} onClick={() => void run((api) => api.testAlert(), 'Pesan uji terkirim')}>
          Kirim pesan uji
        </button>
      </div>
    </Section>
  )
}

/** Kendali jarak jauh lewat browser di jaringan lokal. */
export function RemoteSettings(): React.JSX.Element | null {
  const app = useOperator((s) => s.app)
  const { run } = useOperator.getState()
  if (!app) return null
  const r = app.settings.remote
  const st = app.remote
  const update = (remote: object): void => void run((api) => api.updateSettings({ remote }))

  return (
    <Section
      title="Kendali jarak jauh"
      description="Operasikan wall dari ponsel atau komputer lain di jaringan yang sama: ganti preset, Mode Tampil, banner, pratinjau, dan muat ulang panel."
      actions={st.running ? <Pill tone="ok">Berjalan</Pill> : st.error ? <Pill tone="error">Gagal</Pill> : <Pill tone="muted">Mati</Pill>}
    >
      <Row label="Aktifkan kendali jarak jauh" hint={st.passwordSet ? undefined : 'Atur password terlebih dahulu.'}>
        <Switch label="Aktifkan kendali jarak jauh" checked={r.enabled} onChange={(enabled) => update({ enabled })} />
      </Row>
      <Row label="Password" hint="Minimal 8 karakter. Mengganti password mengeluarkan semua perangkat yang sedang masuk.">
        <SecretField
          label="Password kendali jarak jauh"
          isSet={st.passwordSet}
          placeholder="Minimal 8 karakter"
          onSave={async (password) => (await run((api) => api.setRemotePassword(password), password ? 'Password disimpan' : 'Password dihapus')).ok}
        />
      </Row>
      <Row label="Port" hint="Bila diganti, server dimulai ulang di port baru.">
        <CommitNumber aria-label="Port" value={r.port} min={1024} max={65535} onCommit={(port) => update({ port })} />
      </Row>
      {st.error && <p className="rounded-md bg-red-500/10 p-2 text-xs text-red-200">{st.error}</p>}
      {st.running && (
        <div className="rounded-md bg-slate-950 p-3 text-xs text-slate-400">
          Buka salah satu alamat ini dari perangkat di jaringan yang sama:
          <ul className="mt-1.5 flex flex-col gap-1">
            {st.urls.map((u) => (
              <li key={u} className="flex items-center gap-2">
                <code className="text-sm text-sky-300">{u}</code>
                <button className={`${btn.ghost} px-2 py-0.5 text-[11px]`} onClick={() => void navigator.clipboard?.writeText(u)}>
                  Salin
                </button>
              </li>
            ))}
            {st.urls.length === 0 && <li>Komputer ini belum terhubung ke jaringan.</li>}
          </ul>
          <p className="mt-2">
            Saat pertama kali diaktifkan, Windows mungkin meminta izin firewall: pilih <b>Private networks</b>. Koneksi tidak
            terenkripsi (HTTP), jadi gunakan hanya di jaringan kantor yang tepercaya.
          </p>
        </div>
      )}
    </Section>
  )
}
