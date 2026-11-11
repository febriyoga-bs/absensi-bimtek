from pathlib import Path
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.utils import ImageReader

root = Path.cwd()
out = root / 'output/pdf/Panduan-LO-Absensi-Pelaporan-50-Persen.pdf'
out.parent.mkdir(parents=True, exist_ok=True)
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleLO', fontName='Helvetica-Bold', fontSize=25, leading=29, textColor=colors.HexColor('#133b70'), spaceAfter=12))
styles.add(ParagraphStyle(name='SubLO', fontName='Helvetica-Bold', fontSize=13, leading=18, textColor=colors.HexColor('#133b70'), spaceBefore=13, spaceAfter=7))
styles.add(ParagraphStyle(name='BodyLO', fontName='Helvetica', fontSize=10.5, leading=15, spaceAfter=8))
styles.add(ParagraphStyle(name='SmallLO', fontName='Helvetica', fontSize=8.5, leading=12, textColor=colors.HexColor('#566579'), spaceAfter=7))
styles.add(ParagraphStyle(name='ExampleLO', fontName='Helvetica', fontSize=10, leading=14, spaceAfter=9))
story=[]
def p(text, style='BodyLO'): story.append(Paragraph(text, styles[style]))
def h(text): p(text,'SubLO')
def link(label,path): p(f'<link href="https://dashboardlo-bimtek.vercel.app{path}" color="#1563ad"><u>{label}</u></link>')
def footer(c,d):
    c.setStrokeColor(colors.HexColor('#dbe3ed')); c.line(42,39,553,39)
    c.setFont('Helvetica',8); c.setFillColor(colors.HexColor('#566579'))
    c.drawString(42,26,'BIMTEK Revitalisasi SD | Panduan LO | 11 November 2026')
    c.drawRightString(553,26,f'{d.page}')

p('PANDUAN LO','TitleLO')
p('Absensi &amp; pencatatan kendala<br/>Bimtek Pelaporan Progres 50%','SubLO')
p('<b>Tugas hari ini:</b> mendatangi fasilitator, bendahara, dan pengawas di ruangan masing-masing. Absensi dilakukan oleh LO yang bersangkutan sesuai daftar binaannya.')
link('Buka web Dashboard LO','/')
h('1. Login dengan akun LO')
link('Buka halaman Login LO','/admin/login')
p('Pilih <b>LO Venue</b>, masukkan username dan kata sandi yang telah dibagikan, lalu tekan <b>Masuk</b>. Periksa nama LO dan venue yang tampil.')
img=root/'docs/panduan-lo/01-login.jpg'
story.append(Image(str(img),width=245,height=271))
p('Gambar 1. Halaman login Dashboard LO.','SmallLO')
h('2. Periksa binaan dan ruangan')
link('Buka Daftar Pendampingan','/admin/pendampingan/saya')
p('Periksa fasilitator, sekolah binaan, dan ruangan penugasan. Jadikan daftar ini acuan kunjungan, lalu datangi dan temui orang yang akan diabsenkan secara langsung.')
p('Tautan menu internal memerlukan login akun LO.','SmallLO')
story.append(PageBreak())
p('Langkah absensi di ruangan','TitleLO')
h('3. Pilih orang yang akan diabsenkan')
link('Buka Absenkan Peserta','/admin/scan')
for t in [
 'Pilih <b>Sesi resmi yang sedang dibuka</b>. Pastikan bukan sesi uji coba.',
 'Gunakan cakupan <b>Binaan saya</b>.',
 'Untuk <b>bendahara dan pengawas</b>, pilih tab <b>Sekolah</b>. Cari berdasarkan nama, sekolah, NPSN, atau kode.',
 'Untuk <b>fasilitator</b>, pilih tab <b>Fasilitator</b>, lalu cari namanya.',
 'Cocokkan nama, jabatan, sekolah atau instansi, serta sesi. Tekan <b>Absenkan</b> pada orang yang sesuai.'
]: p('• '+t)
h('4. Ambil foto dan catat kendala sekolah')
p('Izinkan akses kamera. Ambil foto orang yang sedang diabsenkan dengan wajah terlihat jelas. Tekan <b>Ulangi</b> jika hasil foto kurang jelas.')
p('Kolom <b>Catatan wajib diisi dengan kendala sekolah dalam Bimtek Pelaporan Progres 50%</b> berdasarkan konfirmasi langsung. Untuk pengawas atau fasilitator, sebutkan sekolah binaan yang mengalami kendala.')
p('<b>Pola catatan:</b> nama sekolah - kendala - tindak lanjut yang dibutuhkan.')
p('Gunakan contoh pada halaman berikut sesuai kondisi sebenarnya. Hindari catatan hanya "hadir", "aman", atau "selesai". Jika tidak ada kendala, tuliskan kondisi tersebut dengan jelas.')
h('5. Simpan dan pastikan berhasil')
p('Tekan <b>Absenkan</b> setelah foto dan catatan sesuai. Tunggu pesan <b>Absen tercatat</b> dan pastikan status berubah menjadi <b>Sudah absen</b>. Ulangi untuk seluruh binaan.')
link('Periksa Rekap Absensi','/admin')
p('<b>Perhatian:</b> status <b>SUDAH TIBA</b> pada rekap kedatangan berbeda dengan <b>Sudah absen</b> untuk sesi yang sedang berlangsung.')
h('Jika menemui kendala')
p('<b>Belum ditemukan di ruangan:</b> konfirmasikan keberadaannya terlebih dahulu. Gunakan <b>Mundur/Berhalangan Hadir</b> hanya setelah kondisi tersebut dipastikan.')
p('<b>Nama tidak ditemukan, Di luar binaan, atau belum ada sesi:</b> laporkan kepada admin untuk pemeriksaan penugasan dan sesi. Jika status sudah tercatat, periksa catatan yang ada.')
p('Screenshot yang tersedia adalah halaman login. Halaman setelah login dan form foto tidak ditampilkan karena belum tersedia akses sesi LO untuk pengambilan gambar.','SmallLO')
story.append(PageBreak())
p('Contoh catatan kendala','TitleLO')
p('Sesuaikan nama sekolah dan isi catatan dengan hasil kunjungan. Contoh berikut bukan pernyataan kondisi sekolah yang sudah diverifikasi.')
examples=[
('Dokumen belum lengkap','SD [nama sekolah] - Bukti transaksi untuk laporan progres 50% belum lengkap. Sekolah perlu melengkapi dokumen dan mengonfirmasikannya kepada fasilitator.'),
('Kesulitan mengisi laporan','SD [nama sekolah] - Bendahara belum memahami pengisian realisasi pada laporan progres 50%. Memerlukan pendampingan fasilitator.'),
('Data belum sesuai','SD [nama sekolah] - Terdapat selisih antara rekap realisasi dan bukti transaksi. Sekolah sedang mencocokkan data sebelum laporan diselesaikan.'),
('Kendala unggah dokumen','SD [nama sekolah] - Dokumen laporan progres 50% belum berhasil diunggah karena koneksi internet tidak stabil. Akan dicoba kembali setelah koneksi membaik.'),
('Menunggu pemeriksaan fasilitator','SD [nama sekolah] - Dokumen laporan progres 50% sudah disiapkan dan masih menunggu pemeriksaan fasilitator sebelum perbaikan atau penyelesaian.'),
('Beberapa sekolah binaan','SD A terkendala kelengkapan bukti transaksi; SD B memerlukan bantuan pengisian laporan progres 50%. Keduanya membutuhkan pendampingan lanjutan.'),
('Tidak ada kendala','SD [nama sekolah] - Tidak ada kendala pelaporan progres 50% yang disampaikan saat kunjungan LO.'),
('Belum dapat dikonfirmasi','SD [nama sekolah] - Kendala pelaporan progres 50% belum dapat dikonfirmasi karena dokumen masih dibawa petugas sekolah lainnya. Perlu konfirmasi lanjutan.')
]
for title,body in examples:
    p('<b>'+title+'</b><br/>'+body,'ExampleLO')
h('Pemeriksaan akhir LO')
p('Pastikan seluruh fasilitator, bendahara, dan pengawas binaan sudah ditindaklanjuti; foto dan catatan sesuai; serta absensi sesi hari ini benar-benar tercatat. Sampaikan kendala yang membutuhkan tindak lanjut kepada admin atau fasilitator terkait.')
SimpleDocTemplate(str(out),pagesize=(595.28,841.89),rightMargin=42,leftMargin=42,topMargin=38,bottomMargin=52,title='Panduan LO - Absensi dan Pelaporan Progres 50%',author='Panitia BIMTEK').build(story,onFirstPage=footer,onLaterPages=footer)
print(out)
