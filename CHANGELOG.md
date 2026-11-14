# Catatan Perubahan

Semua perubahan penting pada Video Wall NR dicatat di berkas ini, versi terbaru di atas. Mulai v0.2.5, bagian
setiap versi juga ditampilkan di halaman [Releases](https://github.com/DejavuNapster/Video_Wall_NR/releases).
Versi 0.2.3 dan 0.2.4 hanya dicatat di sini dan tidak tersedia untuk diunduh.

## [0.2.8] - 2026-11-14

### Ditambahkan

- **Kendali layar panel web dari ponsel**, seperti remote desktop. Tombol **🖱 Kendalikan layar** di kendali panel
  menampilkan isi panel secara langsung (diperbarui terus-menerus) dan meneruskan sentuhan ke panel:
  - ketuk = klik, ketuk dua kali = klik ganda, geser = gulir; tombol **Geser** mengganti fungsi geser menjadi
    seret (mis. untuk peta atau slider); roda mouse juga bisa dipakai dari komputer lain;
  - kolom **Ketik** mengirim teks ke kolom yang sedang aktif di panel, dengan tombol Enter, Backspace, Tab, Esc,
    dan panah.
- Sakelar **Izinkan kendali layar dan keyboard panel** di Operator › Pengaturan › Kendali jarak jauh. Sakelar ini
  mati secara bawaan; selama mati, kendali layar ditolak oleh server.
- **Hapus panel** dari halaman kendali, dengan ketukan kedua sebagai konfirmasi agar tidak terhapus karena salah
  sentuh.

### Diubah

- **Kendali jarak jauh kini memakai HTTPS.** Sertifikat dibuat otomatis oleh komputer wall untuk nama komputer dan
  semua alamat IP jaringan lokalnya, disimpan terenkripsi, berlaku 825 hari, dan dibuat ulang otomatis bila IP
  berubah atau masa berlakunya hampir habis. Password dan semua perintah kini terkirim terenkripsi.
- Alamat `http://` lama otomatis dialihkan ke `https://` di port yang sama; login dan perintah lewat HTTP biasa
  ditolak.
- Operator menampilkan sidik jari SHA-256 sertifikat untuk dicocokkan di browser ponsel, beserta tanggal berlaku
  sertifikat.
- Cookie sesi kendali jarak jauh kini bertanda `Secure`.

## [0.2.7] - 2026-11-14

### Ditambahkan

- **Kendali wall dari jarak jauh.** Halaman kendali di ponsel atau komputer lain kini dapat mengendalikan wall
  secara langsung, tidak hanya preset dan banner. Ketuk panel untuk membuka tombol kendalinya:
  - **Navigasi panel web:** Kembali, Maju, Beranda (kembali ke URL panel), dan Muat ulang.
  - **Layar penuh panel:** panel memenuhi seluruh monitor (setara F11 di wall), ketuk lagi untuk kembali.
  - **Buka di panel baru:** halaman yang sedang terbuka dibuka di panel baru pada monitor yang sama.
  - **Zoom panel web:** perkecil, perbesar, dan kembali ke 100%.
  - **Rotasi halaman:** pindah ke halaman sebelumnya atau berikutnya pada panel yang memakai rotasi halaman.
  - **Ganti URL panel**, atau isi panel kosong dengan URL halaman web atau alamat kamera.
- **Kendali per monitor** di halaman kendali: Tampilkan wall, layar penuh jendela wall, muat ulang semua panel,
  dan keluar dari layar penuh panel.
- **Tombol preset sebelumnya/berikutnya** (◀ ▶) di halaman kendali.
- Halaman kendali menampilkan alamat halaman yang sedang terbuka di panel dan menandai panel yang sedang layar
  penuh.
- Halaman Releases di GitHub kini memuat daftar perubahan setiap versi, diambil dari `CHANGELOG.md`.

### Diubah

- Tombol muat ulang di halaman kendali kini memuat ulang halaman yang sedang terbuka di panel (sama seperti F5
  di wall), bukan kembali ke URL panel.

## [0.2.6] - 2026-11-14

### Ditambahkan

- **Pratinjau langsung** di peta Monitor & Panel pada Operator: cuplikan isi setiap panel, diperbarui sekitar
  setiap 4 detik dan dapat dimatikan.
- **CSS khusus per panel web** untuk menyembunyikan header, menu, scrollbar, atau pop-up cookie. CSS diterapkan
  tanpa memuat ulang halaman, dan tersedia potongan CSS siap pakai.
- **Rotasi halaman dalam satu panel:** beberapa dashboard ditampilkan bergantian dengan interval yang dapat diatur.
- **Peringatan panel bermasalah** ke webhook (Slack, Discord, Google Chat, n8n, dan sejenisnya) dan Telegram bila
  panel bermasalah melewati batas waktu, termasuk pesan pulih dan tombol kirim pesan uji. Token Telegram disimpan
  terenkripsi.
- **Templat banner:** banner dapat disimpan lalu ditampilkan dengan satu klik.
- **Jadwal banner** per jam dan hari, misalnya pengingat rapat.
- **Bunyi alarm banner:** sirene sekitar 5 detik, hanya diputar dari monitor 1.
- **Kendali jarak jauh lewat browser** di jaringan lokal: preset, Mode Tampil, rotasi preset, templat banner,
  banner cepat, pratinjau panel, dan muat ulang panel. Dilindungi password (hash scrypt), cookie sesi
  `HttpOnly` + `SameSite=Strict`, header anti-CSRF, dan penguncian setelah 5 kali gagal masuk.

### Diperbaiki

- Mengubah satu opsi peringatan atau kendali jarak jauh tidak lagi mengembalikan opsi lain ke nilai bawaan
  (misalnya port kembali ke 8787).

## [0.2.5] - 2026-11-14

### Diubah

- **Nama aplikasi menjadi Video Wall NR:** judul jendela, header Operator, shortcut, dan dokumentasi.
- Nama berkas rilis menjadi `Video_Wall_NR_v<versi>_<OS>_<arsitektur>`, misalnya
  `Video_Wall_NR_v0.2.5_Windows_x64_Setup.exe`.

### Ditambahkan

- Folder data lama (`Video Wall Browser`) dipindahkan otomatis ke folder nama baru saat aplikasi pertama kali
  dijalankan, sehingga preset, pengaturan, dan login panel tetap ada.
- Entri jalan otomatis Windows yang masih menunjuk ke exe lama didaftarkan ulang secara otomatis.
- Installer versi ini memperbarui instalasi lama, tidak memasang aplikasi kedua.

## [0.2.4] - 2026-11-14

Versi pertama yang dibangun lewat GitHub Actions. Rilisnya masih memakai nama lama (Video Wall Browser) sehingga
telah dihapus dari halaman Releases; perubahan versi ini sudah termasuk dalam v0.2.5.

### Ditambahkan

- **Build otomatis dengan GitHub Actions** untuk Windows (installer dan portable), Linux (`.deb` dan AppImage),
  serta macOS Intel dan Apple Silicon (`.dmg` dan `.zip`), lengkap dengan `SHA256SUMS.txt`, yang diterbitkan ke
  halaman Releases setiap kali tag versi baru di-push.
- Kolom **Judul** pada banner. Kolom ini terisi otomatis dari tema, dapat diubah sendiri (misalnya "Rapat
  Umum"), dan dapat dikosongkan agar banner hanya menampilkan teks utama.

### Diubah

- **Judul banner mengikuti tema:** Darurat → PENGUMUMAN DARURAT, Peringatan → PERINGATAN, Info → INFORMASI,
  Netral → PENGUMUMAN. Judul yang diketik sendiri tidak tertimpa saat tema diganti.
- Pilihan tema dipindahkan ke bagian atas formulir banner, dan pratinjau banner kini menampilkan judul.
- Tab "Banner Darurat" di Operator menjadi "Banner", karena banner tidak hanya untuk keadaan darurat.

### Diperbaiki

- Tema Peringatan, Info, dan Netral tidak lagi menampilkan judul "Pengumuman Darurat".

## [0.2.3] - 2026-11-14

Versi ini dibuat sebelum kode diunggah ke GitHub sehingga tidak memiliki rilis; perubahannya sudah termasuk dalam
v0.2.5.

### Ditambahkan

- **Navigasi seperti browser di setiap panel web:** ← kembali (Alt+←), → maju (Alt+→), ⟳ muat ulang (F5),
  ⌂ kembali ke URL panel (Alt+Home), dan ⧉ buka halaman di panel baru.
- Tombol **Tampilkan Wall** di Operator dan shortcut **Ctrl+Alt+W** untuk memunculkan wall di depan aplikasi lain.
- Jendela wall memiliki ikon taskbar sendiri, sehingga selalu dapat dibuka kembali.

### Diubah

- Kolom URL panel mengikuti halaman yang sedang terbuka, seperti address bar browser.
- Tombol ⟳ memuat ulang halaman yang sedang terbuka, bukan URL awal panel.
- Tombol pada bilah panel menyesuaikan lebar panel.

### Diperbaiki

- Link yang membuka tab baru dan tombol "+ Panel" tidak lagi gagal dengan pesan "Monitor penuh": panel asal atau
  panel aktif dibelah dua.
- Pada komputer dengan satu monitor, wall kini tampil layar penuh di depan saat aplikasi dibuka, tidak lagi
  tersembunyi di belakang jendela Operator.
