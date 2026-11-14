/**
 * Pemeriksa sederhana MarkdownV2 Telegram untuk pengujian: karakter khusus di luar entitas harus di-escape,
 * entitas tebal/miring harus berpasangan, kode/blok kode harus tertutup, dan ">" hanya di awal baris (kutipan).
 */
const SPECIAL = new Set('_*[]()~`>#+-=|{}.!\\'.split(''))

export function assertMarkdownV2(text: string): void {
  let bold = false
  let italic = false
  let i = 0
  const fail = (why: string): never => {
    throw new Error(`MarkdownV2 tidak valid (${why}) di posisi ${i}: ${JSON.stringify(text.slice(Math.max(0, i - 20), i + 20))}`)
  }
  while (i < text.length) {
    const c = text[i]!
    if (c === '\\') {
      if (i + 1 >= text.length) fail('escape di akhir teks')
      i += 2
      continue
    }
    if (text.startsWith('```', i)) {
      const end = findClose(text, i + 3, '```')
      if (end < 0) fail('blok kode tidak tertutup')
      i = end + 3
      continue
    }
    if (c === '`') {
      const end = findClose(text, i + 1, '`')
      if (end < 0) fail('kode tidak tertutup')
      i = end + 1
      continue
    }
    if (c === '*') bold = !bold
    else if (c === '_') italic = !italic
    else if (c === '>') {
      if (i !== 0 && text[i - 1] !== '\n') fail('">" di tengah baris')
    } else if (SPECIAL.has(c)) fail(`"${c}" tidak di-escape`)
    i++
  }
  if (bold) fail('tebal tidak tertutup')
  if (italic) fail('miring tidak tertutup')
}

/** Posisi penutup kode (melewati ` dan \ yang di-escape). */
function findClose(text: string, from: number, close: string): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\') {
      j++
      continue
    }
    if (text.startsWith(close, j)) return j
  }
  return -1
}
