# Video Wall Browser (PoC)

Aplikasi desktop video wall multi-monitor untuk **Windows (.exe)** dan **Linux (installer .sh)**.
Setiap panel dapat menampilkan **halaman web**, **stream video** (RTSP/HLS/WHEP/MJPEG), **jam**, atau **teks berjalan**.
Pembagian tugas:

- **Jendela wall** (fullscreen di setiap monitor): susun panel langsung di layar — tambah, geser, ubah ukuran,
  layout siap pakai, ketik URL. Lihat [Jendela wall](#jendela-wall).
- **Jendela Operator**: pusat kontrol — kelola preset, atur sumber panel secara detail, rotasi & jadwal, banner
  darurat, pengaturan, backup. Lihat [Jendela Operator](#jendela-operator).

Semua perubahan (dari wall maupun Operator) langsung tampil di wall dan tersimpan otomatis.

> Status: **PoC**. Lihat bagian [Keterbatasan & belum terverifikasi](#keterbatasan--belum-terverifikasi).

## Teknologi

| Bagian | Pilihan | Alasan singkat |
| --- | --- | --- |
| Shell desktop | Electron 44 (Chromium 152) | Satu basis kode untuk Windows & Linux, `BaseWindow` + `WebContentsView` per tile |
| Build | electron-vite 6, Vite 8 | main / preload / renderer dalam satu konfigurasi |
| UI operator | React 19, Tailwind CSS 4, zustand, react-grid-layout 2 | Drag & resize tile secara interaktif |
| Validasi | zod 4 | Skema preset/pengaturan yang sama di main dan renderer |
| Video RTSP | MediaMTX 1.21.2 (sidecar) → WebRTC (WHEP), fallback HLS | Browser tidak bisa memutar RTSP langsung |
| Paket | electron-builder 26 | NSIS + portable (Windows), AppImage/deb/rpm (Linux) |
| Test | vitest 5 | Unit test logika murni di `tests/` (skema, edit panel, geometri, layout, jadwal/rotasi, banner, backup, store Operator, keamanan) |

## Arsitektur

```
Main process (sumber kebenaran)
 ├─ DisplayManager   : deteksi monitor, urut kiri→kanan lalu atas→bawah, hot-plug, resume dari sleep
 ├─ WallController   : 1 BaseWindow fullscreen per monitor, 1 WebContentsView per tile (proses renderer terpisah)
 │    └─ TileView    : watchdog (backoff 2s/5s/30s), reload terjadwal, batas memori, deteksi video macet
 ├─ MediaMtxSidecar  : RTSP → WebRTC/HLS, hanya 127.0.0.1, token API acak per sesi
 ├─ CredentialVault  : password RTSP lewat safeStorage (tidak disimpan di preset)
 ├─ ActivePresetService : pemegang preset aktif; edit dari wall/Operator, simpan otomatis (ditunda 0,5 dtk)
 ├─ RotationController  : rotasi preset otomatis (hanya di Mode Tampil)
 ├─ PresetStore / SettingsStore : JSON atomik di folder userData
 ├─ ScheduleController  : jadwal preset berbasis jam (lebih kuat daripada rotasi)
 ├─ BannerController    : banner darurat di semua monitor
 └─ Operator window  : UI React (preload `operator`, semua IPC divalidasi pengirimnya)
UI wall    : 1 WebContentsView transparan per jendela wall (preload `wall`): toolbar, bilah panel, menu.
             Biasanya di bawah tile; naik ke atas selama menu terbuka / panel digeser.
Tile web   : partisi `persist:tile-<id>` (`-insecure` bila sertifikat diabaikan), tanpa preload,
             semua permission ditolak kecuali fullscreen (tetap terkurung di kotak panel)
Tile video : halaman lokal `video.html` + preload `video` (WHEP client / hls.js / MJPEG, heartbeat 2 detik)
```

Slot monitor: display diurutkan kiri→kanan lalu atas→bawah. Bila ada lebih dari satu display, display utama
dicadangkan untuk operator (`excludePrimaryFromWall`, bisa dimatikan di pengaturan).

## Mulai cepat (pengembangan)

Prasyarat: Node.js >= 22.12.

```bash
npm ci
npm run fetch:mediamtx      # unduh binary MediaMTX (diverifikasi SHA-256) ke resources/bin
npm run dev                 # mode dev
npm run typecheck
npm test
```

Mode tanpa banyak monitor fisik:

```bash
npm run dev:windowed                         # wall berupa window biasa
npm run dev:virtual                          # 4 monitor virtual 640x360 (implies windowed)
```

Jumlah monitor virtual lain atau flag tambahan diteruskan ke Electron setelah `-- --`:

```bash
npm run dev -- -- --virtual-displays=2       # bash / cmd.exe
npm.cmd run dev -- -- --virtual-displays=2   # PowerShell: `npm` (npm.ps1) membuang `--` pertama, pakai npm.cmd
```

Alternatif lintas shell: set `VW_VIRTUAL_DISPLAYS=N` lalu `npm run dev`
(PowerShell: `$env:VW_VIRTUAL_DISPLAYS = 2; npm run dev`).

Pada server tanpa layar: `xvfb-run -a npm run dev -- -- --virtual-displays=4 --no-sandbox --disable-gpu`.

### Flag & variabel lingkungan

| Flag | Env | Fungsi |
| --- | --- | --- |
| `--windowed` | `VW_WINDOWED=1` | Wall berupa window biasa |
| `--virtual-displays=N` | `VW_VIRTUAL_DISPLAYS=N` | N monitor virtual (otomatis windowed) |
| `--hide-operator` | `VW_HIDE_OPERATOR=1` | Mulai tanpa menampilkan UI operator |
| – | `VW_NO_GPU_FLAGS=1` | Jangan aktifkan flag decode GPU |
| – | `VW_ENABLE_FEATURES=...` | Tambah fitur Chromium |
| – | `VW_OZONE=x11\|wayland` | Dibaca launcher Linux |

Pintasan global: **Ctrl+Alt+O** tampilkan operator, **Ctrl+Alt+W** tampilkan wall di depan, **Ctrl+Alt+Q** keluar.

**Satu monitor**: wall dan Operator berbagi layar. Saat aplikasi mulai, wall tampil di depan dan Operator hanya
ada di taskbar. Berpindah: ikon taskbar, Ctrl+Alt+O (Operator), Ctrl+Alt+W atau tombol **Tampilkan Wall** (wall).

## Jendela wall

Setiap monitor wall punya dua mode (berlaku untuk semua monitor, tersimpan di pengaturan):

- **Mode Atur**: toolbar di atas dan bilah di atas setiap panel.
- **Mode Tampil** (Ctrl+E, atau tombol di toolbar/Operator): semua bilah disembunyikan, wall bersih.

Semua perubahan di wall **langsung tampil dan tersimpan otomatis** ke preset aktif; Operator ikut diperbarui.
Menyimpan preset aktif dari Operator juga langsung diterapkan ke wall.

**Bilah panel**: ⠿ seret untuk memindah · titik status · ← kembali · → maju · ⟳ muat ulang halaman ·
⌂ kembali ke URL panel · kolom URL · ⧉ buka halaman ini di panel baru · zoom − 100% + · refresh otomatis ·
⛶ layar penuh panel · ✕ hapus (dengan konfirmasi). Tombol muncul bertahap sesuai lebar panel. Tepi/sudut
panel bisa ditarik untuk mengubah ukuran.

Panel web berperilaku seperti tab browser: kolom URL menampilkan halaman yang sedang terbuka. Ketik URL lain
lalu Enter untuk mengganti URL panel (tersimpan di preset). Link yang membuka tab baru (`target=_blank`) dan
tombol ⧉ membuat panel baru di monitor yang sama; bila monitor penuh, panel asal dibelah dua.
**+ Panel** di toolbar juga membelah panel aktif bila monitor penuh.

Jenis sumber dideteksi dari URL:

| Ketikan | Sumber |
| --- | --- |
| `rtsp://` / `rtsps://` | Kamera RTSP (via MediaMTX). `user:pass@` di URL dipindah ke penyimpanan terenkripsi |
| berakhiran `.m3u8` | HLS |
| path berakhiran `/whep` | WebRTC (WHEP) |
| `http(s)://` lainnya | Halaman web (panel MJPEG tetap MJPEG) |
| tanpa skema, mis. `10.94.44.56:3000` | ditambah `http://` |
| kosong | panel dikosongkan |

Panel yang gagal dimuat menampilkan pesan + **Coba lagi**; bila error sertifikat (mis. server HTTPS diakses
lewat IP), ada tombol **Abaikan sertifikat untuk panel ini**.

**Toolbar**: + Panel · Layout (1 penuh, 2 kiri-kanan, 2 atas-bawah, 2×2, 3×3, 4×4, 1 besar + 5 kecil) ·
Grid / Bebas (grid 8× lebih halus) · Magnet (hanya Mode Bebas) · Bezel N×M · tombol preset 1, 2, … (urut nama)
+ nama preset aktif · 📌 pin (selalu di atas) · Mode Tampil · Layar penuh · ☰ (buka Operator, daftar shortcut,
keluar). Kelola preset, rotasi, dan pengaturan aplikasi ada di jendela Operator.

## Jendela Operator

Dibuka otomatis saat aplikasi mulai (kecuali `--hide-operator`), lewat menu ☰ di wall, atau **Ctrl+Alt+O**.

- **Sidebar Preset**: klik untuk menampilkan di wall · + Baru · ganti nama / Duplikat / Hapus preset aktif.
- **Monitor & Panel**: peta isi setiap monitor dengan status panel (berjalan / gagal / beku). Klik panel untuk
  membuka **Inspector**: label, jenis sumber (web, RTSP, HLS, WHEP, MJPEG, jam, teks berjalan), URL, zoom,
  muat ulang otomatis, abaikan sertifikat, transport + username + password RTSP (terenkripsi), muat ulang, hapus.
  Posisi/ukuran panel diatur di wall (Mode Atur).
- **Otomatisasi**: rotasi preset (interval, hanya di Mode Tampil) dan jadwal preset per jam + hari. Selama ada
  jadwal aktif, rotasi dijeda.
- **Banner**: tema (Darurat, Peringatan, Info, Netral — warna + judul bawaan), judul (bisa diubah/dikosongkan), teks, layar penuh / strip atas, durasi, warna, kunci (tidak bisa ditutup dari wall).
- **Pengaturan**: jalan otomatis saat login, monitor utama untuk Operator, abaikan sertifikat (semua panel),
  pemulihan otomatis (muat ulang berkala, deteksi video beku, batas memori), relay RTSP (MediaMTX),
  **backup & pulihkan** (semua preset + pengaturan dalam satu file JSON; password RTSP tidak ikut).

| Shortcut (di jendela wall) | Fungsi |
| --- | --- |
| Ctrl+E | Mode Atur / Mode Tampil |
| F11 | Panel aktif memenuhi seluruh monitor (panel lain tetap berjalan di belakang) |
| Esc | Keluar layar penuh panel · batal geser |
| F10 | Layar penuh jendela (juga di mode windowed: menghilangkan title bar) |
| F5 / Ctrl+R | Muat ulang halaman panel aktif |
| Alt+← / Alt+→ (atau tombol back/forward mouse) | Kembali / maju di panel aktif |
| Alt+Home | Kembali ke URL panel |
| Ctrl+L | Ubah URL panel aktif |
| Ctrl + / Ctrl − / Ctrl+0, Ctrl+roda | Zoom panel aktif |
| Ctrl+Tab | Panel aktif berikutnya |
| Ctrl+1…9 | Pindah preset |
| Ctrl+Spasi | Jalankan / jeda rotasi |
| Alt saat menggeser | Matikan magnet sementara |

Di Windows, deteksi oklusi Chromium (`CalculateNativeWinOcclusion`) dimatikan: tanpa ini Chromium
menghentikan animasi dan `requestAnimationFrame` panel bila menganggap wall tertutup jendela lain, dan status
itu bisa terlambat pulih saat wall kembali di depan (animasi dashboard tampak diam).

Shortcut wall tidak diteruskan ke web di dalam panel. Tombol "Layar Penuh" milik web sendiri tetap berfungsi
dan terkurung di kotak panelnya (Esc untuk keluar).

## Build paket

```bash
npm run fetch:mediamtx
npm run dist:linux     # AppImage + deb + rpm  (rpm butuh `rpmbuild`)
npm run dist:win       # NSIS + portable .exe  (jalankan di Windows / CI)
```

Ikon Windows memakai `build/icon.ico` yang sudah jadi. Bila `build/icon.png` diganti, buat ulang dengan
`.\scripts\windows\make-icon.ps1` (konversi ikon bawaan electron-builder bisa gagal
"WebAssembly.Memory(): could not allocate memory" di mesin dengan memori terbatas).
`.exe` belum ditandatangani digital, sehingga Windows SmartScreen akan menampilkan peringatan saat pertama dijalankan.

CI GitHub Actions (`.github/workflows/build.yml`) membangun Windows (`windows-latest`) dan Linux (`ubuntu-22.04`)
dan mengunggah artefak. Build Windows sudah diuji secara lokal (Windows 11); CI belum pernah dijalankan.

`appId` = `itsupport.videowallbrowser` (di `electron-builder.yml`). **Jangan diubah setelah aplikasi
terpasang**: Windows akan menganggapnya aplikasi lain (dua entri uninstall/shortcut). Placeholder yang tersisa:
`homepage` di `package.json` (dipakai paket Linux).

## Instalasi Linux (Ubuntu 22.04 LTS atau lebih baru)

```bash
sudo ./scripts/linux/install.sh --appimage ./dist/video-wall-browser-0.2.1-x86_64.AppImage \
     --autostart --user wall
# opsional: nonaktifkan Wayland di GDM (backup dibuat), lalu reboot
sudo ./scripts/linux/install.sh --appimage ... --user wall --force-xorg
# hapus
sudo ./scripts/linux/install.sh --uninstall --user wall [--purge]
```

Yang dilakukan installer: ekstrak AppImage tanpa FUSE ke `/opt/video-wall-browser`, `chrome-sandbox` SUID 4755,
launcher `/usr/local/bin/video-wall-browser` (memaksa `--ozone-platform=x11`), entri menu, dan (opsional) service
systemd **user** dengan `Restart=always`.

Alternatif: `sudo apt install ./video-wall-browser-0.2.1-amd64.deb`.

### X11 vs Wayland

- Default launcher memakai **X11** (di sesi Wayland berjalan via XWayland). Penempatan window fullscreen per monitor
  di Wayland murni dibatasi compositor, jadi untuk video wall disarankan sesi **Xorg**.
- Untuk menguji Wayland native: `VW_OZONE=wayland video-wall-browser`. **Belum diuji dengan monitor fisik.**
- Auto-login grafis perlu diaktifkan agar wall menyala sendiri setelah reboot.

## Instalasi Windows

Jalankan installer NSIS atau `.exe` portable. Autostart + pemulihan otomatis:

```powershell
# PowerShell sebagai Administrator
.\scripts\windows\install-autostart.ps1
.\scripts\windows\install-autostart.ps1 -Remove
```

Aktifkan auto-login Windows (`netplwiz`) untuk akun wall.

## Data & log

| Item | Lokasi (userData) |
| --- | --- |
| Preset & pengaturan | `presets/*.json`, `settings.json`, `state.json` (preset aktif) |
| Password RTSP | `credentials.json` (terenkripsi safeStorage) |
| Log aplikasi | `logs/main.log` (rotasi 5 MB) |
| Metrik per tile | `logs/metrics.csv` (tiap 10 detik, rotasi 50 MB) |

Linux: `~/.config/Video Wall Browser`, Windows: `%APPDATA%\Video Wall Browser` (mengikuti `productName`).

## Keamanan (ringkas)

- `contextIsolation`, `sandbox`, `nodeIntegration: false`; semua permission web ditolak kecuali fullscreen
  (tombol "Layar Penuh" web, terkurung di kotak panel); download diblokir; popup ditolak.
- Navigasi tile web hanya `http(s)`; tile web tidak bisa mengakses port sidecar loopback.
- IPC operator hanya diterima dari window operator; semua payload divalidasi zod.
- IPC `wall:*` hanya diterima dari UI wall yang terdaftar; monitor diambil dari jendela pengirim (bukan dari
  payload), jadi UI satu monitor tidak bisa mengubah panel monitor lain. Tile (konten luar) tidak punya preload.
- Sertifikat self-signed hanya diterima bila host + fingerprint disematkan di pengaturan, atau bila panel
  memakai **Abaikan error sertifikat** (per panel, atau untuk semua panel lewat menu ⚙ wall; setara
  "Proceed anyway" di Chrome, mis. untuk server yang diakses lewat IP). Panel dengan opsi ini memakai session
  terpisah (`persist:tile-<id>-insecure`), sehingga login perlu diulang sekali setelah opsi diubah.
- Password RTSP disimpan terenkripsi (safeStorage), tidak ada di berkas preset/ekspor.
- MediaMTX: hanya `127.0.0.1`, akses anonim hanya `read`, API memakai token acak per sesi.
- CSP disuntikkan pada build produksi (varian operator — juga dipakai UI wall — dan video).

Catatan: di Linux tanpa keyring, `safeStorage` bisa jatuh ke "weak" (teks sandi lemah); UI menampilkan tingkat kekuatannya.

## Keterbatasan & belum terverifikasi

Belum diuji pada perangkat nyata (hanya Xvfb + monitor virtual):
- Decode stream RTSP/WebRTC nyata dan akselerasi GPU (VA-API/NVDEC), H.265.
- Wayland native, hot-plug monitor, sleep/wake, soak 24 jam.
- Build/run Windows, build `.rpm`, autostart systemd pada sesi nyata.
- Opsi path MediaMTX `rtspTransport`.
- Perilaku SUID sandbox vs AppArmor di Ubuntu 24.04.
- UI wall: diuji di Windows 11 (skala 125%, satu monitor fisik, mode kiosk/windowed/virtual). Multi-monitor fisik,
  autostart dari aplikasi hasil build, dan Linux belum diuji.

Catatan: skrip instalasi (`scripts/linux/install.sh`, `scripts/windows/*.ps1`), ikon `build/`, dan workflow CI
yang disebut di atas tidak ikut dalam source hasil rekonstruksi ini; `npm run dev` / `npm run build` tidak
membutuhkannya, tetapi paket installer (`dist:*`) membutuhkan ikon di `build/`.
