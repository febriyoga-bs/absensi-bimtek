export function formatRoom(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>|&lt;br\s*\/?&gt;/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/,\s*/g, ', ')
    .replace(/\blt(?:\.\s*|\s+)(?=[\p{L}\d])/giu, 'lt. ')
    .replace(/\p{L}+/gu, (word) => {
      if (/^(lt|sekat)$/i.test(word)) return word.toLowerCase();
      return word[0].toUpperCase() + word.slice(1);
    })
    .trim();
}
