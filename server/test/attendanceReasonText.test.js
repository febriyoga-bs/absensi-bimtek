import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceReasonText } from '../../client/src/pages/admin/shared.js';

test('status popup formats structured flags and plain blocked reasons as readable text', () => {
  assert.equal(attendanceReasonText([{ code: 'qr_lo', detail: 'Dicatat oleh LO Asep' }]), 'Diabsenkan LO / panitia: Dicatat oleh LO Asep');
  assert.equal(attendanceReasonText(['akurasi_rendah', 'Foto wajib diisi']), 'Akurasi GPS rendah — cek manual · Foto wajib diisi');
  assert.equal(attendanceReasonText([{ code: 'custom', detail: 'Keterangan' }, { detail: 'Tanpa kode' }]), 'custom: Keterangan · Tanpa kode');
  assert.equal(attendanceReasonText([null, {}, { code: {}, detail: {} }, 123]), '');
  assert.equal(attendanceReasonText(null), '');
});
