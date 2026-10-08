// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useIssuesWithArchived } from "../hooks/use-issues-with-archived";
import { useIssuesQuery } from "./queries";

let root: Root | undefined;
let urls: string[] = [];

function json(body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function render(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false },
    },
  });
  act(() => {
    root!.render(
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
    );
  });
}

function IncludeProbe() {
  useIssuesQuery("include");
  return null;
}

function ArchivedProbe({ includeArchived }: { includeArchived: boolean }) {
  useIssuesWithArchived(includeArchived);
  return null;
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  urls = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("archived issue queries", () => {
  it("requests include and only on the issues list", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      urls.push(requestUrl(input));
      return json({ issues: [], derived: {}, problems: [] });
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    render(<IncludeProbe />);
    await flush();
    expect(urls).toContain("/api/issues?archived=include");

    urls = [];
    render(<ArchivedProbe includeArchived />);
    await flush();
    expect(urls).toContain("/api/issues");
    expect(urls).toContain("/api/issues?archived=only");
  });

  it("does not request archived issues until a view includes them", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      urls.push(requestUrl(input));
      return json({ issues: [], derived: {}, problems: [] });
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    render(<ArchivedProbe includeArchived={false} />);
    await flush();
    expect(urls.every((url) => url === "/api/issues")).toBe(true);
    expect(urls.filter((url) => url === "/api/issues").length).toBeGreaterThan(0);
  });
});
