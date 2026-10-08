import type { PrFacts, PrUnavailable } from "./delivery.js";

export type CachedPrFacts = Record<string, PrFacts | PrUnavailable>;

const caches = new Map<string, CachedPrFacts>();

export function readPrFactsCache(projectId: string): CachedPrFacts {
  const cached = caches.get(projectId);
  return cached ? { ...cached } : {};
}

export function replacePrFactsCache(
  projectId: string,
  prs: CachedPrFacts,
): void {
  caches.set(projectId, { ...prs });
}

export function replacePrFactsCacheFromMap(
  projectId: string,
  facts: ReadonlyMap<string, PrFacts>,
): void {
  replacePrFactsCache(projectId, Object.fromEntries(facts));
}

export function clearPrFactsCache(): void {
  caches.clear();
}
