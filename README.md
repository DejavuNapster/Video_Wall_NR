# Video Wall NR

Aplikasi desktop video wall multi-monitor untuk **Windows** (.exe), **Linux** (.deb / AppImage), dan **macOS** (.dmg, Intel + Apple Silicon).
Unduh installer dari halaman [Releases](../../releases).
Setiap panel dapat menampilkan **halaman web**, **stream video** (RTSP/HLS/WHEP/MJPEG), **jam**, atau **teks berjalan**.
Pembagian tugas:

- **Jendela wall** (fullscreen di setiap monitor): susun panel langsung di layar — tambah, geser, ubah ukuran,
  layout siap pakai, ketik URL. Lihat [Jendela wall](#jendela-wall).
- **Jendela Operator**: pusat kontrol — kelola preset, atur sumber panel secara detail, rotasi & jadwal, banner
  darurat, pengaturan, backup. Lihat [Jendela Operator](#jendela-operator).

Semua perubahan (dari wall maupun Operator) langsung tampil di wall dan tersimpan otomatis.

Riwayat perubahan setiap versi ada di [CHANGELOG.md](CHANGELOG.md).

## Teknologi

| Bagian | Pilihan | Alasan singkat |
| --- | --- | --- |
| Shell desktop | Electron 44 (Chromium 152) | Satu basis kode untuk Windows & Linux, `BaseWindow` + `WebContentsView` per tile |
| Build | electron-vite 6, Vite 8 | main / preload / renderer dalam satu konfigurasi |
| UI operator | React 19, Tailwind CSS 4, zustand, react-grid-layout 2 | Drag & resize tile secara interaktif |
| Validasi | zod 4 | Skema preset/pengaturan yang sama di main dan renderer |
| Video RTSP | MediaMTX 1.21.2 (sidecar) → WebRTC (WHEP), fallback HLS | Browser tidak bisa memutar RTSP langsung |
| Paket | electron-builder 26 | NSIS + portable (Windows), deb + AppImage (Linux), dmg + zip (macOS) |
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
- **Monitor & Panel**: peta isi setiap monitor dengan status panel (berjalan / gagal / beku) dan **pratinjau
  langsung** (cuplikan isi panel, diperbarui tiap ±4 detik; bisa dimatikan). Klik panel untuk membuka
  **Inspector**: label, jenis sumber (web, RTSP, HLS, WHEP, MJPEG, jam, teks berjalan), URL, zoom, muat ulang
  otomatis, abaikan sertifikat, transport + username + password RTSP (terenkripsi), muat ulang, hapus.
  Khusus panel web:
  - **Rotasi halaman**: beberapa dashboard bergantian di satu panel (satu URL per baris, interval dalam detik).
  - **CSS khusus**: disuntikkan ke setiap halaman panel untuk menyembunyikan header, menu, scrollbar, atau
    pop-up cookie. Diterapkan tanpa memuat ulang halaman; tersedia potongan CSS siap pakai.

  Posisi/ukuran panel diatur di wall (Mode Atur).
- **Otomatisasi**: rotasi preset (interval, hanya di Mode Tampil) dan jadwal preset per jam + hari. Selama ada
  jadwal aktif, rotasi dijeda.
- **Banner**: tema (Darurat, Peringatan, Info, Netral — warna + judul bawaan), judul (bisa diubah/dikosongkan),
  teks, layar penuh / strip atas, durasi, warna, **bunyi alarm** (sirene ±5 detik dari monitor 1), kunci (tidak
  bisa ditutup dari wall). Banner bisa disimpan sebagai **templat** lalu ditampilkan dengan satu klik atau
  **dijadwalkan** per jam + hari (mis. pengingat rapat).
- **Pengaturan**: jalan otomatis saat login, monitor utama untuk Operator, abaikan sertifikat (semua panel),
  pemulihan otomatis (muat ulang berkala, deteksi video beku, batas memori), relay RTSP (MediaMTX),
  **peringatan panel bermasalah**, **kendali jarak jauh**, dan **backup & pulihkan** (semua preset + pengaturan
  dalam satu file JSON; password RTSP, password kendali jarak jauh, dan token Telegram tidak ikut).

### Peringatan panel bermasalah

Bila sebuah panel gagal tampil (gagal dimuat, crash, video beku, tidak merespons) terus-menerus melewati batas
waktu (bawaan 5 menit), aplikasi mengirim pesan ke:

- **Webhook**: `POST` JSON `{ text, content, app, version, host, event, tileId, durationMs }`. Kolom `text`
  dipakai Slack/Google Chat, `content` dipakai Discord; n8n/Make/server sendiri bisa membaca semuanya.
- **Telegram**: isi chat ID (grup/kanal) dan token bot dari @BotFather; bot harus sudah ada di grup tersebut.

Pesan memuat nama panel, nomor monitor, dan nama komputer. Saat panel pulih, pesan pulih dikirim (bisa
dimatikan). Gunakan **Kirim pesan uji** untuk memeriksa saluran.

### Kendali jarak jauh

Operasikan wall dari ponsel atau komputer lain di jaringan yang sama melalui browser (HTTPS):

- **Tampilan & preset:** Mode Tampil / Mode Atur, rotasi preset, pilih preset, atau preset sebelumnya/berikutnya (◀ ▶).
- **Banner:** tampilkan templat banner atau banner cepat, tutup banner.
- **Per monitor:** tampilkan wall di depan aplikasi lain, layar penuh jendela wall, muat ulang semua panel,
  keluar dari layar penuh panel.
- **Per panel** (ketuk pratinjau panel): ← kembali, → maju, ⌂ ke URL panel, ⟳ muat ulang, ⛶ layar penuh panel,
  ⧉ buka di panel baru, zoom (− / + / 100%), halaman rotasi sebelumnya/berikutnya, ganti URL panel (juga
  untuk mengisi panel kosong dengan URL halaman web atau alamat kamera), dan 🗑 hapus panel (ketuk dua kali).
- **Kendali layar panel web** (🖱 Kendalikan layar): isi panel tampil langsung di ponsel dan bisa dioperasikan
  seperti remote desktop. Ketuk = klik, ketuk dua kali = klik ganda, geser = gulir (atau seret, lewat tombol
  *Geser*), roda mouse untuk menggulir dari komputer lain, kolom **Ketik** untuk mengirim teks ke kolom yang sedang
  aktif, serta tombol Enter, Backspace, Tab, Esc, dan panah. Fitur ini mati secara bawaan; aktifkan dengan
  **Izinkan kendali layar dan keyboard panel** di Operator.

Setiap panel menampilkan pratinjau langsung, status, dan alamat halaman yang sedang terbuka.

1. Operator › Pengaturan › **Kendali jarak jauh**: atur password (minimal 8 karakter), lalu aktifkan.
2. Buka alamat yang ditampilkan (mis. `https://192.168.1.20:8787`) dari perangkat lain dan masuk dengan password.
   Alamat `http://` lama otomatis dialihkan ke `https://`.
3. Sertifikat HTTPS dibuat oleh komputer ini, jadi saat pertama kali dibuka browser memperingatkan bahwa koneksi
   tidak bersifat pribadi: pilih **Lanjutkan** / **Kunjungi situs web ini**. Untuk memastikan yang terbuka benar-benar
   wall Anda, cocokkan sidik jari SHA-256 di detail sertifikat browser dengan yang tertera di Operator.
4. Saat pertama kali diaktifkan, Windows meminta izin firewall: pilih **Private networks**.

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

Lokal (di OS targetnya masing-masing):

```bash
npm run fetch:mediamtx
npm run dist:win       # Windows: NSIS + portable .exe
npm run dist:linux     # Linux: .deb + AppImage
# macOS: MediaMTX per arsitektur, lalu dmg + zip untuk x64 dan arm64
MEDIAMTX_PLATFORM=darwin MEDIAMTX_ARCH=x64 npm run fetch:mediamtx
MEDIAMTX_PLATFORM=darwin MEDIAMTX_ARCH=arm64 npm run fetch:mediamtx
npm run dist:mac
```

**Rilis otomatis** — `.github/workflows/release.yml` membangun ketiga OS di runner GitHub Actions
(`windows-latest`, `ubuntu-latest`, `macos-latest`), lalu menerbitkan semua installer + `SHA256SUMS.txt` ke
halaman Releases. Isi halaman rilis adalah bagian versi tersebut dari `CHANGELOG.md`, diikuti petunjuk unduh dari
`.github/release-notes.md`; build gagal bila `CHANGELOG.md` belum memuat versi yang dirilis.

```bash
# naikkan "version" di package.json, tambahkan bagian versi di CHANGELOG.md, commit, lalu:
git tag v0.2.8
git push origin main v0.2.8
```

Ikon Windows memakai `build/icon.ico` yang sudah jadi; Linux/macOS memakai `build/icon.png` (512×512).
Installer belum ditandatangani: Windows SmartScreen memperingatkan saat pertama dijalankan, dan macOS hanya diberi
tanda tangan ad-hoc (`build/afterPack.cjs`) sehingga Gatekeeper perlu dibuka sekali
(`xattr -cr "/Applications/Video Wall NR.app"` atau klik-kanan → Open).

`appId` = `itsupport.videowallbrowser` (di `electron-builder.yml`). **Jangan diubah setelah aplikasi
terpasang**: Windows akan menganggapnya aplikasi lain (dua entri uninstall/shortcut).

## Instalasi

- **Windows**: jalankan installer (`_Windows_x64_Setup.exe`) atau versi portable (`_Windows_x64_Portable.exe`). Aktifkan
  **Jalan otomatis saat login** di Operator › Pengaturan, dan auto-login Windows (`netplwiz`) untuk akun wall.
- **Ubuntu / Debian**: `sudo apt install ./Video_Wall_NR_v<versi>_Linux_amd64.deb`
- **Linux lain**: `chmod +x Video_Wall_NR_v<versi>_Linux_x86_64.AppImage` lalu jalankan.
- **macOS**: buka `.dmg` (`macOS_arm64` untuk Apple Silicon, `macOS_x64` untuk Intel), seret ke *Applications*, lalu
  `xattr -cr "/Applications/Video Wall NR.app"` sekali sebelum dibuka.

### X11 vs Wayland

- Default launcher memakai **X11** (di sesi Wayland berjalan via XWayland). Penempatan window fullscreen per monitor
  di Wayland murni dibatasi compositor, jadi untuk video wall disarankan sesi **Xorg**.
- Untuk menguji Wayland native: `VW_OZONE=wayland video-wall-browser`.
- Auto-login grafis perlu diaktifkan agar wall menyala sendiri setelah reboot.

## Data & log

| Item | Lokasi (userData) |
| --- | --- |
| Preset & pengaturan | `presets/*.json`, `settings.json`, `state.json` (preset aktif) |
| Password RTSP | `credentials.json` (terenkripsi safeStorage) |
| Log aplikasi | `logs/main.log` (rotasi 5 MB) |
| Metrik per tile | `logs/metrics.csv` (tiap 10 detik, rotasi 50 MB) |

Linux: `~/.config/Video Wall NR`, Windows: `%APPDATA%\Video Wall NR` (mengikuti `productName`).
Data dari nama lama (`Video Wall Browser`) dipindahkan otomatis saat versi baru pertama kali dijalankan.

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
- Password RTSP dan token bot Telegram disimpan terenkripsi (safeStorage), tidak ada di berkas preset/ekspor.
- Kendali jarak jauh: mati secara bawaan; hanya HTTPS (TLS 1.2+) dengan sertifikat self-signed (kunci EC P-256,
  berlaku 825 hari) yang dibuat otomatis untuk nama komputer dan semua IP jaringan lokal, disimpan terenkripsi
  (safeStorage), dan dibuat ulang bila IP berubah atau masa berlakunya tinggal 30 hari. Permintaan HTTP biasa di
  port yang sama dialihkan ke HTTPS, dan API (termasuk login) tidak dilayani lewat HTTP. HSTS sengaja tidak
  dipasang karena membuat browser menolak sertifikat self-signed sama sekali. Password disimpan sebagai hash
  scrypt (terenkripsi safeStorage); sesi lewat cookie `HttpOnly` + `Secure` + `SameSite=Strict` (berlaku 12 jam,
  hilang saat password diganti atau aplikasi ditutup); setiap `POST` wajib membawa header khusus (perlindungan
  CSRF); login dikunci 60 detik setelah 5 kali gagal; CSP ketat dan semua masukan divalidasi zod. Kendali layar
  dan keyboard panel punya sakelar izin sendiri (mati secara bawaan) dan hanya berlaku untuk panel web.
- CSS khusus panel hanya mengubah tampilan halaman di panel itu (disuntikkan lewat `insertCSS`, tanpa JavaScript).
- MediaMTX: hanya `127.0.0.1`, akses anonim hanya `read`, API memakai token acak per sesi.
- CSP disuntikkan pada build produksi (varian operator — juga dipakai UI wall — dan video).

Catatan: di Linux tanpa keyring, `safeStorage` bisa jatuh ke "weak" (teks sandi lemah); UI menampilkan tingkat kekuatannya.
