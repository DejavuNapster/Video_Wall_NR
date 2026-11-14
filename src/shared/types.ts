import type { z } from 'zod'
import type {
  EmergencyBannerSchema,
  MonitorLayoutSchema,
  PresetSchema,
  AlertSettingsSchema,
  BannerScheduleEntrySchema,
  BannerTemplateSchema,
  ScheduleEntrySchema,
  SettingsSchema,
  SourceSchema,
  TileSchema,
  WallSettingsSchema
} from './schema'

export type Source = z.infer<typeof SourceSchema>
export type Tile = z.infer<typeof TileSchema>
export type MonitorLayout = z.infer<typeof MonitorLayoutSchema>
export type Preset = z.infer<typeof PresetSchema>
export type Settings = z.infer<typeof SettingsSchema>
export type WallSettings = z.infer<typeof WallSettingsSchema>
export type ScheduleEntry = z.infer<typeof ScheduleEntrySchema>
export type BannerTemplate = z.infer<typeof BannerTemplateSchema>
export type BannerScheduleEntry = z.infer<typeof BannerScheduleEntrySchema>
export type AlertSettings = z.infer<typeof AlertSettingsSchema>
export type EmergencyBanner = z.infer<typeof EmergencyBannerSchema>
/** Mode tampilan banner darurat: 'cover' (fullscreen, default) atau 'strip' (baris atas, tile tetap terlihat). */
export type BannerMode = EmergencyBanner['mode']

/** Banner darurat yang sedang aktif (termasuk kapan diset), untuk dikirim ke UI. */
export interface LiveBanner {
  banner: EmergencyBanner
  /** Timestamp (ms) saat banner diset, untuk info operator. */
  setAt: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayInfo {
  id: number
  label: string
  bounds: Rect
  scaleFactor: number
  primary: boolean
  /** Slot wall (0..N-1) bila display ini dipakai wall; null bila dipakai operator. */
  slot: number | null
  /** true bila display simulasi (VW_VIRTUAL_DISPLAYS), bukan monitor fisik. */
  virtual: boolean
}

export type TileState = 'idle' | 'loading' | 'ok' | 'crashed' | 'unresponsive' | 'stalled' | 'failed'

export interface TileStatus {
  tileId: string
  monitorSlot: number
  state: TileState
  restarts: number
  lastError?: string
  lastOkAt?: number
  memoryMB?: number
  cpuPercent?: number
  /** Panel web: halaman yang sedang terbuka (bisa berbeda dari URL panel setelah link diklik). */
  pageUrl?: string
  canGoBack?: boolean
  canGoForward?: boolean
}

/** Navigasi panel web dari bilah panel / shortcut. `home` = kembali ke URL panel, `newPanel` = buka halaman ini di panel baru. */
export type TileNavAction = 'back' | 'forward' | 'home' | 'newPanel'

export type SidecarState = 'disabled' | 'stopped' | 'starting' | 'running' | 'failed'

export interface PresetMeta {
  id: string
  name: string
  updatedAt: string
}

export interface PlatformInfo {
  /** Nilai `process.platform` (mis. 'win32', 'linux'). */
  os: string
  /** Sesi grafis Linux: 'x11' | 'wayland' | 'unknown'; non-Linux selalu 'n/a'. */
  session: 'x11' | 'wayland' | 'unknown' | 'n/a'
  /** Nilai --ozone-platform yang diberikan saat launch (kosong = otomatis). */
  ozonePlatform: string
}

export interface AppState {
  presets: PresetMeta[]
  activePresetId: string | null
  /** Isi preset yang sedang tampil di wall (null = belum ada). */
  activePreset: Preset | null
  displays: DisplayInfo[]
  wallSlots: number
  tileStatus: Record<string, TileStatus>
  sidecar: { state: SidecarState; message?: string }
  settings: Settings
  windowed: boolean
  platform: PlatformInfo
  /** Peringatan untuk operator (mis. Wayland tanpa --ozone-platform=x11). */
  warnings: string[]
  /** Versi aplikasi (dari package.json), ditampilkan di header operator. */
  version: string
  /** Banner darurat yang sedang aktif di wall (null = tidak ada). */
  banner: LiveBanner | null
  /** Pesan bila penyimpanan otomatis preset aktif terakhir gagal. */
  saveError: string | null
  autostart: AutostartStatus
  remote: RemoteStatus
  /** Token bot Telegram untuk peringatan sudah tersimpan (nilainya tidak pernah dikirim ke UI). */
  telegramTokenSet: boolean
  telegram: TelegramStatus
}

/** Status kendali lewat bot Telegram. */
export interface TelegramStatus {
  running: boolean
  /** Nama bot (tanpa @) setelah token berhasil diperiksa. */
  botUsername?: string
  error?: string
}

/** Status server kendali jarak jauh. */
export interface RemoteStatus {
  running: boolean
  /** Alamat yang bisa dibuka dari perangkat lain, mis. https://192.168.1.20:8787 */
  urls: string[]
  passwordSet: boolean
  /** Sidik jari SHA-256 sertifikat HTTPS yang sedang dipakai (untuk dicocokkan di browser). */
  fingerprint?: string
  /** Sertifikat berlaku sampai (ISO). */
  certValidTo?: string
  error?: string
  /** Masalah yang tidak menghentikan server, mis. sertifikat tidak bisa disimpan. */
  warning?: string
}

export interface AutostartStatus {
  supported: boolean
  enabled: boolean
  /** Alasan bila tidak didukung (mis. mode dev). */
  reason?: string
}

/** Keadaan yang dikirim main ke UI satu jendela wall. */
export interface WallUiState {
  slot: number
  monitor: MonitorLayout | null
  presets: PresetMeta[]
  activePresetId: string | null
  activePresetName: string
  /** Status tile di monitor ini saja. */
  tileStatus: Record<string, TileStatus>
  wall: WallSettings
  activeTileId: string | null
  panelFullscreenTileId: string | null
  windowFullscreen: boolean
  windowed: boolean
  /** Pesan bila penyimpanan otomatis terakhir gagal. */
  saveError: string | null
  /** Banner darurat yang sedang aktif (null = tidak ada). */
  banner: LiveBanner | null
}

/** Cuplikan isi panel (JPEG data URL) per tileId, untuk pratinjau di Operator / kendali jarak jauh. */
export type Thumbnails = Record<string, string>

/** Perintah satu arah dari main ke UI wall. */
export type WallCommand = { type: 'focusUrl'; tileId: string } | { type: 'notice'; kind: 'ok' | 'warn' | 'error'; text: string }

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

/** Hasil operasi edit preset dari wall. `tileId` diisi bila operasi membuat panel baru. */
export type EditResult = { ok: true; preset: Preset; tileId?: string } | { ok: false; error: string }

/** Konfigurasi yang diterima halaman pemutar video lokal (dari main, bukan dari URL). */
export interface VideoTileConfig {
  tileId: string
  kind: 'whep' | 'hls' | 'mjpeg'
  playUrl: string
  /** Dipakai bila WebRTC gagal berulang (mis. mesin tanpa interface jaringan). */
  fallbackHlsUrl?: string
  stallSeconds: number
}

export interface VideoHeartbeat {
  /** currentTime video (detik) atau penghitung frame untuk MJPEG. */
  progress: number
  playing: boolean
  error?: string
}
