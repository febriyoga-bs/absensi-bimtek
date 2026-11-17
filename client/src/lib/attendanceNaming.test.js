import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceCell, attendanceFilename, loLabel } from './attendanceNaming.js';
test('names and LO labels are consistent without altering identifiers', () => {
 assert.equal(attendanceCell('Nama','adinda saphira rizky'),'Adinda Saphira Rizky');
 assert.equal(attendanceCell('LO Bertugas','vebe lydiasari sianipar; ADINDA RIZKY'),'Vebe Lydiasari Sianipar; Adinda Rizky');
 assert.equal(attendanceCell('Catatan','Diabsenkan oleh lo adinda saphira rizky'),'Diabsenkan oleh LO Adinda Saphira Rizky');
 assert.equal(loLabel('Pendamping Panitia (Lo)'),'Pendamping Panitia (LO)');
 assert.equal(attendanceCell('URL Foto','https://test/lo/123'),'https://test/lo/123');
 assert.equal(attendanceFilename('Rekap Absensi - Hari/1 - Venue A','xlsx'),'Rekap Absensi - Hari 1 - Venue A.xlsx');
});
