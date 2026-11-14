/** Kolom URL per panel (untuk Ctrl+L dan fokus otomatis setelah + Panel). */
export const urlInputs = new Map<string, HTMLInputElement>()

export function focusUrlInput(tileId: string): boolean {
  const el = urlInputs.get(tileId)
  if (!el) return false
  el.focus()
  el.select()
  return true
}
