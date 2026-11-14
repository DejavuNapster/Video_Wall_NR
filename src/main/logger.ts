import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { dataPath } from './config'

const MAX_BYTES = 5 * 1024 * 1024
let file: string | null = null

function ensureFile(): string | null {
  if (file) return file
  try {
    file = dataPath('logs', 'main.log')
    mkdirSync(dirname(file), { recursive: true })
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`)
    } catch {
      /* file belum ada */
    }
  } catch {
    file = null
  }
  return file
}

function write(level: 'INFO' | 'WARN' | 'ERROR', scope: string, message: string): void {
  const line = `${new Date().toISOString()} ${level} [${scope}] ${message}`
  if (level === 'ERROR') console.error(line)
  else console.log(line)
  const target = ensureFile()
  if (!target) return
  try {
    appendFileSync(target, `${line}\n`)
  } catch {
    /* log tidak boleh menjatuhkan aplikasi */
  }
}

export function createLogger(scope: string) {
  return {
    info: (msg: string) => write('INFO', scope, msg),
    warn: (msg: string) => write('WARN', scope, msg),
    error: (msg: string, err?: unknown) =>
      write('ERROR', scope, err instanceof Error ? `${msg}: ${err.stack ?? err.message}` : err ? `${msg}: ${String(err)}` : msg)
  }
}
