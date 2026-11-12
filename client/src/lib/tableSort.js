const collator = new Intl.Collator('id-ID', { numeric: true, sensitivity: 'base' });

// Sort raw values rather than formatted percentages or React elements.
export function sortTableRows(rows, column, direction = 'asc') {
  if (column == null) return rows;
  const multiplier = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = a.sortValues[column];
    const right = b.sortValues[column];
    const emptyLeft = left == null || left === '';
    const emptyRight = right == null || right === '';
    if (emptyLeft || emptyRight) return emptyLeft === emptyRight ? 0 : emptyLeft ? 1 : -1;
    const compared = typeof left === 'number' && typeof right === 'number'
      ? left - right : collator.compare(String(left), String(right));
    return compared * multiplier;
  });
}
