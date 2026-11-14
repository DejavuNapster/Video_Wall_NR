#!/usr/bin/env node
/**
 * Mengunduh binary MediaMTX (sidecar RTSP -> WebRTC/HLS) ke resources/bin/.
 * Checksum SHA-256 diverifikasi terhadap checksums.sha256 dari rilis resmi.
 *
 * Pemakaian:
 *   npm run fetch:mediamtx                       # untuk OS/arsitektur mesin ini
 *   MEDIAMTX_VERSION=v1.21.2 npm run fetch:mediamtx
 *   MEDIAMTX_PLATFORM=win32 MEDIAMTX_ARCH=x64 npm run fetch:mediamtx   # build silang
 *   MEDIAMTX_PLATFORM=darwin MEDIAMTX_ARCH=x64 npm run fetch:mediamtx  # build silang macOS
 *   npm run fetch:mediamtx -- --force            # unduh ulang
 *
 * CATATAN darwin: binary darwin bernama `mediamtx` (SAMA dengan Linux), sehingga
 * untuk platform darwin hasil ditulis ke resources/bin-darwin-<arch>/ (x64 / arm64) — direktori TERPISAH
 * agar TIDAK menimpa binary Linux di resources/bin/ (yang dipakai rilis Linux).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = process.env.MEDIAMTX_VERSION ?? 'v1.21.2'
const platform = process.env.MEDIAMTX_PLATFORM ?? process.platform
const arch = process.env.MEDIAMTX_ARCH ?? process.arch
const force = process.argv.includes('--force')

const ASSETS = {
  'linux-x64': { name: `mediamtx_${VERSION}_linux_amd64.tar.gz`, bin: 'mediamtx' },
  'linux-arm64': { name: `mediamtx_${VERSION}_linux_arm64.tar.gz`, bin: 'mediamtx' },
  'win32-x64': { name: `mediamtx_${VERSION}_windows_amd64.zip`, bin: 'mediamtx.exe' },
  'darwin-x64': { name: `mediamtx_${VERSION}_darwin_amd64.tar.gz`, bin: 'mediamtx' },
  'darwin-arm64': { name: `mediamtx_${VERSION}_darwin_arm64.tar.gz`, bin: 'mediamtx' }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// darwin: direktori TERPISAH (bin-darwin) — nama file-nya sama dengan binary Linux,
// menulis ke resources/bin/ akan MENIMPA binary Linux milik rilis Linux.
// Per arsitektur supaya build macOS Intel + Apple Silicon sekaligus (electron-builder: from: bin-darwin-${arch}).
const destDir = platform === 'darwin' ? join(root, 'resources', `bin-darwin-${arch}`) : join(root, 'resources', 'bin')
const asset = ASSETS[`${platform}-${arch}`]
if (!asset) {
  console.error(`Kombinasi ${platform}/${arch} belum didukung skrip ini. Unduh manual dari https://github.com/bluenviron/mediamtx/releases`)
  process.exit(1)
}

const marker = join(destDir, '.mediamtx-version')
const target = join(destDir, asset.bin)
if (!force && existsSync(target) && existsSync(marker) && readFileSync(marker, 'utf8').trim() === `${VERSION} ${platform}-${arch}`) {
  console.log(`MediaMTX ${VERSION} sudah ada di ${target} (pakai --force untuk mengunduh ulang)`)
  process.exit(0)
}

const base = `https://github.com/bluenviron/mediamtx/releases/download/${VERSION}`

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Unduh gagal (${res.status}): ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

const work = mkdtempSync(join(tmpdir(), 'mediamtx-'))
try {
  console.log(`Mengunduh ${asset.name} ...`)
  const [archive, sums] = await Promise.all([download(`${base}/${asset.name}`), download(`${base}/checksums.sha256`)])

  const expected = sums
    .toString('utf8')
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+\*?/))
    .find(([, file]) => file === asset.name)?.[0]
  if (!expected) throw new Error(`Checksum untuk ${asset.name} tidak ditemukan di checksums.sha256`)
  const actual = createHash('sha256').update(archive).digest('hex')
  if (actual !== expected) throw new Error(`Checksum TIDAK cocok!\n  diharapkan: ${expected}\n  didapat   : ${actual}`)
  console.log('Checksum SHA-256 cocok.')

  const archivePath = join(work, asset.name)
  writeFileSync(archivePath, archive)
  // bsdtar (Windows 10+) dan GNU tar (Linux) sama-sama bisa mengekstrak .zip/.tar.gz lewat "tar -xf".
  // Di Windows pakai bsdtar bawaan sistem secara eksplisit: GNU tar (mis. dari Git Bash) yang lebih dulu
  // ada di PATH membaca "C:\..." sebagai host remote dan gagal ("Cannot connect to C").
  const systemTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  const tar = process.platform === 'win32' && existsSync(systemTar) ? systemTar : 'tar'
  execFileSync(tar, ['-xf', archivePath, '-C', work], { stdio: 'inherit' })

  mkdirSync(destDir, { recursive: true })
  copyFileSync(join(work, asset.bin), target)
  if (platform !== 'win32') chmodSync(target, 0o755)
  writeFileSync(marker, `${VERSION} ${platform}-${arch}\n`)
  console.log(`Terpasang: ${target}`)
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err))
  process.exitCode = 1
} finally {
  rmSync(work, { recursive: true, force: true })
}
