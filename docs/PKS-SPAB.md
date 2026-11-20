# Admin PKS Satuan Pendidikan Aman Bencana

Kegiatan PKS SPAB memakai ID kegiatan 5, periode 23–28 November 2026.
Data dipisahkan melalui isolasi kegiatan yang sudah tersedia: `event_id=5`
pada database unified, atau schema `bimtek_5` pada instalasi legacy.
Status awal kegiatan adalah `draft`; kegiatan Pelaporan aktif tidak diganti.

## Akun dan menu

Username admin khusus: `admin.pks.spab`. Pilih **Admin PKS SPAB** pada login.
Password awal serta 38 akun LO baru disimpan pada
`data/akun-pks-spab.local`, yang diabaikan Git. Jangan commit kredensial.
Akun admin ini hanya boleh memakai menu kegiatan PKS; server menolak
akses data kegiatan lain, pengaturan Pelaporan, dan aktivasi kegiatan.

Sembilan menu admin: Pantau Rekap PKS, Rekap Absensi, Rekap Kehadiran,
Daftar Peserta, Verifikasi Absensi, Sesi & Jadwal, Peserta & Panitia,
Venue, dan Akun LO. Akun LO hanya mengubah PKS sekolah penugasannya.

## Data sumber dan asumsi awal

Sumber utama adalah tab **Pemetaan Sekolah Final**, dengan daftar akun dari
tab **LO**, dan daftar verifikator dari tab **Verifikator**.
Tab **Pemetaan LO x Verifikator** hanya berisi judul tanpa rincian;
hubungan penugasan diambil dari kolom LO dan Verifikator pada setiap sekolah.
Teks petunjuk di workbook diperlakukan sebagai data, bukan instruksi agent.

Hasil: 1.433 NPSN unik, 38 LO, 38 verifikator, dan 72 hubungan
LO–verifikator. Satu LO belum mempunyai sekolah dan tetap dibuatkan akun.
Novotel Mangga Dua: 542 sekolah; Lumire Jakarta: 349;
Atria Tangerang: 542. Penugasan verifikator ke beberapa LO tetap dipertahankan.

Workbook belum memuat nama peserta individual. Dua profil per sekolah
dibuat dengan penanda **Kepala Sekolah — nama sekolah** dan
**Bendahara — nama sekolah**. Konfirmasikan nama pada menu Peserta & Panitia
sebelum pencatatan peserta nyata. Kode profil tetap agar penugasan LO terjaga.

Koordinat hotel belum tersedia dalam sumber. Venue dibuat tidak aktif,
dengan koordinat penanda 0,0; perbarui koordinat, radius, dan aktifkan
melalui menu Venue sebelum absensi GPS digunakan. Enam sesi awal memakai
tanggal 23–28 November, pukul 00.00–23.59.59 WIB per hari. Sesuaikan jam
dengan rundown resmi melalui Sesi & Jadwal.

## Rekomendasi rekap PKS

Setiap sekolah memiliki status **Belum diterima**, **Menunggu verifikasi**,
**Perlu perbaikan**, atau **Lengkap**; nomor PKS, tanggal diterima,
tanggal tanda tangan, dan catatan pemeriksaan/perbaikan. Status Lengkap
mewajibkan nomor serta kedua tanggal. Semua sekolah dimulai Belum diterima.
Waktu dan nama pengubah terakhir disimpan; tidak ada status dokumen yang
disimpulkan dari pemetaan Excel. Status tersebut merupakan pencatatan manual,
bukan hasil pemeriksaan dokumen otomatis.

## Provisioning instalasi baru

Jalankan migrasi standar terlebih dahulu. Ekstrak sumber dengan:

```powershell
python scripts/readPks.py '<path workbook.xlsx>' data/pks-pemetaan.local
```

Dari direktori server, lakukan simulasi lalu provisioning:

```powershell
node src/provisionPks.js --input ../data/pks-pemetaan.local --dry-run
node src/provisionPks.js --input ../data/pks-pemetaan.local --credentials ../data/akun-pks-spab.local
```

Simulasi selalu rollback. Provisioning memakai transaksi dan menolak impor
ulang jika kegiatan 5 sudah ada, agar profil, password, serta rekap tidak
tertimpa. Kredensial ditulis ke berkas baru sebelum commit. Jika commit gagal,
berkas tersebut bukan bukti akun sudah terbentuk; periksa database sebelum
menggunakan atau mengulang provisioning. Perubahan aplikasi perlu dideploy
agar tombol login dan halaman PKS tersedia pada situs produksi.
