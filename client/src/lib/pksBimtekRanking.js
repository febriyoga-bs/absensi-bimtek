import {summarizeBimtek} from '../../../shared/pksBimtek.js';
export function rankBimtekOwners(schools,owners,venue='') {
  let previous=null,rank=0;
  return owners.filter(owner=>!venue || owner.venue===venue).map(owner=>{
    const counts=summarizeBimtek(schools.filter(s=>s.lo===owner.name && s.venue===owner.venue));
    const overall=counts.total ? (counts.documents+counts.submitted+counts.reviewed+counts.complete)*100/(counts.total*4) : null;
    return {...owner,overall,counts};
  }).sort((a,b)=>(b.overall??-1)-(a.overall??-1) || a.name.localeCompare(b.name,'id'))
    .map((row,index)=>{if(row.overall!==previous || index===0)rank=index+1;previous=row.overall;return {...row,rank:row.overall==null?null:rank};});
}
