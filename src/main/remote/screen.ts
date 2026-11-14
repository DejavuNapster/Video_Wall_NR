import { z } from 'zod'

/** Tombol keyboard yang bisa dikirim dari layar kendali (nama keyCode Electron). */
export const SCREEN_KEYS = ['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'Up', 'Down', 'Left', 'Right', 'PageUp', 'PageDown', 'Home', 'End'] as const

/** Posisi relatif terhadap gambar panel: 0 = kiri/atas, 1 = kanan/bawah. */
const pos = z.number().min(0).max(1)
/** Geseran jari relatif terhadap ukuran panel (1 = selebar/setinggi panel); positif = ke kanan/bawah. */
const delta = z.number().min(-10).max(10)

/** Masukan dari layar kendali jarak jauh untuk satu panel web. */
export const ScreenInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tap'), x: pos, y: pos, count: z.union([z.literal(1), z.literal(2)]).default(1) }),
  z.object({ kind: z.literal('scroll'), x: pos, y: pos, dx: delta, dy: delta }),
  z.object({ kind: z.literal('drag'), phase: z.enum(['start', 'move', 'end']), x: pos, y: pos }),
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(1000) }),
  z.object({ kind: z.literal('key'), key: z.enum(SCREEN_KEYS) })
])
export type ScreenInput = z.infer<typeof ScreenInputSchema>

/** Event masukan Electron (`webContents.sendInputEvent`). */
export type InputEvent =
  | { type: 'mouseMove' | 'mouseDown' | 'mouseUp'; x: number; y: number; button?: 'left'; clickCount?: number; modifiers?: ['leftbuttondown'] }
  | { type: 'mouseWheel'; x: number; y: number; deltaX: number; deltaY: number; canScroll: true; hasPreciseScrollingDeltas: true }
  | { type: 'keyDown' | 'keyUp' | 'char'; keyCode: string }

/** Satu langkah: event masukan, atau sisipkan teks ke elemen yang sedang aktif di halaman. */
export type InputStep = { event: InputEvent } | { insertText: string }

/**
 * Terjemahkan masukan dari ponsel menjadi event mouse/keyboard untuk panel berukuran `width`×`height` (DIP).
 * Koordinat event mengikuti ukuran tampilan panel; zoom halaman diperhitungkan sendiri oleh Chromium.
 */
export function toInputSteps(input: ScreenInput, width: number, height: number): InputStep[] {
  const at = (x: number, y: number): { x: number; y: number } => ({
    x: Math.min(width - 1, Math.max(0, Math.round(x * width))),
    y: Math.min(height - 1, Math.max(0, Math.round(y * height)))
  })
  switch (input.kind) {
    case 'tap': {
      const p = at(input.x, input.y)
      return [
        { event: { type: 'mouseMove', ...p } },
        { event: { type: 'mouseDown', ...p, button: 'left', clickCount: input.count } },
        { event: { type: 'mouseUp', ...p, button: 'left', clickCount: input.count } }
      ]
    }
    case 'scroll':
      // Isi halaman mengikuti jari seperti layar sentuh: jari ke atas → halaman bergulir ke bawah. Delta roda
      // Chromium berlawanan arah dengan WheelEvent.deltaY di DOM, jadi geseran jari bisa dipakai apa adanya.
      // Delta presisi (seperti touchpad) digulir langsung sejauh itu, tanpa animasi gulir halus.
      return [
        {
          event: { type: 'mouseWheel', ...at(input.x, input.y), deltaX: Math.round(input.dx * width), deltaY: Math.round(input.dy * height), canScroll: true, hasPreciseScrollingDeltas: true }
        }
      ]
    case 'drag': {
      const p = at(input.x, input.y)
      if (input.phase === 'start') return [{ event: { type: 'mouseMove', ...p } }, { event: { type: 'mouseDown', ...p, button: 'left', clickCount: 1 } }]
      if (input.phase === 'move') return [{ event: { type: 'mouseMove', ...p, modifiers: ['leftbuttondown'] } }]
      return [{ event: { type: 'mouseUp', ...p, button: 'left', clickCount: 1 } }]
    }
    case 'text':
      return [{ insertText: input.text }]
    case 'key': {
      const steps: InputStep[] = [{ event: { type: 'keyDown', keyCode: input.key } }]
      // Enter perlu event "char" agar formulir terkirim / baris baru tersisip, seperti tombol fisik.
      if (input.key === 'Enter') steps.push({ event: { type: 'char', keyCode: '\r' } })
      steps.push({ event: { type: 'keyUp', keyCode: input.key } })
      return steps
    }
  }
}
