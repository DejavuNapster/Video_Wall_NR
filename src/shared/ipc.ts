import type { AppState, Result, TileNavAction, VideoHeartbeat, VideoTileConfig, WallCommand, WallUiState } from './types'

/** Nama channel IPC. Satu sumber kebenaran agar main dan preload tidak beda ejaan. */
export const IPC = {
  getState: 'op:get-state',
  stateChanged: 'op:state-changed',
  preset: 'op:preset',
  edit: 'op:edit',
  reloadTile: 'op:reload-tile',
  identifyDisplays: 'op:identify-displays',
  showWalls: 'op:show-walls',
  setRtspPassword: 'op:set-rtsp-password',
  updateSettings: 'op:update-settings',
  bannerSet: 'op:banner:set',
  bannerClear: 'op:banner:clear',
  backupExport: 'op:backup:export',
  backupImport: 'op:backup:import',
  videoGetConfig: 'video:get-config',
  videoHeartbeat: 'video:heartbeat',
  wallGetState: 'wall:get-state',
  wallState: 'wall:state',
  wallCommand: 'wall:command',
  wallEdit: 'wall:edit',
  wallReloadTile: 'wall:reload-tile',
  wallTileNav: 'wall:tile-nav',
  wallPanelFullscreen: 'wall:panel-fullscreen',
  wallWindowFullscreen: 'wall:window-fullscreen',
  wallSetOverlay: 'wall:set-overlay',
  wallSetActiveTile: 'wall:set-active-tile',
  wallPreset: 'wall:preset',
  wallSettings: 'wall:settings',
  wallOpenOperator: 'wall:open-operator',
  wallQuit: 'wall:quit',
  wallBannerClose: 'wall:banner:close'
} as const

/** API yang diekspos ke UI jendela wall. Monitor ditentukan main dari jendela pengirim. */
export interface WallApi {
  getState(): Promise<WallUiState | null>
  onState(cb: (state: WallUiState) => void): () => void
  onCommand(cb: (cmd: WallCommand) => void): () => void
  edit(edit: unknown): Promise<Result<{ tileId?: string }>>
  /** Muat ulang halaman yang sedang terbuka di panel. */
  reloadTile(tileId: string): Promise<Result>
  /** Kembali / maju / ke URL panel / buka halaman ini di panel baru (hanya panel web). */
  tileNav(tileId: string, action: TileNavAction): Promise<Result>
  /** null = keluar dari layar penuh panel. */
  panelFullscreen(tileId: string | null): Promise<Result>
  /** undefined = toggle. */
  windowFullscreen(on?: boolean): Promise<Result>
  /** true = UI wall di atas semua tile (menu terbuka / sedang geser). */
  setOverlay(on: boolean): void
  setActiveTile(tileId: string | null): void
  /** Hanya `activate` yang dipakai toolbar wall; kelola preset lainnya ada di Operator. */
  preset(action: unknown): Promise<Result>
  settings(patch: unknown): Promise<Result>
  openOperator(): Promise<Result>
  quit(): Promise<Result>
  /** Tutup banner darurat dari tombol di wall (tidak berlaku untuk banner pinned). */
  closeBanner(): Promise<Result>
}

/** API yang diekspos ke UI operator lewat contextBridge. */
export interface OperatorApi {
  getState(): Promise<AppState>
  onState(cb: (state: AppState) => void): () => void
  /** Aktifkan / buat / duplikat / ganti nama / hapus preset (lihat PresetActionSchema). */
  preset(action: unknown): Promise<Result>
  /** Edit panel preset aktif di monitor `slot` (operasi sama dengan wall, lihat WallEditSchema). */
  edit(slot: number, edit: unknown): Promise<Result<{ tileId?: string }>>
  reloadTile(tileId: string): Promise<Result>
  identifyDisplays(): Promise<Result>
  /** Munculkan jendela wall di depan jendela lain (penting bila hanya ada satu monitor). */
  showWalls(): Promise<Result>
  setRtspPassword(tileId: string, password: string): Promise<Result<{ warning?: string }>>
  /** Patch pengaturan (lihat SettingsPatchSchema). */
  updateSettings(patch: unknown): Promise<Result>
  /** Tampilkan banner pengumuman darurat di semua monitor wall. */
  setBanner(banner: unknown): Promise<Result>
  /** Tutup banner darurat (dari operator; berlaku juga untuk banner pinned). */
  clearBanner(): Promise<Result>
  /** Ekspor semua preset + pengaturan ke satu file (dialog simpan). */
  backupExport(): Promise<Result<{ path: string }>>
  /** Pulihkan dari file backup (dialog buka) — divalidasi penuh sebelum diterapkan. */
  backupImport(): Promise<Result>
}

/** API yang diekspos ke halaman pemutar video lokal. */
export interface VideoApi {
  getConfig(): Promise<VideoTileConfig | null>
  heartbeat(beat: VideoHeartbeat): void
}
