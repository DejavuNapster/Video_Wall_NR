// macOS: tanda tangan ad-hoc (`codesign --sign -`) sebelum dmg/zip dibuat.
// Tanpa sertifikat Apple, electron-builder melewati penandatanganan (mac.identity: null). Bundle Electron
// yang sudah dimodifikasi tanpa tanda tangan sah ditolak di Mac Apple Silicon ("app rusak"); tanda tangan
// ad-hoc membuatnya bisa dijalankan setelah karantina Gatekeeper dibuka (lihat catatan rilis).
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
