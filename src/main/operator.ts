import { BrowserWindow, screen } from 'electron'
import { flags, preloadPath, rendererTarget } from './config'

/**
 * Window UI operator: jendela biasa di monitor utama, dengan preload khusus (API terbatas).
 * `showWhenReady` false = dibuat tersembunyi (startup dengan --hide-operator); 'minimized' = hanya di taskbar
 * (satu monitor: Operator tidak boleh menutupi wall saat aplikasi mulai).
 */
export function createOperatorWindow(showWhenReady: boolean | 'minimized'): BrowserWindow {
  const wa = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
    x: wa.x + 24,
    y: wa.y + 24,
    width: Math.min(1440, wa.width - 48),
    height: Math.min(900, wa.height - 48),
    show: false,
    backgroundColor: '#0b0f14',
    title: 'Video Wall Browser - Operator',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  win.once('ready-to-show', () => {
    if (showWhenReady === 'minimized') win.minimize()
    else if (showWhenReady) win.show()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const target = rendererTarget('operator')
  const origin = target.kind === 'url' ? new URL(target.url).origin : null
  win.webContents.on('will-navigate', (event) => {
    // Halaman operator tidak pernah berpindah halaman; di dev hanya HMR yang diizinkan reload.
    if (origin && event.url.startsWith(origin)) return
    event.preventDefault()
  })

  // Mode kiosk 24/7: menutup window operator hanya menyembunyikannya, wall tetap berjalan.
  // (Mode windowed/dev: menutup window = keluar aplikasi lewat 'window-all-closed'.)
  if (!flags.windowed) {
    win.on('close', (event) => {
      if (!(win as BrowserWindow & { forceClose?: boolean }).forceClose) {
        event.preventDefault()
        win.hide()
      }
    })
  }

  if (target.kind === 'url') void win.loadURL(target.url)
  else void win.loadFile(target.path)
  return win
}

export function forceCloseOperator(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  ;(win as BrowserWindow & { forceClose?: boolean }).forceClose = true
  win.destroy()
}
