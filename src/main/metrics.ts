import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dataPath } from './config'

const MAX_BYTES = 50 * 1024 * 1024
const HEADER = 'timestamp,slot,tile_id,type,state,memory_mb,cpu_percent,restarts\n'
let file: string | null = null

export interface MetricsRow {
  slot: number
  tileId: string
  type: string
  state: string
  memoryMB?: number
  cpuPercent?: number
  restarts: number
}

/**
 * Catat metrik per tile ke userData/logs/metrics.csv (dipanggil tiap 10 dtk).
 * Dipakai untuk soak test 24 jam: plot kolom memory_mb per tile untuk melihat tren kebocoran memori.
 */
export async function appendMetrics(rows: readonly MetricsRow[]): Promise<void> {
  if (rows.length === 0) return
  try {
    file ??= dataPath('logs', 'metrics.csv')
    await mkdir(dirname(file), { recursive: true })
    let needsHeader = false
    try {
      if ((await stat(file)).size > MAX_BYTES) {
        await rename(file, `${file}.1`)
        needsHeader = true
      }
    } catch {
      needsHeader = true // file belum ada
    }
    const ts = new Date().toISOString()
    const body = rows
      .map((r) => [ts, r.slot, r.tileId, r.type, r.state, r.memoryMB ?? '', r.cpuPercent ?? '', r.restarts].join(','))
      .join('\n')
    await appendFile(file, `${needsHeader ? HEADER : ''}${body}\n`)
  } catch {
    /* metrik tidak boleh menjatuhkan aplikasi */
  }
}
