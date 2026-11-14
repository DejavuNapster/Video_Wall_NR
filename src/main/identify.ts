import { BrowserWindow } from 'electron'
import type { DisplayInfo } from '@shared/types'

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** Tampilkan nomor slot besar di tiap monitor selama beberapa detik supaya operator tahu monitor mana yang mana. */
export function identifyDisplays(displays: readonly DisplayInfo[], durationMs = 4000): void {
  for (const d of displays) {
    const text = d.slot === null ? 'OPERATOR' : `MONITOR ${d.slot + 1}`
    const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;height:100vh;background:#0b0f14;color:#fff;font-family:sans-serif">
      <div style="font-size:${d.slot === null ? 90 : 160}px;font-weight:800">${text}</div>
      <div style="font-size:28px;opacity:.7">${d.bounds.width}x${d.bounds.height} &middot; ${escapeHtml(d.label)}</div></body>`
    const win = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      frame: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    win.setIgnoreMouseEvents(true)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(() => {
      if (!win.isDestroyed()) win.showInactive()
    })
    setTimeout(() => {
      if (!win.isDestroyed()) win.destroy()
    }, durationMs)
  }
}
