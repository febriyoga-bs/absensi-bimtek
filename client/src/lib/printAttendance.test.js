import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { createAttendancePdf } from './printAttendance.js';

test('rendered PDF starts with summary then LO, verifier and school-sorted participant cards', async () => {
  const base = { venue_name:'Venue Contoh', created_at:'2026-11-26T01:00:00Z', status:'valid',
    npsn:'00123456', scanned_by:'LO Pencatat Contoh', participant_note:'Tidak ada kendala.' };
  const records = [
    { ...base, id:1, name:'Aaron', institution:'SD Z', position:'Bendahara' },
    { ...base, id:2, name:'Zahra', institution:'SD A', position:'Kepala Sekolah' },
    { ...base, id:3, name:'Verifier', position:'Verifikator' },
    { ...base, id:4, name:'Liaison', position:'LO' },
  ];
  const blob = await createAttendancePdf({ records, title:'Sesi Contoh', heading:'Rekap Contoh' });
  const bytes = Buffer.from(await blob.arrayBuffer());
  const streams = [...bytes.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map(match=>inflateSync(Buffer.from(match[1],'latin1')).toString('latin1'));
  assert.equal(streams.length,4);
  for (const page of streams) assert.doesNotMatch(page,/Sesi Contoh|catatan absensi - Dibuat|Dibuat /);
  assert.match(streams[0],/Total Catatan Absensi/);
  assert.match(streams[0],/Perwakilan Sekolah/);
  assert.doesNotMatch(streams[0],/Total orang pada hasil filter/);
  assert.match(streams[1],/LO - Hadir - 1 orang \/ 1 catatan/);
  assert.match(streams[2],/Verifikator - Hadir/);
  assert.doesNotMatch(streams[1],/NPSN/);
  assert.doesNotMatch(streams[2],/NPSN/);
  for (const stream of streams) assert.doesNotMatch(stream,/Sesi Contoh|catatan absensi - Dibuat/);
  for (const stream of [streams[1],streams[2]]) assert.doesNotMatch(stream,/NPSN/);
  assert.match(streams[3],/Peserta - Hadir - 2 orang \/ 2 catatan/);
  assert.ok(streams[3].indexOf('Zahra')<streams[3].indexOf('Aaron'));
  assert.match(streams[3],/NPSN 00123456/);
  assert.match(streams[3],/Dicatat oleh LO Pencatat Contoh/);
  assert.match(streams[3],/Catatan Kendala: Tidak ada kendala/);
});

test('long notes share continuation pages instead of one appendix page per person', async () => {
  const records=Array.from({length:12},(_,id)=>({id,name:`Person ${id}`,position:'Bendahara',
    status:'valid',institution:'SD Contoh',npsn:'00123456',created_at:'2026-11-26T01:00:00Z',
    participant_note:'Catatan pengujian panjang. '.repeat(14)}));
  const blob=await createAttendancePdf({records,title:'Sesi Contoh'});
  const text=Buffer.from(await blob.arrayBuffer()).toString('latin1');
  const pages=[...text.matchAll(/\/Type \/Page\b/g)].length;
  assert.ok(pages<10,`expected packed notes, got ${pages} pages`);
});
