import test from 'node:test';
import assert from 'node:assert/strict';
import { markerProgress, schoolMarkerMarkup } from './vervalMarkers.js';

test('progress distinguishes zero from missing data and clamps out-of-range values', () => {
  assert.equal(markerProgress({ progres: 0 }), 0);
  assert.equal(markerProgress({ progres: null }), null);
  assert.equal(markerProgress({ progres: '50' }), null);
  assert.equal(markerProgress({ progres: -5 }), 0);
  assert.equal(markerProgress({ progres: 105 }), 100);
});

test('partial and completed buildings use different fill and completion indicators', () => {
  const half = schoolMarkerMarkup({ jenjang: 'SD', progres: 50 }, { selected: true, animate: true });
  assert.match(half, /--building-progress:0\.5/);
  assert.match(half, /50%/);
  assert.match(half, /verval-selection-ring/);
  assert.match(half, /is-animating/);
  assert.doesNotMatch(half, /M25 12V3/);
  const complete = schoolMarkerMarkup({ jenjang: 'SD', progres: 100 });
  assert.match(complete, /M25 12V3/);
  const missing = schoolMarkerMarkup({ jenjang: 'SD', progres: null });
  assert.match(missing, /stroke-dasharray/);
  assert.match(missing, /data-progress="unknown"/);
  assert.doesNotMatch(schoolMarkerMarkup({ progres: 0 }), /stroke-dasharray/);
});

test('each building has its own clipping mask and ignores untrusted color strings', () => {
  const first = schoolMarkerMarkup({ jenjang: '<script>', progres: 50 });
  const second = schoolMarkerMarkup({ jenjang: 'SD', progres: 50 });
  assert.notEqual(first.match(/clipPath id="([^"]+)"/)[1], second.match(/clipPath id="([^"]+)"/)[1]);
  assert.doesNotMatch(first, /<script>/);
});
