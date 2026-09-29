// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReviewCommits } from "@server/schemas";
import { reviewKeys } from "../api/keys";
import { REVIEW_COMMITS_POLL_MS, useReviewLiveRefresh } from "./use-review-live-refresh";

const commits = vi.hoisted(() => ({ tip: "tip-1" }));

vi.mock("../api/client", () => ({
  fetchReviewCommits: async (): Promise<ReviewCommits> => ({
    mergeBase: "main",
    mergeBaseRef: "main",
    tip: commits.tip,
    commits: [],
  }),
}));

const COMMITS_KEY = reviewKeys.commits("proj", "rev-1");
let root: Root | undefined;

function Probe() {
  useReviewLiveRefresh("proj", "rev-1");
  return null;
}

async function refetchCommits(client: QueryClient) {
  await act(async () => {
    await client.refetchQueries({ queryKey: COMMITS_KEY });
    // React Query batches observer notifications onto a zero-delay timer.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  commits.tip = "tip-1";
});

describe("useReviewLiveRefresh", () => {
  it("polls commits and refetches the diff and review only when the tip moves", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    root = createRoot(document.createElement("div"));
    await act(async () => {
      root!.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    const query = client.getQueryCache().find({ queryKey: COMMITS_KEY });
    expect(query?.observers[0]?.options.refetchInterval).toBe(REVIEW_COMMITS_POLL_MS);
    expect(client.getQueryData<ReviewCommits>(COMMITS_KEY)?.tip).toBe("tip-1");

    await refetchCommits(client);
    expect(invalidate).not.toHaveBeenCalled();

    commits.tip = "tip-2";
    await refetchCommits(client);

    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      reviewKeys.diffs("proj", "rev-1"),
      reviewKeys.lists("proj"),
      reviewKeys.detail("proj", "rev-1"),
    ]);
  });
});
