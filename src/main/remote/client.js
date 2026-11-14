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
  let state = null
  let thumbs = {}
  let timers = []

  // ------------------------------------------------------------ util
  function el(tag, attrs, children) {
    const node = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') node.textContent = v
      else if (k === 'onclick') node.addEventListener('click', v)
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

    $('monitors').replaceChildren(...s.monitors.map(renderMonitor))
  }

  function renderMonitor(m) {
    return el('div', { class: 'monitor' }, [
      el('h3', { text: `Monitor ${m.slot + 1}` }),
      el('div', { class: 'tiles' }, m.tiles.length ? m.tiles.map(renderTile) : [el('p', { class: 'muted small', text: 'Belum ada panel' })])
    ])
  }

  function renderTile(t) {
    const live = t.type !== 'empty' && t.type !== 'clock' && t.type !== 'ticker'
    const thumb = thumbs[t.id]
    const dotClass = t.state === 'ok' ? 'ok' : t.state === 'loading' ? 'loading' : t.state && t.state !== 'idle' ? 'bad' : ''
    return el('div', { class: 'tile' }, [
      thumb ? el('img', { class: 'thumb', alt: '', src: thumb, 'data-tile': t.id }) : live ? el('img', { class: 'thumb', alt: '', 'data-tile': t.id }) : el('div', { class: 'thumb empty', text: t.summary }),
      el('div', { class: 'meta' }, [
        el('i', { class: `dot ${dotClass}`, title: STATE_LABEL[t.state] || '' }),
        el('span', { text: t.summary, title: t.summary }),
        live ? el('button', { type: 'button', text: 'Muat ulang', onclick: () => act('/api/tile/reload', { id: t.id }, 'Panel dimuat ulang') }) : null
      ]),
      t.error ? el('div', { class: 'err', text: t.error }) : null
    ])
  }

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
    }
  })

  // ------------------------------------------------------------ mulai
  api('/api/session')
    .then((r) => (r.authenticated ? startApp() : showLogin()))
    .catch(() => showLogin())
})()
