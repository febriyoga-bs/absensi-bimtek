import json,pathlib,re,unicodedata,collections
base=pathlib.Path(__file__).parent
book=json.loads((base/'attendance-list-1819.local.json').read_text(encoding='utf8'))
web=json.loads((base/'attendance-web-snapshot.local.json').read_text(encoding='utf8'))
def norm(v): return ''.join(c for c in unicodedata.normalize('NFKD',str(v or '')).lower() if c.isalnum())
excel=[]
for sheet,rows in book.items():
 if sheet in ('Petunjuk','LO'): continue
 venue=re.search(r'Lokasi:\s*(.*?)\s*\|',str(rows[2][0])).group(1)
 for r in rows:
  if not isinstance(r[0],(int,float)):continue
  role='Pengawas' if str(r[2]).startswith('Pengawas') else r[2]
  excel.append(dict(venue=venue,role=role,name=r[4],room=r[1],institution=r[5],npsn=str(r[7] or ''),source_role=r[2]))
for r in book['LO']:
 if isinstance(r[0],(int,float)):excel.append(dict(venue=r[2],role='LO',name=r[1],school_count=r[3],room=r[4]))
actual=[]
for p in web['people']:
 role={'Fasilitator Pelaporan':'Fasilitator'}.get(p['position'],p['position'])
 if role not in ('LO','Bendahara','Pengawas','Fasilitator'):continue
 room=p['ruangan']
 if role=='LO':
  owner=next((o for o in web['roster']['lo'] if norm(o['name'])==norm(p['name']) and norm(o['venue'])==norm(p['venue'])),None)
  if owner:room=owner.get('rooms')
 actual.append(dict(venue=p['venue'],role=role,name=p['name'],room=room,npsn=p['npsn'],institution=p['institution'],code=p['code']))
for p in web['roster']['coordinators']:actual.append(dict(venue=p['venue'],role='Koordinator',name=p['name'],room=p.get('room'),institution=p.get('institution')))
def ident(p):
 token=norm(p['npsn']) if p['role']=='Bendahara' else norm(p['name'])
 return (norm(p['venue']),p['role'],token)
def dedup(rows):
 out={}
 for p in rows:
  k=ident(p)
  if k not in out:out[k]={**p,'rooms':set()}
  if p.get('room'):out[k]['rooms'].add(p['room'])
 return out
ex=dedup(excel);ac=dedup(actual)
only_excel=[v for k,v in ex.items() if k not in ac];only_web=[v for k,v in ac.items() if k not in ex]
different=[]
for k,p in ex.items():
 if k not in ac:continue
 a=ac[k];fields=[]
 if norm(p['name'])!=norm(a['name']):fields.append('nama')
 if {norm(r) for r in p['rooms']}!={norm(r) for r in a['rooms']}:fields.append('ruangan')
 if fields:different.append(dict(excel=p,web=a,fields=fields))
counts=[]
for role in ('LO','Bendahara','Pengawas','Fasilitator','Koordinator'):
 counts.append(dict(role=role,excel_rows=sum(p['role']==role for p in excel),excel_unique=sum(p['role']==role for p in ex.values()),web_unique=sum(p['role']==role for p in ac.values()),only_excel=sum(p['role']==role for p in only_excel),only_web=sum(p['role']==role for p in only_web)))
def serial(x):return sorted(x) if isinstance(x,set) else str(x)
result=dict(counts=counts,only_excel=only_excel,only_web=only_web,differences=different)
(base/'attendance-comparison.local.json').write_text(json.dumps(result,ensure_ascii=False,indent=2,default=serial),encoding='utf8')
print(json.dumps(dict(counts=counts,changed_fields=dict(collections.Counter(f for p in different for f in p['fields'])),only_excel_examples=only_excel[:8],only_web_examples=only_web[:8]),ensure_ascii=False,default=serial))
def esc(v):return str(v or '—').replace('|','/').replace('\n',' ')
lines=['# Perbandingan daftar hadir dan web Tahap 4','',
 'Sumber: Daftar_Hadir_Bimtek_Pelaporan_4_18-19_November_2026 (1).xlsx. Dibandingkan dengan snapshot database '+web['at']+'. Tidak ada data diubah.',
 '', 'Nama dibandingkan tanpa perbedaan kapital, spasi, dan tanda baca; bendahara dicocokkan dengan NPSN. Koordinator dibandingkan dengan pemetaan, bukan profil absensi.',
 '', '**Penting:** 50 Pengawas Tambahan di Excel bernama dummy “Pengganti Pengawas 1–50”. Petunjuk file meminta nama asli diisi sebelum dicetak. Jangan langsung mengimpor dummy sebagai identitas peserta.',
 '', '| Jenis | Baris Excel | Identitas unik Excel per venue | Identitas unik web per venue | Hanya Excel | Hanya web |', '|---|---:|---:|---:|---:|---:|']
for r in counts:lines.append('| '+' | '.join(str(r[k]) for k in ['role','excel_rows','excel_unique','web_unique','only_excel','only_web'])+' |')
lines+=['','## Perbedaan ruangan','','| Jenis | Nama | Venue | Excel | Web |','|---|---|---|---|---|']
for r in different:lines.append('| '+' | '.join(esc(v) for v in [r['excel']['role'],r['excel']['name'],r['excel']['venue'],'; '.join(sorted(r['excel']['rooms'])),'; '.join(sorted(r['web']['rooms']))])+' |')
for title,rows in [('Hanya di Excel',only_excel),('Hanya di web',only_web)]:
 lines+=['','## '+title,'','| Jenis | Nama | Venue | Instansi / Sekolah |','|---|---|---|---|']
 for r in rows:lines.append('| '+' | '.join(esc(r.get(k)) for k in ['role','name','venue','institution'])+' |')
out=base.parent/'output'/'perbandingan-daftar-hadir-18-19-nov.md';out.parent.mkdir(exist_ok=True);out.write_text('\n'.join(lines)+'\n',encoding='utf8')
