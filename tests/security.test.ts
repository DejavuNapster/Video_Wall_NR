import { describe, expect, it } from 'vitest'
import { isPermissionAllowed } from '../src/main/security'

describe('isPermissionAllowed', () => {
  it('mengizinkan fullscreen agar tombol "Layar Penuh" di halaman web berfungsi', () => {
    expect(isPermissionAllowed('fullscreen')).toBe(true)
  })

  it('tetap menolak izin lain', () => {
    for (const p of ['media', 'notifications', 'geolocation', 'clipboard-read', 'automatic-fullscreen', 'openExternal']) {
      expect(isPermissionAllowed(p)).toBe(false)
    }
  })
})
