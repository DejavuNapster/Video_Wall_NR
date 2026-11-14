/** Aksi keyboard jendela wall. Ditangkap di main lewat `before-input-event` (UI wall dan semua tile). */
export type WallAction =
  | { type: 'toggleDisplayMode' }
  | { type: 'panelFullscreen' }
  | { type: 'exitPanelFullscreen' }
  | { type: 'windowFullscreen' }
  | { type: 'reload' }
  | { type: 'nav'; action: 'back' | 'forward' | 'home' }
  | { type: 'focusUrl' }
  | { type: 'zoom'; dir: 'in' | 'out' | 'reset' }
  | { type: 'nextTile' }
  | { type: 'preset'; index: number }
  | { type: 'toggleRotation' }

/** Bagian dari `Electron.Input` yang dibutuhkan (dipisah agar bisa diuji tanpa Electron). */
export interface KeyInput {
  type: string
  key: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

export function matchShortcut(input: KeyInput, ctx: { panelFullscreen: boolean }): WallAction | null {
  if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') return null
  const ctrl = input.control || input.meta
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key

  if (!ctrl && !input.alt) {
    if (key === 'F11') return { type: 'panelFullscreen' }
    if (key === 'F10') return { type: 'windowFullscreen' }
    if (key === 'F5') return { type: 'reload' }
    if (key === 'Escape') return ctx.panelFullscreen ? { type: 'exitPanelFullscreen' } : null
    return null
  }
  // Seperti browser: Alt+← kembali, Alt+→ maju, Alt+Home ke URL panel.
  if (!ctrl && input.alt) {
    if (key === 'ArrowLeft') return { type: 'nav', action: 'back' }
    if (key === 'ArrowRight') return { type: 'nav', action: 'forward' }
    if (key === 'Home') return { type: 'nav', action: 'home' }
    return null
  }
  if (input.alt) return null

  switch (key) {
    case 'e':
      return { type: 'toggleDisplayMode' }
    case 'r':
      return { type: 'reload' }
    case 'l':
      return { type: 'focusUrl' }
    case '=':
    case '+':
      return { type: 'zoom', dir: 'in' }
    case '-':
      return { type: 'zoom', dir: 'out' }
    case '0':
      return { type: 'zoom', dir: 'reset' }
    case 'Tab':
      return { type: 'nextTile' }
    case ' ':
      return { type: 'toggleRotation' }
    default:
      if (/^[1-9]$/.test(key)) return { type: 'preset', index: Number(key) - 1 }
      return null
  }
}
