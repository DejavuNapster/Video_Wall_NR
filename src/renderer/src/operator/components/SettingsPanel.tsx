import type { SidecarState } from '@shared/types'
import { useOperator } from '../store'
import { btn, CommitNumber, inputCls, Pill, Row, Section, Switch } from './ui'

const SIDECAR_LABEL: Record<SidecarState, string> = {
  running: 'Berjalan',
  starting: 'Memulai…',
  failed: 'Gagal',
  stopped: 'Berhenti',
  disabled: 'Mati'
}

/** Pengaturan aplikasi (satu-satunya tempat; wall hanya berisi pengaturan tata letak). */
export function SettingsPanel(): React.JSX.Element | null {
  const app = useOperator((s) => s.app)
  const busy = useOperator((s) => s.busy)
  const { run, setNotice } = useOperator.getState()
  if (!app) return null
  const s = app.settings
  const update = (patch: object, okText?: string): void => void run((api) => api.updateSettings(patch), okText)
  const exclude = s.excludePrimaryFromWall === undefined ? 'auto' : s.excludePrimaryFromWall ? 'yes' : 'no'

  return (
    <div className="flex max-w-3xl flex-col gap-5 overflow-auto p-5">
      <Section title="Umum">
        <Row
          label="Jalan otomatis saat login"
          hint={app.autostart.supported ? 'Wall menyala sendiri setelah komputer hidup (Operator disembunyikan).' : app.autostart.reason}
        >
          <Switch
            label="Jalan otomatis saat login"
            checked={app.autostart.enabled}
            disabled={!app.autostart.supported}
            onChange={(autostart) => update({ autostart })}
          />
        </Row>
        <Row label="Monitor utama untuk Operator" hint="Bila ada lebih dari satu monitor, monitor utama bisa dikhususkan untuk jendela Operator.">
          <select
            className={`${inputCls} w-52`}
            value={exclude}
            disabled={app.windowed}
            onChange={(e) => update({ excludePrimaryFromWall: e.target.value === 'auto' ? null : e.target.value === 'yes' })}
          >
            <option value="auto">Otomatis</option>
            <option value="yes">Ya, jangan dipakai wall</option>
            <option value="no">Tidak, pakai untuk wall</option>
          </select>
        </Row>
        <Row label="Abaikan error sertifikat (semua panel)" hint="Untuk situs internal yang diakses lewat IP / self-signed. Panel terkait dimuat ulang.">
          <Switch
            label="Abaikan error sertifikat"
            checked={s.ignoreCertErrorsAll}
            onChange={(on) => {
              if (on && !window.confirm('Terima sertifikat HTTPS yang tidak valid untuk SEMUA panel?\nGunakan hanya untuk server internal tepercaya.')) return
              update({ ignoreCertErrorsAll: on })
            }}
          />
        </Row>
      </Section>

      <Section title="Pemulihan otomatis" description="Menjaga wall tetap berjalan 24/7 tanpa campur tangan.">
        <Row label="Muat ulang semua panel tiap" hint="Mitigasi kebocoran memori halaman web. 0 = mati. Bisa diganti per panel.">
          <div className="flex items-center gap-2">
            <CommitNumber aria-label="Interval muat ulang (jam)" value={s.reloadIntervalHours} min={0} max={168} step={0.5} integer={false} onCommit={(reloadIntervalHours) => update({ reloadIntervalHours })} />
            <span className="w-10 text-xs text-slate-500">jam</span>
          </div>
        </Row>
        <Row label="Video dianggap beku setelah" hint="Panel video dimuat ulang bila gambar tidak bergerak selama ini.">
          <div className="flex items-center gap-2">
            <CommitNumber aria-label="Batas video beku (detik)" value={s.videoStallSeconds} min={5} max={300} onCommit={(videoStallSeconds) => update({ videoStallSeconds })} />
            <span className="w-10 text-xs text-slate-500">detik</span>
          </div>
        </Row>
        <Row label="Batas memori per panel" hint="Panel dimuat ulang bila memorinya melewati batas ini. 0 = mati.">
          <div className="flex items-center gap-2">
            <CommitNumber aria-label="Batas memori (MB)" value={s.maxTileMemoryMB} min={0} max={32768} onCommit={(maxTileMemoryMB) => update({ maxTileMemoryMB })} />
            <span className="w-10 text-xs text-slate-500">MB</span>
          </div>
        </Row>
      </Section>

      <Section
        title="Kamera RTSP (MediaMTX)"
        description="Relay lokal yang mengubah RTSP menjadi WebRTC/HLS agar bisa diputar. Matikan bila tidak memakai kamera RTSP."
        actions={
          <Pill tone={app.sidecar.state === 'running' ? 'ok' : app.sidecar.state === 'failed' ? 'error' : 'muted'}>{SIDECAR_LABEL[app.sidecar.state]}</Pill>
        }
      >
        <Row label="Aktifkan relay RTSP">
          <Switch label="Aktifkan relay RTSP" checked={s.mediaMtx.enabled} onChange={(mediaMtxEnabled) => update({ mediaMtxEnabled })} />
        </Row>
        {app.sidecar.message && <p className="break-words rounded-md bg-slate-950 p-2 text-xs text-slate-400">{app.sidecar.message}</p>}
      </Section>

      <Section title="Backup & pulihkan" description="Semua preset dan pengaturan dalam satu file. Password kamera tidak ikut (tetap terenkripsi di komputer ini).">
        <div className="flex flex-wrap gap-2">
          <button
            className={btn.secondary}
            disabled={busy}
            onClick={() =>
              void run((api) => api.backupExport()).then((r) => {
                if (r.ok) setNotice({ kind: 'ok', text: `Backup disimpan ke ${r.path}` })
              })
            }
          >
            Ekspor backup…
          </button>
          <button
            className={btn.secondary}
            disabled={busy}
            onClick={() => {
              if (window.confirm('Pulihkan dari file backup? Semua preset & pengaturan saat ini akan diganti.')) {
                void run((api) => api.backupImport(), 'Preset & pengaturan dipulihkan dari backup')
              }
            }}
          >
            Pulihkan dari file…
          </button>
        </div>
      </Section>

      <p className="px-1 text-xs text-slate-500">
        Video Wall NR v{app.version} · {app.platform.os}
        {app.platform.session !== 'n/a' ? ` (${app.platform.session})` : ''} · Pintasan global: Ctrl+Alt+O tampilkan Operator, Ctrl+Alt+W tampilkan wall, Ctrl+Alt+Q keluar
      </p>
    </div>
  )
}
