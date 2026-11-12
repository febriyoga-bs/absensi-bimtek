export function personName(value) {
  return String(value || '').trim().toLocaleLowerCase('id').replace(/(^|[\s'-])(\p{L})/gu,
    (_, prefix, letter) => prefix + letter.toLocaleUpperCase('id'));
}
