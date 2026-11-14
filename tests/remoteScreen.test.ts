import { describe, expect, it } from 'vitest'
import { ScreenInputSchema, toInputSteps } from '../src/main/remote/screen'

const parse = (raw: unknown) => ScreenInputSchema.parse(raw)

describe('layar kendali: masukan ke panel', () => {
  it('ketukan menjadi klik di posisi panel yang sesuai', () => {
    expect(toInputSteps(parse({ kind: 'tap', x: 0.5, y: 0.25 }), 1280, 720)).toEqual([
      { event: { type: 'mouseMove', x: 640, y: 180 } },
      { event: { type: 'mouseDown', x: 640, y: 180, button: 'left', clickCount: 1 } },
      { event: { type: 'mouseUp', x: 640, y: 180, button: 'left', clickCount: 1 } }
    ])
    const dbl = toInputSteps(parse({ kind: 'tap', x: 1, y: 1, count: 2 }), 1280, 720)
    // Tepi kanan/bawah tetap di dalam panel.
    expect(dbl[1]).toEqual({ event: { type: 'mouseDown', x: 1279, y: 719, button: 'left', clickCount: 2 } })
  })

  it('geseran jari diskalakan ke ukuran panel', () => {
    expect(toInputSteps(parse({ kind: 'scroll', x: 0.5, y: 0.5, dx: 0, dy: -0.5 }), 1000, 800)).toEqual([
      { event: { type: 'mouseWheel', x: 500, y: 400, deltaX: 0, deltaY: -400, canScroll: true, hasPreciseScrollingDeltas: true } }
    ])
  })

  it('seret: tekan, gerak dengan tombol ditahan, lepas', () => {
    const start = toInputSteps(parse({ kind: 'drag', phase: 'start', x: 0.1, y: 0.1 }), 100, 100)
    expect(start.map((s) => ('event' in s ? s.event.type : ''))).toEqual(['mouseMove', 'mouseDown'])
    expect(toInputSteps(parse({ kind: 'drag', phase: 'move', x: 0.2, y: 0.2 }), 100, 100)).toEqual([
      { event: { type: 'mouseMove', x: 20, y: 20, modifiers: ['leftbuttondown'] } }
    ])
    expect(toInputSteps(parse({ kind: 'drag', phase: 'end', x: 0.3, y: 0.3 }), 100, 100)[0]).toMatchObject({ event: { type: 'mouseUp' } })
  })

  it('teks disisipkan; Enter juga mengirim karakter baris baru', () => {
    expect(toInputSteps(parse({ kind: 'text', text: 'halo dunia' }), 10, 10)).toEqual([{ insertText: 'halo dunia' }])
    expect(toInputSteps(parse({ kind: 'key', key: 'Enter' }), 10, 10)).toEqual([
      { event: { type: 'keyDown', keyCode: 'Enter' } },
      { event: { type: 'char', keyCode: '\r' } },
      { event: { type: 'keyUp', keyCode: 'Enter' } }
    ])
    expect(toInputSteps(parse({ kind: 'key', key: 'Tab' }), 10, 10)).toHaveLength(2)
  })

  it('masukan di luar batas ditolak', () => {
    for (const bad of [
      { kind: 'tap', x: 1.5, y: 0 },
      { kind: 'tap', x: 0, y: 0, count: 3 },
      { kind: 'scroll', x: 0, y: 0, dx: 0, dy: 99 },
      { kind: 'text', text: '' },
      { kind: 'text', text: 'x'.repeat(1001) },
      { kind: 'key', key: 'F12' },
      { kind: 'mouse', x: 0, y: 0 }
    ]) {
      expect(ScreenInputSchema.safeParse(bad).success).toBe(false)
    }
  })
})
