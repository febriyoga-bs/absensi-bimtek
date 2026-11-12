# Absensi BIMTEK Revitalisasi SD

Web absensi untuk **peserta** dan **panitia**, menggunakan **foto dari kamera realtime** dan **geotagging GPS**, dengan beberapa lapis deteksi **Fake GPS**.

Stack: React (Vite) + Node.js/Express + PostgreSQL.

## Halaman

| URL | Fungsi |
|---|---|
| `/` | Beranda: pilih Absen Peserta / Absen Panitia |
| `/absen/peserta` | Absensi peserta (tema biru) |
| `/absen/panitia` | Absensi panitia (tema hijau) |
| `/admin` | Rekap realtime per sesi, unduh CSV |
| `/admin/pendampingan` | Rekap seluruh venue untuk Admin Utama dan LO. Unduhan CSV tersedia untuk Admin Utama |
| `/admin/pendampingan/saya` | Daftar fasilitator, sekolah, dan ruangan untuk akun LO yang sedang masuk |
| `/admin/absensi` | Verifikasi foto + tanda Fake GPS, sahkan/tolak, log percobaan yang diblokir |
| `/admin/sesi` | Jadwal sesi (masuk/pulang, untuk peserta/panitia/semua) |
| `/admin/orang` | Data peserta & panitia (bisa dikunci ke venue tertentu), impor CSV / tempel dari Excel |
| `/admin/orang/sinkronisasi` | Pratinjau dan penerapan daftar absensi Bendahara dan Pengawas revisi 8 |
| `/admin/venue` | **Banyak venue**: koordinat, radius, aktif/nonaktif |
| `/admin/pengaturan` | Nama acara, penyelenggara, tanggal, akurasi GPS maks |

## Multi venue

Venue yang berlaku untuk seseorang dihitung dari **venue aktif ∩ venue sesi ∩ venue orang**:

| Pengaturan | Hasil |
|---|---|
| Sesi tanpa venue, orang tanpa venue | Absen di venue aktif mana saja |
| Sesi dibatasi ke venue A dan B | Hanya di A atau B |
| Orang dikunci ke venue B | Hanya di B (meskipun sesi berlaku untuk semua venue) |

Server memilih venue terdekat yang radiusnya mencakup posisi peserta. Venue yang sudah dipakai absen tidak bisa dihapus; nonaktifkan saja.

## Akun LO per venue

Admin utama membuat akun LO di menu **Akun LO**, berisi nama, username, password, dan venue. LO login di `/admin/login` lewat tab **LO Venue**, lalu hanya bisa:
- melihat **Rekap** untuk venue-nya,
- **memverifikasi** (sahkan atau tolak) absensi di venue-nya,
- mengunduh **CSV** venue-nya.

Menu Peserta, Sesi, Venue, Akun LO, dan Pengaturan hanya untuk Admin Utama. Menu Daftar Pendampingan menampilkan fasilitator, sekolah, dan ruangan yang ditugaskan ke akun LO tersebut. LO perlu login ulang setelah penempatan venuenya berubah.

Di **Absenkan Peserta**, akun LO langsung melihat tabel **Binaan saya** untuk sekolah dan fasilitator, serta **Venue saya** untuk Dinas Pendidikan dan BB/BPMP. Pilihan **Semua peserta** menampilkan daftar lengkap. LO dapat mencatat kehadiran atau status berhalangan untuk Bendahara, Pengawas, dan Fasilitator binaannya serta peserta Dinas Pendidikan dan BB/BPMP di venue sendiri. Verifikasi kehadiran oleh LO mengikuti penugasan. Admin Utama dapat mencatat absensi seluruh kategori. Profil Fasilitator dan perwakilan instansi dimuat saat impor pemetaan Bimtek Pelaporan 3.

## Impor pembagian Bimtek Pelaporan 3 revisi 8

Pasang `openpyxl` di lingkungan Python. Dari folder proyek, ekstrak pemetaan dan daftar peserta, jalankan migrasi, lalu simulasikan impor.

```bash
python server/scripts/readBimtek3.py "lokasi/berkas.xlsx" data/bimtek3-pemetaan.local
npm run migrate
npm --prefix server run import-bimtek3 -- --input ../data/bimtek3-pemetaan.local --dry-run
```

Terapkan impor ke database yang dikonfigurasi di `server/.env`.

```bash
npm --prefix server run import-bimtek3 -- --input ../data/bimtek3-pemetaan.local --credentials ../data/bimtek3-kredensial-lo.local
```

Akun baru memakai username seperti `LO1.Febriyoga` dan mendapat kata sandi acak masing-masing. Berkas kredensial diabaikan oleh Git. Bagikan tiap kata sandi hanya kepada pemilik akunnya. Impor biasa mempertahankan username dan kata sandi akun yang cocok. Periksa titik dan radius venue baru di menu **Venue** sebelum mengaktifkan absensi mandiri.

Untuk mengganti login seluruh LO dalam rekap, set `BIMTEK_LO_PASSWORD` di lingkungan shell dan tambahkan `--reset-lo-logins` pada perintah impor. Gunakan nama berkas keluaran yang baru. Berkas keluaran mode ini berisi daftar username dan venue.

**Rekap Pendampingan** menampilkan salinan pembagian dari Excel untuk Admin Utama dan LO. Klik angka pada tab **LO** untuk membuka daftar fasilitator, sekolah, koordinator, atau pengawas di baris tersebut. Admin Utama dapat memilih tab dan filter, lalu memakai **Unduh CSV sesuai filter** untuk mengekspor seluruh hasil pencarian.

Dari **Peserta & Panitia**, buka **Pratinjau Sinkronisasi Absensi** untuk memeriksa peserta baru, perubahan penempatan, dan usulan arsip. Sinkronisasi mencakup Bendahara dan Pengawas yang terhubung ke NPSN. Data dengan identitas yang meragukan masuk ke **Perlu diperiksa**. Jalankan **Terapkan Sinkronisasi** di luar sesi absensi peserta. Arsip dapat dilihat lewat filter **Status peserta** dan tetap terhubung dengan riwayat kehadiran.

## Data peserta (Bendahara & Pengawas)

### Impor Progres Laporan Sekolah

Menu **Pantau Pelaporan → Impor status BIMTEK TAHAP 3** mengenali CSV Progres Laporan Sekolah dari kolom `NPSN`, `Capaian (%)`, `L7 Capaian 50% Terisi`, `L8 Capaian 50% Terkirim`, dan `R6 Capaian 50% Direviu`. Hanya sekolah dalam pemetaan yang diperbarui; baris di luar cakupan dilewati dan sekolah yang tidak tercantum tetap. Browser hanya mengirim lima kolom ini, tanpa NIK atau kontak. Nilai `Direviu` tidak otomatis menjadi `Diterima`; hasil reviu dan tanggal kirim sebelumnya tetap tersimpan. Sumber paling baru antara impor progres dan impor status reviu digunakan untuk tampilan. Jalankan `npm run migrate` sebelum deploy untuk membuat tabel `school_progress_report`. Popup hasil menampilkan sekolah diperbarui/dilewati, terkirim, direviu, dan siap kirim.

Impor Rekap Kehadiran menggunakan sheet **Ringkasan** sebagai acuan angka per venue dan peran, serta **Detail Peserta** untuk daftar dan pencocokan profil. Jumlah Pengawas pada Ringkasan adalah akun terdaftar, bukan undangan. Kolom Tiba pada dashboard menghitung yang selesai/sudah tiba di luar antrean; kolom Sudah Tiba pada Ringkasan sumber mencakup antrean, sehingga importer mengurangkan antrean sekali. Jalankan migrasi sebelum men-deploy perubahan importer (`source_summary`). Impor tidak mengganti identitas peserta atau riwayat absensi; profil yang tidak cocok harus diperiksa terpisah.

File **Pemetaan Sekolah** (CSV dari Excel) bisa langsung diimpor di *Peserta & Panitia → Pilih file CSV…*. Formatnya dikenali otomatis:

- **Bendahara**: 1 orang per sekolah, kode `B-<NPSN>`.
- **Pengawas**: dikelompokkan per kolom *Pengawas — Nama Gabungan*, karena satu pengawas bisa membawahi beberapa sekolah. Kodenya `P-<NPSN terkecil>`. Saat absen, `P-<NPSN sekolah binaan mana pun>` juga diterima. Tanda hubung boleh tidak diketik.
- **Perencana** (tidak diundang) dan nama "(BELUM ADA)" dilewati.
- Kolom NPSN, region, ruangan, peringkat, provinsi, kab/kota, PTN, koor/fasil pelaporan, dan status penggabungan nama ikut disimpan, lalu tampil di tabel, filter, dan ekspor CSV.
- Nama hotel dipetakan ke nama venue yang sama dengan data LO (mis. *Mercure Harmoni* → *Grand Mercure Jakarta Harmoni*). Buat venue dengan nama itu terlebih dahulu, lalu impor ulang untuk menautkan venue.
- Pengawas yang terdaftar di lebih dari satu hotel dibuat bebas venue dan diberi catatan untuk dicek.

Hasil konversinya juga tersedia di `data/peserta-bendahara-pengawas.csv`: 2.031 Bendahara + 1.559 Pengawas.

## Alur absen

1. Peserta/panitia memasukkan **kode** → server mengecek kode terdaftar, perannya sesuai halaman, ada sesi yang sedang dibuka, dan orang tersebut belum absen. Server lalu memberi token absen yang berlaku 5 menit.
2. Kamera depan terbuka (tidak ada opsi unggah dari galeri) dan GPS dipantau terus untuk mengumpulkan beberapa sampel.
3. **Ambil Foto**: watermark berisi nama, waktu, koordinat, dan kode unik dibakar ke foto.
4. **Kirim**: server memvalidasi lalu menyimpan absen dengan status `valid`, `review`, atau menolaknya.

## Lapisan anti Fake GPS

Browser **tidak bisa** membaca langsung apakah aplikasi Fake GPS terpasang (itu hanya bisa dilakukan aplikasi Android native). Karena itu sistem ini memakai beberapa lapisan, dan semuanya dinilai di **server**:

| Lapisan | Hasil |
|---|---|
| Jarak dari venue > radius (dihitung server dengan haversine dari median sampel) | **Ditolak** |
| Akurasi GPS lebih buruk dari batas | **Ditolak** |
| Token kedaluwarsa atau sesi sudah ditutup | **Ditolak** |
| Sampel koordinat identik persis (GPS asli selalu bergoyang) | Perlu dicek |
| Koordinat ≤ 4 desimal (diketik manual) | Perlu dicek |
| Lokasi melompat jauh antar-sampel, atau kecepatan tidak wajar | Perlu dicek |
| "Teleport": lokasi absen sebelumnya mustahil dicapai | Perlu dicek |
| Satu HP dipakai beberapa orang dalam satu sesi (titip absen) | Perlu dicek |
| Kamera virtual (OBS, ManyCam, DroidCam, dll.) atau browser otomatis | Perlu dicek |
| Akurasi tinggi tanpa altitude, timestamp GPS janggal, jam HP tidak sinkron | Sinyal lemah (bobot 1) |

Absen yang skor tandanya ≥ 2 masuk status **review**, dan panitia memeriksa fotonya di `/admin/absensi`. Percobaan yang ditolak dicatat di tab *Percobaan diblokir*.


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

## Persiapan acara (checklist)

1. Jalankan `npm run migrate` setiap kali ada update skema (misalnya fitur Akun LO).
2. **Pengaturan**: isi nama acara, penyelenggara, dan tanggal acara.
2. **Venue**: tambah setiap lokasi. Koordinat bisa ditempel dari Google Maps atau diambil dengan "Pakai lokasi saya" saat berada di venue. Radius 100–200 m cocok untuk hotel atau aula.
3. **Peserta & Panitia**: impor CSV dengan format `kode,nama,peran,instansi,jabatan,telepon,venue`. Kolom venue berisi nama venue persis, atau dikosongkan agar bebas.
4. **Sesi**: buat sesi masuk/pulang per hari, misalnya panitia dibuka 06.30 dan peserta 07.30–09.00. Sesi bisa dibatasi ke venue tertentu.
5. Bagikan link `/absen/peserta` dan `/absen/panitia` (bisa dibuat QR code).
6. Pantau `/admin` dan cek absen berstatus *Perlu dicek* di `/admin/absensi`.
