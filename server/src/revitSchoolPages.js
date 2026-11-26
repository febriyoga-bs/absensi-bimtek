import {HttpError} from './util.js';

// Derive pagination from the returned rows, never the requested page size.
// Some Revit versions ignore per_page or cap it at a lower value.
export async function fetchCompleteSchoolPages(fetchPage, metric='total') {
 const first=await fetchPage('',1,metric,2000);
 const total=first.total;
 if(!Number.isSafeInteger(total) || total<0 || total>100000)throw new HttpError(502,'Total sekolah Revit tidak valid.');
 if(total===0){
  if(first.rows.length)throw new HttpError(502,'Jumlah sekolah Revit tidak konsisten.');
  return [];
 }
 const size=first.rows.length;
 if(!size || size>total)throw new HttpError(502,'Daftar sekolah Revit belum lengkap.');
 const pages=Math.ceil(total/size);
 if(pages>1000)throw new HttpError(502,'Jumlah halaman Revit melebihi batas pengambilan.');
 const rows=[...first.rows];
 // Sequential pages reduce upstream bursts and allow early failure on changes.
 for(let page=2;page<=pages;page++){
  const result=await fetchPage('',page,metric,2000);
  if(result.total!==total || result.rows.length!==Math.min(size,total-(page-1)*size))
   throw new HttpError(502,'Daftar sekolah Revit berubah atau tidak lengkap. Coba muat ulang.');
  rows.push(...result.rows);
 }
 if(rows.length!==total || new Set(rows.map(row=>row.npsn)).size!==total)
  throw new HttpError(502,'Daftar sekolah Revit tidak lengkap atau mengandung NPSN berulang.');
 return rows;
}
