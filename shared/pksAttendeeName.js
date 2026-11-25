export const arrivalPersonKey = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/(?:[,\s]+(?:s[.,\s]*(?:pd|ag|kom|t)|m[.,\s]*(?:pd|ag|kom|t)|gr)\b.*)$/i, '')
  .replace(/[^\p{L}\p{N}]/gu, '');
