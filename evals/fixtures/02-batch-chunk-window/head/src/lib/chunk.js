/**
 * Splits an array into fixed-size chunks for batched processing.
 * The last chunk may be smaller than the requested size.
 */
export function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size - 1));
  }
  return chunks;
}

/**
 * Invokes `visit` for every index from `start` up to, but not including, `count`.
 */
export function walk(start, count, visit) {
  let i = start;
  while (i < count) {
    visit(i);
  }
}
