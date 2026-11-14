import { BANNER_THEMES } from '@shared/bannerThemes'
import { EmergencyBannerSchema } from '@shared/schema'
import { tileSummary } from '@shared/tileSummary'
import type { AppState, EmergencyBanner, Result, TileState } from '@shared/types'
import type { Keyboard, Photo } from './api'
import { bold, clip, code, italic, lines, type Md, md, quote } from './markdown'

/** Bagian aplikasi yang dipakai perintah Telegram (dipisah agar bisa diuji tanpa Electron). */
export interface WallFacade {
  host(): string
  state(): AppState
  activatePreset(id: string): Promise<Result>
  stepPreset(dir: 1 | -1): Promise<Result>
  setDisplayMode(on: boolean): Promise<Result>
  setRotation(on: boolean): Promise<Result>
  showBanner(banner: EmergencyBanner): void
  clearBanner(): void
  reloadMonitor(slot: number): Result
  reloadTile(slot: number, tileId: string): Result
  /** Gambar JPEG panel yang sedang terlihat (null = tidak tampil / gagal diambil). */
  capture(tileId: string): Promise<Buffer | null>
}

export interface Reply {
  text: Md
  keyboard?: Keyboard
  photos?: Photo[]
}

export interface CallbackResult {
  /** Teks singkat di notifikasi tombol (teks biasa, maks. 200 karakter). */
  toast?: string
  /** Ganti isi pesan yang tombolnya diketuk. */
  edit?: Reply
  /** Kirim pesan baru. */
  reply?: Reply
}

export interface ParsedCommand {
  name: string
  args: string
}

/** Nama perintah resmi beserta alias (termasuk nama bahasa Inggris yang umum di bot Telegram). */
const ALIASES: Record<string, string> = {
  start: 'bantuan',
  help: 'bantuan',
  bantuan: 'bantuan',
  status: 'status',
  preset: 'preset',
  berikut: 'berikut',
  next: 'berikut',
  sebelum: 'sebelum',
  prev: 'sebelum',
  tampil: 'tampil',
  atur: 'atur',
  rotasi: 'rotasi',
  banner: 'banner',
  darurat: 'darurat',
  templat: 'templat',
  template: 'templat',
  tutupbanner: 'tutupbanner',
  muatulang: 'muatulang',
  reload: 'muatulang',
  foto: 'foto',
  screenshot: 'foto',
  id: 'id'
}

/** Menu perintah yang didaftarkan ke Telegram (setMyCommands). */
export const BOT_COMMANDS: Array<{ command: string; description: string }> = [
  { command: 'status', description: 'Ringkasan wall dan kondisi panel' },
  { command: 'foto', description: 'Cuplikan panel (opsional: nomor monitor)' },
  { command: 'preset', description: 'Pilih atau tampilkan preset' },
  { command: 'berikut', description: 'Preset berikutnya' },
  { command: 'sebelum', description: 'Preset sebelumnya' },
  { command: 'tampil', description: 'Mode Tampil' },
  { command: 'atur', description: 'Mode Atur' },
  { command: 'rotasi', description: 'Rotasi preset: nyala / mati' },
  { command: 'banner', description: 'Banner informasi 5 menit' },
  { command: 'darurat', description: 'Banner darurat dengan alarm' },
  { command: 'templat', description: 'Tampilkan templat banner' },
  { command: 'tutupbanner', description: 'Tutup banner' },
  { command: 'muatulang', description: 'Muat ulang panel (semua, monitor, atau panel)' },
  { command: 'id', description: 'Chat ID dan user ID Anda' },
  { command: 'bantuan', description: 'Daftar perintah' }
]

/**
 * "/preset@NamaBot Rapat" → { name: 'preset', args: 'Rapat' }. Perintah untuk bot lain di grup (akhiran @bot
 * lain) dan teks yang bukan perintah menghasilkan null.
 */
export function parseCommand(text: string, botUsername: string | undefined): ParsedCommand | null {
  const m = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!m) return null
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.toLowerCase()) return null
  const raw = m[1]!.toLowerCase()
  return { name: ALIASES[raw] ?? raw, args: (m[3] ?? '').trim() }
}

const STATE_INFO: Record<TileState, { icon: string; label: string }> = {
  ok: { icon: '🟢', label: 'Berjalan' },
  loading: { icon: '🟡', label: 'Memuat' },
  idle: { icon: '⚪', label: 'Menunggu' },
  failed: { icon: '🔴', label: 'Gagal' },
  crashed: { icon: '🔴', label: 'Crash' },
  stalled: { icon: '🟠', label: 'Beku' },
  unresponsive: { icon: '🟠', label: 'Tidak merespons' }
}
const BAD: ReadonlySet<TileState> = new Set(['failed', 'crashed', 'stalled', 'unresponsive'])

interface PanelRef {
  slot: number
  tileId: string
  /** "2.3" = monitor 2, panel 3 (urutan panel di preset). */
  ref: string
  name: string
  /** Panel tanpa sumber: tidak ada yang dimuat ulang atau difoto. */
  empty: boolean
}

/** Monitor wall yang aktif beserta panelnya, dengan nomor yang sama seperti di /status. */
function wallMonitors(s: AppState): Array<{ slot: number; panels: PanelRef[] }> {
  const slots = new Set(s.displays.filter((d) => d.slot !== null).map((d) => d.slot))
  return (s.activePreset?.monitors ?? [])
    .filter((m) => slots.has(m.slot))
    .map((m) => ({
      slot: m.slot,
      panels: m.tiles.map((t, i) => ({
        slot: m.slot,
        tileId: t.id,
        ref: `${m.slot + 1}.${i + 1}`,
        name: tileSummary(t),
        empty: t.source.type === 'empty'
      }))
    }))
}

const fail = (error: string): Reply => ({ text: md`❌ ${bold('Gagal:')} ${error}` })
const done = (r: Result, ok: Md): Reply => (r.ok ? { text: ok } : fail(r.error))
const usage = (example: string, what: string): Reply => ({ text: lines([md`ℹ️ ${what}, contoh:`, code(example)]) })

function presetName(s: AppState, id: string | null): string {
  return s.presets.find((p) => p.id === id)?.name ?? '-'
}

function timeNow(): string {
  return new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ------------------------------------------------------------------ pesan

export function helpMessage(host: string): Reply {
  const c = (cmd: string, desc: string, arg?: string): Md => (arg ? md`${cmd} ${code(arg)} — ${desc}` : md`${cmd} — ${desc}`)
  return {
    text: lines([
      md`🤖 ${bold('Kendali Video Wall NR')}`,
      md`🖥️ Komputer: ${code(host)}`,
      '',
      bold('📊 Pantau'),
      c('/status', 'ringkasan wall dan kondisi panel'),
      c('/foto', 'cuplikan semua panel'),
      c('/foto', 'cuplikan panel monitor 2 saja', '2'),
      '',
      bold('🎬 Preset'),
      c('/preset', 'pilih preset lewat tombol'),
      c('/preset', 'tampilkan preset berdasarkan nama atau nomor', 'Rapat'),
      c('/berikut · /sebelum', 'preset berikutnya / sebelumnya'),
      '',
      bold('🖼️ Tampilan'),
      c('/tampil · /atur', 'Mode Tampil / Mode Atur'),
      c('/rotasi', 'rotasi preset', 'nyala'),
      '',
      bold('📢 Banner'),
      c('/banner', 'banner informasi selama 5 menit', 'teks'),
      c('/darurat', 'banner darurat dengan alarm, sampai ditutup', 'teks'),
      c('/templat', 'pilih templat banner'),
      c('/tutupbanner', 'tutup banner'),
      '',
      bold('🔄 Panel'),
      c('/muatulang', 'muat ulang semua panel'),
      c('/muatulang', 'monitor 2, atau panel 3 di monitor 2', '2 · 2.3'),
      '',
      md`🪪 /id — chat ID dan user ID Anda`,
      italic('Nomor panel (mis. 2.3) sama dengan yang tertera di /status.')
    ])
  }
}

export function statusMessage(s: AppState, host: string): Reply {
  const monitors = wallMonitors(s)
  const total = s.presets.length
  const idx = s.presets.findIndex((p) => p.id === s.activePresetId)
  const out: Array<Md | string> = [
    md`📊 ${bold('Status Video Wall')}`,
    md`🖥️ ${code(host)} · ${italic(`v${s.version}`)}`,
    '',
    md`🎬 Preset: ${bold(presetName(s, s.activePresetId))}${idx >= 0 ? md` ${italic(`(${idx + 1} dari ${total})`)}` : ''}`,
    md`🖼️ Mode: ${bold(s.settings.wall.displayMode ? 'Tampil' : 'Atur')}`,
    md`🔁 Rotasi preset: ${bold(s.settings.wall.rotation.enabled ? 'nyala' : 'mati')}${
      s.settings.wall.rotation.enabled && s.settings.wall.schedule.some((e) => e.enabled) ? md` ${italic('(dijeda: jadwal aktif)')}` : ''
    }`
  ]
  if (s.banner) {
    const b = s.banner.banner
    const left = b.durationSec > 0 ? Math.max(0, Math.ceil((s.banner.setAt + b.durationSec * 1000 - Date.now()) / 60_000)) : null
    out.push(md`📢 Banner: ${bold(b.title || 'Banner')} ${italic(left === null ? '(sampai ditutup)' : `(sisa ±${left} menit)`)}`)
    out.push(quote(clip(b.text, 200)))
  } else {
    out.push(md`📢 Banner: ${italic('tidak ada')}`)
  }

  let bad = 0
  for (const m of monitors) {
    out.push('', md`${bold(`🖥️ Monitor ${m.slot + 1}`)} · ${m.panels.length} panel`)
    if (m.panels.length === 0) out.push(italic('Belum ada panel'))
    for (const p of m.panels) {
      const st = s.tileStatus[p.tileId]
      const info = st ? STATE_INFO[st.state] : { icon: '⚪', label: 'Kosong' }
      if (st && BAD.has(st.state)) bad++
      const problem = st && BAD.has(st.state)
      out.push(md`${code(p.ref)} ${info.icon} ${clip(p.name, 48)}${problem ? md` — ${italic(info.label)}` : ''}`)
      if (problem && st.lastError) out.push(md`      ${code(clip(st.lastError, 80))}`)
    }
  }
  if (monitors.length === 0) out.push('', italic('Belum ada monitor wall yang aktif.'))
  out.push('', bad ? md`⚠️ ${bold(`${bad} panel bermasalah`)}` : md`✅ Semua panel normal`, italic(`Diperbarui ${timeNow()}`))
  return {
    text: lines(out),
    keyboard: [
      [
        { text: '◀️ Sebelum', callback_data: 'n:-1' },
        { text: '🔄 Segarkan', callback_data: 's' },
        { text: 'Berikut ▶️', callback_data: 'n:1' }
      ],
      [
        { text: '📸 Foto panel', callback_data: 'f' },
        { text: '🎬 Preset', callback_data: 'pl' }
      ]
    ]
  }
}

/** Data tombol preset: pakai ID bila muat di batas 64 byte Telegram, selain itu nomor urut. */
const presetData = (s: AppState, id: string): string => (`p:${id}`.length <= 64 ? `p:${id}` : `pi:${s.presets.findIndex((p) => p.id === id)}`)

export function presetListMessage(s: AppState): Reply {
  if (s.presets.length === 0) return { text: md`ℹ️ Belum ada preset.` }
  return {
    text: lines([
      md`🎬 ${bold('Pilih preset')}`,
      md`Sedang tampil: ${bold(presetName(s, s.activePresetId))}`,
      italic('Ketuk preset untuk menampilkannya di wall.')
    ]),
    keyboard: [
      ...chunk(
        s.presets.map((p) => ({ text: `${p.id === s.activePresetId ? '✅ ' : ''}${clip(p.name, 30)}`, callback_data: presetData(s, p.id) })),
        2
      ),
      [
        { text: '◀️ Sebelum', callback_data: 'n:-1' },
        { text: 'Berikut ▶️', callback_data: 'n:1' }
      ]
    ]
  }
}

function templateListMessage(s: AppState): Reply {
  const t = s.settings.bannerTemplates
  if (t.length === 0) return { text: lines([md`ℹ️ Belum ada templat banner.`, italic('Simpan templat dari Operator › Banner.')]) }
  return {
    text: lines([md`📋 ${bold('Templat banner')}`, italic('Ketuk templat untuk menampilkannya di wall.')]),
    keyboard: [
      ...chunk(
        t.map((x) => ({ text: clip(x.name, 30), callback_data: `t:${x.id}`.length <= 64 ? `t:${x.id}` : `ti:${t.indexOf(x)}` })),
        2
      ),
      ...(s.banner ? [[{ text: '✖️ Tutup banner', callback_data: 'bx' }]] : [])
    ]
  }
}

function bannerShown(b: EmergencyBanner, heading: Md): Reply {
  return {
    text: lines([
      heading,
      b.title ? md`🏷️ ${bold(b.title)}` : null,
      quote(clip(b.text, 500)),
      b.durationSec > 0 ? md`⏱️ Hilang otomatis dalam ${bold(formatMinutes(b.durationSec))}` : md`📌 Tampil sampai ditutup — /tutupbanner`,
      b.sound ? md`🔊 Alarm dibunyikan` : null
    ]),
    keyboard: [[{ text: '✖️ Tutup banner', callback_data: 'bx' }]]
  }
}

function formatMinutes(sec: number): string {
  if (sec < 60) return `${sec} detik`
  if (sec % 3600 === 0) return `${sec / 3600} jam`
  return `${Math.round(sec / 60)} menit`
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ------------------------------------------------------------------ eksekusi

function findPreset(s: AppState, arg: string): { id: string; name: string } | { error: Reply } {
  const n = /^\d+$/.test(arg) ? Number(arg) : NaN
  if (!Number.isNaN(n)) {
    const p = s.presets[n - 1]
    return p ? p : { error: { text: lines([md`❓ Tidak ada preset nomor ${bold(arg)}.`, md`Ada ${s.presets.length} preset — ketik /preset untuk melihat daftarnya.`]) } }
  }
  const q = arg.toLowerCase()
  const exact = s.presets.find((p) => p.name.toLowerCase() === q)
  if (exact) return exact
  const partial = s.presets.filter((p) => p.name.toLowerCase().includes(q))
  if (partial.length === 1) return partial[0]!
  if (partial.length > 1) {
    return {
      error: {
        text: lines([md`🤔 Ada ${partial.length} preset yang cocok dengan ${bold(arg)}:`, ...partial.map((p) => md`• ${p.name}`), italic('Pilih salah satu:')]),
        keyboard: chunk(
          partial.map((p) => ({ text: clip(p.name, 30), callback_data: presetData(s, p.id) })),
          2
        )
      }
    }
  }
  return { error: { text: lines([md`❓ Preset ${bold(arg)} tidak ditemukan.`, md`Ketik /preset untuk melihat daftarnya.`]) } }
}

async function activate(w: WallFacade, id: string): Promise<Reply> {
  const r = await w.activatePreset(id)
  return done(r, md`✅ Preset ${bold(presetName(w.state(), id))} ditampilkan di wall.`)
}

async function step(w: WallFacade, dir: 1 | -1): Promise<Reply> {
  const r = await w.stepPreset(dir)
  const s = w.state()
  return done(r, md`${dir === 1 ? '⏭️' : '⏮️'} Preset ${bold(presetName(s, s.activePresetId))} ditampilkan di wall.`)
}

function bannerFrom(args: string, theme: 'info' | 'darurat'): { banner: EmergencyBanner } | { error: Reply } {
  const t = BANNER_THEMES.find((x) => x.id === theme)!
  const r = EmergencyBannerSchema.safeParse({
    title: t.title,
    text: args,
    bgColor: t.bg,
    fgColor: t.fg,
    durationSec: theme === 'darurat' ? 0 : 300,
    sound: theme === 'darurat'
  })
  if (!r.success) return { error: fail(args.length > 500 ? 'Teks banner maksimal 500 karakter.' : (r.error.issues[0]?.message ?? 'Teks banner tidak valid.')) }
  return { banner: r.data }
}

function bannerClosed(title: string): Reply {
  return { text: title ? md`✅ Banner ${bold(title)} ditutup.` : md`✅ Banner ditutup.` }
}

async function reload(w: WallFacade, arg: string): Promise<Reply> {
  const monitors = wallMonitors(w.state())
  if (!arg) {
    let panels = 0
    for (const m of monitors) {
      const r = w.reloadMonitor(m.slot)
      if (r.ok) panels += m.panels.filter((p) => !p.empty).length
    }
    return { text: md`🔄 Semua panel dimuat ulang: ${bold(`${monitors.length} monitor`)}, ${bold(`${panels} panel`)}.` }
  }
  const m = /^(\d+)(?:\.(\d+))?$/.exec(arg)
  if (!m) return usage('/muatulang 2.3', 'Tulis nomor monitor atau panel')
  const mon = monitors.find((x) => x.slot === Number(m[1]) - 1)
  if (!mon) return fail(`Monitor ${m[1]} tidak aktif.`)
  if (!m[2]) {
    const n = mon.panels.filter((p) => !p.empty).length
    return done(w.reloadMonitor(mon.slot), md`🔄 Semua panel ${bold(`monitor ${m[1]}`)} dimuat ulang ${italic(`(${n} panel)`)}.`)
  }
  const p = mon.panels[Number(m[2]) - 1]
  if (!p) return fail(`Monitor ${m[1]} hanya punya ${mon.panels.length} panel.`)
  if (p.empty) return { text: md`ℹ️ Panel ${code(p.ref)} kosong — tidak ada yang perlu dimuat ulang.` }
  return done(w.reloadTile(p.slot, p.tileId), md`🔄 Panel ${code(p.ref)} ${bold(clip(p.name, 48))} dimuat ulang.`)
}

async function photos(w: WallFacade, arg: string): Promise<Reply> {
  const all = wallMonitors(w.state())
  let monitors = all
  if (arg) {
    if (!/^\d+$/.test(arg)) return usage('/foto 2', 'Tulis nomor monitor')
    monitors = all.filter((m) => m.slot === Number(arg) - 1)
    if (monitors.length === 0) return fail(`Monitor ${arg} tidak aktif.`)
  }
  const host = w.host()
  const out: Photo[] = []
  for (const m of monitors) {
    for (const p of m.panels) {
      if (p.empty) continue
      const jpeg = await w.capture(p.tileId)
      if (jpeg) out.push({ jpeg, caption: md`📸 ${code(p.ref)} ${bold(clip(p.name, 60))} · monitor ${m.slot + 1} · ${code(host)}` })
    }
  }
  if (out.length === 0) return { text: lines([md`ℹ️ Tidak ada panel yang sedang tampil untuk difoto.`, italic('Panel kosong, gagal dimuat, atau tertutup banner tidak bisa difoto.')]) }
  return {
    text: md`📸 ${bold(`${out.length} cuplikan panel`)} dari ${code(host)} · ${italic(timeNow())}`,
    photos: out
  }
}

export interface CommandContext {
  chatId: string
  userId: string | null
  authorized: boolean
}

/** Jalankan satu perintah dan susun balasannya. */
export async function runCommand(cmd: ParsedCommand, w: WallFacade, ctx: CommandContext): Promise<Reply> {
  const s = w.state()
  switch (cmd.name) {
    case 'id':
      return {
        text: lines([
          md`🪪 ${bold('Identitas Telegram')}`,
          md`💬 Chat ID: ${code(ctx.chatId)}`,
          ctx.userId ? md`👤 User ID: ${code(ctx.userId)}` : null,
          '',
          ctx.authorized
            ? md`✅ Chat ini sudah diizinkan memberi perintah ke wall.`
            : lines([md`🔒 Chat ini ${bold('belum diizinkan')} memberi perintah.`, italic('Tambahkan Chat ID di atas di Operator › Pengaturan › Kendali lewat Telegram.')])
        ])
      }
    case 'bantuan':
      return helpMessage(w.host())
    case 'status':
      return statusMessage(s, w.host())
    case 'preset': {
      if (!cmd.args) return presetListMessage(s)
      const p = findPreset(s, cmd.args)
      return 'error' in p ? p.error : activate(w, p.id)
    }
    case 'berikut':
      return step(w, 1)
    case 'sebelum':
      return step(w, -1)
    case 'tampil':
      return done(await w.setDisplayMode(true), md`🖼️ ${bold('Mode Tampil')} aktif — tombol dan bingkai panel disembunyikan.`)
    case 'atur':
      return done(await w.setDisplayMode(false), md`🛠️ ${bold('Mode Atur')} aktif — panel bisa digeser dan diubah dari wall.`)
    case 'rotasi': {
      const a = cmd.args.toLowerCase()
      const on = /^(nyala|on|aktif|hidup|1|ya)$/.test(a) ? true : /^(mati|off|nonaktif|0|tidak)$/.test(a) ? false : a ? null : !s.settings.wall.rotation.enabled
      if (on === null) return usage('/rotasi nyala', 'Tulis "nyala" atau "mati"')
      const r = await w.setRotation(on)
      const after = w.state().settings.wall
      return done(
        r,
        lines([
          md`🔁 Rotasi preset ${bold(on ? 'dinyalakan' : 'dimatikan')}.`,
          on && after.schedule.some((e) => e.enabled) ? italic('Jadwal preset aktif, jadi rotasi dijeda selama ada jadwal.') : null,
          on && !after.displayMode ? italic('Rotasi berjalan saat wall di Mode Tampil (/tampil).') : null
        ])
      )
    }
    case 'banner':
    case 'darurat': {
      if (!cmd.args) return usage(cmd.name === 'banner' ? '/banner Rapat umum pukul 13.00 di aula' : '/darurat Evakuasi gedung lewat tangga darurat', 'Tulis teks banner setelah perintah')
      const b = bannerFrom(cmd.args, cmd.name === 'banner' ? 'info' : 'darurat')
      if ('error' in b) return b.error
      w.showBanner(b.banner)
      return bannerShown(b.banner, cmd.name === 'banner' ? md`📢 ${bold('Banner ditampilkan')} di wall` : md`🚨 ${bold('Banner darurat ditampilkan')} di wall`)
    }
    case 'templat':
      return templateListMessage(s)
    case 'tutupbanner':
      if (!s.banner) return { text: md`ℹ️ Tidak ada banner yang sedang tampil.` }
      w.clearBanner()
      return bannerClosed(s.banner.banner.title)
    case 'muatulang':
      return reload(w, cmd.args)
    case 'foto':
      return photos(w, cmd.args)
    default:
      return { text: lines([md`❓ Perintah ${code(`/${cmd.name}`)} tidak dikenal.`, md`Ketik /bantuan untuk daftar perintah.`]) }
  }
}

/** Tombol di bawah pesan diketuk. */
export async function runCallback(data: string, w: WallFacade): Promise<CallbackResult> {
  const s = w.state()
  if (data === 's') return { toast: 'Status diperbarui', edit: statusMessage(s, w.host()) }
  if (data === 'pl') return { reply: presetListMessage(s) }
  if (data === 'f') return { toast: 'Mengambil cuplikan panel…', reply: await photos(w, '') }
  if (data === 'bx') {
    if (!s.banner) return { toast: 'Tidak ada banner yang sedang tampil' }
    w.clearBanner()
    return { toast: 'Banner ditutup', reply: bannerClosed(s.banner.banner.title) }
  }
  const nav = /^n:(-?1)$/.exec(data)
  if (nav) {
    const r = await w.stepPreset(Number(nav[1]) as 1 | -1)
    if (!r.ok) return { toast: r.error }
    const after = w.state()
    return { toast: `Preset "${presetName(after, after.activePresetId)}" ditampilkan`, edit: statusMessage(after, w.host()) }
  }
  const p = /^p:(.+)$/.exec(data) ?? /^pi:(\d+)$/.exec(data)
  if (p) {
    const id = data.startsWith('pi:') ? s.presets[Number(p[1])]?.id : p[1]
    if (!id || !s.presets.some((x) => x.id === id)) return { toast: 'Preset tidak ditemukan (daftar sudah berubah)' }
    if (id === s.activePresetId) return { toast: `Preset "${presetName(s, id)}" sudah tampil` }
    const r = await w.activatePreset(id)
    if (!r.ok) return { toast: r.error }
    return { toast: `Preset "${presetName(s, id)}" ditampilkan`, edit: presetListMessage(w.state()) }
  }
  const t = /^t:(.+)$/.exec(data) ?? /^ti:(\d+)$/.exec(data)
  if (t) {
    const list = s.settings.bannerTemplates
    const tpl = data.startsWith('ti:') ? list[Number(t[1])] : list.find((x) => x.id === t[1])
    if (!tpl) return { toast: 'Templat tidak ditemukan (daftar sudah berubah)' }
    w.showBanner(tpl.banner)
    return { toast: `Banner "${tpl.name}" ditampilkan`, reply: bannerShown(tpl.banner, md`📢 Templat ${bold(tpl.name)} ditampilkan di wall`) }
  }
  return { toast: 'Tombol ini sudah tidak berlaku' }
}
