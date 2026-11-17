# Satu skema dan tab kegiatan

Runtime mendukung tabel lama sebelum cutover dan tabel `public.event_*` setelah cutover. Setiap tabel operasional baru memiliki `event_id`. Primary key, unique key, dan foreign key menyertakan kegiatan, sehingga ID sesi/peserta yang sama pada dua tahap tidak tertukar. SQL internal tetap memakai nama domain (`people`, `sessions`, dan seterusnya), lalu adapter penyimpanan mengarahkannya ke tabel baru dan menyesuaikan target upsert.

Setiap transaksi runtime memakai role `bimtek_app` yang bukan pemilik tabel dan tidak memiliki `BYPASSRLS`. Policy membatasi baca dan tulis berdasarkan `SET LOCAL app.event_id`. Pemisahan tidak hanya mengandalkan filter tampilan. Koneksi administratif hanya dipakai untuk migrasi, metadata kegiatan, dan pencarian kredensial yang memiliki kondisi kegiatan eksplisit.

## Hasil untuk pengguna

- Login sekali, lalu tab Tahap 4, Tahap 3, dan Tahap 2 tersedia.
- Tahap 2 berasal dari arsip pelaporan yang sudah tersedia, bukan data absensi yang dibuat-buat.
- LO dapat membaca ringkasan tahap lain. Jika tidak ada penugasan, aplikasi memberi keterangan dan membatasi aksi pencatatan serta rincian pribadi.
- Menu verifikasi absensi, rekap kehadiran, dan peta pada sidebar tetap hanya untuk admin utama.
- Foto R2, token QR, ID dan pemetaan JSON dipertahankan. File foto tidak dipindahkan.

## Pemeriksaan sebelum cutover

Dari direktori `server`:

```powershell
npm test
npm run migrate:unify -- --snapshot-only
```

Backup terkompresi disimpan di `data/backups/` dan diabaikan Git karena memuat data pribadi dan hash kredensial. Simpan backup secara privat. Snapshot memakai transaksi konsisten; jumlah dan checksum setiap tabel diverifikasi saat migrasi. Pengujian salinan data dilakukan menggunakan PostgreSQL lokal/in-memory, tanpa mengubah database aktif.

## Urutan penerapan

1. Deploy runtime yang kompatibel ini terlebih dahulu. Tanpa penanda `bimtek_storage.unified`, runtime masih memakai tabel lama.
2. Hentikan sementara pencatatan dan perubahan data. Pastikan request lama telah selesai. Jangan menjalankan aplikasi lama dan aplikasi baru sebagai dua penulis berbeda selama cutover.
3. Jalankan dari `server`:

```powershell
npm run migrate:unify -- --apply --runtime-ready
```

Perintah mengambil backup terbaru lagi, membuat tabel/policy/index baru, menyalin setiap kegiatan, memverifikasi checksum dan jumlah baris, lalu mengaktifkan penanda dalam satu transaksi. Jika ada kegagalan, transaksi dibatalkan. `--runtime-ready` hanya dipakai setelah langkah 1 dan 2 dipastikan.

4. Tunggu pembaruan cache mode penyimpanan (maksimal 5 detik), lalu verifikasi tiga tab, jumlah absensi, foto, QR, venue, dan hak akses LO/admin sebelum pencatatan dibuka kembali. Periksa halaman di Vercel, bukan hanya localhost.

Tanpa `--apply`, perintah menjalankan simulasi dan melakukan ROLLBACK; simulasi ini tetap mengambil lock sumber sementara, jadi jalankan di jendela pemeliharaan atau pada salinan lokal.

## Sumber lama dan rollback

Tabel lama di `public` serta skema `bimtek_4` tidak dihapus. Setelah cutover, aplikasi memakai `public.event_*`; sumber lama menjadi cadangan, bukan tempat penulisan baru. Jangan memakai skrip lokal lama yang melakukan query langsung ke tabel sumber setelah cutover. Importer resmi memakai koneksi terlingkup kegiatan.

Sebelum pencatatan dibuka kembali, rollback dapat dilakukan dengan mengembalikan `public.bimtek_storage.unified=false`, menunggu cache/restart runtime, dan memeriksa sumber lama. Setelah ada penulisan ke tabel baru, **jangan hanya mengubah penanda**: rekonsiliasi catatan baru atau pulihkan backup beserta perubahan sesudahnya agar absensi tidak hilang. Pembersihan tabel/skema cadangan adalah pekerjaan terpisah setelah masa verifikasi.
