import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error skrip .mjs tanpa deklarasi tipe
import { changelogBlock, changelogSection, END, START, withChangelog } from '../scripts/release-notes.mjs'

const changelog = readFileSync('CHANGELOG.md', 'utf8')
const version: string = JSON.parse(readFileSync('package.json', 'utf8')).version

describe('catatan rilis', () => {
  it('CHANGELOG.md punya bagian untuk versi di package.json', () => {
    expect(changelogSection(changelog, version)).toBeTruthy()
  })

  it('bagian versi berhenti di judul versi berikutnya', () => {
    const md = '# Judul\n\n## [1.1.0] - x\n\n- baru\n\n## [1.0.0] - y\n\n- lama\n'
    expect(changelogSection(md, 'v1.1.0')).toBe('- baru')
    expect(changelogSection(md, '1.0.0')).toBe('- lama')
    expect(changelogSection(md, '0.9.0')).toBeNull()
  })

  it('baris lanjutan digabung; sub-butir dan judul tetap', () => {
    const md = '## [1.0.0] - y\n\n### Ditambahkan\n\n- satu dua\n  tiga\n  - anak\n    lanjut\n- empat\n'
    expect(changelogSection(md, '1.0.0')).toBe('### Ditambahkan\n\n- satu dua tiga\n  - anak lanjut\n- empat')
  })

  it('blok perubahan dipasang di atas dan bisa diganti tanpa berlipat', () => {
    const md = '## [1.0.0] - y\n\n- satu\n'
    const once = withChangelog('Petunjuk instalasi', changelogBlock(md, 'v1.0.0'))
    expect(once.startsWith(START)).toBe(true)
    expect(once).toContain('## Perubahan di v1.0.0')
    expect(once).toContain(`${END}\n\nPetunjuk instalasi`)
    const twice = withChangelog(once, changelogBlock('## [1.0.0] - y\n\n- dua\n', 'v1.0.0'))
    expect(twice.split(START)).toHaveLength(2)
    expect(twice).toContain('- dua')
    expect(twice).not.toContain('- satu')
  })
})
