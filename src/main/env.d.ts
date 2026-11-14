/** Impor isi berkas sebagai teks (fitur Vite), dipakai halaman kendali jarak jauh. */
declare module '*?raw' {
  const content: string
  export default content
}
