// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSessionListItem, IssueDetail } from "@server/schemas";
import { ExportReviewWorkbench } from "./export-review-workbench";

const DRAFTS: Record<string, string> = {
  "github-export-auth.md":
    "---\ntitle: Secure auth flow\n---\n## Summary\n\nMigrate the epic.\n",
  "github-export-timeout.md":
    "---\ntitle: Session timeout policy\n---\n## Summary\n\nIdle sessions expire.\n",
  "github-export-mfa.md":
    "---\ntitle: MFA enrollment flow\n---\n## Summary\n\nUsers enroll.\n",
};

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("../api/queries", () => ({
  useAttachmentsQuery: () => ({
    data: [
      { name: "github-export-mfa.md" },
      { name: "github-export-timeout.md" },
      { name: "notes.md" },
      { name: "github-export-auth.md" },
    ],
    isLoading: false,
    isError: false,
    error: null,
  }),
  useIssuesQuery: () => ({
    data: {
      issues: [
        {
          id: "mfa",
          kind: "story",
          title: "MFA enrollment flow",
          order: 0,
          partOf: "auth",
          stackedOn: "timeout",
        },
        {
          id: "auth",
          kind: "epic",
          title: "Secure auth flow",
          order: 0,
          partOf: "issue-tracker",
        },
        {
          id: "timeout",
          kind: "story",
          title: "Session timeout policy",
          order: 1,
          partOf: "auth",
        },
      ],
    },
    isLoading: false,
  }),
  useExportDraftTexts: (_issueId: string, names: readonly string[]) =>
    names.map((name) => ({
      data: DRAFTS[name],
      isSuccess: true,
      isError: false,
      isLoading: false,
      error: null,
    })),
}));

vi.mock("@/features/agents/api/queries", () => ({
  useConversationTranscriptQuery: () => ({
    data: { events: [], latestSeq: 0 },
    isFetched: true,
    isError: false,
    isLoading: false,
  }),
}));

vi.mock("@/features/agents/components/conversation-thread", () => ({
  ConversationThread: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="conversation-thread" data-conversation-id={conversationId} />
  ),
}));

const fetchMock = vi.fn(async (_input: RequestInfo | URL) => {
  return new Response(JSON.stringify({ name: "github-export-auth.md" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

const issue = {
  id: "auth",
  kind: "epic",
  title: "Secure auth flow",
  partOf: "issue-tracker",
  status: "open",
  order: 0,
  archived: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  description: "",
  blockedBy: [],
  labels: [],
  version: "1",
} as unknown as IssueDetail;

const session: ChannelSessionListItem = {
  id: "exp-1",
  title: "Export Secure auth flow",
  model: "composer-2.5",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  archived: false,
  activeRun: false,
  awaitingHuman: false,
};

function setControlValue(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
}

const roots: Root[] = [];

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/projects/issue-tracker/issues/auth?tab=export"]}>
          <ExportReviewWorkbench
            issue={issue}
            session={session}
            transcript={<div data-testid="export-transcript-page" />}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return container;
}

afterEach(() => {
  for (const root of roots) root.unmount();
  roots.length = 0;
  document.body.innerHTML = "";
  fetchMock.mockClear();
});

describe("ExportReviewWorkbench", () => {
  it("previews the first tracker-order draft and saves an edit with PUT", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const container = mount();
    const rows = [...container.querySelectorAll("[data-testid='export-draft-row']")];
    expect(rows.map((row) => row.getAttribute("data-draft-name"))).toEqual([
      "github-export-auth.md",
      "github-export-timeout.md",
      "github-export-mfa.md",
    ]);
    expect(rows[0]?.textContent).toContain("Epic");
    expect(rows[1]?.textContent).toContain("Story");
    const preview = container.querySelector("[data-testid='export-draft-preview-body']");
    expect(preview?.textContent).toContain("Migrate the epic.");
    expect(preview?.textContent).not.toContain("title:");
    expect(container.querySelector("[data-testid='export-draft-editor']")).toBeNull();

    act(() => {
      (container.querySelector("[data-testid='export-draft-edit']") as HTMLButtonElement).click();
    });
    const editor = container.querySelector(
      "[data-testid='export-draft-editor']",
    ) as HTMLTextAreaElement;
    expect(editor.value).toContain("title: Secure auth flow");
    const edited = editor.value.replace("Migrate the epic.", "Migrated.");
    act(() => {
      setControlValue(editor, edited);
    });
    await act(async () => {
      (container.querySelector("[data-testid='export-draft-save']") as HTMLButtonElement).click();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/issues/auth/attachments/github-export-auth.md",
      expect.objectContaining({
        method: "PUT",
        body: edited,
        headers: expect.objectContaining({ "Content-Type": "text/markdown" }),
      }),
    );
    vi.unstubAllGlobals();
  });
});
