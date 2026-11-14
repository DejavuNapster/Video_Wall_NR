import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type VideoApi } from '@shared/ipc'

/** Bridge minimal untuk halaman pemutar video lokal: ambil konfigurasi tile dan kirim heartbeat. */
const api: VideoApi = {
  getConfig: () => ipcRenderer.invoke(IPC.videoGetConfig),
  heartbeat: (beat) => ipcRenderer.send(IPC.videoHeartbeat, beat)
}

contextBridge.exposeInMainWorld('videoApi', api)
