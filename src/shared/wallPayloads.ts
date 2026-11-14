import { z } from 'zod'
import {
  AlertSettingsPatchSchema,
  BannerScheduleEntrySchema,
  BannerTemplateSchema,
  RemoteSettingsPatchSchema,
  ScheduleEntrySchema,
  TelegramControlPatchSchema
} from './schema'
import type { Settings } from './types'

const presetId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)

/** Aksi preset. Ganti nama / duplikat / hapus selalu berlaku untuk preset AKTIF. */
export const PresetActionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('activate'), id: presetId }),
  z.object({ op: z.literal('create') }),
  z.object({ op: z.literal('duplicate') }),
  z.object({ op: z.literal('rename'), name: z.string().trim().min(1).max(80) }),
  z.object({ op: z.literal('delete') })
])
export type PresetAction = z.infer<typeof PresetActionSchema>

const RotationPatchSchema = z.object({ enabled: z.boolean(), intervalSec: z.number().int().min(10).max(86_400) }).partial()

/** Perubahan pengaturan dari toolbar wall (semua opsional, digabung dengan nilai sekarang). */
export const WallSettingsPatchSchema = z
  .object({
    displayMode: z.boolean(),
    pinned: z.boolean(),
    showBezel: z.boolean(),
    snap: z.boolean(),
    rotation: RotationPatchSchema
  })
  .partial()
  .strict()
export type WallSettingsPatch = z.infer<typeof WallSettingsPatchSchema>

/** Perubahan pengaturan dari jendela Operator (semua opsional, digabung dengan nilai sekarang). */
export const SettingsPatchSchema = z
  .object({
    /** null = otomatis (monitor utama dipakai operator bila ada lebih dari satu monitor). */
    excludePrimaryFromWall: z.boolean().nullable(),
    reloadIntervalHours: z.number().min(0).max(168),
    videoStallSeconds: z.number().int().min(5).max(300),
    maxTileMemoryMB: z.number().int().min(0).max(32768),
    ignoreCertErrorsAll: z.boolean(),
    mediaMtxEnabled: z.boolean(),
    /** Jalan otomatis saat login (pengaturan OS, bukan settings.json). */
    autostart: z.boolean(),
    wall: z
      .object({
        displayMode: z.boolean(),
        pinned: z.boolean(),
        showBezel: z.boolean(),
        snap: z.boolean(),
        rotation: RotationPatchSchema,
        schedule: ScheduleEntrySchema.array().max(48)
      })
      .partial()
      .strict(),
    bannerTemplates: BannerTemplateSchema.array().max(50),
    bannerSchedule: BannerScheduleEntrySchema.array().max(48),
    alerts: AlertSettingsPatchSchema,
    remote: RemoteSettingsPatchSchema,
    telegram: TelegramControlPatchSchema
  })
  .partial()
  .strict()
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

/**
 * Gabungkan patch ke pengaturan sekarang (`wall`, `wall.rotation`, `mediaMtx`, `alerts`, `remote`, dan `telegram` digabung,
 * bukan diganti).
 * `autostart` diabaikan di sini: itu pengaturan OS, bukan isi settings.json.
 */
export function mergeSettings(cur: Settings, patch: SettingsPatch): Settings {
  const { autostart: _autostart, mediaMtxEnabled, excludePrimaryFromWall, wall, alerts, remote, telegram, ...rest } = patch
  const next: Settings = { ...cur, ...rest }
  if (excludePrimaryFromWall === null) delete next.excludePrimaryFromWall
  else if (excludePrimaryFromWall !== undefined) next.excludePrimaryFromWall = excludePrimaryFromWall
  if (mediaMtxEnabled !== undefined) next.mediaMtx = { ...cur.mediaMtx, enabled: mediaMtxEnabled }
  if (alerts) next.alerts = { ...cur.alerts, ...alerts }
  if (remote) next.remote = { ...cur.remote, ...remote }
  if (telegram) next.telegram = { ...cur.telegram, ...telegram }
  if (wall) {
    const { rotation, ...wallRest } = wall
    next.wall = { ...cur.wall, ...wallRest, rotation: { ...cur.wall.rotation, ...rotation } }
  }
  return next
}
