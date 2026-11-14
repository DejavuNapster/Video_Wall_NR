import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parsePreset } from '@shared/layout'
import { SettingsSchema } from '@shared/schema'
import type { Preset, PresetMeta, Result, Settings } from '@shared/types'

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/

export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id)
}

export async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** Tulis atomik (tmp + rename) supaya file tidak rusak bila listrik mati saat menulis. */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, file)
}

export class PresetStore {
  constructor(
    private readonly dir: string,
    private readonly stateFile: string
  ) {}

  private fileFor(id: string): string {
    if (!isSafeId(id)) throw new Error('ID preset tidak valid')
    return join(this.dir, `${id}.json`)
  }

  async list(): Promise<PresetMeta[]> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    const metas: PresetMeta[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -5)
      if (!isSafeId(id)) continue
      const preset = await this.get(id).catch(() => null)
      if (preset) metas.push({ id: preset.id, name: preset.name, updatedAt: preset.updatedAt })
    }
    return metas.sort((a, b) => a.name.localeCompare(b.name))
  }

  async get(id: string): Promise<Preset | null> {
    const raw = await readJson(this.fileFor(id)).catch(() => null)
    if (raw === null) return null
    const parsed = parsePreset(raw)
    return parsed.ok ? parsed.preset : null
  }

  async save(preset: Preset): Promise<void> {
    await writeJsonAtomic(this.fileFor(preset.id), preset)
  }

  async remove(id: string): Promise<void> {
    await rm(this.fileFor(id), { force: true })
  }

  async exists(id: string): Promise<boolean> {
    return (await this.get(id)) !== null
  }

  async getActiveId(): Promise<string | null> {
    const raw = (await readJson(this.stateFile).catch(() => null)) as { activePresetId?: unknown } | null
    return raw && isSafeId(raw.activePresetId) ? raw.activePresetId : null
  }

  async setActiveId(id: string | null): Promise<void> {
    await writeJsonAtomic(this.stateFile, { activePresetId: id })
  }
}

export class SettingsStore {
  private value: Settings = SettingsSchema.parse({})

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    const raw = await readJson(this.file).catch(() => null)
    const parsed = SettingsSchema.safeParse(raw ?? {})
    this.value = parsed.success ? parsed.data : SettingsSchema.parse({})
  }

  get(): Settings {
    return this.value
  }

  async update(patch: unknown): Promise<Result<{ settings: Settings }>> {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      return { ok: false, error: 'Patch pengaturan harus berupa objek' }
    }
    const merged = SettingsSchema.safeParse({ ...this.value, ...(patch as Record<string, unknown>) })
    if (!merged.success) {
      const issue = merged.error.issues[0]
      return { ok: false, error: `${issue?.message ?? 'Pengaturan tidak valid'} (${issue?.path.join('.') ?? ''})` }
    }
    this.value = merged.data
    await writeJsonAtomic(this.file, this.value)
    return { ok: true, settings: this.value }
  }

  /** Ganti seluruh pengaturan (restore backup) — validasi penuh, tulis atomik. */
  async replace(settings: Settings): Promise<Result> {
    const parsed = SettingsSchema.safeParse(settings)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return { ok: false, error: `${issue?.message ?? 'Pengaturan tidak valid'} (${issue?.path.join('.') ?? ''})` }
    }
    this.value = parsed.data
    await writeJsonAtomic(this.file, this.value)
    return { ok: true }
  }
}
