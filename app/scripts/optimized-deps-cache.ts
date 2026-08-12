import type { IncomingMessage, ServerResponse } from "node:http";

/** Path Vite dev serves optimized dependency files from. */
export const OPTIMIZED_DEPS_PREFIX = "/node_modules/.vite/deps/";

export function isOptimizedDepPath(url: string | undefined): boolean {
  return url?.startsWith(OPTIMIZED_DEPS_PREFIX) ?? false;
}

/**
 * Vite dev answers optimized dependency requests with
 * `Cache-Control: max-age=31536000,immutable`, betting that `?v=<browserHash>`
 * changes whenever their content does. Rebuild that directory under the same
 * hash — a second dev server sharing the cache dir, a wiped cache dir — and a
 * browser holding those files keeps asking for chunk names the server no longer
 * has. The 404 fails the whole entry module graph, which is a blank page rather
 * than a stale one.
 *
 * Have dev clients revalidate dep responses instead. Vite still answers 304
 * whenever the file really is unchanged.
 */
export function revalidateOptimizedDeps() {
  return (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): void => {
    if (!isOptimizedDepPath(req.url)) {
      next();
      return;
    }
    // Vite sets the header while it serves the file, after this middleware
    // runs, so take over the setter rather than the header.
    const setHeader = res.setHeader.bind(res);
    res.setHeader = ((name: string, value: number | string | string[]) =>
      setHeader(
        name,
        name.toLowerCase() === "cache-control" ? "no-cache" : value,
      )) as typeof res.setHeader;
    next();
  };
}
