// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { IssueChangePanel } from "../components/issue-change-panel";
import { issuesKeys } from "./keys";
import { useCommentsQuery, useIssuesQuery } from "./queries";

vi.mock("@pierre/diffs/react", () => ({
  Virtualizer: () => null,
  FileDiff: () => null,
}));

const STORY = "story-1";
const SHA = "0123456789abcdef0123456789abcdef01234567";

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

function render(ui: ReactNode, queryClient: QueryClient) {
  act(() => {
    root!.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  });
}

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false },
    },
  });
}

function IssuesProbe() {
  useIssuesQuery();
  return null;
}

function CommentsProbe() {
  useCommentsQuery(STORY);
  return null;
}

function matchMediaStub() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  );
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

describe("issue detail fetches once per load", () => {
  it("reuses /api/issues for a later subscriber and refetches when invalidated", async () => {
    urls = [];
    matchMediaStub();
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      urls.push(url);
      if (url !== "/api/issues") throw new Error(`unexpected fetch ${url}`);
      return json({ issues: [], derived: {}, problems: [] });
    });
    const client = queryClient();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    render(<IssuesProbe />, client);
    await flush();
    expect(urls.filter((url) => url === "/api/issues")).toHaveLength(1);

    render(
      <>
        <IssuesProbe />
        <IssuesProbe />
      </>,
      client,
    );
    await flush();
    expect(urls.filter((url) => url === "/api/issues")).toHaveLength(1);

    await act(async () => {
      await client.invalidateQueries({ queryKey: issuesKeys.list() });
    });
    await flush();
    expect(urls.filter((url) => url === "/api/issues")).toHaveLength(2);
  });

  it("reuses comments when the diff panel mounts after they are stale, and refetches on invalidation", async () => {
    urls = [];
    matchMediaStub();
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      urls.push(url);
      if (url === `/api/issues/${STORY}/comments`) {
        return json({ messages: [], threads: [], problems: [] });
      }
      if (url === `/api/issues/${STORY}/change`) {
        return json({
          state: "loaded",
          patch: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n",
          commits: [{ sha: SHA, subject: "Edit" }],
          stats: { filesChanged: 1, insertions: 1, deletions: 1 },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const client = queryClient();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const page = (showDiff: boolean) => (
      <MemoryRouter>
        <CommentsProbe />
        {showDiff ? (
          <IssueChangePanel issueId={STORY} projectId="proj" resolveThreads />
        ) : null}
      </MemoryRouter>
    );
    render(page(false), client);
    await flush();
    const commentsUrl = `/api/issues/${STORY}/comments`;
    expect(urls.filter((url) => url === commentsUrl)).toHaveLength(1);

    render(page(true), client);
    await flush();
    await flush();
    expect(urls.filter((url) => url === commentsUrl)).toHaveLength(1);

    await act(async () => {
      await client.invalidateQueries({ queryKey: issuesKeys.comments(STORY) });
    });
    await flush();
    expect(urls.filter((url) => url === commentsUrl).length).toBeGreaterThan(1);
  });
});
