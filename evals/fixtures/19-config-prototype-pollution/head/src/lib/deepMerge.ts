export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively merges `source` into `target`, returning the merged result.
 */
export function deepMerge(target, source) {
  for (const key in source) {
    const value = source[key];
    if (isPlainObject(value) && isPlainObject(target[key])) {
      target[key] = deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}
