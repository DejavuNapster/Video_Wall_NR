import type { Source } from './types'

/**
 * Tile native (jam & ticker) digambar DOM React di jendela wall —
 * proses MAIN tidak membuat WebContentsView untuknya (dikecualikan di wall.ts).
 * Type guard: cabang true mempersempit `source` ke clock/ticker, cabang false
 * menyisakan tipe http(s) (web/hls/whep/mjpeg) yang punya `ignoreCertErrors`.
 */
export function isNativeSource(source: Source): source is Extract<Source, { type: 'clock' | 'ticker' }> {
  return source.type === 'clock' || source.type === 'ticker'
}
