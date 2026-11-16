import { describe, expect, it } from 'vitest'
import { x11RelaunchArgs } from '../src/main/ozone'

const wayland = { XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }
const argv = ['/opt/Video Wall NR/video-wall-browser', '--hide-operator']

describe('x11RelaunchArgs', () => {
  it('Linux + Wayland: mulai ulang dengan --ozone-platform=x11, argumen lain dipertahankan', () => {
    expect(x11RelaunchArgs('linux', wayland, argv)).toEqual(['--hide-operator', '--ozone-platform=x11'])
  })

  it('tidak dimulai ulang di X11, Windows, atau macOS', () => {
    expect(x11RelaunchArgs('linux', { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, argv)).toBeNull()
    expect(x11RelaunchArgs('win32', wayland, argv)).toBeNull()
    expect(x11RelaunchArgs('darwin', wayland, argv)).toBeNull()
  })

  it('menghormati pilihan pengguna dan tidak berulang', () => {
    expect(x11RelaunchArgs('linux', wayland, [...argv, '--ozone-platform=x11'])).toBeNull()
    expect(x11RelaunchArgs('linux', wayland, [...argv, '--ozone-platform=wayland'])).toBeNull()
    expect(x11RelaunchArgs('linux', wayland, [...argv, '--ozone-platform-hint=auto'])).toBeNull()
    expect(x11RelaunchArgs('linux', { ...wayland, VW_OZONE: 'wayland' }, argv)).toBeNull()
  })

  it('tanpa XWayland (DISPLAY kosong) tetap di Wayland agar aplikasi tetap bisa jalan', () => {
    expect(x11RelaunchArgs('linux', { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' }, argv)).toBeNull()
  })
})
