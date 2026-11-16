import csv,json
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak,KeepTogether
root=Path(__file__).resolve().parents[2]; data=json.loads((root/'data/lo-summary-t4.local.json').read_text()); creds={r['Username']:r['Password awal'] for r in csv.DictReader((root/'data/kredensial-lo-baru-tahap4.local').open(),delimiter='\t')}
s=getSampleStyleSheet(); title=ParagraphStyle('t',parent=s['Title'],fontName='Helvetica-Bold',fontSize=20,leading=25,textColor=colors.HexColor('#102C57')); body=ParagraphStyle('b',parent=s['BodyText'],fontSize=8,leading=11); head=ParagraphStyle('h',parent=body,textColor=colors.white,fontName='Helvetica-Bold')
def p(x,st=body): return Paragraph(str(x or '-').replace('&','&amp;').replace('<','&lt;'),st)
def tbl(rows,w):
 t=Table(rows,colWidths=w,repeatRows=1);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#163A70')),('GRID',(0,0),(-1,-1),.35,colors.HexColor('#D7E0EC')),('VALIGN',(0,0),(-1,-1),'TOP'),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#F5F8FC')]),('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]));return t
def make(path,story): SimpleDocTemplate(str(path),pagesize=A4,leftMargin=17*mm,rightMargin=17*mm,topMargin=16*mm,bottomMargin=16*mm).build(story)
venue_order=['Atria Tangerang','Claro Makassar','Four Point Makassar','Harris Gubeng Surabaya','Holiday Inn Jakarta','Lumire Jakarta','Mercure Batavia Jakarta','Windham Surabaya']
account_story=[p('Akun LO BIMTEK Tahap 4',title),p('Dokumen rahasia - password akun baru: BIMTEKREVIT2026. Akun lama menggunakan password Tahap 3.',body),Spacer(1,7)]
for venue in venue_order:
    members=sorted([x for x in data['tahap4'] if x['venue']==venue],key=lambda x:x['name'].lower())
    if not members: continue
    heading=ParagraphStyle(f'venue-{venue}',parent=body,fontName='Helvetica-Bold',fontSize=11,leading=15,textColor=colors.HexColor('#102C57'),spaceBefore=7,spaceAfter=3)
    rows=[[p('Nama LO',head),p('Username',head),p('Password',head),p('Status',head)]]+[[p(x['name']),p(x['username']),p(creds.get(x['username'],'Password Tahap 3')),p('Akun baru' if x['username'] in creds else 'Akun lama')] for x in members]
    account_story += [Paragraph(f'{venue} - {len(members)} LO',heading),tbl(rows,[52*mm,41*mm,51*mm,32*mm]),Spacer(1,5)]
make(root/'output/pdf/Akun-LO-BIMTEK-Tahap-4.pdf',account_story)
old=data['tahap3_tidak_lanjut'];new=data['tahap4_tidak_ikut']; st=[p('Ringkasan Perubahan LO',title),p(f"Tahap 3: {len(data['tahap3'])} LO | Tahap 4: {len(data['tahap4'])} LO | Tidak lanjut: {len(old)} | LO baru: {len(new)}",body),Spacer(1,7),p('LO Tahap 3 yang tidak lanjut di Tahap 4',ParagraphStyle('x',parent=body,fontName='Helvetica-Bold',fontSize=11)),Spacer(1,4),tbl([[p('Nama LO',head),p('Username Tahap 3',head)]]+[[p(x['name']),p(x['username'])] for x in old],[88*mm,88*mm]),PageBreak(),p('LO Tahap 4 yang tidak ikut Tahap 3',ParagraphStyle('y',parent=body,fontName='Helvetica-Bold',fontSize=11)),Spacer(1,4),tbl([[p('Nama LO',head),p('Venue Tahap 4',head),p('Username',head)]]+[[p(x['name']),p(x['venue']),p(x['username'])] for x in new],[66*mm,55*mm,55*mm])]
make(root/'output/pdf/Ringkasan-Perubahan-LO-Tahap-3-dan-4.pdf',st)
