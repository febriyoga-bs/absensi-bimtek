import {test} from 'node:test';
import assert from 'node:assert/strict';
import {similarSchool} from '../src/schoolIdentity.js';
test('school matching accepts administrative prefixes and an omitted location suffix',()=>{
 assert.ok(similarSchool('UPT SPF SDN 3 CIKONENG','SD NEGERI 3 CIKONENG'));
 assert.ok(similarSchool('SD NEGERI PANJANG III','SD NEGERI PANJANG III KEDUNGADEM'));
});
test('school matching accepts small spelling variants but rejects different school numbers',()=>{
 assert.ok(similarSchool('SD NEGERI PANGHEGAR','SD NEGERI PANGHEGER'));
 assert.equal(similarSchool('SD NEGERI 1 SUKAMAJU','SD NEGERI 2 SUKAMAJU'),false);
 assert.equal(similarSchool('',''),false);
});
