import type { Md } from './markdown'

/** Alamat Bot API. VW_TELEGRAM_API hanya untuk pengujian (server tiruan lokal). */
export function telegramApiBase(): string {
  return process.env['VW_TELEGRAM_API'] || 'https://api.telegram.org'
}

const CALL_TIMEOUT_MS = 15_000
/** Telegram membatasi satu album foto maksimal 10 gambar. */
const ALBUM_MAX = 10

export class TelegramError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
  }
}

export interface InlineButton {
  text: string
  callback_data: string
}
export type Keyboard = InlineButton[][]

export interface Photo {
  jpeg: Buffer
  caption: Md
}

/** Klien Bot API minimal. Token hanya dipakai di URL permintaan dan tidak pernah dimasukkan ke pesan galat. */
export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly base = telegramApiBase()
  ) {}

  async call<T>(method: string, body: object | FormData = {}, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? CALL_TIMEOUT_MS)
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
    let res: Response
    try {
      res = await fetch(`${this.base}/bot${this.token}/${method}`, {
        method: 'POST',
        ...(body instanceof FormData ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        signal
      })
    } catch (err) {
      if (opts.signal?.aborted) throw err
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      throw new TelegramError(0, timedOut ? 'Telegram tidak merespons' : 'Tidak bisa terhubung ke Telegram (periksa koneksi internet)')
    }
    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string; error_code?: number } | null
    if (!data?.ok) throw new TelegramError(data?.error_code ?? res.status, data?.description ?? `HTTP ${res.status}`)
    return data.result as T
  }

  /** Kirim pesan MarkdownV2; bila formatnya ditolak, kirim ulang sebagai teks biasa. */
  async sendMessage(chatId: string | number, msg: Md, keyboard?: Keyboard): Promise<void> {
    const extra = keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}
    try {
      await this.call('sendMessage', { chat_id: chatId, text: msg.text, parse_mode: 'MarkdownV2', link_preview_options: { is_disabled: true }, ...extra })
    } catch (err) {
      if (!isParseError(err)) throw err
      await this.call('sendMessage', { chat_id: chatId, text: msg.plain, link_preview_options: { is_disabled: true }, ...extra })
    }
  }

  /** Ganti isi pesan yang sudah terkirim (mis. tombol "Segarkan"). Isi yang sama persis tidak dianggap galat. */
  async editMessage(chatId: string | number, messageId: number, msg: Md, keyboard?: Keyboard): Promise<void> {
    const extra = keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}
    try {
      try {
        await this.call('editMessageText', { chat_id: chatId, message_id: messageId, text: msg.text, parse_mode: 'MarkdownV2', ...extra })
      } catch (err) {
        if (!isParseError(err)) throw err
        await this.call('editMessageText', { chat_id: chatId, message_id: messageId, text: msg.plain, ...extra })
      }
    } catch (err) {
      if (!(err instanceof TelegramError && /not modified/i.test(err.message))) throw err
    }
  }

  answerCallback(id: string, text?: string): Promise<unknown> {
    return this.call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text: text.slice(0, 200) } : {}) })
  }

  /** Kirim foto sebagai album (per 10 gambar); keterangan memakai MarkdownV2. */
  async sendPhotos(chatId: string | number, photos: Photo[]): Promise<void> {
    for (let i = 0; i < photos.length; i += ALBUM_MAX) {
      const group = photos.slice(i, i + ALBUM_MAX)
      const send = (formatted: boolean): Promise<unknown> => {
        const form = new FormData()
        form.append('chat_id', String(chatId))
        if (group.length === 1) {
          const p = group[0]!
          form.append('photo', new Blob([new Uint8Array(p.jpeg)], { type: 'image/jpeg' }), 'panel.jpg')
          form.append('caption', formatted ? p.caption.text : p.caption.plain)
          if (formatted) form.append('parse_mode', 'MarkdownV2')
          return this.call('sendPhoto', form, { timeoutMs: 60_000 })
        }
        const media = group.map((p, k) => ({
          type: 'photo',
          media: `attach://f${k}`,
          caption: formatted ? p.caption.text : p.caption.plain,
          ...(formatted ? { parse_mode: 'MarkdownV2' } : {})
        }))
        form.append('media', JSON.stringify(media))
        group.forEach((p, k) => form.append(`f${k}`, new Blob([new Uint8Array(p.jpeg)], { type: 'image/jpeg' }), `panel-${k + 1}.jpg`))
        return this.call('sendMediaGroup', form, { timeoutMs: 60_000 })
      }
      try {
        await send(true)
      } catch (err) {
        if (!isParseError(err)) throw err
        await send(false)
      }
    }
  }
}

function isParseError(err: unknown): boolean {
  return err instanceof TelegramError && err.code === 400 && /parse entities|can't parse|entity/i.test(err.message)
}
