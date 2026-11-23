import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fileURLToPath} from 'node:url';

test('BIMTEK monitoring renders API null records without a checklist form',async()=>{
  const root=fileURLToPath(new URL('../..',import.meta.url));
  const vite=await createServer({root,server:{middlewareMode:true,hmr:false},appType:'custom'});
  try {
    const module=await vite.ssrLoadModule('/src/pages/admin/PksBimtek.jsx');
    const {BimtekSummary}=module;
    const school={npsn:'10102061',name:'SD N Arakundo',bimtek:null,pks:{status:'belum_diterima'}};
    const html=renderToStaticMarkup(React.createElement(BimtekSummary,{schools:[school]}));
    assert.ok(html.includes('Capaian Pendampingan Bimtek'));
    assert.ok(html.includes('Dokumen lengkap'));
    assert.equal(module.default,undefined);
    assert.ok(!html.includes('type="checkbox"'));
  } finally {await vite.close();}
});
