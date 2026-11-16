import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TICKER_FONTS, TICKER_WEIGHTS, tickerBackground, tickerMessages, tickerPlan, tickerTextShadow, type TickerSource } from '@shared/ticker'

/*
 * Tampilan ticker dipakai di wall dan di pratinjau Operator, jadi seluruh gaya ditulis inline (tanpa CSS wall).
 * Gerak memakai Web Animations API agar posisi bisa dihitung dalam piksel dan dijeda tanpa mulai ulang.
 */

type Size = { w: number; h: number }

/** Ukuran tata letak elemen (clientWidth tidak terpengaruh transform skala pratinjau). */
function useSize(ref: React.RefObject<HTMLDivElement | null>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (): void => setSize((prev) => (prev.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth, h: el.clientHeight }))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

export function TickerView({ source }: { source: TickerSource }): React.JSX.Element {
  const laneRef = useRef<HTMLDivElement>(null)
  const lane = useSize(laneRef)
  const messages = tickerMessages(source.text)
  const fade = source.fadeEdges
    ? `linear-gradient(${source.motion === 'up' ? '180deg' : '90deg'}, transparent, #000 6%, #000 94%, transparent)`
    : undefined
  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden', userSelect: 'none', background: tickerBackground(source) }}>
      {source.badge && <Badge source={source} />}
      <div
        ref={laneRef}
        style={{
          position: 'relative',
          flex: 1,
          minWidth: 0,
          height: '100%',
          overflow: 'hidden',
          maskImage: fade,
          WebkitMaskImage: fade,
          color: source.fgColor,
          fontSize: source.fontSize,
          fontFamily: TICKER_FONTS[source.fontFamily].stack,
          fontWeight: TICKER_WEIGHTS[source.fontWeight],
          fontStyle: source.italic ? 'italic' : 'normal',
          textTransform: source.uppercase ? 'uppercase' : 'none',
          letterSpacing: `${source.letterSpacing / 100}em`,
          textShadow: tickerTextShadow(source.effect, source.effectColor, source.effectStrength, source.fontSize),
          lineHeight: 1.3
        }}
      >
        {source.motion === 'static' ? (
          <StaticMessages source={source} messages={messages} lane={lane} />
        ) : (
          <MovingTrack source={source} messages={messages} lane={lane} />
        )}
      </div>
    </div>
  )
}

/** Label tetap di sisi kiri (mis. "BREAKING") dengan ujung miring. */
function Badge({ source }: { source: TickerSource }): React.JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        height: '100%',
        padding: '0 1.3em 0 0.7em',
        background: source.badgeBg,
        color: source.badgeFg,
        fontFamily: TICKER_FONTS[source.fontFamily].stack,
        fontSize: Math.max(10, Math.round(source.fontSize * 0.62)),
        fontWeight: 800,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        clipPath: 'polygon(0 0, 100% 0, calc(100% - 0.7em) 100%, 0 100%)'
      }}
    >
      {source.badge}
    </div>
  )
}

function Separator({ text }: { text: string }): React.JSX.Element {
  if (!text.trim()) return <span style={{ display: 'inline-block', width: '1.5em' }} />
  return <span style={{ padding: '0 0.6em', opacity: 0.75 }}>{text}</span>
}

function MovingTrack({ source, messages, lane }: { source: TickerSource; messages: string[]; lane: Size }): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const copyRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<Animation | null>(null)
  const [copies, setCopies] = useState(1)
  const vertical = source.motion === 'up'
  const looped = source.continuous && source.motion !== 'bounce'
  const shown = looped ? copies : 1
  // Animasi dibuat ulang bila isi, gaya, atau ukuran berubah; jeda/jalankan tidak memulai ulang dari awal.
  const { paused, ...rest } = source
  const restKey = JSON.stringify(rest)

  useLayoutEffect(() => {
    const track = trackRef.current
    const copy = copyRef.current
    if (!track || !copy || source.motion === 'static') return
    const plan = tickerPlan({
      motion: source.motion,
      continuous: looped,
      speedSec: source.speedSec,
      laneW: lane.w,
      laneH: lane.h,
      contentW: copy.offsetWidth,
      contentH: copy.offsetHeight
    })
    if (!plan) return
    if (plan.copies !== shown) {
      setCopies(plan.copies)
      return
    }
    const fn = plan.axis === 'x' ? 'translateX' : 'translateY'
    const anim = track.animate(
      plan.frames.map((f) => ({ offset: f.offset, transform: `${fn}(${f.value}px)`, ...(f.easing ? { easing: f.easing } : {}) })),
      { duration: plan.durationMs, iterations: Infinity }
    )
    if (source.paused) anim.pause()
    animRef.current = anim
    return () => {
      anim.cancel()
      animRef.current = null
    }
    // restKey mewakili seluruh opsi selain `paused`.
  }, [restKey, lane.w, lane.h, shown])

  useEffect(() => {
    const anim = animRef.current
    if (!anim) return
    if (paused) anim.pause()
    else anim.play()
  }, [paused])

  const copyNodes = Array.from({ length: shown }, (_, i) =>
    vertical ? (
      <div key={i} ref={i === 0 ? copyRef : undefined} aria-hidden={i > 0 || undefined} style={{ paddingBottom: looped ? '0.8em' : 0 }}>
        {messages.map((m, j) => (
          <div key={j} style={{ textAlign: 'center', padding: '0.15em 0.5em', overflowWrap: 'anywhere' }}>
            {m}
          </div>
        ))}
      </div>
    ) : (
      <div key={i} ref={i === 0 ? copyRef : undefined} aria-hidden={i > 0 || undefined} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        {messages.map((m, j) => (
          <Fragment key={j}>
            {j > 0 && <Separator text={source.separator} />}
            <span>{m}</span>
          </Fragment>
        ))}
        {looped && <Separator text={source.separator} />}
      </div>
    )
  )

  return (
    <div
      ref={trackRef}
      style={
        vertical
          ? { position: 'absolute', top: 0, left: 0, width: '100%', willChange: 'transform' }
          : { position: 'absolute', top: 0, left: 0, height: '100%', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', willChange: 'transform' }
      }
    >
      {copyNodes}
    </div>
  )
}

/**
 * Gerak diam: pesan tampil satu per satu di tengah panel dengan transisi memudar. Pesan yang lebih lebar dari
 * panel diperkecil agar tetap satu baris dan terbaca utuh.
 */
function StaticMessages({ source, messages, lane }: { source: TickerSource; messages: string[]; lane: Size }): React.JSX.Element {
  const [index, setIndex] = useState(0)
  const [fits, setFits] = useState<number[]>([])
  const itemRefs = useRef<Array<HTMLSpanElement | null>>([])
  const count = messages.length
  const { paused, ...rest } = source
  const holdSec = source.holdSec
  // Ukuran pesan diukur ulang bila isi, gaya, atau lebar panel berubah.
  const restKey = JSON.stringify(rest)

  useEffect(() => {
    if (count < 2 || paused) return
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), holdSec * 1000)
    return () => window.clearInterval(id)
  }, [count, holdSec, paused])

  useLayoutEffect(() => {
    const room = lane.w * 0.94
    const next = messages.map((_, i) => {
      const w = itemRefs.current[i]?.offsetWidth ?? 0
      return w > room && room > 0 ? room / w : 1
    })
    setFits((prev) => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next))
  }, [restKey, lane.w])

  const current = index % Math.max(1, count)
  return (
    <>
      {messages.map((m, i) => (
        <div
          key={i}
          aria-hidden={i !== current || undefined}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: i === current ? 1 : 0,
            transform: i === current ? 'none' : 'translateY(0.4em)',
            transition: 'opacity 0.6s ease, transform 0.6s ease'
          }}
        >
          <span
            ref={(el) => {
              itemRefs.current[i] = el
            }}
            style={{ display: 'inline-block', flexShrink: 0, whiteSpace: 'nowrap', transform: `scale(${fits[i] ?? 1})` }}
          >
            {m}
          </span>
        </div>
      ))}
    </>
  )
}
