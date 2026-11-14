Aplikasi desktop video wall multi-monitor: panel halaman web, kamera RTSP, HLS, WebRTC (WHEP), MJPEG, jam, dan teks berjalan.

## Unduh

| Sistem | File |
| --- | --- |
| Windows 10/11 (x64) — installer | `Video_Wall_NR_v<versi>_Windows_x64_Setup.exe` |
| Windows 10/11 (x64) — portable (tanpa instal) | `Video_Wall_NR_v<versi>_Windows_x64_Portable.exe` |
| Ubuntu / Debian (x64) | `Video_Wall_NR_v<versi>_Linux_amd64.deb` |
| Linux lain (x64) | `Video_Wall_NR_v<versi>_Linux_x86_64.AppImage` |
| macOS Apple Silicon (M1/M2/M3/M4) | `Video_Wall_NR_v<versi>_macOS_arm64.dmg` (atau `.zip`) |
| macOS Intel | `Video_Wall_NR_v<versi>_macOS_x64.dmg` (atau `.zip`) |

`SHA256SUMS.txt` berisi checksum semua file.

## Instalasi

**Windows** — jalankan installer. SmartScreen mungkin memperingatkan karena aplikasi belum ditandatangani:
klik *More info* → *Run anyway*.

**Ubuntu / Debian**

```bash
sudo apt install ./Video_Wall_NR_v<versi>_Linux_amd64.deb
```

**AppImage**

```bash
chmod +x Video_Wall_NR_v<versi>_Linux_x86_64.AppImage
./Video_Wall_NR_v<versi>_Linux_x86_64.AppImage
```

**macOS** — buka `.dmg`, seret *Video Wall NR* ke *Applications*. Aplikasi belum ditandatangani Apple
Developer ID, jadi Gatekeeper menolaknya saat pertama dibuka. Jalankan sekali di Terminal:

```bash
xattr -cr "/Applications/Video Wall NR.app"
```

lalu buka seperti biasa (atau klik-kanan → *Open*).

## Pemakaian singkat

- Jendela wall tampil layar penuh di setiap monitor; jendela **Operator** untuk preset, rotasi/jadwal, banner, dan pengaturan.
- **Ctrl+E** Mode Atur / Mode Tampil · **Ctrl+Alt+O** tampilkan Operator · **Ctrl+Alt+W** tampilkan wall · **Ctrl+Alt+Q** keluar.
- Panel web berperilaku seperti tab browser: ← → ⟳ ⌂ dan ⧉ buka di panel baru.
- Panel web dapat menampilkan beberapa dashboard bergantian dan diberi CSS khusus (sembunyikan header/menu).
- Operator menampilkan pratinjau langsung setiap panel; banner bisa disimpan sebagai templat, dijadwalkan, dan diberi bunyi alarm.
- Peringatan otomatis ke webhook/Telegram bila panel bermasalah (Operator › Pengaturan).
- Kendali jarak jauh lewat browser (HTTPS) di jaringan lokal (Operator › Pengaturan): preset, banner, navigasi, layar penuh, zoom, ganti URL, dan hapus panel dari ponsel, serta kendali layar dan keyboard panel web seperti remote desktop.
