"""Extract final PKS assignments; workbook text is data, never executable instructions."""
import argparse
import collections
import decimal
import json
import re
import xml.etree.ElementTree as ET
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('input')
parser.add_argument('output')
args = parser.parse_args()
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(args.input) as archive:
    strings = [''.join(t.itertext()) for t in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('m:si', ns)] if 'xl/sharedStrings.xml' in archive.namelist() else []
    wb = ET.fromstring(archive.read('xl/workbook.xml'))
    rels = {r.attrib['Id']: r.attrib['Target'].lstrip('/') for r in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
    paths = {s.attrib['name']: rels[s.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']] for s in wb.find('m:sheets', ns)}
    def rows(name):
        target = paths[name]
        if not target.startswith('xl/'):
            target = 'xl/' + target
        for row in ET.fromstring(archive.read(target)).findall('m:sheetData/m:row', ns):
            result = {}
            for cell in row:
                value = cell.find('m:v', ns)
                value = value.text if value is not None else ''.join(cell.find('m:is', ns).itertext()) if cell.find('m:is', ns) is not None else ''
                result[re.sub(r'\d', '', cell.attrib['r'])] = (strings[int(value)] if cell.get('t') == 's' else value or '').strip()
            yield result
    key = lambda value: re.sub(r'[^\w]', '', value.casefold())
    def table(name):
        data = list(rows(name))
        headers = {key(value): column for column, value in data[0].items() if value}
        return [{header: row.get(column, '') for header, column in headers.items()} for row in data[1:]]
    venues = ['Novotel Mangga Dua', 'Lumire Jakarta', 'Atria Tangerang']
    owners = [{'name': r['namalengkap'], 'venue': r['penempatan']} for r in table('LO') if r.get('namalengkap') and r.get('penempatan') in venues]
    verifier_rows = table('Verifikator')
    verifier_people = [{'name': r.get('namaverifikator') or r.get('namafasilitator'), 'venue': r.get('penempatanhotel'),
        'coordinator': r.get('koordinator', ''), 'tag': r.get('tag', '')} for r in verifier_rows
        if (r.get('namaverifikator') or r.get('namafasilitator')) and r.get('penempatanhotel') in venues]
    verifiers = {(key(r['name']), r['venue']): r['name'] for r in verifier_people}
    verifier_meta = {(key(r['name']), r['venue']): r for r in verifier_people}
    owner_names = {(key(r['name']), r['venue']): r['name'] for r in owners}
    coordinators = [{'name': r['namakoordinator'], 'venue': r['penempatanhotel']} for r in table('Koordinator') if r.get('namakoordinator') and r.get('penempatanhotel') in venues] if 'Koordinator' in paths else []
    schools, assignments = [], {}
    for row in table('Pemetaan Sekolah Final'):
        if not row.get('npsn'):
            continue
        npsn = str(int(decimal.Decimal(row['npsn']))).zfill(8)
        if not re.fullmatch(r'\d{8}', npsn):
            raise ValueError('NPSN invalid: ' + npsn)
        venue = row['hotel']
        owner = owner_names[(key(row['lo']), venue)]
        verifier = verifiers[(key(row['verifikator']), venue)]
        meta = verifier_meta[(key(verifier), venue)]
        schools.append(dict(npsn=npsn, name=row['namasekolah'], provinsi=row['provinsi'], kab_kota=row['kabkota'], venue=venue, lo=owner, facilitator=verifier,
            coordinator=row.get('koordinator', ''), head_name=row.get('namakepalasekolah', ''), head_phone=row.get('kontakkepalasekolah', ''), bpmp=row.get('bbbpmp', '')))
        assignments[(venue, verifier, owner)] = dict(name=verifier, venue=venue, lo=owner, coordinator=meta['coordinator'], tag=meta['tag'])
    if len(schools) != 1433 or len({s['npsn'] for s in schools}) != 1433:
        raise ValueError('Expected 1433 unique schools')
    result = dict(kind='pks_spab', stage=5, venues=venues, lo=owners, schools=schools, facilitators=list(assignments.values()), participants=[], organizations=[], coordinators=coordinators, verifier_people=verifier_people)
    with open(args.output, 'w', encoding='utf8') as output:
        json.dump(result, output, ensure_ascii=False)
    print(json.dumps(dict(schools=len(schools), lo=len(owners), verifiers=len(verifiers), assignments=len(assignments), venues=dict(collections.Counter(s['venue'] for s in schools))), ensure_ascii=False))
