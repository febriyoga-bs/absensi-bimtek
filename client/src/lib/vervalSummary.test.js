import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSchools } from './vervalSummary.js';

test('distribution counts every school once in each group, including missing progress', () => {
  const rows = [
    { jenjang: 'SD', jenis_program: 'REVIT', kategori: 'Reguler', progres: 0 },
    { jenjang: 'SD', jenis_program: 'REVIT', kategori: 'Bencana', progres: 50.5 },
    { jenjang: 'SMP', jenis_program: 'USB', kategori: 'Reguler', progres: 95 },
    { jenjang: 'SD', progres: null },
  ];
  const summary = summarizeSchools(rows);
  for (const group of Object.values(summary)) assert.equal([...group.values()].reduce((a, b) => a + b, 0), rows.length);
  assert.equal(summary.level.get('SD'), 3);
  assert.equal(summary.program.get('USB'), 1);
  assert.equal(summary.category.get('__missing__'), 1);
  assert.equal(summary.progress.get('0:25'), 1);
  assert.equal(summary.progress.get('50.000001:75'), 1);
  assert.equal(summary.progress.get('95:100'), 1);
  assert.equal(summary.progress.get('none'), 1);
});

test('progress band boundaries have no overlap or missing schools', () => {
  const summary = summarizeSchools([25, 25.1, 50, 50.1, 75, 75.1, 94.9, 95, 100].map((progres) => ({ progres })));
  assert.deepEqual([...summary.progress.values()], [1, 2, 2, 2, 2, 0]);
});
