import {readSheet} from 'read-excel-file/node';
import {progressLabels,progressStages,progressStage} from '../../shared/pksProgress.js';
import {HttpError} from './util.js';
export const progressExportUrl=(()=>{
 const url=new URL('https://revitsd.kemendikdasmen.go.id/spab/dashboard-progress/export');
 url.search=new URLSearchParams({jenis:'pks',bimtek:'1',metric:'total',mode:'sudah',page:'1'});
 for(const venue of ['Atria Tangerang','Lumire Jakarta','Novotel Mangga Dua'])url.searchParams.append('hotels[]',venue);
 return url.toString();
})();
const text=v=>String(v ?? '').trim();
export function parseProgressExportSheets(summary,detail){
 const [head,...data]=detail;
 const at=name=>{const index=head?.indexOf(name);if(index==null || index<0)throw new HttpError(502,`Kolom export Revit tidak ditemukan: ${name}`);return index;};
 const indexes=Object.fromEntries(['Hotel','NPSN','Nama Sekolah','Kab/Kota','Verifikator','Status Biodata',...progressLabels.slice(5,-1).map(p=>p[1])].map(name=>[name,at(name)]));
 const programs=new Map();
 for(const cells of data){
  const npsn=text(cells[indexes.NPSN]);if(!/^\d{8}$/.test(npsn))throw new HttpError(502,'NPSN export Revit tidak valid.');
  const row={npsn,name:text(cells[indexes['Nama Sekolah']]),hotel:text(cells[indexes.Hotel]),kabKota:text(cells[indexes['Kab/Kota']]),verifier:text(cells[indexes.Verifikator]),bio:text(cells[indexes['Status Biodata']]),cells};
  if(!programs.has(npsn))programs.set(npsn,[]);programs.get(npsn).push(row);
 }
 const schools=[...programs].map(([npsn,items])=>{
  if(new Set(items.map(r=>r.hotel)).size!==1)throw new HttpError(502,'NPSN export Revit muncul pada venue berbeda.');
  const bio=items.map(r=>({label:r.bio,stage:progressStage(r.bio)})).sort((a,b)=>progressStages.indexOf(b.stage)-progressStages.indexOf(a.stage))[0];
  const achieved=progressStages.slice(0,4).filter(metric=>progressStages.indexOf(metric)<=progressStages.indexOf(bio.stage));
  for(const [metric,label] of progressLabels.filter(([metric])=>progressStages.slice(4).includes(metric))){
   if(items.every(r=>/^sudah$/i.test(text(r.cells[indexes[label]]))))achieved.push(metric);
  }
  const stage=achieved.at(-1) || bio.stage;
  const labels=[bio.label,...progressLabels.filter(([metric])=>progressStages.slice(4).includes(metric) && achieved.includes(metric)).map(([,label])=>label)];
  return {...items[0],cells:undefined,bio:undefined,stage,achieved,status:labels.filter(Boolean).join(' · ')};
 });
 const [summaryHead,...summaryRows]=summary;
 const totalIndex=summaryHead?.indexOf('Total sekolah');
 if(totalIndex<0 || totalIndex==null)throw new HttpError(502,'Ringkasan export Revit tidak valid.');
 const totalRow=summaryRows.find(r=>/^total$/i.test(text(r[0])));
 if(!totalRow || Number(totalRow[totalIndex])!==schools.length)throw new HttpError(502,'Export Revit belum memuat seluruh sekolah.');
 const metricsFor=row=>Object.fromEntries(progressLabels.map(([metric,label])=>{
  const index=summaryHead.indexOf(label);if(index<0)throw new HttpError(502,`Tahap export Revit tidak ditemukan: ${label}`);
  const value=Number(row[index]);if(!Number.isSafeInteger(value) || value<0)throw new HttpError(502,'Angka ringkasan export Revit tidak valid.');
  return [metric,value];
 }));
 const totals=metricsFor(totalRow);
 const hotels=summaryRows.filter(r=>!/^total$/i.test(text(r[0]))).map(r=>({hotel:text(r[0]),metrics:metricsFor(r)}));
 if(hotels.reduce((sum,h)=>sum+h.metrics.total,0)!==schools.length)throw new HttpError(502,'Total venue export Revit tidak cocok.');
 const count=(rows,metric)=>metric==='total'?rows.length:rows.filter(row=>metric==='tidak_terdata'?row.stage===metric:row.achieved.includes(metric)).length;
 for(const [metric,value] of Object.entries(totals)){
  if(count(schools,metric)!==value)throw new HttpError(502,`Rincian export Revit tidak cocok dengan ringkasan: ${metric}`);
 }
 for(const venue of hotels){
  const scoped=schools.filter(row=>row.hotel===venue.hotel);
  for(const [metric,value] of Object.entries(venue.metrics)){
   if(count(scoped,metric)!==value)throw new HttpError(502,`Rincian export Revit tidak cocok untuk venue ${venue.hotel}: ${metric}`);
  }
 }

 return {source:progressExportUrl,updatedAt:new Date().toLocaleString('id-ID',{timeZone:'Asia/Jakarta'}),schools,hotels,
 metrics:progressLabels.map(([metric,label])=>({metric,sourceMetric:metric,label,value:totals[metric],percent:totals.total?`${Math.round(totals[metric]*100/totals.total)}%`:'0%'}))};
}
export async function parseProgressExport(buffer){
 try{
  if(buffer.length>20000000 || buffer[0]!==80 || buffer[1]!==75)throw Error('Not an XLSX export');
  const [summary,detail]=await Promise.all([readSheet(buffer,'Rekap Hotel'),readSheet(buffer,'Daftar Sekolah')]);
  return parseProgressExportSheets(summary,detail);
 }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(502,'File export Revit tidak valid atau formatnya berubah.');}
}
