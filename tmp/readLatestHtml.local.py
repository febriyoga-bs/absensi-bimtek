import re,json,pathlib
t=pathlib.Path('C:/Users/my pc/Downloads/Pantau Pelaporan LO · Bimtek Pelaporan 3 (1).html').read_text(encoding='utf-8')
m=re.search(r'<script id="data" type="application/json">(.*?)</script>',t,re.S)
d=json.loads(m.group(1))
print([(k,type(v).__name__,len(v) if isinstance(v,(dict,list)) else str(v)[:80]) for k,v in d.items()])
print('dict keys',list(d['dict']))
for k,v in d.items():
 if isinstance(v,list): print(k,repr(v[:2])[:1600])
pathlib.Path('tmp/latest-reporting-html.local.json').write_text(json.dumps(d),encoding='utf-8')
pathlib.Path('tmp/latest-reporting-code.local.txt').write_text(t[m.end():],encoding='utf-8')
