import { type AlertEvent, formatDuration } from '@shared/alerts'
import { bold, code, italic, lines, type Md, md, pre } from './markdown'

export interface PanelInfo {
  name: string
  /** Nomor monitor (1-based); null bila panel tidak lagi ada di preset. */
  monitor: number | null
  /** Nomor panel seperti di /status, mis. "2.3". */
  ref: string | null
}

function when(): string {
  return new Date().toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Peringatan panel bermasalah / pulih untuk Telegram (MarkdownV2). */
export function alertMessage(ev: AlertEvent, panel: PanelInfo, host: string): Md {
  const where = lines([
    md`📍 Panel: ${bold(panel.name)}${panel.ref ? md` ${code(panel.ref)}` : ''}`,
    panel.monitor !== null ? md`🖥️ Monitor: ${bold(String(panel.monitor))} · komputer ${code(host)}` : md`🖥️ Komputer: ${code(host)}`
  ])
  if (ev.kind === 'up') {
    return lines([
      md`✅ ${bold('Panel pulih')}`,
      '',
      where,
      md`⏱️ Sempat bermasalah: ${bold(formatDuration(ev.durationMs))}`,
      '',
      italic(when())
    ])
  }
  return lines([
    md`⚠️ ${bold('Panel bermasalah')}`,
    '',
    where,
    md`⏱️ Tidak tampil normal selama ${bold(formatDuration(ev.durationMs))}`,
    ev.error ? lines([md`❗ Penyebab:`, pre(ev.error.slice(0, 500))]) : null,
    '',
    panel.ref ? md`🔄 Muat ulang panel ini: ${code(`/muatulang ${panel.ref}`)}` : null,
    italic(when())
  ])
}

export function testMessage(host: string): Md {
  return lines([
    md`✅ ${bold('Uji peringatan Video Wall NR')}`,
    '',
    md`🖥️ Komputer: ${code(host)}`,
    md`Saluran ini ${bold('siap')} menerima peringatan panel bermasalah.`,
    '',
    italic(when())
  ])
}
