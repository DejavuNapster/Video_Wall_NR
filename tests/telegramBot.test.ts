import { describe, expect, it, vi } from 'vitest'
import { SettingsSchema } from '@shared/schema'
import type { TelegramApi } from '../src/main/telegram/api'
import { isAuthorized, TelegramControl } from '../src/main/telegram/bot'
import type { WallFacade } from '../src/main/telegram/commands'
import type { Md } from '../src/main/telegram/markdown'
import { assertMarkdownV2 } from './helpers/markdownV2'

vi.mock('../src/main/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

const base = { enabled: true, allowedChatIds: [] as string[], allowedUserIds: [] as string[] }

describe('izin perintah Telegram', () => {
  it('chat peringatan & chat tambahan diizinkan; chat lain ditolak', () => {
    expect(isAuthorized({ id: -1001 }, { id: 5 }, base, '-1001')).toBe(true)
    expect(isAuthorized({ id: 77 }, { id: 77 }, { ...base, allowedChatIds: ['77'] }, '-1001')).toBe(true)
    expect(isAuthorized({ id: -2002 }, { id: 5 }, base, '-1001')).toBe(false)
    expect(isAuthorized({ id: -2002, username: 'TimNOC' }, { id: 5 }, { ...base, allowedChatIds: ['@timnoc'] }, '')).toBe(true)
    expect(isAuthorized({ id: 5 }, { id: 5 }, base, '')).toBe(false)
  })

  it('daftar pengguna membatasi siapa yang boleh di chat yang diizinkan', () => {
    const s = { ...base, allowedUserIds: ['42'] }
    expect(isAuthorized({ id: -1001 }, { id: 42 }, s, '-1001')).toBe(true)
    expect(isAuthorized({ id: -1001 }, { id: 43 }, s, '-1001')).toBe(false)
    expect(isAuthorized({ id: -1001 }, undefined, s, '-1001')).toBe(false)
  })
})

function setup() {
  const sent: Array<{ chat: number | string; md: Md }> = []
  const api = {
    sendMessage: vi.fn(async (chat: number | string, md: Md) => void sent.push({ chat, md })),
    editMessage: vi.fn(async () => undefined),
    answerCallback: vi.fn(async () => undefined),
    sendPhotos: vi.fn(async () => undefined),
    call: vi.fn(async () => undefined)
  }
  const wall = {
    host: () => 'PC-WALL',
    state: () => ({ presets: [], activePresetId: null, activePreset: null, displays: [], tileStatus: {}, settings: SettingsSchema.parse({}), banner: null, version: '0.2.9' }),
    stepPreset: vi.fn(async () => ({ ok: true as const }))
  } as unknown as WallFacade
  const ctl = new TelegramControl({
    settings: () => base,
    alertChatId: () => '-1001',
    token: async () => 'x',
    wall,
    onStatus: vi.fn()
  })
  const msg = (chat: number, text: string, type = 'group') => ({ update_id: 1, message: { message_id: 9, chat: { id: chat, type }, from: { id: 5, username: 'budi' }, text, date: 0 } })
  return { ctl, api: api as unknown as TelegramApi & typeof api, sent, wall, msg }
}

describe('TelegramControl.handle', () => {
  it('perintah dari chat yang diizinkan dijalankan dan dibalas', async () => {
    const { ctl, api, sent, msg } = setup()
    await ctl.handle(api, msg(-1001, '/bantuan'))
    expect(sent).toHaveLength(1)
    expect(sent[0]!.chat).toBe(-1001)
    assertMarkdownV2(sent[0]!.md.text)
    expect(sent[0]!.md.plain).toContain('Kendali Video Wall NR')
  })

  it('chat tanpa izin diabaikan tanpa balasan, kecuali /id', async () => {
    const { ctl, api, sent, msg } = setup()
    await ctl.handle(api, msg(-2002, '/status'))
    await ctl.handle(api, msg(-2002, '/tampil'))
    expect(sent).toHaveLength(0)
    await ctl.handle(api, msg(-2002, '/id'))
    expect(sent).toHaveLength(1)
    expect(sent[0]!.md.plain).toContain('-2002')
    expect(sent[0]!.md.plain).toContain('belum diizinkan')
  })

  it('teks biasa: dijawab petunjuk di obrolan pribadi, diabaikan di grup', async () => {
    const { ctl, api, sent, msg } = setup()
    await ctl.handle(api, msg(-1001, 'halo'))
    expect(sent).toHaveLength(0)
    const priv = setup()
    await priv.ctl.handle(priv.api, { update_id: 2, message: { message_id: 1, chat: { id: -1001, type: 'private' }, from: { id: 5 }, text: 'halo', date: 0 } })
    expect(priv.sent[0]!.md.plain).toContain('/status')
  })

  it('tombol dari chat tanpa izin ditolak lewat notifikasi; dari chat yang diizinkan dijalankan', async () => {
    const { ctl, api, wall } = setup()
    const cb = (chat: number) => ({ update_id: 3, callback_query: { id: 'q', from: { id: 5 }, data: 'n:1', message: { message_id: 4, chat: { id: chat, type: 'group' }, date: 0 } } })
    await ctl.handle(api, cb(-2002))
    expect(api.answerCallback).toHaveBeenLastCalledWith('q', 'Anda belum diizinkan mengendalikan wall ini')
    expect(wall.stepPreset).not.toHaveBeenCalled()
    await ctl.handle(api, cb(-1001))
    expect(wall.stepPreset).toHaveBeenCalledWith(1)
    expect(api.editMessage).toHaveBeenCalled()
  })
})
