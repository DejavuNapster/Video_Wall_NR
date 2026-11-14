import type { Session } from 'electron'
import type { Settings } from '@shared/types'

const hardened = new WeakSet<Session>()
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

export interface HardenOptions {
  /** true untuk tile web (konten tak tepercaya); false untuk halaman pemutar milik app sendiri. */
  untrusted: boolean
  /**
   * true = terima semua sertifikat di session ini. Chromium meng-cache hasil verifikasi per session dan
   * tidak bisa dikosongkan, jadi nilai ini harus tetap untuk satu session (partition-nya dibedakan di TileView).
   */
  ignoreCertErrors: boolean
  getSettings: () => Settings
  /** Port sidecar (API/HLS/WebRTC) yang tidak boleh diakses dari tile web. */
  blockedPorts: () => number[]
}

/**
 * Izin yang boleh diberikan ke tile. Hanya fullscreen (tombol "Layar Penuh" di dashboard web); di dalam
 * WebContentsView fullscreen HTML tetap terkurung di kotak tile sehingga tile lain tidak terganggu.
 * `automatic-fullscreen` (fullscreen tanpa klik pengguna) tetap ditolak.
 */
const ALLOWED_PERMISSIONS = new Set(['fullscreen'])

export function isPermissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission)
}

/** Apakah URL menunjuk ke layanan sidecar di loopback. Dipisah agar bisa diuji. */
export function isBlockedLoopbackRequest(rawUrl: string, blockedPorts: readonly number[]): boolean {
  try {
    const u = new URL(rawUrl)
    if (!LOOPBACK.has(u.hostname)) return false
    const port = u.port ? Number(u.port) : u.protocol === 'https:' || u.protocol === 'wss:' ? 443 : 80
    return blockedPorts.includes(port)
  } catch {
    return false
  }
}

/**
 * Pengerasan session sebuah tile (dipanggil sekali per session):
 *  - semua permintaan izin (kamera, mikrofon, notifikasi, dll.) ditolak, kecuali fullscreen
 *  - unduhan diblokir
 *  - sertifikat self-signed hanya diterima bila host + fingerprint terdaftar di pengaturan,
 *    atau bila tile mengaktifkan `ignoreCertErrors`
 *  - tile web tidak boleh mengakses layanan MediaMTX di loopback
 */
export function hardenTileSession(ses: Session, opts: HardenOptions): void {
  if (hardened.has(ses)) return
  hardened.add(ses)

  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(isPermissionAllowed(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => isPermissionAllowed(permission))
  ses.on('will-download', (event) => event.preventDefault())

  ses.setCertificateVerifyProc((request, callback) => {
    if (opts.ignoreCertErrors) return callback(0)
    const trusted = opts
      .getSettings()
      .trustedCertificates.some((c) => c.host === request.hostname && c.fingerprint === request.certificate.fingerprint)
    // 0 = terima; -3 = serahkan ke verifikasi bawaan Chromium (tetap ditolak bila sertifikat tidak valid)
    callback(trusted ? 0 : -3)
  })

  if (opts.untrusted) {
    ses.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: isBlockedLoopbackRequest(details.url, opts.blockedPorts()) })
    })
  }
}
