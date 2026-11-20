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

Pemetaan terbaru 20 November 2026: 1.433 NPSN unik, 38 LO, 51 verifikator,
108 hubungan LO–verifikator, dan 10 koordinator. Satu LO belum mempunyai sekolah dan tetap dibuatkan akun.
Novotel Mangga Dua: 542 sekolah; Lumire Jakarta: 349;
Atria Tangerang: 542. Penugasan verifikator ke beberapa LO tetap dipertahankan.

File terbaru menambahkan nama dan kontak kepala sekolah: 1.408 nama dan
1.290 kontak. Profil kepala sekolah diisi menurut NPSN; 25 sekolah tanpa
nama mempertahankan profil yang ada. Sebanyak 143 sekolah belum mempunyai
kontak pada sumber. Nomor dari sumber dinormalisasi (spasi/tanda hubung,
serta satu awalan huruf O yang seharusnya nol). Nama bendahara yang sudah
ada tetap dipertahankan karena sumber tidak menyediakan nama bendahara.
Kode, ID, QR, dan profil LO tetap dipertahankan. Koordinator disimpan
sebagai hubungan penugasan sekolah/verifikator, tanpa membuat akun baru.

Ketiga venue sudah aktif dengan radius 150 meter dan koordinat hotel yang
dicocokkan pada 20 November 2026. Koordinat dan sumber tersedia di
`server/src/pksVenues.js`; titik serta radius dapat diperbarui melalui Venue. Jadwal absensi: Senin 23 November kedatangan panitia tanpa absensi;
Selasa 24 November kedatangan peserta dengan absensi panitia saja;
Rabu 25 November Hari 1 dan Kamis 26 November Hari 2 untuk panitia dan peserta;
Jumat 27 November penutupan dengan absensi panitia saja. Panitia absen
05.00–08.00 WIB, peserta 08.00–23.00 WIB. Tidak ada sesi Sabtu 28 November.
Unduhan PKS menggabungkan sesi resmi panitia dan peserta pada tanggal WIB
yang dipilih; hari lain dan sesi uji coba tidak ikut digabung.

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

## Memperbarui pemetaan PKS yang sudah ada

Ekstraksi memakai header, bukan posisi kolom, sehingga penambahan kolom
kepala sekolah/koordinator tidak menggeser pembacaan LO dan verifikator.

```powershell
python scripts/readPks.py '<file pemetaan terbaru.xlsx>' data/pks-pemetaan-update.local
```

Dari direktori server:

```powershell
node src/updatePksMapping.js --input ../data/pks-pemetaan-update.local --dry-run
node src/updatePksMapping.js --input ../data/pks-pemetaan-update.local
```

Pembaruan membuat cadangan lokal sebelum mutasi, memeriksa keunikan profil,
menghubungkan peserta melalui NPSN, dan membangun ulang penugasan LO.
Perubahan daftar sekolah/LO atau penghapusan verifikator memerlukan pemeriksaan
tersendiri; importer berhenti bila menemukan kondisi tersebut. Status PKS,
QR, akun/password LO, venue, jadwal, dan catatan absensi diperiksa agar tetap utuh.
