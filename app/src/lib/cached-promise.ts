/**
 * Share one in-flight load per key. A rejection is dropped so the next call
 * retries, unless a newer load has already replaced the entry.
 */
export function cachedPromise<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = load().catch((error: unknown) => {
    if (cache.get(key) === pending) cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}
