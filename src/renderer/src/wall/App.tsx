import { useEffect, useState } from 'react'
import { panelGeometry, stripHeight, TOOLBAR_H, wallArea } from '@shared/panelGeometry'
import { BannerOverlay } from './components/BannerOverlay'
import { Panel } from './components/Panel'
import { Toast } from './components/Toast'
import { Toolbar } from './components/Toolbar'
import { useWall } from './store'
import { usePanelDrag } from './useDrag'
import { focusUrlInput } from './urlInputs'

function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const onResize = (): void => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/**
 * Lapisan UI satu jendela wall. Posisi bilah/bingkai dihitung dengan fungsi yang sama dengan main
 * (panelGeometry), sehingga selalu sejajar dengan WebContentsView tile di bawah/atasnya.
 */
export function App(): React.JSX.Element | null {
  const state = useWall((s) => s.state)
  const pendingFocus = useWall((s) => s.pendingFocusTile)
  const size = useWindowSize()
  const { preview, begin } = usePanelDrag(size)

  useEffect(() => useWall.getState().init(), [])

  // Fokuskan kolom URL begitu panelnya tampil (setelah + Panel atau Ctrl+L).
  useEffect(() => {
    if (pendingFocus && focusUrlInput(pendingFocus)) useWall.getState().focusUrlLater(null)
  }, [pendingFocus, state])

  if (!state) return null
  const displayMode = state.wall.displayMode
  const edit = !displayMode
  // Banner mode strip: area wall bergeser turun setinggi strip agar panel tak menumpuk di atasnya.
  const stripInset = state.banner && state.banner.banner.mode === 'strip' ? stripHeight(size) : 0
  const fullscreenPanel = state.panelFullscreenTileId !== null
  const bannerEl = state.banner ? (
    <BannerOverlay banner={state.banner} top={edit && !fullscreenPanel ? TOOLBAR_H : 0} playSound={state.slot === 0} />
  ) : null
  // Panel layar penuh menutupi seluruh jendela: tidak ada yang perlu digambar di lapisan UI.
  if (fullscreenPanel) return (
    <>
      <Toast displayMode />
      {bannerEl}
    </>
  )

  const monitor = state.monitor
  const area = wallArea(size, edit, stripInset)

  return (
    <>
      {edit && <Toolbar state={state} />}

      {monitor && edit && state.wall.showBezel && (monitor.bezel.cols > 1 || monitor.bezel.rows > 1) && (
        <>
          {Array.from({ length: monitor.bezel.cols - 1 }, (_, i) => (
            <div
              key={`bc${i}`}
              className="pointer-events-none absolute w-0.5 bg-amber-400/80"
              style={{ left: area.x + (area.width * (i + 1)) / monitor.bezel.cols - 1, top: area.y, height: area.height }}
            />
          ))}
          {Array.from({ length: monitor.bezel.rows - 1 }, (_, i) => (
            <div
              key={`br${i}`}
              className="pointer-events-none absolute h-0.5 bg-amber-400/80"
              style={{ top: area.y + (area.height * (i + 1)) / monitor.bezel.rows - 1, left: area.x, width: area.width }}
            />
          ))}
        </>
      )}

      {monitor?.tiles.map((tile) => (
        <Panel
          key={tile.id}
          tile={tile}
          geo={panelGeometry(tile, monitor, size, edit, stripInset)}
          status={state.tileStatus[tile.id]}
          active={state.activeTileId === tile.id}
          edit={edit}
          onBeginDrag={begin}
        />
      ))}

      {monitor && edit && !monitor.tiles.length && (
        <div
          className="absolute flex flex-col items-center justify-center gap-1 text-center"
          style={{ left: area.x, top: area.y, width: area.width, height: area.height }}
        >
          <span className="text-sm text-sky-300/90">Monitor ini belum punya panel</span>
          <span className="text-xs text-sky-300/70">Klik "+ Panel" atau pilih Layout di toolbar</span>
        </div>
      )}

      {preview && monitor && (
        <div
          className={`pointer-events-none absolute rounded-sm border-2 ${
            preview.valid ? 'border-sky-400 bg-sky-400/15' : 'border-red-500 bg-red-500/20'
          }`}
          style={(() => {
            const f = panelGeometry(preview.rect, monitor, size, true, stripInset).frame
            return { left: f.x, top: f.y, width: f.width, height: f.height }
          })()}
        />
      )}

      <Toast displayMode={displayMode} />
      {bannerEl}
    </>
  )
}
