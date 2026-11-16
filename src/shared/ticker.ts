/**
 * Logika murni tile ticker (teks berjalan) — tanpa DOM, bisa diuji di node.
 * Komponen di renderer hanya mengukur elemen lalu menjalankan rencana gerak dari sini.
 */
import { z } from 'zod'
import { SourceSchema, TICKER_MOTIONS } from './schema'
import type { Result, Source } from './types'

export type TickerSource = Extract<Source, { type: 'ticker' }>
export type TickerMotion = TickerSource['motion']
export type TickerEffect = TickerSource['effect']

export const TICKER_FONTS: Record<TickerSource['fontFamily'], { label: string; stack: string }> = {
  system: { label: 'Sistem', stack: "system-ui, 'Segoe UI', Roboto, sans-serif" },
  sans: { label: 'Arial', stack: "Arial, Helvetica, 'Liberation Sans', sans-serif" },
  serif: { label: 'Serif', stack: "Georgia, 'Times New Roman', 'Liberation Serif', serif" },
  mono: { label: 'Monospace', stack: "Consolas, 'Cascadia Mono', 'DejaVu Sans Mono', monospace" },
  condensed: { label: 'Ramping', stack: "'Bahnschrift SemiCondensed', 'Arial Narrow', 'Roboto Condensed', 'Liberation Sans Narrow', sans-serif" },
  impact: { label: 'Impact', stack: "Impact, Haettenschweiler, 'Arial Black', sans-serif" }
}

export const TICKER_WEIGHTS: Record<TickerSource['fontWeight'], number> = { normal: 400, bold: 700, black: 900 }

/** Pilihan cepat kecepatan (detik melintasi panel). */
export const TICKER_SPEEDS = [
  { text: 'Lambat', sec: 25 },
  { text: 'Sedang', sec: 12 },
  { text: 'Cepat', sec: 6 }
]

/** Nama singkat panel ticker untuk daftar panel: pesan pertama, dipotong. */
export function tickerName(text: string, max = 60): string {
  const first = tickerMessages(text)[0] ?? ''
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

/** Pesan-pesan ticker: satu per baris, baris kosong diabaikan. */
export function tickerMessages(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

const px = (n: number): string => `${Math.round(n * 10) / 10}px`

/**
 * Nilai CSS `text-shadow` untuk efek teks. Ukuran efek mengikuti ukuran huruf dan `strength` (1–10, 5 = sedang),
 * sehingga tampilan tetap seimbang dari panel kecil sampai panel raksasa.
 */
export function tickerTextShadow(effect: TickerEffect, color: string, strength: number, fontSize: number): string {
  const k = (Math.min(10, Math.max(1, strength)) / 5) * fontSize
  switch (effect) {
    case 'shadow': {
      const o = Math.max(1, k * 0.05)
      return `${px(o)} ${px(o)} ${px(o * 1.6)} ${color}`
    }
    case '3d': {
      // Lapisan bayangan tanpa blur bertumpuk 1px demi 1px membentuk sisi huruf, ditutup bayangan lembut.
      const depth = Math.min(30, Math.max(1, Math.round(k * 0.08)))
      const layers = Array.from({ length: depth }, (_, i) => `${i + 1}px ${i + 1}px 0 ${color}`)
      layers.push(`${depth + 1}px ${depth + 1}px ${px(depth * 1.5)} rgba(0, 0, 0, 0.45)`)
      return layers.join(', ')
    }
    case 'outline': {
      // 16 arah agar garis tepi tetap rapat di lengkungan huruf (text-stroke menggerus isi huruf).
      const w = Math.max(1, Math.round(k * 0.04))
      const seen = new Set<string>()
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2
        seen.add(`${Math.round(Math.cos(a) * w)}px ${Math.round(Math.sin(a) * w)}px 0 ${color}`)
      }
      return [...seen].join(', ')
    }
    case 'glow': {
      const b = Math.max(2, k * 0.12)
      return `0 0 ${px(b * 0.5)} ${color}, 0 0 ${px(b)} ${color}, 0 0 ${px(b * 2)} ${color}`
    }
    default:
      return 'none'
  }
}

/** Latar ticker: warna polos atau gradasi atas ke bawah. */
export function tickerBackground(s: Pick<TickerSource, 'bgColor' | 'bgColor2'>): string {
  return s.bgColor2 ? `linear-gradient(180deg, ${s.bgColor}, ${s.bgColor2})` : s.bgColor
}

export interface TickerPlan {
  /** Jumlah salinan isi yang perlu dirender agar gerak bersambung tidak menyisakan celah. */
  copies: number
  axis: 'x' | 'y'
  frames: Array<{ offset: number; value: number; easing?: string }>
  durationMs: number
}

/**
 * Rencana gerak ticker. `lane` = area tempat teks bergerak (panel dikurangi label), `content` = ukuran satu
 * salinan isi. Kecepatan konstan: `speedSec` detik untuk melintasi lebar (atau tinggi) lane.
 * Mengembalikan null bila tidak ada yang perlu digerakkan.
 */
export function tickerPlan(o: {
  motion: Exclude<TickerMotion, 'static'>
  continuous: boolean
  speedSec: number
  laneW: number
  laneH: number
  contentW: number
  contentH: number
}): TickerPlan | null {
  const vertical = o.motion === 'up'
  const lane = vertical ? o.laneH : o.laneW
  const content = vertical ? o.contentH : o.contentW
  if (lane <= 0 || content <= 0) return null
  const pxPerSec = Math.max(10, lane / Math.max(0.5, o.speedSec))
  const ms = (distance: number): number => Math.max(500, Math.round((distance / pxPerSec) * 1000))

  if (o.motion === 'bounce') {
    const end = lane - content
    if (Math.abs(end) < 1) return null
    // Berhenti sejenak di setiap ujung (10% waktu), bergerak halus di antaranya.
    const travel = ms(Math.abs(end))
    return {
      copies: 1,
      axis: 'x',
      frames: [
        { offset: 0, value: 0 },
        { offset: 0.1, value: 0, easing: 'ease-in-out' },
        { offset: 0.5, value: end },
        { offset: 0.6, value: end, easing: 'ease-in-out' },
        { offset: 1, value: 0 }
      ],
      durationMs: Math.round(travel / 0.4)
    }
  }

  const axis = vertical ? 'y' : 'x'
  const reverse = o.motion === 'right'
  if (o.continuous) {
    const copies = Math.ceil(lane / content) + 1
    const [from, to] = reverse ? [-content, 0] : [0, -content]
    return { copies, axis, frames: [{ offset: 0, value: from }, { offset: 1, value: to }], durationMs: ms(content) }
  }
  const [from, to] = reverse ? [-content, lane] : [lane, -content]
  return { copies: 1, axis, frames: [{ offset: 0, value: from }, { offset: 1, value: to }], durationMs: ms(lane + content) }
}

type TickerStyle = Pick<
  TickerSource,
  | 'fontFamily'
  | 'fontWeight'
  | 'italic'
  | 'uppercase'
  | 'letterSpacing'
  | 'effect'
  | 'effectColor'
  | 'effectStrength'
  | 'bgColor'
  | 'bgColor2'
  | 'fgColor'
  | 'badgeBg'
  | 'badgeFg'
>

/** Gaya siap pakai: hanya mengubah tampilan, tidak mengubah teks, gerak, atau ukuran. */
export const TICKER_STYLES: Array<{ id: string; name: string; style: TickerStyle }> = [
  {
    id: 'news',
    name: 'Berita',
    style: {
      fontFamily: 'sans', fontWeight: 'bold', italic: false, uppercase: false, letterSpacing: 0,
      effect: 'shadow', effectColor: '#000000', effectStrength: 4,
      bgColor: '#0b1f4d', bgColor2: '#06122e', fgColor: '#ffffff', badgeBg: '#dc2626', badgeFg: '#ffffff'
    }
  },
  {
    id: 'neon',
    name: 'Neon',
    style: {
      fontFamily: 'system', fontWeight: 'bold', italic: false, uppercase: false, letterSpacing: 2,
      effect: 'glow', effectColor: '#d946ef', effectStrength: 6,
      bgColor: '#05010f', bgColor2: '', fgColor: '#fdf4ff', badgeBg: '#d946ef', badgeFg: '#05010f'
    }
  },
  {
    id: 'gold3d',
    name: 'Emas 3D',
    style: {
      fontFamily: 'impact', fontWeight: 'normal', italic: false, uppercase: true, letterSpacing: 4,
      effect: '3d', effectColor: '#92400e', effectStrength: 5,
      bgColor: '#292524', bgColor2: '#0c0a09', fgColor: '#facc15', badgeBg: '#facc15', badgeFg: '#1c1917'
    }
  },
  {
    id: 'led',
    name: 'Papan LED',
    style: {
      fontFamily: 'mono', fontWeight: 'bold', italic: false, uppercase: true, letterSpacing: 10,
      effect: 'glow', effectColor: '#f59e0b', effectStrength: 3,
      bgColor: '#000000', bgColor2: '', fgColor: '#fbbf24', badgeBg: '#b45309', badgeFg: '#000000'
    }
  },
  {
    id: 'warning',
    name: 'Peringatan',
    style: {
      fontFamily: 'sans', fontWeight: 'black', italic: false, uppercase: true, letterSpacing: 2,
      effect: 'none', effectColor: '#000000', effectStrength: 5,
      bgColor: '#facc15', bgColor2: '#eab308', fgColor: '#111827', badgeBg: '#111827', badgeFg: '#facc15'
    }
  },
  {
    id: 'outline',
    name: 'Garis tepi',
    style: {
      fontFamily: 'system', fontWeight: 'black', italic: false, uppercase: false, letterSpacing: 0,
      effect: 'outline', effectColor: '#0c4a6e', effectStrength: 4,
      bgColor: '#0ea5e9', bgColor2: '#0369a1', fgColor: '#ffffff', badgeBg: '#0c4a6e', badgeFg: '#ffffff'
    }
  },
  {
    id: 'plain',
    name: 'Polos',
    style: {
      fontFamily: 'system', fontWeight: 'normal', italic: false, uppercase: false, letterSpacing: 0,
      effect: 'none', effectColor: '#000000', effectStrength: 5,
      bgColor: '#0f172a', bgColor2: '', fgColor: '#f8fafc', badgeBg: '#dc2626', badgeFg: '#ffffff'
    }
  }
]

/**
 * Perubahan teks berjalan dari kendali jarak jauh dan Telegram. Sengaja tanpa nilai bawaan (lihat
 * AlertSettingsPatchSchema): kunci yang tidak dikirim tidak mengubah apa pun. `style` = id TICKER_STYLES.
 */
export const TickerPatchSchema = z
  .object({
    text: z.string().trim().min(1, 'Teks tidak boleh kosong').max(2000, 'Teks maksimal 2000 karakter'),
    badge: z.string().trim().max(40, 'Label maksimal 40 karakter'),
    paused: z.boolean(),
    motion: z.enum(TICKER_MOTIONS),
    speedSec: z.number().min(2).max(600),
    style: z.string().refine((id) => TICKER_STYLES.some((s) => s.id === id), 'Gaya tidak dikenal')
  })
  .partial()
  .strict()
export type TickerPatch = z.infer<typeof TickerPatchSchema>

/** Terapkan perubahan ke sumber ticker; hasilnya divalidasi ulang dengan skema preset. */
export function applyTickerPatch(src: TickerSource, patch: TickerPatch): Result<{ source: TickerSource }> {
  const { style, ...rest } = patch
  const look = style ? TICKER_STYLES.find((s) => s.id === style)?.style : undefined
  const r = SourceSchema.safeParse({ ...src, ...look, ...rest })
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? 'Pengaturan teks berjalan tidak valid' }
  return r.data.type === 'ticker' ? { ok: true, source: r.data } : { ok: false, error: 'Panel ini bukan teks berjalan' }
}
