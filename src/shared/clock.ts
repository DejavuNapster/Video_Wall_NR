/**
 * Logika murni tile native (jam & ticker) — tanpa DOM, bisa diuji di node.
 */

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** Jam "HH:MM:SS" (24 jam) atau "h:MM:SS AM/PM" (12 jam). */
export function formatTime(date: Date, hour24: boolean): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const h = date.getHours()
  const m = date.getMinutes()
  const s = date.getSeconds()
  if (hour24) return `${pad(h)}:${pad(m)}:${pad(s)}`
  const h12 = h % 12 === 0 ? 12 : h % 12
  const siang = h < 12 ? 'AM' : 'PM'
  return `${h12}:${pad(m)}:${pad(s)} ${siang}`
}

/** Tanggal panjang bahasa Indonesia, mis. "Kamis, 5 Nov 2026". */
export function formatDate(date: Date): string {
  return `${HARI[date.getDay()]}, ${date.getDate()} ${BULAN[date.getMonth()]} ${date.getFullYear()}`
}

/**
 * Durasi (detik) satu putaran ticker melintasi panel.
 * `speedSec` adalah kecepatan dasar: waktu lintasan untuk teks 24 karakter.
 * Teks lebih panjang sebanding lebih lama (kecepatan px/detik sama),
 * diklem ke [3, 120] agar tidak terlalu pelat/cepat.
 */
export function tickerCycleSec(text: string, speedSec: number): number {
  const chars = Math.max(1, text.trim().length)
  const sec = (speedSec * chars) / 24
  return Math.min(120, Math.max(3, Math.round(sec * 10) / 10))
}
