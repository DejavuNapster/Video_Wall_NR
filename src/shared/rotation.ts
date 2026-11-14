/**
 * Preset berikutnya untuk rotasi otomatis (berurutan, kembali ke awal).
 * `skip` berisi preset yang gagal dibaca. Null bila tidak ada preset lain yang bisa dipilih.
 */
export function nextPresetId(ids: readonly string[], current: string | null, skip: ReadonlySet<string> = new Set()): string | null {
  const start = current === null ? -1 : ids.indexOf(current)
  for (let step = 1; step <= ids.length; step++) {
    const id = ids[(start + step + ids.length) % ids.length]
    if (id !== undefined && id !== current && !skip.has(id)) return id
  }
  return null
}
