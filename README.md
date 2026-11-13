# Dashboard LO BIMTEK Revitalisasi SD

Sistem pendampingan sekolah, pemantauan Laporan 50%, kedatangan peserta, dan absensi resmi. Stack: React/Vite, Node.js/Express, PostgreSQL; penyimpanan foto melalui Cloudflare R2 atau direktori lokal.

## Versi tampilan

Pilihan **Classic / Modern** tersedia di bagian atas semua halaman. Classic menggunakan desain sebelumnya; Modern menggunakan navigasi terang, aksen hijau, kartu ringkasan dan tabel yang diperbarui. Modern menjadi pilihan awal jika belum ada preferensi. Pilihan disimpan per browser dan tidak mengubah data, hak akses, atau alur absensi. Jika penyimpanan browser dibatasi, pilihan berlaku selama halaman tetap terbuka.

## Alur penggunaan

1. LO login di `/admin/login` menggunakan username dan kata sandi akun LO.
2. Setelah login, **Pantau Pelaporan** menjadi halaman awal. Lihat sekolah binaan, fasilitator, ruangan, dan status laporan; gunakan filter venue/LO untuk mengubah cakupan.
3. Buka **Absenkan Peserta**. Filter **LO bertugas** secara default memilih akun yang login. Pilih LO lain atau Semua LO untuk melihat daftar lain; kewenangan mencatat tetap mengikuti penugasan.
4. Pada tab Sekolah, gunakan **Jabatan peserta** untuk Bendahara & Pengawas, Bendahara saja, atau Pengawas saja. Filter venue, fasilitator, status absensi, kedatangan, dan pencarian dapat digabungkan.
5. Saat sesi aktif, pilih peserta, ambil foto kamera, tulis catatan, lalu kirim. Status Mundur/Berhalangan Hadir tidak memerlukan foto; peserta yang kemudian hadir dapat dicatat kembali dengan foto pada sesi yang sama.
6. LO melakukan absensi dirinya sendiri di **Absen Saya**, menggunakan foto kamera dan GPS di venue penugasan.
7. Admin mengimpor laporan terbaru dan rekap kedatangan, mengelola data kegiatan, serta memeriksa absensi.

**Absensi mandiri peserta/panitia publik dan scan QR untuk pencatatan saat ini dinonaktifkan.** URL `/absen/peserta` dan `/absen/panitia` bukan halaman aktif. Kartu identitas QR dan ekspor tautannya masih tersedia, tetapi peserta cukup menunjukkan nama atau kode kepada LO. Admin utama melihat **Daftar Peserta**; pencatatan kehadiran peserta dilakukan oleh akun LO.

## Halaman dan hak akses

| URL | Fungsi | Akses |
|---|---|---|
| `/` | Beranda, panduan, venue, tautan masuk | Publik |
| `/dashboard/pelaporan` | Monitoring pelaporan Tahap 3 dan arsip Tahap 2 | Publik |
| `/dashboard/absensi` | Ringkasan absensi harian dan rincian nama | Publik |
| `/dashboard/kehadiran` | Ringkasan kedatangan dari impor | Publik |
| `/qr/:token` | Kartu identitas pribadi, simpan gambar | Pemilik tautan |
| `/admin/login` | Login LO atau admin utama | Publik |
| `/admin` | Mengarahkan ke Pantau Pelaporan sebagai halaman awal | Admin dan LO |
| `/admin/rekap-absensi` | Rekap absensi resmi per sesi dan venue, CSV | Admin dan LO sesuai cakupan |
| `/admin/kehadiran` | Rekap kedatangan, rincian nama | Admin dan LO; impor hanya admin |
| `/admin/scan` | Absenkan Peserta (LO) / Daftar Peserta (admin) | Admin dan LO |
| `/admin/absen-saya` | Absensi LO dengan foto dan GPS | LO |
| `/admin/absensi` | Foto, lokasi, status, catatan, verifikasi, penghapusan, CSV/cetak PDF | Sesuai kewenangan |
| `/admin/absensi/foto/:id` | Foto absensi yang memerlukan login | Sesuai cakupan venue |
| `/admin/pelaporan` | Progres, antrean reviu, absensi Bendahara, peringkat | Admin dan LO; impor hanya admin |
| `/admin/password` | Ganti kata sandi sendiri | LO |
| `/admin/sesi` | Sesi resmi/uji coba, jadwal dan cakupan venue | Admin |
| `/admin/orang` | Profil peserta/panitia, impor CSV dan kartu identitas | Admin |
| `/admin/orang/sinkronisasi` | Pratinjau tambah/ubah/arsip peserta | Admin |
| `/admin/venue` | Koordinat, radius, aktif/nonaktif | Admin |
| `/admin/lo` | Akun LO, penempatan, password, aktivitas login | Admin |
| `/admin/pengaturan` | Identitas acara, akurasi GPS, kebijakan sesi | Admin |

Menu Pendampingan dihapus karena informasi sekolah, fasilitator, dan ruangan tersedia di Pantau Pelaporan. Tautan lama `/admin/pendampingan` dan `/admin/pendampingan/saya` diarahkan ke `/admin/pelaporan`. Kontak tetap dibatasi sesuai penugasan. Perubahan venue akun LO memerlukan login ulang; akun nonaktif ditolak oleh server.

## Arti angka dan sumber data

- **Kedatangan** berasal dari Excel eksternal, bukan transaksi absensi. Sudah tiba dan Sedang antre merupakan kelompok terpisah pada rekap kedatangan. Angka sumber Sudah Tiba yang mencakup antrean dikurangi antrean sekali saat impor.
- **Sekolah hadir di venue** pada pelaporan mencakup sudah tiba atau sedang antre, berdasarkan profil Bendahara.
- **Sudah absen** mencakup status `valid` dan `review`; review masih perlu diperiksa. Ditolak dan berhalangan tidak dihitung hadir.
- **Absensi sekolah per hari** pada pelaporan mengacu pada Bendahara sekolah, bukan seluruh wakil sekolah.
- **Per sesi** menghitung catatan pada sesi tersebut. Ringkasan venue menghitung setiap orang sekali per venue untuk hari/cakupan yang dipilih.
- **Peringkat pencatatan LO** mencakup absensi yang dicatat LO dan status berhalangan; ini ukuran kelengkapan pencatatan, bukan persentase kehadiran.
- Dashboard diperbarui saat dibuka atau melalui **Muat ulang**; bukan pembaruan otomatis realtime. Dashboard publik dapat menggunakan cache singkat.
- Tabel Pantau Pelaporan (Sekolah, Fasilitator, Wilayah, dan rincian sekolah fasilitator) dapat diurutkan dengan klik judul kolom. Klik lagi membalik urutan. Pengurutan berlaku untuk seluruh hasil sebelum pagination; progres diurutkan sebagai angka dan data kosong diletakkan terakhir.
- Tanggal pelaporan/absensi harian masih dikonfigurasi di `server/src/reportingDays.js`. Mengubah tanggal acara berbentuk teks pada Pengaturan tidak mengubah daftar hari tersebut.

## Impor laporan terbaru

Admin membuka **Pantau Pelaporan → BIMTEK TAHAP 3 → Impor laporan terbaru**. Pilih CSV lalu tekan **Impor laporan terbaru**. Popup menampilkan tahapan membaca file, mengenali format, dan validasi/penyimpanan server. Indikator berjalan tanpa persentase perkiraan; popup tidak dapat ditutup dengan Escape saat proses berlangsung.

Setelah selesai, popup merangkum jenis file, baris diperiksa, sekolah diperbarui/dilewati, sekolah di luar CSV yang tetap atau ditandai belum kirim, serta kontak yang dilengkapi. File status reviu/ringkas menampilkan jumlah per status; file progres menampilkan terkirim, direviu, dan siap kirim. Jika gagal, pesan kesalahan tetap ditampilkan dan file dapat diperbaiki lalu dicoba lagi. Jika koneksi terputus saat penyimpanan, muat ulang dashboard untuk memastikan hasil server.

| Format | Kolom utama | Perilaku |
|---|---|---|
| Progres Laporan Sekolah | `NPSN`, `Capaian (%)`, `L7 Capaian 50% Terisi`, `L8 Capaian 50% Terkirim`, `R6 Capaian 50% Direviu` | Memperbarui sekolah yang ada dalam file dan pemetaan. Sekolah di luar file tetap. Browser hanya mengirim lima kolom; NIK dan kontak tidak dikirim dari format ini. |
| Monitoring status reviu lengkap | `NPSN`, `Status Reviu`, `Tanggal Kirim`, `Capaian Saat Ini (%)` | Snapshot lengkap: sekolah pemetaan yang tidak ada dalam file ditandai Belum kirim. Kontak fasilitator/pengawas dapat dilengkapi jika cocok dan profil masih kosong. |
| Status ringkas | `npsn`, `status`, `tanggal_kirim`, `progres_fisik` | Memperbarui baris dalam file; NPSN di luar pemetaan menyebabkan impor ditolak. Status: `belum_kirim`, `menunggu_reviu`, `ditolak`, `diterima`. |

Gunakan file sumber terbaru: pemilihan sumber status memperhitungkan waktu impor, sehingga file lama yang diunggah belakangan dapat mengganti tampilan data. Impor progres mempertahankan hasil reviu dan tanggal kirim tersimpan; **direviu tidak otomatis berarti diterima**. Ringkasan status adalah cakupan sekolah yang diperbarui pada impor tersebut, bukan seluruh dashboard.

Jalankan migrasi sebelum deploy perubahan skema, termasuk tabel `school_progress_report` dan kolom `source_summary` rekap kedatangan.

## Impor kedatangan dan profil

**Rekap Kehadiran → Impor Rekap Kehadiran (.xlsx)** memerlukan sheet **Ringkasan** dan **Detail Peserta**. Ringkasan menjadi acuan angka venue/peran; Detail Peserta menjadi daftar dan bahan pencocokan profil. Jumlah Pengawas pada Ringkasan adalah akun terdaftar, bukan undangan. Impor tidak mengganti identitas atau riwayat absensi; profil yang tidak cocok diperiksa terpisah.

**Peserta & Panitia** mendukung CSV `kode,nama,peran,instansi,jabatan,telepon,venue` dan pemetaan sekolah. Kode yang sama diperbarui. Nama venue harus cocok agar tertaut. Bendahara memakai kode `B-<NPSN>`; Pengawas dikelompokkan menurut nama gabungan dan dapat terkait beberapa NPSN. Perencana yang tidak diundang dan nama `(BELUM ADA)` dilewati. NPSN, wilayah, ruangan, PTN dan data fasilitator ikut disimpan.

**Pratinjau Sinkronisasi Absensi** menampilkan tambahan, perubahan, usulan arsip dan data perlu diperiksa sebelum penerapan. Cakupannya Bendahara/Pengawas yang terkait NPSN. Jalankan di luar sesi aktif. Pengarsipan mempertahankan riwayat; penghapusan permanen profil/sesi dapat menghapus absensi terkait.

## Impor pemetaan Bimtek Pelaporan 3

Pasang `openpyxl`, ekstrak file Excel, migrasikan, lalu simulasikan:

```bash
python server/scripts/readBimtek3.py "lokasi/berkas.xlsx" data/bimtek3-pemetaan.local
npm run migrate
npm --prefix server run import-bimtek3 -- --input ../data/bimtek3-pemetaan.local --dry-run
```

Terapkan ke database yang dikonfigurasi di `server/.env`:

```bash
npm --prefix server run import-bimtek3 -- --input ../data/bimtek3-pemetaan.local --credentials ../data/bimtek3-kredensial-lo.local
```

Akun baru menggunakan username seperti `LO1.Febriyoga` dengan password acak. Berkas kredensial diabaikan Git; bagikan tiap password hanya kepada pemiliknya. Impor biasa mempertahankan login akun yang cocok. Untuk reset seluruh login, set `BIMTEK_LO_PASSWORD` dan tambahkan `--reset-lo-logins`, dengan berkas keluaran baru. Periksa koordinat/radius venue sebelum memakai absensi GPS.

## Kebijakan absensi dan GPS

Absensi peserta oleh LO memakai foto kamera dan catatan; venue berasal dari akun LO. LO menangani Bendahara/Pengawas/Fasilitator binaannya, serta Dinas Pendidikan dan BB/BPMP di venue sendiri. Melihat daftar LO lain tidak memberikan hak mencatat. Absensi ganda per orang/sesi ditolak.

Absensi mandiri LO menggunakan token singkat, foto dan sampel GPS. Venue yang diizinkan merupakan irisan venue aktif, cakupan sesi, dan venue profil. Lokasi jelas di luar area atau akurasi terlalu buruk ditolak. Akurasi di atas batas otomatis dapat masuk review jika lokasi masih mungkin di area venue. Sinyal seperti koordinat statis, lompatan lokasi, perangkat dipakai bergantian, atau kamera virtual menambah skor pemeriksaan. Skor minimal 2 masuk review. Browser tidak dapat memastikan aplikasi Fake GPS terpasang; indikator ini merupakan bahan pemeriksaan, bukan bukti pasti pemalsuan.

Venue yang sudah dipakai absensi tidak dapat dihapus; nonaktifkan. Jika opsi **Maksimal satu sesi resmi per hari** aktif, batas berlaku lintas venue/peran menurut tanggal WIB; gunakan peran Semua untuk peserta dan panitia. Sesi uji coba dikecualikan dan tidak masuk rekap resmi.

## Menjalankan (development)

```bash
# 1. Database
createdb absensi_bimtek

# 2. Konfigurasi
cp server/.env.example server/.env   # isi DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD

# 3. Install & jalankan
npm run install:all
npm run dev:server     # http://localhost:3000 (tabel dibuat otomatis)
npm run dev:client     # http://localhost:5173
```

> Kamera dan GPS di HP **hanya berfungsi lewat HTTPS** (kecuali `localhost`). Untuk mencoba dari HP saat development, pakai tunnel seperti `cloudflared tunnel --url http://localhost:5173` atau `ngrok http 5173`.

## Deploy ke Vercel + Supabase + Cloudflare R2

### 1. Supabase (database)
1. Buat project baru. Pilih region **Singapore** (`ap-southeast-1`) supaya dekat dengan region function Vercel.
2. Buka **Connect** → **Transaction pooler** (port **6543**) dan salin URI-nya.
3. Buat tabel dengan menjalankan migrasi sekali dari komputer Anda:
   ```bash
   # server/.env berisi DATABASE_URL pooler + PGSSL=true
   npm --prefix server install
   npm run migrate
   ```
   Skema sudah mengaktifkan **RLS** di semua tabel, jadi data tidak bisa dibaca lewat API publik Supabase (anon key). Server tetap bisa mengakses karena terhubung sebagai `postgres`.

### 2. Cloudflare R2 (foto)
1. Buka **R2** → **Create bucket**, misalnya `absensi-bimtek`. Biarkan **privat** (jangan aktifkan public access).
2. Buka **R2** → **Manage API tokens** → **Create API token** dengan izin *Object Read & Write* untuk bucket itu saja.
3. Catat **Account ID**, **Access Key ID**, dan **Secret Access Key**.

Admin melihat foto lewat *signed URL* yang berlaku 1 jam, jadi foto tidak pernah terbuka untuk publik. Bucket tidak perlu diatur CORS-nya karena upload dilakukan oleh server.

### 3. Vercel
1. Push repo ke GitHub, lalu di Vercel pilih **Import Project** dengan root = folder ini. Pengaturan build sudah diatur oleh `vercel.json`.
2. Buka **Settings** → **Functions** → **Region** dan pilih `sin1` (Singapore).
3. Isi **Environment Variables**: `DATABASE_URL`, `PGSSL=true`, `PG_POOL_MAX=3`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `JWT_SECRET`, `ADMIN_PASSWORD`. Lihat `server/.env.example`.
4. Klik Deploy. HTTPS langsung aktif, jadi kamera dan GPS di HP langsung berfungsi.

### Kapasitas
- Diuji dengan **800 orang absen dari 1 IP yang sama** (simulasi WiFi venue) dengan 50 koneksi paralel. Hasilnya: semuanya berhasil, p95 di bawah 0,5 detik.
- Foto sekitar 30–60 KB (480 px), sehingga 800 orang hanya sekitar 40 MB. Bandwidth WiFi atau sinyal di venue biasanya menjadi batas yang lebih dulu tercapai.
- Batas koneksi klien pooler Supabase tergantung paket (lihat **Database** → **Settings** → **Connection pooling**). Kalau saat puncak muncul error koneksi, turunkan `PG_POOL_MAX` ke 2 atau naikkan paket compute.
- Rate limit: cek kode dibatasi longgar per IP (`IP_RATE_LIMIT`, default 2000/menit, karena satu WiFi = satu IP). Percobaan gagal dibatasi **per orang** (10 kali per 10 menit) di database.
- Paket Vercel Hobby hanya untuk penggunaan non-komersial. Untuk acara resmi, pertimbangkan paket Pro.

### Alternatif: VPS
```bash
npm run install:all && npm run build
npm start            # Express menyajikan API + build React di port $PORT
```
Jalankan di belakang Caddy/Nginx dengan HTTPS. Kalau `R2_BUCKET` dikosongkan, foto disimpan ke `UPLOAD_DIR`.

## Persiapan acara

1. Jalankan `npm run migrate` setelah perubahan skema.
2. Atur identitas acara dan kebijakan sesi di Pengaturan. Cocokkan hari rekap di `reportingDays.js`.
3. Periksa venue aktif, koordinat dan radius GPS.
4. Impor pemetaan/profil; pratinjau sinkronisasi dan selesaikan data yang perlu diperiksa.
5. Buat akun LO dan pastikan penempatan sesuai pemetaan.
6. Buat sesi resmi; jika satu sesi per hari aktif, gunakan peran Semua. Gunakan sesi uji coba untuk latihan.
7. Bagikan URL login kepada LO. Peserta menemui LO dengan nama/kode; scan QR dan absensi mandiri peserta tidak aktif.
8. Impor laporan terbaru dan kedatangan, baca ringkasan popup, lalu muat ulang rekap jika diperlukan.
9. Periksa status Perlu dicek, kelengkapan catatan/foto, dan unduh rekap sesuai kebutuhan.
