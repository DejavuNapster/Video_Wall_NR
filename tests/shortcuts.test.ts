import { describe, expect, it } from 'vitest'
import { type KeyInput, matchShortcut } from '@shared/shortcuts'

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  type: 'keyDown',
  key: k,
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...mods
})
const match = (input: KeyInput, panelFullscreen = false): ReturnType<typeof matchShortcut> => matchShortcut(input, { panelFullscreen })

describe('matchShortcut', () => {
  it('tombol fungsi tanpa modifier', () => {
    expect(match(key('F5'))).toEqual({ type: 'reload' })
    expect(match(key('F11'))).toEqual({ type: 'panelFullscreen' })
    expect(match(key('F10'))).toEqual({ type: 'windowFullscreen' })
    expect(match(key('Escape'))).toBeNull()
    expect(match(key('Escape'), true)).toEqual({ type: 'exitPanelFullscreen' })
    expect(match(key('a'))).toBeNull()
  })

  it('navigasi seperti browser: Alt+← / Alt+→ / Alt+Home', () => {
    expect(match(key('ArrowLeft', { alt: true }))).toEqual({ type: 'nav', action: 'back' })
    expect(match(key('ArrowRight', { alt: true }))).toEqual({ type: 'nav', action: 'forward' })
    expect(match(key('Home', { alt: true }))).toEqual({ type: 'nav', action: 'home' })
    expect(match(key('ArrowLeft'))).toBeNull()
    expect(match(key('x', { alt: true }))).toBeNull()
  })

  it('Ctrl+huruf/angka; Ctrl+Alt tidak ditangkap (pintasan global)', () => {
    expect(match(key('E', { control: true }))).toEqual({ type: 'toggleDisplayMode' })
    expect(match(key('l', { control: true }))).toEqual({ type: 'focusUrl' })
    expect(match(key('3', { control: true }))).toEqual({ type: 'preset', index: 2 })
    expect(match(key('-', { control: true }))).toEqual({ type: 'zoom', dir: 'out' })
    expect(match(key('o', { control: true, alt: true }))).toBeNull()
  })

  it('hanya keyDown', () => {
    expect(match({ ...key('F5'), type: 'keyUp' })).toBeNull()
  })
})
