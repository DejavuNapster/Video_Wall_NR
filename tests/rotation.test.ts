import { describe, expect, it } from 'vitest'
import { nextPresetId } from '@shared/rotation'

describe('nextPresetId', () => {
  const ids = ['a', 'b', 'c']
  it('berputar berurutan dan kembali ke awal', () => {
    expect(nextPresetId(ids, 'a')).toBe('b')
    expect(nextPresetId(ids, 'c')).toBe('a')
  })
  it('preset aktif tidak dikenal mulai dari awal', () => {
    expect(nextPresetId(ids, 'zzz')).toBe('a')
    expect(nextPresetId(ids, null)).toBe('a')
  })
  it('melewati preset yang ditandai rusak', () => {
    expect(nextPresetId(ids, 'a', new Set(['b']))).toBe('c')
  })
  it('null bila tidak ada preset lain yang bisa dipilih', () => {
    expect(nextPresetId(['a'], 'a')).toBeNull()
    expect(nextPresetId(ids, 'a', new Set(['b', 'c']))).toBeNull()
    expect(nextPresetId([], null)).toBeNull()
  })
})
