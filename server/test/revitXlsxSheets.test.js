import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {readRevitSheets} from '../src/revitXlsxSheets.js';
const workbook=()=>zipSync(Object.fromEntries(Object.entries({
 'xl/workbook.xml':'<workbook><sheets><sheet name="Rekap Hotel" r:id="rId1"/><sheet name="Daftar Sekolah" r:id="rId2"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Type="test/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="test/worksheet" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
 'xl/sharedStrings.xml':'<sst><si><r><t>SD &amp; </t></r><r><t>Test</t></r></si></sst>',
 'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Hotel</t></is></c><c r="B1"><v>1433</v></c></row></sheetData></worksheet>',
 'xl/worksheets/sheet2.xml':'<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Sudah</t></is></c></row></sheetData></worksheet>',
}).map(([name,xml])=>[name,strToU8(xml)])));
test('XLSX parser preserves shared strings, entities, sparse cells and offset buffers without workers',()=>{
 const bytes=workbook(),padded=Buffer.concat([Buffer.alloc(37),bytes,Buffer.alloc(53)]);
 const [summary,schools]=readRevitSheets(padded.subarray(37,37+bytes.length));
 assert.deepEqual(summary,[['Hotel','1433']]);
 assert.equal(schools[0][0],'SD & Test');assert.equal(schools[0][1],undefined);assert.equal(schools[0][2],'Sudah');
});
test('missing workbook structure fails instead of returning empty school data',()=>{
 assert.throws(()=>readRevitSheets(zipSync({'other.xml':strToU8('<x/>')})),/Missing XLSX entry/);
});
