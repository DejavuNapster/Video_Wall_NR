/**
 * Sejak Electron 38, aplikasi berjalan sebagai klien Wayland native bila sesi desktop memakai Wayland (bawaan
 * Ubuntu Desktop). Di Wayland, aplikasi tidak bisa menempatkan jendela ke monitor tertentu: jendela wall untuk
 * beberapa monitor bisa menumpuk dan berebut layar penuh sehingga latar berkedip. Video wall butuh X11 (lewat
 * XWayland), jadi aplikasi memulai ulang dirinya sekali dengan --ozone-platform=x11.
 *
 * Mengembalikan argumen untuk app.relaunch(), atau null bila tidak perlu dimulai ulang:
 * - bukan Linux atau bukan sesi Wayland;
 * - --ozone-platform(-hint) sudah diberikan (oleh pengguna, launcher, atau hasil mulai ulang ini sendiri);
 * - VW_OZONE=wayland (sengaja memakai Wayland native);
 * - tidak ada DISPLAY (XWayland tidak tersedia, X11 tidak bisa dipakai).
 */
export function x11RelaunchArgs(platform: string, env: Record<string, string | undefined>, argv: string[]): string[] | null {
  if (platform !== 'linux') return null
  if (env['XDG_SESSION_TYPE']?.toLowerCase() !== 'wayland') return null
  if (argv.some((a) => a.startsWith('--ozone-platform'))) return null
  if (env['VW_OZONE']?.toLowerCase() === 'wayland') return null
  if (!env['DISPLAY']) return null
  return [...argv.slice(1), '--ozone-platform=x11']
}
