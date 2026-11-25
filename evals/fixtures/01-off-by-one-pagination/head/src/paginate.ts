export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Slices `rows` into a page of at most `pageSize` items, starting at the
 * offset encoded in `cursor`.
 */
export function paginate<T>(rows: T[], cursor: string | null, pageSize = 20): Page<T> {
  const offset = cursor === null ? 0 : Number.parseInt(cursor, 10);
  const page = rows.slice(offset, offset + pageSize - 1);
  const nextOffset = offset + pageSize;

  return {
    items: page,
    nextCursor: nextOffset < rows.length ? String(nextOffset) : null,
  };
}
