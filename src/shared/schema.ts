import { z } from 'zod'

/** Versi skema preset. Naikkan bila format berubah, lalu tambahkan migrasi di layout.ts. */
export const SCHEMA_VERSION = 1

const httpUrl = z.url({ protocol: /^https?$/ })
const idString = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'ID hanya boleh huruf, angka, _ dan -')
/**
 * true = terima sertifikat HTTPS apa pun untuk tile ini (nama host tidak cocok, mis. diakses lewat IP,
 * self-signed, kedaluwarsa). Setara "Proceed anyway" di Chrome; hanya untuk server internal tepercaya.
 */
const ignoreCertErrors = z.boolean().optional()

/**
 * Sumber konten sebuah tile.
 * - web   : halaman web biasa (dashboard) -> WebContentsView terisolasi
 * - rtsp  : RTSP dari kamera/NVR -> di-relay MediaMTX -> WebRTC/HLS
 * - hls   : stream HLS langsung (.m3u8) -> hls.js
 * - whep  : WebRTC WHEP langsung
 * - mjpeg : MJPEG via <img>
 * - clock : jam & tanggal live (tile native, digambar DOM React — tanpa WebContentsView)
 * - ticker: teks berjalan/marquee (tile native, CSS animation — tanpa WebContentsView)
 * Password RTSP TIDAK disimpan di preset (disimpan terenkripsi via safeStorage).
 */
export const SourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('empty') }),
  z.object({
    type: z.literal('web'),
    url: httpUrl,
    zoom: z.number().min(0.25).max(5).default(1),
    reloadMinutes: z.number().int().min(0).max(10080).default(0),
    ignoreCertErrors,
    /** CSS tambahan yang disuntikkan ke setiap halaman panel (mis. menyembunyikan header/menu dashboard). */
    css: z.string().max(20_000).optional(),
    /** Rotasi halaman di panel ini: `url` lalu `urls` bergantian setiap `intervalSec` detik. */
    cycle: z
      .object({
        urls: z.array(httpUrl).min(1).max(20),
        intervalSec: z.number().int().min(5).max(86_400).default(60)
      })
      .optional()
  }),
  z.object({
    type: z.literal('rtsp'),
    url: z.string().regex(/^rtsps?:\/\/[^\s]+$/i, 'URL harus diawali rtsp:// atau rtsps://'),
    username: z.string().max(128).optional(),
    transport: z.enum(['auto', 'tcp', 'udp']).default('auto')
  }),
  z.object({ type: z.literal('hls'), url: httpUrl, ignoreCertErrors }),
  z.object({ type: z.literal('whep'), url: httpUrl, ignoreCertErrors }),
  z.object({ type: z.literal('mjpeg'), url: httpUrl, ignoreCertErrors }),
  z.object({
    type: z.literal('clock'),
    hour24: z.boolean().default(true),
    showDate: z.boolean().default(true),
    fontSize: z.number().int().min(16).max(288).default(96)
  }),
  z.object({
    type: z.literal('ticker'),
    text: z.string().trim().min(1).max(500),
    /** Durasi dasar (detik) satu putaran lintasan; teks lebih panjang bergerak sebanding. */
    speedSec: z.number().min(2).max(600).default(20),
    bgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0f172a'),
    fgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#f8fafc'),
    fontSize: z.number().int().min(12).max(288).default(48)
  })
])

/**
 * Banner pengumuman: menutupi seluruh monitor wall (semua slot sekaligus).
 * - `title`      : judul kecil di atas teks (mis. "Peringatan", "Informasi"); kosong = tanpa judul.
 * - `text`       : isi pengumuman.
 * - `bgColor`    : warna latar (#rrggbb).
 * - `fgColor`    : warna teks (#rrggbb).
 * - `fontSize`   : ukuran teks (px, relatif ke tinggi jendela di UI).
 * - `durationSec`: berapa lama tampil (detik). 0 = tetap sampai ditutup manual.
 * - `pinned`     : true = tidak ada tombol tutup di wall (hanya bisa ditutup dari operator).
 * - `mode`       : 'cover' (default) = banner menutupi seluruh wall (tile di-hide);
 *                  'strip' = strip di bagian atas wall, tile tetap terlihat di bawah strip.
 */
export const EmergencyBannerSchema = z.object({
  title: z.string().trim().max(60).default('Pengumuman'),
  text: z.string().trim().min(1).max(500),
  bgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#b91c1c'),
  fgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff'),
  fontSize: z.number().int().min(24).max(480).default(96),
  durationSec: z.number().int().min(0).max(86_400).default(300),
  pinned: z.boolean().default(false),
  /** 'cover' = tutupi seluruh wall (default); 'strip' = strip atas, tile tetap terlihat di bawahnya. */
  mode: z.enum(['cover', 'strip']).default('cover'),
  /** Bunyikan alarm saat banner muncul (dari jendela wall monitor 1). */
  sound: z.boolean().default(false)
})

/** Banner tersimpan yang bisa ditampilkan ulang (dari Operator, jadwal, atau kendali jarak jauh). */
export const BannerTemplateSchema = z.object({
  id: idString,
  name: z.string().trim().min(1).max(60),
  banner: EmergencyBannerSchema
})

/** Jadwal banner berbasis jam: templat `templateId` ditampilkan pada jam+menit (dan hari) yang cocok. */
export const BannerScheduleEntrySchema = z.object({
  id: idString,
  templateId: idString,
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  enabled: z.boolean().default(true),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional()
})

/**
 * Peringatan saat panel bermasalah. Token bot Telegram TIDAK disimpan di sini (terenkripsi di vault).
 * - `afterMinutes`   : panel harus bermasalah terus-menerus selama ini sebelum peringatan dikirim.
 * - `notifyRecovery` : kirim pesan lagi saat panel pulih.
 * - `webhookUrl`     : POST JSON `{ text, content, ... }` (cocok untuk Slack, Discord, Google Chat, n8n, dsb.).
 */
const alertFields = {
  enabled: z.boolean(),
  afterMinutes: z.number().int().min(1).max(1440),
  notifyRecovery: z.boolean(),
  webhookUrl: z.union([z.literal(''), httpUrl]),
  telegramChatId: z
    .string()
    .trim()
    .regex(/^(-?\d{1,20}|@[A-Za-z0-9_]{5,64})?$/, 'Chat ID Telegram berupa angka (mis. -1001234567890) atau @namakanal')
}
export const ALERT_SETTINGS_DEFAULT = { enabled: false, afterMinutes: 5, notifyRecovery: true, webhookUrl: '', telegramChatId: '' }
export const AlertSettingsSchema = z.object({
  enabled: alertFields.enabled.default(ALERT_SETTINGS_DEFAULT.enabled),
  afterMinutes: alertFields.afterMinutes.default(ALERT_SETTINGS_DEFAULT.afterMinutes),
  notifyRecovery: alertFields.notifyRecovery.default(ALERT_SETTINGS_DEFAULT.notifyRecovery),
  webhookUrl: alertFields.webhookUrl.default(ALERT_SETTINGS_DEFAULT.webhookUrl),
  telegramChatId: alertFields.telegramChatId.default(ALERT_SETTINGS_DEFAULT.telegramChatId)
})
/**
 * Patch dari Operator. Sengaja TANPA nilai bawaan: di Zod 4, `.partial()` pada skema ber-default tetap mengisi
 * default untuk kunci yang tidak dikirim, sehingga mengubah satu opsi akan menimpa opsi lainnya.
 */
export const AlertSettingsPatchSchema = z.object(alertFields).partial().strict()

/** Kendali jarak jauh lewat browser di jaringan lokal. Password disimpan sebagai hash di vault, bukan di sini. */
const remoteFields = {
  enabled: z.boolean(),
  port: z.number().int().min(1024).max(65535),
  /** Izinkan layar kendali: melihat panel web dan mengirim klik, gulir, serta ketikan ke dalamnya. */
  screenControl: z.boolean()
}
export const REMOTE_SETTINGS_DEFAULT = { enabled: false, port: 8787, screenControl: false }
export const RemoteSettingsSchema = z.object({
  enabled: remoteFields.enabled.default(REMOTE_SETTINGS_DEFAULT.enabled),
  port: remoteFields.port.default(REMOTE_SETTINGS_DEFAULT.port),
  screenControl: remoteFields.screenControl.default(REMOTE_SETTINGS_DEFAULT.screenControl)
})
/** Patch tanpa nilai bawaan (lihat AlertSettingsPatchSchema). */
export const RemoteSettingsPatchSchema = z.object(remoteFields).partial().strict()

/**
 * Entri jadwal preset berbasis jam.
 * - `presetId`  : preset yang diaktifkan pada jam ini.
 * - `hour`/`minute` : jam lokal (00:00–23:59).
 * - `enabled`   : false = entri diabaikan scheduler (bisa disimpan nonaktif).
 * - `weekdays`  : opsional; 0=Minggu … 6=Sabtu (format `Date#getDay()`).
 *                 Tidak diisi = aktif semua hari.
 */
export const ScheduleEntrySchema = z.object({
  id: idString,
  presetId: idString,
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  enabled: z.boolean().default(true),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional()
})

export const TileSchema = z.object({
  id: idString,
  label: z.string().max(80).default(''),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  source: SourceSchema
})

/** Batas kolom/baris grid. Mode Bebas memakai grid 8x lebih halus, jadi batas ini 8 x 48. */
export const MAX_GRID = 384

export const MonitorLayoutSchema = z.object({
  /** Urutan monitor wall: kiri->kanan lalu atas->bawah, mulai dari 0. */
  slot: z.number().int().min(0).max(31),
  cols: z.number().int().min(1).max(MAX_GRID).default(12),
  rows: z.number().int().min(1).max(MAX_GRID).default(8),
  gap: z.number().int().min(0).max(32).default(4),
  background: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#000000'),
  /** 'free' = grid 8x lebih halus (Mode Bebas di wall); posisi tile tetap bilangan bulat. */
  layoutMode: z.enum(['grid', 'free']).default('grid'),
  /** Garis bantu yang membagi monitor menjadi cols x rows bagian (1x1 = tidak ada garis). */
  bezel: z
    .object({ cols: z.number().int().min(1).max(8), rows: z.number().int().min(1).max(8) })
    .default({ cols: 1, rows: 1 }),
  tiles: z.array(TileSchema).max(64)
})

export const PresetSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: idString,
    name: z.string().min(1).max(80),
    updatedAt: z.string(),
    monitors: z.array(MonitorLayoutSchema).max(32)
  })
  .superRefine((preset, ctx) => {
    const seenTiles = new Set<string>()
    const seenSlots = new Set<number>()
    preset.monitors.forEach((m, mi) => {
      if (seenSlots.has(m.slot)) {
        ctx.addIssue({ code: 'custom', message: `Slot monitor ${m.slot} duplikat`, path: ['monitors', mi, 'slot'] })
      }
      seenSlots.add(m.slot)
      m.tiles.forEach((t, ti) => {
        if (seenTiles.has(t.id)) {
          ctx.addIssue({ code: 'custom', message: `ID tile "${t.id}" duplikat`, path: ['monitors', mi, 'tiles', ti, 'id'] })
        }
        seenTiles.add(t.id)
        if (t.x + t.w > m.cols || t.y + t.h > m.rows) {
          ctx.addIssue({
            code: 'custom',
            message: `Tile "${t.id}" keluar dari grid ${m.cols}x${m.rows}`,
            path: ['monitors', mi, 'tiles', ti]
          })
        }
      })
    })
  })

export const TrustedCertSchema = z.object({
  host: z.string().min(1).max(253),
  /** Format Electron: "sha256/BASE64". */
  fingerprint: z.string().regex(/^sha256\/[A-Za-z0-9+/=]+$/)
})

/** Pengaturan tampilan jendela wall (berlaku untuk semua monitor). */
export const WallSettingsSchema = z.object({
  /** true = Mode Tampil (tanpa toolbar/bilah panel); false = Mode Atur. */
  displayMode: z.boolean().default(false),
  /** Jendela wall selalu di atas jendela lain. */
  pinned: z.boolean().default(false),
  showBezel: z.boolean().default(true),
  /** Magnet tepi saat menggeser/mengubah ukuran panel di Mode Bebas. */
  snap: z.boolean().default(true),
  rotation: z
    .object({
      enabled: z.boolean().default(false),
      intervalSec: z.number().int().min(10).max(86_400).default(300)
    })
    .default({ enabled: false, intervalSec: 300 }),
  /** Jadwal preset berbasis jam. Lebih kuat daripada rotasi interval (rotasi dijeda selama ada entri aktif). */
  schedule: z.array(ScheduleEntrySchema).max(48).default([])
})

export const WALL_SETTINGS_DEFAULT = {
  displayMode: false,
  pinned: false,
  showBezel: true,
  snap: true,
  rotation: { enabled: false, intervalSec: 300 },
  schedule: []
}

export const SettingsSchema = z.object({
  /** undefined = otomatis: pada >1 monitor, monitor utama dipakai operator dan tidak dipakai wall. */
  excludePrimaryFromWall: z.boolean().optional(),
  /** Reload terjadwal tile (jam) sebagai mitigasi memory leak. 0 = nonaktif. */
  reloadIntervalHours: z.number().min(0).max(168).default(12),
  /** Tile video dianggap beku bila tidak ada frame maju selama N detik. */
  videoStallSeconds: z.number().int().min(5).max(300).default(15),
  /** Reload tile bila memori proses renderer-nya melewati batas (MB). 0 = nonaktif. */
  maxTileMemoryMB: z.number().int().min(0).max(32768).default(0),
  trustedCertificates: z.array(TrustedCertSchema).max(64).default([]),
  /** Terima sertifikat HTTPS apa pun untuk SEMUA tile (selain opsi per tile `source.ignoreCertErrors`). */
  ignoreCertErrorsAll: z.boolean().default(false),
  wall: WallSettingsSchema.default(WALL_SETTINGS_DEFAULT),
  mediaMtx: z
    .object({
      enabled: z.boolean().default(true),
      apiPort: z.number().int().min(1024).max(65535).default(9997),
      webrtcPort: z.number().int().min(1024).max(65535).default(8889),
      hlsPort: z.number().int().min(1024).max(65535).default(8888),
      rtspPort: z.number().int().min(1024).max(65535).default(8554)
    })
    .default({ enabled: true, apiPort: 9997, webrtcPort: 8889, hlsPort: 8888, rtspPort: 8554 }),
  bannerTemplates: z.array(BannerTemplateSchema).max(50).default([]),
  bannerSchedule: z.array(BannerScheduleEntrySchema).max(48).default([]),
  alerts: AlertSettingsSchema.default(ALERT_SETTINGS_DEFAULT),
  remote: RemoteSettingsSchema.default(REMOTE_SETTINGS_DEFAULT)
})
