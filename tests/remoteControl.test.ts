import { describe, expect, it, vi } from 'vitest'
import { type MonitorView, type WallControlDeps, WallRemoteControl } from '../src/main/remote/control'

const ok = { ok: true as const }

function setup(view: Partial<MonitorView> = {}, presetIds = ['a', 'b', 'c'], activeId: string | null = 'a') {
  const wall = {
    slotOfTile: vi.fn((id: string) => (id === 'luar' ? null : 1)),
    monitorView: vi.fn((slot: number) => (slot === 1 ? { panelFullscreenTileId: null, windowFullscreen: true, cyclePositions: {}, ...view } : null)),
    tileNav: vi.fn(() => ok),
    reloadTileInSlot: vi.fn(() => ok),
    setPanelFullscreen: vi.fn(() => ok),
    setWindowFullscreen: vi.fn(() => ok),
    stepTilePage: vi.fn(() => ok),
    reloadAllInSlot: vi.fn(() => ok),
    showWalls: vi.fn(),
    captureTileFrame: vi.fn(async () => ({ jpeg: Buffer.from([0xff, 0xd8]) })),
    sendTileInput: vi.fn(() => ok)
  }
  const deps = {
    wall,
    zoomTile: vi.fn(async () => ok),
    setSource: vi.fn(async () => ok),
    removeTile: vi.fn(async () => ok),
    presetIds: () => presetIds,
    activeId: () => activeId,
    activatePreset: vi.fn(async () => ok)
  } satisfies WallControlDeps
  return { ctl: new WallRemoteControl(deps), wall, deps }
}

describe('WallRemoteControl', () => {
  it('hapus panel memakai monitor tempat panel berada', async () => {
    const { ctl, deps } = setup()
    expect(await ctl.tile('t1', 'remove')).toEqual(ok)
    expect(deps.removeTile).toHaveBeenCalledWith(1, 't1')
    expect((await ctl.tile('luar', 'remove')).ok).toBe(false)
  })

  it('layar kendali hanya untuk panel di preset yang tampil', async () => {
    const { ctl, wall } = setup()
    expect(await ctl.screenFrame('t1', 800)).toHaveProperty('jpeg')
    expect(wall.captureTileFrame).toHaveBeenCalledWith('t1', 800)
    expect(await ctl.screenFrame('luar', 800)).toHaveProperty('error')
    expect(ctl.screenInput('t1', { kind: 'key', key: 'Enter' })).toEqual(ok)
    expect(wall.sendTileInput).toHaveBeenCalledWith('t1', { kind: 'key', key: 'Enter' })
    expect(ctl.screenInput('luar', { kind: 'key', key: 'Tab' }).ok).toBe(false)
    expect(wall.sendTileInput).toHaveBeenCalledTimes(1)
  })

  it('aksi panel diteruskan ke monitor tempat panel berada', async () => {
    const { ctl, wall, deps } = setup()
    await ctl.tile('t1', 'back')
    expect(wall.tileNav).toHaveBeenCalledWith(1, 't1', 'back')
    await ctl.tile('t1', 'newPanel')
    expect(wall.tileNav).toHaveBeenCalledWith(1, 't1', 'newPanel')
    await ctl.tile('t1', 'reload')
    expect(wall.reloadTileInSlot).toHaveBeenCalledWith(1, 't1')
    await ctl.tile('t1', 'zoomOut')
    expect(deps.zoomTile).toHaveBeenCalledWith(1, 't1', 'out')
    await ctl.tile('t1', 'nextPage')
    expect(wall.stepTilePage).toHaveBeenCalledWith(1, 't1', 1)
    await ctl.tile('t1', 'prevPage')
    expect(wall.stepTilePage).toHaveBeenCalledWith(1, 't1', -1)
  })

  it('layar penuh panel bersifat toggle', async () => {
    const off = setup()
    await off.ctl.tile('t1', 'fullscreen')
    expect(off.wall.setPanelFullscreen).toHaveBeenCalledWith(1, 't1')
    const on = setup({ panelFullscreenTileId: 't1' })
    await on.ctl.tile('t1', 'fullscreen')
    expect(on.wall.setPanelFullscreen).toHaveBeenCalledWith(1, null)
  })

  it('panel di luar preset aktif ditolak', async () => {
    const { ctl, wall } = setup()
    expect((await ctl.tile('luar', 'reload')).ok).toBe(false)
    expect((await ctl.setUrl('luar', 'https://a/')).ok).toBe(false)
    expect(wall.reloadTileInSlot).not.toHaveBeenCalled()
  })

  it('ganti URL memakai deteksi sumber yang sama dengan kolom URL di wall', async () => {
    const { ctl, deps } = setup()
    expect(await ctl.setUrl('t1', '  rtsp://kamera.lan/stream  ')).toEqual(ok)
    expect(deps.setSource).toHaveBeenCalledWith(1, 't1', 'rtsp://kamera.lan/stream')
    expect((await ctl.setUrl('t1', '   ')).ok).toBe(false)
  })

  it('aksi monitor hanya untuk monitor wall yang aktif', () => {
    const { ctl, wall } = setup()
    expect(ctl.monitor(1, 'show')).toEqual(ok)
    expect(wall.showWalls).toHaveBeenCalled()
    ctl.monitor(1, 'windowFullscreen')
    expect(wall.setWindowFullscreen).toHaveBeenCalledWith(1)
    ctl.monitor(1, 'exitPanelFullscreen')
    expect(wall.setPanelFullscreen).toHaveBeenCalledWith(1, null)
    ctl.monitor(1, 'reloadAll')
    expect(wall.reloadAllInSlot).toHaveBeenCalledWith(1)
    expect(ctl.monitor(0, 'show')).toMatchObject({ ok: false, error: 'Monitor 1 tidak aktif' })
  })

  it('preset sebelumnya/berikutnya berputar', async () => {
    const a = setup(undefined, ['a', 'b', 'c'], 'a')
    await a.ctl.stepPreset(-1)
    expect(a.deps.activatePreset).toHaveBeenCalledWith('c')
    const c = setup(undefined, ['a', 'b', 'c'], 'c')
    await c.ctl.stepPreset(1)
    expect(c.deps.activatePreset).toHaveBeenCalledWith('a')
    const single = setup(undefined, ['a'])
    expect((await single.ctl.stepPreset(1)).ok).toBe(false)
  })
})
