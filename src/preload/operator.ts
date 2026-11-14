import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type OperatorApi } from '@shared/ipc'
import type { AppState } from '@shared/types'

/** Bridge terbatas untuk UI operator: hanya fungsi bernama, tanpa ipcRenderer mentah. */
const api: OperatorApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: (cb) => {
    const listener = (_event: unknown, state: AppState): void => cb(state)
    ipcRenderer.on(IPC.stateChanged, listener)
    return () => ipcRenderer.removeListener(IPC.stateChanged, listener)
  },
  preset: (action) => ipcRenderer.invoke(IPC.preset, action),
  edit: (slot, edit) => ipcRenderer.invoke(IPC.edit, slot, edit),
  reloadTile: (tileId) => ipcRenderer.invoke(IPC.reloadTile, tileId),
  identifyDisplays: () => ipcRenderer.invoke(IPC.identifyDisplays),
  showWalls: () => ipcRenderer.invoke(IPC.showWalls),
  setRtspPassword: (tileId, password) => ipcRenderer.invoke(IPC.setRtspPassword, tileId, password),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  setBanner: (banner) => ipcRenderer.invoke(IPC.bannerSet, banner),
  clearBanner: () => ipcRenderer.invoke(IPC.bannerClear),
  backupExport: () => ipcRenderer.invoke(IPC.backupExport),
  backupImport: () => ipcRenderer.invoke(IPC.backupImport),
  thumbnails: () => ipcRenderer.invoke(IPC.thumbnails),
  setRemotePassword: (password) => ipcRenderer.invoke(IPC.setRemotePassword, password),
  setTelegramToken: (token) => ipcRenderer.invoke(IPC.setTelegramToken, token),
  testAlert: () => ipcRenderer.invoke(IPC.testAlert)
}

contextBridge.exposeInMainWorld('operatorApi', api)
