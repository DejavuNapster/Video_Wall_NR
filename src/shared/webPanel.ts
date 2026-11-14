/** Utilitas panel halaman web: rotasi halaman dan potongan CSS siap pakai. */

/** Daftar halaman panel web yang bergiliran: URL utama lalu URL tambahan. */
export function cyclePages(source: { url: string; cycle?: { urls: string[] } | undefined }): string[] {
  return [source.url, ...(source.cycle?.urls ?? [])]
}

/** Potongan CSS yang sering dipakai untuk merapikan dashboard di panel. */
export const CSS_SNIPPETS: ReadonlyArray<{ label: string; css: string }> = [
  { label: 'Sembunyikan scrollbar', css: '::-webkit-scrollbar { display: none !important; }' },
  { label: 'Sembunyikan header & navigasi', css: 'header, nav, [role="banner"], [role="navigation"] { display: none !important; }' },
  { label: 'Sembunyikan pop-up cookie', css: '[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i] { display: none !important; }' },
  { label: 'Latar transparan → hitam', css: 'html, body { background: #000 !important; }' }
]
