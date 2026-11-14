import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { AutostartStatus, Result } from '@shared/types'

const LINUX_DIR = join(homedir(), '.config', 'autostart')
const LINUX_FILE = join(LINUX_DIR, 'video-wall-browser.desktop')
/** Launcher dari scripts/linux/install.sh (memaksa --ozone-platform=x11). */
const LINUX_LAUNCHER = '/usr/local/bin/video-wall-browser'
/** Argumen saat jalan otomatis. Di Windows, status login item hanya cocok bila argumen query sama. */
const LOGIN_ARGS = ['--hide-operator']

/** Jalan otomatis saat login. Hanya untuk aplikasi hasil build: di mode dev yang terdaftar adalah electron.exe mentah. */
export function autostartStatus(): AutostartStatus {
  if (!app.isPackaged) {
    return { supported: false, enabled: false, reason: 'Hanya tersedia di aplikasi hasil build (bukan mode dev)' }
  }
  if (process.platform === 'linux') return { supported: true, enabled: existsSync(LINUX_FILE) }
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return { supported: true, enabled: app.getLoginItemSettings({ args: LOGIN_ARGS }).openAtLogin }
  }
  return { supported: false, enabled: false, reason: `Tidak didukung di ${process.platform}` }
}

export async function setAutostart(on: boolean): Promise<Result> {
  const status = autostartStatus()
  if (!status.supported) return { ok: false, error: status.reason ?? 'Tidak didukung' }
  if (process.platform === 'linux') {
    if (!on) {
      await rm(LINUX_FILE, { force: true })
      return { ok: true }
    }
    const exec = existsSync(LINUX_LAUNCHER) ? LINUX_LAUNCHER : (process.env['APPIMAGE'] ?? process.execPath)
    const desktop = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Video Wall Browser',
      `Exec="${exec}" ${LOGIN_ARGS.join(' ')}`,
      'X-GNOME-Autostart-enabled=true',
      ''
    ].join('\n')
    await mkdir(LINUX_DIR, { recursive: true })
    await writeFile(LINUX_FILE, desktop, 'utf8')
    return { ok: true }
  }
  app.setLoginItemSettings({ openAtLogin: on, args: LOGIN_ARGS })
  return { ok: true }
}
