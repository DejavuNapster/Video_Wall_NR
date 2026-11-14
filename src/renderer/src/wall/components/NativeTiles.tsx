import { useEffect, useState } from 'react'
import { formatDate, formatTime, tickerCycleSec } from '@shared/clock'
import type { Rect, Source } from '@shared/types'

export type ClockSource = Extract<Source, { type: 'clock' }>
export type TickerSource = Extract<Source, { type: 'ticker' }>

const box = (r: Rect): React.CSSProperties => ({ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height })

/**
 * Tile JAM — jam & tanggal live, diperbarui tiap detik lewat state React.
 * DOM murni di jendela wall: tanpa WebContentsView, tanpa proses main.
 */
export function ClockTile({ source, rect }: { source: ClockSource; rect: Rect }): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div style={box(rect)} className="flex flex-col items-center justify-center gap-2 overflow-hidden bg-slate-950">
      <div className="font-mono leading-none tabular-nums text-slate-100" style={{ fontSize: source.fontSize }}>
        {formatTime(now, source.hour24)}
      </div>
      {source.showDate && (
        <div className="text-slate-400" style={{ fontSize: Math.max(14, Math.round(source.fontSize / 5)) }}>
          {formatDate(now)}
        </div>
      )}
    </div>
  )
}

/**
 * Tile TICKER — teks berjalan (marquee) via CSS animation; durasi satu
 * putaran sebanding panjang teks (logika di @shared/clock, teruji di node).
 */
export function TickerTile({ source, rect }: { source: TickerSource; rect: Rect }): React.JSX.Element {
  const cycle = tickerCycleSec(source.text, source.speedSec)
  return (
    <div
      style={{ ...box(rect), backgroundColor: source.bgColor, color: source.fgColor }}
      className="flex select-none items-center overflow-hidden"
    >
      <span
        className="ticker-track will-change-transform"
        style={{ animationDuration: `${cycle}s`, fontSize: source.fontSize, lineHeight: 1.4 }}
      >
        {source.text}
      </span>
    </div>
  )
}
