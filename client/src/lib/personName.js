const degrees = ['S.Pd.I', 'M.Pd.I', 'S.Tr.T', 'S.Tr.Kom', 'A.Md.Kom', 'A.Md.Kep', 'A.Md.T',
  'S.Si', 'S.Pd', 'S.T', 'S.E', 'S.H', 'S.Kom', 'S.Sos', 'S.Ak', 'S.AP', 'S.Kep', 'S.KM',
  'M.Si', 'M.Pd', 'M.T', 'M.E', 'M.H', 'M.Kom', 'M.Sos', 'M.Ak', 'M.AP', 'M.M', 'M.Ars',
  'M.Sc', 'B.Sc', 'M.Eng', 'B.Eng', 'Ph.D', 'D.Eng', 'A.Md'];
const degreeNames = new Map(degrees.map((degree) => [degree.toLowerCase(), degree]));
const degreePattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...degrees].sort((a,b)=>b.length-a.length)
  .map((degree) => degree.split('.').join('\\s*\\.\\s*')).join('|')})(?![\\p{L}\\p{N}])`, 'giu');

export function personName(value) {
  const preserved = [];
  const preserve = (text) => { preserved.push(text); return `\uE000${preserved.length - 1}\uE001`; };
  let text = String(value || '').trim().replace(degreePattern, (degree) => preserve(degreeNames.get(degree.replace(/\s/g, '').toLowerCase())));
  // Keep the distinction between dr. (medical doctor) and Dr. (doctoral title).
  text = text.replace(/(?<![\p{L}\p{N}])(prof|drg|dr|ir|ar)\.(?!\p{L})/giu, (match, title) =>
    preserve(title === 'dr' ? 'dr.' : ({prof:'Prof.',drg:'drg.',dr:'Dr.',ir:'Ir.',ar:'Ar.'})[title.toLowerCase()]));
  return text.toLocaleLowerCase('id').replace(/(^|[\s'-])(\p{L})/gu,
    (_, prefix, letter) => prefix + letter.toLocaleUpperCase('id')).replace(/\bLo\b/g, 'LO').replace(/\bBb\/bpmp\b/gi, 'BB/BPMP')
    .replace(/\uE000(\d+)\uE001/g, (_, index) => preserved[Number(index)]);
}
