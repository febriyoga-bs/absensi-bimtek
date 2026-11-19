from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.units import mm
from pathlib import Path
import pypdfium2 as pdfium
out=Path('output/pdf/ringkasan-pengawas-holiday-inn.pdf')
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleCustom',fontName='Helvetica-Bold',fontSize=23,leading=28,textColor=colors.HexColor('#142c50'),spaceAfter=12))
styles.add(ParagraphStyle(name='TextCustom',fontName='Helvetica',fontSize=10.5,leading=16,spaceAfter=10,textColor=colors.HexColor('#334155')))
styles.add(ParagraphStyle(name='SectionCustom',fontName='Helvetica-Bold',fontSize=12,leading=17,spaceBefore=15,spaceAfter=7,textColor=colors.HexColor('#142c50')))
P=lambda t:Paragraph(t,styles['TextCustom'])
story=[Paragraph('Ringkasan Selisih Pengawas',styles['TitleCustom']),P('<b>Holiday Inn Jakarta | BIMTEK Tahap 4</b><br/>Absensi Hari-2, 19 November 2026'),Spacer(1,4*mm)]
data=[['Indikator','Jumlah'],['Target pada ringkasan Excel','140'],['Catatan absensi sesi','157'],['Rincian catatan','136 Valid + 21 Berhalangan'],['Selisih terhadap target','17'],['Detail Pengawas sumber yang tersimpan','135 baris'],['Profil belum cocok berdasarkan nama*','25']]
t=Table(data,colWidths=[112*mm,62*mm]);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#173963')),('TEXTCOLOR',(0,0),(-1,0),colors.white),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTNAME',(0,1),(-1,-1),'Helvetica'),('FONTSIZE',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),('LEFTPADDING',(0,0),(-1,-1),12),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#eef3f9'),colors.white]),('LINEBELOW',(0,-1),(-1,-1),.5,colors.HexColor('#d9e2ee'))]));story.append(t)
story += [Paragraph('Makna selisih',styles['SectionCustom']),P('Angka 17 adalah selisih hitungan <b>157 catatan sesi - 140 target Excel</b>. Angka ini belum membuktikan ada tepat 17 peserta yang salah atau harus dihapus. Seluruh 157 catatan berasal dari 157 profil berbeda.'),Paragraph('Mengapa belum cocok?',styles['SectionCustom']),P('Target ringkasan Excel, detail sumber yang tersimpan, dan profil absensi belum memuat populasi yang sama. Detail sumber berisi 135 baris, sedangkan target ringkasannya 140. Nama profil juga dapat berbeda dari nama orang yang hadir sebagai perwakilan.'),P('* Sebanyak 25 profil belum cocok setelah nama perwakilan yang tersimpan ikut diperiksa. Ini merupakan hasil pencocokan nama, bukan keputusan bahwa peserta tersebut tidak berhak hadir.'),Paragraph('Tindak lanjut',styles['SectionCustom']),P('Cocokkan 25 profil tersebut dengan nama orang yang hadir, sekolah/NPSN, venue, dan bukti pencatatan. Periksa pula selisih 5 antara target 140 dan 135 baris detail sumber. <b>Jangan menghapus 17 catatan hanya untuk menyamakan angka.</b>'),Spacer(1,4*mm),P('<b>Sumber:</b> hasil audit database Tahap 4 dan data Rekap Kehadiran yang tersimpan, pada pemeriksaan 19 November 2026. Angka merupakan snapshot audit; pencatatan baru dapat mengubah total.')]
def footer(c,d):
 c.setStrokeColor(colors.HexColor('#d9e2ee'));c.line(18*mm,17*mm,192*mm,17*mm);c.setFont('Helvetica',8);c.setFillColor(colors.HexColor('#64748b'));c.drawString(18*mm,12*mm,'BIMTEK | Ringkasan pemeriksaan data');c.drawRightString(192*mm,12*mm,str(d.page))
SimpleDocTemplate(str(out),pagesize=(210*mm,297*mm),leftMargin=18*mm,rightMargin=18*mm,topMargin=18*mm,bottomMargin=23*mm).build(story,onFirstPage=footer,onLaterPages=footer)
pdf=pdfium.PdfDocument(str(out));print('Pages:',len(pdf));assert len(pdf)==1
pdf[0].render(scale=1.5).to_pil().save('tmp/pdfs/summary-preview.png')
print(out.resolve())
