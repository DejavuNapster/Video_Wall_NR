import { isNativeSource } from './native'
import { tickerName } from './ticker'
import type { Tile } from './types'

/** Teks singkat isi panel: label, host URL, atau jenis sumber. */
export function tileSummary(tile: Tile): string {
  if (tile.label) return tile.label
  const s = tile.source
  if (s.type === 'empty') return 'Panel kosong'
  if (s.type === 'ticker') return tickerName(s.text)
  if (isNativeSource(s)) return 'Jam & tanggal'
  try {
    const u = new URL(s.url)
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`
  } catch {
    return s.url
  }
}
