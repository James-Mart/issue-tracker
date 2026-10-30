// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentsResponse } from "@server/schemas";
import { submittableCommentThreads } from "@/features/reviews/lib/review-submittable";
import { usePostThreadEvent } from "./mutations";
import { issuesKeys } from "./keys";
import { useCommentThreads } from "./queries";

const request = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/client", () => ({
  request: (...args: unknown[]) => request(...args),
  requestText: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

const comments = {
  messages: [
    {
      id: "t1",
      at: "2026-10-01T15:15:00.000Z",
      role: "human",
      body: "Ship the note.",
    },
  ],
  threads: [
    {
      rootId: "t1",
      kind: "review" as const,
      state: "open" as const,
      readyToTask: true,
      included: true,
    },
  ],
  problems: [],
} satisfies CommentsResponse;

function ReadyCount({ issueId }: { issueId: string }) {
  const { threads, loaded } = useCommentThreads(issueId);
  const { mutate } = usePostThreadEvent(issueId);
  const count = loaded ? submittableCommentThreads(threads, []).length : -1;
  return (
    <>
      <span data-testid="ready-count">{count}</span>
      <button
        type="button"
        data-testid="exclude"
        onClick={() => mutate({ threadId: "t1", event: "excluded" })}
      >
        Exclude
      </button>
    </>
  );
}

let root: Root | undefined;
let client: QueryClient | undefined;

function mount(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(issuesKeys.comments("rev-1"), comments);
  root = createRoot(container);
  act(() => {
    root!.render(
      <QueryClientProvider client={client!}>
        <ReadyCount issueId="rev-1" />
      </QueryClientProvider>,
    );
  });
  return container;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  request.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  client?.clear();
  client = undefined;
  document.body.innerHTML = "";
});

describe("inclusion thread events", () => {
  it("updates the submit count from the comments cache before the refetch returns", async () => {
    let resolveRequest: (value: unknown) => void = () => undefined;
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const container = mount();
    expect(container.querySelector('[data-testid="ready-count"]')?.textContent).toBe("1");

    await act(async () => {
      container.querySelector('[data-testid="exclude"]')!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="ready-count"]')?.textContent).toBe("0");
    expect(request).toHaveBeenCalledWith("/api/issues/rev-1/threads/t1/events", {
      method: "POST",
      body: { event: "excluded" },
    });

    await act(async () => {
      resolveRequest({ thread: { ...comments.threads[0], included: false } });
      await Promise.resolve();
    });
  });
});
