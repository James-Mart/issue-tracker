// @vitest-environment happy-dom
import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileDiffLoadedFiles, FileDiffMetadata } from "@pierre/diffs/react";
import type { IssueChange } from "@server/schemas";
import { IssueChangePanel } from "./issue-change-panel";

const SHA = "0123456789abcdef0123456789abcdef01234567";

const CONTEXT_PATCH = [
  "diff --git a/names.txt b/names.txt",
  "index 1111111..2222222 100644",
  "--- a/names.txt",
  "+++ b/names.txt",
  "@@ -6,7 +6,7 @@ echo",
  " foxtrot",
  " golf",
  " hotel",
  "-india",
  "+INDIA",
  " juliet",
  " kilo",
  " lima",
].join("\n");

const NEW_NAMES = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "INDIA",
  "juliet",
  "kilo",
  "lima",
  "mike",
  "november",
  "oscar",
  "papa",
  "quebec",
  "romeo",
  "sierra",
  "tango",
].join("\n") + "\n";

const changeQueryState = vi.hoisted(() => ({
  data: undefined as IssueChange | undefined,
  isLoading: false,
  error: null as Error | null,
  isFetching: false,
  refetch: vi.fn(),
}));

vi.mock("@pierre/diffs/react", () => ({
  Virtualizer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useVirtualizer: () => undefined,
  FileDiff: function FileDiffMock({
    fileDiff,
    options,
  }: {
    fileDiff: FileDiffMetadata;
    options?: {
      loadDiffFiles?: (diff: FileDiffMetadata) => Promise<FileDiffLoadedFiles>;
    };
  }) {
    const [expanded, setExpanded] = useState<string | null>(null);
    const canExpand =
      fileDiff.hunks.some((hunk) => hunk.collapsedBefore > 0) &&
      options?.loadDiffFiles != null &&
      expanded == null;

    return (
      <div data-testid="file-diff">
        {canExpand ? (
          <button
            type="button"
            data-expand-button=""
            data-unmodified-lines=""
            data-testid="issue-change-collapsed-context"
            onClick={() => {
              void options.loadDiffFiles!(fileDiff)
                .then((files) => {
                  setExpanded(files.newFile.contents);
                })
                .catch(() => {
                  // Stay collapsed so the row stays retryable.
                });
            }}
          >
            Expand unchanged
          </button>
        ) : null}
        {expanded != null ? (
          <pre data-testid="issue-change-expanded-context">{expanded}</pre>
        ) : null}
      </div>
    );
  },
}));

vi.mock("../api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/queries")>();
  return {
    ...actual,
    useIssueChangeQuery: () => ({
      data: changeQueryState.data,
      isLoading: changeQueryState.isLoading,
      error: changeQueryState.error,
      isFetching: changeQueryState.isFetching,
      refetch: changeQueryState.refetch,
    }),
  };
});

function loadedChange(): IssueChange {
  return {
    state: "loaded",
    patch: CONTEXT_PATCH,
    commits: [{ sha: SHA, subject: "Rename india" }],
    stats: { filesChanged: 1, insertions: 1, deletions: 1 },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mountPanel(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <IssueChangePanel issueId="task-1" projectId="platform" />
      </MemoryRouter>,
    );
  });
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
  changeQueryState.data = undefined;
  changeQueryState.isLoading = false;
  changeQueryState.error = null;
  changeQueryState.isFetching = false;
  changeQueryState.refetch.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("IssueChangePanel context expansion", () => {
  it("shows collapsed context, a loading state, then the fetched lines", async () => {
    changeQueryState.data = loadedChange();
    const pending = deferred<ReturnType<typeof jsonResponse>>();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", fetchMock);

    const container = mountPanel();
    const affordance = container.querySelector(
      '[data-testid="issue-change-collapsed-context"]',
    );
    expect(affordance).not.toBeNull();
    expect(
      container.querySelector('[data-testid="issue-change-context-loading"]'),
    ).toBeNull();

    act(() => {
      affordance?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector('[data-testid="issue-change-file-diff"]')
        ?.getAttribute("data-context-loading"),
    ).toBe("true");
    expect(
      container.querySelector('[data-testid="issue-change-context-loading"]')
        ?.textContent,
    ).toBe("Loading context…");
    expect(
      container.querySelector('[data-testid="issue-change-expanded-context"]'),
    ).toBeNull();

    await act(async () => {
      pending.resolve(jsonResponse({ contents: NEW_NAMES }));
      await pending.promise;
    });

    expect(
      container.querySelector('[data-testid="issue-change-context-loading"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="issue-change-expanded-context"]')
        ?.textContent,
    ).toBe(NEW_NAMES);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `/api/issues/task-1/change/file?path=names.txt&sha=${SHA}`,
    );
  });

  it("leaves the region collapsed and retryable when the fetch fails", async () => {
    changeQueryState.data = loadedChange();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "path missing" }, 404))
      .mockResolvedValueOnce(jsonResponse({ contents: NEW_NAMES }));
    vi.stubGlobal("fetch", fetchMock);

    const container = mountPanel();
    const first = container.querySelector(
      '[data-testid="issue-change-collapsed-context"]',
    );
    expect(first).not.toBeNull();

    await act(async () => {
      first?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector('[data-testid="issue-change-expanded-context"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="issue-change-context-loading"]'),
    ).toBeNull();
    const retry = container.querySelector(
      '[data-testid="issue-change-collapsed-context"]',
    );
    expect(retry).not.toBeNull();

    await act(async () => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector('[data-testid="issue-change-expanded-context"]')
        ?.textContent,
    ).toBe(NEW_NAMES);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
