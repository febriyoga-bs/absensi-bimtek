export const schoolIdentity = value => String(value ?? '').normalize('NFKC').toLowerCase()
  .replace(/^(?:\s*(?:uptd?|spf|satuan pendidikan formal)\b[.\s]*)+/i, '')
  .replace(/\bsd\s*n(?=\s|\d|[.-])/g, 'sd negeri ')
  .replace(/[^\p{L}\p{N}]/gu, '');
export function similarSchool(a, b) {
  a = schoolIdentity(a); b = schoolIdentity(b);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 10) return false;
  // Different explicit school numbers must never be treated as a spelling variant.
  const an = a.match(/\d+/g) || [], bn = b.match(/\d+/g) || [];
  if (an.length && bn.length && an.join(':') !== bn.join(':')) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  let prev = Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=next;
  }
  return prev[b.length]/Math.max(a.length,b.length)<=0.1;
}
