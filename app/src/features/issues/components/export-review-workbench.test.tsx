// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useSearchParams } from "react-router-dom";
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

const mobile = vi.hoisted(() => ({ value: false }));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobile.value,
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

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const body = url.includes("/messages")
    ? JSON.stringify({ runId: "run-1" })
    : JSON.stringify({ name: "github-export-auth.md" });
  return new Response(body, {
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

function TabProbe() {
  const [params] = useSearchParams();
  return <span data-testid="tab-param">{params.get("tab") ?? ""}</span>;
}

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

function mount(
  transcript: ReactNode = <div data-testid="export-transcript-page" />,
  onExportDraftReaderOpenChange?: (open: boolean) => void,
) {
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
          <TabProbe />
          <ExportReviewWorkbench
            issue={issue}
            session={session}
            transcript={transcript}
            onExportDraftReaderOpenChange={onExportDraftReaderOpenChange}
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
  mobile.value = false;
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

  it("keeps phone Transcript and Drafts inside tab=export", () => {
    mobile.value = true;
    const container = mount();
    expect(container.querySelector("[data-testid='tab-param']")?.textContent).toBe(
      "export",
    );
    expect(container.querySelector("[data-testid='export-phone-modes']")).toBeTruthy();
    expect(container.querySelector("[data-testid='export-run-strip']")).toBeNull();
    expect(container.querySelector("[data-testid='export-draft-list']")).toBeTruthy();

    act(() => {
      (container.querySelector("[data-testid='export-phone-transcript']") as HTMLButtonElement).click();
    });
    expect(container.querySelector("[data-testid='export-transcript-page']")).toBeTruthy();
    expect(container.querySelector("[data-testid='export-draft-list']")).toBeNull();
    expect(container.querySelector("[data-testid='tab-param']")?.textContent).toBe(
      "export",
    );

    act(() => {
      (container.querySelector("[data-testid='export-phone-drafts']") as HTMLButtonElement).click();
    });
    expect(container.querySelector("[data-testid='export-draft-list']")).toBeTruthy();
    expect(container.querySelector("[data-testid='tab-param']")?.textContent).toBe(
      "export",
    );

    const mfaRow = container.querySelector(
      "[data-draft-name='github-export-mfa.md']",
    ) as HTMLButtonElement;
    expect(mfaRow.textContent).toContain("Story");
    expect(mfaRow.textContent).toContain("github-export-mfa.md");

    act(() => {
      mfaRow.click();
    });
    const reader = container.querySelector("[data-testid='export-draft-reader']");
    expect(reader).toBeTruthy();
    const back = container.querySelector(
      "[data-testid='export-draft-back']",
    ) as HTMLButtonElement;
    expect(back).toBeTruthy();
    expect(back.getAttribute("aria-label")).toBe("Back");
    expect(back.textContent).not.toContain("Drafts");
    expect(container.querySelector("[data-testid='export-phone-modes']")).toBeNull();
    expect(reader?.textContent).toContain("MFA enrollment flow");
    expect(reader?.textContent).not.toContain("Story");
    expect(reader?.textContent).not.toContain("github-export-mfa.md");
    expect(container.querySelector("[data-testid='export-draft-preview']")).toBeTruthy();
    expect(container.querySelector("[data-testid='export-draft-edit']")).toBeTruthy();
    expect(container.querySelector("[data-testid='export-draft-preview-body']")?.textContent).toContain(
      "Users enroll.",
    );

    act(() => {
      (container.querySelector("[data-testid='export-draft-edit']") as HTMLButtonElement).click();
    });
    const editor = container.querySelector(
      "[data-testid='export-draft-editor']",
    ) as HTMLTextAreaElement;
    expect(editor).toBeTruthy();
    expect(container.querySelector("[data-testid='export-draft-save']")).toBeTruthy();
    const edited = editor.value.replace("Users enroll.", "Users enrolled.");
    act(() => {
      setControlValue(editor, edited);
    });
    act(() => {
      (container.querySelector("[data-testid='export-draft-preview']") as HTMLButtonElement).click();
    });
    act(() => {
      (container.querySelector("[data-testid='export-draft-edit']") as HTMLButtonElement).click();
    });
    expect(
      (container.querySelector("[data-testid='export-draft-editor']") as HTMLTextAreaElement).value,
    ).toBe(edited);

    act(() => {
      back.click();
    });
    expect(container.querySelector("[data-testid='export-draft-list']")).toBeTruthy();
    expect(container.querySelector("[data-testid='export-phone-modes']")).toBeTruthy();
    expect(container.querySelector("[data-testid='tab-param']")?.textContent).toBe(
      "export",
    );
  });

  it("reports mobile reader open state", () => {
    mobile.value = true;
    const onChange = vi.fn();
    const container = mount(undefined, onChange);
    expect(onChange).toHaveBeenLastCalledWith(false);

    act(() => {
      (container.querySelector("[data-draft-name='github-export-mfa.md']") as HTMLButtonElement).click();
    });
    expect(onChange).toHaveBeenLastCalledWith(true);

    act(() => {
      (container.querySelector("[data-testid='export-draft-back']") as HTMLButtonElement).click();
    });
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("expands the run strip and posts { prompt } to the export session", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const container = mount();
    expect(container.querySelector("[data-testid='conversation-thread']")).toBeNull();
    expect(container.querySelector("[data-testid='export-run-prompt']")).toBeNull();

    act(() => {
      (container.querySelector("[data-testid='export-run-strip-toggle']") as HTMLButtonElement).click();
    });
    const thread = container.querySelector("[data-testid='conversation-thread']");
    expect(thread?.getAttribute("data-conversation-id")).toBe("exp-1");
    const prompt = container.querySelector(
      "[data-testid='export-run-prompt']",
    ) as HTMLInputElement;
    expect(prompt).toBeTruthy();
    act(() => {
      setControlValue(prompt, "please tweak the title");
    });
    await act(async () => {
      (container.querySelector("[data-testid='export-run-send']") as HTMLButtonElement).click();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/conversations/exp-1/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ prompt: "please tweak the title" }),
      }),
    );
    vi.unstubAllGlobals();
  });
});
