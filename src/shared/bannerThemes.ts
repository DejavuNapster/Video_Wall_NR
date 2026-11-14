/** Tema banner: warna + judul bawaan yang sesuai sifat pengumumannya (Operator dan kendali jarak jauh). */
export const BANNER_THEMES: ReadonlyArray<{ id: string; label: string; title: string; bg: string; fg: string }> = [
  { id: 'darurat', label: 'Darurat', title: 'Pengumuman Darurat', bg: '#b91c1c', fg: '#ffffff' },
  { id: 'peringatan', label: 'Peringatan', title: 'Peringatan', bg: '#f59e0b', fg: '#111827' },
  { id: 'info', label: 'Info', title: 'Informasi', bg: '#1d4ed8', fg: '#ffffff' },
  { id: 'netral', label: 'Netral', title: 'Pengumuman', bg: '#0f172a', fg: '#f8fafc' }
]
