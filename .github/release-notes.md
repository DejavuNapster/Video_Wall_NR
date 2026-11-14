Aplikasi desktop video wall multi-monitor: panel halaman web, kamera RTSP, HLS, WebRTC (WHEP), MJPEG, jam, dan teks berjalan.

## Unduh

| Sistem | File |
| --- | --- |
| Windows 10/11 (x64) — installer | `video-wall-browser-<versi>-x64.exe` |
| Windows 10/11 (x64) — portable (tanpa instal) | `video-wall-browser-<versi>-x64-portable.exe` |
| Ubuntu / Debian (x64) | `video-wall-browser-<versi>-amd64.deb` |
| Linux lain (x64) | `video-wall-browser-<versi>-x86_64.AppImage` |
| macOS Apple Silicon (M1/M2/M3/M4) | `video-wall-browser-<versi>-mac-arm64.dmg` (atau `.zip`) |
| macOS Intel | `video-wall-browser-<versi>-mac-x64.dmg` (atau `.zip`) |

`SHA256SUMS.txt` berisi checksum semua file.

## Instalasi

**Windows** — jalankan installer. SmartScreen mungkin memperingatkan karena aplikasi belum ditandatangani:
klik *More info* → *Run anyway*.

**Ubuntu / Debian**

```bash
sudo apt install ./video-wall-browser-<versi>-amd64.deb
```

**AppImage**

```bash
chmod +x video-wall-browser-<versi>-x86_64.AppImage
./video-wall-browser-<versi>-x86_64.AppImage
```

**macOS** — buka `.dmg`, seret *Video Wall Browser* ke *Applications*. Aplikasi belum ditandatangani Apple
Developer ID, jadi Gatekeeper menolaknya saat pertama dibuka. Jalankan sekali di Terminal:

```bash
xattr -cr "/Applications/Video Wall Browser.app"
```

lalu buka seperti biasa (atau klik-kanan → *Open*).

## Pemakaian singkat

- Jendela wall tampil layar penuh di setiap monitor; jendela **Operator** untuk preset, rotasi/jadwal, banner, dan pengaturan.
- **Ctrl+E** Mode Atur / Mode Tampil · **Ctrl+Alt+O** tampilkan Operator · **Ctrl+Alt+W** tampilkan wall · **Ctrl+Alt+Q** keluar.
- Panel web berperilaku seperti tab browser: ← → ⟳ ⌂ dan ⧉ buka di panel baru.
