const caches: Map<symbol, WeakMap<object, unknown>> = new Map();

/**
 * Decorator metadata is written once at class definition time and never mutated afterwards,
 * so lookups can be memoised per target. This keeps the hot execution path free of
 * prototype-chain walks through Reflect.getMetadata.
 */
export function readCachedMetadata<T>(key: symbol, target: unknown, read: () => T | undefined): T | undefined {
  if (target === null || (typeof target !== 'object' && typeof target !== 'function')) {
    return read();
  }

  let cache = caches.get(key);

  if (!cache) {
    cache = new WeakMap<object, unknown>();
    caches.set(key, cache);
  }

  if (cache.has(target as object)) {
    return cache.get(target as object) as T | undefined;
  }

  const value = read();

  cache.set(target as object, value);

  return value;
}
