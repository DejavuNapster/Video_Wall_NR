import type { Source } from './types'
import { isNativeSource } from './native'

/** Sertifikat HTTPS diabaikan bila opsi global ATAU opsi per panel aktif (hanya sumber http(s)). */
export function effectiveIgnoreCert(source: Source, globalIgnore: boolean): boolean {
  if (source.type === 'empty' || source.type === 'rtsp' || isNativeSource(source)) return false
  return globalIgnore || source.ignoreCertErrors === true
}

/**
 * Kunci yang menentukan kapan WebContentsView tile harus dibuat ulang. Zoom, refresh otomatis, CSS, dan
 * rotasi halaman diterapkan langsung tanpa membuat ulang panel, jadi tidak termasuk. Sertifikat efektif termasuk
 * karena menentukan partition (session) tile.
 */
export function tileHardKey(source: Source, globalIgnore: boolean): string {
  const ignoreCert = effectiveIgnoreCert(source, globalIgnore)
  if (source.type === 'web') {
    const { zoom: _z, reloadMinutes: _r, ignoreCertErrors: _i, css: _c, cycle: _y, ...rest } = source
    return JSON.stringify({ ...rest, ignoreCert })
  }
  if (source.type === 'empty' || source.type === 'rtsp' || isNativeSource(source)) return JSON.stringify(source)
  const { ignoreCertErrors: _i, ...rest } = source
  return JSON.stringify({ ...rest, ignoreCert })
}
