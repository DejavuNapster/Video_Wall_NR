import { join } from 'node:path'
import { app } from 'electron'
import type { PlatformInfo } from '@shared/types'

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

const virtualRaw = argValue('virtual-displays') ?? process.env['VW_VIRTUAL_DISPLAYS']
const virtualDisplays = Math.min(16, Math.max(0, Number.parseInt(virtualRaw ?? '0', 10) || 0))

/**
 * Flag runtime.
 * - `--windowed` / VW_WINDOWED=1        : window wall berupa jendela biasa (aman untuk dev, tidak menguasai layar)
 * - `--virtual-displays=N` / VW_VIRTUAL_DISPLAYS=N : simulasikan N monitor wall di satu layar (otomatis windowed)
 */
export const flags = {
  windowed: virtualDisplays > 0 || process.argv.includes('--windowed') || process.env['VW_WINDOWED'] === '1',
  virtualDisplays,
  /** `--hide-operator`: jalan tanpa menampilkan UI operator (mis. auto-start kiosk). Ctrl+Alt+O menampilkannya. */
  startHidden: process.argv.includes('--hide-operator') || process.env['VW_HIDE_OPERATOR'] === '1'
}

export function dataPath(...parts: string[]): string {
  return join(app.getPath('userData'), ...parts)
}

/** Lokasi resource tambahan (mis. binary MediaMTX) baik saat dev maupun setelah dipaketkan. */
export function resourcePath(...parts: string[]): string {
  // Dev: bundle main ada di <proyek>/out/main, sehingga resource berada dua level di atasnya.
  return app.isPackaged ? join(process.resourcesPath, ...parts) : join(__dirname, '../../resources', ...parts)
}

/** Preload semua jendela: satu file self-contained (src/preload/index.ts).
 *  Multi-entry dilarang: preload ter-sandbox tidak bisa memuat file chunk
 *  terpisah (lihat komentar di src/preload/index.ts). */
export function preloadPath(): string {
  return join(__dirname, '../preload', 'index.js')
}

export type RendererTarget = { kind: 'url'; url: string } | { kind: 'file'; path: string }

export function rendererTarget(page: 'operator' | 'video' | 'wall'): RendererTarget {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) return { kind: 'url', url: `${devUrl}/${page}.html` }
  return { kind: 'file', path: join(__dirname, '../renderer', `${page}.html`) }
}

export function detectPlatform(): PlatformInfo {
  const ozone = argValue('ozone-platform') ?? ''
  if (process.platform !== 'linux') return { os: process.platform, session: 'n/a', ozonePlatform: ozone }
  const type = process.env['XDG_SESSION_TYPE']?.toLowerCase()
  const session = type === 'wayland' ? 'wayland' : type === 'x11' ? 'x11' : 'unknown'
  return { os: process.platform, session, ozonePlatform: ozone }
}

export function platformWarnings(info: PlatformInfo): string[] {
  const warnings: string[] = []
  if (info.os === 'linux' && info.session === 'wayland' && info.ozonePlatform !== 'x11') {
    warnings.push(
      'Sesi Wayland terdeteksi tanpa --ozone-platform=x11. Di Wayland, aplikasi tidak bisa menempatkan window ke monitor tertentu, ' +
        'sehingga semua window wall bisa menumpuk di satu layar. Jalankan lewat launcher resmi (install.sh) atau pilih sesi "Ubuntu on Xorg".'
    )
  }
  return warnings
}
