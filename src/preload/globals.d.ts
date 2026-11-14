import type { OperatorApi, VideoApi, WallApi } from '../shared/ipc'

declare global {
  interface Window {
    operatorApi: OperatorApi
    videoApi: VideoApi
    wallApi: WallApi
  }
}

export {}
