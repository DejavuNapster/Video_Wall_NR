import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type WallApi } from '@shared/ipc'
import type { WallCommand, WallUiState } from '@shared/types'

/** Bridge terbatas untuk UI jendela wall: hanya fungsi bernama, tanpa ipcRenderer mentah. */
const api: WallApi = {
  getState: () => ipcRenderer.invoke(IPC.wallGetState),
  onState: (cb) => {
    const listener = (_event: unknown, state: WallUiState): void => cb(state)
    ipcRenderer.on(IPC.wallState, listener)
    return () => ipcRenderer.removeListener(IPC.wallState, listener)
  },
  onCommand: (cb) => {
    const listener = (_event: unknown, cmd: WallCommand): void => cb(cmd)
    ipcRenderer.on(IPC.wallCommand, listener)
    return () => ipcRenderer.removeListener(IPC.wallCommand, listener)
  },
  edit: (edit) => ipcRenderer.invoke(IPC.wallEdit, edit),
  reloadTile: (tileId) => ipcRenderer.invoke(IPC.wallReloadTile, tileId),
  tileNav: (tileId, action) => ipcRenderer.invoke(IPC.wallTileNav, tileId, action),
  panelFullscreen: (tileId) => ipcRenderer.invoke(IPC.wallPanelFullscreen, tileId),
  windowFullscreen: (on) => ipcRenderer.invoke(IPC.wallWindowFullscreen, on ?? null),
  setOverlay: (on) => ipcRenderer.send(IPC.wallSetOverlay, on),
  setActiveTile: (tileId) => ipcRenderer.send(IPC.wallSetActiveTile, tileId),
  preset: (action) => ipcRenderer.invoke(IPC.wallPreset, action),
  settings: (patch) => ipcRenderer.invoke(IPC.wallSettings, patch),
  openOperator: () => ipcRenderer.invoke(IPC.wallOpenOperator),
  quit: () => ipcRenderer.invoke(IPC.wallQuit),
  closeBanner: () => ipcRenderer.invoke(IPC.wallBannerClose)
}

contextBridge.exposeInMainWorld('wallApi', api)
