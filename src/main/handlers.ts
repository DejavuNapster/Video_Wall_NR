import { readFile, stat, writeFile } from 'node:fs/promises'
import { dialog, ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { parseBackupPayload } from '@shared/backup'
import { IPC } from '@shared/ipc'
import { EmergencyBannerSchema } from '@shared/schema'
import type { Result, Thumbnails } from '@shared/types'
import { WallEditSchema } from '@shared/wallEdits'
import { PresetActionSchema, type PresetAction, type SettingsPatch, SettingsPatchSchema } from '@shared/wallPayloads'
import type { ActivePresetService } from './activePreset'
import type { AlertMonitor } from './alerts'
import type { BackupService } from './backupService'
import type { BannerController } from './banner'
import type { CredentialVault } from './credentials'
import type { DisplayManager } from './displays'
import { identifyDisplays } from './identify'
import { createLogger } from './logger'
import type { StateHub } from './state'
import { MIN_PASSWORD_LENGTH, hashPassword } from './remote/auth'
import type { RemoteServer } from './remote/server'
import { isSafeId } from './store'
import { tileByWebContents } from './tiles'
import type { WallController } from './wall'

const log = createLogger('ipc')
const MAX_IMPORT_BYTES = 4 * 1024 * 1024

export interface HandlerDeps {
  getOperator: () => BrowserWindow | null
  vault: CredentialVault
  wall: WallController
  displays: DisplayManager
  service: ActivePresetService
  hub: StateHub
  banner: BannerController
  backup: BackupService
  /** Aksi preset (sama dengan yang dipakai wall). */
  presetAction: (action: PresetAction) => Promise<Result>
  /** Terapkan patch pengaturan (validasi, simpan, lalu efeknya ke wall/rotasi/jadwal). */
  applySettings: (patch: SettingsPatch) => Promise<Result>
  /** Setelah restore backup: muat ulang daftar preset + preset aktif dari disk. */
  afterRestore: () => Promise<void>
  remote: RemoteServer
  alerts: AlertMonitor
  /** Rahasia tersimpan berubah (status "sudah diisi" di UI perlu diperbarui). */
  secretsChanged: () => Promise<void>
}

/** Kunci rahasia aplikasi di CredentialVault (berdampingan dengan password RTSP per panel). */
export const VAULT_REMOTE_PASSWORD = 'remote-password'
export const VAULT_TELEGRAM_TOKEN = 'alert-telegram-token'

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

export function zodError(issues: ReadonlyArray<{ message: string; path: ReadonlyArray<PropertyKey> }>): string {
  const issue = issues[0]
  const where = issue && issue.path.length > 0 ? ` (${issue.path.map(String).join('.')})` : ''
  return `Permintaan tidak valid: ${issue?.message ?? 'format salah'}${where}`
}

export function registerHandlers(d: HandlerDeps): void {
  /** Hanya window operator yang boleh memanggil channel op:*. */
  const isOperator = (event: IpcMainInvokeEvent | IpcMainEvent): boolean => {
    const win = d.getOperator()
    return !!win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === event.sender.mainFrame
  }
  const handle = <T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isOperator(event)) throw new Error('Pengirim IPC tidak sah')
      try {
        return await fn(...args)
      } catch (err) {
        log.error(`handler ${channel} gagal`, err)
        return fail(err instanceof Error ? err.message : String(err))
      }
    })
  }
  const parentWin = (): BrowserWindow | undefined => d.getOperator() ?? undefined

  handle(IPC.getState, () => d.hub.build())

  handle(IPC.preset, (raw) => {
    const parsed = PresetActionSchema.safeParse(raw)
    return parsed.success ? d.presetAction(parsed.data) : fail(zodError(parsed.error.issues))
  })

  handle(IPC.edit, (slot, raw) => {
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > 31) return fail('Monitor tidak valid')
    const parsed = WallEditSchema.safeParse(raw)
    return parsed.success ? d.service.edit(slot, parsed.data) : fail(zodError(parsed.error.issues))
  })

  handle(IPC.reloadTile, (tileId): Result => {
    if (!isSafeId(tileId)) return fail('ID panel tidak valid')
    return d.wall.reloadTile(tileId) ? { ok: true } : fail('Panel tidak sedang tampil di wall')
  })

  handle(IPC.identifyDisplays, (): Result => {
    identifyDisplays(d.displays.list())
    return { ok: true }
  })

  handle(IPC.showWalls, (): Result => {
    d.wall.showWalls()
    return { ok: true }
  })

  handle(IPC.setRtspPassword, async (tileId, password): Promise<Result<{ warning?: string }>> => {
    if (!isSafeId(tileId)) return fail('ID panel tidak valid')
    if (typeof password !== 'string' || password.length > 512) return fail('Password tidak valid')
    let warning: string | undefined
    if (password === '') await d.vault.remove(tileId)
    else warning = (await d.vault.set(tileId, password)).warning
    await d.wall.sync()
    return warning ? { ok: true, warning } : { ok: true }
  })

  handle(IPC.updateSettings, (raw) => {
    const parsed = SettingsPatchSchema.safeParse(raw)
    return parsed.success ? d.applySettings(parsed.data) : fail(zodError(parsed.error.issues))
  })

  // ------------------------------------------------------------- backup & restore
  const backupFilters = [{ name: 'Backup Video Wall', extensions: ['json'] }]

  handle(IPC.backupExport, async (): Promise<Result<{ path: string }>> => {
    // Simpan perubahan wall yang masih tertunda supaya backup berisi kondisi terbaru.
    await d.service.flush()
    const payload = await d.backup.buildPayload()
    const opts = { defaultPath: d.backup.fileNameFor(), filters: backupFilters }
    const win = parentWin()
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return fail('Dibatalkan')
    await writeFile(res.filePath, JSON.stringify(payload, null, 2), 'utf8')
    return { ok: true, path: res.filePath }
  })

  handle(IPC.backupImport, async (): Promise<Result> => {
    const opts = { properties: ['openFile' as const], filters: backupFilters }
    const win = parentWin()
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const file = res.filePaths[0]
    if (res.canceled || !file) return fail('Dibatalkan')
    if ((await stat(file)).size > MAX_IMPORT_BYTES) return fail('File terlalu besar (maks 4 MB)')
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      return fail('File bukan JSON yang valid')
    }
    const parsed = parseBackupPayload(raw)
    if (!parsed.ok) return fail(parsed.error)
    if (parsed.payload.presets.length === 0) return fail('File backup tidak berisi preset')
    // Tulis perubahan tertunda dulu supaya simpan otomatis tidak menimpa hasil restore.
    await d.service.flush()
    await d.backup.apply(parsed.payload)
    await d.afterRestore()
    return { ok: true }
  })

  // ------------------------------------------------------------- banner darurat
  handle(IPC.bannerSet, (raw): Result => {
    const parsed = EmergencyBannerSchema.safeParse(raw)
    if (!parsed.success) return fail(zodError(parsed.error.issues))
    d.banner.set(parsed.data)
    return { ok: true }
  })

  handle(IPC.bannerClear, (): Result => {
    d.banner.clear()
    return { ok: true }
  })

  // ------------------------------------------------------------- pratinjau, kendali jarak jauh, peringatan
  handle(IPC.thumbnails, (): Promise<Thumbnails> => d.wall.captureThumbnails())

  handle(IPC.setRemotePassword, async (password): Promise<Result> => {
    if (typeof password !== 'string' || password.length > 256) return fail('Password tidak valid')
    if (password === '') await d.vault.remove(VAULT_REMOTE_PASSWORD)
    else if (password.length < MIN_PASSWORD_LENGTH) return fail(`Password minimal ${MIN_PASSWORD_LENGTH} karakter`)
    else await d.vault.set(VAULT_REMOTE_PASSWORD, hashPassword(password))
    await d.secretsChanged()
    await d.remote.passwordChanged()
    return { ok: true }
  })

  handle(IPC.setTelegramToken, async (token): Promise<Result> => {
    if (typeof token !== 'string' || token.length > 256) return fail('Token tidak valid')
    const t = token.trim()
    if (t !== '' && !/^\d{5,20}:[A-Za-z0-9_-]{20,}$/.test(t)) return fail('Format token bot Telegram tidak dikenali (contoh: 123456789:AAH...)')
    if (t === '') await d.vault.remove(VAULT_TELEGRAM_TOKEN)
    else await d.vault.set(VAULT_TELEGRAM_TOKEN, t)
    await d.secretsChanged()
    return { ok: true }
  })

  handle(IPC.testAlert, (): Promise<Result> => d.alerts.test())

  // ------------------------------------------------------------- halaman video
  ipcMain.handle(IPC.videoGetConfig, (event) => {
    if (event.senderFrame !== event.sender.mainFrame) return null
    return tileByWebContents.get(event.sender.id)?.videoConfig ?? null
  })

  ipcMain.on(IPC.videoHeartbeat, (event, beat: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame) return
    const tv = tileByWebContents.get(event.sender.id)
    if (!tv || typeof beat !== 'object' || beat === null) return
    const b = beat as Record<string, unknown>
    if (typeof b['progress'] !== 'number' || !Number.isFinite(b['progress']) || typeof b['playing'] !== 'boolean') return
    tv.heartbeat({
      progress: b['progress'],
      playing: b['playing'],
      ...(typeof b['error'] === 'string' ? { error: b['error'].slice(0, 300) } : {})
    })
  })
}
