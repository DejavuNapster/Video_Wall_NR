import { useEffect, useState } from 'react'
import { STRIP_RATIO } from '@shared/panelGeometry'
import type { LiveBanner } from '@shared/types'

/**
 * Overlay banner pengumuman di wall. State datang dari main (WallUiState.banner).
 * Dua mode tampilan (field `banner.banner.mode`):
 * - cover (default) — menutupi seluruh jendela, di atas semua tile (tile disembunyikan dari main).
 * - strip — pita di bagian atas wall (±12% tinggi jendela, STRIP_RATIO); tile TETAP TERLIHAT
 *   di bawahnya (main menggeser bounds tile setinggi strip; tinggi CSS di sini memakai
 *   rasio yang sama agar persis).
 * - Banner `pinned` tidak punya tombol tutup (hanya operator yang bisa menutup).
 * - Tombol tutup memanggil wallApi.closeBanner() → main menolak bila pinned.
 */
/** Sirene dua nada, tiga kali (±5 detik), lewat WebAudio. Mengembalikan fungsi untuk menghentikannya. */
function playAlarm(): () => void {
  const ctx = new AudioContext()
  const t0 = ctx.currentTime + 0.05
  for (let burst = 0; burst < 3; burst++) {
    for (let beep = 0; beep < 4; beep++) {
      const start = t0 + burst * 1.7 + beep * 0.3
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = beep % 2 === 0 ? 880 : 660
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.3)
    }
  }
  const timer = setTimeout(() => void ctx.close(), 6000)
  return () => {
    clearTimeout(timer)
    void ctx.close()
  }
}

export function BannerOverlay({
  banner,
  top = 0,
  playSound = false
}: {
  banner: LiveBanner
  /** Mode Atur: strip di bawah toolbar. */
  top?: number
  /** Hanya satu jendela wall (monitor 1) yang membunyikan alarm, supaya tidak berlapis. */
  playSound?: boolean
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const sound = playSound && banner.banner.sound
  // Bunyi sekali setiap banner baru ditampilkan (setAt berubah), berhenti bila banner ditutup.
  useEffect(() => (sound ? playAlarm() : undefined), [sound, banner.setAt])
  const [denied, setDenied] = useState<string | null>(null)

  const close = async (): Promise<void> => {
    setBusy(true)
    setDenied(null)
    try {
      const res = await window.wallApi.closeBanner()
      if (!res.ok) setDenied(res.error)
    } finally {
      setBusy(false)
    }
  }

  const closeBtn = (cls = '') =>
    !banner.banner.pinned ? (
      <button
        className={`${cls} rounded border px-4 py-1.5 text-sm opacity-90 hover:opacity-100`}
        style={{ borderColor: 'currentColor' }}
        onClick={() => void close()}
        disabled={busy}
      >
        {busy ? 'Menutup…' : 'Tutup pengumuman'}
      </button>
    ) : null
  const deniedEl = denied ? (
    <div className="rounded bg-black/20 px-3 py-1 text-xs" style={{ color: banner.banner.fgColor }}>
      {denied}
    </div>
  ) : null

  // MODE STRIP — pita di atas; tile di bawah tetap terlihat (digerakkan main lewat inset).
  // v0.2.2 — fix overflow vertikal: semua konten (label, teks, tombol) PASTI muat di dalam
  // strip untuk panjang teks apa pun, via auto-fit:
  // - Label dipindah ke satu baris horizontal dengan tombol (hemat tinggi vertikal).
  // - fontSize teks = min(fontSize banner, budget tinggi / (2 baris × leading)),
  //   teks lebih dari 2 baris dipotong ellipsis (-webkit-line-clamp: 2) — tidak meluap.
  // Tinggi strip TETAP STRIP_RATIO (12%) → inset tile di main tidak berubah.
  if (banner.banner.mode === 'strip') {
    const stripH = window.innerHeight * STRIP_RATIO
    const FIXED_H = 46 // padding (8) + baris header label/tombol (~34) + gap (4) — estimasi konservatif
    const MAX_LINES = 2
    const LINE_H = 1.4 // sedikit di atas leading-snug (1.375) supaya aman
    const textBudget = Math.max(16, stripH - FIXED_H)
    const maxFont = Math.max(12, Math.floor(textBudget / (MAX_LINES * LINE_H)))
    const fontSize = Math.min(banner.banner.fontSize, maxFont)
    return (
      <div
        className="fixed inset-x-0 z-[100] flex flex-col justify-center px-4 py-1 text-center"
        style={{
          top,
          height: `${STRIP_RATIO * 100}%`,
          backgroundColor: banner.banner.bgColor,
          color: banner.banner.fgColor,
          overflow: 'hidden'
        }}
        role="alert"
        aria-live="assertive"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-xs font-semibold uppercase tracking-[0.25em] opacity-80">{banner.banner.title}</div>
          {closeBtn()}
        </div>
        <p
          className="mt-1 font-bold leading-snug"
          style={{
            fontSize,
            wordBreak: 'break-word',
            display: '-webkit-box',
            WebkitLineClamp: MAX_LINES,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        >
          {banner.banner.text}
        </p>
        {deniedEl}
      </div>
    )
  }

  // MODE COVER (default) — fullscreen menutupi seluruh wall.
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 px-8 text-center"
      style={{ backgroundColor: banner.banner.bgColor, color: banner.banner.fgColor }}
      role="alert"
      aria-live="assertive"
    >
      {banner.banner.title && (
        <div className="text-sm font-semibold uppercase tracking-[0.3em] opacity-80" style={{ fontSize: Math.max(14, banner.banner.fontSize / 5) }}>
          {banner.banner.title}
        </div>
      )}
      <p
        className="max-w-[90ch] font-bold leading-snug"
        style={{ fontSize: banner.banner.fontSize, wordBreak: 'break-word' }}
      >
        {banner.banner.text}
      </p>

      {closeBtn('mt-2')}
      {deniedEl}
    </div>
  )
}
