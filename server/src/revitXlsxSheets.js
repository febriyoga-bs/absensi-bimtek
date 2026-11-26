import {unzipSync,strFromU8} from 'fflate';
import {Parser} from 'saxen';

// Read the two tabular export sheets entirely in memory, without filesystem,
// stream adapters, dynamic worker code or runtime-dependent ZIP workers.
export function readRevitSheets(buffer){
 let expanded=0;
 const files=unzipSync(buffer,{filter:file=>{
  if(!/^(?:xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml)$/.test(file.name))return false;
  expanded+=file.originalSize;
  if(expanded>50000000)throw Error('Export expanded size exceeds limit');
  return true;
 }});
 const xml=path=>{if(!files[path])throw Error(`Missing XLSX entry: ${path}`);return strFromU8(files[path]);};
 const parse=(value,open,close,text)=>{
  const parser=new Parser();
  parser.on('openTag',(name,attrs,decode)=>open?.(name.split(':').at(-1),attrs(),decode));
  parser.on('closeTag',name=>close?.(name.split(':').at(-1)));
  parser.on('text',(value,decode)=>text?.(decode(value)));
  parser.on('error',error=>{throw error;});parser.parse(value);
 };
 const shared=[];let item='',inString=false,inText=false;
 if(files['xl/sharedStrings.xml'])parse(xml('xl/sharedStrings.xml'),name=>{
  if(name==='si'){item='';inString=true;}if(name==='t')inText=true;
 },name=>{if(name==='t')inText=false;if(name==='si'){shared.push(item);inString=false;}},value=>{if(inString && inText)item+=value;});
 const paths=new Map();
 parse(xml('xl/_rels/workbook.xml.rels'),(name,attrs,decode)=>{
  if(name==='Relationship'){
   const target=decode(attrs.Target || '');
   if(!attrs.Type?.endsWith('/worksheet'))return;
   const path=target.startsWith('/')?target.slice(1):`xl/${target.replace(/^\.\//,'')}`;
   if(!/^xl\/worksheets\/sheet\d+\.xml$/.test(path))throw Error('Unexpected worksheet target');
   paths.set(attrs.Id,path);
  }
 });
 const sheets=new Map();
 parse(xml('xl/workbook.xml'),(name,attrs,decode)=>{if(name==='sheet')sheets.set(decode(attrs.name),paths.get(attrs['r:id']));});
 return ['Rekap Hotel','Daftar Sekolah'].map(name=>{
  const path=sheets.get(name);if(!path)throw Error(`Missing export sheet: ${name}`);
  const rows=[];let row=null,cell=null,value='',capture=false;
  parse(xml(path),(name,attrs)=>{
   if(name==='row')row=[];
   if(name==='c'){
    const letters=/^[A-Z]+/.exec(attrs.r || '')?.[0];
    if(!letters)throw Error('Missing cell coordinate');
    let column=0;for(const letter of letters)column=column*26+letter.charCodeAt(0)-64;
    if(column>100)throw Error('Too many export columns');
    cell={column:column-1,type:attrs.t};value='';
   }
   if(name==='v' || name==='t')capture=true;
  },name=>{
   if(name==='v' || name==='t')capture=false;
   if(name==='c' && cell){
    if(cell.type==='s'){
     if(!/^\d+$/.test(value) || shared[Number(value)]===undefined)throw Error('Invalid shared string');
     row[cell.column]=shared[Number(value)];
    }else row[cell.column]=value;
    cell=null;
   }
   if(name==='row'){if(row?.some(value=>String(value).trim()))rows.push(row);row=null;}
  },text=>{if(cell && capture)value+=text;});
  return rows;
 });
}
