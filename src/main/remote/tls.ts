import { X509Certificate } from 'node:crypto'
import { generate } from 'selfsigned'

/** Sertifikat HTTPS kendali jarak jauh (self-signed) beserta kunci privatnya, keduanya PEM. */
export interface TlsMaterial {
  cert: string
  key: string
}

export interface CertInfo {
  /** Sidik jari SHA-256, mis. "98:A1:…", untuk dicocokkan dengan detail sertifikat di browser. */
  fingerprint: string
  validTo: Date
  /** Nama DNS dan alamat IP yang tercakup sertifikat. */
  names: string[]
}

/** Batas masa berlaku sertifikat server yang diterima Apple (iOS/macOS). */
export const CERT_DAYS = 825
/** Sertifikat dibuat ulang bila sisa masa berlakunya kurang dari ini. */
export const RENEW_BEFORE_DAYS = 30
const DAY_MS = 86_400_000

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/** Nama yang harus tercakup: nama komputer, localhost, loopback, dan semua alamat IP jaringan lokal. */
export function certNames(host: string, ips: string[]): string[] {
  const names = [host.toLowerCase(), 'localhost', '127.0.0.1', ...ips].filter((n) => /^[a-z0-9.:-]+$/i.test(n))
  return [...new Set(names)]
}

export function certInfo(certPem: string): CertInfo {
  const x = new X509Certificate(certPem)
  const names = (x.subjectAltName ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^(DNS|IP Address):/, '').toLowerCase())
    .filter(Boolean)
  return { fingerprint: x.fingerprint256, validTo: new Date(x.validTo), names }
}

/** Perlu dibuat ulang: belum ada, rusak, hampir habis masa berlakunya, atau ada nama/IP baru yang belum tercakup. */
export function needsRenewal(material: TlsMaterial | null, names: string[], now = new Date()): boolean {
  if (!material) return true
  try {
    const info = certInfo(material.cert)
    if (info.validTo.getTime() - now.getTime() < RENEW_BEFORE_DAYS * DAY_MS) return true
    return names.some((n) => !info.names.includes(n.toLowerCase()))
  } catch {
    return true
  }
}

/** Buat sertifikat self-signed (kunci EC P-256, SHA-256) untuk nama-nama ini. */
export async function generateCert(names: string[], now = new Date()): Promise<TlsMaterial> {
  const pems = await generate([{ name: 'commonName', value: 'Video Wall NR' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate: new Date(now.getTime() - DAY_MS),
    notAfterDate: new Date(now.getTime() + CERT_DAYS * DAY_MS),
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: names.map((n) => (IPV4.test(n) ? { type: 7, ip: n } : { type: 2, value: n })) }
    ]
  })
  return { cert: pems.cert, key: pems.private }
}

export interface TlsStoreDeps {
  /** Baca/simpan sertifikat dari penyimpanan terenkripsi (null = belum ada atau tidak bisa dibaca). */
  load(): Promise<TlsMaterial | null>
  /** Gagal (mis. enkripsi OS tidak tersedia) → sertifikat hanya disimpan di memori sampai aplikasi ditutup. */
  save(material: TlsMaterial): Promise<void>
  generate?: (names: string[]) => Promise<TlsMaterial>
}

/** Menyediakan sertifikat yang masih berlaku untuk nama-nama saat ini; membuat ulang bila perlu. */
export class TlsStore {
  private current: TlsMaterial | null = null
  private loaded = false
  /** Pesan bila sertifikat tidak bisa disimpan (dibuat ulang setiap aplikasi dijalankan). */
  warning: string | undefined

  constructor(private readonly d: TlsStoreDeps) {}

  async ensure(names: string[]): Promise<{ material: TlsMaterial; renewed: boolean }> {
    if (!this.loaded) {
      this.current = await this.d.load().catch(() => null)
      this.loaded = true
    }
    if (this.current && !needsRenewal(this.current, names)) return { material: this.current, renewed: false }
    const material = await (this.d.generate ?? generateCert)(names)
    this.current = material
    try {
      await this.d.save(material)
      this.warning = undefined
    } catch (err) {
      this.warning = `Sertifikat tidak bisa disimpan (${err instanceof Error ? err.message : String(err)}); sertifikat baru dibuat setiap aplikasi dijalankan.`
    }
    return { material, renewed: true }
  }
}
