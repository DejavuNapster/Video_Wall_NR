import type { TelegramStatus } from '@shared/types'
import { createLogger } from '../logger'
import { TelegramApi, TelegramError } from './api'
import { BOT_COMMANDS, type CallbackResult, parseCommand, type Reply, runCallback, runCommand, type WallFacade } from './commands'
import { bold, italic, lines, md } from './markdown'

const log = createLogger('telegram')
/** Lama satu permintaan getUpdates menunggu pesan baru (long polling). */
const POLL_TIMEOUT_SEC = 25
const RETRY_MIN_MS = 5_000
const RETRY_MAX_MS = 60_000

export interface TelegramControlSettings {
  enabled: boolean
  allowedChatIds: string[]
  allowedUserIds: string[]
}

export interface TelegramControlDeps {
  settings(): TelegramControlSettings
  /** Chat ID peringatan: otomatis boleh memberi perintah. */
  alertChatId(): string
  token(): Promise<string | null>
  wall: WallFacade
  onStatus(): void
}

interface Chat {
  id: number
  type: string
  username?: string
}
interface User {
  id: number
  username?: string
  first_name?: string
}
interface Message {
  message_id: number
  chat: Chat
  from?: User
  text?: string
  date: number
}
interface Update {
  update_id: number
  message?: Message
  callback_query?: { id: string; from: User; data?: string; message?: Message }
}

/**
 * Chat boleh memberi perintah bila ID-nya (atau @username grup/kanalnya) ada di daftar izin; bila daftar user
 * diisi, pengirim juga harus ada di daftar itu.
 */
export function isAuthorized(chat: Pick<Chat, 'id' | 'username'>, from: Pick<User, 'id'> | undefined, s: TelegramControlSettings, alertChatId: string): boolean {
  const chats = new Set([alertChatId, ...s.allowedChatIds].map((c) => c.trim().toLowerCase()).filter(Boolean))
  const chatOk = chats.has(String(chat.id)) || (!!chat.username && chats.has(`@${chat.username.toLowerCase()}`))
  if (!chatOk) return false
  if (s.allowedUserIds.length === 0) return true
  return !!from && s.allowedUserIds.includes(String(from.id))
}

const who = (u: User | undefined): string => (u ? `${u.username ? `@${u.username}` : (u.first_name ?? 'pengguna')} (${u.id})` : 'tidak dikenal')

/** Menerima perintah dari bot Telegram (long polling, tanpa port masuk) dan menjalankannya di wall. */
export class TelegramControl {
  private api: TelegramApi | null = null
  private token: string | null = null
  private botUsername: string | undefined
  private error: string | undefined
  private abort: AbortController | null = null
  private loopDone: Promise<void> = Promise.resolve()
  private applying: Promise<void> = Promise.resolve()
  /** Chat tanpa izin yang sudah dicatat di log (agar log tidak banjir). */
  private readonly rejected = new Set<string>()

  constructor(private readonly d: TelegramControlDeps) {}

  status(): TelegramStatus {
    return {
      running: this.abort !== null && !this.error,
      ...(this.botUsername ? { botUsername: this.botUsername } : {}),
      ...(this.error ? { error: this.error } : {})
    }
  }

  /** Sesuaikan dengan pengaturan dan token: nyalakan, matikan, atau mulai ulang dengan token baru. */
  apply(): Promise<void> {
    const run = this.applying.then(() => this.doApply())
    this.applying = run.catch(() => undefined)
    return run
  }

  private async doApply(): Promise<void> {
    const enabled = this.d.settings().enabled
    const token = enabled ? await this.d.token() : null
    if (this.abort && token === this.token) return
    await this.stop()
    this.error = enabled && !token ? 'Isi token bot Telegram terlebih dahulu (bagian Peringatan panel bermasalah).' : undefined
    if (token) this.start(token)
    this.d.onStatus()
  }

  async stop(): Promise<void> {
    if (!this.abort) return
    this.abort.abort()
    this.abort = null
    await this.loopDone
    this.api = null
    this.token = null
    this.botUsername = undefined
    log.info('kendali Telegram berhenti')
  }

  private start(token: string): void {
    const abort = new AbortController()
    this.abort = abort
    this.token = token
    this.api = new TelegramApi(token)
    this.loopDone = this.loop(this.api, abort.signal).catch((err) => log.error('kendali Telegram berhenti karena galat', err))
  }

  private setError(error: string | undefined): void {
    if (error === this.error) return
    this.error = error
    if (error) log.warn(`kendali Telegram: ${error}`)
    this.d.onStatus()
  }

  private async loop(api: TelegramApi, signal: AbortSignal): Promise<void> {
    let offset: number | undefined
    let retry = RETRY_MIN_MS
    let ready = false
    while (!signal.aborted) {
      try {
        if (!ready) {
          const me = await api.call<{ username: string }>('getMe', {}, { signal })
          this.botUsername = me.username
          // Webhook aktif membuat getUpdates ditolak; perintah yang menumpuk saat wall mati tidak dijalankan.
          await api.call('deleteWebhook', { drop_pending_updates: false }, { signal })
          const pending = await api.call<Update[]>('getUpdates', { offset: -1, timeout: 0 }, { signal })
          offset = pending.length ? pending[pending.length - 1]!.update_id + 1 : undefined
          await api.call('setMyCommands', { commands: BOT_COMMANDS }, { signal }).catch((err) => log.warn(`menu perintah gagal didaftarkan: ${errText(err)}`))
          ready = true
          this.setError(undefined)
          this.d.onStatus()
          log.info(`kendali Telegram aktif sebagai @${me.username}`)
        }
        const updates = await api.call<Update[]>(
          'getUpdates',
          { offset, timeout: POLL_TIMEOUT_SEC, allowed_updates: ['message', 'callback_query'] },
          { signal, timeoutMs: (POLL_TIMEOUT_SEC + 15) * 1000 }
        )
        retry = RETRY_MIN_MS
        for (const u of updates) {
          offset = u.update_id + 1
          await this.handle(api, u).catch((err) => log.warn(`perintah Telegram gagal diproses: ${errText(err)}`))
        }
      } catch (err) {
        if (signal.aborted) return
        this.setError(describeError(err))
        await sleep(retry, signal)
        retry = Math.min(retry * 2, RETRY_MAX_MS)
      }
    }
  }

  /** Proses satu update (dipanggil loop; publik untuk pengujian). */
  async handle(api: TelegramApi, u: Update): Promise<void> {
    if (u.callback_query) return this.handleCallback(api, u.callback_query)
    const msg = u.message
    if (!msg?.text) return
    const cmd = parseCommand(msg.text, this.botUsername)
    const s = this.d.settings()
    const authorized = isAuthorized(msg.chat, msg.from, s, this.d.alertChatId())
    const ctx = { chatId: String(msg.chat.id), userId: msg.from ? String(msg.from.id) : null, authorized }
    if (!cmd) {
      // Di obrolan pribadi, teks biasa dijawab dengan petunjuk; di grup diabaikan.
      if (authorized && msg.chat.type === 'private') {
        await api.sendMessage(msg.chat.id, lines([md`👋 Kirim perintah yang diawali garis miring, misalnya /status.`, italic('Ketik /bantuan untuk daftar perintah.')]))
      }
      return
    }
    // /id selalu dijawab supaya chat ID & user ID mudah didapat saat mengatur izin.
    if (!authorized && cmd.name !== 'id') {
      const key = `${msg.chat.id}:${msg.from?.id ?? ''}`
      if (!this.rejected.has(key)) {
        this.rejected.add(key)
        log.warn(`perintah Telegram ditolak: chat ${msg.chat.id} oleh ${who(msg.from)} belum diizinkan`)
      }
      return
    }
    log.info(`perintah Telegram /${cmd.name}${cmd.args ? ` "${cmd.args.slice(0, 80)}"` : ''} dari ${who(msg.from)} di chat ${msg.chat.id}`)
    if (cmd.name === 'foto') await api.call('sendChatAction', { chat_id: msg.chat.id, action: 'upload_photo' }).catch(() => undefined)
    await this.send(api, msg.chat.id, await this.safeRun(() => runCommand(cmd, this.d.wall, ctx)))
  }

  private async handleCallback(api: TelegramApi, q: NonNullable<Update['callback_query']>): Promise<void> {
    const chat = q.message?.chat
    if (!chat || !q.data) return void (await api.answerCallback(q.id))
    if (!isAuthorized(chat, q.from, this.d.settings(), this.d.alertChatId())) {
      log.warn(`tombol Telegram ditolak: chat ${chat.id} oleh ${who(q.from)} belum diizinkan`)
      return void (await api.answerCallback(q.id, 'Anda belum diizinkan mengendalikan wall ini'))
    }
    log.info(`tombol Telegram "${q.data}" dari ${who(q.from)} di chat ${chat.id}`)
    let res: CallbackResult
    try {
      res = await runCallback(q.data, this.d.wall)
    } catch (err) {
      log.error('tombol Telegram gagal', err)
      res = { toast: 'Terjadi kesalahan di aplikasi wall' }
    }
    await api.answerCallback(q.id, res.toast).catch(() => undefined)
    if (res.edit && q.message) await api.editMessage(chat.id, q.message.message_id, res.edit.text, res.edit.keyboard)
    if (res.reply) await this.send(api, chat.id, res.reply)
  }

  private async safeRun(fn: () => Promise<Reply>): Promise<Reply> {
    try {
      return await fn()
    } catch (err) {
      log.error('perintah Telegram gagal', err)
      return { text: md`❌ ${bold('Terjadi kesalahan')} di aplikasi wall. Lihat log aplikasi untuk detailnya.` }
    }
  }

  private async send(api: TelegramApi, chatId: number, reply: Reply): Promise<void> {
    if (reply.photos?.length) {
      await api.sendPhotos(chatId, reply.photos)
      await api.sendMessage(chatId, reply.text, reply.keyboard)
    } else {
      await api.sendMessage(chatId, reply.text, reply.keyboard)
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof TelegramError) {
    if (err.code === 401 || err.code === 404) return 'Token bot Telegram tidak valid. Periksa token dari @BotFather.'
    if (err.code === 409) return 'Bot ini sedang dipakai di komputer lain (setiap wall butuh bot sendiri).'
    return err.message
  }
  return errText(err)
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })
}
