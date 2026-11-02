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
| `/admin/absensi` | Verifikasi foto + tanda Fake GPS, sahkan/tolak, log percobaan yang diblokir |
| `/admin/sesi` | Jadwal sesi (masuk/pulang, untuk peserta/panitia/semua) |
| `/admin/orang` | Data peserta & panitia (bisa dikunci ke venue tertentu), impor CSV / tempel dari Excel |
| `/admin/venue` | **Banyak venue**: koordinat, radius, aktif/nonaktif, layar kode per venue |
| `/admin/pengaturan` | Nama acara, penyelenggara, tanggal, akurasi GPS maks, wajib kode venue |
| `/admin/kode-venue?venue=ID` | Layar kode 6 digit per venue yang berganti tiap 30 detik (tampilkan di proyektor/TV) |

## Multi venue

Venue yang berlaku untuk seseorang dihitung dari **venue aktif ∩ venue sesi ∩ venue orang**:

| Pengaturan | Hasil |
|---|---|
| Sesi tanpa venue, orang tanpa venue | Absen di venue aktif mana saja |
| Sesi dibatasi ke venue A dan B | Hanya di A atau B |
| Orang dikunci ke venue B | Hanya di B (meskipun sesi berlaku untuk semua venue) |

Server memilih venue terdekat yang radiusnya mencakup posisi peserta. Bila **Kode Venue** diwajibkan, kode dicek terhadap venue tersebut, karena tiap venue punya layar kodenya sendiri. Venue yang sudah dipakai absen tidak bisa dihapus; nonaktifkan saja.

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
| **Kode venue** salah (bila diwajibkan) | **Ditolak** |
| Token kedaluwarsa atau sesi sudah ditutup | **Ditolak** |
| Sampel koordinat identik persis (GPS asli selalu bergoyang) | Perlu dicek |
| Koordinat ≤ 4 desimal (diketik manual) | Perlu dicek |
| Lokasi melompat jauh antar-sampel, atau kecepatan tidak wajar | Perlu dicek |
| "Teleport": lokasi absen sebelumnya mustahil dicapai | Perlu dicek |
| Satu HP dipakai beberapa orang dalam satu sesi (titip absen) | Perlu dicek |
| Kamera virtual (OBS, ManyCam, DroidCam, dll.) atau browser otomatis | Perlu dicek |
| Akurasi tinggi tanpa altitude, timestamp GPS janggal, jam HP tidak sinkron | Sinyal lemah (bobot 1) |

Absen yang skor tandanya ≥ 2 masuk status **review**, dan panitia memeriksa fotonya di `/admin/absensi`. Percobaan yang ditolak dicatat di tab *Percobaan diblokir*.

> **Rekomendasi:** aktifkan **Wajibkan Kode Venue** dan tampilkan `/admin/kode-venue` di layar meja registrasi. Ini satu-satunya lapisan yang tidak bisa diakali Fake GPS, karena kodenya hanya terlihat oleh orang yang benar-benar ada di ruangan. Foto wajah ber-watermark menjadi bukti tambahan.

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

1. **Pengaturan**: isi nama acara, penyelenggara, dan tanggal acara.
2. **Venue**: tambah setiap lokasi. Koordinat bisa ditempel dari Google Maps atau diambil dengan "Pakai lokasi saya" saat berada di venue. Radius 100–200 m cocok untuk hotel atau aula.
3. **Peserta & Panitia**: impor CSV dengan format `kode,nama,peran,instansi,jabatan,telepon,venue`. Kolom venue berisi nama venue persis, atau dikosongkan agar bebas.
4. **Sesi**: buat sesi masuk/pulang per hari, misalnya panitia dibuka 06.30 dan peserta 07.30–09.00. Sesi bisa dibatasi ke venue tertentu.
5. Bagikan link `/absen/peserta` dan `/absen/panitia` (bisa dibuat QR code), lalu buka **Layar kode** untuk setiap venue di TV atau proyektornya.
6. Pantau `/admin` dan cek absen berstatus *Perlu dicek* di `/admin/absensi`.
