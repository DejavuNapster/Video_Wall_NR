import { app, type BrowserWindow, globalShortcut, Menu, powerSaveBlocker } from 'electron'
import { createDefaultPreset } from '@shared/layout'
import { hasEnabledSchedule } from '@shared/schedule'
import type { Result } from '@shared/types'
import { mergeSettings, type PresetAction, type SettingsPatch } from '@shared/wallPayloads'
import { ActivePresetService } from './activePreset'
import { autostartStatus, setAutostart } from './autostart'
import { BackupService } from './backupService'
import { BannerController } from './banner'
import { dataPath, detectPlatform, flags } from './config'
import { CredentialVault } from './credentials'
import { DisplayManager } from './displays'
import { registerHandlers } from './handlers'
import { createLogger } from './logger'
import { createOperatorWindow, forceCloseOperator } from './operator'
import { RotationController } from './rotation'
import { ScheduleController } from './schedule'
import { MediaMtxSidecar } from './sidecar'
import { StateHub } from './state'
import { PresetStore, SettingsStore } from './store'
import { WallController } from './wall'
import { registerWallHandlers } from './wallHandlers'

const log = createLogger('main')

// ---- Switch Chromium: harus diset sebelum event 'ready' ------------------------------------
const features: string[] = []
// Decode video via VA-API di Linux (Chromium baru mungkin sudah mengaktifkannya; flag tak dikenal diabaikan).
if (process.platform === 'linux' && process.env['VW_NO_GPU_FLAGS'] !== '1') features.push('AcceleratedVideoDecodeLinuxGL')
if (process.env['VW_ENABLE_FEATURES']) {
  features.push(
    ...process.env['VW_ENABLE_FEATURES']
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
}
if (features.length > 0) app.commandLine.appendSwitch('enable-features', features.join(','))
// Windows: Chromium menghentikan animasi/requestAnimationFrame (halaman "hidden") bila menganggap jendela
// tertutup jendela lain, dan status ini bisa terlambat pulih saat wall kembali di depan. Video wall harus
// selalu berjalan (juga agar tile video tidak dianggap macet oleh watchdog), jadi deteksi ini dimatikan.
if (process.platform === 'win32') app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// Catatan: --ozone-platform HARUS diberikan lewat command line (launcher/.desktop), bukan di sini.

process.on('uncaughtException', (err) => log.error('uncaughtException', err))
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason))

let operatorWin: BrowserWindow | null = null
let shuttingDown = false
/** Wall di-pin (selalu di atas)? Operator lalu diberi tingkat yang sama agar tidak tertutup wall. */
let wallPinned = (): boolean => false

/** Tampilkan Operator atas permintaan pengguna (menu wall, Ctrl+Alt+O, instance kedua). */
function showOperator(): void {
  if (!operatorWin || operatorWin.isDestroyed()) operatorWin = createOperatorWindow(true)
  operatorWin.setAlwaysOnTop(wallPinned())
  if (operatorWin.isMinimized()) operatorWin.restore()
  operatorWin.show()
  operatorWin.focus()
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null)

  const settings = new SettingsStore(dataPath('settings.json'))
  await settings.load()
  wallPinned = () => settings.get().wall.pinned
  const presets = new PresetStore(dataPath('presets'), dataPath('state.json'))
  const vault = new CredentialVault(dataPath('credentials.json'))
  const displays = new DisplayManager(() => settings.get().excludePrimaryFromWall)
  const sidecar = new MediaMtxSidecar(() => settings.get())
  const backup = new BackupService({ appVersion: app.getVersion(), presets, settings })

  // Komponen saling membutuhkan; referensi diisi berurutan di bawah dan hanya dipakai lewat callback.
  let hub: StateHub | null = null
  let service: ActivePresetService | null = null
  let rotation: RotationController | null = null
  let schedule: ScheduleController | null = null
  let banner: BannerController | null = null

  /**
   * Prioritas: jadwal berbasis jam lebih kuat daripada rotasi interval. Selama ada minimal satu entri
   * jadwal aktif, rotasi interval dijeda. Dipanggil ulang setiap preset/aktivasi/pengaturan berubah.
   */
  const rebalanceTimers = (): void => {
    schedule?.restart()
    if (hasEnabledSchedule(settings.get().wall.schedule)) rotation?.stop()
    else rotation?.restart()
  }

  const wall = new WallController({
    displays,
    sidecar,
    vault,
    getSettings: () => settings.get(),
    onChange: () => hub?.notify(),
    uiExtras: () => ({ presets: hub?.presetList ?? [], saveError: service?.saveError ?? null }),
    banner: () => banner?.get() ?? null
  })
  hub = new StateHub({
    displays,
    wall: () => wall,
    sidecar,
    settings,
    platform: detectPlatform(),
    getOperator: () => operatorWin,
    active: () => service?.current ?? null,
    saveError: () => service?.saveError ?? null,
    autostart: autostartStatus,
    banner: () => banner?.get() ?? null
  })
  sidecar.on('state', () => hub?.notify())
  banner = new BannerController({
    onChange: () => {
      hub?.notify()
      // Banner aktif/ditutup -> sembunyikan/tampilkan tile semua monitor sebelum UI diperbarui.
      wall.syncBannerVisibility()
      wall.notifyUi()
    }
  })

  const refreshList = async (): Promise<void> => {
    hub?.setPresets(await presets.list())
    rotation?.presetsChanged()
    rebalanceTimers()
    wall.notifyUi()
  }

  service = new ActivePresetService({
    presets,
    wall,
    vault,
    wallSlots: () => displays.wallDisplays().length,
    onChange: () => {
      hub?.notify()
      wall.notifyUi()
      rebalanceTimers()
    },
    refreshList
  })
  const svc = service
  // Monitor baru dicolok (atau monitor utama dilepas dari operator): beri layout kosong di preset aktif.
  displays.on('changed', () => void svc.ensureSlots())

  rotation = new RotationController({
    settings: () => settings.get(),
    presetIds: () => hub?.presetList.map((p) => p.id) ?? [],
    activeId: () => svc.activeId,
    activate: (id) => svc.activate(id)
  })

  schedule = new ScheduleController({
    entries: () => settings.get().wall.schedule,
    activeId: () => svc.activeId,
    activate: (id) => svc.activate(id)
  })

  const presetAction = (action: PresetAction): Promise<Result> => {
    switch (action.op) {
      case 'activate':
        return svc.activate(action.id)
      case 'create':
        return svc.createNew('empty')
      case 'duplicate':
        return svc.createNew('duplicate')
      case 'rename':
        return svc.rename(action.name)
      case 'delete':
        return svc.deleteActive()
    }
  }

  /** Simpan patch pengaturan lalu terapkan efeknya: pin, Mode Atur/Tampil, sertifikat, monitor, rotasi, jadwal. */
  const applySettings = async (patch: SettingsPatch): Promise<Result> => {
    const cur = settings.get()
    const res = await settings.replace(mergeSettings(cur, patch))
    if (!res.ok) return res
    if (patch.mediaMtxEnabled !== undefined && patch.mediaMtxEnabled !== cur.mediaMtx.enabled) {
      void sidecar
        .stop()
        .then(() => sidecar.start())
        .catch((err) => log.error('MediaMTX gagal start ulang', err))
    }
    const auto = patch.autostart === undefined ? ({ ok: true } as const) : await setAutostart(patch.autostart)
    await wall.onSettingsChanged()
    await svc.ensureSlots()
    rebalanceTimers()
    hub?.notify()
    return auto
  }

  /** Beritahu jendela wall bila aksi shortcut gagal. */
  const report = (slot: number, res: Result): void => {
    if (!res.ok) wall.sendCommand(slot, { type: 'notice', kind: 'error', text: res.error })
  }

  wall.setActions({
    toggleDisplayMode: () => void applySettings({ wall: { displayMode: !settings.get().wall.displayMode } }),
    toggleRotation: () => {
      const enabled = !settings.get().wall.rotation.enabled
      void applySettings({ wall: { rotation: { enabled } } }).then(() => {
        const text = enabled ? 'Rotasi preset dinyalakan (berjalan di Mode Tampil)' : 'Rotasi preset dimatikan'
        for (const d of displays.wallDisplays()) if (d.slot !== null) wall.sendCommand(d.slot, { type: 'notice', kind: 'ok', text })
      })
    },
    zoomTile: (slot, tileId, dir) => {
      const tile = svc.current?.monitors.find((m) => m.slot === slot)?.tiles.find((t) => t.id === tileId)
      if (tile?.source.type !== 'web') return
      const step = dir === 'in' ? 0.1 : -0.1
      const zoom = dir === 'reset' ? 1 : Math.min(5, Math.max(0.25, Math.round((tile.source.zoom + step) * 100) / 100))
      if (zoom !== tile.source.zoom) void svc.edit(slot, { op: 'setZoom', tileId, zoom }).then((r) => report(slot, r))
    },
    activatePresetIndex: (index) => {
      const id = hub?.presetList[index]?.id
      if (id) void svc.activate(id)
    },
    openNewTab: (slot, url, fromTileId) => {
      void (async () => {
        // Link target=_blank / window.open / tombol "buka di panel baru": panel baru di monitor yang sama
        // (monitor penuh → panel asal dibelah dua).
        const added = await svc.edit(slot, { op: 'addTile', near: fromTileId })
        if (!added.ok) return report(slot, { ok: false, error: `Tab baru: ${added.error}` })
        if (!added.tileId) return
        const src = await svc.edit(slot, { op: 'setSource', tileId: added.tileId, input: url })
        if (!src.ok) report(slot, { ok: false, error: `Tab baru: ${src.error}` })
      })()
    }
  })

  registerHandlers({
    getOperator: () => operatorWin,
    vault,
    wall,
    displays,
    service: svc,
    hub,
    banner,
    backup,
    presetAction,
    applySettings,
    afterRestore: async () => {
      const metas = await presets.list()
      const target = metas.find((m) => m.id === svc.activeId)?.id ?? metas[0]?.id
      if (target) await svc.activate(target)
      await refreshList()
      await wall.onSettingsChanged()
      rebalanceTimers()
    }
  })
  registerWallHandlers({
    wall,
    service: svc,
    banner,
    presetAction,
    updateWallSettings: (patch) => applySettings({ wall: patch }),
    showOperator
  })

  displays.start()
  wall.start()
  // Saat startup, --hide-operator membuat Operator dibuat tersembunyi (kiosk); dibuka nanti lewat menu wall / Ctrl+Alt+O.
  // Satu monitor (Operator berbagi layar dengan wall): Operator hanya di taskbar supaya wall langsung terlihat.
  const sharesWallDisplay = displays.list().some((d) => d.primary && d.slot !== null)
  operatorWin = createOperatorWindow(flags.startHidden ? false : sharesWallDisplay ? 'minimized' : true)
  // Operator yang diminimalkan tetap memegang fokus keyboard; serahkan ke wall agar shortcut wall langsung jalan.
  if (sharesWallDisplay) operatorWin.once('minimize', () => wall.showWalls())
  void sidecar.start().catch((err) => log.error('MediaMTX gagal start', err))

  // Preset awal: bila belum ada, buat preset default sesuai jumlah monitor wall.
  let metas = await presets.list()
  if (metas.length === 0) {
    await presets.save(createDefaultPreset(displays.wallDisplays().length, 'default', 'Preset Default'))
    metas = await presets.list()
  }
  hub.setPresets(metas)

  const savedId = await presets.getActiveId()
  const candidates = [...new Set([savedId, ...metas.map((m) => m.id)].filter((id): id is string => !!id))]
  for (const id of candidates) {
    const res = await svc.activate(id)
    if (res.ok) break
    log.warn(`preset awal "${id}" tidak bisa dimuat: ${res.error}`)
  }

  if (!flags.windowed) powerSaveBlocker.start('prevent-display-sleep')
  if (sharesWallDisplay) wall.showWalls()

  // Pintasan global: tampilkan operator / keluar (berguna saat wall fullscreen menutupi semua monitor).
  globalShortcut.register('CommandOrControl+Alt+O', showOperator)
  globalShortcut.register('CommandOrControl+Alt+W', () => wall.showWalls())
  globalShortcut.register('CommandOrControl+Alt+Q', () => app.quit())

  app.on('before-quit', (event) => {
    if (shuttingDown) return
    shuttingDown = true
    event.preventDefault()
    globalShortcut.unregisterAll()
    displays.stop()
    rotation?.stop()
    schedule?.stop()
    banner?.stop()
    // Simpan perubahan wall yang masih tertunda sebelum menutup.
    void svc
      .flush()
      .catch(() => undefined)
      .then(() => Promise.allSettled([wall.shutdown(), sidecar.stop()]))
      .finally(() => {
        forceCloseOperator(operatorWin)
        app.quit()
      })
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showOperator)
  app.on('window-all-closed', () => app.quit())
  void app.whenReady().then(bootstrap).catch((err) => {
    log.error('bootstrap gagal', err)
    app.exit(1)
  })
}
