/**
 * Logika murni jadwal preset berbasis jam (dipakai scheduler di proses main dan unit test).
 *
 * Aturan (dipertahankan konsisten di seluruh aplikasi):
 * 1. Entri "jatuh tempo" pada menit jam+menit yang cocok (zona waktu lokal) dan hari cocok.
 *    `weekdays` opsional: 0=Minggu … 6=Sabtu (format `Date#getDay()`); tidak diisi = semua hari.
 * 2. Bila beberapa entri cocok pada menit yang sama, entri PERTAMA di daftar yang menang.
 * 3. Hysteresis: entri terpilih tidak dipicu ulang pada menit yang sama
 *    (pencatatan `lastTrigger` = kunci entri + stempel menit).
 * 4. PRIORITAS: jadwal lebih kuat daripada rotasi interval — selama ada minimal satu entri
 *    yang diaktifkan, rotasi interval dijeda (lihat `hasEnabledSchedule`).
 */
import type { ScheduleEntry } from './types'

/** Interval pemeriksaan scheduler di proses main (ms). */
export const SCHEDULE_CHECK_MS = 30_000

/** Semua hari, 0=Minggu … 6=Sabtu. */
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const

/**
 * Kunci entri untuk hysteresis.
 * (id sengaja tidak ikut: identitas fungsional entri adalah preset + jam.)
 */
export function entryKey(e: Pick<ScheduleEntry, 'presetId' | 'hour' | 'minute'>): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${e.presetId}@${p(e.hour)}:${p(e.minute)}`
}

/** Stempel menit (zona lokal) agar hysteresis berlaku per menit, bukan selamanya. */
export function minuteStamp(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`
}

/** Bagian entri yang menentukan waktu (dipakai jadwal preset dan jadwal banner). */
export type TimedEntry = Pick<ScheduleEntry, 'enabled' | 'hour' | 'minute' | 'weekdays'>

/** true bila entri aktif dan jam+menit+hari sekarang cocok. */
export function isEntryDue(e: TimedEntry, now: Date): boolean {
  if (!e.enabled) return false
  if (e.hour !== now.getHours() || e.minute !== now.getMinutes()) return false
  const days: readonly number[] = e.weekdays ?? ALL_WEEKDAYS
  return days.includes(now.getDay())
}

/** Pencatatan pemicu terakhir (untuk hysteresis). */
export interface LastTrigger {
  key: string
  minuteStamp: string
}

/**
 * Putuskan entri yang harus diaktifkan pada `now` (fungsi murni).
 * Mengembalikan null bila tidak ada entri yang jatuh tempo, atau entri terpilih
 * sudah dipicu pada menit yang sama (hysteresis).
 * Preset yang sudah aktif tetap dikembalikan — controller yang men-skip aktivasi
 * namun mencatat pemicu (agar menit berikutnya tidak memicu ulang).
 */
export function pickScheduledEntry(
  now: Date,
  entries: readonly ScheduleEntry[],
  last: LastTrigger | null
): ScheduleEntry | null {
  let first: ScheduleEntry | null = null
  for (const e of entries) {
    if (isEntryDue(e, now)) {
      first = e
      break
    }
  }
  if (!first) return null
  if (last && last.key === entryKey(first) && last.minuteStamp === minuteStamp(now)) return null
  return first
}

/** true bila ada minimal satu entri yang diaktifkan (rotasi interval harus dijeda). */
export function hasEnabledSchedule(entries: readonly Pick<ScheduleEntry, 'enabled'>[]): boolean {
  return entries.some((e) => e.enabled)
}
