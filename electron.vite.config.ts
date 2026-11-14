import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

/**
 * Struktur:
 *   src/main/index.ts                        -> main process
 *   src/preload/index.ts                     -> SATU preload self-contained untuk semua jendela (lihat komentar di file itu)
 *   src/renderer/{operator,wall,video}.html  -> renderer
 *   src/shared/*                             -> alias @shared
 */

const shared = { '@shared': resolve(__dirname, 'src/shared') }

/** CSP per halaman, hanya disuntikkan pada build produksi (dev server butuh skrip inline untuk HMR). */
const CSP: Record<string, string> = {
  // Operator & UI wall: hanya aset milik aplikasi.
  app: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:",
  // Pemutar video: stream dari sumber http(s) mana pun (HLS/WHEP/MJPEG) dan worker blob milik hls.js.
  video:
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src http: https:; media-src http: https: blob:; img-src http: https: data: blob:; worker-src 'self' blob:"
}

function cspPlugin(): Plugin {
  return {
    name: 'vw-csp',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      const policy = ctx.filename.endsWith('video.html') ? CSP['video'] : CSP['app']
      const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`
      return html.replace(/(<meta charset="UTF-8" \/>)/i, `$1\n    ${meta}`)
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: { ...shared, '@renderer': resolve(__dirname, 'src/renderer/src') }
    },
    plugins: [react(), tailwindcss(), cspPlugin()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: {
          operator: resolve(__dirname, 'src/renderer/operator.html'),
          wall: resolve(__dirname, 'src/renderer/wall.html'),
          video: resolve(__dirname, 'src/renderer/video.html')
        }
      }
    }
  }
})
