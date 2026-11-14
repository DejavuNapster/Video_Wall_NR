/**
 * Penyusun pesan Telegram MarkdownV2. Setiap pesan menyimpan dua versi: MarkdownV2 (dikirim) dan teks biasa
 * (cadangan bila Telegram menolak formatnya), sehingga pesan tidak pernah hilang karena salah escape.
 *
 *   md`✅ Preset ${bold(nama)} ditampilkan.`
 *
 * Teks statis dan nilai berupa string di-escape otomatis; nilai `Md` (hasil bold/italic/code/…) disisipkan apa adanya.
 */
export class Md {
  constructor(
    readonly text: string,
    readonly plain: string
  ) {}
}

type Part = Md | string | number

/** Karakter yang wajib di-escape di luar entitas MarkdownV2. */
const SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g

export function esc(text: string): string {
  return text.replace(SPECIAL, '\\$&')
}

const asMd = (v: Part): Md => (v instanceof Md ? v : new Md(esc(String(v)), String(v)))

export function md(strings: TemplateStringsArray, ...values: Part[]): Md {
  let text = ''
  let plain = ''
  strings.forEach((s, i) => {
    text += esc(s)
    plain += s
    if (i < values.length) {
      const v = asMd(values[i]!)
      text += v.text
      plain += v.plain
    }
  })
  return new Md(text, plain)
}

export const bold = (v: Part): Md => {
  const m = asMd(v)
  return new Md(`*${m.text}*`, m.plain)
}

export const italic = (v: Part): Md => {
  const m = asMd(v)
  return new Md(`_${m.text}_`, m.plain)
}

/** Kode sebaris: hanya ` dan \ yang di-escape di dalamnya. */
export const code = (v: string | number): Md => new Md(`\`${String(v).replace(/[`\\]/g, '\\$&')}\``, String(v))

/** Blok kode (mis. pesan galat panjang). */
export const pre = (v: string): Md => new Md(`\`\`\`\n${v.replace(/[`\\]/g, '\\$&')}\n\`\`\``, v)

/** Kutipan: setiap baris diawali ">". */
export const quote = (v: string): Md =>
  new Md(
    v
      .split('\n')
      .map((l) => `>${esc(l)}`)
      .join('\n'),
    v
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n')
  )

/** Gabungkan beberapa bagian (null/false dilewati), default per baris. */
export function lines(parts: Array<Md | string | null | false | undefined>, sep = '\n'): Md {
  const ms = parts.filter((p): p is Md | string => p !== null && p !== false && p !== undefined).map(asMd)
  return new Md(ms.map((m) => m.text).join(esc(sep)), ms.map((m) => m.plain).join(sep))
}

/** Potong teks panjang (untuk nama panel / pesan galat) dengan elipsis. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
