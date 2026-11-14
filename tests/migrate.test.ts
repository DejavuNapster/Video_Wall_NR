import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let appData = ''
let customUserDataDir = false
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'appData' ? appData : join(appData, 'Video Wall NR')),
    commandLine: { hasSwitch: (s: string) => s === 'user-data-dir' && customUserDataDir }
  }
}))

const { migrateLegacyUserData } = await import('../src/main/migrate')

const oldDir = (): string => join(appData, 'Video Wall Browser')
const newDir = (): string => join(appData, 'Video Wall NR')

describe('migrateLegacyUserData', () => {
  beforeEach(() => {
    appData = mkdtempSync(join(tmpdir(), 'vw-migrate-'))
    customUserDataDir = false
  })
  afterEach(() => rmSync(appData, { recursive: true, force: true }))

  it('memindah folder data nama lama ke nama baru', () => {
    mkdirSync(join(oldDir(), 'presets'), { recursive: true })
    writeFileSync(join(oldDir(), 'settings.json'), '{"a":1}')
    writeFileSync(join(oldDir(), 'presets', 'p.json'), '{}')
    migrateLegacyUserData()
    expect(readFileSync(join(newDir(), 'settings.json'), 'utf8')).toBe('{"a":1}')
    expect(existsSync(join(newDir(), 'presets', 'p.json'))).toBe(true)
    expect(existsSync(oldDir())).toBe(false)
  })

  it('tidak menimpa folder baru yang sudah ada', () => {
    mkdirSync(oldDir(), { recursive: true })
    writeFileSync(join(oldDir(), 'settings.json'), 'lama')
    mkdirSync(newDir(), { recursive: true })
    writeFileSync(join(newDir(), 'settings.json'), 'baru')
    migrateLegacyUserData()
    expect(readFileSync(join(newDir(), 'settings.json'), 'utf8')).toBe('baru')
    expect(existsSync(oldDir())).toBe(true)
  })

  it('instalasi baru (tanpa data lama) dan --user-data-dir tidak melakukan apa-apa', () => {
    migrateLegacyUserData()
    expect(existsSync(newDir())).toBe(false)
    mkdirSync(oldDir(), { recursive: true })
    customUserDataDir = true
    migrateLegacyUserData()
    expect(existsSync(newDir())).toBe(false)
    expect(existsSync(oldDir())).toBe(true)
  })
})
