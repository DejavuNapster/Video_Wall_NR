import { useEffect, useRef, useState } from 'react'
import { TEMPLATES, templateRemovals } from '@shared/templates'
import type { WallUiState } from '@shared/types'
import { useWall } from '../store'

/**
* Menu tarik-turun. Selama terbuka, UI wall dinaikkan ke atas tile (overlay) supaya menu tidak
* tertutup isi panel; klik di luar menu menutupnya.
*/
export function Dropdown({
 id,
 label,
 title,
 align = 'left',
 className,
 children
}: {
 id: string
 label: React.ReactNode
 title?: string
 align?: 'left' | 'right'
 className?: string
 children: (close: () => void) => React.ReactNode
}): React.JSX.Element {
 const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
 const ref = useRef<HTMLButtonElement | null>(null)
 const holdOverlay = useWall((s) => s.holdOverlay)
 const open = pos !== null

 useEffect(() => {
   holdOverlay(`menu:${id}`, open)
   return () => holdOverlay(`menu:${id}`, false)
 }, [id, open, holdOverlay])

 const toggle = (): void => {
   if (open) return setPos(null)
   const r = ref.current?.getBoundingClientRect()
   if (r) setPos({ x: align === 'right' ? window.innerWidth - r.right : r.left, y: r.bottom + 4 })
 }
 const close = (): void => setPos(null)

 return (
   <>
     <button ref={ref} title={title} onClick={toggle} className={className}>
       {label}
     </button>
     {open && (
       <>
         <div className="fixed inset-0 z-40" onMouseDown={close} />
         <div
           style={{ position: 'fixed', top: pos.y, ...(align === 'right' ? { right: pos.x } : { left: pos.x }), maxHeight: window.innerHeight - pos.y - 8 }}
           className="z-50 min-w-56 overflow-auto rounded-md border border-slate-700 bg-slate-900 p-1 text-sm text-slate-200 shadow-xl"
         >
           {children(close)}
         </div>
       </>
     )}
   </>
 )
}

const itemBase = 'flex w-full gap-2 rounded px-3 py-1.5 text-left hover:bg-slate-800 disabled:opacity-40'
const item = `${itemBase} items-center`

export function LayoutMenu({ state, className }: { state: WallUiState; className: string }): React.JSX.Element {
 const run = useWall((s) => s.run)
 const monitor = state.monitor
 return (
   <Dropdown id="layout" label="Layout ▾" title="Susun panel dengan layout siap pakai" className={className}>
     {(close) =>
       TEMPLATES.map((t) => (
         <button
           key={t.id}
           className={item}
           disabled={!monitor}
           onClick={() => {
             close()
             if (!monitor) return
             const removed = templateRemovals(monitor, t.id)
             if (removed.length > 0) {
               const names = removed.map((id) => monitor.tiles.find((x) => x.id === id)?.label || id).join(', ')
               if (!window.confirm(`Layout "${t.label}" hanya memuat ${t.rects.length} panel.\nPanel berikut akan dihapus: ${names}\n\nLanjutkan?`)) return
             }
             void run(window.wallApi.edit({ op: 'applyTemplate', template: t.id }))
           }}
         >
           {t.label}
         </button>
       ))
     }
   </Dropdown>
 )
}

const SHORTCUTS: Array<[string, string]> = [
 ['Ctrl+E', 'Mode Atur / Mode Tampil'],
 ['Ctrl+1…9', 'Pindah preset'],
 ['Ctrl+Spasi', 'Jalankan / jeda rotasi'],
 ['Ctrl+Tab', 'Panel aktif berikutnya'],
 ['Ctrl + / − / 0', 'Zoom panel aktif'],
 ['Ctrl+roda mouse', 'Zoom panel'],
 ['Ctrl+L', 'Ubah URL panel aktif'],
 ['F5 / Ctrl+R', 'Muat ulang halaman panel'],
 ['Alt+← / Alt+→', 'Kembali / maju (juga tombol mouse)'],
 ['Alt+Home', 'Kembali ke URL panel'],
 ['F11', 'Layar penuh panel aktif'],
 ['Esc', 'Keluar layar penuh panel / batal geser'],
 ['F10', 'Layar penuh jendela'],
 ['Alt saat geser', 'Matikan magnet'],
 ['Ctrl+Alt+O', 'Tampilkan Operator (global)'],
 ['Ctrl+Alt+W', 'Tampilkan wall di depan (global)'],
 ['Ctrl+Alt+Q', 'Keluar aplikasi (global)']
]

export function SettingsMenu({ className }: { className: string }): React.JSX.Element {
 const run = useWall((s) => s.run)
 return (
   <Dropdown id="settings" label="☰" title="Menu: Operator, shortcut, keluar" align="right" className={className}>
     {(close) => (
       <div className="w-80">
         <button
           className={item}
           onClick={() => {
             close()
             void run(window.wallApi.openOperator())
           }}
         >
           Buka Operator
           <span className="ml-auto font-mono text-[11px] text-slate-500">Ctrl+Alt+O</span>
         </button>
         <div className="px-3 pb-1 text-[11px] text-slate-500">
           Kelola preset, rotasi &amp; jadwal, banner pengumuman, dan pengaturan aplikasi di jendela Operator.
         </div>
         <div className="my-1 border-t border-slate-800" />
         <div className="px-3 py-1 text-xs font-semibold text-slate-300">Shortcut</div>
         <dl className="px-3 pb-1 text-xs">
           {SHORTCUTS.map(([k, v]) => (
             <div key={k} className="flex justify-between gap-3 py-0.5">
               <dt className="shrink-0 font-mono text-sky-300">{k}</dt>
               <dd className="text-right text-slate-400">{v}</dd>
             </div>
           ))}
         </dl>
         <div className="my-1 border-t border-slate-800" />
         <button
           className={`${item} text-red-300`}
           onClick={() => {
             close()
             if (window.confirm('Keluar dari Video Wall Browser? Semua monitor wall akan ditutup.')) void run(window.wallApi.quit())
           }}
         >
           Keluar aplikasi
         </button>
       </div>
     )}
   </Dropdown>
 )
}
