import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { revalidateOptimizedDeps } from "./optimized-deps-cache";

function run(url: string): { headers: Record<string, unknown>; next: number } {
  const headers: Record<string, unknown> = {};
  const res = {
    setHeader(name: string, value: unknown) {
      headers[name.toLowerCase()] = value;
      return res;
    },
  } as unknown as ServerResponse;
  const next = vi.fn();

  revalidateOptimizedDeps()({ url } as IncomingMessage, res, next);
  // Vite sets its headers while serving, after the middleware chain moves on.
  res.setHeader("Cache-Control", "max-age=31536000,immutable");
  res.setHeader("Content-Type", "text/javascript");

  return { headers, next: next.mock.calls.length };
}

describe("optimized dep cache headers", () => {
  it("makes a dep response revalidate instead of claiming to be immutable", () => {
    const { headers, next } = run(
      "/node_modules/.vite/deps/react.js?v=bb30d984",
    );
    expect(headers["cache-control"]).toBe("no-cache");
    expect(headers["content-type"]).toBe("text/javascript");
    expect(next).toBe(1);
  });

  it("leaves every other response alone", () => {
    const { headers, next } = run("/src/main.tsx");
    expect(headers["cache-control"]).toBe("max-age=31536000,immutable");
    expect(next).toBe(1);
  });
});
