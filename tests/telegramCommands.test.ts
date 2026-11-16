import { describe, expect, it, vi } from 'vitest'
import { createDefaultPreset } from '@shared/layout'
import { SettingsSchema, SourceSchema } from '@shared/schema'
import { applyTickerPatch, type TickerPatch, type TickerSource } from '@shared/ticker'
import type { AppState, Preset } from '@shared/types'
import { alertMessage, testMessage } from '../src/main/telegram/alertMessages'
import { parseCommand, type Reply, runCallback, runCommand, type WallFacade } from '../src/main/telegram/commands'
import { assertMarkdownV2 } from './helpers/markdownV2'

function makeState(): AppState {
  const preset: Preset = createDefaultPreset(2, 'p1', 'Dashboard (Utama)')
  let n = 0
  for (const m of preset.monitors) {
    for (const t of m.tiles) t.source = { type: 'web', url: `http://10.0.0.${++n}/d`, zoom: 1, reloadMinutes: 0 } as never
  }
  preset.monitors[0]!.tiles[0]!.label = 'Grafana_Prod v2.1'
  return {
    presets: [
      { id: 'p1', name: 'Dashboard (Utama)', updatedAt: '' },
      { id: 'p2', name: 'Rapat', updatedAt: '' },
      { id: 'p3', name: 'Rapat Direksi', updatedAt: '' }
    ],
    activePresetId: 'p1',
    activePreset: preset,
    displays: [
      { id: 1, label: '', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, primary: true, slot: 0, virtual: false },
      { id: 2, label: '', bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, primary: false, slot: 1, virtual: false }
    ],
    tileStatus: {
      [preset.monitors[0]!.tiles[0]!.id]: { tileId: preset.monitors[0]!.tiles[0]!.id, monitorSlot: 0, state: 'ok', restarts: 0 },
      [preset.monitors[0]!.tiles[1]!.id]: {
        tileId: preset.monitors[0]!.tiles[1]!.id,
        monitorSlot: 0,
        state: 'failed',
        restarts: 2,
        lastError: 'net::ERR_CONNECTION_REFUSED (http://10.0.0.5:3000/d/abc?x=1)'
      }
    },
    settings: SettingsSchema.parse({
      bannerTemplates: [{ id: 'rapat', name: 'Rapat 13.00', banner: { title: 'Info', text: 'Rapat umum!' } }]
    }),
    banner: null,
    version: '0.2.9'
  } as unknown as AppState
}

function makeWall(state = makeState()): WallFacade & { s: AppState } {
  const w = {
    s: state,
    host: () => 'PC-WALL_1',
    state: () => w.s,
    activatePreset: vi.fn(async (id: string) => {
      w.s = { ...w.s, activePresetId: id }
      return { ok: true as const }
    }),
    stepPreset: vi.fn(async (dir: 1 | -1) => {
      const ids = w.s.presets.map((p) => p.id)
      const i = ids.indexOf(w.s.activePresetId ?? '')
      w.s = { ...w.s, activePresetId: ids[(i + dir + ids.length) % ids.length]! }
      return { ok: true as const }
    }),
    setDisplayMode: vi.fn(async () => ({ ok: true as const })),
    setRotation: vi.fn(async () => ({ ok: true as const })),
    showBanner: vi.fn((b) => {
      w.s = { ...w.s, banner: { banner: b, setAt: Date.now() } }
    }),
    clearBanner: vi.fn(() => {
      w.s = { ...w.s, banner: null }
    }),
    reloadMonitor: vi.fn(() => ({ ok: true as const })),
    reloadTile: vi.fn(() => ({ ok: true as const })),
    setTicker: vi.fn(async (slot: number, tileId: string, patch: TickerPatch) => {
      const tile = w.s.activePreset!.monitors.find((m) => m.slot === slot)!.tiles.find((t) => t.id === tileId)!
      const r = applyTickerPatch(tile.source as TickerSource, patch)
      if (r.ok) tile.source = r.source
      return r.ok ? { ok: true as const } : r
    }),
    capture: vi.fn(async () => Buffer.from([0xff, 0xd8]))
  }
  return w
}

const ctx = { chatId: '-1001', userId: '42', authorized: true }
const run = async (w: WallFacade, text: string): Promise<Reply> => {
  const cmd = parseCommand(text, 'WallBot')
  if (!cmd) throw new Error('bukan perintah')
  const r = await runCommand(cmd, w, ctx)
  assertMarkdownV2(r.text.text)
  for (const p of r.photos ?? []) assertMarkdownV2(p.caption.text)
  return r
}

describe('parseCommand', () => {
  it('nama, alias, argumen, dan akhiran @bot', () => {
    expect(parseCommand('/status', 'WallBot')).toEqual({ name: 'status', args: '' })
    expect(parseCommand('/Preset@wallbot  Rapat Direksi ', 'WallBot')).toEqual({ name: 'preset', args: 'Rapat Direksi' })
    expect(parseCommand('/next', 'WallBot')?.name).toBe('berikut')
    expect(parseCommand('/start', 'WallBot')?.name).toBe('bantuan')
    expect(parseCommand('/banner Baris 1\nBaris 2', 'WallBot')).toEqual({ name: 'banner', args: 'Baris 1\nBaris 2' })
    expect(parseCommand('/status@BotLain', 'WallBot')).toBeNull()
    expect(parseCommand('halo', 'WallBot')).toBeNull()
  })
})

describe('perintah Telegram', () => {
  it('/bantuan dan /status rapi, valid MarkdownV2, dan menandai panel bermasalah', async () => {
    const w = makeWall()
    expect((await run(w, '/bantuan')).text.plain).toContain('/muatulang')
    const st = await run(w, '/status')
    const plain = st.text.plain
    expect(plain).toContain('Status Video Wall')
    expect(plain).toContain('Preset: Dashboard (Utama) (1 dari 3)')
    expect(plain).toContain('1.1 🟢 Grafana_Prod v2.1')
    expect(plain).toMatch(/1\.2 🔴 .* — Gagal/)
    expect(plain).toContain('ERR_CONNECTION_REFUSED')
    expect(plain).toContain('🖥️ Monitor 2')
    expect(plain).toContain('1 panel bermasalah')
    expect(st.keyboard?.flat().map((b) => b.callback_data)).toEqual(['n:-1', 's', 'n:1', 'f', 'pl'])
  })

  it('/preset: daftar tombol, nomor, nama persis, sebagian unik, ambigu, dan tidak ada', async () => {
    const w = makeWall()
    const list = await run(w, '/preset')
    expect(list.keyboard?.[0]?.[0]).toEqual({ text: '✅ Dashboard (Utama)', callback_data: 'p:p1' })
    await run(w, '/preset 2')
    expect(w.activatePreset).toHaveBeenLastCalledWith('p2')
    expect((await run(w, '/preset rapat direksi')).text.plain).toBe('✅ Preset Rapat Direksi ditampilkan di wall.')
    await run(w, '/preset utama')
    expect(w.activatePreset).toHaveBeenLastCalledWith('p1')
    const amb = await run(w, '/preset rap')
    // "Rapat" dan "Rapat Direksi" sama-sama mengandung "rap": diminta memilih lewat tombol.
    expect(amb.text.plain).toContain('Ada 2 preset yang cocok')
    expect(amb.keyboard?.flat()).toHaveLength(2)
    expect((await run(w, '/preset 9')).text.plain).toContain('Tidak ada preset nomor 9')
    expect((await run(w, '/preset xyz')).text.plain).toContain('tidak ditemukan')
  })

  it('/berikut, /tampil, /rotasi', async () => {
    const w = makeWall()
    expect((await run(w, '/berikut')).text.plain).toBe('⏭️ Preset Rapat ditampilkan di wall.')
    await run(w, '/tampil')
    expect(w.setDisplayMode).toHaveBeenLastCalledWith(true)
    await run(w, '/rotasi nyala')
    expect(w.setRotation).toHaveBeenLastCalledWith(true)
    expect((await run(w, '/rotasi kadang')).text.plain).toContain('"nyala" atau "mati"')
  })

  it('/banner dan /darurat: tema, durasi, alarm, kutipan teks', async () => {
    const w = makeWall()
    const b = await run(w, '/banner Rapat umum pukul 13.00 (aula)!')
    expect(w.showBanner).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Informasi', durationSec: 300, sound: false, text: 'Rapat umum pukul 13.00 (aula)!' }))
    expect(b.text.text).toContain('>Rapat umum pukul 13\\.00 \\(aula\\)\\!')
    expect(b.text.plain).toContain('5 menit')
    const d = await run(w, '/darurat Evakuasi sekarang')
    expect(w.showBanner).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Pengumuman Darurat', durationSec: 0, sound: true }))
    expect(d.text.plain).toContain('Tampil sampai ditutup')
    expect((await run(w, '/banner')).text.plain).toContain('contoh')
    expect((await run(w, `/banner ${'x'.repeat(501)}`)).text.plain).toContain('maksimal 500')
    expect((await run(w, '/tutupbanner')).text.plain).toContain('ditutup')
    expect((await run(w, '/tutupbanner')).text.plain).toContain('Tidak ada banner')
  })

  it('/muatulang: semua, satu monitor, satu panel, dan nomor salah', async () => {
    const w = makeWall()
    // Preset bawaan: hanya panel berisi yang dihitung.
    const filled = w.s.activePreset!.monitors.flatMap((m) => m.tiles).filter((t) => t.source.type !== 'empty').length
    expect((await run(w, '/muatulang')).text.plain).toBe(`🔄 Semua panel dimuat ulang: 2 monitor, ${filled} panel.`)
    await run(w, '/muatulang 2')
    expect(w.reloadMonitor).toHaveBeenLastCalledWith(1)
    const one = await run(w, '/muatulang 1.2')
    expect(w.reloadTile).toHaveBeenLastCalledWith(0, w.s.activePreset!.monitors[0]!.tiles[1]!.id)
    expect(one.text.plain).toContain('1.2')
    expect((await run(w, '/muatulang 1.9')).text.plain).toContain('hanya punya 4 panel')
    w.s.activePreset!.monitors[1]!.tiles[0]!.source = { type: 'empty' } as never
    expect((await run(w, '/muatulang 2.1')).text.plain).toBe('ℹ️ Panel 2.1 kosong — tidak ada yang perlu dimuat ulang.')
    expect((await run(w, '/muatulang 5')).text.plain).toContain('Monitor 5 tidak aktif')
  })

  it('/foto: album dengan keterangan per panel', async () => {
    const w = makeWall()
    const all = await run(w, '/foto')
    const filled = w.s.activePreset!.monitors.flatMap((m) => m.tiles).filter((t) => t.source.type !== 'empty').length
    expect(all.photos).toHaveLength(filled)
    expect(all.photos?.[0]?.caption.plain).toContain('1.1 Grafana_Prod v2.1 · monitor 1 · PC-WALL_1')
    const two = await run(w, '/foto 2')
    expect(two.photos).toHaveLength(w.s.activePreset!.monitors[1]!.tiles.filter((t) => t.source.type !== 'empty').length)
    w.capture.mockResolvedValue(null as never)
    expect((await run(w, '/foto')).text.plain).toContain('Tidak ada panel')
  })

  it('/teks: daftar, ganti teks, jeda/jalan, panel tunggal tanpa nomor, dan nomor salah', async () => {
    const w = makeWall()
    expect((await run(w, '/teks')).text.plain).toContain('Tidak ada panel teks berjalan')
    const tile = w.s.activePreset!.monitors[1]!.tiles[0]!
    tile.source = SourceSchema.parse({ type: 'ticker', text: 'Selamat datang (lobi)\nRapat 14.00' })
    const ticker = (): TickerSource => tile.source as TickerSource

    const list = await run(w, '/teks')
    expect(list.text.plain).toContain('2.1 ▶️ Berjalan · Selamat datang (lobi)')
    expect(list.keyboard?.flat()).toEqual([{ text: '⏸️ Jeda 2.1', callback_data: 'kl:p:2.1' }])

    const changed = await run(w, '/teks 2.1 Baris satu!\nBaris dua')
    expect(ticker().text).toBe('Baris satu!\nBaris dua')
    expect(changed.text.plain).toContain('Teks panel 2.1 diganti')
    expect(changed.text.text).toContain('>Baris satu\\!\n>Baris dua')

    await run(w, '/teks 2.1 jeda')
    expect(ticker().paused).toBe(true)
    // Hanya satu panel teks berjalan: nomor panel boleh dilewati.
    expect((await run(w, '/teks jalan')).text.plain).toContain('dijalankan')
    expect(ticker().paused).toBe(false)
    await run(w, '/teks Pengumuman baru')
    expect(ticker().text).toBe('Pengumuman baru')

    expect((await run(w, '/teks 1.1 halo')).text.plain).toContain('Panel 1.1 bukan teks berjalan')
    expect((await run(w, '/teks 9.9 halo')).text.plain).toContain('Panel 9.9 tidak ada')
    expect((await run(w, `/teks 2.1 ${'x'.repeat(2001)}`)).text.plain).toContain('maksimal 2000')

    // Lebih dari satu panel: nomor wajib.
    w.s.activePreset!.monitors[1]!.tiles[1]!.source = SourceSchema.parse({ type: 'ticker', text: 'Kedua' })
    expect((await run(w, '/teks halo')).text.plain).toContain('Ada 2 panel teks berjalan')

    const cb = await runCallback('k:p:2.1', w)
    expect(cb.toast).toBe('Teks berjalan 2.1 dijeda')
    assertMarkdownV2(cb.edit!.text.text)
    expect(ticker().paused).toBe(true)
    expect((await runCallback('kl:r:2.1', w)).edit?.text.plain).toContain('2.1 ▶️ Berjalan')
    expect((await runCallback('k:p:7.7', w)).toast).toContain('tidak ditemukan')
  })

  it('/teks gaya: daftar tombol, nama atau id, potongan nama, tidak dikenal, dan tombol gaya', async () => {
    const w = makeWall()
    const tile = w.s.activePreset!.monitors[1]!.tiles[0]!
    tile.source = SourceSchema.parse({ type: 'ticker', text: 'Halo' })
    const ticker = (): TickerSource => tile.source as TickerSource

    const list = await run(w, '/teks 2.1 gaya')
    expect(list.text.plain).toContain('Gaya saat ini: Polos')
    const buttons = list.keyboard!.flat()
    expect(buttons.map((b) => b.callback_data)).toContain('kg:neon:2.1')
    expect(buttons.find((b) => b.callback_data === 'kg:plain:2.1')?.text).toBe('✅ Polos')

    const neon = await run(w, '/teks 2.1 gaya Neon')
    expect(neon.text.plain).toContain('Gaya Neon diterapkan ke panel 2.1')
    expect(ticker()).toMatchObject({ effect: 'glow', text: 'Halo' })
    await run(w, '/teks 2.1 gaya emas 3d')
    expect(ticker().effect).toBe('3d')
    await run(w, '/teks 2.1 gaya led')
    expect(ticker().fontFamily).toBe('mono')
    // Potongan nama yang hanya cocok dengan satu gaya; panel tunggal boleh tanpa nomor.
    await run(w, '/teks gaya garis')
    expect(ticker().effect).toBe('outline')
    expect((await run(w, '/teks 2.1 gaya')).text.plain).toContain('Gaya saat ini: Garis tepi')

    const unknown = await run(w, '/teks 2.1 gaya pelangi')
    expect(unknown.text.plain).toContain('Gaya pelangi tidak dikenal')
    expect(unknown.keyboard?.flat().length).toBeGreaterThan(0)
    expect(ticker().effect).toBe('outline')

    // Tombol "🎨 Gaya" di pesan panel, lalu tombol gaya.
    const panelMsg = await run(w, '/teks 2.1')
    expect(panelMsg.keyboard?.[0]?.[1]).toEqual({ text: '🎨 Gaya', callback_data: 'ks:2.1' })
    const ks = await runCallback('ks:2.1', w)
    assertMarkdownV2(ks.reply!.text.text)
    const kg = await runCallback('kg:warning:2.1', w)
    expect(kg.toast).toBe('Gaya "Peringatan" diterapkan ke panel 2.1')
    assertMarkdownV2(kg.edit!.text.text)
    expect(kg.edit?.text.plain).toContain('Gaya saat ini: Peringatan')
    expect(ticker().bgColor).toBe('#facc15')
    expect((await runCallback('kg:pelangi:2.1', w)).toast).toContain('tidak ditemukan')
  })

  it('/id dan perintah tak dikenal', async () => {
    const w = makeWall()
    const cmd = parseCommand('/id', 'WallBot')!
    const no = await runCommand(cmd, w, { chatId: '-100999', userId: '7', authorized: false })
    assertMarkdownV2(no.text.text)
    expect(no.text.plain).toContain('-100999')
    expect(no.text.plain).toContain('belum diizinkan')
    expect((await run(w, '/hapussemua')).text.plain).toContain('tidak dikenal')
  })
})

describe('tombol Telegram', () => {
  it('preset, langkah, segarkan, templat, tutup banner, dan tombol usang', async () => {
    const w = makeWall()
    const p = await runCallback('p:p2', w)
    expect(w.activatePreset).toHaveBeenLastCalledWith('p2')
    expect(p.toast).toBe('Preset "Rapat" ditampilkan')
    expect(p.edit?.keyboard?.[0]?.[1]?.text).toBe('✅ Rapat')
    expect((await runCallback('p:p2', w)).toast).toContain('sudah tampil')
    const n = await runCallback('n:1', w)
    expect(n.toast).toBe('Preset "Rapat Direksi" ditampilkan')
    assertMarkdownV2(n.edit!.text.text)
    expect((await runCallback('s', w)).edit).toBeDefined()
    const t = await runCallback('t:rapat', w)
    expect(w.showBanner).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'Rapat umum!' }))
    assertMarkdownV2(t.reply!.text.text)
    expect((await runCallback('bx', w)).toast).toBe('Banner ditutup')
    expect((await runCallback('p:hilang', w)).toast).toContain('tidak ditemukan')
    expect((await runCallback('zzz', w)).toast).toContain('tidak berlaku')
  })
})

describe('pesan peringatan Telegram', () => {
  it('bermasalah, pulih, dan uji: rapi dan valid MarkdownV2', () => {
    const panel = { name: 'CCTV Lobi (Pintu_1)', monitor: 2, ref: '2.3' }
    const down = alertMessage({ kind: 'down', tileId: 't', durationMs: 6 * 60_000, error: 'ERR_TIMED_OUT `x`' }, panel, 'PC-WALL')
    assertMarkdownV2(down.text)
    expect(down.plain).toContain('Panel bermasalah')
    expect(down.plain).toContain('CCTV Lobi (Pintu_1) 2.3')
    expect(down.plain).toContain('6 menit')
    expect(down.plain).toContain('/muatulang 2.3')
    expect(down.text).toContain('```\nERR_TIMED_OUT \\`x\\`\n```')
    const up = alertMessage({ kind: 'up', tileId: 't', durationMs: 90 * 60_000 }, { name: 'x', monitor: null, ref: null }, 'PC-WALL')
    assertMarkdownV2(up.text)
    expect(up.plain).toContain('1 jam 30 menit')
    assertMarkdownV2(testMessage('PC-WALL').text)
  })
})
