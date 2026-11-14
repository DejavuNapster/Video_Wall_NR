import { duplicatePreset, ensureMonitors, slugify, uniqueId } from '@shared/editor'
import { createDefaultPreset, parsePreset } from '@shared/layout'
import type { EditResult, Preset, Result } from '@shared/types'
import { detectSource, splitRtspCredentials } from '@shared/urlDetect'
import { applyWallEdit, setTileSource, type WallEdit } from '@shared/wallEdits'
import type { CredentialVault } from './credentials'
import { createLogger } from './logger'
import type { PresetStore } from './store'
import type { WallController } from './wall'

const log = createLogger('preset')
const SAVE_DELAY_MS = 500

export interface ActivePresetDeps {
  presets: PresetStore
  wall: WallController
  vault: CredentialVault
  /** Jumlah monitor wall saat ini (preset dilengkapi layout kosong untuk monitor baru). */
  wallSlots: () => number
  /** Preset aktif, daftar preset, atau status simpan berubah. */
  onChange: () => void
  /** Muat ulang daftar preset dari disk (setelah buat/hapus/ganti nama). */
  refreshList: () => Promise<void>
}

/**
 * Satu-satunya pemegang preset aktif. Edit dari wall (dan simpan dari Operator) masuk ke sini,
 * divalidasi, langsung diterapkan ke wall, lalu disimpan otomatis ke disk (ditunda & digabung).
 */
export class ActivePresetService {
  private preset: Preset | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private saveTimer: NodeJS.Timeout | null = null
  private dirty = false
  private nameChanged = false
  /** Pesan bila penyimpanan otomatis terakhir gagal (ditampilkan di toolbar wall). */
  saveError: string | null = null
  /** Naik setiap preset aktif berubah (operator memakainya untuk memuat ulang draft). */
  revision = 0

  constructor(private readonly d: ActivePresetDeps) {}

  get current(): Preset | null {
    return this.preset
  }

  get activeId(): string | null {
    return this.preset?.id ?? null
  }

  /** Jalankan berurutan supaya dua edit cepat tidak saling menimpa. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  activate(id: string): Promise<Result> {
    return this.serial(async () => {
      await this.flushNow()
      const loaded = await this.d.presets.get(id)
      if (!loaded) return { ok: false, error: 'Preset tidak ditemukan atau rusak' }
      await this.install(loaded)
      await this.d.presets.setActiveId(loaded.id)
      return { ok: true }
    })
  }

  /** Operator menyimpan preset yang sedang aktif: versi itu menjadi dasar dan langsung tampil di wall. */
  adopt(preset: Preset): Promise<void> {
    return this.serial(async () => {
      if (this.preset?.id !== preset.id) return
      this.cancelSave()
      await this.install(preset)
    })
  }

  edit(slot: number, edit: WallEdit): Promise<Result<{ tileId?: string }>> {
    return this.serial(async () => {
      const base = this.preset
      if (!base) return { ok: false, error: 'Belum ada preset aktif' }

      let res: EditResult
      if (edit.op === 'setSource' || edit.op === 'setSourceConfig') {
        const current = base.monitors.find((m) => m.slot === slot)?.tiles.find((t) => t.id === edit.tileId)
        if (!current) return { ok: false, error: 'Panel tidak ditemukan di monitor ini' }
        // setSource: teks dari kolom URL (jenis dideteksi). setSourceConfig: jenis dipilih eksplisit di Inspector.
        const detected = edit.op === 'setSource' ? detectSource(edit.input, current.source) : { ok: true as const, ...splitRtspCredentials(edit.source) }
        if (!detected.ok) return detected
        res = setTileSource(base, slot, edit.tileId, detected.source)
        if (res.ok) {
          // Password RTSP tidak pernah masuk ke file preset.
          if (detected.password !== undefined) await this.d.vault.set(edit.tileId, detected.password)
          else if (detected.source.type !== 'rtsp') await this.d.vault.remove(edit.tileId)
        }
      } else {
        res = applyWallEdit(base, slot, edit)
        if (res.ok && edit.op === 'removeTile') await this.d.vault.remove(edit.tileId)
      }
      if (!res.ok) return res

      const parsed = parsePreset(res.preset)
      if (!parsed.ok) return { ok: false, error: parsed.error }
      await this.install(parsed.preset)
      this.scheduleSave()
      return res.tileId ? { ok: true, tileId: res.tileId } : { ok: true }
    })
  }

  rename(name: string): Promise<Result> {
    return this.serial(async () => {
      if (!this.preset) return { ok: false, error: 'Belum ada preset aktif' }
      if (name === this.preset.name) return { ok: true }
      await this.install({ ...this.preset, name })
      this.nameChanged = true
      this.scheduleSave()
      return { ok: true }
    })
  }

  /** Buat preset baru (kosong 2x2 per monitor) atau salinan preset aktif, lalu aktifkan. */
  createNew(kind: 'empty' | 'duplicate'): Promise<Result> {
    return this.serial(async () => {
      await this.flushNow()
      const existing = (await this.d.presets.list()).map((p) => p.id)
      let preset: Preset
      if (kind === 'duplicate' && this.preset) {
        const name = `${this.preset.name} (salinan)`.slice(0, 80)
        preset = duplicatePreset(this.preset, uniqueId(slugify(name), existing), name)
      } else {
        preset = createDefaultPreset(this.d.wallSlots(), uniqueId('preset-baru', existing), 'Preset Baru')
      }
      await this.d.presets.save(preset)
      await this.install(preset)
      await this.d.presets.setActiveId(preset.id)
      await this.d.refreshList()
      return { ok: true }
    })
  }

  /** Hapus preset aktif lalu pindah ke preset berikutnya. Preset terakhir tidak bisa dihapus. */
  deleteActive(): Promise<Result> {
    return this.serial(async () => {
      const current = this.preset
      if (!current) return { ok: false, error: 'Belum ada preset aktif' }
      const list = await this.d.presets.list()
      const others = list.filter((p) => p.id !== current.id)
      if (others.length === 0) return { ok: false, error: 'Preset terakhir tidak bisa dihapus' }
      const index = list.findIndex((p) => p.id === current.id)
      const nextMeta = list[index + 1] ?? others[0]!
      const next = await this.d.presets.get(nextMeta.id)
      if (!next) return { ok: false, error: `Preset "${nextMeta.name}" rusak; tidak bisa pindah ke sana` }
      this.cancelSave()
      await this.install(next)
      await this.d.presets.setActiveId(next.id)
      await this.d.presets.remove(current.id)
      await this.d.refreshList()
      return { ok: true }
    })
  }

  /** Jumlah monitor wall bertambah: lengkapi preset aktif dengan layout kosong untuk monitor baru. */
  ensureSlots(): Promise<void> {
    return this.serial(async () => {
      if (!this.preset) return
      const full = ensureMonitors(this.preset, this.d.wallSlots())
      if (full === this.preset) return
      await this.install(full)
      this.scheduleSave()
    })
  }

  /** Tulis perubahan yang tertunda sekarang (dipanggil sebelum keluar aplikasi / restore backup). */
  flush(): Promise<void> {
    return this.serial(() => this.flushNow())
  }

  // ---------------------------------------------------------------- internal

  private async install(preset: Preset): Promise<void> {
    const full = ensureMonitors(preset, this.d.wallSlots())
    this.preset = full
    this.revision++
    await this.d.wall.apply(full)
    this.d.onChange()
  }

  private cancelSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.dirty = false
  }

  private scheduleSave(): void {
    this.dirty = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.serial(() => this.flushNow())
    }, SAVE_DELAY_MS)
  }

  private async flushNow(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (!this.dirty || !this.preset) return
    try {
      await this.d.presets.save({ ...this.preset, updatedAt: new Date().toISOString() })
      this.dirty = false
      if (this.saveError) {
        this.saveError = null
        this.d.onChange()
      }
      if (this.nameChanged) {
        this.nameChanged = false
        await this.d.refreshList()
      }
    } catch (err) {
      // Wall tetap berjalan dengan preset di memori; dicoba lagi pada perubahan berikutnya.
      this.saveError = `Gagal menyimpan: ${err instanceof Error ? err.message : String(err)}`
      log.error('simpan otomatis gagal', err)
      this.d.onChange()
    }
  }
}
