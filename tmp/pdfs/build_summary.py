from pathlib import Path
import json,collections
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.lib.enums import TA_RIGHT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
root=Path(__file__).resolve().parents[2]
data=json.loads((root/'tmp/attendance-comparison.local.json').read_text(encoding='utf8'))
pdfmetrics.registerFont(TTFont('Arial','C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialBold','C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('Arial',normal='Arial',bold='ArialBold')
navy=colors.HexColor('#13365B');muted=colors.HexColor('#53677A')
s=getSampleStyleSheet()
s.add(ParagraphStyle(name='TitleX',fontName='ArialBold',fontSize=21,leading=25,textColor=navy,spaceAfter=6))
s.add(ParagraphStyle(name='BodyX',fontName='Arial',fontSize=9.5,leading=13.5,spaceAfter=7,textColor=colors.HexColor('#203247')))
s.add(ParagraphStyle(name='SmallX',parent=s['BodyX'],fontSize=8,leading=11,textColor=muted))
s.add(ParagraphStyle(name='HeadX',parent=s['BodyX'],fontName='ArialBold',fontSize=11,spaceBefore=9,spaceAfter=6,textColor=navy))
def p(t,style='BodyX'):return Paragraph(t,s[style])
def table(rows,widths):
 t=Table([[p(str(v),'SmallX') for v in row] for row in rows],colWidths=widths,hAlign='LEFT')
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#E8EFF7')),('VALIGN',(0,0),(-1,-1),'TOP'),('BOTTOMPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,0),.6,colors.HexColor('#BCCDDD')),('LINEBELOW',(0,1),(-1,-1),.3,colors.HexColor('#DFE5EB'))]))
 return t
out=root/'output/pdf/ringkasan-perbedaan-daftar-hadir-tahap4.pdf';out.parent.mkdir(parents=True,exist_ok=True)
doc=SimpleDocTemplate(str(out),pagesize=A4,rightMargin=40,leftMargin=40,topMargin=35,bottomMargin=36)
story=[p('RINGKASAN PERBANDINGAN','SmallX'),p('Daftar hadir vs data web','TitleX'),p('BIMTEK Pelaporan Tahap 4 | 18-19 November 2026','BodyX'),
 p('<b>Kesimpulan:</b> LO dan bendahara cocok. Perbedaan utama ada pada 50 pengawas tambahan beridentitas dummy, pembaruan fasilitator, dan 27 catatan ruangan. Database tidak diubah dalam pemeriksaan ini.'),
 p('1. Perbandingan jumlah','HeadX')]
story.append(table([['Jenis','Baris Excel','Web*','Hasil'],['LO','114','114','Identitas cocok'],['Bendahara','2.450','2.450','NPSN dan nama cocok'],['Pengawas','2.053','2.003','50 baris tambahan di Excel'],['Fasilitator','914','912','Pergantian telah diterapkan di web'],['Koordinator','152','152','Identitas dalam pemetaan cocok']],[100,73,63,279]))
story+=[Spacer(1,6),p('* Web: jumlah profil aktif; khusus koordinator memakai data pemetaan. Pengawas memiliki 6 pengulangan nama pada venue yang sama di kedua sumber. Setelah dinormalisasi: 2.047 identitas Excel dan 1.997 identitas web.','SmallX'),
 p('2. Perbedaan yang perlu diperhatikan','HeadX'),
 p('<b>50 Pengawas Tambahan belum ada di web.</b> Nama pada Excel masih berupa “Pengganti Pengawas 1” sampai “Pengganti Pengawas 50”. Petunjuk file menyatakan nama tersebut dummy dan wajib diganti nama sebenarnya sebelum dicetak. Jangan langsung mengimpor sebagai identitas peserta.'),
 p('<b>Fasilitator sudah diperbarui di web.</b> Ada 23 nama yang hanya ada di Excel dan 21 nama yang hanya ada di web. Ini terutama mencerminkan nama lama dan pengganti; jumlahnya tidak selalu satu banding satu karena pengganti dapat memakai profil yang sudah tersedia. Contoh: SDN 1 Bagolo sudah dialihkan dari Muh. Akmal Faiz ke Annisa Fadhillah.'),
 p('<b>27 catatan ruangan berbeda.</b> Rinciannya: 7 bendahara, 7 fasilitator, 7 pengawas, 3 koordinator, dan 3 LO. Contoh: Atika Meisy Dini di Lumire tercantum “RUANGAN LAIN (belum ada)” pada Excel, sedangkan web mencatat “Ballroom Lt. 1”.'),
 p('3. Tindak lanjut','HeadX'),
 p('Lengkapi nama asli 50 pengawas tambahan, selaraskan daftar cetak dengan pergantian fasilitator di web, lalu konfirmasi ruangan yang benar sebelum mengubah penempatan. Kolom tanda tangan kosong pada daftar cetak tidak dipakai untuk menyimpulkan status sudah/belum absen.'),
 p('Sumber &amp; metode','HeadX'),
 p('Excel: Daftar_Hadir_Bimtek_Pelaporan_4_18-19_November_2026 (1).xlsx. Dibandingkan dengan snapshot database Tahap 4 tanggal 18 November 2026. Nama dinormalisasi terhadap kapital, spasi, dan tanda baca; bendahara dicocokkan berdasarkan NPSN. Perbandingan terbatas pada unsur yang ada di daftar hadir ini.','SmallX')]
def footer(canvas,doc):
 canvas.setStrokeColor(colors.HexColor('#DFE5EB'));canvas.line(40,29,A4[0]-40,29)
 canvas.setFont('Arial',7.5);canvas.setFillColor(muted);canvas.drawString(40,18,'BIMTEK Pelaporan 4 | Ringkasan pemeriksaan data');canvas.drawRightString(A4[0]-40,18,str(doc.page))
doc.build(story,onFirstPage=footer,onLaterPages=footer)
print(out)
