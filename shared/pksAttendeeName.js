// Use the same identity normalization for import, arrival targets and display.
export const arrivalPersonKey = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/^(?:(?:prof|drs|dra|dr)\b[.,\s]*)+/i, '')
  .replace(/(?:[.,\s]+(?:s[.,\s]*(?:pd|ag|kom|t|e|h|sos|si)|m[.,\s]*(?:pd|ag|kom|t|si|m|a)|a[.,\s]*md|ph[.,\s]*d|gr)\b.*)$/i, '')
  .replace(/[^\p{L}\p{N}]/gu, '');
