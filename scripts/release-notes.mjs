// Isi halaman rilis GitHub: daftar perubahan versi ini (dari CHANGELOG.md) + petunjuk unduh dan instalasi
// (.github/release-notes.md).
//   node scripts/release-notes.mjs v0.2.7 > release-body.md
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const CHANGELOG_URL = 'https://github.com/DejavuNapster/Video_Wall_NR/blob/main/CHANGELOG.md'
/** Penanda blok perubahan di isi rilis, supaya blok bisa diganti tanpa menyentuh bagian lain. */
export const START = '<!-- changelog:start -->'
export const END = '<!-- changelog:end -->'

/** Isi bagian `## [versi]` dari CHANGELOG (tanpa judulnya); null bila versi tidak ada. */
export function changelogSection(markdown, version) {
  const v = version.replace(/^v/, '')
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith(`## [${v}]`))
  if (start < 0) return null
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  if (end < 0) end = lines.length
  return unwrap(lines.slice(start + 1, end)).join('\n').trim()
}

/**
 * Gabungkan baris lanjutan (teks yang di-wrap di CHANGELOG) ke baris sebelumnya. Halaman rilis GitHub
 * menampilkan setiap baris baru sebagai pemisah baris, sehingga kalimat akan terpotong di tengah.
 */
function unwrap(lines) {
  const out = []
  for (const line of lines) {
    const t = line.trim()
    const prev = out.at(-1)
    const continues =
      t !== '' && prev !== undefined && prev.trim() !== '' && !prev.trimStart().startsWith('#') && !/^([-*+]|\d+\.)\s|^[#|>]/.test(t)
    if (continues) out[out.length - 1] = `${prev} ${t}`
    else out.push(line)
  }
  return out
}

/** Blok "Perubahan di vX" lengkap dengan penanda. */
export function changelogBlock(markdown, version) {
  const section = changelogSection(markdown, version)
  if (!section) return null
  const tag = `v${version.replace(/^v/, '')}`
  return `${START}\n## Perubahan di ${tag}\n\n${section}\n\nRiwayat lengkap: [CHANGELOG.md](${CHANGELOG_URL})\n${END}`
}

/** Pasang (atau ganti) blok perubahan di bagian atas isi rilis. */
export function withChangelog(body, block) {
  const s = body.indexOf(START)
  const e = body.indexOf(END)
  const rest = s >= 0 && e > s ? body.slice(0, s) + body.slice(e + END.length) : body
  return `${block}\n\n${rest.trim()}\n`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = process.argv[2]
  if (!version) throw new Error('Pemakaian: node scripts/release-notes.mjs <tag>')
  const block = changelogBlock(readFileSync('CHANGELOG.md', 'utf8'), version)
  if (!block) {
    console.error(`CHANGELOG.md belum punya bagian untuk ${version}`)
    process.exit(1)
  }
  process.stdout.write(withChangelog(readFileSync('.github/release-notes.md', 'utf8'), block))
}
