// Halaman kendali jarak jauh Video Wall NR (dilayani server lokal aplikasi, tanpa dependensi).
// Semua teks dari server dimasukkan lewat textContent, tidak pernah sebagai HTML.
;(() => {
  'use strict'

  const STATE_MS = 3000
  const THUMB_MS = 5000
  const STATE_LABEL = {
    ok: 'Berjalan',
    loading: 'Memuat',
    idle: 'Menunggu',
    failed: 'Gagal',
    crashed: 'Crash',
    stalled: 'Beku',
    unresponsive: 'Tidak merespons'
  }
  const $ = (id) => document.getElementById(id)
  const LIVE_TYPES = new Set(['web', 'rtsp', 'hls', 'whep', 'mjpeg'])
  let state = null
  let thumbs = {}
  let timers = []
  /** Panel yang tombol kendalinya sedang terbuka. */
  let selectedTile = null
  /** Panel yang menunggu ketukan kedua untuk dihapus. */
  let confirmRemove = null
  let confirmTimer = 0

  // ------------------------------------------------------------ util
  function el(tag, attrs, children) {
    const node = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') node.textContent = v
      else if (k === 'onclick') node.addEventListener('click', v)
      else if (k === 'onsubmit') node.addEventListener('submit', v)
      else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : String(v))
    }
    for (const c of children || []) if (c) node.append(c)
    return node
  }

  let toastTimer = 0
  function toast(text, isError) {
    const t = $('toast')
    t.textContent = text
    t.className = isError ? 'toast error' : 'toast'
    t.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (t.hidden = true), isError ? 6000 : 3000)
  }

  async function api(path, body) {
    const init = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-vwnr': '1' }, body: JSON.stringify(body) }
    const res = await fetch(path, { credentials: 'same-origin', ...init })
    let data = {}
    try {
      data = await res.json()
    } catch {
      /* respons kosong */
    }
    if (res.status === 401 && path !== '/api/login') {
      showLogin()
      throw new Error(data.error || 'Sesi berakhir')
    }
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  }

  async function act(path, body, okText) {
    try {
      await api(path, body)
      if (okText) toast(okText)
      await refreshState()
    } catch (err) {
      toast(err.message, true)
    }
  }

  // ------------------------------------------------------------ login
  function showLogin() {
    timers.forEach(clearInterval)
    timers = []
    closeScreen()
    $('app').hidden = true
    $('login').hidden = false
    $('password').focus()
  }

  $('login').addEventListener('submit', async (e) => {
    e.preventDefault()
    $('login-error').textContent = ''
    try {
      await api('/api/login', { password: $('password').value })
      $('password').value = ''
      startApp()
    } catch (err) {
      $('login-error').textContent = err.message
    }
  })

  $('logout').addEventListener('click', async () => {
    await api('/api/logout', {}).catch(() => undefined)
    showLogin()
  })

  // ------------------------------------------------------------ app
  function startApp() {
    $('login').hidden = true
    $('app').hidden = false
    void refreshState()
    void refreshThumbs()
    timers = [setInterval(refreshState, STATE_MS), setInterval(refreshThumbs, THUMB_MS)]
  }

  async function refreshState() {
    if (document.hidden) return
    try {
      state = await api('/api/state')
      render()
    } catch {
      /* ditampilkan saat aksi pengguna */
    }
  }

  async function refreshThumbs() {
    if (document.hidden || !state) return
    try {
      thumbs = (await api('/api/thumbnails')).thumbnails || {}
      for (const img of document.querySelectorAll('img[data-tile]')) {
        const src = thumbs[img.dataset.tile]
        if (src) img.src = src
      }
    } catch {
      /* abaikan */
    }
  }

  function render() {
    const s = state
    $('host').textContent = `${s.host} · v${s.version}`

    const dm = $('display-mode')
    dm.textContent = s.displayMode ? 'Mode Tampil (aktif)' : 'Mode Atur (aktif)'
    dm.className = s.displayMode ? 'on' : ''
    const rot = $('rotation')
    rot.textContent = s.rotation ? 'Rotasi preset: nyala' : 'Rotasi preset: mati'
    rot.className = s.rotation ? 'on' : ''
    $('schedule-note').hidden = !(s.rotation && s.scheduleActive)

    const active = s.presets.find((p) => p.id === s.activePresetId)
    $('preset-name').textContent = active ? active.name : '-'
    $('preset-prev').disabled = $('preset-next').disabled = s.presets.length < 2
    $('presets').replaceChildren(
      ...s.presets.map((p) =>
        el('button', {
          type: 'button',
          class: p.id === s.activePresetId ? 'on' : '',
          text: p.name,
          onclick: () => p.id !== s.activePresetId && act('/api/preset', { id: p.id }, `Preset "${p.name}" ditampilkan`)
        })
      )
    )

    $('banner-live').hidden = !s.banner
    if (s.banner) {
      $('banner-live-text').textContent = s.banner.title ? `${s.banner.title}: ${s.banner.text}` : s.banner.text
      $('banner-live-info').textContent = s.banner.durationSec > 0 ? `Hilang otomatis setelah ${Math.round(s.banner.durationSec / 60)} menit` : 'Tampil sampai ditutup'
    }
    $('templates').replaceChildren(
      ...(s.templates.length
        ? s.templates.map((t) => el('button', { type: 'button', text: t.name, onclick: () => act('/api/banner/template', { id: t.id }, `Banner "${t.name}" ditampilkan`) }))
        : [el('p', { class: 'muted small', text: 'Belum ada templat banner. Simpan templat dari jendela Operator › Banner.' })])
    )
    const themeSel = $('qb-theme')
    if (!themeSel.options.length) {
      for (const t of s.themes) themeSel.append(el('option', { value: t.id, text: t.label }))
    }

    // Jangan menggambar ulang saat kolom URL sedang diketik (isinya akan hilang).
    const focused = document.activeElement
    const exists = (id) => s.monitors.some((m) => m.tiles.some((t) => t.id === id))
    if (screenTile && (!s.screenControl || !exists(screenTile.id))) {
      closeScreen()
      toast(s.screenControl ? 'Panel tidak lagi tampil di wall' : 'Kendali layar dimatikan dari Operator', true)
    }
    if (focused && focused.tagName === 'INPUT' && $('monitors').contains(focused)) return
    if (selectedTile && !exists(selectedTile)) selectedTile = null
    $('monitors').replaceChildren(...s.monitors.map(renderMonitor))
  }

  const tileAct = (t, action, okText) => act('/api/tile/action', { id: t.id, action }, okText)
  const monitorAct = (m, action, okText) => act('/api/monitor/action', { slot: m.slot, action }, okText)

  function renderMonitor(m) {
    return el('div', { class: 'monitor' }, [
      el('div', { class: 'monitor-head' }, [
        el('h3', { text: `Monitor ${m.slot + 1}` }),
        el('div', { class: 'row compact' }, [
          el('button', { type: 'button', text: 'Tampilkan wall', title: 'Munculkan jendela wall di depan aplikasi lain', onclick: () => monitorAct(m, 'show', 'Wall ditampilkan') }),
          el('button', {
            type: 'button',
            class: m.windowFullscreen ? 'on' : '',
            text: m.windowFullscreen ? 'Layar penuh: nyala' : 'Layar penuh: mati',
            title: 'Layar penuh jendela wall (F10)',
            onclick: () => monitorAct(m, 'windowFullscreen')
          }),
          el('button', { type: 'button', text: 'Muat ulang semua', onclick: () => monitorAct(m, 'reloadAll', `Semua panel monitor ${m.slot + 1} dimuat ulang`) }),
          m.panelFullscreenTileId
            ? el('button', { type: 'button', class: 'danger', text: 'Keluar layar penuh panel', onclick: () => monitorAct(m, 'exitPanelFullscreen') })
            : null
        ])
      ]),
      el('div', { class: 'tiles' }, m.tiles.length ? m.tiles.map((t) => renderTile(m, t)) : [el('p', { class: 'muted small', text: 'Belum ada panel' })])
    ])
  }

  function renderTile(m, t) {
    const live = LIVE_TYPES.has(t.type)
    const thumb = thumbs[t.id]
    const selected = selectedTile === t.id
    const full = m.panelFullscreenTileId === t.id
    const dotClass = t.state === 'ok' ? 'ok' : t.state === 'loading' ? 'loading' : t.state && t.state !== 'idle' ? 'bad' : ''
    const toggle = () => {
      // Safari iOS tidak memindahkan fokus ke tombol: lepas fokus kolom URL supaya render() tidak dilewati.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      selectedTile = selected ? null : t.id
      render()
    }
    const preview = thumb
      ? el('img', { class: 'thumb', alt: '', src: thumb, 'data-tile': t.id })
      : live
        ? el('img', { class: 'thumb', alt: '', 'data-tile': t.id })
        : el('div', { class: 'thumb empty', text: t.summary })
    return el('div', { class: `tile${selected ? ' selected' : ''}${full ? ' full' : ''}` }, [
      el('button', { type: 'button', class: 'tile-head', 'aria-expanded': String(selected), 'aria-label': `Kendali panel ${t.summary}`, onclick: toggle }, [
        preview,
        full ? el('span', { class: 'badge', text: 'Layar penuh' }) : null
      ]),
      el('div', { class: 'meta' }, [
        el('i', { class: `dot ${dotClass}`, title: STATE_LABEL[t.state] || '' }),
        el('span', { text: t.summary, title: t.summary }),
        live ? el('button', { type: 'button', text: '⟳', title: 'Muat ulang', 'aria-label': 'Muat ulang', onclick: () => tileAct(t, 'reload', 'Panel dimuat ulang') }) : null,
        el('button', { type: 'button', class: selected ? 'on' : '', text: selected ? 'Tutup' : 'Kendali', onclick: toggle })
      ]),
      t.error ? el('div', { class: 'err', text: t.error }) : null,
      selected ? renderPad(m, t, live, full) : null
    ])
  }

  /** Tombol kendali satu panel (setara bilah panel dan shortcut di wall). */
  function renderPad(m, t, live, full) {
    const web = t.type === 'web'
    const btn = (text, title, onclick, attrs) => el('button', { type: 'button', text, title, 'aria-label': title, onclick, ...(attrs || {}) })
    const rows = []
    if (web) {
      rows.push(
        el('div', { class: 'pad-row' }, [
          btn('← Kembali', 'Halaman sebelumnya', () => tileAct(t, 'back'), { disabled: !t.canGoBack }),
          btn('Maju →', 'Halaman berikutnya', () => tileAct(t, 'forward'), { disabled: !t.canGoForward }),
          btn('⌂ Beranda', 'Kembali ke URL panel', () => tileAct(t, 'home', 'Kembali ke URL panel')),
          btn('⟳ Muat ulang', 'Muat ulang halaman', () => tileAct(t, 'reload', 'Panel dimuat ulang'))
        ])
      )
    }
    if (live) {
      rows.push(
        el('div', { class: 'pad-row' }, [
          btn(full ? 'Keluar layar penuh' : '⛶ Layar penuh', 'Panel memenuhi monitor (F11)', () => tileAct(t, 'fullscreen'), { class: full ? 'on' : '' }),
          web ? btn('⧉ Buka di panel baru', 'Buka halaman ini di panel baru', () => tileAct(t, 'newPanel', 'Halaman dibuka di panel baru')) : null
        ])
      )
    }
    if (web) {
      rows.push(
        el('div', { class: 'pad-row zoom' }, [
          el('span', { class: 'muted small', text: 'Zoom' }),
          btn('−', 'Perkecil', () => tileAct(t, 'zoomOut')),
          el('strong', { text: `${Math.round((t.zoom || 1) * 100)}%` }),
          btn('+', 'Perbesar', () => tileAct(t, 'zoomIn')),
          btn('100%', 'Zoom normal', () => tileAct(t, 'zoomReset'))
        ])
      )
      if (t.cycle) {
        rows.push(
          el('div', { class: 'pad-row zoom' }, [
            el('span', { class: 'muted small', text: 'Rotasi halaman' }),
            btn('‹', 'Halaman rotasi sebelumnya', () => tileAct(t, 'prevPage')),
            el('strong', { text: `${t.cycle.index}/${t.cycle.total}` }),
            btn('›', 'Halaman rotasi berikutnya', () => tileAct(t, 'nextPage'))
          ])
        )
      }
    }
    const input = el('input', { type: 'text', inputmode: 'url', autocomplete: 'off', placeholder: 'https://…', 'aria-label': 'URL baru', value: web ? t.url : '' })
    rows.push(
      el(
        'form',
        {
          class: 'pad-url',
          onsubmit: (e) => {
            e.preventDefault()
            const url = input.value.trim()
            if (!url) return
            input.blur()
            void act('/api/tile/url', { id: t.id, url }, 'URL panel diganti')
          }
        },
        [
          el('label', { class: 'small muted', text: web ? 'Ganti URL panel' : 'Isi panel dengan URL / alamat kamera' }),
          el('div', { class: 'row' }, [input, el('button', { type: 'submit', class: 'primary', text: 'Buka' })])
        ]
      )
    )
    if (web && t.pageUrl && t.pageUrl !== t.url) rows.push(el('p', { class: 'muted small page-url', text: `Sedang terbuka: ${t.pageUrl}` }))

    const confirming = confirmRemove === t.id
    rows.push(
      el('div', { class: 'pad-row' }, [
        web && state.screenControl ? btn('🖱 Kendalikan layar', 'Klik, gulir, dan ketik langsung di panel ini', () => openScreen(t), { class: 'primary' }) : null,
        btn(confirming ? 'Ketuk lagi untuk menghapus' : '🗑 Hapus panel', 'Hapus panel ini dari wall', () => removeTile(t), { class: confirming ? 'danger' : '' })
      ])
    )
    if (web && !state.screenControl) {
      rows.push(el('p', { class: 'muted small pad-note', text: 'Kendali layar belum diizinkan. Aktifkan di Operator › Pengaturan › Kendali jarak jauh.' }))
    }
    return el('div', { class: 'pad' }, rows)
  }

  /** Hapus panel dengan dua ketukan supaya tidak terhapus karena salah sentuh. */
  function removeTile(t) {
    clearTimeout(confirmTimer)
    if (confirmRemove !== t.id) {
      confirmRemove = t.id
      confirmTimer = setTimeout(() => {
        confirmRemove = null
        render()
      }, 4000)
      return render()
    }
    confirmRemove = null
    selectedTile = null
    void act('/api/tile/action', { id: t.id, action: 'remove' }, 'Panel dihapus')
  }

  // ------------------------------------------------------------ layar kendali
  /** Jeda antara dua gambar layar; gambar berikutnya baru diminta setelah gambar sebelumnya tiba. */
  const FRAME_GAP_MS = 80
  const RETRY_MS = 1500
  /** Geseran lebih dari ini (px) dianggap gulir/seret, bukan ketukan. */
  const MOVE_PX = 8
  const DOUBLE_TAP_MS = 350
  let screenTile = null
  /**
   * Ukuran gambar terakhir yang tampil (0 = belum ada). naturalWidth tidak bisa dipakai langsung: bernilai 0 sesaat
   * setiap gambar berikutnya dimuat, padahal gambar sebelumnya masih terlihat.
   */
  let frameSize = { w: 0, h: 0 }
  let frameTimer = 0
  let frameSeq = 0
  let dragMode = false
  let gesture = null
  let lastTap = { at: 0, x: 0, y: 0 }
  let inputQueue = Promise.resolve()

  function openScreen(t) {
    screenTile = { id: t.id, summary: t.summary }
    $('screen-title').textContent = t.summary
    $('screen-status').textContent = 'Memuat layar panel…'
    $('screen-img').removeAttribute('src')
    frameSize = { w: 0, h: 0 }
    $('screen').hidden = false
    document.body.classList.add('screen-open')
    nextFrame()
  }

  function closeScreen() {
    screenTile = null
    gesture = null
    clearTimeout(frameTimer)
    $('screen').hidden = true
    document.body.classList.remove('screen-open')
  }

  function nextFrame() {
    clearTimeout(frameTimer)
    if (!screenTile || document.hidden) return
    const view = $('screen-img').parentElement
    const w = Math.min(1920, Math.max(320, Math.round(view.clientWidth * (window.devicePixelRatio || 1))))
    $('screen-img').src = `/api/tile/screen?id=${encodeURIComponent(screenTile.id)}&w=${w}&n=${++frameSeq}`
  }

  $('screen-img').addEventListener('load', () => {
    const i = $('screen-img')
    frameSize = { w: i.naturalWidth, h: i.naturalHeight }
    $('screen-status').textContent = ''
    frameTimer = setTimeout(nextFrame, FRAME_GAP_MS)
  })
  $('screen-img').addEventListener('error', async () => {
    if (!screenTile) return
    // Ambil pesan galat dari server (panel tersembunyi, belum diizinkan, sesi berakhir, …).
    try {
      const res = await fetch(`/api/tile/screen?id=${encodeURIComponent(screenTile.id)}&w=320`, { credentials: 'same-origin' })
      if (res.status === 401) return showLogin()
      const data = res.ok ? {} : await res.json().catch(() => ({}))
      $('screen-status').textContent = data.error || ''
    } catch {
      $('screen-status').textContent = 'Koneksi ke wall terputus, mencoba lagi…'
    }
    frameTimer = setTimeout(nextFrame, RETRY_MS)
  })

  /** Kirim masukan berurutan (urutan klik/gulir harus sama dengan urutan sentuhan). */
  function sendInput(input) {
    if (!screenTile) return
    const id = screenTile.id
    inputQueue = inputQueue
      .then(() => api('/api/tile/input', { id, input }))
      .catch((err) => toast(err.message, true))
  }

  /** Area gambar panel di layar (gambar diperbesar/diperkecil agar pas, dengan bingkai kosong di sisinya). */
  function frameRect() {
    const r = $('screen-img').getBoundingClientRect()
    const scale = Math.min(r.width / frameSize.w, r.height / frameSize.h)
    const width = frameSize.w * scale
    const height = frameSize.h * scale
    return { left: r.left + (r.width - width) / 2, top: r.top + (r.height - height) / 2, width, height }
  }

  /** Posisi sentuhan relatif terhadap gambar panel (0..1). */
  function relPos(e) {
    const r = frameRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    }
  }

  const img = $('screen-img')
  img.addEventListener('contextmenu', (e) => e.preventDefault())
  img.addEventListener('pointerdown', (e) => {
    if (!frameSize.w) return
    const r = frameRect()
    if (e.clientX < r.left || e.clientX > r.left + r.width || e.clientY < r.top || e.clientY > r.top + r.height) return
    e.preventDefault()
    try {
      img.setPointerCapture(e.pointerId)
    } catch {
      /* sebagian browser menolak; gerakan tetap terbaca selama jari di atas gambar */
    }
    gesture = { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, start: relPos(e), moved: false, dragging: false, lastMove: 0, flush: 0, dx: 0, dy: 0 }
  })
  img.addEventListener('pointermove', (e) => {
    const g = gesture
    if (!g || g.id !== e.pointerId) return
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < MOVE_PX) return
    g.moved = true
    const r = frameRect()
    if (dragMode) {
      if (!g.dragging) {
        g.dragging = true
        sendInput({ kind: 'drag', phase: 'start', ...g.start })
      }
      const now = Date.now()
      if (now - g.lastMove >= 40) {
        g.lastMove = now
        sendInput({ kind: 'drag', phase: 'move', ...relPos(e) })
      }
    } else {
      // Kumpulkan geseran lalu kirim paling sering setiap 50 ms.
      g.dx += (e.clientX - g.lx) / r.width
      g.dy += (e.clientY - g.ly) / r.height
      if (!g.flush) g.flush = setTimeout(() => flushScroll(g), 50)
    }
    g.lx = e.clientX
    g.ly = e.clientY
  })

  function flushScroll(g) {
    clearTimeout(g.flush)
    g.flush = 0
    if (!g.dx && !g.dy) return
    sendInput({ kind: 'scroll', ...g.start, dx: g.dx, dy: g.dy })
    g.dx = g.dy = 0
  }

  function endGesture(e, cancelled) {
    const g = gesture
    if (!g || g.id !== e.pointerId) return
    gesture = null
    if (g.dragging) return sendInput({ kind: 'drag', phase: 'end', ...relPos(e) })
    if (g.moved) return flushScroll(g)
    if (cancelled) return
    const now = Date.now()
    const double = now - lastTap.at < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30
    lastTap = double ? { at: 0, x: 0, y: 0 } : { at: now, x: e.clientX, y: e.clientY }
    sendInput({ kind: 'tap', ...g.start, count: double ? 2 : 1 })
  }
  img.addEventListener('pointerup', (e) => endGesture(e, false))
  img.addEventListener('pointercancel', (e) => endGesture(e, true))
  // Roda mouse (kendali dari komputer lain): gulir ke arah yang sama seperti di browser biasa.
  img.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      if (!frameSize.w) return
      const r = frameRect()
      sendInput({ kind: 'scroll', ...relPos(e), dx: -e.deltaX / r.width, dy: -e.deltaY / r.height })
    },
    { passive: false }
  )

  $('screen-mode').addEventListener('click', () => {
    dragMode = !dragMode
    $('screen-mode').textContent = dragMode ? 'Geser: seret' : 'Geser: gulir'
    $('screen-mode').className = dragMode ? 'on' : ''
  })
  for (const b of document.querySelectorAll('#screen [data-key]')) {
    b.addEventListener('click', () => sendInput({ kind: 'key', key: b.dataset.key }))
  }
  function sendText(withEnter) {
    const text = $('screen-text').value
    if (text) sendInput({ kind: 'text', text })
    if (withEnter) sendInput({ kind: 'key', key: 'Enter' })
    $('screen-text').value = ''
  }
  $('screen-type').addEventListener('submit', (e) => {
    e.preventDefault()
    sendText(false)
  })
  $('screen-send-enter').addEventListener('click', () => sendText(true))
  $('screen-close').addEventListener('click', closeScreen)

  $('preset-prev').addEventListener('click', () => act('/api/preset/step', { dir: -1 }))
  $('preset-next').addEventListener('click', () => act('/api/preset/step', { dir: 1 }))
  $('display-mode').addEventListener('click', () => act('/api/display-mode', { on: !state.displayMode }))
  $('rotation').addEventListener('click', () => act('/api/rotation', { enabled: !state.rotation }))
  $('banner-clear').addEventListener('click', () => act('/api/banner/clear', {}, 'Banner ditutup'))

  $('quick-banner').addEventListener('submit', (e) => {
    e.preventDefault()
    const theme = state.themes.find((t) => t.id === $('qb-theme').value) || state.themes[0]
    const banner = {
      title: theme.title,
      text: $('qb-text').value.trim(),
      bgColor: theme.bg,
      fgColor: theme.fg,
      durationSec: Number($('qb-duration').value),
      mode: $('qb-strip').checked ? 'strip' : 'cover',
      sound: $('qb-sound').checked
    }
    if (!banner.text) return
    void act('/api/banner', banner, 'Banner ditampilkan di wall').then(() => ($('qb-text').value = ''))
  })

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !$('app').hidden) {
      void refreshState()
      void refreshThumbs()
      nextFrame()
    }
  })

  // ------------------------------------------------------------ mulai
  api('/api/session')
    .then((r) => (r.authenticated ? startApp() : showLogin()))
    .catch(() => showLogin())
})()
