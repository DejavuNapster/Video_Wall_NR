/**
 * Entry preload SATU-SATUNYA (satu file self-contained).
 *
 * Latar: ketiga jendela memakai `sandbox: true`. Preload ter-sandbox hanya
 * boleh `require` modul bawaan 'electron' — ia TIDAK bisa memuat file chunk
 * terpisah. Dengan tiga entry preload (operator/wall/video), Rollup memecah
 * modul bersama `@shared/ipc` menjadi `chunks/ipc-*.js`; preload langsung
 * melempar saat dimuat sehingga `window.operatorApi`, `window.wallApi`, dan
 * `window.videoApi` tak pernah ter-expose. Gejala di UI: tombol "Simpan" dan
 * "Simpan & Terapkan ke Wall" gagal dengan
 * "Cannot read properties of undefined (reading 'savePreset')".
 *
 * Satu entry → satu file tanpa dependensi chunk → aman di preload sandbox.
 * Ketiga bridge tetap terpisah per API (operator.ts, wall.ts, video.ts) dan
 * di-expose semuanya; tiap jendela hanya memakai key yang ia butuhkan.
 */
import './operator'
import './wall'
import './video'
