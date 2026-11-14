import { app, type BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppState, AutostartStatus, LiveBanner, PlatformInfo, Preset, PresetMeta } from '@shared/types'
import { flags, platformWarnings } from './config'
import type { DisplayManager } from './displays'
import type { MediaMtxSidecar } from './sidecar'
import type { SettingsStore } from './store'
import type { WallController } from './wall'

export interface StateHubDeps {
  displays: DisplayManager
  wall: () => WallController
  sidecar: MediaMtxSidecar
  settings: SettingsStore
  platform: PlatformInfo
  getOperator: () => BrowserWindow | null
  /** Preset yang sedang tampil di wall. */
  active: () => Preset | null
  saveError: () => string | null
  autostart: () => AutostartStatus
  /** Banner darurat saat ini (null = tidak ada). */
  banner: () => LiveBanner | null
}

/** Mengumpulkan state aplikasi dan mengirimkannya ke UI operator (dibatasi ~5x per detik). */
export class StateHub {
  private presets: PresetMeta[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: StateHubDeps) {}

  get presetList(): PresetMeta[] {
    return this.presets
  }

  setPresets(metas: PresetMeta[]): void {
    this.presets = metas
    this.notify()
  }

  build(): AppState {
    const displays = this.deps.displays.list()
    const active = this.deps.active()
    return {
      presets: this.presets,
      activePresetId: active?.id ?? null,
      activePreset: active,
      displays,
      wallSlots: displays.filter((d) => d.slot !== null).length,
      tileStatus: this.deps.wall().statusSnapshot(),
      sidecar: {
        state: this.deps.sidecar.state,
        ...(this.deps.sidecar.message ? { message: this.deps.sidecar.message } : {})
      },
      settings: this.deps.settings.get(),
      windowed: flags.windowed,
      platform: this.deps.platform,
      warnings: platformWarnings(this.deps.platform),
      version: app.getVersion(),
      banner: this.deps.banner(),
      saveError: this.deps.saveError(),
      autostart: this.deps.autostart()
    }
  }

  notify(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      const win = this.deps.getOperator()
      if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
      win.webContents.send(IPC.stateChanged, this.build())
    }, 200)
  }
}
