import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { Result, TileNavAction } from '@shared/types'
import { WallEditSchema } from '@shared/wallEdits'
import { PresetActionSchema, type PresetAction, type WallSettingsPatch, WallSettingsPatchSchema } from '@shared/wallPayloads'
import type { ActivePresetService } from './activePreset'
import type { BannerController } from './banner'
import { zodError } from './handlers'
import { createLogger } from './logger'
import { isSafeId } from './store'
import type { WallController } from './wall'
import { wallUiSlots } from './wallUi'

const log = createLogger('ipc-wall')

export interface WallHandlerDeps {
  wall: WallController
  service: ActivePresetService
  banner: BannerController
  presetAction: (action: PresetAction) => Promise<Result>
  updateWallSettings: (patch: WallSettingsPatch) => Promise<Result>
  showOperator: () => void
}

const NAV_ACTIONS: readonly unknown[] = ['back', 'forward', 'home', 'newPanel'] satisfies TileNavAction[]

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

/**
 * IPC dari UI jendela wall. Hanya UI wall yang terdaftar (frame utama) yang diterima, dan slot monitor
 * SELALU diambil dari pengirim — jendela monitor 1 tidak bisa mengubah panel di monitor 2.
 */
export function registerWallHandlers(d: WallHandlerDeps): void {
  const slotOf = (event: IpcMainInvokeEvent | IpcMainEvent): number | null => {
    if (event.senderFrame !== event.sender.mainFrame) return null
    return wallUiSlots.get(event.sender.id) ?? null
  }
  const handle = <T>(channel: string, fn: (slot: number, ...args: unknown[]) => Promise<T> | T): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      const slot = slotOf(event)
      if (slot === null) throw new Error('Pengirim IPC tidak sah')
      try {
        return await fn(slot, ...args)
      } catch (err) {
        log.error(`handler ${channel} gagal`, err)
        return fail(err instanceof Error ? err.message : String(err))
      }
    })
  }
  const on = (channel: string, fn: (slot: number, ...args: unknown[]) => void): void => {
    ipcMain.on(channel, (event, ...args) => {
      const slot = slotOf(event)
      if (slot !== null) fn(slot, ...args)
    })
  }

  handle(IPC.wallGetState, (slot) => d.wall.uiState(slot))

  handle(IPC.wallEdit, (slot, raw) => {
    const parsed = WallEditSchema.safeParse(raw)
    return parsed.success ? d.service.edit(slot, parsed.data) : fail(zodError(parsed.error.issues))
  })

  handle(IPC.wallReloadTile, (slot, tileId): Result => {
    if (!isSafeId(tileId)) return fail('ID panel tidak valid')
    return d.wall.reloadTileInSlot(slot, tileId)
  })

  handle(IPC.wallTileNav, (slot, tileId, action): Result => {
    if (!isSafeId(tileId)) return fail('ID panel tidak valid')
    if (!NAV_ACTIONS.includes(action)) return fail('Aksi navigasi tidak dikenal')
    return d.wall.tileNav(slot, tileId, action as TileNavAction)
  })

  handle(IPC.wallPanelFullscreen, (slot, tileId): Result => {
    if (tileId !== null && !isSafeId(tileId)) return fail('ID panel tidak valid')
    return d.wall.setPanelFullscreen(slot, tileId)
  })

  handle(IPC.wallWindowFullscreen, (slot, on): Result => {
    if (on !== undefined && on !== null && typeof on !== 'boolean') return fail('Nilai tidak valid')
    return d.wall.setWindowFullscreen(slot, typeof on === 'boolean' ? on : undefined)
  })

  on(IPC.wallSetOverlay, (slot, value) => {
    if (typeof value === 'boolean') d.wall.setOverlay(slot, value)
  })

  on(IPC.wallSetActiveTile, (slot, tileId) => {
    if (tileId === null || isSafeId(tileId)) d.wall.setActiveTile(slot, tileId)
  })

  handle(IPC.wallPreset, (_slot, raw) => {
    const parsed = PresetActionSchema.safeParse(raw)
    return parsed.success ? d.presetAction(parsed.data) : fail(zodError(parsed.error.issues))
  })

  handle(IPC.wallSettings, (_slot, raw) => {
    const parsed = WallSettingsPatchSchema.safeParse(raw)
    return parsed.success ? d.updateWallSettings(parsed.data) : fail(zodError(parsed.error.issues))
  })

  handle(IPC.wallOpenOperator, (): Result => {
    d.showOperator()
    return { ok: true }
  })

  // Hanya banner non-pinned yang boleh ditutup dari tombol di wall.
  handle(IPC.wallBannerClose, (): Result => (d.banner.closeFromWall() ? { ok: true } : fail('Banner tidak aktif atau di-pin')))

  handle(IPC.wallQuit, (): Result => {
    setImmediate(() => app.quit())
    return { ok: true }
  })
}
