/**
 * Pemutar tile video (halaman lokal milik app, satu per tile).
 *  - whep : WebRTC via WHEP (latensi terendah); gagal berulang -> fallback HLS bila tersedia
 *  - hls  : hls.js (atau HLS native bila didukung)
 *  - mjpeg: <img> langsung
 * Heartbeat dikirim ke main process tiap 2 dtk; main me-reload tile bila frame berhenti maju.
 */
import Hls from 'hls.js'
import { backoffDelay } from '@shared/backoff'
import type { VideoHeartbeat, VideoTileConfig } from '@shared/types'

type Teardown = () => void

const stage = document.getElementById('stage') as HTMLDivElement
const msg = document.getElementById('msg') as HTMLDivElement

function setMessage(text: string): void {
  msg.textContent = text
}

function createVideo(): HTMLVideoElement {
  const v = document.createElement('video')
  v.muted = true
  v.autoplay = true
  v.playsInline = true
  v.disablePictureInPicture = true
  stage.replaceChildren(v)
  return v
}

let lastError: string | undefined
let heartbeatSource: () => Omit<VideoHeartbeat, 'error'> = () => ({ progress: 0, playing: false })

setInterval(() => {
  const { progress, playing } = heartbeatSource()
  window.videoApi.heartbeat({ progress, playing, ...(lastError ? { error: lastError } : {}) })
}, 2000)

async function playWhep(video: HTMLVideoElement, url: string, onFail: (err: Error) => void): Promise<Teardown> {
  const pc = new RTCPeerConnection({ iceServers: [] })
  let resourceUrl: string | null = null
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    pc.close()
    if (resourceUrl) fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined)
  }
  pc.addTransceiver('video', { direction: 'recvonly' })
  pc.addTransceiver('audio', { direction: 'recvonly' })
  pc.ontrack = (ev) => {
    const stream = ev.streams[0]
    if (stream && video.srcObject !== stream) video.srcObject = stream
  }
  pc.onconnectionstatechange = () => {
    if (closed) return
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
      close()
      onFail(new Error(`Koneksi WebRTC ${pc.connectionState}`))
    }
  }

  await pc.setLocalDescription(await pc.createOffer())
  // Tunggu ICE gathering selesai (maks 2 dtk) supaya offer berisi kandidat lengkap.
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve()
    const t = setTimeout(resolve, 2000)
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t)
        resolve()
      }
    }
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: pc.localDescription?.sdp ?? ''
  })
  if (!res.ok) {
    close()
    throw new Error(`WHEP HTTP ${res.status}`)
  }
  const location = res.headers.get('Location')
  if (location) resourceUrl = new URL(location, url).toString()
  await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() })
  return close
}

function playHls(video: HTMLVideoElement, url: string, onFail: (err: Error) => void): Teardown {
  if (Hls.isSupported()) {
    const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 2, maxLiveSyncPlaybackRate: 1.2, enableWorker: true })
    hls.loadSource(url)
    hls.attachMedia(video)
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
      else {
        hls.destroy()
        onFail(new Error(`HLS fatal: ${data.details}`))
      }
    })
    return () => hls.destroy()
  }
  video.src = url
  video.onerror = () => onFail(new Error('HLS native gagal'))
  return () => video.removeAttribute('src')
}

function playMjpeg(config: VideoTileConfig): void {
  const img = document.createElement('img')
  stage.replaceChildren(img)
  let ticks = 0
  img.onerror = () => {
    lastError = 'MJPEG gagal dimuat'
    setMessage(lastError)
  }
  img.onload = () => setMessage('')
  img.src = config.playUrl
  heartbeatSource = () => ({ progress: ++ticks, playing: img.complete && img.naturalWidth > 0 })
}

async function run(config: VideoTileConfig): Promise<void> {
  if (config.kind === 'mjpeg') return playMjpeg(config)

  const video = createVideo()
  heartbeatSource = () => ({ progress: video.currentTime, playing: !video.paused && video.readyState >= 2 })

  let attempt = 0
  let mode: 'whep' | 'hls' = config.kind === 'hls' ? 'hls' : 'whep'
  let teardown: Teardown | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  video.addEventListener('playing', () => {
    attempt = 0
    lastError = undefined
    setMessage('')
  })

  const schedule = (err: Error): void => {
    lastError = err.message
    setMessage(`${err.message} - mencoba ulang...`)
    teardown?.()
    teardown = null
    attempt += 1
    // WebRTC gagal berulang (mis. mesin tanpa interface jaringan): pindah ke HLS dari MediaMTX.
    if (mode === 'whep' && config.fallbackHlsUrl && attempt >= 3) mode = 'hls'
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = setTimeout(() => void start(), backoffDelay(attempt - 1))
  }

  const start = async (): Promise<void> => {
    try {
      if (mode === 'whep') teardown = await playWhep(video, config.playUrl, schedule)
      else teardown = playHls(video, config.kind === 'hls' ? config.playUrl : (config.fallbackHlsUrl ?? config.playUrl), schedule)
      await video.play().catch(() => undefined)
    } catch (err) {
      schedule(err instanceof Error ? err : new Error(String(err)))
    }
  }
  await start()
}

void window.videoApi.getConfig().then((config) => {
  if (!config) {
    setMessage('Panel belum dikonfigurasi')
    return
  }
  void run(config)
})
