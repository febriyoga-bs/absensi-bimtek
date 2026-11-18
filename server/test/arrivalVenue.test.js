import {test} from 'node:test';
import assert from 'node:assert/strict';
import {arrivalVenueKey} from '../src/arrivalRecap.js';
test('arrival workbook hotel aliases match application venues in both stages',()=>{
 for(const [source,target] of [['Holiday Inn','Holiday Inn Jakarta'],['Jakarta - Holiday Inn','Holiday Inn Jakarta'],['Mercure Batavia','Mercure Batavia Jakarta'],['Mercure Jakarta Batavia','Mercure Batavia Jakarta'],['Harris Gubeng Sby','Harris Gubeng Surabaya'],['Wyndham Hotel Surabaya','Windham Surabaya'],['Claro','Claro Makassar'],['Four Points by Sheraton Makassar','Four Point Makassar']])assert.equal(arrivalVenueKey(source),arrivalVenueKey(target));
 assert.notEqual(arrivalVenueKey('Holiday Inn'),arrivalVenueKey('Lumire Jakarta'));
});
