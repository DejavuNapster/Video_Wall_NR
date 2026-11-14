import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BackupService } from '../src/main/backupService'
import { PresetStore, SettingsStore } from '../src/main/store'
import { BACKUP_APP_ID, parseBackupPayload } from '../src/shared/backup'
import type { Preset } from '../src/shared/types'

const fixedDate = new Date('2026-11-05T08:00:00.000Z')

/** Preset minimal yang lolos PresetSchema (monitors kosong = valid). */
const validPreset = (id: string, name: string): Preset => ({
  schemaVersion: 1,
  id,
  name,
  updatedAt: '2026-11-05T08:00:00.000Z',
  monitors: []
})

describe('BackupService', () => {
  let dir: string
  let presets: PresetStore
  let settings: SettingsStore
  let svc: BackupService

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vwb-backup-test-'))
    presets = new PresetStore(join(dir, 'presets'), join(dir, 'state.json'))
    settings = new SettingsStore(join(dir, 'settings.json'))
    await settings.load()
    svc = new BackupService({
      appVersion: '0.1.1',
      presets,
      settings,
      now: () => fixedDate
    })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('buildPayload menghasilkan payload yang lolos parseBackupPayload', async () => {
    const payload = await svc.buildPayload()
    expect(payload.app).toBe(BACKUP_APP_ID)
    expect(payload.schemaVersion).toBe(1)
    expect(payload.appVersion).toBe('0.1.1')
    expect(payload.exportedAt).toBe(fixedDate.toISOString())
    expect(parseBackupPayload(JSON.parse(JSON.stringify(payload))).ok).toBe(true)
  })

  it('apply() menyimpan preset backup dan menghapus preset yang tidak ada di backup', async () => {
    await presets.save(validPreset('preset-a', 'Preset A'))
    const payload = await svc.buildPayload()
    await presets.save(validPreset('preset-b', 'Preset B'))
    await svc.apply(payload)
    expect(await presets.exists('preset-a')).toBe(true)
    expect(await presets.exists('preset-b')).toBe(false)
  })

  it('fileNameFor() deterministik, unik per tanggal, dan mengikuti pola backup-*', () => {
    const a = svc.fileNameFor(fixedDate)
    expect(a).toBe(svc.fileNameFor(fixedDate))
    expect(a).not.toBe(svc.fileNameFor(new Date('2027-01-01T00:00:00.000Z')))
    expect(a).toBe('backup-2026-11-05T08-00-00-000Z.json')
    expect(a).toMatch(/^backup-.+\.json$/)
  })

  it('apply() mengganti pengaturan dengan isi backup', async () => {
    const payload = await svc.buildPayload()
    await settings.update({ reloadIntervalHours: 3 })
    await svc.apply({ ...payload, settings: { ...payload.settings, videoStallSeconds: 42 } })
    expect(settings.get().videoStallSeconds).toBe(42)
    expect(settings.get().reloadIntervalHours).toBe(payload.settings.reloadIntervalHours)
  })

  it('parseBackupPayload menolak file dari aplikasi lain', async () => {
    const payload = await svc.buildPayload()
    expect(parseBackupPayload({ ...payload, app: 'lain' }).ok).toBe(false)
  })
})
