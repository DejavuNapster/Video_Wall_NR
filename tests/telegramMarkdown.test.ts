import { describe, expect, it } from 'vitest'
import { bold, clip, code, esc, italic, lines, md, pre, quote } from '../src/main/telegram/markdown'
import { assertMarkdownV2 } from './helpers/markdownV2'

describe('MarkdownV2 Telegram', () => {
  it('semua karakter khusus di-escape', () => {
    expect(esc('v0.2.9 (beta) - #1 + a=b | {x} ! [y] ~z_ *w* `c` >q \\')).toBe(
      'v0\\.2\\.9 \\(beta\\) \\- \\#1 \\+ a\\=b \\| \\{x\\} \\! \\[y\\] \\~z\\_ \\*w\\* \\`c\\` \\>q \\\\'
    )
  })

  it('teks statis & nilai string di-escape; bold/italic/code disisipkan apa adanya', () => {
    const m = md`✅ Preset ${bold('Rapat (Q4)')} di ${code('PC-WALL_1')} - ${italic('v0.2.9')}.`
    expect(m.text).toBe('✅ Preset *Rapat \\(Q4\\)* di `PC-WALL_1` \\- _v0\\.2\\.9_\\.')
    expect(m.plain).toBe('✅ Preset Rapat (Q4) di PC-WALL_1 - v0.2.9.')
    assertMarkdownV2(m.text)
  })

  it('kode & blok kode hanya meng-escape ` dan \\', () => {
    expect(code('a`b\\c.d').text).toBe('`a\\`b\\\\c.d`')
    const p = pre('ERR_CONNECTION_REFUSED (http://x.y/z)')
    expect(p.text).toBe('```\nERR_CONNECTION_REFUSED (http://x.y/z)\n```')
    assertMarkdownV2(p.text)
  })

  it('kutipan, baris, dan potong teks', () => {
    const m = lines([md`📢 ${bold('Banner')}`, quote('Rapat 13.00\ndi aula!'), null, '', italic('selesai')])
    expect(m.text).toBe('📢 *Banner*\n>Rapat 13\\.00\n>di aula\\!\n\n_selesai_')
    expect(m.plain).toBe('📢 Banner\n> Rapat 13.00\n> di aula!\n\nselesai')
    assertMarkdownV2(m.text)
    expect(clip('a   b\nc', 10)).toBe('a b c')
    expect(clip('x'.repeat(20), 5)).toBe('xxxx…')
  })

  it('validator menolak markdown yang salah', () => {
    expect(() => assertMarkdownV2('v0.2.9')).toThrow()
    expect(() => assertMarkdownV2('*tebal')).toThrow()
    expect(() => assertMarkdownV2('a > b')).toThrow()
    expect(() => assertMarkdownV2('`kode')).toThrow()
  })
})
