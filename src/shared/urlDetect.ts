import { SourceSchema } from './schema'
import type { Source } from './types'

export type DetectResult =
  | { ok: true; source: Source; /** Password RTSP yang dipisah dari URL, untuk disimpan terenkripsi. */ password?: string }
  | { ok: false; error: string }

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * Tentukan jenis sumber dari teks yang diketik di bilah panel wall.
 * Opsi sumber lama yang masih relevan (zoom, refresh, transport, abaikan sertifikat) dipertahankan.
 */
export function detectSource(input: string, current: Source): DetectResult {
  const text = input.trim()
  if (text === '') return { ok: true, source: { type: 'empty' } }

  let url: URL
  try {
    url = new URL(SCHEME_RE.test(text) ? text : `http://${text}`)
  } catch {
    return { ok: false, error: 'URL tidak valid' }
  }
  if (!url.hostname) return { ok: false, error: 'URL tidak valid' }

  const protocol = url.protocol.toLowerCase()
  const keepCert = 'ignoreCertErrors' in current && current.ignoreCertErrors === true ? { ignoreCertErrors: true } : {}
  let source: Source
  let password: string | undefined

  if (protocol === 'rtsp:' || protocol === 'rtsps:') {
    const username = url.username ? decodeURIComponent(url.username) : current.type === 'rtsp' ? current.username : undefined
    if (url.password) password = decodeURIComponent(url.password)
    url.username = ''
    url.password = ''
    source = {
      type: 'rtsp',
      url: url.toString(),
      ...(username ? { username } : {}),
      transport: current.type === 'rtsp' ? current.transport : 'auto'
    }
  } else if (protocol === 'http:' || protocol === 'https:') {
    // Spasi di tengah teks berarti bukan URL (mis. "bukan url"), walau URL() mau mem-parse-nya.
    if (/\s/.test(text)) return { ok: false, error: 'URL tidak valid' }
    const href = url.toString()
    const raw = SCHEME_RE.test(text) ? text : `http://${text}`
    // Pertahankan tulisan pengguna bila tidak berubah makna (URL() menambah "/" di akhir host).
    const finalUrl = href === `${raw}/` ? raw : href
    const path = url.pathname.toLowerCase()
    if (path.endsWith('.m3u8')) source = { type: 'hls', url: finalUrl, ...keepCert }
    else if (path.endsWith('/whep')) source = { type: 'whep', url: finalUrl, ...keepCert }
    else if (current.type === 'mjpeg') source = { type: 'mjpeg', url: finalUrl, ...keepCert }
    else if (current.type === 'web') source = { ...current, url: finalUrl }
    else source = { type: 'web', url: finalUrl, zoom: 1, reloadMinutes: 0, ...keepCert }
  } else {
    return { ok: false, error: `Skema "${protocol.replace(':', '')}" tidak didukung. Gunakan http(s):// atau rtsp://` }
  }

  const checked = SourceSchema.safeParse(source)
  if (!checked.success) return { ok: false, error: checked.error.issues[0]?.message ?? 'URL tidak valid' }
  return password === undefined ? { ok: true, source: checked.data } : { ok: true, source: checked.data, password }
}

/**
 * Pisahkan `user:pass@` dari URL RTSP sumber yang diisi lewat Inspector, supaya password tidak pernah
 * tersimpan di file preset. Sumber non-RTSP dikembalikan apa adanya.
 */
export function splitRtspCredentials(source: Source): { source: Source; password?: string } {
  if (source.type !== 'rtsp') return { source }
  let url: URL
  try {
    url = new URL(source.url)
  } catch {
    return { source }
  }
  if (!url.username && !url.password) return { source }
  const username = url.username ? decodeURIComponent(url.username) : source.username
  const password = url.password ? decodeURIComponent(url.password) : undefined
  url.username = ''
  url.password = ''
  const { username: _drop, ...rest } = source
  const clean: Source = { ...rest, url: url.toString(), ...(username ? { username } : {}) }
  return password === undefined ? { source: clean } : { source: clean, password }
}
